import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, FileImage, FileVideo, LoaderCircle, Play, ShieldCheck, Upload, X } from "lucide-react";

export const Route = createFileRoute("/")({ component: Studio });

type FfmpegInstance = {
  load: () => Promise<void>;
  FS: (operation: "writeFile" | "readFile" | "unlink", ...args: (string | Uint8Array)[]) => Uint8Array | void;
  run: (...args: string[]) => Promise<void>;
};

declare global {
  interface Window {
    FFmpeg?: { createFFmpeg: (options: { log: boolean; corePath: string }) => FfmpegInstance };
  }
}

let ffmpegLoader: Promise<FfmpegInstance> | null = null;

async function getFfmpeg() {
  if (!ffmpegLoader) {
    ffmpegLoader = (async () => {
      if (!window.FFmpeg) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Não foi possível baixar o módulo FFmpeg. Verifique sua conexão e tente novamente."));
          document.head.appendChild(script);
        });
      }
      if (!window.FFmpeg) throw new Error("O módulo FFmpeg não ficou disponível no navegador.");
      const ffmpeg = window.FFmpeg.createFFmpeg({
        log: false,
        corePath: "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js"
      });
      await ffmpeg.load();
      return ffmpeg;
    })().catch((error) => {
      ffmpegLoader = null;
      throw error;
    });
  }
  return ffmpegLoader;
}

async function cleanContainerMetadata(source: Blob) {
  const ffmpeg = await getFfmpeg();
  const input = "manhwa-input.webm";
  const output = "manhwa-clean.webm";
  ffmpeg.FS("writeFile", input, new Uint8Array(await source.arrayBuffer()));
  await ffmpeg.run(
    "-i", input,
    "-map", "0",
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    "-c", "copy",
    "-fflags", "+bitexact",
    "-metadata", "encoder=",
    "-metadata", "title=",
    "-metadata", "comment=",
    "-metadata", "description=",
    "-metadata", "creation_time=",
    output
  );
  const result = ffmpeg.FS("readFile", output) as Uint8Array;
  ffmpeg.FS("unlink", input);
  ffmpeg.FS("unlink", output);
  return new Blob([result], { type: "video/webm" });
}

function Studio() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState("");
  const [backgroundPreview, setBackgroundPreview] = useState("");
  const [renderedUrl, setRenderedUrl] = useState("");
  const [renderedType, setRenderedType] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const videoInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  function createTrackedUrl(file: Blob) {
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    return url;
  }

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current = [];
  }, []);

  function selectVideo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("video/")) { setError("Selecione um arquivo de vídeo."); return; }
    setVideoFile(file);
    setVideoPreview(createTrackedUrl(file));
    setRenderedUrl("");
    setMessage("");
    setError("");
  }

  function selectBackground(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setError("A moldura deve ser uma imagem PNG ou JPEG.");
      return;
    }
    setBackgroundFile(file);
    setBackgroundPreview(createTrackedUrl(file));
    setRenderedUrl("");
    setMessage("");
    setError("");
  }

  async function createVideo() {
    if (!videoFile || !backgroundFile) {
      setError("Envie o vídeo e a imagem PNG/JPEG que será usada como fundo e moldura.");
      return;
    }
    if (!("MediaRecorder" in window) || !HTMLCanvasElement.prototype.captureStream) {
      setError("Seu navegador não oferece a gravação necessária. Use a versão atual do Chrome ou Edge.");
      return;
    }

    setBusy(true);
    setProgress(0);
    setError("");
    setMessage("");
    let sourceStream: MediaStream | null = null;
    let canvasStream: MediaStream | null = null;
    let videoUrl = "";
    try {
      const backgroundUrl = createTrackedUrl(backgroundFile);
      videoUrl = createTrackedUrl(videoFile);
      const background = new Image();
      background.src = backgroundUrl;
      await new Promise<void>((resolve, reject) => {
        background.onload = () => resolve();
        background.onerror = () => reject(new Error("Não foi possível abrir a imagem de fundo."));
      });

      const video = document.createElement("video");
      video.preload = "auto";
      video.playsInline = true;
      video.src = videoUrl;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("O navegador não conseguiu decodificar este vídeo. Tente MP4 H.264 ou WebM."));
      });
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
        throw new Error("O vídeo não possui duração ou dimensões válidas.");
      }

      const sourceRatio = video.videoWidth / video.videoHeight;
      const width = sourceRatio >= 1 ? 1920 : Math.max(1, Math.round(1920 * sourceRatio));
      const height = sourceRatio >= 1 ? Math.max(1, Math.round(1920 / sourceRatio)) : 1920;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Não foi possível iniciar o renderizador.");

      const draw = () => {
        const bgScale = Math.max(width / background.width, height / background.height);
        const bgW = background.width * bgScale;
        const bgH = background.height * bgScale;
        ctx.drawImage(background, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);

        const safeW = width * 0.84;
        const safeH = height * 0.84;
        const videoScale = Math.min(safeW / video.videoWidth, safeH / video.videoHeight);
        const videoW = video.videoWidth * videoScale;
        const videoH = video.videoHeight * videoScale;
        const x = (width - videoW) / 2;
        const y = (height - videoH) / 2;
        ctx.drawImage(video, x, y, videoW, videoH);
      };

      draw();
      canvasStream = canvas.captureStream(30);
      const capture = video as HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
      const captureAudio = capture.captureStream || capture.mozCaptureStream;
      if (captureAudio) {
        sourceStream = captureAudio.call(video);
        sourceStream.getAudioTracks().forEach((track) => canvasStream?.addTrack(track));
      }

      const candidates = sourceStream?.getAudioTracks().length
        ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"]
        : ["video/webm;codecs=vp9", "video/webm;codecs=vp8"];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Este navegador não oferece um formato WebM compatível para exportação.");

      const recorder = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 12_000_000,
        ...(sourceStream?.getAudioTracks().length ? { audioBitsPerSecond: 192_000 } : {})
      });
      const chunks: BlobPart[] = [];
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error("A gravação foi interrompida pelo navegador."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      });

      let raf = 0;
      let lastProgress = 0;
      const paint = () => {
        draw();
        const nextProgress = Math.min(99, Math.floor((video.currentTime / video.duration) * 100));
        if (nextProgress !== lastProgress) {
          lastProgress = nextProgress;
          setProgress(nextProgress);
        }
        if (!video.ended && !video.paused) raf = requestAnimationFrame(paint);
      };
      recorder.start(1000);
      video.onended = () => { cancelAnimationFrame(raf); if (recorder.state !== "inactive") recorder.stop(); };
      await video.play();
      paint();
      const blob = await finished;
      cancelAnimationFrame(raf);
      if (!blob.size) throw new Error("O arquivo exportado ficou vazio. Tente novamente.");
      const outputUrl = createTrackedUrl(blob);
      setRenderedUrl(outputUrl);
      setRenderedType(blob.type);
      setProgress(100);

      const safeName = (videoFile.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-") || "video") + "-com-moldura.webm";
      const link = document.createElement("a");
      link.href = outputUrl;
      link.download = safeName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setMessage("Vídeo criado. O FFmpeg removeu os metadados descritivos do contêiner; os dados técnicos necessários para reprodução permanecem.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar o vídeo.");
    } finally {
      sourceStream?.getTracks().forEach((track) => track.stop());
      canvasStream?.getTracks().forEach((track) => track.stop());
      setBusy(false);
    }
  }

  return (
    <div className="oneclick-shell">
      <header className="oneclick-header">
        <div className="oneclick-brand"><span className="oneclick-mark">M</span><div><strong>MANHWA STUDIO</strong><small>VIDEO FRAME CREATOR</small></div></div>
        <span className="oneclick-status"><span/> PROCESSAMENTO LOCAL</span>
      </header>
      <main className="oneclick-main">
        <div className="oneclick-intro"><span className="oneclick-eyebrow">EDIÇÃO AUTOMÁTICA · UM CLIQUE</span><h1>Seu vídeo, com <em>sua moldura.</em></h1><p>Envie o vídeo e uma imagem PNG ou JPEG. O programa aplica a imagem como fundo ao redor do vídeo e exporta automaticamente, sem roteiro, IA, cortes ou efeitos no conteúdo.</p></div>
        <section className="oneclick-grid">
          <div className="oneclick-card">
            <div className="oneclick-card-title"><FileVideo/><div><strong>1. Vídeo original</strong><small>Selecione o arquivo completo</small></div></div>
            <button className="oneclick-drop" onClick={() => videoInput.current?.click()} disabled={busy}>
              {videoPreview ? <video src={videoPreview} muted playsInline/> : <><Upload/><strong>Escolher vídeo</strong><small>MP4, MOV ou WebM</small></>}
            </button>
            <input ref={videoInput} type="file" accept="video/*" hidden onChange={(event) => selectVideo(event.target.files?.[0])}/>
            {videoFile && <div className="oneclick-file"><Check size={15}/><span>{videoFile.name}</span><button onClick={() => { setVideoFile(null); setVideoPreview(""); setRenderedUrl(""); }} aria-label="Remover vídeo"><X size={15}/></button></div>}
          </div>
          <div className="oneclick-card">
            <div className="oneclick-card-title"><FileImage/><div><strong>2. Fundo / moldura</strong><small>PNG ou JPEG que ficará ao redor</small></div></div>
            <button className="oneclick-drop" onClick={() => backgroundInput.current?.click()} disabled={busy}>
              {backgroundPreview ? <img src={backgroundPreview} alt="Prévia do fundo"/> : <><Upload/><strong>Escolher imagem</strong><small>PNG ou JPEG · recomendado na proporção do vídeo</small></>}
            </button>
            <input ref={backgroundInput} type="file" accept="image/png,image/jpeg" hidden onChange={(event) => selectBackground(event.target.files?.[0])}/>
            {backgroundFile && <div className="oneclick-file"><Check size={15}/><span>{backgroundFile.name}</span><button onClick={() => { setBackgroundFile(null); setBackgroundPreview(""); setRenderedUrl(""); }} aria-label="Remover imagem"><X size={15}/></button></div>}
          </div>
        </section>
        <section className="oneclick-preview">
          <div><span className="oneclick-eyebrow">PRÉVIA DA COMPOSIÇÃO</span><p>A imagem enviada ocupa o fundo; o vídeo fica centralizado e dimensionado sem cortar a imagem original.</p></div>
          {videoPreview && backgroundPreview ? <div className="oneclick-composite" style={{backgroundImage: "url(" + backgroundPreview + ")"}}><video src={videoPreview} muted playsInline/></div> : <div className="oneclick-empty"><FileImage/><span>Envie os dois arquivos para visualizar a composição</span></div>}
        </section>
        <button className="oneclick-create" onClick={() => void createVideo()} disabled={busy || !videoFile || !backgroundFile}>
          {busy ? <><LoaderCircle className="oneclick-spin"/> PROCESSANDO {progress}%</> : <><Play/> CRIAR VÍDEO COM 1 CLIQUE <span>→</span></>}
        </button>
        {busy && <div className="oneclick-progress"><span style={{width: progress + "%"}}/></div>}
        {error && <div className="oneclick-alert error"><X size={17}/>{error}</div>}
        {message && <div className="oneclick-alert success"><Check size={17}/>{message}</div>}
        {renderedUrl && <section className="oneclick-result"><div><span className="oneclick-eyebrow">EXPORTAÇÃO CONCLUÍDA</span><strong>Seu vídeo está pronto</strong><small>{renderedType || "WebM"} · limpeza FFmpeg de metadados descritivos aplicada</small></div><video src={renderedUrl} controls/><a className="oneclick-download" href={renderedUrl} download={(videoFile?.name.replace(/\.[^.]+$/, "") || "video") + "-com-moldura.webm"}><Download size={16}/> Baixar novamente</a></section>}
        <div className="oneclick-notes"><ShieldCheck/><p><strong>Privacidade e processamento:</strong> os arquivos são processados no navegador e não são enviados a um servidor. A exportação cria um novo arquivo. Após a composição, o FFmpeg remove metadados descritivos do contêiner (título, comentário, descrição, data e capítulos) sem recodificar novamente áudio ou vídeo. Informações técnicas estruturais necessárias à reprodução, como codec, duração e dimensões, continuam existindo. O módulo FFmpeg é carregado sob demanda de um CDN; os arquivos de mídia permanecem no navegador.</p></div>
      </main>
      <footer className="oneclick-footer">MANHWA STUDIO <span>·</span> FUNDO PERSONALIZADO <span>·</span> EXPORTAÇÃO AUTOMÁTICA</footer>
    </div>
  );
}
