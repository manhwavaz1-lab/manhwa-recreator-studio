# Manhwa Studio — versão Google Colab + Google Drive

Esta versão adiciona um fluxo independente para renderizar vídeos com FFmpeg no runtime do Google Colab, montando o Google Drive para entrada e saída. Ela não substitui nem altera a aplicação web principal.

## Abrir no Colab

1. Abra o notebook `colab/Manhwa_Studio_Google_Drive.ipynb` no GitHub e escolha **Open in Colab** (ou faça upload do `.ipynb` no Colab).
2. Execute as células em ordem e autorize o acesso ao Google Drive.
3. Coloque o vídeo e a moldura PNG/JPG em `Meu Drive/ManhwaStudio/entrada`.
4. Configure formato, zoom e recorte e execute a renderização.
5. O MP4 final será salvo em `Meu Drive/ManhwaStudio/exportados`.

## O que está incluído

- Renderização FFmpeg H.264 com áudio AAC.
- Saída 16:9 ou 9:16, 1080p, 30 FPS por padrão.
- Moldura ajustada ao quadro sem distorção.
- Opção de recortar para preencher ou preservar o vídeo inteiro.
- Zoom e deslocamento horizontal/vertical.
- Desfoque opcional de uma região definida em percentuais do vídeo original.
- Detecção de encoder: tenta NVIDIA NVENC, Intel QSV ou AMD AMF quando disponíveis; caso contrário usa `libx264` por CPU.
- Entrada e exportação diretamente no Google Drive.
- Download opcional via yt-dlp, sujeito às permissões e condições da plataforma.

## Limitações

- A GPU do Colab depende do runtime atribuído e pode não estar disponível. O notebook verifica os encoders do FFmpeg e usa CPU como fallback.
- A versão Colab não reproduz toda a interface interativa React do site; é um fluxo de renderização por notebook com parâmetros editáveis.
- Não foi possível executar um render de ponta a ponta em uma sessão Colab real nesta alteração. Teste com um vídeo curto antes de processar arquivos grandes.
- Use somente vídeos que você possui ou tem autorização para baixar e modificar.
