import { useEffect, useRef, useState } from "react";
import { FileVideo, FolderOpen, LoaderCircle, CheckCircle2, AlertCircle, Play } from "lucide-react";

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
  const objectUrlRef = useRef("");
  const [source, setSource] = useState<File | null>(null);
  const [directory, setDirectory] = useState<DirectoryHandle | null>(null);
  const [prepared, setPrepared] = useState(false);
  const [parts, setParts] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [partNumber, setPartNumber] = useState(0);
  const [status, setStatus] = useState("Selecione um vídeo para dividir em partes de 30 minutos.");
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  function chooseSource(file?: File) {
    if (!file) return;
    setError("");
    setParts([]);
    setDirectory(null);
    setPrepared(false);
    if (!file.type.startsWith("video/") && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name)) {
      setSource(null);
      setError("Selecione um arquivo de vídeo (MP4, MOV, WebM ou MKV).");
      return;
    }
    if (file.size > MAX_BYTES) {
      setSource(null);
      setError("O arquivo ultrapassa o limite configurado de 8 GB.");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = URL.createObjectURL(file);
    setSource(file);
    setStatus("Arquivo selecionado. Prepare a pasta de destino; depois inicie a divisão.");
  }

  async function prepareSplit() {
    const video = videoRef.current;
    if (!source || !video) return;
    if (!("showDirectoryPicker" in window)) {
      setError("Para salvar partes grandes diretamente no disco, abra o projeto no Google Chrome ou Microsoft Edge atualizado.");
      return;
    }
    setError("");
    setPrepared(false);
    try {
      const picker = (window as unknown as { showDirectoryPicker: () => Promise<DirectoryHandle> }).showDirectoryPicker;
      const selectedDirectory = await picker();
      if (video.src !== objectUrlRef.current) video.src = objectUrlRef.current;
      await new Promise<void>((resolve, reject) => {
        if (video.readyState >= 1 && Number.isFinite(video.duration)) return resolve();
        const timeout = window.setTimeout(() => reject(new Error("Tempo esgotado ao ler os dados do vídeo.")), 60000);
        video.onloadedmetadata = () => { window.clearTimeout(timeout); resolve(); };
        video.onerror = () => { window.clearTimeout(timeout); reject(new Error("O navegador não conseguiu ler este vídeo. Tente MP4 H.264.")); };
        video.load();
      });
      if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > MAX_SECONDS) {
        throw new Error("A duração precisa ser válida e não pode ultrapassar 25 horas.");
      }
      const count = Math.ceil(video.duration / SEGMENT_SECONDS);
      if (count > 50) throw new Error("Este vídeo exigiria mais de 50 partes de 30 minutos.");
      if (!("MediaRecorder" in window) || typeof video.captureStream !== "function") {
        throw new Error("Este navegador não oferece captura de vídeo. Use Chrome ou Edge atualizado.");
      }
      const mime = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("Seu navegador não oferece gravação WebM compatível.");
      setDirectory(selectedDirectory);
      setPrepared(true);
      setStatus(`Pronto: ${count} parte(s) de até 30 minutos. Confira a prévia e clique em INICIAR DIVISÃO.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível preparar a divisão.");
    }
  }

  async function startSplit() {
    const video = videoRef.current;
    if (!source || !video || !directory || !prepared) return;
    setRunning(true);
    setError("");
    setParts([]);
    setProgress(0);
    setPartNumber(0);
    let stream: MediaStream | null = null;
    try {
      const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error("Seu navegador não oferece gravação WebM compatível.");
      stream = video.captureStream();
      const completed: File[] = [];
      const totalParts = Math.ceil(video.duration / SEGMENT_SECONDS);

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

        setPartNumber(index + 1);
        setStatus(`Gravando parte ${index + 1} de ${totalParts}. Não feche esta aba nem bloqueie o computador.`);
        recorder.start(1000);
        // Este play ocorre após um clique explícito do usuário no botão Iniciar.
        await video.play();

        await new Promise<void>((resolve, reject) => {
          let raf = 0;
          const check = () => {
            if (video.error) {
              reject(new Error("O navegador encontrou um erro durante a leitura do vídeo."));
              return;
            }
            setProgress(Math.min(100, Math.round((video.currentTime / video.duration) * 100)));
            if (video.currentTime >= end || video.ended) {
              video.pause();
              resolve();
            } else {
              raf = requestAnimationFrame(check);
            }
          };
          raf = requestAnimationFrame(check);
          video.addEventListener("error", () => { cancelAnimationFrame(raf); reject(new Error("Falha ao decodificar o vídeo.")); }, { once: true });
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
      setStatus(`Concluído: ${completed.length} parte(s) salvas. Selecione uma parte para continuar no editor.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível dividir o vídeo.");
      setStatus("A divisão foi interrompida. As partes já concluídas continuam salvas na pasta escolhida.");
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
      <video ref={videoRef} src={objectUrlRef.current || undefined} controls={prepared && !running} playsInline preload="metadata" style={{display:source ? "block" : "none",width:"100%",maxWidth:420,maxHeight:220,objectFit:"contain",background:"#050609",borderRadius:8,margin:"12px 0"}} />
      <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <button type="button" className="oneclick-create" onClick={prepareSplit} disabled={!source || running}>
          <FolderOpen/> {prepared ? "TROCAR PASTA DE DESTINO" : "ESCOLHER PASTA E PREPARAR"}
        </button>
        {prepared && <button type="button" className="oneclick-create" onClick={startSplit} disabled={running} style={{background:"#a91f32"}}>
          {running ? <LoaderCircle className="oneclick-spin"/> : <Play/>}
          {running ? "DIVIDINDO E SALVANDO..." : "INICIAR DIVISÃO"}
        </button>}
      </div>
      {running && <div className="oneclick-progress"><span style={{width: progress + "%"}}/></div>}
      {running && <p style={{color:"#ff9aa2",fontSize:10}}>Parte atual: {partNumber} · Progresso geral: {progress}%</p>}
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
      <p style={{color:"#687384",fontSize:9,lineHeight:1.6,marginTop:12}}>A divisão é feita em tempo real pelo navegador e grava os blocos diretamente no disco, sem teto artificial de RAM. As partes são WebM recodificadas; um vídeo de 25 horas pode levar até 25 horas para processar. Compatibilidade depende do codec de origem e do navegador.</p>
    </section>
  );
}
