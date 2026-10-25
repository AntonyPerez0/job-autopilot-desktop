// Simplify's public job lists on GitHub (new-grad roles, and internships when the
// user wants them). Simplify's own website forbids automated access, so the app
// never visits simplify.jobs; these lists are published on GitHub for anyone.
import fs from "node:fs";
import path from "node:path";
import { classify } from "../ats.js";
import { dataDir } from "../store.js";

const RAW = "https://raw.githubusercontent.com/SimplifyJobs";
export const LISTS = {
  newgrad: `${RAW}/New-Grad-Positions/dev/.github/scripts/listings.json`,
  intern: [`${RAW}/Summer2026-Internships/dev/.github/scripts/listings.json`, `${RAW}/Summer2027-Internships/dev/.github/scripts/listings.json`],
};
const FRESH_MS = 6 * 3600 * 1000;

// Download a list at most every few hours, and only if it changed (ETag); the lists are several MB.
async function cached(url) {
  const name = "simplify-" + url.split("/")[4] + ".json";
  const file = dataDir("cache", name), meta = file + ".meta";
  let m = {};
  try { m = JSON.parse(fs.readFileSync(meta, "utf8")); } catch { /* first time */ }
  if (m.at && Date.now() - m.at < FRESH_MS && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const res = await fetch(url, { headers: m.etag && fs.existsSync(file) ? { "if-none-match": m.etag } : {}, signal: AbortSignal.timeout(120000) });
  if (res.status === 304) { fs.writeFileSync(meta, JSON.stringify({ ...m, at: Date.now() })); return JSON.parse(fs.readFileSync(file, "utf8")); }
  if (!res.ok) throw new Error(`Simplify list: ${res.status}`);
  const text = await res.text();
  // keep only what the app uses, so the cache stays small
  const slim = JSON.parse(text).filter((x) => x && x.active && x.is_visible !== false && x.url)
    .map((x) => ({ id: x.id, t: x.title, c: x.company_name, l: x.locations || [], u: x.url, p: x.date_posted, s: x.sponsorship, k: x.category, sea: x.season }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(slim));
  fs.writeFileSync(meta, JSON.stringify({ etag: res.headers.get("etag"), at: Date.now() }));
  return slim;
}

export function normalize(x, kindLabel) {
  const { ats, kind } = classify(x.u);
  const locs = [].concat(x.l || []);
  return {
    slug: "simplify-" + x.id, title: x.t, company: x.c, location: locs.join("; "),
    work_mode: locs.some((l) => /remote/i.test(l)) ? "remote" : "", countries: locs.some((l) => /remote/i.test(l) && !/canada|uk|india/i.test(l)) ? ["US"] : [],
    url: x.u, apply_url: x.u, ats, kind, board: "Simplify (GitHub list)",
    posted_at: x.p ? new Date(x.p * 1000).toISOString() : "", salary: null,
    level: kindLabel === "intern" ? "intern" : "junior", minYears: null,
    sponsorship: /does not offer/i.test(x.s || "") ? false : /offers/i.test(x.s || "") ? true : null,
    description: [x.k ? "Category: " + x.k : "", kindLabel === "intern" ? `Internship${x.sea ? " (" + x.sea + ")" : ""}` : "New graduate role", x.s ? "Sponsorship: " + x.s : ""].filter(Boolean).join("\n"),
  };
}

// Simplify links ("simplify.jobs/p/<id>") -> the employer's own link, looked up in the lists.
export async function employerLinkFor(simplifyUrl) {
  const id = (String(simplifyUrl).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i) || [])[0];
  if (!id) return null;
  for (const url of [LISTS.newgrad, ...LISTS.intern]) {
    try { const hit = (await cached(url)).find((x) => x.id === id); if (hit) return normalize(hit, url === LISTS.newgrad ? "newgrad" : "intern"); } catch { /* try the next list */ }
  }
  return null;
}

export async function search(prefs, { progress = () => {}, log = () => {} }) {
  const want = [["newgrad", LISTS.newgrad], ...(prefs.internships ? LISTS.intern.map((u) => ["intern", u]) : [])];
  const since = Date.now() / 1000 - (Number(prefs.postedWithinDays) || 14) * 86400;
  const out = [];
  for (const [i, [label, url]] of want.entries()) {
    progress({ label: `Simplify ${label === "intern" ? "internship" : "new grad"} list`, i, n: want.length });
    try {
      for (const x of await cached(url)) if (!x.p || x.p >= since) out.push(normalize(x, label));
    } catch (e) { if (!/404/.test(e.message)) log(e.message); }
  }
  return out;
}
