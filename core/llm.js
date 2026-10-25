// Every model request goes through here: a deadline, local servers (Ollama,
// LM Studio) and servers that reject JSON mode. The add-on's Tailor.chat
// speaks the OpenAI chat API; this adapts it without changing the add-on.
import { getSettings } from "./store.js";

export const PROVIDERS = {
  openrouter: { name: "OpenRouter", apiBase: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash", needsKey: true },
  custom: { name: "Another OpenAI-compatible API", apiBase: "", needsKey: true },
  ollama: { name: "Ollama (on this computer)", apiBase: "http://127.0.0.1:11434/v1", local: true, url: "https://ollama.com/download" },
  lmstudio: { name: "LM Studio (on this computer)", apiBase: "http://127.0.0.1:1234/v1", local: true, url: "https://lmstudio.ai" },
};

// Settings saved before providers existed have only a base URL.
export function providerOf(ai) {
  if (ai.provider && PROVIDERS[ai.provider]) return ai.provider;
  if (/openrouter\.ai/.test(ai.apiBase || "")) return "openrouter";
  if (/:11434\b/.test(ai.apiBase || "")) return "ollama";
  if (/:1234\b/.test(ai.apiBase || "")) return "lmstudio";
  return "custom";
}
export const isLocal = (ai) => !!(PROVIDERS[providerOf(ai)] || {}).local || /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(ai.apiBase || "");

// Local models run on the user's own hardware and can be slow: they get far longer.
export function timeoutMs(ai) {
  if (process.env.JA_AI_TIMEOUT_MS) return Number(process.env.JA_AI_TIMEOUT_MS);
  return isLocal(ai) ? 15 * 60000 : 3 * 60000;
}

// Ollama's OpenAI-style endpoint cannot set the context length, and its default is far too
// short for a posting plus a resume. Its own /api/chat can, so requests go there instead.
async function ollamaChat(url, body, ai, signal) {
  const root = url.replace(/\/v1\/chat\/completions$/, "").replace(/\/chat\/completions$/, "");
  const res = await fetch(root + "/api/chat", {
    method: "POST", headers: { "content-type": "application/json" }, signal,
    body: JSON.stringify({
      model: body.model, messages: body.messages, stream: false,
      ...(body.response_format ? { format: "json" } : {}),
      options: { temperature: body.temperature ?? 0.2, num_ctx: Number(ai.contextLength) || 16384 },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return new Response(JSON.stringify({ error: { message: data.error || `Ollama ${res.status}` } }), { status: res.status, headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ choices: [{ message: { content: (data.message && data.message.content) || "" } }] }), { status: 200, headers: { "content-type": "application/json" } });
}

export function aiFetch(url, opts = {}, ai = getSettings().ai) {
  const signal = opts.signal || AbortSignal.timeout(timeoutMs(ai));
  const chat = /\/chat\/completions$/.test(String(url)) && opts.body;
  if (chat && providerOf(ai) === "ollama") return ollamaChat(String(url), JSON.parse(opts.body), ai, signal);
  return fetch(url, { ...opts, signal }).then(async (res) => {
    // Some servers (LM Studio among them) refuse {"type": "json_object"}; ask again without it.
    if (chat && res.status === 400) {
      const text = await res.clone().text();
      if (/response_format|json_object|json_schema/i.test(text)) {
        const body = JSON.parse(opts.body);
        delete body.response_format;
        return fetch(url, { ...opts, body: JSON.stringify(body), signal });
      }
    }
    return res;
  });
}
