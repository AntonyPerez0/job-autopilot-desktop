// Google for Jobs, through SerpApi with the user's own key. Google has no jobs API
// and blocks automated searches, so the app never searches Google itself.
// SerpApi's free plan has 250 searches a month; the app stays under a monthly cap.
import { classify } from "../ats.js";
import { countryName } from "../geo.js";
import { getSecret, getSettings, saveSettings } from "../store.js";

const ENDPOINT = "https://serpapi.com/search.json";

export function monthUse() {
  const m = new Date().toISOString().slice(0, 7);
  const u = getSettings().googleUse || {};
  return u.month === m ? u.count || 0 : 0;
}
function countUse() {
  const m = new Date().toISOString().slice(0, 7);
  saveSettings({ googleUse: { month: m, count: monthUse() + 1 } });
}

// The employer's own form if Google lists one; else the first job-board copy (which the user applies to).
export function bestApplyLink(options) {
  const list = (options || []).filter((o) => o && o.link).map((o) => ({ ...o, ...classify(o.link) }));
  return list.find((o) => o.kind === "auto") || list.find((o) => o.kind === "unknown") || list.find((o) => o.kind === "account") || list[0] || null;
}

const hash = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h.toString(36); };

export function normalize(r) {
  const best = bestApplyLink(r.apply_options);
  const ex = r.detected_extensions || {};
  return {
    slug: "g-" + hash(`${r.company_name}|${r.title}|${r.location}`),
    title: r.title || "", company: r.company_name || "", location: r.location || "",
    work_mode: ex.work_from_home ? "remote" : "", countries: [],
    url: best ? best.link : r.share_link || "", apply_url: best ? best.link : "",
    ats: best ? best.ats : "unknown", kind: best ? best.kind : "board", board: `Google (via ${r.via || "the web"})`,
    posted_at: "", posted_text: ex.posted_at || "", salary: ex.salary || null, level: "", minYears: null,
    description: String(r.description || "").slice(0, 12000),
  };
}

export async function testKey(key) {
  const res = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `SerpApi ${res.status}`);
  return { left: j.total_searches_left ?? j.plan_searches_left, plan: j.plan_name };
}

export async function search(prefs, { progress = () => {}, log = () => {} }) {
  const key = getSecret("serpApiKey");
  if (!key) { log("Google Jobs is on, but there is no SerpApi key in Settings"); return []; }
  const cap = Number(getSettings().googleMonthlyCap) || 200;
  const where = (prefs.cities || []).map((c) => ({ q: "", location: [c.name, c.region, countryName(c.country)].filter(Boolean).join(", "), lrad: Math.round((Number(prefs.radius) || 25) * (prefs.radiusUnit === "km" ? 1 : 1.609)) }));
  if (prefs.remote) where.push({ q: " remote", location: countryName(prefs.remoteCountry || "US") });
  const all = [];
  for (const title of prefs.titles || []) for (const w of where) all.push({ title, ...w });
  const start = all.length ? (getSettings().googleRotate || 0) % all.length : 0;
  const runs = [...all.slice(start), ...all.slice(0, start)];
  // Spread the month's searches over the month: at most a few per round.
  const perRound = Math.max(1, Math.min(3, Math.floor((cap - monthUse()) / 30)));
  const out = [];
  for (const [i, r] of runs.slice(0, perRound).entries()) {
    if (monthUse() >= cap) { log(`Google Jobs: this month's ${cap} searches are used up`); break; }
    progress({ label: `Google Jobs: "${r.title}"`, i, n: Math.min(runs.length, perRound) });
    const q = new URLSearchParams({ engine: "google_jobs", q: r.title + r.q, location: r.location, api_key: key, hl: "en" });
    if (r.lrad) q.set("lrad", String(r.lrad));
    try {
      const res = await fetch(`${ENDPOINT}?${q}`, { signal: AbortSignal.timeout(60000) });
      countUse();
      const j = await res.json();
      if (j.error && !/hasn't returned any results/i.test(j.error)) throw new Error(j.error);
      for (const x of j.jobs_results || []) out.push(normalize(x));
    } catch (e) { log(`Google Jobs search "${r.title}" failed: ${e.message}`); }
  }
  // Rotate, so every title and place gets its turn across rounds.
  if (runs.length > perRound) saveSettings({ googleRotate: ((getSettings().googleRotate || 0) + perRound) % runs.length });
  return out;
}
