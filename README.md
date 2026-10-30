# Manhwa Studio — Criador automático de moldura para vídeo

Aplicação web simples para aplicar uma imagem PNG ou JPEG como fundo/moldura ao redor de um vídeo, com exportação em um clique.

## Como usar

1. Abra o aplicativo no navegador.
2. Selecione o vídeo original.
3. Selecione uma imagem PNG ou JPEG para usar como fundo/moldura.
4. Clique em **Criar vídeo com 1 clique**.
5. O navegador reproduz o vídeo inteiro, compõe a imagem de fundo ao redor dele e inicia o download do resultado.

## Processamento

- Todo o processamento acontece localmente no navegador; os arquivos não são enviados ao servidor.
- O vídeo é mantido integralmente: sem cortes, aceleração, filtros, legendas, narração ou comentários.
- A imagem enviada preenche o fundo; o vídeo é centralizado e ajustado para caber sem cortar seu quadro.
- A exportação atual usa MediaRecorder e gera WebM. O navegador decodifica e recodifica a faixa de vídeo para incorporar a moldura e também recodifica a faixa de áudio sem aplicar efeitos ou cortes.
- Como o resultado é um novo arquivo/container, os metadados comuns do contêiner original não são copiados. Isso não remove necessariamente identificadores ou metadados que possam estar codificados no próprio conteúdo audiovisual.
- A saída segue a orientação do vídeo original e usa resolução de até 1920 pixels no maior eixo.

## Limitações técnicas

A composição visual exige renderizar novamente o vídeo. MediaRecorder no navegador não oferece stream-copy de áudio bit a bit. Portanto, o áudio mantém a reprodução integral e não recebe cortes ou efeitos, mas passa por nova codificação. Para preservar exatamente os pacotes de áudio originais, seria necessário um pipeline FFmpeg com filtro de vídeo e `-c:a copy`; isso não está implementado nesta versão. A saída atual é WebM, não MP4.

## Desenvolvimento

Requer Node.js compatível com Vite 8.

```sh
npm install
npm run dev
npm run lint
npm test
npm run build
```
