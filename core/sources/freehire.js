// freehire.me: IT and office jobs, with their own employer links. Searched by title,
// near the user's cities (every city of 5,000+ people in the radius) and remote.
import { call } from "../freehire.js";
import { classify } from "../ats.js";
import { citiesNear } from "../geo.js";

// The boards freehire collects from whose forms the app can fill without an account.
export const BOARDS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable"];

export function normalize(j) {
  return {
    slug: j.slug, title: j.title, company: j.company, location: j.location || "", work_mode: j.work_mode || "", countries: j.countries || [],
    url: j.official_job_url || j.url, apply_url: null, ats: j.source, kind: "auto", board: "freehire",
    posted_at: j.posted_at || "", salary: j.salary_min ? `${j.salary_currency || "USD"} ${j.salary_min.toLocaleString()}${j.salary_max ? "-" + j.salary_max.toLocaleString() : ""}/${j.salary_period || "year"}` : null,
    level: j.seniority || "", minYears: null, sponsorship: j.visa_sponsorship ?? null, description: "",
    // the full posting is read only for jobs that pass the filters
    details: async () => {
      const d = await call("get_job", { slug: j.slug });
      const via = d.apply_via || d.source;
      const official = d.official_job_url || j.official_job_url;
      const c = official ? classify(official) : { ats: via, kind: "unknown" };
      return { description: d.description || "", url: official || d.url, ats: via, kind: c.kind === "unknown" ? (BOARDS.includes(via) ? "auto" : "unknown") : c.kind,
        ghost: d.ghost_level === "likely", requirements: d.requirements || [], freehire: d.url, company: d.company || j.company, title: d.title || j.title, location: d.location || j.location };
    },
  };
}

export async function search(prefs, { progress = () => {}, log = () => {} }) {
  const cities = citiesNear(prefs);
  const runs = [];
  for (const query of prefs.titles || []) {
    if (cities.length) runs.push({ query, cities, sources: BOARDS, posted_within_days: prefs.postedWithinDays, limit: 50 });
    if (prefs.remote) runs.push({ query, countries: [prefs.remoteCountry], work_mode: ["remote"], sources: BOARDS, posted_within_days: prefs.postedWithinDays, limit: 50 });
  }
  const out = [];
  for (const [i, args] of runs.entries()) {
    progress({ label: `freehire: "${args.query}"${args.cities ? "" : " remote"}`, i, n: runs.length });
    try { for (const j of (await call("search_jobs", args)).jobs || []) out.push(normalize(j)); }
    catch (e) { log(`freehire search "${args.query}" failed: ${e.message}`); }
  }
  return out;
}

export const searchesFor = (prefs) => {
  const cities = citiesNear(prefs);
  return (prefs.titles || []).flatMap((q) => [cities.length ? { query: q, cities } : null, prefs.remote ? { query: q, countries: [prefs.remoteCountry], work_mode: ["remote"] } : null].filter(Boolean));
};
