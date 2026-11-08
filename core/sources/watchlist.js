// Companies the person would love to work for: their own job boards on Greenhouse, Lever or Ashby, read directly
// through each system's public job list (no sign-in, no bot checks) on every search, so a new opening there is
// found within a couple of hours and goes to the front of the queue.
import { call } from "../freehire.js";

const UA = { "user-agent": "job-autopilot-desktop", accept: "application/json" };
// GET a JSON document: the parsed body, null for 404, an error otherwise.
export async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.json();
}

const LIST = {
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`,
  lever: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
  ashby: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`,
};
const TOKEN = /^[A-Za-z0-9._-]{1,80}$/;

// A board named by a link: the board's own page, a posting on it, or a careers page that shows it.
export function boardFromUrl(u) {
  let x;
  try { x = new URL(String(u).trim()); } catch { return null; }
  const host = x.hostname.toLowerCase(), seg = x.pathname.split("/").filter(Boolean);
  const pick = (ats, token) => (token && TOKEN.test(token) ? { ats, token } : null);
  if (/(^|\.)greenhouse\.io$/.test(host)) return pick("greenhouse", x.searchParams.get("for") || (seg[0] !== "embed" ? seg[0] : ""));
  if (host === "jobs.lever.co") return pick("lever", seg[0]);
  if (host === "jobs.ashbyhq.com") return pick("ashby", seg[0]);
  return null;
}
// The same, from a careers page's HTML: the first board it links to or embeds.
export function boardInHtml(html) {
  const h = String(html || "");
  const m = h.match(/(?:job-boards|boards)\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([A-Za-z0-9_-]+)/) ;
  if (m && m[1] !== "embed") return { ats: "greenhouse", token: m[1] };
  const l = h.match(/jobs\.lever\.co\/([A-Za-z0-9._-]+)/);
  if (l) return { ats: "lever", token: l[1] };
  const a = h.match(/jobs\.ashbyhq\.com\/([A-Za-z0-9._-]+)|posting-api\/job-board\/([A-Za-z0-9._-]+)/);
  if (a) return { ats: "ashby", token: a[1] || a[2] };
  return null;
}

const listOf = (ats, data) => (ats === "lever" ? (Array.isArray(data) ? data : []) : (data && data.jobs) || []);

// Is there a board there? -> how many jobs it has, or null.
async function probe(ats, token, get) {
  try { const d = await get(LIST[ats](token)); return d ? listOf(ats, d).length : null; } catch { return null; }
}

// What the person typed (a company's name, or a link) -> { name, ats, token, jobs } or null.
export async function findBoard(input, { get = getJson, ask = call, page = null } = {}) {
  const text = String(input || "").trim().slice(0, 300);
  if (!text) return null;
  const tryOne = async (b, name) => { if (!b) return null; const n = await probe(b.ats, b.token, get); return n === null ? null : { name, ...b, jobs: n }; };
  if (/^https?:\/\//i.test(text)) {
    const direct = boardFromUrl(text);
    const name = pretty((direct && direct.token) || new URL(text).hostname.replace(/^(www|careers|jobs)\./, "").split(".")[0]);
    const hit = await tryOne(direct, name);
    if (hit) return { ...hit, name: await boardName(hit, get) || hit.name };
    // A careers page of the company's own: the board it links to.
    try {
      const html = page ? await page(text) : await (await fetch(text, { headers: { "user-agent": UA["user-agent"] }, signal: AbortSignal.timeout(30000) })).text();
      const b = await tryOne(boardInHtml(html), name);
      if (b) return { ...b, name: await boardName(b, get) || name };
    } catch { /* not readable: nothing found */ }
    return null;
  }
  // A name: where freehire has seen its postings, then the usual board names for it.
  try {
    const cs = (await ask("search_companies", { query: text, limit: 3 })).companies || [];
    const c = cs.find((x) => x.name.toLowerCase() === text.toLowerCase()) || cs[0];
    if (c) {
      const jobs = (await ask("search_jobs", { query: "", company_slugs: [c.slug], limit: 5 })).jobs || [];
      for (const j of jobs) { const b = await tryOne(boardFromUrl(j.official_job_url || ""), c.name); if (b) return b; }
    }
  } catch { /* freehire unavailable: the guesses below */ }
  const words = text.toLowerCase().replace(/[,.]?\s+(inc|llc|ltd|corp|corporation|co|company)\.?$/i, "").replace(/[^a-z0-9 ]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const guesses = [...new Set([words.join(""), words.join("-"), words.join("_"), words[0]].filter((t) => t && TOKEN.test(t)))];
  for (const token of guesses) for (const ats of ["greenhouse", "lever", "ashby"]) {
    const b = await tryOne({ ats, token }, text);
    if (b) return { ...b, name: await boardName(b, get) || text };
  }
  return null;
}
// "applied-intuition" -> "Applied Intuition", when the board doesn't say its own name.
const pretty = (t) => String(t).replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
// Greenhouse boards carry the company's own name.
async function boardName(b, get) {
  if (b.ats !== "greenhouse") return "";
  try { const d = await get(`https://boards-api.greenhouse.io/v1/boards/${b.token}`); return (d && d.name) || ""; } catch { return ""; }
}

// Greenhouse sends its HTML escaped once more: the entities are read before the tags go and again after.
const entities = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&");
const plain = (html) => entities(entities(String(html || "").slice(0, 200000))
  .replace(/<(br|\/p|\/li|\/h\d|\/div)\s*\/?>/gi, "\n").replace(/<li[^>]*>/gi, "- ").replace(/<[^>]*>/g, " "))
  .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
const COUNTRY = { usa: "US", "united states": "US", "united states of america": "US", us: "US", canada: "CA", "united kingdom": "GB", uk: "GB" };
const country = (c) => { const k = String(c || "").trim().toLowerCase(); return COUNTRY[k] || (/^[a-z]{2}$/.test(k) ? k.toUpperCase() : ""); };
const iso = (t) => { const d = new Date(t); return Number.isNaN(+d) ? "" : d.toISOString(); };

// One board's postings, in the shape every source gives (see freehire.js normalize).
// cc: the country they'd work remotely from. A remote opening listed in several countries is kept as the one in theirs.
const NAMES_OF = { US: /\b(us|usa|u\.s\.a?\.?|united states)\b/i, CA: /\bcanada\b/i, GB: /\b(uk|united kingdom|england)\b/i };
export function normalize(w, ats, p, cc = "US") {
  const base = { company: w.name, ats, kind: "auto", board: "watchlist", level: "", minYears: null, sponsorship: null, watch: w.token };
  if (ats === "greenhouse") {
    const loc = (p.location && p.location.name) || "";
    return { ...base, slug: `wl-gh-${w.token}-${p.id}`.toLowerCase(), title: p.title, location: loc, work_mode: /remote/i.test(loc) ? "remote" : "", countries: [],
      url: p.absolute_url, apply_url: `https://job-boards.greenhouse.io/embed/job_app?for=${w.token}&token=${p.id}`, posted_at: iso(p.first_published || p.updated_at),
      description: plain(p.content).slice(0, 30000) };
  }
  if (ats === "lever") {
    const c = p.categories || {};
    const desc = [p.descriptionPlain || p.openingPlain, ...(p.lists || []).map((l) => `${l.text}\n${plain(l.content)}`), p.additionalPlain].filter(Boolean).join("\n\n");
    return { ...base, slug: `wl-lv-${w.token}-${p.id}`.toLowerCase(), title: p.text, location: c.location || (c.allLocations || []).join("; "), work_mode: p.workplaceType === "remote" ? "remote" : "",
      countries: p.country ? [String(p.country).toUpperCase()] : [], url: p.hostedUrl, apply_url: p.applyUrl || (p.hostedUrl && p.hostedUrl + "/apply"),
      posted_at: p.createdAt ? iso(Number(p.createdAt)) : "", description: desc.slice(0, 30000) };
  }
  const places = [p.location, ...(p.secondaryLocations || []).map((x) => x.location)].filter(Boolean);
  const home = country(p.address && p.address.postalAddress && p.address.postalAddress.addressCountry);
  const remote = p.isRemote || /remote/i.test(p.workplaceType || "");
  const theirs = remote && NAMES_OF[cc] ? places.find((x) => /remote/i.test(x) && NAMES_OF[cc].test(x)) : null;
  return { ...base, slug: `wl-ab-${w.token}-${p.id}`.toLowerCase(), title: String(p.title || "").trim(), location: theirs || places.join("; "),
    work_mode: remote ? "remote" : "", countries: theirs ? [cc] : home ? [home] : [], url: p.jobUrl, apply_url: p.applyUrl,
    posted_at: iso(p.publishedAt), salary: (p.compensation && p.compensation.compensationTierSummary) || null, description: String(p.descriptionPlain || plain(p.descriptionHtml)).slice(0, 30000) };
}

export async function search(prefs, { progress = () => {}, log = () => {}, get = getJson } = {}) {
  const out = [];
  const list = (prefs.watch || []).slice(0, 30);
  for (const [i, w] of list.entries()) {
    progress({ label: `${w.name}'s own job board`, i, n: list.length });
    try {
      const d = await get(LIST[w.ats](w.token));
      if (!d) { log(`${w.name}'s job board on ${w.ats} is gone (it may have moved): remove it under Settings > Jobs to look for, and add the company again`); continue; }
      for (const p of listOf(w.ats, d)) if (p && p.id && (p.isListed !== false)) out.push(normalize(w, w.ats, p, prefs.remoteCountry || "US"));
    } catch (e) { log(`${w.name}'s job board failed: ${e.message}`); }
  }
  return out;
}
