# Manhwa Studio — moldura, marca-d’água e limpeza de metadados

Aplicação web para receber um link de vídeo do YouTube, baixar vídeos públicos ou não listados por meio de um backend próprio, aplicar uma imagem PNG/JPEG como moldura, desfocar uma região de marca-d’água própria e exportar um novo vídeo.

## Fluxo de uso

1. Cole o link de um único vídeo público ou não listado do YouTube.
2. Envie a imagem PNG ou JPEG que será usada como fundo/moldura.
3. Opcionalmente, ative **Ocultar sua marca-d’água** e informe a posição e o tamanho da região em porcentagem do quadro original.
4. Clique em **Criar vídeo com 1 clique**.
5. O backend baixa o vídeo e devolve o MP4 ao navegador. O navegador aplica a moldura, grava a composição e o FFmpeg.wasm remove metadados descritivos do contêiner.
6. O arquivo final WebM é baixado automaticamente.

Use apenas vídeos que você possui ou tem autorização para processar. Não há login, cookies ou credenciais do YouTube no serviço.

## Backend do YouTube

O backend fica em `youtube-backend/` e usa FastAPI, yt-dlp e FFmpeg. Ele aceita links de vídeo do YouTube, inclusive não listados, e recusa playlists, transmissões ao vivo e vídeos que exijam login. O limite configurado é de 4 horas e 2 GB por arquivo. Há um limite simples de quatro solicitações por endereço IP por hora e até dois downloads simultâneos por instância.

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
- A composição visual e a gravação final continuam no navegador. O vídeo inteiro é reproduzido, sem cortes, aceleração, legendas, roteiro ou narração.
- A imagem enviada preenche o fundo; o vídeo é centralizado e dimensionado sem cortar o quadro original.
- A opção de marca-d’água aplica desfoque somente à região definida pelo usuário. Ela não reconstrói o cenário que existia atrás do logotipo.
- A renderização inicial usa MediaRecorder e recodifica vídeo e áudio. A saída atual é WebM, com resolução de até 1920 pixels no maior eixo.
- FFmpeg.wasm é carregado sob demanda de CDN e remuxa o WebM com `-map_metadata -1`, `-map_chapters -1` e `-c copy`. Isso remove metadados descritivos do contêiner, como título, comentário, descrição, data e capítulos.
- Informações técnicas necessárias para reprodução — codec, dimensões, duração, timestamps e estrutura do contêiner — continuam presentes.
- O navegador precisa ter memória suficiente para trabalhar com o vídeo baixado e a composição. Arquivos grandes podem exigir bastante RAM.

## Desenvolvimento

Requer Node.js compatível com Vite 8.

```sh
npm install
npm run dev
npm run lint
npm test
npm run build
```
