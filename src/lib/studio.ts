export type StudioModel = {
  id: string;
  name?: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; input_modalities?: string[] };
};

export type CharacterMemory = {
  id: string;
  name: string;
  description: string;
  firstSeen: string;
  notes: string;
};

export type EpisodeMemory = {
  id: string;
  title: string;
  summary: string;
  events: string[];
  createdAt: string;
};

export type StoryMemory = {
  characters: CharacterMemory[];
  episodes: EpisodeMemory[];
  lore: string;
};

const MEMORY_KEY = "manhwa-recreator-story-memory-v4";
const KEY_STORAGE = "manhwa-recreator-openrouter-key-v4";

export function getStoredApiKey() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY_STORAGE) ?? "";
}

export function storeApiKey(value: string) {
  if (typeof window !== "undefined") {
    if (value.trim()) window.localStorage.setItem(KEY_STORAGE, value.trim());
    else window.localStorage.removeItem(KEY_STORAGE);
  }
}

export function loadStoryMemory(): StoryMemory {
  const empty: StoryMemory = { characters: [], episodes: [], lore: "" };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(MEMORY_KEY);
    return raw ? { ...empty, ...JSON.parse(raw) } : empty;
  } catch {
    return empty;
  }
}

export function saveStoryMemory(memory: StoryMemory) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  }
}

export async function fetchOpenRouterModels(apiKey: string): Promise<StudioModel[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: "Bearer " + apiKey },
  });
  if (!response.ok) throw new Error("OpenRouter não retornou os modelos (" + response.status + ").");
  const payload = (await response.json()) as { data?: StudioModel[] };
  return payload.data ?? [];
}

export async function askOpenRouter(args: {
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  images?: string[];
}) {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: args.prompt }];
  for (const image of args.images ?? []) {
    content.push({ type: "image_url", image_url: { url: image } });
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + args.apiKey,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Manhwa Recreator Studio",
    },
    body: JSON.stringify({
      model: args.model,
      temperature: 0.7,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: content.length === 1 ? args.prompt : content },
      ],
    }),
  });

  const payload = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Falha na chamada OpenRouter (" + response.status + ").");
  }
  const result = payload.choices?.[0]?.message?.content;
  if (typeof result === "string") return result;
  if (Array.isArray(result)) return result.map((part) => part.text ?? "").join("\n");
  throw new Error("O modelo não retornou texto.");
}

export function extractJson<T>(text: string): T {
  const cleaned = text.replace(new RegExp("\\x60{3}json", "gi"), "").replace(new RegExp("\\x60{3}", "g"), "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
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
    time += duration;
    return cue;
  });
  return "WEBVTT\n\n" + cues.join("\n\n");
}

export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
