export type StudioModel = {
  id: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string; image?: string; request?: string };
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
  supported_parameters?: string[];
};

export type CharacterMemory = { id: string; name: string; description: string; firstSeen: string; notes: string };
export type EpisodeMemory = { id: string; title: string; summary: string; events: string[]; createdAt: string };
export type StoryMemory = { characters: CharacterMemory[]; episodes: EpisodeMemory[]; lore: string };

const MEMORY_KEY = "manhwa-recreator-story-memory-v4";
const LEGACY_KEY_STORAGE = "manhwa-recreator-openrouter-key-v4";
let sessionApiKey = "";

export function getStoredApiKey() {
  try { if (typeof window !== "undefined") window.localStorage.removeItem(LEGACY_KEY_STORAGE); } catch { /* storage may be disabled */ }
  return sessionApiKey;
}
export function storeApiKey(value: string) { sessionApiKey = value.trim(); }

export function loadStoryMemory(): StoryMemory {
  const empty: StoryMemory = { characters: [], episodes: [], lore: "" };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch { return empty; }
}
export function saveStoryMemory(memory: StoryMemory) {
  if (typeof window !== "undefined") window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
}

async function callProxy<T>(apiKey: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/openrouter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, path, body }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string; message?: string };
    throw new Error(payload.error || payload.message || "Falha no proxy OpenRouter (" + response.status + ").");
  }
  return response.json() as Promise<T>;
}

export async function fetchOpenRouterModels(apiKey: string): Promise<StudioModel[]> {
  const payload = await callProxy<{ data?: StudioModel[] }>(apiKey, "/models");
  return payload.data ?? [];
}

export async function askOpenRouter(args: {
  apiKey: string; model: string; system: string; prompt: string; images?: string[];
}) {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: args.prompt }];
  for (const image of args.images ?? []) content.push({ type: "image_url", image_url: { url: image } });
  const payload = await callProxy<{ choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> }>(
    args.apiKey, "/chat/completions",
    { model: args.model, temperature: 0.7, messages: [
      { role: "system", content: args.system },
      { role: "user", content: content.length === 1 ? args.prompt : content },
    ] },
  );
  const result = payload.choices?.[0]?.message?.content;
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.map((part) => part.text ?? "").join("\n");
  throw new Error("O modelo não retornou texto.");
}

/** OpenRouter modality gateway: image generation, TTS, STT, embeddings and video. */
export async function openRouterTask(apiKey: string, endpoint:
  "/images" | "/audio/speech" | "/audio/transcriptions" | "/embeddings" | "/videos" | "/chat/completions",
  body: Record<string, unknown>): Promise<unknown> {
  if (endpoint === "/audio/speech") {
    const response = await fetch("/api/openrouter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, path: endpoint, body }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error || "Falha ao gerar áudio (" + response.status + ").");
    }
    return await response.blob();
  }
  return callProxy<unknown>(apiKey, endpoint, body);
}

export function extractJson<T>(text: string): T {
  const cleaned = text.replace(new RegExp("\\x60{3}json", "gi"), "").replace(new RegExp("\\x60{3}", "g"), "").trim();
  const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("A resposta da IA não contém JSON válido.");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}
export function buildWebVtt(script: string) {
  const parts = script.split(/(?<=[.!?])\s+/).map((line) => line.trim()).filter(Boolean);
  let time = 0;
  const stamp = (seconds: number) => {
    const hours = Math.floor(seconds / 3600).toString().padStart(2, "0");
    const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, "0");
    const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
    return hours + ":" + minutes + ":" + secs + ".000";
  };
  const cues = parts.map((line, index) => {
    const duration = Math.max(2.5, Math.min(7, line.split(/\s+/).length / 2.6));
    const cue = (index + 1) + "\n" + stamp(time) + " --> " + stamp(time + duration) + "\n" + line;
    time += duration; return cue;
  });
  return "WEBVTT\n\n" + cues.join("\n\n");
}
export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime }); const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  URL.revokeObjectURL(url);
}
