# Divisor local de vídeos — Manhwa Studio

Esta etapa usa o FFmpeg instalado no Windows para dividir vídeos no próprio computador. O arquivo original e as partes ficam em:

`%LOCALAPPDATA%\ManhwaStudio\video-parts\`

## Requisitos

- Windows 10/11
- Python 3.11 ou superior disponível pelo comando `py`
- FFmpeg e FFprobe instalados e disponíveis no `PATH`
- Espaço livre em disco para o arquivo original e as partes geradas

## Iniciar

1. Baixe/clique no arquivo `INICIAR_DIVISOR_LOCAL.bat` desta pasta.
2. Mantenha a janela aberta enquanto usa o site.
3. Abra o Manhwa Studio e use a seção **ETAPA 1 · DIVIDIR VÍDEO**.
4. Selecione o vídeo e inicie a divisão.
5. Escolha uma parte na lista e clique em **USAR PARTE NA EDIÇÃO**.

O serviço local escuta somente em `127.0.0.1:8765`. Não há geração de ZIP.

## Limites e observações

- Tamanho máximo: 8 GiB (8 GB binários).
- Duração máxima: 25 horas.
- Intervalo pretendido: 30 minutos; o modo de cópia de streams respeita os keyframes, então a duração exata de cada parte pode variar alguns segundos.
- O processamento é feito sem recodificação para ser mais rápido e preservar a qualidade. Alguns formatos/codecs podem não ser compatíveis com o contêiner MP4 de saída.
- Os arquivos permanecem no disco até serem apagados manualmente. Verifique se há espaço suficiente antes de iniciar.
- Não feche a janela do serviço durante o processamento ou ao carregar uma parte para a edição.
