import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Check, Download, FileImage, FileVideo, LoaderCircle, Play, ShieldCheck, Upload, X } from "lucide-react";

export const Route = createFileRoute("/")({ component: Studio });

type CoreUsage = { core: number; usage: number };
type GpuInfo = { base: string; gpu: string; gpu_memory: string; driver: string; nvenc_h264: boolean; nvenc_h265: boolean; nvdec: boolean; cpus: number; render_threads: number };

async function detectGpuServer(): Promise<GpuInfo | null> {
  const base = window.location.origin;
  try {
    const res = await fetch(base + "/api/capabilities", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return { base, ...(await res.json() as Omit<GpuInfo, "base">) };
  } catch {
    return null;
  }
}

function Studio() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState("");
  const [backgroundPreview, setBackgroundPreview] = useState("");
  const [backgroundAspectRatio, setBackgroundAspectRatio] = useState("16 / 9");
  const [outputFormat, setOutputFormat] = useState<"16:9" | "9:16">("16:9");
  const [outputResolution, setOutputResolution] = useState<"720p" | "1080p" | "1440p" | "4K">("1080p");
  const [outputFps, setOutputFps] = useState<"original" | "24" | "30" | "50" | "60">("original");
  const [outputCodec, setOutputCodec] = useState<"h264" | "h265">("h264");
  const [encoderMode, setEncoderMode] = useState<"auto" | "nvenc" | "cpu">("auto");
  const [qualityMode, setQualityMode] = useState<"speed" | "balanced" | "quality">("balanced");
  const [renderedUrl, setRenderedUrl] = useState("");
  const [renderedType, setRenderedType] = useState("");
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [videoZoom, setVideoZoom] = useState(100);
  const [cropToFill, setCropToFill] = useState(true);
  const [videoOffsetX, setVideoOffsetX] = useState(0);
  const [videoOffsetY, setVideoOffsetY] = useState(0);
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null);
  const [gpuChecked, setGpuChecked] = useState(false);
  const [coreUsage, setCoreUsage] = useState<CoreUsage[]>([]);
  useEffect(() => {
    let cancelled = false;
    void detectGpuServer().then((info) => { if (!cancelled) { setGpuInfo(info); setGpuChecked(true); } });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!busy || !gpuInfo) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(gpuInfo.base + "/api/system/cores");
        if (response.ok) {
          const data = await response.json() as { cores?: CoreUsage[] };
          if (active) setCoreUsage(data.cores || []);
        }
      } catch { /* keep the latest sample visible if a poll fails */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [busy, gpuInfo]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const backgroundInput = useRef<HTMLInputElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  function createTrackedUrl(file: Blob) {
    const url = URL.createObjectURL(file);
    objectUrls.current.push(url);
    return url;
  }


  async function createVideoOnGpu() {
    if (!gpuInfo) { setError("Servidor GPU não detectado nesta máquina."); return; }
    const base = gpuInfo.base;
    if (!backgroundFile || !videoFile) { setError("Envie o vídeo e a imagem da borda."); return; }
    setBusy(true); setProgress(0); setError(""); setMessage("Enviando arquivos ao servidor GPU...");
    try {
      const form = new FormData();
      form.append("background", backgroundFile);
      form.append("video", videoFile);
      form.append("params", JSON.stringify({
        output_format: outputFormat, resolution: outputResolution, crop_to_fill: cropToFill, zoom: videoZoom,
        offset_x: videoOffsetX, offset_y: videoOffsetY,
        fps: outputFps, codec: outputCodec, encoder: encoderMode, quality: qualityMode
      }));
      const jobId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", base + "/api/render");
        
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) setProgress(Math.floor((e.loaded / e.total) * 20)); };
        xhr.onload = () => {
          try {
            const data = JSON.parse(xhr.responseText) as { job_id?: string; detail?: string };
            if (xhr.status < 300 && data.job_id) resolve(data.job_id); else reject(new Error(data.detail || "Servidor recusou o pedido."));
          } catch { reject(new Error("Resposta inválida do servidor GPU.")); }
        };
        xhr.onerror = () => reject(new Error("Não foi possível conectar ao servidor GPU. Confirme que o backend está rodando na porta 8000 da instância Vast.ai."));
        xhr.send(form);
      });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1000));
        const res = await fetch(base + "/api/render/jobs/" + jobId, { headers: {} });
        if (!res.ok) throw new Error("Não foi possível consultar o andamento da renderização.");
        const job = (await res.json()) as { status: string; progress: number; message: string; engine?: string; elapsed_seconds?: number; eta_seconds?: number; speed?: string };
        setMessage(job.message + (job.speed ? " · " + job.speed : "") + (job.eta_seconds != null ? " · restam ~" + Math.ceil(job.eta_seconds / 60) + " min" : ""));
        if (job.status === "error") throw new Error(job.message);
        setProgress(20 + Math.floor(job.progress * 0.79));
        if (job.status === "completed") {
          setRenderedType("MP4 · " + outputCodec.toUpperCase() + (job.engine ? " · " + job.engine : ""));
          break;
        }
      }
      const res = await fetch(base + "/api/render/" + jobId + "/file", { headers: {} });
      if (!res.ok) throw new Error("Falha ao baixar o vídeo renderizado.");
      const blob = await res.blob();
      const outputUrl = createTrackedUrl(blob);
      setRenderedUrl(outputUrl); setProgress(100);
      const link = document.createElement("a");
      link.href = outputUrl;
      link.download = ((videoFile?.name || "video").replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-") || "video") + "-manhwa-studio.mp4";
      document.body.appendChild(link); link.click(); link.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha na renderização por GPU.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current = [];
  }, []);

  function selectVideo(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      setError("Selecione um arquivo de vídeo válido, como MP4.");
      return;
    }
    setVideoFile(file);
    setVideoPreview(createTrackedUrl(file));
    setRenderedUrl("");
    setMessage("Vídeo carregado. Agora você pode criar a composição.");
    setError("");
  }

  function selectBackground(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setError("A moldura deve ser uma imagem PNG ou JPEG.");
      return;
    }
    setBackgroundFile(file);
    const previewUrl = createTrackedUrl(file);
    setBackgroundPreview(previewUrl);
    const backgroundImage = new Image();
    backgroundImage.onload = () => setBackgroundAspectRatio(backgroundImage.naturalWidth + " / " + backgroundImage.naturalHeight);
    backgroundImage.src = previewUrl;
    setRenderedUrl("");
    setMessage("");
    setError("");
  }

  async function createVideo() {
    if (!videoFile || !backgroundFile) {
      setError("Baixe o vídeo pelo YTDown, selecione o arquivo MP4 e envie a imagem PNG/JPEG.");
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
      const activeVideoFile = videoFile;
      if (!activeVideoFile) throw new Error("Selecione o vídeo MP4 baixado pelo YTDown.");
      videoUrl = createTrackedUrl(activeVideoFile);
      setVideoPreview(videoUrl);
      setMessage("Vídeo carregado. Iniciando composição e limpeza de metadados...");
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

      // Formato e resolução escolhidos definem as dimensões exatas da exportação.
      const isLandscape = outputFormat === "16:9";
      const is4K = outputResolution === "4K";
      const width = isLandscape ? (is4K ? 3840 : 1920) : (is4K ? 2160 : 1080);
      const height = isLandscape ? (is4K ? 2160 : 1080) : (is4K ? 3840 : 1920);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Não foi possível iniciar o renderizador.");

      const draw = () => {
        // Mantém a imagem de fundo inteira; completa com preto sem cortar a moldura.
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, width, height);
        const bgScale = Math.min(width / background.width, height / background.height);
        const bgW = background.width * bgScale;
        const bgH = background.height * bgScale;
        ctx.drawImage(background, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);

        // Preenche a janela central da moldura; corta apenas o excedente
        // nas bordas para evitar barras pretas e vídeo pequeno no centro.
        const safeW = width * 0.84;
        const safeH = height * 0.84;
        const baseScale = cropToFill
          ? Math.max(safeW / video.videoWidth, safeH / video.videoHeight)
          : Math.min(safeW / video.videoWidth, safeH / video.videoHeight);
        const videoScale = baseScale * (videoZoom / 100);
        const videoW = video.videoWidth * videoScale;
        const videoH = video.videoHeight * videoScale;
        const x = (width - videoW) / 2 + (videoOffsetX / 100) * safeW * 0.5;
        const y = (height - videoH) / 2 + (videoOffsetY / 100) * safeH * 0.5;
        ctx.save();
        ctx.beginPath();
        ctx.rect((width - safeW) / 2, (height - safeH) / 2, safeW, safeH);
        ctx.clip();
        ctx.drawImage(video, x, y, videoW, videoH);
        ctx.restore();

      };

      draw();
      // Captura manual: cada quadro do canvas será enviado somente quando
      // o vídeo de origem apresentar um novo quadro decodificado.
      canvasStream = canvas.captureStream(0);
      let canvasVideoTrack = canvasStream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
      // Navegadores sem requestFrame usam a captura automática tradicional a 30 FPS.
      if (!canvasVideoTrack?.requestFrame) {
        canvasStream.getTracks().forEach((track) => track.stop());
        canvasStream = canvas.captureStream(30);
        canvasVideoTrack = canvasStream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
      }
      const requestCanvasFrame = () => canvasVideoTrack?.requestFrame?.();
      requestCanvasFrame();

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
        videoBitsPerSecond: outputResolution === "4K" ? 35_000_000 : 12_000_000,
        ...(sourceStream?.getAudioTracks().length ? { audioBitsPerSecond: 192_000 } : {})
      });
      const chunks: BlobPart[] = [];
      const finished = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error("A gravação foi interrompida pelo navegador."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      });

      let raf = 0;
      let videoFrameCallback = 0;
      let lastProgress = 0;
      const updateProgress = () => {
        const nextProgress = 20 + Math.min(79, Math.floor((video.currentTime / video.duration) * 79));
        if (nextProgress !== lastProgress) {
          lastProgress = nextProgress;
          setProgress(nextProgress);
        }
      };
      const videoWithFrameCallback = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
        cancelVideoFrameCallback?: (handle: number) => void;
      };
      const paintFromDecodedFrame = () => {
        if (video.ended || video.paused) return;
        draw();
        requestCanvasFrame();
        updateProgress();
        if (videoWithFrameCallback.requestVideoFrameCallback) {
          videoFrameCallback = videoWithFrameCallback.requestVideoFrameCallback(paintFromDecodedFrame);
        }
      };
      const paintFallback = () => {
        if (video.ended || video.paused) return;
        draw();
        requestCanvasFrame();
        updateProgress();
        raf = requestAnimationFrame(paintFallback);
      };
      const stopPainting = () => {
        cancelAnimationFrame(raf);
        if (videoFrameCallback && videoWithFrameCallback.cancelVideoFrameCallback) {
          videoWithFrameCallback.cancelVideoFrameCallback(videoFrameCallback);
        }
      };

      recorder.start(1000);
      video.onended = () => { stopPainting(); if (recorder.state !== "inactive") recorder.stop(); };
      await video.play();
      if (videoWithFrameCallback.requestVideoFrameCallback) {
        videoFrameCallback = videoWithFrameCallback.requestVideoFrameCallback(paintFromDecodedFrame);
      } else {
        paintFallback();
      }
      const blob = await finished;
      stopPainting();
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
        <span className="oneclick-status"><span/> UPLOAD LOCAL + RENDERIZAÇÃO GPU AUTOMÁTICA</span>
      </header>
      <main className="oneclick-main">
        <div className="oneclick-intro"><span className="oneclick-eyebrow">EDIÇÃO AUTOMÁTICA · UM CLIQUE</span><h1>Seu vídeo, com <em>sua moldura.</em></h1><p>Envie o vídeo e a imagem da borda pelo computador. Clique uma vez: o computador virtual recebe os arquivos, usa a GPU para renderizar e devolve o MP4 pronto.</p></div>
        <section className="oneclick-card" style={{ marginTop: 18 }}>
          <div className="oneclick-card-title"><ShieldCheck/><div><strong>COMPUTADOR GPU CONECTADO</strong><small>Conexão automática. Sem endereço ou chave para preencher.</small></div></div>
          <p className="output-dimensions">{!gpuChecked ? "Conectando automaticamente à GPU..." : gpuInfo ? "Conectado: " + (gpuInfo.gpu || "servidor GPU") + " · " + (gpuInfo.gpu_memory || "") + " · NVENC " + (gpuInfo.nvenc_h264 ? "pronto" : "indisponível") : "Servidor GPU indisponível. Abra o site pelo endereço da instância de computação."}</p>
        </section>
        <section className="oneclick-card" style={{ marginTop: 18 }}>
          <div className="oneclick-card-title"><FileVideo/><div><strong>FORMATO E RESOLUÇÃO DE SAÍDA</strong><small>Escolha o enquadramento e a qualidade do arquivo final</small></div></div>
          <div className="output-settings-grid">
            <label>Formato
              <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as "16:9" | "9:16")} disabled={busy}>
                <option value="16:9">Horizontal · 16:9 (YouTube)</option>
                <option value="9:16">Vertical · 9:16 (Shorts / Reels / TikTok)</option>
              </select>
            </label>
            <label>Resolução
              <select value={outputResolution} onChange={(event) => setOutputResolution(event.target.value as "1080p" | "4K")} disabled={busy}>
                <option value="720p">HD · 720p</option>
                <option value="1080p">Full HD · 1080p</option>
                <option value="1440p">QHD · 1440p</option>
                <option value="4K">Ultra HD · 4K</option>
              </select>
            </label>
          </div>
          <div className="output-settings-grid" style={{ marginTop: 12 }}>
            <label>Motor de codificação
              <select value={encoderMode} onChange={(event) => setEncoderMode(event.target.value as "auto" | "nvenc" | "cpu")} disabled={busy}>
                <option value="auto">Automático · GPU com fallback CPU</option>
                <option value="nvenc" disabled={!gpuInfo?.nvenc_h264 && !gpuInfo?.nvenc_h265}>NVIDIA NVENC</option>
                <option value="cpu">CPU</option>
              </select>
            </label>
            <label>Codec
              <select value={outputCodec} onChange={(event) => setOutputCodec(event.target.value as "h264" | "h265")} disabled={busy}>
                <option value="h264">H.264 · maior compatibilidade</option>
                <option value="h265">H.265 / HEVC · arquivo menor</option>
              </select>
            </label>
          </div>
          <div className="output-settings-grid" style={{ marginTop: 12 }}>
            <label>FPS
              <select value={outputFps} onChange={(event) => setOutputFps(event.target.value as typeof outputFps)} disabled={busy}>
                <option value="original">Manter original</option>
                <option value="24">24 FPS</option><option value="30">30 FPS</option><option value="50">50 FPS</option><option value="60">60 FPS</option>
              </select>
            </label>
            <label>Perfil
              <select value={qualityMode} onChange={(event) => setQualityMode(event.target.value as typeof qualityMode)} disabled={busy}>
                <option value="speed">Velocidade máxima</option><option value="balanced">Equilibrado</option><option value="quality">Qualidade máxima</option>
              </select>
            </label>
          </div>
          <p className="output-dimensions">{!gpuChecked ? "Conectando ao servidor de renderização..." : gpuInfo ? "Servidor: " + (gpuInfo.gpu || "CPU") + (gpuInfo.gpu_memory ? " · " + gpuInfo.gpu_memory : "") + " · NVENC H.264 " + (gpuInfo.nvenc_h264 ? "disponível" : "indisponível") + " · NVENC H.265 " + (gpuInfo.nvenc_h265 ? "disponível" : "indisponível") + " · NVDEC " + (gpuInfo.nvdec ? "disponível" : "indisponível") + " · " + gpuInfo.cpus + " CPUs" : "Servidor GPU indisponível. Abra o site pelo endereço da instância Vast.ai."}</p>
          <p className="output-dimensions">Saída: {outputFormat} · {outputResolution} · {"MP4 " + outputCodec.toUpperCase() + " · GPU remota"}</p>
        </section>
        <section className="oneclick-grid">
          <div className="oneclick-card">
            <div className="oneclick-card-title"><FileVideo/><div><strong>1. Enviar vídeo</strong><small>Selecione o arquivo no seu computador</small></div></div>
            <button className="oneclick-drop" onClick={() => videoInput.current?.click()} disabled={busy}>
              {videoPreview ? <video src={videoPreview} muted playsInline/> : <><Upload/><strong>Selecionar vídeo</strong><small>MP4, MOV, MKV ou WebM</small></>}
            </button>
            <input ref={videoInput} type="file" accept="video/*,.mp4,.webm,.mov,.mkv,.m4v" hidden onChange={(event) => selectVideo(event.target.files?.[0])}/>
            {videoFile && <div className="oneclick-file"><Check size={15}/><span>Vídeo selecionado: {videoFile.name}</span><button onClick={() => { setVideoFile(null); setVideoPreview(""); setRenderedUrl(""); }} aria-label="Remover vídeo selecionado"><X size={15}/></button></div>}
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
        <section className="oneclick-card" style={{ marginTop: 16 }}>
          <div className="oneclick-card-title"><FileVideo/><div><strong>RECORTAR VÍDEO PARA A MOLDURA</strong><small>Escolha como preencher a janela e ajuste a área visível</small></div></div>
          <div className="crop-mode-controls">
            <button type="button" className={cropToFill ? "active" : ""} disabled={busy} onClick={() => setCropToFill(true)}>RECORTAR PARA PREENCHER</button>
            <button type="button" className={!cropToFill ? "active" : ""} disabled={busy} onClick={() => setCropToFill(false)}>MOSTRAR VÍDEO INTEIRO</button>
          </div>
          <div className="framing-controls">
            <label>Zoom do recorte <strong>{videoZoom}%</strong><input aria-label="Zoom do recorte" type="range" min="50" max="250" step="1" value={videoZoom} disabled={busy} onChange={(event) => setVideoZoom(Number(event.target.value))}/></label>
            <label>Posição horizontal <strong>{videoOffsetX > 0 ? "+" : ""}{videoOffsetX}</strong><input aria-label="Posição horizontal do vídeo" type="range" min="-50" max="50" step="1" value={videoOffsetX} disabled={busy} onChange={(event) => setVideoOffsetX(Number(event.target.value))}/></label>
            <label>Posição vertical <strong>{videoOffsetY > 0 ? "+" : ""}{videoOffsetY}</strong><input aria-label="Posição vertical do vídeo" type="range" min="-50" max="50" step="1" value={videoOffsetY} disabled={busy} onChange={(event) => setVideoOffsetY(Number(event.target.value))}/></label>
            <button type="button" className="outline-button" disabled={busy} onClick={() => { setVideoZoom(100); setVideoOffsetX(0); setVideoOffsetY(0); setCropToFill(true); }}>REDEFINIR</button>
          </div>
        </section>
        <section className="oneclick-preview">
          <div><span className="oneclick-eyebrow">PRÉVIA DA COMPOSIÇÃO</span><p>A área dentro da janela é o recorte final. Arraste os controles de zoom e posição para escolher exatamente o trecho que ficará visível. O mesmo recorte será usado na exportação em {outputFormat} e {outputResolution}. A imagem de fundo aparece inteira, sem cortes.</p></div>
          {videoPreview && backgroundPreview ? <div className="oneclick-composite" style={{backgroundImage: "url(" + backgroundPreview + ")", aspectRatio: outputFormat === "16:9" ? "16 / 9" : "9 / 16", backgroundSize: "contain", backgroundColor: "#000"}}><video src={videoPreview} muted playsInline style={{ objectFit: cropToFill ? "cover" : "contain", transform: "translate(" + videoOffsetX + "%, " + videoOffsetY + "%) scale(" + (videoZoom / 100) + ")" }}/></div> : <div className="oneclick-empty"><FileImage/><span>Envie os dois arquivos para visualizar a composição</span></div>}
        </section>
        <button className="oneclick-create" onClick={() => void createVideoOnGpu()} disabled={busy || !gpuInfo || !backgroundFile || !videoFile}>
          {busy ? <><LoaderCircle className="oneclick-spin"/> PROCESSANDO {progress}%</> : <><Play/> CRIAR VÍDEO COM 1 CLIQUE <span>→</span></>}
        </button>
        {busy && <>
          <div className="oneclick-progress"><span style={{width: progress + "%"}}/></div>
          <section className="oneclick-card" style={{ marginTop: 14 }}>
            <div className="oneclick-card-title"><ShieldCheck/><div><strong>MONITOR DE CPU · TEMPO REAL</strong><small>{coreUsage.length} núcleos lógicos detectados · atualização a cada 1,5 s</small></div></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(82px, 1fr))", gap: 8 }}>
              {coreUsage.map((core) => <div key={core.core} style={{ background: "#11151b", border: "1px solid #29313c", borderRadius: 8, padding: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aab4c2" }}><span>CORE {core.core}</span><strong style={{ color: core.usage >= 85 ? "#fb7185" : "#67e8a5" }}>{Math.round(core.usage)}%</strong></div>
                <div style={{ height: 5, background: "#29313c", borderRadius: 8, marginTop: 7, overflow: "hidden" }}><div style={{ width: core.usage + "%", height: "100%", background: core.usage >= 85 ? "#fb7185" : "#22c55e", transition: "width .4s" }}/></div>
              </div>)}
            </div>
            <p className="output-dimensions">Meta de desempenho: 15x em relação ao tempo real. A velocidade efetiva será medida durante a renderização; o uso de todos os núcleos não garante 15x.</p>
          </section>
        </>}
        {error && <div className="oneclick-alert error"><X size={17}/>{error}</div>}
        {message && <div className="oneclick-alert success"><Check size={17}/>{message}</div>}
        {renderedUrl && <section className="oneclick-result"><div><span className="oneclick-eyebrow">EXPORTAÇÃO CONCLUÍDA</span><strong>Seu vídeo está pronto</strong><small>{renderedType || "WebM"} · exportação processada</small></div><video src={renderedUrl} controls/><a className="oneclick-download" href={renderedUrl} download={(videoFile?.name.replace(/\.[^.]+$/, "") || "video") + (renderedType.startsWith("MP4") ? "-manhwa-studio.mp4" : "-com-moldura.webm")}><Download size={16}/> Baixar novamente</a></section>}
        <div className="oneclick-notes"><ShieldCheck/><p><strong>Privacidade e processamento:</strong> O vídeo e a moldura são enviados ao computador virtual pela mesma página. O FFmpeg faz a composição e a renderização usando a GPU quando disponível. O MP4 final é devolvido pelo site para visualização e download; metadados globais, de faixas e capítulos são removidos na exportação.</p></div>
      </main>
      <footer className="oneclick-footer">MANHWA STUDIO <span>·</span> FUNDO PERSONALIZADO <span>·</span> EXPORTAÇÃO AUTOMÁTICA</footer>
    </div>
  );
}
