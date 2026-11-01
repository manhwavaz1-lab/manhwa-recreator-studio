# Manhwa Studio — moldura, marca-d’água e limpeza de metadados

Aplicação web para receber um link de vídeo do YouTube, baixar vídeos acessíveis do YouTube por meio de um backend próprio, aplicar uma imagem PNG/JPEG como moldura, desfocar uma região de marca-d’água própria e exportar um novo vídeo.

## Fluxo de uso

1. Cole o link de um único vídeo do YouTube do YouTube.
2. Envie a imagem PNG ou JPEG que será usada como fundo/moldura.
3. Opcionalmente, ative **Ocultar sua marca-d’água** e informe a posição e o tamanho da região em porcentagem do quadro original.
4. Clique em **Criar vídeo com 1 clique**.
5. O backend inicia um trabalho em segundo plano, informa o progresso por consulta periódica e disponibiliza o MP4 ao navegador quando termina. Quando a conexão Colab está preenchida, o site envia o vídeo, a moldura e os ajustes para a API do notebook; o FFmpeg em CPU gera MP4 H.264/AAC e o navegador baixa o resultado. Sem Colab, permanece disponível o renderizador local do navegador.
6. O arquivo final WebM é baixado automaticamente.

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
- Sem Colab, a composição visual e a gravação final continuam no navegador. Com Colab conectado, a composição é executada pelo FFmpeg na API do notebook e a saída é MP4 H.264/AAC.
- A imagem enviada preenche o fundo; o vídeo é centralizado e dimensionado sem cortar o quadro original.
- A opção de marca-d’água aplica desfoque somente à região definida pelo usuário. Ela não reconstrói o cenário que existia atrás do logotipo.
- O renderizador do navegador usa MediaRecorder e produz WebM. O renderizador Colab usa FFmpeg/libx264 e produz MP4; a disponibilidade de 4K depende dos recursos da sessão.
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


## Renderização em CPU pelo Google Colab

Notebook pronto: [Abrir Manhwa Studio CPU Renderer no Google Colab](https://colab.research.google.com/github/manhwavaz1-lab/manhwa-recreator-studio/blob/main/colab/Manhwa_Studio_CPU_Renderer.ipynb).

1. Abra o notebook e clique em **Conectar**.
2. Execute as células em ordem, de cima para baixo.
3. A última célula inicia a API FFmpeg em CPU e cria uma URL HTTPS temporária pelo Cloudflare Tunnel.
4. Mantenha a sessão aberta enquanto renderiza.

O notebook cria um token aleatório por sessão. A URL e o token expiram quando o Colab desconecta. O endpoint recebe vídeo e moldura em `POST /render`, com o token no cabeçalho `X-Render-Token`. A saída é MP4 H.264/AAC.

A API está implementada em `colab/manhwa_cpu_api.py`; o notebook baixa esse arquivo do repositório e inicia o servidor e o túnel. O teste `/health` confirma que a API está acessível. A porcentagem exibida no site acompanha o envio e o recebimento do arquivo, não o processamento interno do FFmpeg. A conexão é temporária e precisa ser refeita a cada sessão. O Colab CPU não garante renderização mais rápida que o navegador ou uma GPU; vídeos longos e 4K podem exceder os limites de tempo, memória ou armazenamento temporário.
