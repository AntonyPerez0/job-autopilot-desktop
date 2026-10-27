// "Move up": work a person could go for next, from everything they've done and can do.
//   1. Each of their jobs is matched to an official occupation (O*NET), and the AI names other kinds of
//      work their skills, projects and education point to.
//   2. Jobs O*NET lists as related to those (at most one step more preparation, O*NET Job Zones) and the
//      AI's ideas, kept when they pay about the same or more where they live (BLS, typical = median hourly pay).
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

// Work they could go for next, ranked by pay. `floor` is the lowest pay kept, as a share of theirs:
// 1.1 keeps only jobs paying at least 10% more; 0.9 also keeps other directions at about the same pay.
export function stepsFrom(code, { state = "", nowHourly = 0, max = 14, floor = 1.1 } = {}) {
  const d = data();
  const zone = d.zones[code] || 2;
  const base = nowHourly || (payOf(code, state) || {}).hourly || 0;
  const seen = new Map();
  const consider = (c, tier, via) => {
    if (c === code || seen.has(c)) return;
    const pay = payOf(c, state), z = d.zones[c];
    if (!pay || !z || z > zone + 1 || (base && pay.hourly < base * floor)) return;
    if (!commonIn(c, state)) return;
    seen.set(c, { code: c, tier, via, zone: z, pay });
  };
  for (const [c, tier] of arr(d.related[code])) if (tier <= 2) consider(c, tier, null);
  // One more hop from the closest relatives: a lorry driver's relatives' relatives (often the next rung up).
  for (const [c, tier] of arr(d.related[code]).filter(([, t]) => t === 1)) for (const [c2, t2] of arr(d.related[c])) if (t2 === 1) consider(c2, tier + 1, c);
  return [...seen.values()].sort((a, b) => b.pay.hourly - a.pay.hourly).slice(0, max).map((x) => ({ ...x, base }));
}
// Work that hardly exists where they live (fewer than about 1,000 people in the state) isn't a real option.
function commonIn(code, state) {
  if (!state) return true;
  const n = (data().jobs[String(code).slice(0, 7)] || {})[state];
  return n !== undefined && n >= 10;
}

// -> { from: { code, title, pay }, based: [...their jobs' occupations], now, state, ready: [...], step: [...] }
// Ideas come from every job they had and from their skills, projects and education, not only their latest job;
// work at about the same pay counts too (a change of direction), and work they said isn't for them is left out.
export async function moveUp(profile, a = getAnswers(), prefs = getPrefs()) {
  const p = approvedOnly(profile || {});
  const allJobs = arr(p.experience);
  if (!allJobs.length) throw new Error("Make or upload your resume and approve it first; the app works out where you could go from your jobs.");
  const state = stateOf(a, prefs);
  const facts = {
    jobs: allJobs.map((e) => ({ title: e.title, employer: e.org, dates: e.dates, did: arr(e.bullets).slice(0, 6).map((b) => b.text) })),
    projects: arr(p.projects).map((x) => ({ title: x.title, did: arr(x.bullets).slice(0, 4).map((b) => b.text) })),
    skills: arr(p.skills).map((s) => `${s.label}: ${s.items}`),
    education: arr(p.education).map((e) => [e.school, e.detail].filter(Boolean).join(", ")),
    driversLicense: a.driversLicense || "", cannotClaim: arr(a.cannotClaim),
  };
  const toward = String(prefs.moveToward || "").trim().slice(0, 300);
  const searching = arr(prefs.titles).map(String).filter(Boolean).slice(0, 8);
  const notForMe = new Set(arr(prefs.notForMe).map((x) => String(x.code || x)));
  // 1. Which official occupation each of their jobs is (newest first, up to four different titles), and other
  //    kinds of work their skills, projects and education point to. The AI picks; the data says what each pays.
  const jobs = allJobs.filter((e, i) => allJobs.findIndex((x) => norm(x.title) === norm(e.title)) === i).slice(0, 4);
  const cands = jobs.map((e) => {
    const boss = SAYS_BOSS.test(`${e.title} ${arr(e.bullets).map((b) => b.text).join(" ")}`);
    return findOccupations(e.title, 8).filter((o) => boss || !BOSS.test(o.title)).slice(0, 6);
  });
  if (!cands[0].length) throw new Error(`The app couldn't match "${jobs[0].title}" to an occupation. Try a plainer job title on the Resume page.`);
  let picks = cands.map((c) => c[0]), ideas = [];
  try {
    const r = await ask([{ role: "system", content: `A person wants to know what work they could go for next.
1. For each of their jobs, pick which official occupation it is, by the work they describe, not the title's words.
2. Suggest up to 8 OTHER kinds of work that their skills, projects, education and experience point to: other fields where what they have done and can do is used, not only the usual next job in their current line. Base them on their facts; what they say they would like is a direction, not a fact.
Leave out the kinds of work they already search for and the ones listed as not for them. Use the short title most job ads use, 1-4 words.
Return JSON only: {"jobs": [index of the occupation, one per job, in order], "ideas": ["job title", ...]}` },
      { role: "user", content: `THEIR FACTS\n${JSON.stringify(facts)}\n\n` +
        (toward ? `WORK THEY WOULD LIKE TO MOVE TOWARD: ${toward}\n` : "") + (searching.length ? `THEY ALREADY SEARCH FOR: ${searching.join(", ")}\n` : "") +
        (notForMe.size ? `NOT FOR THEM: ${arr(prefs.notForMe).map((x) => x.title || x).join(", ")}\n` : "") + "\n" +
        jobs.map((e, k) => `JOB ${k}: ${e.title} at ${e.org}\nOCCUPATIONS:\n${cands[k].map((o, i) => `  ${i}. ${o.title}`).join("\n") || "  (none)"}`).join("\n") }]);
    picks = cands.map((c, k) => c[Number(arr(r.jobs)[k])] || c[0]);
    ideas = arr(r.ideas).map((t) => String(t || "").trim()).filter(Boolean).slice(0, 8);
  } catch { /* each title's best match, and no ideas beyond the related work */ }
  const starts = picks.filter((o, i) => o && picks.findIndex((x) => x && x.code === o.code) === i);
  const cur = starts[0];
  // 2. Candidates paying about the same or more: related work from each of their jobs (O*NET), and the ideas.
  const yourPay = Number(prefs.minPay) > 0 ? (prefs.minPayPer === "year" ? Number(prefs.minPay) / 2080 : Number(prefs.minPay)) : 0;
  const fromPay = payOf(cur.code, state);
  const now = yourPay ? { hourly: yourPay, from: "your pay" } : fromPay ? { hourly: fromPay.hourly, from: "typical" } : null;
  const base = now ? now.hourly : 0;
  const own = new Set(starts.map((o) => o.code));
  const hiddenTitles = new Set(arr(prefs.notForMe).map((x) => norm(x.title || "")).filter(Boolean));
  const taken = new Set([...searching, ...jobs.map((e) => e.title)].map(norm));
  const steps = [];
  // The ideas are job titles; which official occupation each is (for its pay) is picked from the title's
  // closest matches, or none: word matching alone turns "Developer Advocate" into urban planning.
  const fresh = ideas.filter((t, i) => !taken.has(norm(t)) && !hiddenTitles.has(norm(t)) && ideas.findIndex((x) => norm(x) === norm(t)) === i);
  // a manager's pay is only a fair measure for someone whose facts show they led people
  const led = SAYS_BOSS.test(JSON.stringify(facts.jobs));
  const options = fresh.map((t) => findOccupations(t, 8).filter((o) => led || SAYS_BOSS.test(t) || !BOSS.test(o.title)).slice(0, 5));
  let mapped = [];
  if (fresh.length) try {
    const m = await ask([{ role: "system", content: `For each job title, pick the official occupation that is the same work, judged by what people in that job do. If none of the listed ones is the same work, use -1. Return JSON only: {"map": [index or -1, one per title, in order]}` },
      { role: "user", content: fresh.map((t, k) => `TITLE ${k}: ${t}
${options[k].map((o, i) => `  ${i}. ${o.title}`).join("\n")}`).join("\n") }]);
    mapped = fresh.map((t, k) => options[k][Number(arr(m.map)[k])] || null);
  } catch { mapped = []; }
  fresh.forEach((t, k) => {
    const o = mapped[k];
    if (!o || own.has(o.code)) return;
    const pay = payOf(o.code, state), z = zoneOf(o.code);
    if (!pay || !z || (base && pay.hourly < base * 0.9) || !commonIn(o.code, state)) return;
    steps.push({ id: "", code: o.code, rank: 0, zone: z, pay, idea: t });
  });
  // Then the work O*NET lists as related to each of their jobs (the latest job's first).
  const inList = new Set([...own, ...notForMe, ...steps.map((x) => x.code)]);
  for (const t of searching) { const o = findOccupations(t, 1)[0]; if (o && norm(o.title).startsWith(norm(t).split(" ")[0])) inList.add(o.code); }
  const related = [];
  starts.forEach((o, k) => {
    for (const x of stepsFrom(o.code, { state, nowHourly: base, floor: 0.9, max: 30 })) {
      if (inList.has(x.code) || related.some((y) => y.code === x.code)) continue;
      related.push({ ...x, rank: x.tier + k });
    }
  });
  related.sort((x, y) => x.rank - y.rank || y.pay.hourly - x.pay.hourly);
  steps.push(...related.slice(0, Math.max(6, 18 - steps.length)));
  steps.forEach((x, i) => { x.id = "j" + i; });
  const based = jobs.map((e) => e.title);
  if (!steps.length) return { from: { code: cur.code, title: cur.title, pay: fromPay }, based, now, state, ready: [], step: [] };
  const names = Object.fromEntries(steps.map((s) => [s.code, occTitle(s.code)]));
  // 3. Ready now, or one step away, judged from their facts only.
  const sys = `You help a person find work they can realistically go for next, from what they have done and what they can do: better-paying work, or a change of direction at about the same pay.
Give a verdict for EVERY occupation listed, in the same order (official U.S. occupation names, with typical pay and how much preparation it usually needs), judged from THEIR FACTS ONLY. Their skills, projects and education count as much as their job titles.
- "ready": their facts already show what most ads for it require. "why" names the facts that qualify them, in their words.
- "step": exactly one concrete thing is missing: a license class, an endorsement, a certification, a short course, a portfolio piece, or a first step leading others. Never "more experience" or "formal training" in general: name the actual thing (for example "Class A CDL", "Passenger (P) endorsement on your CDL", "ASE certification", "Forklift certification", "A small project using SQL to show employers").
  "how": one plain sentence on how people usually get it: where, about how long, and about what it costs, with "usually" or "about" ("A CDL school, usually 3 to 8 weeks and about $3,000 to $7,000; some trucking companies pay for it").
- "no": it needs several steps (a degree, years of different work), or it isn't a realistic move from their facts.
Also give "search": the short title most job ads use, 2-4 words ("Class A CDL Driver", "Diesel Mechanic", "Mail Carrier"); for a license they hold, name their class.
Never claim a license, certification, tool or experience their facts don't show. Their cannot-claim list: ${JSON.stringify(facts.cannotClaim)}.
A line that names a job title before its official occupation is that job: judge that job, and use its title for "search" unless ads word it differently.
Return JSON only: {"jobs": [{"id": "j0", "status": "ready|step|no", "search": "...", "why": "one sentence to them, saying 'you' (never 'they'), naming their facts", "need": "the one thing missing (step only)", "how": "how people usually get it (step only)"}]}`;
  const user = `THEIR FACTS\n${JSON.stringify(facts)}\n\nTHEIR WORK SO FAR: ${jobs.map((e, k) => `${e.title} (occupation: ${(picks[k] || {}).title || "?"})`).join("; ")}\n` +
    (toward ? `WORK THEY WOULD LIKE TO MOVE TOWARD (a wish, not a fact): ${toward}\n` : "") + `\nOCCUPATIONS\n` +
    steps.map((s) => `${s.id} | ${s.idea ? `${s.idea} (official occupation: ${names[s.code]})` : names[s.code]} | typical ${money(s.pay.hourly)}/hr in ${s.pay.area} | ${ZONE[s.zone]}`).join("\n");
  const r = await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
  const by = new Map(steps.map((s) => [s.id, s]));
  const items = arr(r.jobs).filter((x) => by.has(x.id) && ["ready", "step"].includes(x.status) && String(x.search || "").trim()).map((x) => {
    const s = by.get(x.id);
    const gain = now ? Math.round(((s.pay.hourly - now.hourly) / now.hourly) * 100) : null;
    return { code: s.code, occupation: names[s.code], title: String(x.search).replace(/\s+/g, " ").trim().slice(0, 50), status: x.status,
      why: String(x.why || "").trim().slice(0, 240), need: String(x.need || "").trim().slice(0, 160), how: String(x.how || "").trim().slice(0, 280),
      pay: s.pay, gain, same: gain !== null && gain < 10, zone: s.zone, fromSkills: !!s.idea };
  });
  // Every reason checked against their resume; a "ready" job whose title asks for a license class they don't hold is one step away.
  const verdict = await factCheck(items.map((x) => ({ text: x.why, source: JSON.stringify(facts) })));
  // A step's reason the fact check flags is dropped (the step and what it needs stay).
  if (verdict) items.forEach((x, i) => { if (verdict[i] && x.status === "step") x.why = ""; });
  // A title they said isn't for them stays out, however the AI worded the line it came from.
  const kept = items.filter((x, i) => (verdict === null || !verdict[i] || x.status === "step") && !hiddenTitles.has(norm(x.title)));
  for (const x of kept) {
    const gap = x.status === "ready" ? licenseGap(x.title, p) : "";
    if (gap) { x.status = "step"; x.need = x.need || gap.replace(/^the title asks for/, "most ads ask for"); }
  }
  const byPay = (a, b) => b.pay.hourly - a.pay.hourly;
  // the same job title from two lines (an idea and a related occupation) is shown once
  const once = (list) => list.filter((x, i) => list.findIndex((y) => norm(y.title) === norm(x.title)) === i);
  return JSON.parse(JSON.stringify({ from: { code: cur.code, title: cur.title, pay: fromPay }, based, now, state,
    ready: once(kept.filter((x) => x.status === "ready").sort(byPay)), step: once(kept.filter((x) => x.status === "step").sort(byPay)) }));
}

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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
