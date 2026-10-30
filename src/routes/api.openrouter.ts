import { createFileRoute } from "@tanstack/react-router";

const allowedPaths = new Set([
  "/models",
  "/chat/completions",
  "/images",
  "/audio/speech",
  "/audio/transcriptions",
  "/embeddings",
  "/videos",
]);

type ProxyInput = {
  apiKey?: string;
  path?: string;
  body?: Record<string, unknown>;
};

async function handleOpenRouter(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 30_000_000) {
      return Response.json({ error: "A solicitação excede o limite de 30 MB." }, { status: 413 });
    }

    const input = JSON.parse(raw) as ProxyInput;
    const apiKey = input.apiKey?.trim();
    const path = input.path || "";

    if (!apiKey || !apiKey.startsWith("sk-or-")) {
      return Response.json({ error: "Informe uma chave OpenRouter válida." }, { status: 400 });
    }
    if (!allowedPaths.has(path)) {
      return Response.json({ error: "Endpoint OpenRouter não permitido." }, { status: 400 });
    }

    const method = path === "/models" ? "GET" : "POST";
    const headers: Record<string, string> = {
      Authorization: "Bearer " + apiKey,
      "HTTP-Referer": new URL(request.url).origin,
      "X-Title": "Manhwa Recreator Studio",
    };

    let upstreamBody: BodyInit | undefined;
    if (method === "POST") {
      if (path === "/audio/transcriptions") {
        const audio = input.body as {
          fileBase64?: string;
          filename?: string;
          model?: string;
          language?: string;
          prompt?: string;
        } | undefined;
        if (!audio?.fileBase64 || !audio.model) {
          return Response.json({ error: "A transcrição exige arquivo de áudio e modelo." }, { status: 400 });
        }
        const binary = Uint8Array.from(atob(audio.fileBase64), (char) => char.charCodeAt(0));
        const form = new FormData();
        form.append("file", new Blob([binary]), audio.filename || "audio.mp3");
        form.append("model", audio.model);
        if (audio.language) form.append("language", audio.language);
        if (audio.prompt) form.append("prompt", audio.prompt);
        upstreamBody = form;
      } else {
        headers["Content-Type"] = "application/json";
        upstreamBody = JSON.stringify(input.body ?? {});
      }
    }

    const upstream = await fetch("https://openrouter.ai/api/v1" + path, {
      method,
      headers,
      ...(upstreamBody ? { body: upstreamBody } : {}),
    });

    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", upstream.headers.get("content-type") || "application/json");
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Content-Type-Options", "nosniff");

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Falha inesperada no proxy OpenRouter." },
      { status: 500 },
    );
  }
}

export const Route = createFileRoute("/api/openrouter")({
  server: {
    handlers: {
      POST: ({ request }) => handleOpenRouter(request),
    },
  },
});
