import { useState } from "react";
import { FileVideo, LoaderCircle, Scissors, Check } from "lucide-react";

type Part = { name: string; size: number };
type Props = { onSelectPart: (file: File) => void };

const LOCAL_API = "http://127.0.0.1:8765";

export function LocalVideoSplitter({ onSelectPart }: Props) {
  const [source, setSource] = useState<File | null>(null);
  const [parts, setParts] = useState<Part[]>([]);
  const [jobId, setJobId] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  async function split() {
    if (!source) return;
    setBusy(true); setError(""); setStatus("Enviando o vídeo ao serviço local...");
    setParts([]); setSelected(""); setJobId("");
    try {
      const health = await fetch(LOCAL_API + "/health");
      if (!health.ok) throw new Error("Inicie o divisor local pelo arquivo INICIAR_DIVISOR_LOCAL.bat.");
      const body = new FormData();
      body.append("file", source, source.name);
      setStatus("Dividindo no computador. Arquivos grandes podem levar algum tempo...");
      const response = await fetch(LOCAL_API + "/api/split", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Não foi possível dividir o vídeo.");
      setJobId(data.job_id);
      setParts(data.parts);
      setStatus(data.note || "Divisão concluída. Escolha uma parte para editar.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao conectar ao divisor local.");
    } finally { setBusy(false); }
  }

  async function usePart() {
    if (!jobId || !selected) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(LOCAL_API + "/api/parts/" + jobId + "/" + encodeURIComponent(selected));
      if (!response.ok) throw new Error("Não foi possível abrir a parte selecionada.");
      const blob = await response.blob();
      onSelectPart(new File([blob], selected, { type: "video/mp4" }));
      setStatus(selected + " carregada na etapa de moldura.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao carregar a parte.");
    } finally { setBusy(false); }
  }

  return <section className="oneclick-card" style={{ marginBottom: 18 }}>
    <div className="oneclick-card-title"><Scissors/><div><strong>ETAPA 1 · DIVIDIR VÍDEO</strong><small>Processamento local · até 8 GB · duração máxima de 25 horas</small></div></div>
    <p style={{fontSize:12,color:"#aeb6c4",lineHeight:1.6}}>Selecione um vídeo para dividi-lo automaticamente em partes de aproximadamente 30 minutos. As partes ficam salvas no disco local do computador. Nenhum ZIP será criado.</p>
    <input type="file" accept="video/*,.mp4,.webm,.mov,.mkv" disabled={busy} onChange={e => {setSource(e.target.files?.[0] || null);setParts([]);setJobId("");setError("");}}/>
    {source && <p style={{fontSize:11,color:"#cbd5e1"}}><FileVideo size={14} style={{display:"inline",verticalAlign:"middle"}}/> {source.name} · {(source.size/1024/1024/1024).toFixed(2)} GB</p>}
    <button type="button" className="oneclick-create" style={{marginTop:12}} disabled={!source || busy || source.size > 8*1024*1024*1024} onClick={() => void split()}>
      {busy ? <><LoaderCircle className="oneclick-spin"/> PROCESSANDO LOCALMENTE...</> : <><Scissors/> DIVIDIR EM PARTES DE 30 MINUTOS</>}
    </button>
    {parts.length > 0 && <div style={{marginTop:16}}>
      <div style={{fontSize:12,color:"#fff",marginBottom:8}}><Check size={15} style={{display:"inline",verticalAlign:"middle"}}/> {parts.length} parte(s) criada(s)</div>
      <select value={selected} onChange={e=>setSelected(e.target.value)} style={{width:"100%",padding:12,background:"#0b0d12",color:"#fff",border:"1px solid #414958",borderRadius:8}}>
        <option value="">Selecione uma parte para continuar</option>
        {parts.map(p=><option key={p.name} value={p.name}>{p.name} · {(p.size/1024/1024).toFixed(1)} MB</option>)}
      </select>
      <button type="button" className="oneclick-create" style={{marginTop:10}} disabled={!selected || busy} onClick={() => void usePart()}><FileVideo/> USAR PARTE NA EDIÇÃO</button>
    </div>}
    {status && <p style={{fontSize:11,color:"#9ca3af",marginTop:10}}>{status}</p>}
    {error && <p style={{fontSize:11,color:"#fb7185",marginTop:10}}>{error}</p>}
  </section>;
}
