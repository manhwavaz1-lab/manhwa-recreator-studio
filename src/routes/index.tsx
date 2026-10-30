import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, FileImage, FileVideo, LoaderCircle, Play, ShieldCheck, Upload, X, Youtube } from "lucide-react";

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
const YOUTUBE_BACKEND_URL = (import.meta.env.VITE_YOUTUBE_BACKEND_URL as string | undefined)?.replace(/\/$/, "");

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
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState("");
  const [backgroundPreview, setBackgroundPreview] = useState("");
  const [renderedUrl, setRenderedUrl] = useState("");
  const [renderedType, setRenderedType] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hideWatermark, setHideWatermark] = useState(false);
  const [markX, setMarkX] = useState(80);
  const [markY, setMarkY] = useState(85);
  const [markW, setMarkW] = useState(15);
  const [markH, setMarkH] = useState(8);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
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
    if (!youtubeUrl.trim() || !backgroundFile) {
      setError("Cole o link de um vídeo público/listado do YouTube e envie a imagem PNG/JPEG.");
      return;
    }
    if (!YOUTUBE_BACKEND_URL) {
      setError("O serviço de download ainda não está configurado. Defina VITE_YOUTUBE_BACKEND_URL no ambiente do app.");
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
      setMessage("Iniciando download do vídeo público/listado do YouTube...");
      const startResponse = await fetch(YOUTUBE_BACKEND_URL + "/api/youtube/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: youtubeUrl.trim() })
      });
      if (!startResponse.ok) {
        const payload = await startResponse.json().catch(() => ({})) as { detail?: string };
        throw new Error(payload.detail || "Falha ao iniciar download do YouTube (HTTP " + startResponse.status + ").");
      }
      const startPayload = await startResponse.json() as { job_id?: string };
      if (!startPayload.job_id) throw new Error("O serviço não retornou o identificador do download.");
      let downloadFinished = false;
      while (!downloadFinished) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 2500));
        const statusResponse = await fetch(YOUTUBE_BACKEND_URL + "/api/youtube/jobs/" + startPayload.job_id);
        if (!statusResponse.ok) throw new Error("Não foi possível consultar o andamento do download.");
        const job = await statusResponse.json() as { status: string; progress: number; message: string };
        setProgress(Math.round((job.progress || 0) * 0.2));
        setMessage(job.message || "Baixando vídeo do YouTube...");
        if (job.status === "error") throw new Error(job.message || "O download do YouTube falhou.");
        downloadFinished = job.status === "completed";
      }
      const downloadResponse = await fetch(YOUTUBE_BACKEND_URL + "/api/youtube/jobs/" + startPayload.job_id + "/file");
      if (!downloadResponse.ok) throw new Error("O download terminou, mas o arquivo MP4 não pôde ser recebido.");
      const downloadedBlob = await downloadResponse.blob();
      if (!downloadedBlob.size) throw new Error("O YouTube não retornou um arquivo de vídeo.");
      const disposition = downloadResponse.headers.get("content-disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
      const downloadedName = filenameMatch?.[1] || "youtube-video.mp4";
      const activeVideoFile = new File([downloadedBlob], downloadedName, { type: downloadedBlob.type || "video/mp4" });
      setVideoFile(activeVideoFile);
      videoUrl = createTrackedUrl(activeVideoFile);
      setVideoPreview(videoUrl);
      setMessage("Download concluído. Iniciando composição e limpeza de metadados...");
      const backgroundUrl = createTrackedUrl(backgroundFile);
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

        if (hideWatermark) {
          const sx = (Math.max(0, Math.min(99, markX)) / 100) * video.videoWidth;
          const sy = (Math.max(0, Math.min(99, markY)) / 100) * video.videoHeight;
          const sw = (Math.max(1, Math.min(100 - markX, markW)) / 100) * video.videoWidth;
          const sh = (Math.max(1, Math.min(100 - markY, markH)) / 100) * video.videoHeight;
          ctx.save();
          ctx.filter = "blur(14px)";
          ctx.drawImage(video, sx, sy, sw, sh, x + sx * videoScale, y + sy * videoScale, sw * videoScale, sh * videoScale);
          ctx.restore();
        }
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
        const nextProgress = 20 + Math.min(79, Math.floor((video.currentTime / video.duration) * 79));
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

      const safeName = ((videoFile?.name || "youtube-video").replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-") || "video") + "-com-moldura.webm";
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
        <span className="oneclick-status"><span/> DOWNLOAD + PROCESSAMENTO</span>
      </header>
      <main className="oneclick-main">
        <div className="oneclick-intro"><span className="oneclick-eyebrow">EDIÇÃO AUTOMÁTICA · UM CLIQUE</span><h1>Seu vídeo, com <em>sua moldura.</em></h1><p>Cole o link de um vídeo público/listado e envie uma imagem PNG/JPEG. O sistema baixa o vídeo no backend, aplica a moldura, permite desfocar sua própria marca-d’água e limpa os metadados descritivos.</p></div>
        <section className="oneclick-grid">
          <div className="oneclick-card">
            <div className="oneclick-card-title"><FileVideo/><div><strong>1. Link do YouTube</strong><small>Vídeo público/listado</small></div></div>
            <button className="oneclick-drop" onClick={() => document.getElementById("youtube-link")?.focus()} disabled={busy}>
              {videoPreview ? <video src={videoPreview} muted playsInline/> : <><Youtube/><strong>Vídeo será baixado do YouTube</strong><small>Cole o link público/listado abaixo</small></>}
            </button>
            <label style={{display:"block",marginTop:12,fontSize:10,color:"#aeb6c4"}}>Link do YouTube</label>
            <input id="youtube-link" value={youtubeUrl} onChange={(event) => { setYoutubeUrl(event.target.value); setRenderedUrl(""); setError(""); }} disabled={busy} type="url" placeholder="https://www.youtube.com/watch?v=..." style={{width:"100%",marginTop:7,padding:"12px",borderRadius:8,border:"1px solid #414958",background:"#0b0d12",color:"#f3f4f6",fontSize:11}}/>
            <p style={{fontSize:9,color:"#818b9a",lineHeight:1.6,marginTop:8}}>Aceita somente vídeos públicos/listados. Vídeos não listados, privados e playlists são recusados. Use somente conteúdo seu ou que você tenha autorização para processar.</p>
            {videoFile && <div className="oneclick-file"><Check size={15}/><span>Último download: {videoFile.name}</span><button onClick={() => { setVideoFile(null); setVideoPreview(""); setRenderedUrl(""); }} aria-label="Limpar vídeo baixado"><X size={15}/></button></div>}
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
        <section className="oneclick-card" style={{ marginTop: 18 }}>
          <div className="oneclick-card-title"><ShieldCheck/><div><strong>3. Ocultar sua marca-d’água</strong><small>Opcional · desfoque somente na área indicada</small></div></div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", margin: "14px 0" }}>
            <input type="checkbox" checked={hideWatermark} onChange={(event) => setHideWatermark(event.target.checked)} disabled={busy}/>
            Ocultar marca-d’água própria neste vídeo
          </label>
          {hideWatermark && <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
            <label>Esquerda (%)<input type="number" min="0" max="99" value={markX} disabled={busy} onChange={(event) => setMarkX(Number(event.target.value))}/></label>
            <label>Topo (%)<input type="number" min="0" max="99" value={markY} disabled={busy} onChange={(event) => setMarkY(Number(event.target.value))}/></label>
            <label>Largura (%)<input type="number" min="1" max="100" value={markW} disabled={busy} onChange={(event) => setMarkW(Number(event.target.value))}/></label>
            <label>Altura (%)<input type="number" min="1" max="100" value={markH} disabled={busy} onChange={(event) => setMarkH(Number(event.target.value))}/></label>
          </div>}
          <p style={{ opacity: .72, fontSize: 12, marginTop: 10 }}>Informe a posição e o tamanho aproximados da sua marca em porcentagem do quadro original. O programa aplica desfoque nessa região; não reconstrói os pixels que estavam atrás do logotipo. Ajuste os valores para cada canal.</p>
        </section>
        <section className="oneclick-preview">
          <div><span className="oneclick-eyebrow">PRÉVIA DA COMPOSIÇÃO</span><p>A imagem enviada ocupa o fundo; o vídeo fica centralizado e dimensionado sem cortar a imagem original.</p></div>
          {videoPreview && backgroundPreview ? <div className="oneclick-composite" style={{backgroundImage: "url(" + backgroundPreview + ")"}}><video src={videoPreview} muted playsInline/></div> : <div className="oneclick-empty"><FileImage/><span>Envie os dois arquivos para visualizar a composição</span></div>}
        </section>
        <button className="oneclick-create" onClick={() => void createVideo()} disabled={busy || !youtubeUrl.trim() || !backgroundFile}>
          {busy ? <><LoaderCircle className="oneclick-spin"/> PROCESSANDO {progress}%</> : <><Play/> CRIAR VÍDEO COM 1 CLIQUE <span>→</span></>}
        </button>
        {busy && <div className="oneclick-progress"><span style={{width: progress + "%"}}/></div>}
        {error && <div className="oneclick-alert error"><X size={17}/>{error}</div>}
        {message && <div className="oneclick-alert success"><Check size={17}/>{message}</div>}
        {renderedUrl && <section className="oneclick-result"><div><span className="oneclick-eyebrow">EXPORTAÇÃO CONCLUÍDA</span><strong>Seu vídeo está pronto</strong><small>{renderedType || "WebM"} · limpeza FFmpeg de metadados descritivos aplicada</small></div><video src={renderedUrl} controls/><a className="oneclick-download" href={renderedUrl} download={(videoFile?.name.replace(/\.[^.]+$/, "") || "video") + "-com-moldura.webm"}><Download size={16}/> Baixar novamente</a></section>}
        <div className="oneclick-notes"><ShieldCheck/><p><strong>Privacidade e processamento:</strong> o link é enviado ao backend configurado, que baixa o vídeo público/listado usando yt-dlp e FFmpeg e devolve o arquivo ao navegador. A composição e a exportação continuam no navegador. A exportação cria um novo arquivo. Após a composição, o FFmpeg remove metadados descritivos do contêiner (título, comentário, descrição, data e capítulos) sem recodificar novamente áudio ou vídeo. Informações técnicas estruturais necessárias à reprodução, como codec, duração e dimensões, continuam existindo. O módulo FFmpeg é carregado sob demanda de um CDN; os arquivos de mídia permanecem no navegador.</p></div>
      </main>
      <footer className="oneclick-footer">MANHWA STUDIO <span>·</span> FUNDO PERSONALIZADO <span>·</span> EXPORTAÇÃO AUTOMÁTICA</footer>
    </div>
  );
}
