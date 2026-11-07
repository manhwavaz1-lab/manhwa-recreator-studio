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

type RenderChunkRecord = { id: string; sessionId: string; sequence: number; blob: Blob };
type RenderSessionRecord = { id: string; createdAt: number; fileName: string; status: "running" | "complete" };

function openRenderStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("manhwa-studio-render-cache", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("chunks")) {
        const store = db.createObjectStore("chunks", { keyPath: "id" });
        store.createIndex("sessionId", "sessionId", { unique: false });
      }
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Não foi possível abrir o armazenamento local."));
  });
}

async function saveRenderSession(session: RenderSessionRecord) {
  const db = await openRenderStore();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction("sessions", "readwrite").objectStore("sessions").put(session);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function saveRenderChunk(record: RenderChunkRecord) {
  const db = await openRenderStore();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction("chunks", "readwrite").objectStore("chunks").put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}

async function loadRenderChunks(sessionId: string): Promise<Blob[]> {
  const db = await openRenderStore();
  const records = await new Promise<RenderChunkRecord[]>((resolve, reject) => {
    const request = db.transaction("chunks", "readonly").objectStore("chunks").index("sessionId").getAll(IDBKeyRange.only(sessionId));
    request.onsuccess = () => resolve(request.result as RenderChunkRecord[]);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return records.sort((a, b) => a.sequence - b.sequence).map((record) => record.blob);
}


async function deleteRenderSession(sessionId: string) {
  const db = await openRenderStore();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["chunks", "sessions"], "readwrite");
    const index = tx.objectStore("chunks").index("sessionId");
    const request = index.openKeyCursor(IDBKeyRange.only(sessionId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) { tx.objectStore("chunks").delete(cursor.primaryKey); cursor.continue(); }
      else tx.objectStore("sessions").delete(sessionId);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

function formatMinutes(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "calculando...";
  const totalMinutes = Math.max(0, Math.ceil(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}min` : `${minutes} min`;
}
const YOUTUBE_BACKEND_URL = ((import.meta.env["VITE_YOUTUBE_BACKEND_URL"] as string | undefined) || "https://manhwa-studio-youtube-api.onrender.com").replace(/\/$/, "");

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
  return new Blob([new Uint8Array(result)], { type: "video/webm" });
}

function Studio() {
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState("");
  const [backgroundPreview, setBackgroundPreview] = useState("");
  const [backgroundAspectRatio, setBackgroundAspectRatio] = useState("16 / 9");
  const [outputFormat, setOutputFormat] = useState<"16:9" | "9:16">("16:9");
  const [outputResolution, setOutputResolution] = useState<"1080p" | "4K">("1080p");
  const [renderedUrl, setRenderedUrl] = useState("");
  const [renderedType, setRenderedType] = useState("");
  const [progress, setProgress] = useState(0);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [renderSpeed, setRenderSpeed] = useState<number | null>(null);
  const [storageWarning, setStorageWarning] = useState("");

  const [busy, setBusy] = useState(false);
  const renderStartedAt = useRef<number | null>(null);
  const lastEstimateUpdate = useRef(0);
  const [hideWatermark, setHideWatermark] = useState(false);
  const [markX, setMarkX] = useState(80);
  const [markY, setMarkY] = useState(85);
  const [markW, setMarkW] = useState(15);
  const [markH, setMarkH] = useState(8);
  const [videoZoom, setVideoZoom] = useState(93);
  const [cropToFill, setCropToFill] = useState(true);
  const [videoOffsetX, setVideoOffsetX] = useState(0);
  const [videoOffsetY, setVideoOffsetY] = useState(7);
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
    setVideoDurationSeconds(null);
    setRemainingSeconds(null);
    const metadataVideo = document.createElement("video");
    const metadataUrl = URL.createObjectURL(file);
    metadataVideo.preload = "metadata";
    metadataVideo.onloadedmetadata = () => {
      if (Number.isFinite(metadataVideo.duration) && metadataVideo.duration > 0) {
        setVideoDurationSeconds(metadataVideo.duration);
      }
      URL.revokeObjectURL(metadataUrl);
    };
    metadataVideo.onerror = () => URL.revokeObjectURL(metadataUrl);
    metadataVideo.src = metadataUrl;
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

  // Renderização acelerada (WebCodecs): decodifica e codifica sem esperar o
  // vídeo tocar em tempo real. Retorna false para cair no modo antigo.
  async function createVideoFast(): Promise<boolean> {
    if (!videoFile || !backgroundFile) return false;
    setBusy(true);
    setProgress(0);
    setRenderSpeed(null);
    setRemainingSeconds(null);
    setStorageWarning("");
    setError("");
    setMessage("Renderização acelerada (WebCodecs) iniciada...");
    try {
      const mb = await import("mediabunny");
      const background = new Image();
      background.src = createTrackedUrl(backgroundFile);
      await new Promise<void>((resolve, reject) => {
        background.onload = () => resolve();
        background.onerror = () => reject(new Error("Não foi possível abrir a imagem de fundo."));
      });
      const isLandscape = outputFormat === "16:9";
      const is4K = outputResolution === "4K";
      const width = isLandscape ? (is4K ? 3840 : 1920) : (is4K ? 2160 : 1080);
      const height = isLandscape ? (is4K ? 2160 : 1080) : (is4K ? 3840 : 1920);
      const canvas = new OffscreenCanvas(width, height);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Não foi possível iniciar o renderizador.");
      const bgScale = Math.min(width / background.width, height / background.height);
      const bgW = background.width * bgScale;
      const bgH = background.height * bgScale;
      const bgCanvas = new OffscreenCanvas(width, height);
      const bgCtx = bgCanvas.getContext("2d", { alpha: false });
      if (!bgCtx) throw new Error("Não foi possível iniciar o renderizador.");
      bgCtx.fillStyle = "#000000";
      bgCtx.fillRect(0, 0, width, height);
      bgCtx.drawImage(background, (width - bgW) / 2, (height - bgH) / 2, bgW, bgH);
      const blurCanvas = new OffscreenCanvas(1, 1);
      const blurCtx = blurCanvas.getContext("2d");
      if (!blurCtx) throw new Error("Não foi possível iniciar o renderizador.");

      const input = new mb.Input({ source: new mb.BlobSource(videoFile), formats: mb.ALL_FORMATS });
      const duration = await input.computeDuration();
      setVideoDurationSeconds(duration);
      const target = new mb.BufferTarget();
      const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });

      const conversion = await mb.Conversion.init({
        input,
        output,
        tags: {},
        video: {
          codec: "avc",
          bitrate: is4K ? 35_000_000 : 12_000_000,
          hardwareAcceleration: "prefer-hardware",
          processedWidth: width,
          processedHeight: height,
          process: (sample) => {
            const frame = sample.toCanvasImageSource();
            const vw = sample.displayWidth;
            const vh = sample.displayHeight;
            // Fundo pré-composto uma única vez (sem fillRect/escala por quadro)
            ctx.drawImage(bgCanvas, 0, 0);
            const safeW = width * 0.84;
            const safeH = height * 0.84;
            const safeX = (width - safeW) / 2;
            const safeY = (height - safeH) / 2;
            const baseScale = cropToFill ? Math.max(safeW / vw, safeH / vh) : Math.min(safeW / vw, safeH / vh);
            const s = baseScale * (videoZoom / 100);
            const w = vw * s;
            const h = vh * s;
            const x = (width - w) / 2 + (videoOffsetX / 100) * safeW * 0.5;
            const y = (height - h) / 2 + (videoOffsetY / 100) * safeH * 0.5;
            // Recorte por coordenadas (sem ctx.clip/save/restore)
            const dx0 = Math.max(x, safeX);
            const dy0 = Math.max(y, safeY);
            const dx1 = Math.min(x + w, safeX + safeW);
            const dy1 = Math.min(y + h, safeY + safeH);
            if (dx1 > dx0 && dy1 > dy0) {
              ctx.drawImage(frame, (dx0 - x) / s, (dy0 - y) / s, (dx1 - dx0) / s, (dy1 - dy0) / s, dx0, dy0, dx1 - dx0, dy1 - dy0);
            }
            if (hideWatermark) {
              const sx = (Math.max(0, Math.min(99, markX)) / 100) * vw;
              const sy = (Math.max(0, Math.min(99, markY)) / 100) * vh;
              const sw = (Math.max(1, Math.min(100 - markX, markW)) / 100) * vw;
              const sh = (Math.max(1, Math.min(100 - markY, markH)) / 100) * vh;
              // Desfoque rápido: reduz e re-estica (sem filtro gaussiano)
              const tw = Math.max(1, Math.round(sw / 12));
              const th = Math.max(1, Math.round(sh / 12));
              if (blurCanvas.width !== tw || blurCanvas.height !== th) {
                blurCanvas.width = tw;
                blurCanvas.height = th;
              }
              blurCtx!.drawImage(frame, sx, sy, sw, sh, 0, 0, tw, th);
              ctx.imageSmoothingQuality = "low";
              ctx.drawImage(blurCanvas, x + sx * s, y + sy * s, sw * s, sh * s);
            }
            return canvas;
          }
        },
        // Copia o áudio AAC original sem recodificar quando possível
        audio: (track) => (track.codec === "aac" ? {} : { codec: "aac", bitrate: 192_000 })
      });
      if (!conversion.isValid) return false;

      const startedAt = Date.now();
      conversion.onProgress = (p, processedTime) => {
        setProgress(Math.min(99, Math.floor(p * 100)));
        const elapsed = (Date.now() - startedAt) / 1000;
        if (elapsed > 1 && processedTime > 0) {
          const speed = processedTime / elapsed;
          setRenderSpeed(speed);
          setRemainingSeconds((duration - processedTime) / speed);
        }
      };
      await conversion.execute();
      if (!target.buffer) throw new Error("O arquivo exportado ficou vazio.");
      const blob = new Blob([target.buffer], { type: "video/mp4" });
      const safeName = ((videoFile.name || "video").replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-") || "video") + "-com-moldura.mp4";
      const outputUrl = createTrackedUrl(blob);
      setRenderedUrl(outputUrl);
      setRenderedType(blob.type);
      setProgress(100);
      setRemainingSeconds(0);
      const link = document.createElement("a");
      link.href = outputUrl;
      link.download = safeName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setMessage(`Vídeo MP4 criado em modo acelerado (${((Date.now() - startedAt) / 1000).toFixed(0)}s), sem metadados.`);
      return true;
    } catch (err) {
      console.warn("WebCodecs falhou, usando modo tempo real", err);
      setMessage("Modo acelerado indisponível para este arquivo. Usando modo tempo real...");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createVideo() {
    if (!videoFile || !backgroundFile) {
      setError("Selecione o vídeo e a imagem PNG/JPEG da moldura.");
      return;
    }

    setBusy(true);
    setProgress(0);
    setRenderSpeed(null);
    setRemainingSeconds(null);
    setStorageWarning("");
    setError("");
    setMessage("Enviando os arquivos para a GPU NVIDIA da Vast.ai...");

    try {
      const capabilitiesResponse = await fetch("/api/capabilities");
      if (!capabilitiesResponse.ok) throw new Error("Não foi possível verificar a GPU da Vast.ai.");
      const capabilities = await capabilitiesResponse.json() as {
        gpu?: string; nvenc_h264?: boolean; nvdec?: boolean;
      };
      if (!capabilities.nvenc_h264) {
        throw new Error("A GPU NVIDIA com NVENC não está disponível. O processamento local do navegador foi desativado; verifique o driver e o FFmpeg na Vast.ai.");
      }

      const form = new FormData();
      form.append("video", videoFile, videoFile.name);
      form.append("background", backgroundFile, backgroundFile.name);
      form.append("params", JSON.stringify({
        output_format: outputFormat,
        resolution: outputResolution,
        crop_to_fill: cropToFill,
        zoom: videoZoom,
        offset_x: videoOffsetX,
        offset_y: videoOffsetY,
        fps: "original",
        codec: "h264",
        encoder: "nvenc",
        quality: "speed"
      }));

      setMessage("Enviando vídeo para " + (capabilities.gpu || "GPU NVIDIA") + "...");
      const createResponse = await fetch("/api/render", { method: "POST", body: form });
      const createPayload = await createResponse.json().catch(() => ({})) as { job_id?: string; detail?: string };
      if (!createResponse.ok || !createPayload.job_id) {
        throw new Error(createPayload.detail || "A API GPU não aceitou o trabalho.");
      }

      const jobId = createPayload.job_id;
      const startedAt = Date.now();
      let finished = false;
      while (!finished) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch("/api/render/jobs/" + encodeURIComponent(jobId), { cache: "no-store" });
        const status = await statusResponse.json().catch(() => ({})) as {
          status?: string; progress?: number; message?: string; engine?: string;
          elapsed_seconds?: number; eta_seconds?: number; speed?: string; error?: string;
        };
        if (!statusResponse.ok) throw new Error(status.error || status.message || "Não foi possível consultar o progresso do render.");
        setProgress(Math.max(0, Math.min(99, status.progress || 0)));
        setMessage(status.message || "Renderizando na GPU NVIDIA...");
        if (typeof status.eta_seconds === "number") setRemainingSeconds(status.eta_seconds);
        if (typeof status.elapsed_seconds === "number" && status.elapsed_seconds > 0) {
          const elapsed = (Date.now() - startedAt) / 1000;
          if (elapsed > 0) setRenderSpeed((videoDurationSeconds || 0) / elapsed);
        }
        if (status.status === "error") throw new Error(status.error || status.message || "Falha na renderização GPU.");
        finished = status.status === "completed";
      }

      setMessage("Renderização concluída na GPU. Baixando o MP4...");
      const fileResponse = await fetch("/api/render/" + encodeURIComponent(jobId) + "/file");
      if (!fileResponse.ok) {
        const payload = await fileResponse.json().catch(() => ({})) as { detail?: string };
        throw new Error(payload.detail || "Não foi possível baixar o vídeo renderizado.");
      }
      const blob = await fileResponse.blob();
      if (!blob.size) throw new Error("O backend retornou um arquivo vazio.");
      const outputUrl = createTrackedUrl(blob);
      setRenderedUrl(outputUrl);
      setRenderedType("video/mp4");
      setProgress(100);
      setRemainingSeconds(0);
      const safeName = ((videoFile.name || "video").replace(/\\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "-") || "video") + "-manhwa-studio.mp4";
      const link = document.createElement("a");
      link.href = outputUrl;
      link.download = safeName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setMessage("MP4 concluído com " + (capabilities.gpu || "GPU NVIDIA") + " usando FFmpeg/NVENC. Motor: " + "NVENC.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível concluir a renderização GPU.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="oneclick-shell">
      <header className="oneclick-header">
        <div className="oneclick-brand"><span className="oneclick-mark">M</span><div><strong>MANHWA STUDIO</strong><small>VIDEO FRAME CREATOR</small></div></div>
        <span className="oneclick-status"><span/> GPU NVIDIA · VAST.AI</span>
      </header>
      <main className="oneclick-main">
        <div className="oneclick-intro"><span className="oneclick-eyebrow">EDIÇÃO AUTOMÁTICA · UM CLIQUE</span><h1>Seu vídeo, com <em>sua moldura.</em></h1><p>Cole o link de qualquer vídeo do YouTube que esteja acessível e envie uma imagem PNG/JPEG. O sistema baixa o vídeo no backend, aplica a moldura, permite desfocar sua própria marca-d’água e limpa os metadados descritivos.</p></div>
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
                <option value="1080p">Full HD · 1080p</option>
                <option value="4K">Ultra HD · 4K</option>
              </select>
            </label>
          </div>
          <p className="output-dimensions">Saída: {outputFormat === "16:9" ? (outputResolution === "4K" ? "3840 × 2160" : "1920 × 1080") : (outputResolution === "4K" ? "2160 × 3840" : "1080 × 1920")} px · "MP4 · renderização na GPU NVIDIA da Vast.ai"</p>
        </section>
        <section className="oneclick-grid">
          <div className="oneclick-card">
            <div className="oneclick-card-title"><FileVideo/><div><strong>1. Link do YouTube</strong><small>Vídeo do YouTube</small></div></div>
            <button className="oneclick-drop" onClick={() => videoInput.current?.click()} disabled={busy}>
              {videoPreview ? <video src={videoPreview} muted playsInline/> : <><Upload/><strong>Selecionar vídeo baixado</strong><small>Escolha o arquivo MP4 salvo no computador</small></>}
            </button>
            <input ref={videoInput} type="file" accept="video/*,.mp4,.webm,.mov,.mkv" hidden onChange={(event) => selectVideo(event.target.files?.[0])}/>
            <div style={{display:"flex",gap:10,marginTop:12,flexWrap:"wrap"}}>
              <button type="button" onClick={() => window.open("https://app.ytdown.to/en38/","_blank","noopener,noreferrer")} disabled={busy} style={{padding:"10px 14px",borderRadius:8,border:"1px solid #ef4055",background:"#211016",color:"#fff",cursor:"pointer",fontSize:11,fontWeight:700}}>
                <Youtube size={14} style={{display:"inline",verticalAlign:"middle",marginRight:6}}/> ABRIR YTDOWN PARA BAIXAR
              </button>
              <button type="button" onClick={() => videoInput.current?.click()} disabled={busy} style={{padding:"10px 14px",borderRadius:8,border:"1px solid #414958",background:"#171b23",color:"#fff",cursor:"pointer",fontSize:11}}>
                SELECIONAR MP4
              </button>
            </div>
            <label style={{display:"block",marginTop:12,fontSize:10,color:"#aeb6c4"}}>Link do YouTube (cole também no YTDown)</label>
            <input id="youtube-link" value={youtubeUrl} onChange={(event) => { setYoutubeUrl(event.target.value); setRenderedUrl(""); setError(""); }} disabled={busy} type="url" placeholder="https://www.youtube.com/watch?v=..." style={{width:"100%",marginTop:7,padding:"12px",borderRadius:8,border:"1px solid #414958",background:"#0b0d12",color:"#f3f4f6",fontSize:11}}/>
            <p style={{fontSize:9,color:"#818b9a",lineHeight:1.6,marginTop:8}}>Cole o mesmo link no YTDown, escolha MP4 e baixe o arquivo. Depois selecione o vídeo aqui para aplicar a moldura. Use apenas conteúdo que você tenha direito ou autorização para baixar e processar.</p>
            {videoFile && <div className="oneclick-file"><Check size={15}/><span>Último download: {videoFile.name}</span><button onClick={() => { setVideoFile(null); setVideoPreview(""); setVideoDurationSeconds(null); setRemainingSeconds(null); setRenderedUrl(""); }} aria-label="Limpar vídeo baixado"><X size={15}/></button></div>}
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
            <button type="button" className="outline-button" disabled={busy} onClick={() => { setVideoZoom(93); setVideoOffsetX(0); setVideoOffsetY(7); setCropToFill(true); }}>REDEFINIR</button>
          </div>
        </section>
        <section className="oneclick-preview">
          <div><span className="oneclick-eyebrow">PRÉVIA DA COMPOSIÇÃO</span><p>A área dentro da janela é o recorte final. Arraste os controles de zoom e posição para escolher exatamente o trecho que ficará visível. O mesmo recorte será usado na exportação em {outputFormat} e {outputResolution}. A imagem de fundo aparece inteira, sem cortes.</p></div>
          {videoPreview && backgroundPreview ? <div className="oneclick-composite" style={{backgroundImage: "url(" + backgroundPreview + ")", aspectRatio: outputFormat === "16:9" ? "16 / 9" : "9 / 16", backgroundSize: "contain", backgroundColor: "#000"}}><video src={videoPreview} muted playsInline style={{ objectFit: cropToFill ? "cover" : "contain", transform: "translate(" + videoOffsetX + "%, " + videoOffsetY + "%) scale(" + (videoZoom / 100) + ")" }}/></div> : <div className="oneclick-empty"><FileImage/><span>Envie os dois arquivos para visualizar a composição</span></div>}
        </section>
        {videoFile && videoDurationSeconds !== null && !busy && (
          <div className="oneclick-alert success" style={{ marginTop: 14 }}>
            <FileVideo size={17}/>
            <span>Vídeo pronto para envio à GPU NVIDIA da Vast.ai. Até 2 renderizações simultâneas na instância.</span>
          </div>
        )}
        <button className="oneclick-create" onClick={() => void createVideo()} disabled={busy || !videoFile || !backgroundFile}>
          {busy ? <><LoaderCircle className="oneclick-spin"/> PROCESSANDO {progress}%</> : <><Play/> CRIAR VÍDEO COM 1 CLIQUE <span>→</span></>}
        </button>
        {busy && <>
          <div className="oneclick-progress"><span style={{width: progress + "%"}}/></div>
          <p style={{ color: "#aeb6c4", fontSize: 12, textAlign: "center", marginTop: 9 }}>
            Tempo restante estimado: <strong style={{ color: "#fff" }}>{remainingSeconds === null ? "calculando..." : formatMinutes(remainingSeconds)}</strong>
            {" · "}Velocidade: <strong style={{ color: "#fff" }}>{renderSpeed === null ? "medindo..." : renderSpeed.toFixed(2) + "×"}</strong>
            {" · "}A estimativa é recalculada com a velocidade real da renderização.
          </p>
        </>}
        {storageWarning && <div className="oneclick-alert error"><ShieldCheck size={17}/>{storageWarning}</div>}
        {error && <div className="oneclick-alert error"><X size={17}/>{error}</div>}
        {message && <div className="oneclick-alert success"><Check size={17}/>{message}</div>}
        {renderedUrl && <section className="oneclick-result"><div><span className="oneclick-eyebrow">EXPORTAÇÃO CONCLUÍDA</span><strong>Seu vídeo está pronto</strong><small>MP4 · FFmpeg/NVENC na GPU</small></div><video src={renderedUrl} controls/><a className="oneclick-download" href={renderedUrl} download={(videoFile?.name.replace(/\.[^.]+$/, "") || "video") + "-manhwa-studio.mp4"}><Download size={16}/> Baixar novamente</a></section>}
        <div className="oneclick-notes"><ShieldCheck/><p><strong>Processamento GPU:</strong> os arquivos são enviados à instância Vast.ai. A composição e a codificação MP4 são feitas no servidor com FFmpeg/NVENC pela GPU NVIDIA; o navegador serve apenas como interface, prévia e download. A instância aceita até 2 renderizações simultâneas; trabalhos adicionais aguardam vaga. Os arquivos temporários são removidos após o download ou expiração do trabalho.</p></div>
      </main>
      <footer className="oneclick-footer">MANHWA STUDIO <span>·</span> FUNDO PERSONALIZADO <span>·</span> EXPORTAÇÃO AUTOMÁTICA</footer>
    </div>
  );
}
