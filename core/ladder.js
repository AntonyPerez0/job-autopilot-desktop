// "Move up": better-paying jobs a person could go for next, from their own work history.
//   1. Their current (or latest) job is matched to an official occupation (O*NET).
//   2. Jobs O*NET lists as related to it (and to those), that need at most one step more preparation
//      (O*NET Job Zones) and pay at least 10% more where they live (BLS, typical = median hourly pay).
//   3. The AI reads each against their approved facts: "ready now" (their facts show the usual must-haves)
//      or "one step away" (one thing missing, and how people usually get it). Advice only: nothing goes on
//      the resume, and every reason is checked against their resume.
import fs from "node:fs";
import zlib from "node:zlib";
import { approvedOnly } from "./engine.js";
import { getAnswers, getPrefs } from "./store.js";
import { BOSS, SAYS_BOSS, findOccupations } from "./onet.js";
import { ask, factCheck } from "./studio.js";
import { licenseGap } from "./discover.js";

const arr = (x) => (Array.isArray(x) ? x : []);
let D = null;
const data = () => (D ||= JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL("../vendor/onet/ladder.json.gz", import.meta.url))).toString("utf8")));
const ZONE = { 1: "little or no preparation", 2: "some preparation (a few months of training or experience)", 3: "medium preparation (vocational training, a license, or 1-2 years of experience)", 4: "considerable preparation (usually a bachelor's degree)", 5: "extensive preparation (a graduate degree)" };
const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico" };

// Typical (median) hourly pay for an occupation in a state, else across the U.S.
export function payOf(code, state) {
  const w = data().wages[String(code).slice(0, 7)] || {};
  return w[state] ? { hourly: w[state], area: STATES[state] || state } : w.US ? { hourly: w.US, area: "the U.S." } : null;
}
export const zoneOf = (code) => data().zones[code] || null;
// The person's state, from About you or their first city.
export function stateOf(a = getAnswers(), prefs = getPrefs()) {
  const s = String(a.state || "").trim();
  if (/^[A-Z]{2}$/i.test(s)) return s.toUpperCase();
  const byName = Object.entries(STATES).find(([, n]) => n.toLowerCase() === s.toLowerCase());
  if (byName) return byName[0];
  const c = arr(prefs.cities)[0];
  return c && c.country === "US" && c.admin1 ? String(c.admin1).toUpperCase() : "";
}

// The step-up candidates from an occupation, best pay first, with no AI involved.
export function stepsFrom(code, { state = "", nowHourly = 0, max = 14 } = {}) {
  const d = data();
  const zone = d.zones[code] || 2;
  const base = nowHourly || (payOf(code, state) || {}).hourly || 0;
  const seen = new Map();
  const consider = (c, tier, via) => {
    if (c === code || seen.has(c)) return;
    const pay = payOf(c, state), z = d.zones[c];
    if (!pay || !z || z > zone + 1 || (base && pay.hourly < base * 1.1)) return;
    // Work that hardly exists where they live (fewer than about 1,000 people in the state) isn't a real option.
    const n = state ? (d.jobs[String(c).slice(0, 7)] || {})[state] : null;
    if (state && (n === undefined || n < 10)) return;
    seen.set(c, { code: c, tier, via, zone: z, pay });
  };
  for (const [c, tier] of arr(d.related[code])) if (tier <= 2) consider(c, tier, null);
  // One more hop from the closest relatives: a lorry driver's relatives' relatives (often the next rung up).
  for (const [c, tier] of arr(d.related[code]).filter(([, t]) => t === 1)) for (const [c2, t2] of arr(d.related[c])) if (t2 === 1) consider(c2, tier + 1, c);
  return [...seen.values()].sort((a, b) => b.pay.hourly - a.pay.hourly).slice(0, max).map((x) => ({ ...x, base }));
}

// -> { from: { code, title, pay }, now: { hourly, from: "your pay" | "typical" }, ready: [...], step: [...] }
export async function moveUp(profile, a = getAnswers(), prefs = getPrefs()) {
  const p = approvedOnly(profile || {});
  const jobs = arr(p.experience);
  if (!jobs.length) throw new Error("Make or upload your resume and approve it first; the app works out where you could go from your jobs.");
  const state = stateOf(a, prefs);
  const facts = {
    jobs: jobs.map((e) => ({ title: e.title, employer: e.org, dates: e.dates, did: arr(e.bullets).slice(0, 6).map((b) => b.text) })),
    skills: arr(p.skills).map((s) => `${s.label}: ${s.items}`),
    education: arr(p.education).map((e) => [e.school, e.detail].filter(Boolean).join(", ")),
    driversLicense: a.driversLicense || "", cannotClaim: arr(a.cannotClaim),
  };
  // 1. Which official occupation their current job is (the AI picks from the title's candidates).
  const cur = jobs[0];
  const boss = SAYS_BOSS.test(`${cur.title} ${arr(cur.bullets).map((b) => b.text).join(" ")}`);
  const cands = findOccupations(cur.title, 8).filter((o) => boss || !BOSS.test(o.title)).slice(0, 6);
  if (!cands.length) throw new Error(`The app couldn't match "${cur.title}" to an occupation. Try a plainer job title on the Resume page.`);
  let pick = cands[0];
  try {
    const r = await ask([{ role: "system", content: `Which official occupation is this person's job? Pick by the work they describe, not the title's words. Return JSON only: {"i": index}` },
      { role: "user", content: `JOB: ${cur.title} at ${cur.org}\nWHAT THEY DO: ${arr(cur.bullets).map((b) => b.text).join("; ")}\n\nOCCUPATIONS:\n${cands.map((o, i) => `${i}. ${o.title}`).join("\n")}` }]);
    if (cands[Number(r.i)]) pick = cands[Number(r.i)];
  } catch { /* the title's best match */ }
  // 2. Better-paying related jobs within one step of preparation.
  const yourPay = Number(prefs.minPay) > 0 ? (prefs.minPayPer === "year" ? Number(prefs.minPay) / 2080 : Number(prefs.minPay)) : 0;
  const steps = stepsFrom(pick.code, { state, nowHourly: yourPay });
  const fromPay = payOf(pick.code, state);
  const now = yourPay ? { hourly: yourPay, from: "your pay" } : fromPay ? { hourly: fromPay.hourly, from: "typical" } : null;
  if (!steps.length) return { from: { ...pick, pay: fromPay }, now, ready: [], step: [], state };
  const names = Object.fromEntries(steps.map((s) => [s.code, occTitle(s.code)]));
  // 3. Ready now, or one step away, judged from their facts only.
  const sys = `You help a person find better-paying work they can realistically move up to from their own experience.
Give a verdict for EVERY occupation listed, in the same order (official U.S. occupation names, with typical pay and how much preparation it usually needs), judged from THEIR FACTS ONLY:
- "ready": their facts already show what most ads for it require. "why" names the facts that qualify them, in their words.
- "step": exactly one concrete thing is missing: a license class, an endorsement, a certification, a short course, or a first step leading others. Never "more experience" or "formal training" in general: name the actual credential (for example "Class A CDL", "Passenger (P) endorsement on your CDL", "ASE certification", "Forklift certification").
  "how": one plain sentence on how people usually get it: where, about how long, and about what it costs, with "usually" or "about" ("A CDL school, usually 3 to 8 weeks and about $3,000 to $7,000; some trucking companies pay for it").
- "no": it needs several steps (a degree, years of different work), or it isn't a realistic move from their work.
Also give "search": the short title most job ads use, 2-4 words ("Class A CDL Driver", "Diesel Mechanic", "Mail Carrier"); for a license they hold, name their class.
Never claim a license, certification, tool or experience their facts don't show. Their cannot-claim list: ${JSON.stringify(facts.cannotClaim)}.
Return JSON only: {"jobs": [{"code": "...", "status": "ready|step|no", "search": "...", "why": "one sentence to them, naming their facts", "need": "the one credential missing (step only)", "how": "how people usually get it (step only)"}]}`;
  const user = `THEIR FACTS\n${JSON.stringify(facts)}\n\nTHEIR CURRENT WORK: ${cur.title} (occupation: ${pick.title})\n\nOCCUPATIONS\n` +
    steps.map((s) => `${s.code} | ${names[s.code]} | typical ${money(s.pay.hourly)}/hr in ${s.pay.area} | ${ZONE[s.zone]}`).join("\n");
  const r = await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
  const by = new Map(steps.map((s) => [s.code, s]));
  const items = arr(r.jobs).filter((x) => by.has(x.code) && ["ready", "step"].includes(x.status) && String(x.search || "").trim()).map((x) => {
    const s = by.get(x.code);
    return { code: s.code, occupation: names[s.code], title: String(x.search).replace(/\s+/g, " ").trim().slice(0, 50), status: x.status,
      why: String(x.why || "").trim().slice(0, 240), need: String(x.need || "").trim().slice(0, 160), how: String(x.how || "").trim().slice(0, 280),
      pay: s.pay, gain: now ? Math.round(((s.pay.hourly - now.hourly) / now.hourly) * 100) : null, zone: s.zone };
  });
  // Every reason checked against their resume; a "ready" job whose title asks for a license class they don't hold is one step away.
  const verdict = await factCheck(items.map((x) => ({ text: x.why, source: JSON.stringify(facts) })));
  const kept = items.filter((x, i) => verdict === null || !verdict[i] || x.status === "step");
  for (const x of kept) {
    const gap = x.status === "ready" ? licenseGap(x.title, p) : "";
    if (gap) { x.status = "step"; x.need = x.need || gap.replace(/^the title asks for/, "most ads ask for"); }
  }
  const byPay = (a, b) => b.pay.hourly - a.pay.hourly;
  return JSON.parse(JSON.stringify({ from: { code: pick.code, title: pick.title, pay: fromPay }, now, state,
    ready: kept.filter((x) => x.status === "ready").sort(byPay), step: kept.filter((x) => x.status === "step").sort(byPay) }));
}

const money = (n) => "$" + Number(n).toFixed(2);
const occTitle = (code) => findOccupationsByCode(code) || code;
// O*NET occupation names come with the task data the app already bundles.
let NAMES = null;
function findOccupationsByCode(code) {
  if (!NAMES) {
    const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL("../vendor/onet/onet.json.gz", import.meta.url))).toString("utf8"));
    NAMES = new Map(d.codes.map((c, i) => [c, d.occ[i][0]]));
  }
  return NAMES.get(code) || "";
}
