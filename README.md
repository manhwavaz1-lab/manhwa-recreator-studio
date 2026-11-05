# Manhwa Studio — upload local e renderização automática na GPU

O Manhwa Studio recebe um vídeo e uma imagem de borda/moldura pelo navegador, envia os dois arquivos ao computador virtual Vast.ai, renderiza com FFmpeg usando a GPU NVIDIA quando suportado e devolve o MP4 pronto no mesmo site.

## Fluxo do usuário

1. Abrir o endereço do site publicado na instância Vast.ai.
2. Selecionar o vídeo no computador.
3. Selecionar a imagem PNG/JPEG da borda.
4. Clicar em **Criar vídeo com 1 clique**.
5. Acompanhar o envio e a renderização e baixar o MP4 final.

Não existe campo de URL de API, API Key, link do YouTube, Cloudflare Tunnel ou ngrok na interface. O site detecta a GPU automaticamente usando o mesmo endereço de origem da página. Os arquivos selecionados no navegador são enviados diretamente ao backend da instância.

## Inicialização na Vast.ai

Requisitos da imagem da instância: GPU NVIDIA com drivers funcionais, FFmpeg instalado, Python 3.11+, Node.js e npm.

Na instância, clone este repositório e inicie o serviço uma vez:

```bash
git clone -b vast-direct-gpu-render https://github.com/manhwavaz1-lab/manhwa-recreator-studio.git
cd manhwa-recreator-studio
bash youtube-backend/start_vastai.sh
```

O script instala as dependências Python e Node, compila a interface, inicia a API GPU em `127.0.0.1:8001` e publica o site na porta HTTP `8000`. No painel da Vast.ai, exponha somente a porta HTTP 8000 e abra a URL HTTPS que a própria Vast.ai apresentar em Connect.

A porta 8001 não deve ser publicada. A API é acessada pelo proxy do próprio site, no mesmo domínio. O usuário final não precisa preencher endereço de API nem chave.

Para reiniciar automaticamente junto com a instância, configure o comando de inicialização da instância Vast.ai para executar o script no diretório do projeto.

## Renderização

- Upload com progresso real do navegador para o servidor.
- Renderização assíncrona com progresso, velocidade e estimativa de tempo restante.
- FFmpeg tenta usar NVDEC para decodificar, filtros CUDA `scale_cuda` e `overlay_cuda` para composição e NVENC para codificar.
- Se os filtros CUDA não estiverem disponíveis, o renderizador usa filtros CPU; NVENC continua sendo selecionado quando disponível.
- Saída MP4 H.264/H.265 com áudio AAC, pixel format compatível e `+faststart`.
- Metadados globais, metadados de streams e capítulos são removidos na exportação.
- O processamento ocorre no disco temporário da instância; mantenha espaço livre suficiente para o vídeo original e o arquivo final.

## Segurança e uso

Esta configuração foi pensada para uma instância privada de uso pessoal. A API não solicita uma chave digitada na interface; mantenha a porta pública somente para o site que você utiliza e não compartilhe o endereço da instância. Há limitação de requisições por IP e limite máximo de tamanho de arquivo configurável por `MAX_FILE_BYTES`.

## Desenvolvimento local

```bash
npm ci
npm run dev
```

Para o backend local, inicie FastAPI na porta 8001; o proxy do Vite encaminha `/api` e `/health` automaticamente.
