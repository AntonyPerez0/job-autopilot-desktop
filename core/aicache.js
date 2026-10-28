// The AI's answers, remembered: the same question to the same model gets the same answer, so the same facts
// make the same resume every time. AI providers don't repeat themselves even at temperature 0, which is
// why this is kept rather than trusted to the model. New facts mean a new question, and a fresh answer.
// Kept in the data folder for 120 days. JA_NO_AI_CACHE=1 turns it off (the tests, which change answers on purpose).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./store.js";

const DAYS = 120;
const off = () => !!process.env.JA_NO_AI_CACHE;
export const cacheKey = (settings, messages, opts = {}) =>
  crypto.createHash("sha256").update(JSON.stringify([settings.apiBase || "", settings.model || "", opts.temperature ?? null, messages])).digest("hex");
const fileOf = (key) => dataDir("ai-cache", key.slice(0, 2), key + ".json");

export function cached(key) {
  if (off()) return undefined;
  try {
    const f = fileOf(key), st = fs.statSync(f);
    if (Date.now() - st.mtimeMs > DAYS * 864e5) return undefined;
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch { return undefined; }
}

export function remember(key, value) {
  if (off() || value === undefined || value === null) return;
  try {
    const f = fileOf(key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(value));
    if (Math.random() < 0.02) prune();
  } catch { /* a cache that can't be written just isn't used */ }
}

// Old answers go; the folder never grows without bound.
export function prune() {
  const root = dataDir("ai-cache");
  let n = 0;
  try {
    for (const d of fs.readdirSync(root)) for (const f of fs.readdirSync(path.join(root, d))) {
      const p = path.join(root, d, f);
      if (Date.now() - fs.statSync(p).mtimeMs > DAYS * 864e5) fs.rmSync(p, { force: true }); else n++;
    }
  } catch { /* nothing to prune */ }
  return n;
}
