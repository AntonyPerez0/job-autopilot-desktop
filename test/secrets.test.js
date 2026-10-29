// Stored secrets go only where they were saved for (security audit 2.1, 2.2): the AI key to the address it
// was saved with, the mailbox app password to the mail server it was saved for.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { tempDataDir } from "./helpers.js";

tempDataDir();
delete process.env.JA_API_KEY;
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const vault = new Map();
store.setSecretStore({ get: (k) => vault.get(k) || "", set: (k, v) => { vault.set(k, v); } });
const { handle } = await import("../core/api.js");

const seen = [];
const server = (name) => http.createServer((req, res) => { seen.push({ name, auth: req.headers.authorization || "" }); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ id: "m" }] })); });
const good = server("saved"), evil = server("other");
await new Promise((r) => good.listen(0, "127.0.0.1", r));
await new Promise((r) => evil.listen(0, "127.0.0.1", r));
test.after(() => { good.close(); evil.close(); });
const at = (s) => `http://127.0.0.1:${s.address().port}/v1`;

test("the saved AI key is never sent to another address; saving a new address without a key clears it", async () => {
  await handle("/api/ai/save", { provider: "custom", apiBase: at(good), apiKey: "sk-saved-secret", model: "m" });
  seen.length = 0;
  await handle("/api/ai/models", { apiBase: at(good) });
  assert.strictEqual(seen.at(-1).auth, "Bearer sk-saved-secret", "its own address gets it");
  seen.length = 0;
  const r = await handle("/api/ai/models", { apiBase: at(evil) });
  assert.ok(!seen.some((x) => /sk-saved-secret/.test(x.auth)), JSON.stringify(seen));
  // (a local address needs no key, so the test runs, without one)
  await handle("/api/ai/test", { provider: "custom", apiBase: at(evil) });
  assert.ok(!seen.some((x) => /sk-saved-secret/.test(x.auth)), "the test request didn't carry it either");
  const s = await handle("/api/ai/save", { apiBase: at(evil) });
  assert.strictEqual(s.hasKey, false, "the old key is not paired with the new address");
  assert.strictEqual(vault.get("apiKey"), "");
  assert.ok(r);
});

test("the saved mailbox password is only for its own server; a new server without a password clears it", async () => {
  await handle("/api/mail/save", { preset: "custom", host: "imap.mail.example", port: 993, user: "jordan@example.com", pass: "app pass word" });
  assert.strictEqual(vault.get("mailPassword"), "apppassword");
  const r = await handle("/api/mail/test", { host: "imap.attacker.example", port: 993, user: "jordan@example.com" });
  assert.match(r.error || "", /only sent to the server it was saved for/);
  await handle("/api/mail/save", { preset: "custom", host: "imap.attacker.example", port: 993, user: "jordan@example.com" });
  assert.strictEqual(vault.get("mailPassword"), "", "cleared, not carried to the new server");
});
