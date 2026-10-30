# Manhwa Recreator Studio Pro — V4.1

Aplicação web para produção de recaps de Manhwa, com análise visual, roteiro original e memória narrativa entre episódios. Interface em português, tema escuro com vermelho e compatibilidade com Lovable.

## Funcionalidades

- Interface responsiva de estúdio e nome de projeto.
- Importação local de vídeo para extração de quadros no navegador ou até 8 imagens.
- Catálogo dinâmico de modelos OpenRouter, com metadados de modalidades, contexto e parâmetros suportados.
- Análise visual por modelos com entrada de imagem.
- Geração de sinopse, personagens, cenas, movimentos de câmera, roteiro e notas de continuidade.
- Memória narrativa local (personagens, episódios e lore).
- Exportação de projeto JSON e legendas WebVTT.
- Proxy OpenRouter em Supabase Edge Function, compatível com Lovable Cloud.
- Gateway backend para chat/visão, geração de imagens, TTS, transcrição, embeddings e vídeo, respeitando os endpoints específicos de cada modalidade.

## Configuração no Lovable

1. Abra o projeto no Lovable e conecte/ative **Lovable Cloud** (ou o projeto Supabase conectado).
2. Confirme que o ambiente de build fornece `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` (ou `VITE_SUPABASE_ANON_KEY`). São valores públicos de conexão, não segredos.
3. Sincronize este commit do GitHub no Lovable. A função `supabase/functions/openrouter-proxy/index.ts` deve ser publicada como Edge Function `openrouter-proxy`.
4. Em Configurações do aplicativo, informe sua chave criada em https://openrouter.ai/keys e clique em **Atualizar modelos**.
5. Para análise de quadros, selecione um modelo cuja arquitetura informe entrada `image`.

A chave OpenRouter é mantida somente em memória durante a sessão do navegador e enviada ao proxy por HTTPS para a chamada correspondente. Ela não é gravada no localStorage, no repositório, nem em uma variável pública. Ao recarregar a página, informe-a novamente. O proxy não armazena a chave; ele a encaminha para OpenRouter.

A função aceita somente endpoints OpenRouter explicitamente permitidos: `/models`, `/chat/completions`, `/images`, `/audio/speech`, `/audio/transcriptions`, `/embeddings` e `/videos`. Para transcrição, o cliente envia o áudio em base64 e a Edge Function converte para multipart/form-data. Para TTS, a resposta binária é devolvida como Blob.

## Desenvolvimento local

Requer Node.js compatível com Vite 8.

```sh
npm install
npm run dev
npm run lint
npm test
npm run build
```

Para executar localmente o proxy, conecte o Supabase CLI ao mesmo projeto e publique/execute a função com a configuração de `supabase/config.toml`.

## Limitações conhecidas

- **Modelos e modalidades:** a disponibilidade depende do catálogo OpenRouter e do modelo/provedor. A existência de um endpoint não significa que todo modelo o suporte. O gateway de modalidades está disponível no serviço; a interface atual usa chat/visão para análise e já inclui controle de geração de narração MP3 por TTS. Geração de imagem, transcrição, embeddings e vídeo estão disponíveis no gateway de serviço, mas ainda precisam de controles dedicados nas telas correspondentes.
- **YouTube:** a URL é registrada como referência; o aplicativo não baixa vídeos do YouTube. Importe mídia local que você tenha direito de utilizar.
- **Narração:** a prévia usa SpeechSynthesis do navegador. A geração de MP3 usa o endpoint TTS do OpenRouter e exige informar um ID de modelo TTS compatível e uma voz aceita por esse modelo.
- **MP4/FFmpeg:** a linha do tempo organiza cenas, mas não renderiza MP4. Isso exige worker de renderização, fila e armazenamento de mídia.
- **Memória:** continua salva no localStorage do navegador e não sincroniza entre dispositivos.
- **Legendas:** WebVTT usa tempos estimados por frase, não alinhamento palavra a palavra.

## Segurança e direitos

Use apenas mídia própria, licenciada ou cujo uso esteja autorizado. A função proxy não guarda a chave OpenRouter; mantenha o controle de custos e limites da sua conta OpenRouter.
