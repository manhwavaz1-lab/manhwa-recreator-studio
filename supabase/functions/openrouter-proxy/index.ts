const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const allowedPaths = new Set([
  "/models", "/chat/completions", "/images", "/audio/speech",
  "/audio/transcriptions", "/embeddings", "/videos",
]);

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const raw = await request.text();
    if (raw.length > 30_000_000) return json({ error: "Request too large (max 30 MB)." }, 413);
    const input = JSON.parse(raw) as { apiKey?: string; path?: string; method?: string; body?: unknown };
    const apiKey = input.apiKey?.trim();
    const path = input.path || "";
    if (!apiKey || !apiKey.startsWith("sk-or-")) return json({ error: "Informe uma chave OpenRouter válida." }, 400);
    if (!allowedPaths.has(path)) return json({ error: "OpenRouter endpoint not allowed." }, 400);
    const method = path === "/models" ? "GET" : "POST";
    const upstream = await fetch("https://openrouter.ai/api/v1" + path, {
      method,
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": request.headers.get("origin") || "https://lovable.app",
        "X-Title": "Manhwa Recreator Studio",
      },
      ...(method === "POST" ? { body: JSON.stringify(input.body ?? {}) } : {}),
    });
    const contentType = upstream.headers.get("content-type") || "application/json";
    const data = await upstream.arrayBuffer();
    return new Response(data, { status: upstream.status, headers: { ...corsHeaders, "Content-Type": contentType, "Cache-Control": "no-store" } });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unexpected proxy error" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
