// Find jobs on every source the user turned on (freehire, HiringCafe, Simplify's
// lists, Google Jobs), keep the ones that match their preferences, screen each
// for fit with the model, and sort them: the app applies to the ones whose form
// needs no account, and lists the rest under "Apply yourself".
import { getDb, log } from "./db.js";
import { loadProfile, screen } from "./engine.js";
import { km, remoteOk, toKm, withinRadius } from "./geo.js";
import { getAnswers, getPrefs } from "./store.js";
import { cleanUrl, familyKey, inAppliedList, jobKey, parseAppliedList, roleKey } from "./dedupe.js";
import { KIND_TEXT } from "./ats.js";
import { payPerHour } from "./suggest.js";
import { siteAccounts } from "./accounts.js";
import { SOURCES, enabledSources } from "./sources/index.js";
import { searchesFor } from "./sources/freehire.js";

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


// Levels the user accepts; a job with no level stated is kept for the AI screen to judge.
const levelOk = (j, prefs) => !j.level || (prefs.seniority || []).includes(j.level) || (j.level === "intern" && prefs.internships);

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

// The page with the form itself, for the systems whose posting and form are different pages.
export async function applyUrl(source, official) {
  if (!official) return null;
  const u = official.replace(/#.*$/, "");
  if (source === "greenhouse" || /greenhouse\.io/.test(u) || /gh_jid=/.test(u)) return greenhouseUrl(u).catch(() => u);
  if (source === "lever" || /lever\.co/.test(u)) {
    const m = u.match(/^https:\/\/jobs\.(eu\.)?lever\.co\/[^/]+\/[0-9a-f-]{36}/);
    return m ? m[0] + "/apply" : u;
  }
  if (source === "ashby" || /ashbyhq\.com/.test(u)) {
    const m = u.match(/^https:\/\/jobs\.ashbyhq\.com\/[^/]+\/[0-9a-f-]{36}/);
    return m ? m[0] + "/application" : u;
  }
  return u;
}

// What freehire is asked, per title and place (kept for the tests and the Settings preview).
export const searches = (prefs) => searchesFor(prefs).map((s) => ({ ...s, sources: ["greenhouse", "lever", "ashby", "smartrecruiters", "workable"], posted_within_days: prefs.postedWithinDays, limit: 50 }));

// Inside the radius, by the job's own coordinates when the source gives them, else by its location text.
export function locationOk(j, prefs) {
  if (j.work_mode === "remote" || (/\bremote\b/i.test(j.location || "") && !(j.geo || []).length)) return !!prefs.remote && remoteOk({ ...j, work_mode: "remote" }, prefs.remoteCountry);
  const centers = (prefs.cities || []).filter((c) => c && typeof c.lat === "number");
  if ((j.geo || []).length && centers.length) {
    const lim = toKm(prefs.radius, prefs.radiusUnit) + 0.5;
    return j.geo.some((g) => centers.some((c) => km(c, g) <= lim));
  }
  return withinRadius(j.location, prefs);
}

// Why the user applies to this one themselves, or null when the app can.
export function manualReason(j) {
  if (j.kind === "auto" || j.kind === "unknown") return null;
  let host = "";
  try { host = new URL(j.apply_url || j.url).hostname.replace(/^www\./, ""); } catch { /* no link */ }
  return `Apply yourself: ${host || j.ats || "this site"} ${KIND_TEXT[j.kind] || "needs you"}${j.ats === "workday" ? " (or turn on Settings > Job site accounts and the app does it)" : ""}`;
}

const posted = (j) => (j.posted_at ? Date.parse(j.posted_at) : NaN);

// What the last search found and what went wrong, for the dashboard: a search that quietly finds
// nothing because a site would not open looks just like a quiet day.
export const lastSearch = { at: null, found: 0, queued: 0, problems: [] };

export async function discover(progress = () => {}, ctx = {}) {
  lastSearch.at = new Date().toISOString(); lastSearch.problems = []; lastSearch.found = 0; lastSearch.queued = 0;
  const db = getDb();
  const prefs = getPrefs(), a = getAnswers();
  const seen = new Set(db.prepare("SELECT slug FROM jobs").all().map((r) => r.slug));
  const keys = new Set(db.prepare("SELECT key FROM jobs").all().map((r) => r.key));
  const live = db.prepare("SELECT company, title FROM jobs WHERE status != 'skipped'").all();
  const roles = new Set(live.map((r) => roleKey(r.company, r.title)));
  // The same job at many locations: two of them at most, and one screening decision for all of them.
  const PER_FAMILY = 2;
  const families = new Map();
  for (const r of live) { const f = familyKey(r.company, r.title); families.set(f, (families.get(f) || 0) + 1); }
  const verdicts = new Map();
  const urls = new Set(db.prepare("SELECT url, apply_url FROM jobs").all().flatMap((r) => [r.url, r.apply_url]).filter(Boolean).map(cleanUrl));
  const manual = parseAppliedList(prefs.alreadyApplied);
  for (const r of db.prepare("SELECT url, apply_url FROM jobs WHERE status IN ('applied', 'submitting') OR (status = 'failed' AND reason LIKE '%may have gone through%')").all()) {
    for (const u of [r.url, r.apply_url]) if (u) manual.urls.add(cleanUrl(u));
  }
  const profile = loadProfile();
  if (!(prefs.titles || []).length || (!(prefs.cities || []).length && !prefs.remote)) {
    log(null, "no searches to run: add job titles and a city (or remote) in Settings > Job preferences", "warn");
    return 0;
  }
  const sources = enabledSources(prefs);
  const found = new Map();
  for (const [si, src] of sources.entries()) {
    const warnings = [];
    try {
      const list = await src.search(prefs, {
        browser: ctx.browser,
        progress: (u) => progress({ phase: "search", i: si, n: sources.length, label: u.label || src.name }),
        log: (m) => { warnings.push(m); log(null, m, "warn"); },
      });
      for (const j of list) if (j && j.slug && !seen.has(j.slug) && !found.has(j.slug)) found.set(j.slug, j);
      log(null, `${src.name}: ${list.length} results`);
      if (!list.length && warnings.some((w) => /failed/i.test(w))) lastSearch.problems.push({ source: src.name, message: warnings.find((w) => /failed/i.test(w)).split("\n")[0].slice(0, 200) });
    } catch (e) { log(null, `${src.name} search failed: ${e.message}`, "warn"); lastSearch.problems.push({ source: src.name, message: String(e.message).split("\n")[0].slice(0, 200) }); }
  }
  lastSearch.sources = sources.map((s) => s.name);
  const maxAge = (Number(prefs.postedWithinDays) || 14) * 86400000;
  // The lowest pay the person would take, as an hourly figure (a yearly one counts 2,080 hours).
  const floor = Number(prefs.minPay) > 0 ? (prefs.minPayPer === "year" ? Number(prefs.minPay) / 2080 : Number(prefs.minPay)) : 0;
  const dollars = (n) => "$" + (n >= 100 ? Math.round(n).toLocaleString("en-US") : (Math.round(n * 100) / 100).toString());
  let added = 0, toYou = 0, ji = 0;
  const list = [...found.values()];
  for (let j of list) {
    progress({ phase: "review", i: ji++, n: list.length, label: `${j.title} at ${j.company}`, added });
    if (!titleOk(j.title, prefs) || !levelOk(j, prefs) || excludedCompany(j.company, prefs) || !locationOk(j, prefs)) continue;
    if (Number.isFinite(posted(j)) && Date.now() - posted(j) > maxAge) continue;
    if (j.minYears !== null && j.minYears !== undefined && Number.isFinite(Number(prefs.maxYearsRequired)) && j.minYears > Number(prefs.maxYearsRequired)) continue;
    if (j.sponsorship === false && a.needsSponsorship === "yes") continue;
    const key = jobKey(j.company, j.title);
    if (keys.has(key) || roles.has(roleKey(j.company, j.title)) || (j.url && urls.has(cleanUrl(j.url)))) continue;
    if (j.details) {
      try { j = { ...j, ...(await j.details()) }; } catch (e) { log(j.slug, "reading the posting failed: " + e.message, "warn"); continue; }
    }
    const fam = familyKey(j.company, j.title);
    let status = "queued", reason = null;
    if (excludedCompany(j.company, prefs)) { status = "skipped"; reason = "excluded company, recruiter or repost aggregator"; }
    else if (j.ghost) { status = "skipped"; reason = "freehire says this posting is likely a ghost listing"; }
    else if (inAppliedList(manual, { ...j, apply_url: j.apply_url || j.url })) { status = "skipped"; reason = "already applied (your history or your already-applied list)"; }
    else if (!j.url) { status = "skipped"; reason = "no link to the employer's application"; }
    else if (floor && payPerHour(j.salary) && payPerHour(j.salary).max < floor - 0.005) {
      status = "skipped"; reason = `pays at most ${dollars(payPerHour(j.salary).max)} an hour, under the ${prefs.minPayPer === "year" ? dollars(Number(prefs.minPay)) + " a year" : dollars(floor) + " an hour"} you asked for`;
    }
    else if ((families.get(fam) || 0) >= PER_FAMILY) { status = "skipped"; reason = `the same job at another location: ${PER_FAMILY} of these are already in your list`; }
    else {
      // Workday needs an account; with the user's go-ahead the app makes it, so the job is the app's to apply to.
      const why = j.ats === "workday" && siteAccounts() ? null : manualReason(j);
      if (why) { status = "manual"; reason = why; }
      try {
        const s = verdicts.get(fam) || await screen(profile, j, j.description, a, prefs);
        verdicts.set(fam, s);
        if (!s.ok) { status = "skipped"; reason = `screen: ${s.reason}`; }
        else reason = status === "manual" ? `${why}. Screen: ${s.reason}` : `screen: ${s.reason}`;
      } catch (e) { log(j.slug, "screen failed, will retry next search: " + e.message, "warn"); continue; }
    }
    const apply = status === "skipped" ? null : await applyUrl(j.ats, j.apply_url || j.url);
    db.prepare(`INSERT OR IGNORE INTO jobs (slug, key, title, company, location, work_mode, source, url, apply_url, salary, posted_at, status, reason, details)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(j.slug, key, j.title, j.company, j.location || "", j.work_mode || "",
      j.ats || "", j.url, apply, j.salary || null, j.posted_at || j.posted_text || "", status, reason,
      JSON.stringify({ description: j.description || "", requirements: j.requirements || [], board: j.board, kind: j.kind, freehire: j.freehire }));
    keys.add(key);
    roles.add(roleKey(j.company, j.title));
    if (j.url) urls.add(cleanUrl(j.url));
    if (status !== "skipped") families.set(fam, (families.get(fam) || 0) + 1);
    if (status === "queued") added++;
    if (status === "manual") toYou++;
    log(j.slug, `${status}: ${j.title} at ${j.company} (${j.location}) via ${j.board}${reason ? " - " + reason : ""}`);
  }
  log(null, `discovery done: ${found.size} new results, ${added} queued, ${toYou} for you to apply to`);
  Object.assign(lastSearch, { found: found.size, queued: added, toYou });
  return added;
}

export { SOURCES };
