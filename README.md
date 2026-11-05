# Manhwa Studio — moldura, marca-d’água e limpeza de metadados

Aplicação web para receber um link de vídeo do YouTube, baixar vídeos acessíveis do YouTube por meio de um backend próprio, aplicar uma imagem PNG/JPEG como moldura, compor a moldura e exportar um novo vídeo.

## Fluxo de uso

1. Cole o link de um único vídeo do YouTube.
2. Envie a imagem PNG ou JPEG que será usada como fundo/moldura.
3. 4. Clique em **Criar vídeo com 1 clique**.
5. O backend executado dentro da instância Vast.ai compõe e renderiza o vídeo usando FFmpeg, CUDA/NVDEC/NVENC quando os recursos estão disponíveis.
6. O arquivo final MP4 H.264/AAC é baixado automaticamente.

O serviço aceita links de vídeos públicos e não listados, incluindo Shorts e links youtu.be. Vídeos privados, removidos, bloqueados por região ou que exijam login podem não estar acessíveis. Playlists não são aceitas. O limite configurado no backend do YouTube é 7 GB. Use apenas vídeos que você possui ou tem autorização para processar. Não há login, cookies ou credenciais do YouTube no serviço.

## Backend do YouTube

O backend fica em `youtube-backend/` e usa FastAPI, yt-dlp e FFmpeg. Ele aceita links de vídeo do YouTube, e aceita vídeos públicos e não listados, inclusive Shorts. Playlists são recusadas; vídeos privados ou que exijam autenticação dependem de acesso permitido pelo YouTube. O limite configurado é de 7 GB por arquivo; a duração não é limitada pelo aplicativo, mas vídeos longos podem exceder esse limite de tamanho ou os recursos disponíveis no Render. Há um limite simples de quatro solicitações por endereço IP por hora e até dois downloads simultâneos por instância. O download é assíncrono para evitar manter uma única requisição HTTP aberta durante todo o processamento.

### Implantar no Render

1. Crie um novo serviço no Render a partir deste repositório e use o Blueprint `render.yaml` (ou crie um serviço Docker manualmente).
2. O serviço Docker deve usar `youtube-backend/Dockerfile`; o contexto Docker é `youtube-backend`.
3. Configure a variável `CORS_ORIGINS` com a origem exata do app publicado no Lovable, por exemplo `https://seu-projeto.lovable.app`. Não inclua caminhos depois do domínio.
4. Após o deploy, teste `https://SEU-SERVICO.onrender.com/health`. A resposta deve conter `"status":"ok"`.
5. No projeto Lovable, configure a variável de ambiente `VITE_YOUTUBE_BACKEND_URL` com a URL base do serviço Render, sem barra no final, por exemplo `https://seu-servico.onrender.com`.
6. Sincronize/republique o app Lovable para incorporar a variável de ambiente.

O plano gratuito do Render pode entrar em suspensão por inatividade e tem limites de CPU, memória e duração de requisição. Vídeos grandes podem falhar nesse plano; para uso contínuo, considere um serviço com mais recursos. O backend usa armazenamento temporário e apaga os arquivos após a resposta. Não configure armazenamento permanente para os downloads.

### Executar localmente

Requer Python 3.11+ e FFmpeg instalado e disponível no PATH.

```sh
cd youtube-backend
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

No ambiente do frontend, configure:

```env
VITE_YOUTUBE_BACKEND_URL=http://127.0.0.1:8000
```

## Processamento e limitações

- O download do YouTube acontece no backend. O vídeo baixado é enviado de volta ao navegador para a composição.
- Na configuração Vast.ai, a composição visual e a gravação final são executadas no backend Python/FFmpeg dentro da própria instância. O navegador é apenas a interface.
- A imagem enviada preenche o fundo; o vídeo é centralizado e dimensionado sem cortar o quadro original.
- O renderizador Vast.ai usa `-map_metadata -1`, `-map_metadata:s -1` e `-map_chapters -1` para remover metadados globais, de faixas e capítulos no MP4 final.
- Informações técnicas necessárias para reprodução — codec, dimensões, duração, timestamps e estrutura do contêiner — continuam presentes.
- Para renderização acelerada, o FFmpeg tenta manter os quadros de vídeo na memória CUDA e usar `scale_cuda` + `overlay_cuda`, além de NVENC. Se os filtros CUDA não estiverem disponíveis, usa filtros CPU e ainda pode codificar por NVENC. O status do backend informa qual caminho foi utilizado.

## Desenvolvimento

Requer Node.js compatível com Vite 8.

```sh
npm install
npm run dev
npm run lint
npm test
npm run build
```

## Executar diretamente na Vast.ai (sem túnel)

1. Clone o repositório dentro da instância Vast.ai com GPU NVIDIA.
2. No painel da instância, exponha a porta **8000/TCP** como serviço HTTP e use a URL HTTPS fornecida pela própria Vast.ai em **Connect**.
3. No terminal, entre na pasta do repositório e execute `bash youtube-backend/start_vastai.sh`.
4. Copie a `API_KEY` gerada no terminal.
5. Na interface Manhwa Studio, cole a URL HTTPS da porta 8000 publicada pela Vast.ai e a API_KEY do backend.
6. Confirme que o painel mostra a GPU, NVENC e NVDEC detectados antes de iniciar a renderização.

O script não cria Cloudflare Tunnel, ngrok ou qualquer túnel de terceiros. A chave da API da Vast.ai não é usada pelo renderizador; ela serve apenas para administrar instâncias na plataforma. A `API_KEY` impressa pelo script é uma chave local do backend Manhwa Studio.

A composição GPU usa `scale_cuda` e `overlay_cuda` quando ambos existem no FFmpeg, com NVDEC mantendo os quadros na memória CUDA. Caso contrário, o sistema recua para filtros CPU; NVENC pode continuar sendo usado para codificação. A opção Automático prioriza velocidade e compatibilidade. Vídeos longos precisam de espaço temporário livre pelo menos equivalente ao vídeo de entrada mais o MP4 de saída.
