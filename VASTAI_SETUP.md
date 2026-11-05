# Executar o Manhwa Studio no Vast.ai

## Perfil da instância confirmado pelo usuário
A captura de 05/11/2026 mostra RTX 5060 Ti (15,9 GB VRAM), 72 vCPUs, aproximadamente 257,8 GB de RAM, Ubuntu 24.04 com CUDA 12.9 e disco de 32 GB. O serviço detecta novamente os recursos no boot; não assume que NVENC/NVDEC estão disponíveis apenas pelo nome da GPU.

## 1. Abrir a porta e iniciar
1. O serviço escuta internamente na porta TCP **8000**. Como o script cria um túnel HTTPS Cloudflare de saída, não é necessário publicar a porta 8000 na internet. Garanta que a instância tenha acesso de saída à internet.
2. Abra o terminal/Jupyter da instância.
3. Execute:

```bash
cd /workspace
git clone --depth 1 --branch vastai-gpu-render-upgrade https://github.com/manhwavaz1-lab/manhwa-recreator-studio.git
cd manhwa-recreator-studio
bash youtube-backend/start_vastai.sh
```

Se o repositório já estiver clonado:
```bash
cd /workspace/manhwa-recreator-studio
git fetch origin
git checkout vastai-gpu-render-upgrade
git pull
bash youtube-backend/start_vastai.sh
```

O script instala dependências Python/FFmpeg, detecta o número de CPUs, testa NVENC H.264/H.265 e tenta iniciar o serviço. Se necessário, instala cloudflared e abre um túnel HTTPS temporário.

## 2. Conectar o app Lovable
1. Aguarde o terminal mostrar uma URL terminada em `.trycloudflare.com`. Essa URL é temporária e muda quando o túnel reinicia.
2. Copie a URL HTTPS inteira.
3. Abra o app Lovable atualizado, seção **Conexão com o servidor Vast.ai**.
4. Cole a URL no campo **URL HTTPS do servidor Vast.ai**.
5. Copie a chave impressa no terminal na linha `API_KEY` e cole no campo **Chave de acesso**.
6. Aguarde aparecer a GPU e as capacidades NVENC/NVDEC.

A chave é mantida somente no estado da página; ao atualizar/fechar o navegador, cole-a novamente. Não publique a chave nem a inclua em arquivos `.env` do frontend.

## 3. Teste recomendado
Comece com um vídeo curto (30–60 segundos), uma moldura PNG/JPEG, 1080p, H.264, FPS original e motor Automático. Confirme:
- Upload chega a 20% com progresso real de transferência.
- Renderização avança de 20% a 99%.
- O resultado baixa como MP4.
- O campo de status informa NVENC ou CPU fallback.

Depois teste 4K e vídeos longos. Vídeos com várias horas precisam de espaço livre no disco temporário; o limite padrão do backend é 7 GiB por arquivo e deve ser aumentado conscientemente se necessário.

## 4. Configuração da instância
Variáveis opcionais:
- `PORT`: porta interna (padrão 8000).
- `RENDER_THREADS`: threads FFmpeg (padrão: CPUs detectadas).
- `RENDER_SLOTS`: renderizações simultâneas (padrão 1).
- `MAX_FILE_BYTES`: limite de upload em bytes (padrão 7 GiB).
- `API_KEY`: chave fixa opcional. Se não definida, o script gera uma chave aleatória a cada inicialização.
- `RATE_LIMIT`: limite de novos trabalhos por IP por hora (padrão 10).

## 5. Observações operacionais
- Mantenha o terminal/script rodando; fechar a sessão encerra API e túnel.
- O túnel quick Cloudflare é temporário e destinado a testes. Para produção, configure um túnel Cloudflare nomeado/domínio próprio ou reverse proxy HTTPS persistente.
- O modo Automático tenta NVENC e faz fallback para CPU se a renderização GPU falhar. A disponibilidade é validada por teste real de encode, não apenas por listagem de encoder.
- NVDEC é tentado quando o FFmpeg/driver o disponibilizam; filtros da composição são executados em CPU quando não há pipeline CUDA compatível. Não se promete 100% de uso de GPU.
- O serviço mantém um trabalho em memória e aceita uma renderização por vez por padrão. Reiniciar o processo encerra trabalhos em andamento.
- O app continua oferecendo o modo local WebM como alternativa; para MP4 H.264/H.265 com FFmpeg, selecione o servidor Vast.ai.
- O backend baixa vídeos de URLs do YouTube somente quando o usuário tem autorização e o conteúdo está acessível. Restrições do YouTube, login, idade ou direitos autorais podem impedir downloads.
