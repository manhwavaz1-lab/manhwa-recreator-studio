# Manhwa Studio — Google Colab + Google Drive

Versão independente do Manhwa Studio com painel de edição no Google Colab. O notebook monta o Google Drive, permite navegar pelas pastas e selecionar diretamente os arquivos de vídeo e moldura. Não baixa vídeos do YouTube.

## Abrir no Colab

[Abra o notebook no Google Colab](https://colab.research.google.com/github/manhwavaz1-lab/manhwa-recreator-studio/blob/google-colab-drive/colab/Manhwa_Studio_Google_Drive.ipynb).

1. Execute as células em ordem e autorize o acesso ao Google Drive.
2. Na seção **Navegador do Google Drive**, navegue pelas pastas do Meu Drive.
3. Selecione um arquivo de vídeo e clique em **VINCULAR VÍDEO**.
4. Selecione uma imagem PNG/JPG/WEBP e clique em **VINCULAR MOLDURA**.
5. Ajuste formato, resolução, encoder, recorte, zoom e posição.
6. Clique em **RENDERIZAR VÍDEO**. O resultado fica em `Meu Drive/ManhwaStudio/exportados`.
7. Clique em **BAIXAR MP4** para baixar uma cópia para o computador.

## Recursos do painel

- Navegador de pastas e arquivos do Google Drive, sem links do YouTube.
- Prévia do vídeo selecionado e da moldura selecionada.
- Formatos horizontal 16:9 e vertical 9:16.
- Resolução Full HD 1080p ou Ultra HD 4K.
- Encoder automático, NVIDIA NVENC quando disponível ou CPU x264.
- Recortar para preencher ou mostrar o vídeo inteiro.
- Zoom e deslocamento horizontal/vertical.
- Desfoque opcional de uma região indicada em percentuais.
- Renderização FFmpeg H.264 com áudio AAC, 30 FPS.
- Arquivo final salvo no Drive e opção de download pelo navegador.

## Limitações e validação

- A GPU do Colab depende do runtime atribuído. Ter uma GPU NVIDIA não garante que o encoder NVENC esteja disponível; se falhar, o renderizador tenta CPU x264.
- A interface é um painel interativo feito com widgets do Colab, adaptado do fluxo e dos controles da aplicação Lovable; não é a aplicação React executando dentro do Colab.
- A navegação lista arquivos e pastas que o Google Drive já disponibilizou após a montagem. Atalhos compartilhados que não aparecem no Meu Drive podem precisar ser adicionados ao Drive.
- Esta alteração foi gravada no GitHub, mas ainda não foi testada em uma sessão real do Colab com seus arquivos e GPU. Faça primeiro um teste com um vídeo curto.
- Use somente mídia que você possui ou tem autorização para editar.
