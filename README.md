# Manhwa Recreator Studio Pro — V4.0

Aplicação web de apoio à produção de recaps de Manhwa, com análise de referências visuais, roteiro original e memória narrativa entre episódios.

## O que está implementado nesta entrega

- Interface de estúdio em português, tema escuro e layout responsivo.
- Cadastro do nome do projeto.
- Campo de URL do YouTube para registrar a referência do episódio.
- Importação local de vídeo ou até 8 imagens. Para vídeo, o navegador extrai três quadros de referência usando vídeo HTML + Canvas.
- Integração com OpenRouter: consulta do catálogo de modelos e chamadas de chat com imagens.
- Análise de quadros e geração de sinopse, cenas, personagens, movimentos de câmera, roteiro e notas de continuidade.
- Memória narrativa persistida no navegador (personagens, episódios e lore).
- Editor de roteiro, prévia de voz via SpeechSynthesis do navegador e exportação de legendas WebVTT.
- Exportação do estado do projeto e da memória em JSON.
- Tela de linha do tempo que organiza cenas e deixa explícita a dependência do renderizador.

## Desenvolvimento

Requer Node.js compatível com Vite 8.

\`\`\`sh
npm install
npm run dev
npm run lint
npm test
npm run build
\`\`\`

## Configuração OpenRouter

1. Crie uma chave em https://openrouter.ai/keys.
2. Abra Configurações / OpenRouter no aplicativo e informe a chave.
3. Clique em **Atualizar modelos** e escolha um modelo com entrada de imagem para análise visual.
4. A chave é salva no localStorage do navegador atual. Em computador compartilhado, remova-a ao terminar.

A aplicação chama a API OpenRouter diretamente do navegador. Para produção com vários usuários, substitua isso por um backend autenticado que mantenha a chave em segredo. Nunca publique uma chave em código, commit ou variável pública do front-end.

## Limitações importantes — não confundir com funcionalidades concluídas

- **URL do YouTube:** o link é guardado como referência; esta aplicação não baixa vídeos do YouTube. Importe um arquivo local que você tenha direito de utilizar. A extração automática do YouTube exige um serviço separado, permissões e conformidade com os termos aplicáveis.
- **Narração:** o botão de prévia usa as vozes instaladas no navegador via SpeechSynthesis. Isso não gera MP3 e a disponibilidade de vozes pt-BR depende do sistema operacional/navegador. OpenRouter é uma API de modelos de linguagem/visão, não um serviço de TTS.
- **MP4/FFmpeg:** a tela de linha do tempo organiza as cenas, mas não renderiza MP4. Para isso é necessário adicionar e configurar um worker de renderização com FFmpeg, armazenamento de mídia e um serviço TTS que produza arquivos de áudio.
- **Sincronização:** os tempos de WebVTT são estimativas baseadas no tamanho das frases, não sincronização palavra por palavra.
- **Memória:** nesta versão a memória fica no localStorage do navegador e não sincroniza entre dispositivos. Exporte o JSON para backup.

## Segurança e direitos

Use somente vídeos, imagens, áudio e materiais próprios, licenciados ou cujo uso você esteja autorizado a fazer. Alterar metadados não muda autoria nem direitos sobre o conteúdo.

## Próximas integrações para uma versão de produção

1. Backend de projetos e banco persistente por usuário.
2. Worker de ingestão de mídia autorizada e FFmpeg com fila, progresso e cancelamento.
3. Provedor TTS com geração de MP3/WAV e vozes pt-BR.
4. Timeline com tempos reais por cena, trilhas, zoom/pan e transições.
5. Renderização 16:9 e 9:16, com testes automatizados de arquivos exportados.
