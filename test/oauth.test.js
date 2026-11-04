// Connect with OpenRouter (OAuth PKCE): the browser goes to OpenRouter and comes back to the app with a code, which
// is exchanged with the app's secret verifier for a key. OpenRouter is mocked; the "browser" is this test.
import test from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import http from "node:http";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const vault = new Map();
store.setSecretStore({ get: (k) => vault.get(k) || "", set: (k, v) => vault.set(k, v) });
const O = await import("../core/oauth.js");

// OpenRouter's key exchange, mocked: a key only for the right code and the verifier behind the challenge.
let challenge = "", credit = true;
const exchanged = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, opts = {}) => {
  const url = String(u);
  if (url === "https://openrouter.ai/api/v1/auth/keys") {
    const b = JSON.parse(opts.body);
    exchanged.push(b);
    const ok = b.code === "the-code" && b.code_challenge_method === "S256" && crypto.createHash("sha256").update(b.code_verifier).digest("base64url") === challenge;
    return new Response(JSON.stringify(ok ? { key: "sk-or-v1-test" } : { error: { message: "Invalid code or code_verifier" } }), { status: ok ? 200 : 403 });
  }
  if (url === "https://openrouter.ai/api/v1/chat/completions") {
    assert.strictEqual(opts.headers.Authorization || opts.headers.authorization, "Bearer sk-or-v1-test");
    return credit ? new Response(JSON.stringify({ choices: [{ message: { content: '{"ok": true}' } }] }), { status: 200 })
      : new Response(JSON.stringify({ error: { message: "Insufficient credits" } }), { status: 402 });
  }
  return realFetch(u, opts);
};
test.after(() => { globalThis.fetch = realFetch; });

// The person's browser: it opens OpenRouter's page and, after Authorize, comes back to the app.
const browser = (how = "authorize") => async (url) => {
  const u = new URL(url);
  assert.strictEqual(u.origin + u.pathname, "https://openrouter.ai/auth");
  assert.strictEqual(u.searchParams.get("code_challenge_method"), "S256");
  challenge = u.searchParams.get("code_challenge");
  const back = new URL(u.searchParams.get("callback_url"));
  assert.strictEqual(back.hostname, "localhost", "back to this computer only");
  if (how === "wait") return;
  back.searchParams.set("code", "the-code");
  back.searchParams.set("state", how === "forged" ? "someone-else" : u.searchParams.get("state"));
  setTimeout(() => http.get(`http://127.0.0.1:${back.port}${back.pathname}${back.search}`, (r) => { r.resume(); }), 20);
};

test("the browser comes back with a code; it's exchanged with the secret verifier for a key", async () => {
  exchanged.length = 0;
  assert.strictEqual(await O.connectOpenRouter(browser()), "sk-or-v1-test");
  assert.strictEqual(exchanged.length, 1);
});

test("a code from someone else's sign-in, a cancel, or no answer: no key", async () => {
  await assert.rejects(O.connectOpenRouter(browser("forged")), /didn't finish the sign-in/);
  const p = O.connectOpenRouter(browser("wait"));
  setTimeout(O.cancelConnect, 50);
  await assert.rejects(p, /cancelled/);
  await assert.rejects(O.connectOpenRouter(browser("wait"), { timeoutMs: 100 }), /10 minutes/);
  // The address it listened on is closed afterwards.
  let port;
  await assert.rejects(O.connectOpenRouter(async (url) => { port = new URL(new URL(url).searchParams.get("callback_url")).port; }, { timeoutMs: 50 }));
  await assert.rejects(new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}/callback`, resolve).on("error", reject)), /ECONNREFUSED/);
});

test("Connect with OpenRouter in the app: the key is kept, the AI is set to OpenRouter, an account with no credit is told so", async () => {
  const api = await import("../core/api.js");
  assert.match((await api.handle("/api/ai/openrouter", {})).error, /window/, "no browser to open yet");
  api.setOpener(browser());
  const r = await api.handle("/api/ai/openrouter", {});
  assert.deepStrictEqual([r.ok, r.hasKey, r.warning], [true, true, undefined]);
  assert.strictEqual(vault.get("apiKey"), "sk-or-v1-test");
  const ai = store.getSettings().ai;
  assert.deepStrictEqual([ai.provider, ai.apiBase], ["openrouter", "https://openrouter.ai/api/v1"]);
  credit = false;
  const r2 = await api.handle("/api/ai/openrouter", {});
  assert.ok(r2.ok, "still connected");
  assert.match(r2.warning, /out of credit/);
  api.setOpener(browser("wait"));
  const p = api.handle("/api/ai/openrouter", {});
  setTimeout(() => api.handle("/api/ai/openrouter/cancel", {}), 50);
  assert.match((await p).error, /Cancelled/);
});

test("settings for the background: only true or false, and the dismissed list stays short strings", async () => {
  const api = await import("../core/api.js");
  const s = await api.handle("/api/settings", { keepRunning: 0, openAtLogin: "yes", notifications: true, setupStep: 99, touredAt: true, dismissed: ["mailbox-tip", 5, "x".repeat(200)] });
  assert.deepStrictEqual([s.keepRunning, s.openAtLogin, s.notifications, s.setupStep], [false, true, true, 10]);
  assert.ok(Date.parse(s.touredAt));
  assert.deepStrictEqual(s.dismissed, ["mailbox-tip", "x".repeat(60)]);
});
