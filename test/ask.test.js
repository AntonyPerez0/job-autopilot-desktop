// Delegated model calls are bounded (security audit 3.1): the losing request of a hedged pair is cancelled,
// a rate limit isn't retried at once, attempts back off, and one request from the window has a budget.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const S = await import("../core/studio.js");
const { aiRequest } = await import("../core/llm.js");

let status = 200, hits = 0;
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    hits++;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(status === 200 ? JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: hits }) } }] }) : JSON.stringify({ error: { message: "rate limited" } }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" } });
test.after(() => ai.close());

test("the losing request of a hedged pair is cancelled when the other answers", async () => {
  const aborted = [];
  let n = 0;
  const call = () => {
    const mine = ++n, signal = aiRequest.getStore().signal;
    signal.addEventListener("abort", () => aborted.push(mine));
    return new Promise((r) => setTimeout(() => r(mine), mine === 1 ? 600 : 50));
  };
  const winner = await S.hedged(call, 100);
  assert.strictEqual(winner, 2, "the second, faster one");
  assert.deepStrictEqual(aborted, [1], "the slow first one was aborted");
});

test("a rate limit (429) is not asked again at once", async () => {
  status = 429; hits = 0;
  S.resetAskBudget();
  await assert.rejects(S.ask([{ role: "system", content: "x. Return JSON only" }, { role: "user", content: "rate " + Date.now() }]), /429/);
  assert.strictEqual(hits, 1);
  status = 200;
});

test("one request from the window has a budget of AI calls; each route starts a fresh one", async () => {
  S.resetAskBudget(2);
  await S.ask([{ role: "system", content: "a. Return JSON only" }, { role: "user", content: "1" }]);
  await S.ask([{ role: "system", content: "a. Return JSON only" }, { role: "user", content: "2" }]);
  await assert.rejects(S.ask([{ role: "system", content: "a. Return JSON only" }, { role: "user", content: "3" }]), /more AI calls than one request may make/);
  const { handle } = await import("../core/api.js");
  await handle("/api/status");
  await S.ask([{ role: "system", content: "a. Return JSON only" }, { role: "user", content: "4" }]);
});
