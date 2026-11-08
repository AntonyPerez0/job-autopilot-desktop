// "What pay should I ask for?": what employers post for work like theirs. freehire's figures (the 25th, 50th and 75th
// percentile of the pay that open postings state) for the kind of work their job titles are, at their level, in their
// country. Only real postings: with too few of them, the app says so instead of guessing.
import { call } from "./freehire.js";
import { kindName } from "./kinds.js";

const LEVELS = ["intern", "junior", "middle", "senior", "lead"];
const COUNTRY = { "united states": "US", "united states of america": "US", usa: "US", us: "US", "u.s.": "US", "u.s.a.": "US", america: "US",
  canada: "CA", "united kingdom": "GB", uk: "GB", england: "GB", australia: "AU", germany: "DE", india: "IN", mexico: "MX" };
const MIN_POSTINGS = 5;

// Their country, as a two-letter code: About you's country, else where they look for remote work.
export function countryCode(a = {}, prefs = {}) {
  const c = String(a.country || "").trim().toLowerCase();
  if (COUNTRY[c]) return COUNTRY[c];
  if (/^[a-z]{2}$/.test(c)) return c.toUpperCase();
  return String(prefs.remoteCountry || "US").toUpperCase();
}

// The kind of work their titles are: the role family most postings with each title are in (each title counts the same).
export async function kindOfWork(titles, cc, ask = call) {
  const tally = new Map();
  for (const t of titles.slice(0, 3)) {
    let cats = [];
    try { cats = ((await ask("job_market_stats", { query: t, countries: [cc] })).facets || {}).category || []; } catch { continue; }
    const total = cats.reduce((s, c) => s + (Number(c.count) || 0), 0);
    if (total) for (const c of cats) tally.set(c.value, (tally.get(c.value) || 0) + c.count / total);
  }
  const best = [...tally].sort((x, y) => y[1] - x[1])[0];
  return best ? best[0] : null;
}

// Their level: the one their years of work point to, or the nearest one among the levels they look for.
export function levelFor(years, prefs = {}) {
  const want = years < 3 ? "junior" : years < 6 ? "middle" : "senior";
  const ok = (prefs.seniority || []).filter((x) => LEVELS.includes(x) && x !== "intern");
  if (!ok.length || ok.includes(want)) return want;
  const far = (x) => Math.abs(LEVELS.indexOf(x) - LEVELS.indexOf(want));
  return [...ok].sort((x, y) => far(x) - far(y) || LEVELS.indexOf(x) - LEVELS.indexOf(y))[0];
}

const PER = { hour: "an hour", year: "a year", month: "a month", week: "a week", day: "a day" };
export const payText = (n, period, currency = "USD") => `${currency === "USD" ? "$" : currency + " "}${Math.round(Number(n)).toLocaleString("en-US")} ${PER[period] || "a " + period}`;

// -> { kind, category, level, country, period, currency, low, mid, high, n, text, others: [...] } or { kind, ..., n: 0 }
export async function suggestPay({ titles = [], years = 0, answers = {}, prefs = {}, ask = call } = {}) {
  const list = titles.map((t) => String(t || "").trim()).filter(Boolean);
  if (!list.length) throw new Error("Add the jobs you're looking for first (Settings > Jobs to look for).");
  const cc = countryCode(answers, prefs);
  const category = await kindOfWork(list, cc, ask);
  if (!category) throw new Error("freehire didn't answer just now. Try again in a minute.");
  const level = levelFor(Number(years) || 0, prefs);
  const usable = (r) => ((r && r.bands) || []).filter((b) => Number(b.sample_size) >= MIN_POSTINGS && Number(b.p50) > 0);
  let bands = [], scoped = level;
  try { bands = usable(await ask("salary_stats", { category, seniority: level, country: cc })); } catch { /* tried below without the level */ }
  if (!bands.length) {
    scoped = null;
    try { bands = usable(await ask("salary_stats", { category, country: cc })); } catch { /* none */ }
  }
  const base = { kind: kindName(category), category, level: scoped, country: cc };
  if (!bands.length) return { ...base, n: 0 };
  // By the hour for hourly work, by the year for office work; otherwise whichever more postings state.
  const prefer = prefs.jobKind === "hourly" ? "hour" : prefs.jobKind === "office" ? "year" : null;
  const sorted = [...bands].sort((x, y) => y.sample_size - x.sample_size);
  const pick = (prefer && sorted.find((b) => b.period === prefer)) || sorted[0];
  const one = (b) => ({ period: b.period, currency: b.currency || "USD", low: b.p25, mid: b.p50, high: b.p75, n: b.sample_size, text: payText(b.p50, b.period, b.currency || "USD") });
  return { ...base, ...one(pick), others: sorted.filter((b) => b !== pick).map(one) };
}
