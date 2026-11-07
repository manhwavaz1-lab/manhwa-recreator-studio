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
git clone https://github.com/manhwavaz1-lab/manhwa-recreator-studio.git
cd manhwa-recreator-studio
bash start_vastai.sh
```

O script instala as dependências Python e Node, instala as dependências, inicia a API GPU em `127.0.0.1:8001` e publica o site pelo Vite na porta HTTP `8000`. No painel da Vast.ai, exponha somente a porta HTTP 8000 e abra a URL HTTPS que a própria Vast.ai apresentar em Connect.

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
npm install
npm run dev
```

Para o backend local, inicie FastAPI na porta 8001; o proxy do Vite encaminha `/api` e `/health` automaticamente.


## Vast.ai — perfil RTX 5060 Ti (Ubuntu 24.04 / CUDA 12.9)

O perfil recomendado para instâncias como RTX 5060 Ti 16 GB VRAM, AMD EPYC e 64 GB de RAM usa o renderizador FastAPI + FFmpeg/NVENC. A aplicação recebe o vídeo e a moldura pelo navegador, renderiza no servidor Vast.ai e disponibiliza o MP4 final.

### Inicialização rápida

Na instância Vast.ai, execute na pasta `/workspace`:

```bash
git clone https://github.com/manhwavaz1-lab/manhwa-recreator-studio.git
cd manhwa-recreator-studio
bash start_vastai.sh
```

Se o repositório já estiver clonado:

```bash
cd /workspace/manhwa-recreator-studio
git fetch origin
git switch main
git pull --ff-only origin main
bash start_vastai.sh
```

O site é iniciado em modo servidor Vite para contornar a ausência do artefato `dist/server/server.js` esperado pelo preview do TanStack nesta configuração. No painel da Vast.ai, publique somente a porta HTTP **8000**. O site e a API GPU são ligados pelo proxy local; a porta interna 8001 não deve ser exposta.

### Perfil de hardware e limites

- Detecta GPU NVIDIA, VRAM, driver e suporte NVENC em tempo de execução.
- Usa NVENC H.264/H.265 quando disponível e fallback CPU quando necessário.
- Uma renderização por vez por padrão para evitar disputa de VRAM e disco.
- Vídeo e moldura são enviados diretamente à instância; a saída é MP4.
- A VRAM de GPUs diferentes nunca é somada. A configuração atual foi dimensionada para uma GPU de aproximadamente 16 GB.
- O número de threads é configurável por `RENDER_THREADS`; não significa que a codificação NVENC escale linearmente com os núcleos da CPU.

**Importante:** a velocidade real depende do codec, resolução, filtros, FPS, duração, armazenamento e driver. A detecção de NVENC não substitui um teste de renderização ponta a ponta.
