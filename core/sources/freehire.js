// freehire.me: IT and office jobs, with their own employer links. Searched by title,
// near the user's cities (every city of 5,000+ people in the radius) and remote.
import { call } from "../freehire.js";
import { FILLABLE, classify } from "../ats.js";
import { siteAccounts } from "../accounts.js";
import { citiesNear } from "../geo.js";
import { thisCycle } from "./budget.js";

// The application systems freehire collects from whose forms the app fills without an account (freehire's names for
// them), and Workday too when the person lets the app make accounts there.
const FREEHIRE_NAME = { isolved: "isolvedhire" };
export const BOARDS = FILLABLE.map((a) => FREEHIRE_NAME[a] || a);
export const boardsFor = () => [...BOARDS, ...(siteAccounts() ? ["workday"] : [])];

// What freehire observed about a posting being real, in plain words (freehire's ghost-job signal and reality class).
const CRITERIA = { evergreen_posting: "it's reposted again and again", ats_absent: "it's gone from the employer's own job board", silent_applications: "people who applied there heard nothing back",
  user_reports: "people reported it as not a real opening" };
const day = (s) => { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""; };
export function realness(d) {
  if (!d || !(d.reality || d.ghost_level || d.fake_freshness)) return null;
  const notes = [];
  if (d.reality === "fresh") notes.push(`Looks like a live opening: freehire first saw it ${day(d.first_seen_at) || "recently"}.`);
  else if (d.reality === "stale") notes.push(`It has been up a while: freehire first saw it ${day(d.first_seen_at) || "some time ago"}.`);
  else if (d.reality === "likely-evergreen") notes.push("It looks like an always-open posting: some employers keep one up to collect applications for later.");
  if (d.fake_freshness) notes.push(`The posted date was refreshed: freehire has seen this posting since ${day(d.first_seen_at) || "90 or more days ago"}.`);
  const why = arr(d.ghost_criteria).map((c) => CRITERIA[c]).filter(Boolean);
  if (d.ghost_level) notes.push(`${d.ghost_level === "likely" ? "Likely" : "Possibly"} not being filled${why.length ? `: ${why.join(", and ")}` : ""}.`);
  if (d.last_seen_at) notes.push(`Last confirmed open on the employer's site ${day(d.last_seen_at)}.`);
  return { reality: d.reality || "", level: d.ghost_level || "", criteria: arr(d.ghost_criteria), fake: !!d.fake_freshness, notes };
}
const arr = (x) => (Array.isArray(x) ? x : []);

export function normalize(j, similarTo = "") {
  return {
    slug: j.slug, title: j.title, company: j.company, location: j.location || "", work_mode: j.work_mode || "", countries: j.countries || [],
    url: j.official_job_url || j.url, apply_url: null, ats: j.source, kind: "auto", board: "freehire",
    posted_at: j.posted_at || "", salary: j.salary_min ? `${j.salary_currency || "USD"} ${j.salary_min.toLocaleString()}${j.salary_max ? "-" + j.salary_max.toLocaleString() : ""}/${j.salary_period || "year"}` : null,
    level: j.seniority || "", minYears: null, sponsorship: j.visa_sponsorship ?? null, description: "", ...(similarTo ? { similarTo } : {}),
    category: j.category || "", company_slug: j.company_slug || "",
    // the full posting is read only for jobs that pass the filters
    details: async () => {
      const d = await call("get_job", { slug: j.slug });
      const via = d.apply_via || d.source;
      const official = d.official_job_url || j.official_job_url;
      const c = official ? classify(official) : { ats: via, kind: "unknown" };
      return { description: d.description || "", url: official || d.url, ats: via, kind: c.kind === "unknown" ? (BOARDS.includes(via) ? "auto" : "unknown") : c.kind,
        ghost: d.ghost_level === "likely", real: realness(d), requirements: d.requirements || [], skills: d.skills || [], freehire: d.url,
        company: d.company || j.company, title: d.title || j.title, location: d.location || j.location };
    },
  };
}

// seeds: [{ slug, title, company }] freehire postings the person applied to; postings like them are looked at too.
export const SIMILAR_PER_CYCLE = 5;
export async function search(prefs, { progress = () => {}, log = () => {}, seeds = [] } = {}) {
  const cities = citiesNear(prefs);
  const runs = [], sources = boardsFor();
  for (const query of prefs.titles || []) {
    if (cities.length) runs.push({ query, cities, sources, posted_within_days: prefs.postedWithinDays, limit: 50 });
    if (prefs.remote) runs.push({ query, countries: [prefs.remoteCountry], work_mode: ["remote"], sources, posted_within_days: prefs.postedWithinDays, limit: 50 });
  }
  const out = [];
  const now = thisCycle(runs, "freehire");
  for (const [i, args] of now.entries()) {
    progress({ label: `freehire: "${args.query}"${args.cities ? "" : " remote"}`, i, n: now.length });
    try { for (const j of (await call("search_jobs", args)).jobs || []) out.push(normalize(j)); }
    catch (e) { log(`freehire search "${args.query}" failed: ${e.message}`); }
  }
  // More like the jobs they applied to (freehire's similar_jobs): the same filters decide which of them count.
  for (const [i, s] of thisCycle(seeds, "freehire-similar", SIMILAR_PER_CYCLE).entries()) {
    progress({ label: `freehire: more like ${s.title}`, i, n: SIMILAR_PER_CYCLE });
    try { for (const j of (await call("similar_jobs", { slug: s.slug, limit: 20 })).jobs || []) out.push(normalize(j, `${s.title} at ${s.company}`)); }
    catch (e) { log(`freehire: jobs like "${s.title}" failed: ${e.message}`); }
  }
  return out;
}

export const searchesFor = (prefs) => {
  const cities = citiesNear(prefs);
  return (prefs.titles || []).flatMap((q) => [cities.length ? { query: q, cities } : null, prefs.remote ? { query: q, countries: [prefs.remoteCountry], work_mode: ["remote"] } : null].filter(Boolean));
};
