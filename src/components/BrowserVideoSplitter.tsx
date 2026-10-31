import { useRef, useState } from "react";
import { FileVideo, FolderOpen, LoaderCircle, CheckCircle2, AlertCircle } from "lucide-react";

type DirectoryHandle = {
  getFileHandle(name: string, options: { create: boolean }): Promise<{
    createWritable(): Promise<{
      write(data: Blob): Promise<void>;
      close(): Promise<void>;
      abort?(): Promise<void>;
    }>;
    getFile(): Promise<File>;
  }>;
};

type Props = { onPartSelected: (file: File) => void };

const SEGMENT_SECONDS = 30 * 60;
const MAX_SECONDS = 25 * 60 * 60;
const MAX_BYTES = 8 * 1024 * 1024 * 1024;

export default function BrowserVideoSplitter({ onPartSelected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<File | null>(null);
  const [parts, setParts] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [partNumber, setPartNumber] = useState(0);
  const [status, setStatus] = useState("Selecione um vídeo para dividir em partes de 30 minutos.");
  const [error, setError] = useState("");

  function chooseSource(file?: File) {
    if (!file) return;
    setError("");
    setParts([]);
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) {
      setError("Selecione um arquivo de vídeo (MP4, MOV, WebM ou MKV).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("O arquivo ultrapassa o limite configurado de 8 GB.");
      return;
    }
    setSource(file);
    setStatus("Arquivo selecionado. A divisão será feita no navegador e salva diretamente em uma pasta do computador.");
  }

  async function splitVideo() {
    const video = videoRef.current;
    if (!source || !video) return;
    if (!("showDirectoryPicker" in window)) {
      setError("Para salvar partes grandes diretamente no disco, abra o projeto no Google Chrome ou Microsoft Edge atualizado.");
      return;
    }
    if (!("MediaRecorder" in window) || typeof video.captureStream !== "function") {
      setError("Este navegador não oferece captura de vídeo. Use Chrome ou Edge atualizado.");
      return;
    }

    setRunning(true);
    setError("");
    setParts([]);
    setProgress(0);
    setPartNumber(0);
    let stream: MediaStream | null = null;
    try {
      const picker = (window as unknown as { showDirectoryPicker: () => Promise<DirectoryHandle> }).showDirectoryPicker;
      const directory = await picker();
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error("O navegador não conseguiu ler este vídeo. Tente um MP4 H.264."));
        video.src = URL.createObjectURL(source);
        video.load();
      });
      if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > MAX_SECONDS) {
        throw new Error("A duração precisa ser válida e não pode ultrapassar 25 horas.");
      }
      const totalParts = Math.min(50, Math.ceil(video.duration / SEGMENT_SECONDS));
      if (totalParts < 1) throw new Error("Não foi possível identificar a duração do vídeo.");
      stream = video.captureStream();
      const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Seu navegador não oferece gravação WebM compatível.");

      const completed: File[] = [];
      for (let index = 0; index < totalParts; index++) {
        const start = index * SEGMENT_SECONDS;
        const end = Math.min(video.duration, start + SEGMENT_SECONDS);
        const filename = `parte-${String(index + 1).padStart(2, "0")}.webm`;
        const fileHandle = await directory.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        let writeQueue = Promise.resolve();
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 8_000_000,
          audioBitsPerSecond: 192_000
        });
        const stopped = new Promise<void>((resolve, reject) => {
          recorder.ondataavailable = (event) => {
            if (event.data.size) writeQueue = writeQueue.then(() => writable.write(event.data));
          };
          recorder.onerror = () => reject(new Error("A gravação de uma das partes foi interrompida."));
          recorder.onstop = () => resolve();
        });

        video.pause();
        if (Math.abs(video.currentTime - start) > 0.05) {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => reject(new Error("Tempo esgotado ao posicionar o vídeo.")), 30000);
            const onSeeked = () => { window.clearTimeout(timeout); resolve(); };
            video.addEventListener("seeked", onSeeked, { once: true });
            video.currentTime = start;
          });
        }
        recorder.start(1000);
        await video.play();
        setPartNumber(index + 1);
        setStatus(`Gravando parte ${index + 1} de ${totalParts} (${Math.floor(start / 60)}–${Math.ceil(end / 60)} min). Não feche esta aba.`);

        await new Promise<void>((resolve) => {
          const check = () => {
            setProgress(Math.min(100, Math.round((video.currentTime / video.duration) * 100)));
            if (video.currentTime >= end || video.ended) {
              video.pause();
              resolve();
            } else {
              requestAnimationFrame(check);
            }
          };
          requestAnimationFrame(check);
        });
        if (recorder.state !== "inactive") recorder.stop();
        await stopped;
        await writeQueue;
        await writable.close();
        const part = await fileHandle.getFile();
        if (!part.size) throw new Error(`A parte ${index + 1} ficou vazia.`);
        completed.push(part);
        setParts([...completed]);
        setStatus(`Parte ${index + 1} salva: ${filename}`);
      }
      setProgress(100);
      setStatus(`Concluído: ${completed.length} parte(s) salvas na pasta escolhida. Selecione uma parte para editar.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível dividir o vídeo.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setRunning(false);
    }
  }

  return (
    <section className="oneclick-card" style={{ marginBottom: 18 }}>
      <div className="oneclick-card-title"><FileVideo/><div><strong>1. DIVIDIR VÍDEO ANTES DE EDITAR</strong><small>Processamento no navegador · partes de 30 minutos · até 25 horas / 50 partes</small></div></div>
      <input type="file" accept="video/*,.mp4,.mov,.webm,.mkv,.m4v" disabled={running} onChange={(event) => chooseSource(event.target.files?.[0])} style={{display:"block",width:"100%",margin:"10px 0",color:"#aeb6c4",fontSize:11}}/>
      {source && <div className="oneclick-file"><CheckCircle2/><span>{source.name} · {(source.size / 1024 ** 3).toFixed(2)} GB</span></div>}
      <video ref={videoRef} style={{display:"none"}} playsInline />
      <button type="button" className="oneclick-create" onClick={splitVideo} disabled={!source || running}>
        {running ? <LoaderCircle className="oneclick-spin"/> : <FolderOpen/>}
        {running ? "DIVIDINDO E SALVANDO NO DISCO..." : "ESCOLHER PASTA E DIVIDIR EM PARTES"}
      </button>
      {running && <div className="oneclick-progress"><span style={{width: progress + "%"}}/></div>}
      <p style={{color:"#8993a2",fontSize:10,lineHeight:1.7,margin:"10px 0"}}>{status}</p>
      {error && <div className="oneclick-alert error"><AlertCircle/>{error}</div>}
      {parts.length > 0 && <div style={{display:"grid",gap:8,marginTop:14}}>
        <strong style={{fontSize:11,color:"#dce1e9"}}>PARTES PRONTAS — clique para continuar no editor</strong>
        {parts.map((part,index) => <div key={part.name} style={{display:"flex",alignItems:"center",gap:10,border:"1px solid #303744",borderRadius:7,padding:9}}>
          <span style={{fontSize:10,color:"#ff929a",fontWeight:800}}>#{String(index+1).padStart(2,"0")}</span>
          <span style={{fontSize:10,color:"#b9c1ce",flex:1,overflow:"hidden",textOverflow:"ellipsis"}}>{part.name} · {(part.size/1024/1024).toFixed(1)} MB</span>
          <button type="button" onClick={() => onPartSelected(part)} style={{border:"1px solid #f04452",borderRadius:6,background:"#f0445220",color:"#ff9aa2",padding:"7px 10px",fontSize:9,cursor:"pointer"}}>EDITAR ESTA PARTE</button>
        </div>)}
      </div>}
      <p style={{color:"#687384",fontSize:9,lineHeight:1.6,marginTop:12}}>A gravação é feita em tempo real pelo navegador e salva em disco em blocos de 1 segundo, sem impor teto artificial de RAM. A saída é WebM; o tempo de divisão acompanha a duração do vídeo.</p>
    </section>
  );
}
