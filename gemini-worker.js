/*
  IMCure Gemini Proxy — Cloudflare Worker
  ----------------------------------------
  Deploy steps:
    1. Go to https://workers.cloudflare.com → Create Worker
    2. Paste this entire file into the editor → Save & Deploy
    3. Go to Worker Settings → Variables → Add secret:
         Name:  GEMINI_API_KEY
         Value: AIzaSyC9dfsvfNlF0ON38kx37-DGDOs014_zuJQ
    4. Copy your Worker URL (e.g. https://imcure-gemini.yourname.workers.dev)
    5. Paste that URL into chatbot.js  →  proxyUrl: "YOUR_WORKER_URL"
*/

const ALLOWED_ORIGIN = "https://imcure.github.io";
const GEMINI_MODEL   = "gemini-2.0-flash";
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age":       "86400",
};

export default {
  async fetch(request, env) {

    // ── CORS preflight ──────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ── Origin guard — only imcure.github.io may call this ──────
    const origin = request.headers.get("Origin") || "";
    if (origin !== ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403 });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    // ── Parse request body ───────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: { message: "Invalid JSON body" } }, 400);
    }

    // ── Forward to Gemini (API key stays server-side) ────────────
    let geminiResp;
    try {
      geminiResp = await fetch(`${GEMINI_URL}?key=${env.GEMINI_API_KEY}`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          system_instruction: body.system_instruction,
          contents:           body.contents,
          generationConfig:   body.generationConfig,
        }),
      });
    } catch (err) {
      return json({ error: { message: "Upstream fetch failed: " + err.message } }, 502);
    }

    const data   = await geminiResp.json().catch(() => ({}));
    const status = geminiResp.ok ? 200 : geminiResp.status;

    if (!geminiResp.ok) {
      const reason = data?.error?.message || data?.error?.status || "unknown";
      console.error(`[IMCure Worker] Gemini ${status}: ${reason}`);
    }

    return json(data, status);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
