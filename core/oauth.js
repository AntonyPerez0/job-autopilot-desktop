// "Connect with OpenRouter": the person signs in on OpenRouter in their own browser and presses Authorize, and the
// app receives a key for their account, with nothing to copy or paste (OpenRouter's OAuth PKCE flow). The browser
// comes back to a one-time address on this computer (localhost, a free port), only listened to until it does, for at
// most 10 minutes; the code it brings is worth nothing without this app's secret verifier.
import crypto from "node:crypto";
import http from "node:http";

const AUTH = "https://openrouter.ai/auth";
const EXCHANGE = "https://openrouter.ai/api/v1/auth/keys";
const b64url = (buf) => Buffer.from(buf).toString("base64url");

let pending = null;
export const cancelConnect = () => { if (pending) pending.cancel(); };

const PAGE = (title, text) => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<body style="font:16px system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1d2230">
<h1 style="font-size:1.4rem">${title}</h1><p>${text}</p></body>`;

// open(url) opens the person's browser. -> the new key. timeoutMs: how long to wait for them.
export async function connectOpenRouter(open, { timeoutMs = 10 * 60000, auth = AUTH, exchange = EXCHANGE } = {}) {
  if (pending) pending.cancel();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const servers = [];
  let finish;
  const done = new Promise((resolve, reject) => { finish = { resolve, reject }; });
  const onRequest = (req, res) => {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
    const code = u.searchParams.get("code"), back = u.searchParams.get("state");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (!code || back !== state) {
      res.end(PAGE("Not connected", "OpenRouter didn't send the app a sign-in. Go back to Job Autopilot and press Connect with OpenRouter again."));
      finish.reject(new Error("OpenRouter didn't finish the sign-in. Press Connect with OpenRouter to try again."));
      return;
    }
    res.end(PAGE("Connected", "Job Autopilot is connected to your OpenRouter account. You can close this tab and go back to the app."));
    finish.resolve(code);
  };
  // localhost can mean 127.0.0.1 or ::1 to a browser: the same port on both, and nothing else on the network.
  const first = http.createServer(onRequest);
  await new Promise((r, j) => first.once("error", j).listen(0, "127.0.0.1", r));
  servers.push(first);
  const port = first.address().port;
  const second = http.createServer(onRequest);
  await new Promise((r) => second.once("error", () => r()).listen(port, "::1", () => { servers.push(second); r(); }));
  const close = () => { for (const s of servers) s.close(); };
  const timer = setTimeout(() => finish.reject(new Error("OpenRouter didn't answer in 10 minutes. Press Connect with OpenRouter to try again.")), timeoutMs);
  pending = { cancel: () => finish.reject(new Error("cancelled")) };
  try {
    const callback = `http://localhost:${port}/callback`;
    await open(`${auth}?${new URLSearchParams({ callback_url: callback, code_challenge: challenge, code_challenge_method: "S256", state, key_label: "Job Autopilot" })}`);
    const code = await done;
    const res = await fetch(exchange, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.key) throw new Error(`OpenRouter didn't give the app a key (${res.status}${data.error ? ": " + (data.error.message || data.error) : ""}). Press Connect with OpenRouter to try again.`);
    return data.key;
  } finally { clearTimeout(timer); close(); pending = null; }
}
