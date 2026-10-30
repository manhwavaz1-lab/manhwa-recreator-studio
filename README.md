# Manhwa Studio — Moldura, ocultação de marca própria e limpeza de metadados

Aplicação web para aplicar uma imagem PNG/JPEG como fundo ao redor de um vídeo, desfocar uma área de marca-d’água própria e limpar metadados descritivos do contêiner em um fluxo automatizado.

## Como usar

1. Selecione o vídeo original.
2. Selecione a imagem PNG ou JPEG que será usada como fundo/moldura.
3. Opcionalmente, ative **Ocultar sua marca-d’água** e informe a posição e o tamanho da região em porcentagem do quadro original. Esses valores podem ser ajustados para cada canal.
4. Clique em **Criar vídeo com 1 clique**.
5. Aguarde a composição e a etapa FFmpeg; o arquivo WebM final será baixado automaticamente.

## Processamento

- A composição visual ocorre no navegador. O vídeo inteiro é reproduzido, sem cortes, aceleração, legendas, roteiro ou narração.
- A imagem enviada preenche o fundo; o vídeo é centralizado e dimensionado sem cortar o quadro original.
- A opção de marca-d’água aplica desfoque somente à região definida pelo usuário. Ela não reconstrói o cenário que existia atrás do logotipo; o resultado pode ficar visivelmente borrado.
- A renderização inicial usa MediaRecorder e recodifica vídeo e áudio.
- Em seguida, FFmpeg.wasm é carregado sob demanda a partir de CDN e remuxa o WebM com `-map_metadata -1`, `-map_chapters -1` e `-c copy`. Isso remove metadados descritivos do contêiner, como título, comentário, descrição, data e capítulos, sem recodificar novamente as faixas.
- Informações técnicas necessárias para a reprodução — codec, dimensões, duração, timestamps e estrutura do contêiner — continuam presentes. Não é tecnicamente possível eliminar toda informação estrutural e ainda manter um arquivo de vídeo reproduzível.
- Os arquivos de mídia permanecem no navegador; o CDN fornece apenas o código e o núcleo WebAssembly do FFmpeg.
- A saída é WebM, com resolução de até 1920 pixels no maior eixo.

## Limitações

- A marca-d’água é desfocada, não removida por reconstrução/inpainting. Ajuste a região para cada vídeo/canal.
- A composição recodifica a faixa de áudio e vídeo na primeira etapa; o FFmpeg usa cópia de fluxo na etapa de limpeza.
- A execução do FFmpeg exige conexão com a internet na primeira carga do módulo. Se o CDN estiver indisponível, a limpeza falha e a exportação não é considerada concluída.
- A saída atual é WebM, não MP4.

## Desenvolvimento

Requer Node.js compatível com Vite 8.

```sh
npm install
npm run dev
npm run lint
npm test
npm run build
```
