// Model requests: local servers (Ollama's own API with a context length, LM Studio
// without JSON mode), and which settings count as local.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { aiFetch, isLocal, providerOf, timeoutMs } from "../core/llm.js";

function server(handler) {
  return new Promise((resolve) => {
    const seen = [];
    const s = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => { seen.push({ url: req.url, body: body ? JSON.parse(body) : null }); handler(req, res, body ? JSON.parse(body) : null); });
    });
    s.listen(0, "127.0.0.1", () => resolve({ s, seen, base: `http://127.0.0.1:${s.address().port}` }));
  });
}
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
const chatBody = { model: "m", temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content: "hi" }] };

test("which settings are local", () => {
  assert.strictEqual(providerOf({ apiBase: "https://openrouter.ai/api/v1" }), "openrouter");
  assert.strictEqual(providerOf({ apiBase: "http://127.0.0.1:11434/v1" }), "ollama");
  assert.strictEqual(providerOf({ apiBase: "http://localhost:1234/v1" }), "lmstudio");
  assert.ok(isLocal({ provider: "custom", apiBase: "http://localhost:8080/v1" }), "a llama.cpp server on this computer");
  assert.ok(!isLocal({ provider: "custom", apiBase: "https://api.example.com/v1" }));
  assert.ok(timeoutMs({ provider: "ollama" }) > timeoutMs({ provider: "openrouter" }));
});

test("Ollama: sent to its own API with the context length, answered in the OpenAI shape", async () => {
  const { s, seen, base } = await server((req, res) => json(res, 200, { message: { role: "assistant", content: '{"ok":true}' }, done: true }));
  const r = await aiFetch(base + "/v1/chat/completions", { method: "POST", body: JSON.stringify(chatBody) }, { provider: "ollama", contextLength: 20000 });
  const data = await r.json();
  s.close();
  assert.strictEqual(seen[0].url, "/api/chat");
  assert.strictEqual(seen[0].body.options.num_ctx, 20000);
  assert.strictEqual(seen[0].body.format, "json");
  assert.strictEqual(seen[0].body.stream, false);
  assert.strictEqual(data.choices[0].message.content, '{"ok":true}');
});

test("a server that refuses JSON mode is asked again without it", async () => {
  const { s, seen, base } = await server((req, res, b) => (b.response_format
    ? json(res, 400, { error: "'response_format.type' must be 'json_schema' or 'text'" })
    : json(res, 200, { choices: [{ message: { content: '{"ok":true}' } }] })));
  const r = await aiFetch(base + "/v1/chat/completions", { method: "POST", body: JSON.stringify(chatBody) }, { provider: "lmstudio" });
  s.close();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(seen.length, 2);
  assert.ok(!seen[1].body.response_format);
});
