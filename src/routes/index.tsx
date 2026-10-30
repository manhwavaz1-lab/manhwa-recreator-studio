import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AudioLines, BookOpen, BrainCircuit, Check, ChevronDown,
  Clapperboard, Cloud, Download, FileImage, FileVideo, Film, FolderOpen, KeyRound,
  Layers3, LoaderCircle, LockKeyhole, MessageSquareText, Mic2, Play, Plus,
  ScanEye, Settings2, ShieldCheck, Sparkles, Upload, WandSparkles, X
} from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";\nimport { loadStudioProject, saveStudioProject } from "../lib/project-storage";
import {
  askOpenRouter, buildWebVtt, downloadText, extractJson, fetchOpenRouterModels, openRouterTask,
  getStoredApiKey, loadStoryMemory, saveStoryMemory, storeApiKey,
  type CharacterMemory, type EpisodeMemory, type StoryMemory, type StudioModel
} from "../lib/studio";

export const Route = createFileRoute("/")({ component: Studio });

type Scene = { order: number; description: string; characters: string[]; narration: string; movement: string };
type Analysis = { title: string; synopsis: string; characters: Array<{ name: string; description: string; notes?: string }>; scenes: Scene[]; script: string; continuityNotes: string[] };

const emptyMemory: StoryMemory = { characters: [], episodes: [], lore: "" };

function Studio() {
  const [projectName, setProjectName] = useState("Novo projeto de Manhwa");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<StudioModel[]>([]);
  const [model, setModel] = useState("google/gemini-2.5-flash");
  const [modelsLoading, setModelsLoading] = useState(false);
  const [memory, setMemory] = useState<StoryMemory>(emptyMemory);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [assets, setAssets] = useState<string[]>([]);
  const [assetNames, setAssetNames] = useState<string[]>([]);
  const [videoName, setVideoName] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("studio");
  const [voice, setVoice] = useState("");
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [ttsModel, setTtsModel] = useState("");
  const [ttsVoice, setTtsVoice] = useState("alloy");
  const [ttsBusy, setTtsBusy] = useState(false);\n  const [ttsAudio, setTtsAudio] = useState<Blob | null>(null);\n  const [renderFormat, setRenderFormat] = useState<"16:9" | "9:16">("16:9");\n  const [renderBusy, setRenderBusy] = useState(false);\n  const [renderProgress, setRenderProgress] = useState(0);\n  const [renderedVideo, setRenderedVideo] = useState<string>("");\n  const [renderedBlob, setRenderedBlob] = useState<Blob | null>(null);\n  const [projectSaving, setProjectSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setApiKey(getStoredApiKey());
    setMemory(loadStoryMemory());
    void loadStudioProject().then((saved) => {
      if (!saved) return;
      setProjectName(saved.projectName || "Novo projeto de Manhwa");
      setYoutubeUrl(saved.youtubeUrl || "");
      setAnalysis(saved.analysis as Analysis | null);
      setAssets(saved.assets || []);
      setAssetNames(saved.assetNames || []);
      setVideoName(saved.videoName || "");
      setRenderFormat(saved.renderFormat || "16:9");
      setMessage("Projeto salvo restaurado deste navegador.");
    }).catch(() => undefined);
    if ("speechSynthesis" in window) {
      const loadVoices = () => {
        const available = window.speechSynthesis.getVoices().filter((item) => item.lang.toLowerCase().startsWith("pt-br"));
        setVoices(available);
        if (!voice && available[0]) setVoice(available[0].name);
      };
      loadVoices();
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, []);

  useEffect(() => { saveStoryMemory(memory); }, [memory]);

  const selectedModel = useMemo(() => models.find((item) => item.id === model), [models, model]);
  const canAnalyze = Boolean(apiKey.trim() && model.trim() && assets.length > 0);

  async function loadModels() {
    if (!apiKey.trim()) { setError("Insira sua chave OpenRouter primeiro."); return; }
    setModelsLoading(true); setError(""); setMessage("");
    try {
      const list = await fetchOpenRouterModels(apiKey.trim());
      setModels(list);
      const vision = list.find((item) => item.architecture?.input_modalities?.includes("image"));
      if (vision && !list.some((item) => item.id === model)) setModel(vision.id);
      setMessage(list.length + " modelos carregados do OpenRouter.");
    } catch (err) { setError(err instanceof Error ? err.message : "Não foi possível carregar os modelos."); }
    finally { setModelsLoading(false); }
  }

  function saveKey() {
    storeApiKey(apiKey);
    setMessage(apiKey.trim() ? "Chave disponível somente nesta sessão; ela não é gravada no navegador." : "Chave removida da sessão.");
    setError("");
  }

  function readImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Falha ao ler " + file.name));
      reader.readAsDataURL(file);
    });
  }

  async function captureVideoFrames(file: File) {
    const url = URL.createObjectURL(file);
    setVideoName(file.name);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Não foi possível abrir este vídeo no navegador."));
    });
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const positions = [0.06, 0.18, 0.30, 0.42, 0.54, 0.66, 0.78, 0.92].map((ratio) => Math.max(0, Math.min(Math.max(0, video.duration - 0.15), video.duration * ratio)));
    const frames: string[] = [];
    for (const position of positions) {
      video.currentTime = position;
      await new Promise<void>((resolve) => { video.onseeked = () => resolve(); });
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas não disponível para extrair quadros.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      frames.push(canvas.toDataURL("image/jpeg", 0.78));
    }
    setAssets(frames);
    setAssetNames(frames.map((_, index) => "Quadro " + (index + 1)));
    URL.revokeObjectURL(url);
  }

  async function readImageSegments(file: File): Promise<{ data: string[]; names: string[] }> {
    const source = await readImage(file);
    const image = new Image();
    image.src = source;
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Não foi possível decodificar " + file.name)); });
    if (image.height / image.width < 1.55) return { data: [source], names: [file.name] };
    const sliceHeight = Math.round(image.width * 1.42);
    const data: string[] = []; const names: string[] = [];
    for (let y = 0, index = 0; y < image.height && data.length < 8; y += sliceHeight, index++) {
      const height = Math.min(sliceHeight, image.height - y);
      if (height < image.width * 0.32 && data.length) break;
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas indisponível para dividir a página vertical.");
      context.drawImage(image, 0, y, image.width, height, 0, 0, image.width, height);
      data.push(canvas.toDataURL("image/jpeg", 0.88));
      names.push(file.name + " · parte " + (index + 1));
    }
    return { data, names };
  }

  async function handleFiles(files: FileList | File[]) {
    const selected = Array.from(files);
    if (!selected.length) return;
    setError(""); setMessage("");
    try {
      const video = selected.find((file) => file.type.startsWith("video/"));
      if (video) {
        await captureVideoFrames(video);
        setMessage("3 quadros de referência extraídos do vídeo. O arquivo original permanece no seu computador.");
      } else {
        const images = selected.filter((file) => file.type.startsWith("image/")).slice(0, 8);
        const processed = await Promise.all(images.map(readImageSegments));
        const combined = processed.flatMap((item) => item.data).slice(0, 8);
        const names = processed.flatMap((item) => item.names).slice(0, 8);
        setAssets(combined);
        setAssetNames(names);
        setVideoName("");
        setMessage(combined.length + " quadros prontos. Imagens verticais longas foram divididas automaticamente em segmentos.");
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao importar mídia."); }
  }

  async function analyze() {
    if (!canAnalyze) { setError("Informe a chave, escolha um modelo e envie um vídeo ou imagens. O link do YouTube é apenas uma referência."); return; }
    setBusy(true); setBusyLabel("Analisando quadros e continuidade…"); setError(""); setMessage("");
    try {
      const system = [
        "Você é roteirista, editor e analista visual de uma produção de recaps de manhwa.",
        "Responda em português brasileiro. Trabalhe somente com as imagens e informações fornecidas; não invente fatos visuais que não possa confirmar.",
        "Crie comentários e narração originais, com contextualização e linguagem natural. Não reproduza diálogos extensos ou roteiro protegido.",
        "Considere a memória narrativa para manter nomes, aparência e cronologia. Se houver incerteza, registre-a em continuityNotes.",
        "Retorne SOMENTE JSON válido com: title, synopsis, characters [{name,description,notes}], scenes [{order,description,characters,narration,movement}], script, continuityNotes."
      ].join(" ");
      const prompt = [
        "PROJETO: " + projectName,
        "URL de referência (não presuma que o conteúdo foi baixado): " + (youtubeUrl || "não informada"),
        "VÍDEO/ARQUIVOS: " + (videoName || assetNames.join(", ") || "quadros enviados"),
        "MEMÓRIA DE PERSONAGENS: " + JSON.stringify(memory.characters),
        "EPISÓDIOS ANTERIORES: " + JSON.stringify(memory.episodes.slice(-8)),
        "LORE: " + memory.lore,
        "Analise os quadros anexados. Faça uma sinopse, identifique personagens com descrições consistentes, divida a progressão em cenas, sugira movimentos de câmera e escreva uma narração original com gancho inicial, transições e encerramento."
      ].join("\n\n");
      const raw = await askOpenRouter({ apiKey: apiKey.trim(), model, system, prompt, images: assets });
      const parsed = extractJson<Analysis>(raw);
      if (!parsed.script || !Array.isArray(parsed.scenes)) throw new Error("A resposta veio incompleta. Tente novamente com outro modelo.");
      setAnalysis(parsed);
      setMessage("Análise concluída. Revise a narrativa antes de exportar.");
    } catch (err) { setError(err instanceof Error ? err.message : "Erro durante a análise."); }
    finally { setBusy(false); setBusyLabel(""); }
  }

  function saveEpisode() {
    if (!analysis) return;
    const now = new Date().toISOString();
    const episode: EpisodeMemory = {
      id: crypto.randomUUID(), title: analysis.title || projectName, summary: analysis.synopsis,
      events: analysis.scenes.map((scene) => scene.description), createdAt: now
    };
    const incoming = analysis.characters.map((character): CharacterMemory => ({
      id: crypto.randomUUID(), name: character.name, description: character.description,
      firstSeen: analysis.title || projectName, notes: character.notes || ""
    }));
    setMemory((current) => {
      const known = new Set(current.characters.map((item) => item.name.toLowerCase()));
      return {
        ...current,
        episodes: [...current.episodes, episode],
        characters: [...current.characters, ...incoming.filter((item) => !known.has(item.name.toLowerCase()))]
      };
    });
    setMessage("Episódio e novos personagens salvos na memória narrativa local.");
  }

  function previewNarration() {
    if (!analysis?.script || !("speechSynthesis" in window)) {
      setError("A síntese de voz do navegador não está disponível."); return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(analysis.script);
    utterance.lang = "pt-BR";
    utterance.rate = 1;
    utterance.pitch = 1;
    const selected = voices.find((item) => item.name === voice);
    if (selected) utterance.voice = selected;
    window.speechSynthesis.speak(utterance);
  }

  function stopNarration() { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); }

  async function generateMp3() {
    if (!apiKey.trim() || !ttsModel.trim() || !analysis?.script.trim()) {
      setError("Informe a chave OpenRouter, o ID de um modelo TTS compatível e gere um roteiro.");
      return;
    }
    setTtsBusy(true); setError(""); setMessage("");
    try {
      const audio = await openRouterTask(apiKey.trim(), "/audio/speech", {
        model: ttsModel.trim(), input: analysis.script, voice: ttsVoice.trim() || "alloy", response_format: "mp3",
      });
      if (!(audio instanceof Blob)) throw new Error("O endpoint TTS não retornou um arquivo de áudio.");
      setTtsAudio(audio);
      const url = URL.createObjectURL(audio);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = projectName.replace(/[^a-z0-9-_]+/gi, "-") + "-narracao.mp3";
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("Narração MP3 gerada e anexada à linha do tempo para renderização.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao gerar narração MP3.");
    } finally { setTtsBusy(false); }
  }

  async function renderEpisode() {
    if (!analysis?.scenes?.length || !assets.length) {
      setError("Gere o roteiro e importe imagens ou quadros antes de renderizar.");
      return;
    }
    if (!("MediaRecorder" in window) || !HTMLCanvasElement.prototype.captureStream) {
      setError("Este navegador não oferece gravação de vídeo por Canvas. Use a versão mais recente do Chrome ou Edge.");
      return;
    }
    setRenderBusy(true); setRenderProgress(0); setError(""); setMessage("");
    let audioElement: HTMLAudioElement | null = null;
    let audioUrl = "";
    try {
      const width = renderFormat === "16:9" ? 1280 : 720;
      const height = renderFormat === "16:9" ? 720 : 1280;
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Não foi possível iniciar o renderizador Canvas.");
      const decoded = await Promise.all(assets.map((src) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error("Uma imagem do projeto não pôde ser decodificada.")); image.src = src;
      })));
      const weights = analysis.scenes.map((scene) => Math.max(1, (scene.narration || scene.description).split(/\\s+/).length));
      const weightTotal = weights.reduce((sum, value) => sum + value, 0);
      const durations = ttsAudio ? weights.map((value) => value / weightTotal) : weights.map(() => 1 / weights.length);
      let totalMs = 0;
      if (ttsAudio) {
        audioUrl = URL.createObjectURL(ttsAudio);
        audioElement = new Audio(audioUrl);
        audioElement.preload = "auto";
        await new Promise<void>((resolve, reject) => {
          audioElement!.onloadedmetadata = () => resolve();
          audioElement!.onerror = () => reject(new Error("Não foi possível abrir o áudio TTS para sincronizar o vídeo."));
        });
        totalMs = audioElement.duration * 1000;
      } else {
        totalMs = Math.max(5, analysis.scenes.length * 5) * 1000;
      }
      const sceneEnds: number[] = [];
      let accumulated = 0;
      durations.forEach((ratio) => { accumulated += ratio * totalMs; sceneEnds.push(accumulated); });
      const stream = canvas.captureStream(30);
      if (audioElement) {
        const capture = (audioElement as HTMLAudioElement & { captureStream?: () => MediaStream }).captureStream;
        if (!capture) throw new Error("Este navegador não permite capturar a faixa de áudio. Atualize o Chrome ou Edge.");
        capture.call(audioElement).getAudioTracks().forEach((track) => stream.addTrack(track));
      }
      const mime = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus"].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime) throw new Error("Nenhum codec de gravação compatível foi encontrado neste navegador.");
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
      const chunks: BlobPart[] = [];
      const completed = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error("O navegador interrompeu a gravação do vídeo."));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      });
      const wrap = (text: string, maxWidth: number, maxLines: number) => {
        const words = text.split(/\\s+/); const lines: string[] = []; let line = "";
        for (const word of words) {
          const candidate = line ? line + " " + word : word;
          if (context.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word; }
          else line = candidate;
          if (lines.length === maxLines) break;
        }
        if (line && lines.length < maxLines) lines.push(line);
        return lines;
      };
      const draw = (elapsed: number) => {
        const index = Math.min(sceneEnds.findIndex((end) => elapsed < end), analysis.scenes.length - 1);
        const sceneIndex = index < 0 ? analysis.scenes.length - 1 : index;
        const scene = analysis.scenes[sceneIndex];
        const image = decoded[sceneIndex % decoded.length];
        const sceneStart = sceneIndex ? sceneEnds[sceneIndex - 1] : 0;
        const sceneDuration = Math.max(1, sceneEnds[sceneIndex] - sceneStart);
        const progress = Math.max(0, Math.min(1, (elapsed - sceneStart) / sceneDuration));
        const zoom = 1.02 + progress * 0.07;
        const scale = Math.max(width / image.width, height / image.height) * zoom;
        const drawWidth = image.width * scale; const drawHeight = image.height * scale;
        const pan = (progress - 0.5) * width * 0.035;
        context.fillStyle = "#08090c"; context.fillRect(0, 0, width, height);
        context.drawImage(image, (width - drawWidth) / 2 - pan, (height - drawHeight) / 2, drawWidth, drawHeight);
        const shade = context.createLinearGradient(0, 0, 0, height);
        shade.addColorStop(0, "rgba(0,0,0,.28)"); shade.addColorStop(.38, "rgba(0,0,0,.08)"); shade.addColorStop(1, "rgba(0,0,0,.88)");
        context.fillStyle = shade; context.fillRect(0, 0, width, height);
        context.fillStyle = "#ef3340"; context.fillRect(width * .07, height * .72, width * .09, 7);
        context.fillStyle = "#ffffff"; context.font = "700 " + Math.round(width * .025) + "px Arial";
        context.fillText(projectName.toUpperCase().slice(0, 42), width * .07, height * .12);
        context.font = "700 " + Math.round(width * .043) + "px Arial";
        const titleLines = wrap(scene.description, width * .84, 3);
        titleLines.forEach((line, lineIndex) => context.fillText(line, width * .07, height * .80 + lineIndex * height * .055));
        context.font = "500 " + Math.round(width * .024) + "px Arial";
        const caption = scene.narration || scene.description;
        const captionLines = wrap(caption, width * .84, 3);
        captionLines.forEach((line, lineIndex) => context.fillText(line, width * .07, height * .91 + lineIndex * height * .032));
        context.fillStyle = "#ef3340"; context.font = "700 " + Math.round(width * .018) + "px Arial";
        context.fillText(String(sceneIndex + 1).padStart(2, "0") + " / " + String(analysis.scenes.length).padStart(2, "0"), width * .86, height * .12);
      };
      recorder.start(500);
      const startTime = performance.now();
      if (audioElement) await audioElement.play();
      while (true) {
        const elapsed = Math.min(performance.now() - startTime, totalMs);
        draw(elapsed);
        setRenderProgress(Math.round((elapsed / totalMs) * 100));
        if (elapsed >= totalMs) break;
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
      if (audioElement) audioElement.pause();
      await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      recorder.stop();
      const blob = await completed;
      stream.getTracks().forEach((track) => track.stop());
      if (!blob.size) throw new Error("O arquivo de vídeo ficou vazio. Tente novamente.");
      if (renderedVideo) URL.revokeObjectURL(renderedVideo);
      const url = URL.createObjectURL(blob);
      setRenderedVideo(url);
      const extension = blob.type.includes("mp4") ? "mp4" : "webm";
      const link = document.createElement("a"); link.href = url;
      link.download = projectName.replace(/[^a-z0-9-_]+/gi, "-") + "-recap." + extension;
      link.click();
      setRenderProgress(100);
      setMessage("Vídeo renderizado e baixado (" + extension.toUpperCase() + "). " + (ttsAudio ? "Narração sincronizada incluída." : "Renderização sem narração; gere TTS para incluir áudio."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao renderizar o episódio.");
    } finally {
      if (audioElement) audioElement.pause();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setRenderBusy(false);
    }
  }

  async function saveCurrentProject() {
    setProjectSaving(true); setError(""); setMessage("");
    try {
      await saveStudioProject({ projectName, youtubeUrl, analysis, assets, assetNames, videoName, renderFormat, ttsAudio, renderedVideo: renderedBlob });
      setMessage("Projeto salvo neste navegador. Você poderá reabri-lo neste dispositivo.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar o projeto.");
    } finally { setProjectSaving(false); }
  }

  function exportProject() {
    const payload = { version: "4.0", projectName, sourceUrl: youtubeUrl, analysis, memory, exportedAt: new Date().toISOString() };
    downloadText(projectName.replace(/[^a-z0-9-_]+/gi, "-") + "-projeto.json", JSON.stringify(payload, null, 2), "application/json");
  }

  const nav = [
    { id: "studio", label: "Estúdio", icon: Clapperboard },
    { id: "memory", label: "Memória narrativa", icon: BrainCircuit },
    { id: "timeline", label: "Linha do tempo", icon: Layers3 },
    { id: "settings", label: "Configurações", icon: Settings2 }
  ];

  return (
    <div className="studio-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><Film size={20}/></div><div><strong>MANHWA<span>RECREATOR</span></strong><small>STUDIO PRO · V4.0</small></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          {nav.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} className={activeTab === item.id ? "nav-item active" : "nav-item"} onClick={() => setActiveTab(item.id)}><Icon size={17}/><span>{item.label}</span>{item.id === "memory" && <em>{memory.episodes.length}</em>}</button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-badge"><span className="pulse-dot"/> Dados salvos neste navegador</div>
          <div className="sidebar-version">v4.0.0 · Preview de desenvolvimento</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Projetos</span><b>/</b><strong>{projectName}</strong></div>
          <div className="top-actions"><span className="connection"><span className={apiKey ? "status-dot online" : "status-dot"}/>{apiKey ? "OpenRouter configurável" : "API não configurada"}</span><button className="icon-button" title="Configurações" onClick={() => setActiveTab("settings")}><Settings2 size={18}/></button><div className="avatar">MR</div></div>
        </header>

        <div className="page-content">
          {activeTab === "studio" && <>
            <section className="welcome-row">
              <div><div className="eyebrow"><Sparkles size={14}/> SEU ESTÚDIO DE PRODUÇÃO COM IA</div><h1>Crie recaps que <span>prendem a atenção.</span></h1><p>Transforme referências visuais em narrativas originais, com continuidade entre episódios.</p></div>
              <div className="version-chip"><span/> STUDIO PRO <b>4.0</b></div>
            </section>

            <section className="project-bar panel">
              <div className="project-icon"><FolderOpen size={19}/></div>
              <div className="project-field"><label>NOME DO PROJETO</label><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Ex.: Solo Necromancer — Capítulo 01"/></div>
              <div className="project-stats"><div><small>PERSONAGENS</small><strong>{memory.characters.length.toString().padStart(2, "0")}</strong></div><div><small>EPISÓDIOS NA MEMÓRIA</small><strong>{memory.episodes.length.toString().padStart(2, "0")}</strong></div></div><div className="project-actions"><button className="outline-button" onClick={saveCurrentProject} disabled={projectSaving}>{projectSaving ? <LoaderCircle className="spin" size={14}/> : <Check size={14}/>} Salvar projeto</button><button className="outline-button" onClick={() => void loadStudioProject().then((saved) => { if (!saved) { setError("Ainda não existe um projeto salvo neste navegador."); return; } setProjectName(saved.projectName); setYoutubeUrl(saved.youtubeUrl); setAnalysis(saved.analysis as Analysis | null); setAssets(saved.assets); setAssetNames(saved.assetNames); setVideoName(saved.videoName); setRenderFormat(saved.renderFormat); setTtsAudio(saved.ttsAudio || null); setRenderedBlob(saved.renderedVideo || null); if (saved.renderedVideo) setRenderedVideo(URL.createObjectURL(saved.renderedVideo)); setMessage("Projeto restaurado."); }).catch((err) => setError(err instanceof Error ? err.message : "Falha ao restaurar projeto."))}><FolderOpen size={14}/> Abrir salvo</button></div>
            </section>

            <div className="section-heading"><div><span className="step-number">01</span><div><h2>Importar conteúdo</h2><p>Use uma URL como referência e envie o arquivo autorizado para análise visual.</p></div></div><span className="subtle-tag"><ShieldCheck size={13}/> Conteúdo próprio ou autorizado</span></div>
            <section className="import-grid">
              <div className="panel import-card">
                <div className="card-title"><div className="mini-icon red"><FileVideo size={17}/></div><div><h3>Link do YouTube</h3><p>Referência do episódio</p></div></div>
                <label className="field-label">URL DO VÍDEO</label>
                <div className="url-input"><span>▶</span><input value={youtubeUrl} onChange={(event) => setYoutubeUrl(event.target.value)} placeholder="https://youtube.com/watch?v=..."/></div>
                <p className="helper">O link é registrado no projeto. O navegador não baixa vídeos do YouTube automaticamente; envie também o arquivo que você tem direito de usar.</p>
                <div className="input-divider"><span>OU ADICIONE ARQUIVOS LOCAIS</span></div>
                <button className="upload-zone compact" onClick={() => fileRef.current?.click()}><Upload size={19}/><strong>Selecionar vídeo ou imagens</strong><small>MP4, WebM, JPG, PNG · até 8 imagens</small></button>
                <input ref={fileRef} type="file" accept="video/*,image/*" multiple hidden onChange={(event) => event.target.files && handleFiles(event.target.files)}/>
                {videoName && <div className="file-pill"><FileVideo size={15}/>{videoName}<Check size={14}/></div>}
                {assetNames.length > 0 && <div className="asset-count"><FileImage size={14}/>{assets.length} quadro(s) prontos para análise</div>}
              </div>

              <div className="panel import-card">
                <div className="card-title"><div className="mini-icon purple"><ScanEye size={17}/></div><div><h3>Referências visuais</h3><p>Quadros enviados para o modelo de visão</p></div></div>
                <div className="frame-grid">
                  {assets.length ? assets.slice(0, 3).map((asset, index) => <div className="frame-thumb" key={asset}><img src={asset} alt={"Quadro " + (index + 1)}/><span>FRAME 0{index + 1}</span></div>) : <div className="empty-frames"><FileImage size={28}/><strong>Nenhum quadro adicionado</strong><span>Envie um vídeo para extrair 3 quadros ou selecione imagens.</span></div>}
                </div>
                <div className="frame-footer"><span><span className="status-dot online"/> Processamento no navegador</span><button className="text-button" onClick={() => fileRef.current?.click()}>Adicionar arquivos <Plus size={14}/></button></div>
              </div>
            </section>

            <div className="section-heading"><div><span className="step-number">02</span><div><h2>Inteligência narrativa</h2><p>Configure o modelo e gere uma análise conectada à memória da história.</p></div></div><span className="subtle-tag"><LockKeyhole size={13}/> Chave protegida durante a sessão</span></div>
            <section className="panel ai-panel">
              <div className="ai-top"><div className="ai-logo"><BrainCircuit size={20}/></div><div><h3>OpenRouter AI Engine</h3><p>Catálogo dinâmico OpenRouter: visão, texto e outras modalidades conforme o modelo.</p></div><div className="provider-tag">OPENROUTER</div></div>
              <div className="ai-controls">
                <div className="control-group key-group"><label>CHAVE DE API</label><div className="key-input"><KeyRound size={15}/><input type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="sk-or-v1-..."/><button onClick={() => setShowKey(!showKey)}>{showKey ? "Ocultar" : "Mostrar"}</button></div></div>
                <div className="control-group model-group"><label>MODELO DE IA</label><div className="select-wrap"><select value={model} onChange={(event) => setModel(event.target.value)}>{models.length ? models.filter((item) => !assets.length || item.architecture?.input_modalities?.includes("image")).slice(0, 500).map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>) : <><option value="google/gemini-2.5-flash">Google Gemini 2.5 Flash (padrão)</option><option value="openai/gpt-4.1-mini">OpenAI GPT-4.1 Mini</option><option value="anthropic/claude-sonnet-4">Anthropic Claude Sonnet 4</option></>}</select><ChevronDown size={15}/></div></div>
                <button className="outline-button refresh-button" onClick={loadModels} disabled={modelsLoading}>{modelsLoading ? <LoaderCircle className="spin" size={15}/> : <Activity size={15}/>} Atualizar modelos</button>
                <button className="outline-button save-key" onClick={saveKey}><Check size={15}/> Usar nesta sessão</button>
              </div>
              <div className="ai-foot"><span><ShieldCheck size={14}/> A chave permanece somente na memória desta sessão e é encaminhada pelo backend Lovable. Não a compartilhe.</span><span>{selectedModel ? selectedModel.id + " · " + (selectedModel.architecture?.input_modalities?.join("/") || "modalidade não informada") + " → " + (selectedModel.architecture?.output_modalities?.join("/") || "saída não informada") + (selectedModel.context_length ? " · " + selectedModel.context_length.toLocaleString("pt-BR") + " tokens" : "") : "Modelo padrão"}</span></div>
            </section>

            <div className="action-row"><div><div className="memory-hint"><BrainCircuit size={16}/><span><strong>Memória ativa:</strong> a IA consultará {memory.characters.length} personagens e {memory.episodes.length} episódios anteriores.</span></div>{busy && <div className="progress-line"><span/><small>{busyLabel}</small></div>}</div><button className="primary-button" disabled={busy || !canAnalyze} onClick={analyze}>{busy ? <LoaderCircle className="spin" size={17}/> : <WandSparkles size={17}/>} {busy ? "Analisando..." : "Analisar e criar roteiro"} <span>→</span></button></div>
            {error && <div className="notice error"><X size={16}/>{error}</div>}
            {message && <div className="notice success"><Check size={16}/>{message}</div>}

            {analysis && <section className="results-section">
              <div className="section-heading"><div><span className="step-number">03</span><div><h2>Resultado da análise</h2><p>Revise o conteúdo gerado antes de registrar na memória.</p></div></div><span className="subtle-tag success-tag"><Check size={13}/> Análise concluída</span></div>
              <div className="panel result-panel">
                <div className="result-header"><div><div className="eyebrow">NARRATIVA DO EPISÓDIO</div><h2>{analysis.title}</h2></div><button className="outline-button" onClick={saveEpisode}><BookOpen size={15}/> Salvar na memória</button></div>
                <p className="synopsis">{analysis.synopsis}</p>
                <div className="result-columns"><div><h3><MessageSquareText size={16}/> Roteiro original</h3><textarea className="script-editor" value={analysis.script} onChange={(event) => setAnalysis({ ...analysis, script: event.target.value })}/><div className="script-actions"><div className="voice-select"><Mic2 size={15}/><select value={voice} onChange={(event) => setVoice(event.target.value)}><option value="">Voz padrão do navegador</option>{voices.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></div><button className="outline-button" onClick={previewNarration}><Play size={14}/> Ouvir prévia</button><button className="icon-button" onClick={stopNarration} title="Parar"><X size={16}/></button></div><p className="helper">A prévia usa a voz instalada no navegador. Para gerar MP3 pelo OpenRouter, selecione um modelo compatível com áudio.</p><div className="script-actions"><input className="tts-model-input" value={ttsModel} onChange={(event) => setTtsModel(event.target.value)} list="openrouter-tts-models" placeholder="ID de um modelo TTS disponível no OpenRouter"/><datalist id="openrouter-tts-models">{models.filter((item) => item.architecture?.output_modalities?.includes("audio")).map((item) => <option key={item.id} value={item.id}/>)}</datalist><input className="tts-voice-input" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)} placeholder="Voz (ex.: alloy)"/><button className="outline-button" onClick={generateMp3} disabled={ttsBusy || !apiKey.trim() || !ttsModel.trim()}>{ttsBusy ? <LoaderCircle className="spin" size={14}/> : <AudioLines size={14}/>} Gerar narração MP3</button></div></div>
                <div><h3><ScanEye size={16}/> Cenas identificadas</h3><div className="scene-list">{analysis.scenes.map((scene) => <div className="scene-item" key={scene.order}><div className="scene-number">{String(scene.order).padStart(2, "0")}</div><div><strong>{scene.description}</strong><p>{scene.narration}</p><small>{scene.movement}</small></div></div>)}</div></div></div>
                {analysis.continuityNotes?.length > 0 && <div className="continuity-box"><strong><BrainCircuit size={15}/> Pontos de continuidade</strong><ul>{analysis.continuityNotes.map((note, index) => <li key={index}>{note}</li>)}</ul></div>}
                <div className="result-footer"><button className="outline-button" onClick={() => downloadText("legendas.vtt", buildWebVtt(analysis.script), "text/vtt") }><Download size={15}/> Exportar legendas VTT</button><button className="outline-button" onClick={exportProject}><Download size={15}/> Exportar projeto JSON</button></div>
              </div>
            </section>}
          </>}

          {activeTab === "memory" && <section className="subpage"><div className="eyebrow"><BrainCircuit size={14}/> CONTINUIDADE ENTRE CAPÍTULOS</div><h1>Memória <span>narrativa</span></h1><p className="subpage-intro">Personagens, acontecimentos e informações persistem neste navegador e são enviados ao OpenRouter nas próximas análises.</p><div className="memory-grid"><div className="panel memory-card"><div className="card-title"><div className="mini-icon purple"><UsersIcon/></div><div><h3>Personagens</h3><p>{memory.characters.length} registrados</p></div></div>{memory.characters.length ? memory.characters.map((character) => <div className="memory-entry" key={character.id}><strong>{character.name}</strong><p>{character.description}</p><small>Primeira aparição: {character.firstSeen}</small></div>) : <div className="empty-state">Os personagens identificados serão salvos aqui após você registrar um episódio.</div>}</div><div className="panel memory-card"><div className="card-title"><div className="mini-icon red"><BookOpen size={17}/></div><div><h3>Episódios</h3><p>{memory.episodes.length} registrados</p></div></div>{memory.episodes.length ? memory.episodes.map((episode) => <div className="memory-entry" key={episode.id}><strong>{episode.title}</strong><p>{episode.summary}</p><small>{new Date(episode.createdAt).toLocaleString("pt-BR")}</small></div>) : <div className="empty-state">Salve o resultado de uma análise para criar a memória do primeiro episódio.</div>}</div></div><div className="panel lore-panel"><label>LORE / INFORMAÇÕES FIXAS DO UNIVERSO</label><textarea value={memory.lore} onChange={(event) => setMemory({ ...memory, lore: event.target.value })} placeholder="Adicione regras do universo, nomes oficiais, contexto e detalhes que a IA deve preservar..."/></div><div className="memory-tools"><button className="outline-button" onClick={() => downloadText("memoria-narrativa.json", JSON.stringify(memory, null, 2), "application/json")}><Download size={15}/> Exportar memória</button><button className="outline-button danger-button" onClick={() => { if (confirm("Apagar toda a memória narrativa deste navegador?")) setMemory(emptyMemory); }}><X size={15}/> Limpar memória</button></div></section>}

          {activeTab === "timeline" && <section className="subpage"><div className="eyebrow"><Layers3 size={14}/> MONTAGEM E SINCRONIZAÇÃO</div><h1>Linha do <span>tempo</span></h1><p className="subpage-intro">Estrutura de cenas e narração preparada para uma etapa de renderização conectada a um worker de vídeo.</p><div className="panel timeline-panel"><div className="timeline-head"><div><h3>Sequência do episódio</h3><p>{analysis ? analysis.scenes.length + " cenas prontas para montagem" : "Nenhuma sequência gerada"}</p></div><span className="subtle-tag">Renderizador no navegador</span></div>{analysis?.scenes.map((scene) => <div className="timeline-row" key={scene.order}><span className="timeline-time">{String(scene.order).padStart(2, "0")}</span><div className="timeline-visual"><Film size={16}/><strong>{scene.description}</strong><small>{scene.movement}</small></div><div className="timeline-audio"><AudioLines size={16}/><span>{scene.narration}</span></div></div>) || <div className="empty-state">Gere uma análise no Estúdio para preencher a sequência.</div>}<div className="render-controls"><div><label>FORMATO DO VÍDEO</label><select value={renderFormat} onChange={(event) => setRenderFormat(event.target.value as "16:9" | "9:16")}><option value="16:9">16:9 · YouTube (1280 × 720)</option><option value="9:16">9:16 · Shorts/Reels (720 × 1280)</option></select></div><div className="render-audio-state"><AudioLines size={16}/>{ttsAudio ? "Narração MP3 anexada" : "Sem áudio TTS — renderização silenciosa"}</div><button className="primary-button" disabled={!analysis || renderBusy || !assets.length} onClick={renderEpisode}>{renderBusy ? <LoaderCircle className="spin" size={16}/> : <Film size={16}/>} {renderBusy ? "Renderizando " + renderProgress + "%" : "Renderizar e baixar vídeo"} <span>→</span></button></div>{renderBusy && <div className="render-progress"><span style={{width: renderProgress + "%"}}/></div>}{renderedVideo && <video className="rendered-preview" src={renderedVideo} controls/>}<div className="render-warning"><Cloud size={18}/><div><strong>Renderização real no navegador</strong><p>O editor compõe imagens, movimentos suaves, títulos e legendas em um vídeo gravado pelo navegador. O arquivo será MP4 quando o navegador oferecer esse codec; caso contrário, será WebM. Gere a narração TTS antes para sincronizar o áudio.</p></div></div></div><div className="format-grid"><div className="panel format-card"><strong>16:9 · Horizontal</strong><div className="format-preview wide"><Film size={20}/></div><small>1920 × 1080 · YouTube</small></div><div className="panel format-card"><strong>9:16 · Vertical</strong><div className="format-preview tall"><Film size={20}/></div><small>1080 × 1920 · Shorts / Reels</small></div></div></section>}

          {activeTab === "settings" && <section className="subpage"><div className="eyebrow"><Settings2 size={14}/> PREFERÊNCIAS DO PROJETO</div><h1>Configurações</h1><p className="subpage-intro">Gerencie sua conexão de IA, dados locais e exportação.</p><div className="panel settings-panel"><div className="settings-row"><div><strong>OpenRouter API</strong><p>Chave temporária da sessão para chamadas ao OpenRouter pelo backend Lovable.</p></div><span className={apiKey ? "setting-state good" : "setting-state"}>{apiKey ? "Configurada" : "Pendente"}</span></div><div className="settings-row"><div><strong>Memória narrativa</strong><p>Armazenada no localStorage deste navegador, sem sincronização entre dispositivos.</p></div><span className="setting-state good">Ativa</span></div><div className="settings-row"><div><strong>Dados de origem</strong><p>Arquivos enviados são processados localmente para extrair quadros de referência.</p></div><span className="setting-state good">Local</span></div><div className="settings-row"><div><strong>Exportação de roteiro</strong><p>Baixe o projeto em JSON e as legendas em WebVTT.</p></div><button className="outline-button" onClick={exportProject} disabled={!analysis}><Download size={14}/> Exportar</button></div></div><div className="panel privacy-panel"><LockKeyhole size={20}/><div><strong>Privacidade da chave</strong><p>A chave não é salva no localStorage nem no código. Ela permanece na memória da sessão e é encaminhada à rota privada do servidor do aplicativo, sem ser persistida pelo projeto.</p></div></div></section>}

          <footer className="page-footer"><span>MANHWA RECREATOR STUDIO <b>V4.0</b></span><span>Feito para contar histórias. <Sparkles size={12}/></span></footer>
        </div>
      </main>
    </div>
  );
}

function UsersIcon() { return <Activity size={17}/>; }
