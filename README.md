# Manhwa Recreator Studio Pro — V4.1

Aplicação web para produção de recaps de Manhwa, com análise visual, roteiro original e memória narrativa entre episódios. Interface em português, tema escuro com vermelho e compatibilidade com Lovable.

## Funcionalidades

- Interface responsiva de estúdio e nome de projeto.
- Importação por seleção ou arrastar/soltar de vídeos e imagens; vídeos são amostrados em até 8 quadros e imagens verticais longas são divididas automaticamente em segmentos.
- Catálogo dinâmico de modelos OpenRouter, com metadados de modalidades, contexto e parâmetros suportados.
- Análise visual por modelos com entrada de imagem.
- Geração de sinopse, personagens, cenas, movimentos de câmera, roteiro e notas de continuidade.
- Memória narrativa local (personagens, episódios e lore).\n- Salvamento e restauração do projeto ativo no IndexedDB, incluindo imagens, roteiro e configurações.
- Exportação de projeto JSON e legendas WebVTT.
- Proxy OpenRouter em rota de servidor nativa do TanStack Start (`/api/openrouter`), executada no backend do app publicado pelo Lovable.
- Geração de narração MP3 pelo endpoint TTS OpenRouter, com descoberta de modelos de áudio no catálogo.\n- Renderizador real no navegador: compõe quadros, movimento suave, títulos e legendas; sincroniza MP3 TTS quando anexado e exporta MP4 se o navegador suportar o codec, ou WebM como alternativa.

## Configuração no Lovable

1. Sincronize o projeto com este repositório no Lovable.
2. Publique/republique o aplicativo para que a rota de servidor `/api/openrouter` seja implantada junto com o app.
3. No aplicativo, informe sua chave criada em https://openrouter.ai/keys e clique em **Atualizar modelos**.
4. Para análise de quadros, selecione um modelo cuja arquitetura informe entrada `image`.

A integração OpenRouter não depende de `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` nem de uma Edge Function Supabase. A rota `/api/openrouter` faz a chamada no servidor TanStack Start do próprio aplicativo Lovable.

A chave OpenRouter é mantida somente em memória durante a sessão do navegador e enviada ao proxy por HTTPS para a chamada correspondente. Ela não é gravada no localStorage, no repositório, nem em uma variável pública. Ao recarregar a página, informe-a novamente. O proxy não armazena a chave; ele a encaminha para OpenRouter.

A rota do servidor aceita somente endpoints OpenRouter explicitamente permitidos: `/models`, `/chat/completions`, `/images`, `/audio/speech`, `/audio/transcriptions`, `/embeddings` e `/videos`. Para transcrição, o cliente envia o áudio em base64 e a rota de servidor converte para multipart/form-data. Para TTS, a resposta binária é devolvida como Blob.

## Desenvolvimento local

Requer Node.js compatível com Vite 8.

```sh
npm install
npm run dev
npm run lint
npm test
npm run build
```

A rota de proxy é servida pelo próprio `npm run dev` e pelo servidor implantado com `npm run build`.

## Limitações conhecidas

- **Modelos e modalidades:** a disponibilidade depende do catálogo OpenRouter e do modelo/provedor. A existência de um endpoint não significa que todo modelo o suporte. O gateway de modalidades está disponível no serviço; a interface atual usa chat/visão para análise e já inclui controle de geração de narração MP3 por TTS. Geração de imagem, transcrição e embeddings ainda não têm fluxos dedicados na interface. A geração de vídeo final é feita pelo renderizador Canvas/MediaRecorder do navegador.
- **YouTube:** a URL é registrada como referência; o aplicativo não baixa vídeos do YouTube. Importe mídia local que você tenha direito de utilizar.
- **Narração:** a prévia usa SpeechSynthesis do navegador. A geração de MP3 usa o endpoint TTS do OpenRouter e exige informar um ID de modelo TTS compatível e uma voz aceita por esse modelo.
- **Formato de vídeo:** a renderização atual usa Canvas + MediaRecorder no navegador. Chrome/Edge normalmente exportam WebM; MP4 só é gerado se o navegador oferecer gravação nativa nesse formato. Ainda não existe conversão FFmpeg para garantir MP4 H.264 em todos os navegadores.
- **Memória narrativa:** salva no localStorage do navegador. O projeto ativo (roteiro, quadros e configurações) é salvo no IndexedDB. Ambos são locais ao dispositivo e não sincronizam entre dispositivos.
- **Legendas:** WebVTT usa tempos estimados por frase, não alinhamento palavra a palavra.

## Segurança e direitos

Use apenas mídia própria, licenciada ou cujo uso esteja autorizado. A rota proxy não guarda a chave OpenRouter; mantenha o controle de custos e limites da sua conta OpenRouter.
