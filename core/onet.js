// What people in a job actually do, from the U.S. Department of Labor's O*NET
// database (bundled, CC BY 4.0): about 900 occupations with their task lists,
// and 44,000 everyday job titles ("stocker", "babysitter") that point to them.
// Used to jog the user's memory: "Did you also ...?"
import fs from "node:fs";
import zlib from "node:zlib";

export const CREDIT = "Task lists from the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA.";

let D;
function data() {
  if (!D) D = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL("../vendor/onet/onet.json.gz", import.meta.url))).toString("utf8"));
  return D;
}

const NOISE = /\b(senior|sr|junior|jr|lead|head|chief|assistant|asst|associate|trainee|apprentice|part[- ]time|full[- ]time|seasonal|temporary|temp|i{1,3}|iv|\d+|level|shift|weekend|overnight|night|day)\b|\([^)]*\)|[^a-z\s/&-]/g;
const norm = (s) => String(s || "").toLowerCase().replace(NOISE, " ").replace(/\s+/g, " ").trim();
const stem = (w) => w.replace(/(ies)$/, "y").replace(/(es|s)$/, "");

// The occupations a job title most likely belongs to, best first: [{ code, title, tasks }]
export function findOccupations(jobTitle, limit = 5) {
  const d = data();
  const out = new Map();
  const add = (idx, score) => { const c = d.codes[idx]; if ((out.get(c) || 0) < score) out.set(c, score); };
  const raw = String(jobTitle || "").toLowerCase().trim();
  const t = norm(jobTitle);
  if (!t) return [];
  // Exact title, then the title without its leading words ("front end cashier" -> "cashier").
  for (const key of [raw, t]) for (const i of d.titles[key] || []) add(i, 100);
  const parts = t.split(" ");
  for (let k = 1; k < parts.length && !out.size; k++) for (const i of d.titles[parts.slice(k).join(" ")] || []) add(i, 80 - k);
  // Otherwise: titles sharing the most words.
  if (out.size < limit) {
    const want = new Set(parts.filter((w) => w.length > 2).map(stem));
    if (want.size) for (const [title, idxs] of Object.entries(d.titles)) {
      const ws = title.split(/[^a-z]+/).filter((w) => w.length > 2).map(stem);
      if (!ws.length) continue;
      const hit = ws.filter((w) => want.has(w)).length;
      if (!hit) continue;
      const score = (40 * hit) / Math.max(want.size, ws.length);
      for (const i of idxs) add(i, score);
    }
  }
  // Ties go to the occupation whose own name shares words with the title ("Cashiers" over "Tellers").
  const own = (c) => { const ws = d.occ[d.codes.indexOf(c)][0].toLowerCase().split(/[^a-z]+/).map(stem); return parts.map(stem).filter((w) => ws.includes(w)).length; };
  return [...out.entries()].sort((a, b) => b[1] - a[1] || own(b[0]) - own(a[0])).slice(0, limit)
    .map(([code]) => { const o = d.occ[d.codes.indexOf(code)]; return { code, title: o[0], tasks: o[1] }; });
}

// A supervisor's or manager's task list only fits someone who says they supervised or managed.
export const BOSS = /\b(first-line supervisors|managers?)\b/i;
export const SAYS_BOSS = /\b(supervis\w*|manag\w*|lead|foreman|forewoman|head|chief|director|boss|superintendent|in charge)\b/i;
