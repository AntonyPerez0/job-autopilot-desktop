// Find jobs on freehire that match the user's preferences, keep the ones whose
// application form needs no account (Greenhouse, Lever, Ashby), screen each
// posting for fit with the model, and queue the ones worth applying to.
import { getDb, log } from "./db.js";
import { call } from "./freehire.js";
import { loadProfile, screen } from "./engine.js";
import { citiesNear, remoteOk, withinRadius } from "./geo.js";
import { getAnswers, getPrefs } from "./store.js";
import { cleanUrl, inAppliedList, jobKey, parseAppliedList, roleKey } from "./dedupe.js";

// Recruiting agencies and repost aggregators: the application never reaches the employer.
export const AGENCIES = ["jobgether", "synergisticit", "jobot", "cybercoders", "revature", "dice", "true talent", "crossover", "lensa", "jobright"];

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const STOPWORDS = new Set(["i", "ii", "iii", "the", "a", "an", "and", "of", "for", "to", "in", "at", "new", "grad", "graduate", "junior", "jr", "senior", "sr",
  "associate", "entry", "level", "early", "career", "remote", "level", "staff", "lead", "principal", "intern", "internship", "1", "2", "3"]);

// Words that rule a title out, from the seniority the user accepts.
export function titleExcludes(prefs) {
  const s = new Set(prefs.seniority || []);
  const out = [...(prefs.titleExclude || [])];
  if (!s.has("senior")) out.push("senior", "sr\\.?");
  if (!s.has("lead")) out.push("lead\\b", "head of", "manager", "director");
  if (!s.has("staff")) out.push("staff");
  if (!s.has("principal")) out.push("principal", "distinguished", "architect");
  if (!s.has("c_level")) out.push("chief", "vp\\b", "vice president");
  if (!prefs.internships) out.push("intern\\b", "internship", "co-?op\\b", "apprentice");
  if (!s.has("middle") && !s.has("senior")) out.push("\\b(ii|iii|iv|2|3|4)\\b");
  return out;
}

// A title is in scope when it shares a telling word with one of the target titles and has no excluded word.
export function titleOk(title, prefs) {
  const t = String(title || "").toLowerCase();
  const ex = titleExcludes(prefs).filter(Boolean);
  if (ex.length && new RegExp(`\\b(${ex.join("|")})`, "i").test(t)) return false;
  const targets = (prefs.titles || []).map((x) => String(x).toLowerCase());
  if (!targets.length) return true;
  return targets.some((target) => {
    const words = target.split(/[^a-z0-9+#.]+/).filter((w) => w && !STOPWORDS.has(w));
    if (!words.length) return t.includes(target);
    const hit = words.filter((w) => new RegExp(`\\b${esc(w)}`).test(t)).length;
    return hit >= Math.ceil(words.length / 2) || t.includes(target);
  });
}

export function excludedCompany(company, prefs) {
  const list = [...(prefs.excludeCompanies || []), ...(prefs.excludeAgencies ? AGENCIES : [])].map((x) => String(x).trim()).filter(Boolean);
  return list.some((c) => new RegExp(`\\b${esc(c)}\\b`, "i").test(String(company || "")));
}

const ACCEPTED_SENIORITY = (prefs) => new Set([...(prefs.seniority || []), ""]);

async function greenhouseUrl(u) {
  const url = new URL(u);
  if (/(^|\.)greenhouse\.io$/.test(url.hostname) && /\/jobs\/\d+/.test(url.pathname)) {
    const m = url.pathname.match(/^\/([^/]+)\/jobs\/(\d+)/);
    if (m) return `https://job-boards.greenhouse.io/embed/job_app?for=${m[1]}&token=${m[2]}`;
  }
  const id = url.searchParams.get("gh_jid") || url.searchParams.get("token") || (url.pathname.match(/\/jobs\/(\d+)/) || [])[1];
  if (!id) return u;
  const res = await fetch(`https://boards.greenhouse.io/embed/job_app?token=${id}`, { redirect: "follow", signal: AbortSignal.timeout(20000) });
  const board = new URL(res.url).searchParams.get("for");
  return board && res.ok ? `https://job-boards.greenhouse.io/embed/job_app?for=${board}&token=${id}` : u;
}

export async function applyUrl(source, official) {
  if (!official) return null;
  const u = official.replace(/#.*$/, "");
  if (source === "greenhouse") return greenhouseUrl(u);
  if (source === "lever") {
    const m = u.match(/^https:\/\/jobs\.(eu\.)?lever\.co\/[^/]+\/[0-9a-f-]{36}/);
    return m ? m[0] + "/apply" : null;
  }
  if (source === "ashby") {
    const m = u.match(/^https:\/\/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}/);
    return m ? m[0] + "/application" : null;
  }
  return null;
}

// The searches one discovery round runs: each target title, near the user's cities and/or remote in their country.
export function searches(prefs) {
  const out = [];
  const cities = citiesNear(prefs);
  for (const query of prefs.titles || []) {
    if (cities.length) out.push({ query, cities, sources: prefs.sources, posted_within_days: prefs.postedWithinDays, limit: 50 });
    if (prefs.remote) out.push({ query, countries: [prefs.remoteCountry], work_mode: ["remote"], sources: prefs.sources, posted_within_days: prefs.postedWithinDays, limit: 50 });
  }
  return out;
}

export function locationOk(j, prefs) {
  return withinRadius(j.location, prefs) || (prefs.remote && remoteOk(j, prefs.remoteCountry));
}

export async function discover(progress = () => {}) {
  const db = getDb();
  const prefs = getPrefs(), a = getAnswers();
  const seen = new Set(db.prepare("SELECT slug FROM jobs").all().map((r) => r.slug));
  const keys = new Set(db.prepare("SELECT key FROM jobs").all().map((r) => r.key));
  const roles = new Set(db.prepare("SELECT company, title FROM jobs WHERE status != 'skipped'").all().map((r) => roleKey(r.company, r.title)));
  const manual = parseAppliedList(prefs.alreadyApplied);
  // Addresses of everything applied to (including history imported from another computer).
  for (const r of db.prepare("SELECT url, apply_url FROM jobs WHERE status IN ('applied', 'submitting') OR (status = 'failed' AND reason LIKE '%may have gone through%')").all()) {
    for (const u of [r.url, r.apply_url]) if (u) manual.urls.add(cleanUrl(u));
  }
  const profile = loadProfile();
  const found = new Map();
  const list0 = searches(prefs);
  if (!list0.length) { log(null, "no searches to run: add target titles and a city or remote in Settings > Job preferences", "warn"); return 0; }
  for (const [si, args] of list0.entries()) {
    progress({ phase: "search", i: si, n: list0.length, label: args.query });
    try {
      const r = await call("search_jobs", args);
      for (const j of r.jobs || []) if (!seen.has(j.slug)) found.set(j.slug, j);
    } catch (e) { log(null, `search "${args.query}" failed: ${e.message}`, "warn"); }
  }
  let added = 0, ji = 0;
  const list = [...found.values()];
  const okLevels = ACCEPTED_SENIORITY(prefs);
  for (const j of list) {
    progress({ phase: "review", i: ji++, n: list.length, label: `${j.title} at ${j.company}`, added });
    if (!titleOk(j.title, prefs) || (j.seniority && !okLevels.has(j.seniority))) continue;
    if (excludedCompany(j.company, prefs)) continue;
    if (!locationOk(j, prefs)) continue;
    const key = jobKey(j.company, j.title);
    if (keys.has(key) || roles.has(roleKey(j.company, j.title))) continue;
    let d;
    try { d = await call("get_job", { slug: j.slug }); } catch (e) { log(j.slug, "get_job failed: " + e.message, "warn"); continue; }
    const via = d.apply_via || d.source;
    let status = "queued", reason = null, apply = null;
    if (excludedCompany(d.company, prefs)) { status = "skipped"; reason = "excluded company, recruiter or repost aggregator"; }
    else if (!(prefs.sources || []).includes(via)) { status = "skipped"; reason = `applies through ${via}, which needs an account`; }
    else if (d.ghost_level === "likely") { status = "skipped"; reason = "freehire says this posting is likely a ghost listing"; }
    else if (inAppliedList(manual, { ...d, url: d.official_job_url || d.url })) { status = "skipped"; reason = "already applied (your history or your already-applied list)"; }
    else {
      apply = await applyUrl(via, d.official_job_url || j.official_job_url).catch(() => null);
      if (!apply) { status = "skipped"; reason = "no direct application link"; }
      else {
        try {
          const s = await screen(profile, d, d.description, a, prefs);
          if (!s.ok) { status = "skipped"; reason = `screen: ${s.reason}`; }
          else reason = `screen: ${s.reason}`;
        } catch (e) { log(j.slug, "screen failed, will retry next search: " + e.message, "warn"); continue; }
      }
    }
    const salary = d.salary_min ? `${d.salary_currency || "USD"} ${d.salary_min.toLocaleString()}${d.salary_max ? "-" + d.salary_max.toLocaleString() : ""}/${d.salary_period || "year"}` : null;
    db.prepare(`INSERT OR IGNORE INTO jobs (slug, key, title, company, location, work_mode, source, url, apply_url, salary, posted_at, status, reason, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(j.slug, key, d.title, d.company, d.location || "", d.work_mode || "",
      via, d.official_job_url || d.url, apply, salary, d.posted_at || "", status, reason,
      JSON.stringify({ description: d.description, requirements: d.requirements || [], apply_requires: d.apply_requires || [], freehire: d.url }));
    keys.add(key);
    roles.add(roleKey(d.company, d.title));
    if (status === "queued") added++;
    log(j.slug, `${status}: ${d.title} at ${d.company} (${d.location})${reason ? " - " + reason : ""}`);
  }
  log(null, `discovery done: ${found.size} new results, ${added} queued`);
  return added;
}
