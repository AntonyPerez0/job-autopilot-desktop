// Resume studio: make a resume from the user's own answers to a few questions,
// improve the one they have, and check it against what recruiters look for.
//
// Honesty comes first, as everywhere in the app:
// - the AI only rewords what the user said; it never adds a number, tool, employer
//   or result the user didn't give (checked below, not just asked for in the prompt);
// - where a number or result would make a line stronger, it asks the user instead of guessing;
// - nothing it writes is used until the user approves it.
import { Profile, Tailor, aiSettings, approvedOnly } from "./engine.js";

const arr = (x) => (Array.isArray(x) ? x : []);
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);

// ---------- the recruiter checklist (no AI: plain rules, same answer every time) ----------

const WEAK_START = /^(responsible for|duties (included|include)|helped( to)?|worked (on|with|as)|assisted( with)?|tasked with|in charge of|involved in|participated in|was |were |did |handled various|various)\b/i;
const PRONOUN = /\b(I|me|my|mine|we|our)\b/;
const HAS_NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|dozens?|hundreds?|thousands?)\b/i;
const CLICHE = /\b(hard[- ]working|team player|detail[- ]oriented|go[- ]getter|self[- ]starter|results[- ]driven|think outside the box|synergy|dynamic|passionate|rock ?star|ninja|guru|best of breed|proven track record)\b/i;

// Each check: { id, level: "good"|"fix"|"tip", title, detail, items: [{ path, text, why }] }
export function checklist(profile, answers = {}, fit = null) {
  const p = approvedOnly(profile);
  const out = [];
  const add = (id, level, title, detail, items = []) => out.push({ id, level, title, detail, items });
  const bullets = [];
  for (const k of ["experience", "projects"]) arr(p[k]).forEach((e) => arr(e.bullets).forEach((b) => bullets.push({ path: `${k}.${e.id}.${b.id}`, text: b.text, entry: e })));

  const contact = [answers.email || (p.contact || {}).email, answers.phone || (p.contact || {}).phone, answers.city || (p.contact || {}).location];
  if (contact.every(Boolean)) add("contact", "good", "Contact details are complete", "Email, phone and city are at the top.");
  else add("contact", "fix", "Add your contact details", "Recruiters need an email, a phone number and your city. Add them under About you.");

  if (fit) {
    if (fit.overflow) add("length", "fix", "It runs past one page", "Recruiters spend seconds on a resume; one page is the rule for most jobs. Remove or shorten a few lines.");
    else if (fit.slack > 200) add("length", "tip", "There's room for more", `About ${Math.round(fit.slack / 12)} empty lines at the bottom. Add another job, project or a few lines about what you did.`);
    else add("length", "good", "Fits on one page", "One page, with little wasted space.");
  }

  const summary = arr(p.summaries)[0];
  if (!summary) add("summary", "tip", "Add a short summary", "Two or three sentences at the top saying who you are and what you're good at help a recruiter decide to keep reading.");
  else {
    const n = String(summary.text).split(/[.!?]+\s/).filter((x) => x.trim()).length;
    if (n > 4 || words(summary.text).length > 75) add("summary", "fix", "Shorten the summary", "Keep it to two to four sentences (under about 60 words).", [{ path: `summaries.${summary.id}`, text: summary.text, why: `${words(summary.text).length} words` }]);
    else add("summary", "good", "The summary is short and to the point", "");
  }

  if (!bullets.length) add("bullets", "fix", "Add what you did at each job", "Each job needs two to four short lines about what you did.");
  const weak = bullets.filter((b) => WEAK_START.test(b.text.trim()));
  if (weak.length) add("verbs", "fix", "Start lines with an action word", "\"Responsible for\" or \"Helped with\" hide what you did. Start with a verb: Served, Built, Trained, Organized, Fixed.", weak.map((b) => ({ ...b, why: "weak start" })));
  else if (bullets.length) add("verbs", "good", "Every line starts with an action", "");
  const pron = bullets.filter((b) => PRONOUN.test(b.text));
  if (pron.length) add("pronouns", "fix", "Leave out \"I\" and \"my\"", "Resume lines read as if \"I\" comes first: \"Trained new staff\", not \"I trained new staff\".", pron.map((b) => ({ ...b, why: "uses I/my/we" })));
  const long = bullets.filter((b) => b.text.length > 200);
  if (long.length) add("long", "fix", "Shorten long lines", "One or two lines each. Long lines get skipped.", long.map((b) => ({ ...b, why: `${b.text.length} characters` })));
  const short = bullets.filter((b) => words(b.text).length < 4);
  if (short.length) add("short", "tip", "Say a little more", "A line of two or three words doesn't show what you did or how well.", short.map((b) => ({ ...b, why: "very short" })));
  const cliche = [...bullets, ...arr(p.summaries).map((s) => ({ path: `summaries.${s.id}`, text: s.text }))].filter((b) => CLICHE.test(b.text));
  if (cliche.length) add("cliche", "fix", "Swap buzzwords for facts", "\"Hard-working team player\" is on every resume. Show it with something you did instead.", cliche.map((b) => ({ ...b, why: (b.text.match(CLICHE) || [""])[0] })));
  const banned = bullets.filter((b) => Profile.textIssues(b.text, p).some((x) => /^uses/.test(x)));
  if (banned.length) add("banned", "fix", "Words on your avoid list", "These lines use words from your list of words to avoid.", banned.map((b) => ({ ...b, why: Profile.textIssues(b.text, p).join(", ") })));
  if (bullets.length >= 3) {
    const withNum = bullets.filter((b) => HAS_NUMBER.test(b.text)).length;
    if (withNum / bullets.length < 0.3) add("numbers", "tip", "Show size and results where you can", `Only ${withNum} of ${bullets.length} lines have a number. "Served about 200 customers a day" says more than "Served customers". Only use numbers you know are true; the improver will ask you for them.`,
      bullets.filter((b) => !HAS_NUMBER.test(b.text)).slice(0, 8).map((b) => ({ ...b, why: "no number" })));
    else add("numbers", "good", "Lines show size and results", `${withNum} of ${bullets.length} lines have a number.`);
  }
  for (const e of arr(p.experience)) {
    const n = arr(e.bullets).length;
    if (n === 1) add(`few-${e.id}`, "tip", `Add a line to ${e.title}`, "Two to four lines per job looks complete.");
    if (n > 6) add(`many-${e.id}`, "tip", `Trim ${e.title}`, `It has ${n} lines; recruiters read three or four. The app picks the best ones per job, but fewer, stronger lines help.`);
  }
  const dates = arr(p.experience).map((e) => e.dates).filter(Boolean);
  const styles = new Set(dates.map((d) => (/\b[A-Z][a-z]{2,8}\.? \d{4}/.test(d) ? "month" : /\d{1,2}\/\d{4}/.test(d) ? "slash" : "year")));
  if (styles.size > 1) add("dates", "fix", "Write dates the same way", "Pick one style, such as \"Jun 2023 - Present\", for every job.", arr(p.experience).map((e) => ({ path: `experience.${e.id}`, text: e.dates, why: e.title })));
  const groups = arr(p.skills);
  if (!groups.length) add("skills", "tip", "Add a skills line", "A short list of skills (tools, machines, languages, certifications) helps both recruiters and the software that screens resumes.");
  else if (groups.some((g) => String(g.items).split(",").length > 15)) add("skills", "tip", "Keep skills lists short", "Fifteen or fewer per line; list the ones that matter for the jobs you want.");
  return out;
}

// ---------- the honesty check (no AI) ----------

const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000 };
export function numbersIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\d[\d,]*(\.\d+)?/g)) out.add(String(Number(m[0].replace(/,/g, ""))));
  for (const m of String(text).toLowerCase().matchAll(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|thousand)\b/g)) out.add(String(NUM_WORDS[m[1]]));
  return out;
}
const SENT_START = /(^|[.!?:;]\s+|\(\s*)$/;
// Names, tools and other specific words: capitalized not at a sentence start, or with digits or symbols (C++, 5S, AWS).
export function specificTerms(text) {
  const out = new Set();
  const t = String(text);
  for (const m of t.matchAll(/[A-Za-z][A-Za-z0-9+#./&'-]*/g)) {
    const w = m[0].replace(/[.'-]+$/, "");
    const before = t.slice(0, m.index);
    const capital = /^[A-Z]/.test(w) && !SENT_START.test(before);
    const odd = /[0-9+#]/.test(w) || /^[A-Z]{2,}$/.test(w);
    if ((capital || odd) && w.length > 1 && !/^(I|AI)$/.test(w)) out.add(w.toLowerCase());
  }
  return out;
}

// What a suggestion adds that its sources don't contain. sources: strings the user gave (their line, their answers).
export function addedFacts(suggestion, sources, allowed = []) {
  const src = sources.join("\n");
  const srcNums = numbersIn(src), srcLower = src.toLowerCase();
  const ok = new Set(allowed.map((x) => String(x).toLowerCase()));
  const problems = [];
  for (const n of numbersIn(suggestion)) if (!srcNums.has(n)) problems.push(`the number ${n}`);
  for (const w of specificTerms(suggestion)) if (!srcLower.includes(w) && !ok.has(w)) problems.push(`"${w}"`);
  return problems;
}

// Praise the person didn't claim: allowed only when their own words use it.
const INFLATE = /\b(proven|expert|expertise|seasoned|highly[- ]skilled|high[- ]performance|high[- ]performing|exceptional|outstanding|extensive|world[- ]class|top[- ]performing|award[- ]winning|experienced|mastery|master of)\b/gi;
// Words that limit a claim, with the ones that mean the same: a rewrite may not drop them.
const HEDGES = [["about", "approximately", "roughly", "around", "nearly", "almost", "some", "~"], ["help", "helped", "assist", "assisted", "support", "supported", "contributed", "helping", "assisting", "supporting"],
  ["part-time", "part time"], ["leaning"], ["junior"], ["intern", "internship"], ["co-led", "co-founded", "co-wrote", "co-authored", "jointly", "shared"], ["partially", "partly"]];
export function droppedHedges(original, text) {
  const o = String(original || "").toLowerCase(), t = String(text || "").toLowerCase();
  const has = (s, w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(s) || (w.endsWith("-") ? false : s.includes(w + "-"));
  // "about", "around", "some" limit a claim only in front of a number ("about 20"), not in "questions about policies".
  const APPROX = /\b(about|approximately|roughly|around|nearly|almost|some|maybe|~)\s*(\$?\d|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|forty|fifty|a (few|dozen|hundred))/;
  return HEDGES.filter((g, i) => (i === 0 ? APPROX.test(o) && numbersIn(t).size && !APPROX.test(t)
    : g.some((w) => has(o, w)) && !g.some((w) => has(t, w)))).map((g, i) => (g === HEDGES[0] ? (o.match(APPROX) || [])[1] : g.find((w) => has(o, w))));
}

// Accept a suggested line only if it adds nothing and breaks no rule; otherwise say why.
// original: the line being reworded, whose limiting words must survive.
export function vet(text, sources, profile, allowed = [], original = null) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, why: ["empty"] };
  const src = sources.join(" ").toLowerCase();
  const why = [...addedFacts(t, sources, allowed).map((x) => `adds ${x}, which you didn't say`), ...Profile.textIssues(t, profile)];
  for (const m of t.matchAll(INFLATE)) if (!src.includes(m[0].toLowerCase())) why.push(`calls you "${m[0]}", which you didn't say`);
  if (original) for (const h of droppedHedges(original, t)) why.push(`drops "${h}", which makes the claim bigger`);
  if (PRONOUN.test(t)) why.push("uses I/my");
  return { ok: !why.length, why };
}

// Names the user already gave anywhere (employers, titles, schools, skills): rewording may use them.
export function knownTerms(profile, answers = {}) {
  const out = [];
  const add = (s) => { for (const w of specificTerms(s)) out.push(w); for (const w of String(s || "").toLowerCase().split(/[^a-z0-9+#.]+/)) if (w) out.push(w); };
  for (const k of ["experience", "projects"]) for (const e of arr(profile[k])) { add(e.title); add(e.org); add(e.location); }
  for (const s of arr(profile.skills)) add(s.items);
  for (const e of arr(profile.education)) { add(e.school); add(e.detail); }
  add(answers.city); add(answers.state); add(answers.currentEmployer);
  return out;
}

// ---------- shared writing rules for the AI ----------

const GUIDE = `How recruiters want resume lines written:
- Start with a strong action verb (Served, Trained, Built, Organized, Resolved, Cut, Opened, Stocked, Led). Past tense for anything already done or finished, even at a current job; present tense only for ongoing daily duties at a current job. Never change the tense of a line that already uses the past tense for something finished.
- Never describe the person with praise they didn't use themselves (proven, expert, experienced, seasoned, high-performing, exceptional). Keep every word that limits a claim (about, helped, part-time, assisted, leaning, shared).
- Plain, concrete words. Avoid vague corporate phrases ("service delivery", "client relationships", "stakeholders", "various tasks") when a plain one says it ("families asked me back").
- Say what was done and, when the person gave one, the size or result (how many, how much, how often, what improved).
- One line each: about 8 to 20 words, at most 150 characters. No "I", "my" or "we". No buzzwords (hard-working, team player, detail-oriented, passionate, results-driven).
- Plain words a hiring manager in that field uses. Keep the person's own specific terms (machines, tools, product names).
- No em dashes.
THE HONESTY RULE (most important): use only facts the person gave. Never add a number, percentage, amount, tool, employer, certification, title or result they did not state. If a line would be stronger with a number or result you don't have, do NOT guess: write the honest line without it and ask a short question to get it.`;

const settings = () => aiSettings();
// The model sometimes answers with broken JSON; ask again (up to three times) before giving up.
async function ask(messages) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await Tailor.chat(settings(), messages); } catch (e) { last = e; if (/Model API 4(0[0-3]|04)/.test(e.message)) break; }
  }
  throw last;
}

// A second, separate AI pass: is every claim in each line backed by the person's own words?
// items: [{ text, source }]. Returns the problems per item ("" when fine); null if the check couldn't run.
export async function factCheck(items) {
  if (!items.length) return [];
  const sys = `You fact-check resume lines against what the person actually said. For each line, list every claim, detail or feeling in the line that their words do not support
(an added detail like "card payments" when they only said "cash", a feeling like "enjoys" they never stated, a bigger scope, a result they didn't give).
Rewording, a stronger verb, and a direct summary of what they said are fine. Return JSON only: {"lines": [{"i": 0, "unsupported": "the unsupported part, or empty"}]}`;
  const user = items.map((x, i) => `${i}. LINE: ${x.text}\n   THEIR WORDS: ${x.source}`).join("\n");
  try {
    const r = await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
    const out = items.map(() => "");
    for (const l of arr(r.lines)) if (items[l.i] !== undefined) out[l.i] = String(l.unsupported || "").trim().replace(/^["'“”]+|["'“”]+$/g, "").replace(/^(none|n\/a|empty|-)\.?$/i, "");
    return out;
  } catch { return null; }
}

// ---------- create: from the user's answers to resume pieces ----------

// interview: { target, summary, jobs: [{ title, employer, location, start, end, current, daily, proud, numbers, tools }],
//   education: [{ school, earned, year }], certifications, skills, languages, volunteer }
export function interviewText(iv) {
  const lines = [];
  if (iv.target) lines.push(`JOB THEY WANT NEXT: ${iv.target}`);
  if (iv.summary) lines.push(`ABOUT THEM, IN THEIR WORDS: ${iv.summary}`);
  arr(iv.jobs).forEach((j, i) => {
    lines.push(`\nJOB ${i + 1}: ${j.title || "?"} at ${j.employer || "?"}${j.location ? ", " + j.location : ""} (${j.start || "?"} to ${j.current ? "now" : j.end || "?"})`);
    if (j.daily) lines.push(`What they did on a normal day: ${j.daily}`);
    if (j.proud) lines.push(`What they're proud of / what went well: ${j.proud}`);
    if (j.numbers) lines.push(`Numbers they gave: ${j.numbers}`);
    if (j.tools) lines.push(`Tools, machines, software they used: ${j.tools}`);
    if (arr(j.confirmed).length) lines.push(`They also confirmed they: ${j.confirmed.map((c) => c.q.replace(/^did you\s*/i, "").replace(/\?$/, "") + (c.detail ? ` (${c.detail})` : "")).join("; ")}`);
  });
  for (const e of arr(iv.education)) if (e.school) lines.push(`\nSCHOOL: ${e.school}${e.earned ? ", " + e.earned : ""}${e.year ? " (" + e.year + ")" : ""}`);
  if (iv.certifications) lines.push(`\nCERTIFICATIONS AND LICENSES: ${iv.certifications}`);
  if (iv.skills) lines.push(`SKILLS: ${iv.skills}`);
  if (iv.languages) lines.push(`LANGUAGES: ${iv.languages}`);
  if (iv.volunteer) lines.push(`VOLUNTEERING / OTHER: ${iv.volunteer}`);
  return lines.join("\n");
}

const slug = (s, taken) => {
  let b = String(s || "x").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x", id = b, n = 2;
  while (taken.has(id)) id = `${b}-${n++}`;
  taken.add(id);
  return id;
};

export async function createFromInterview(iv, profile0 = null, answers = {}) {
  const facts = interviewText(iv);
  const sys = `You write a one-page resume from a person's own answers to interview questions.
${GUIDE}
Write 2 to 4 lines per job from what they said (not from the "They also confirmed" items: those get their own lines separately), and a 2 to 3 sentence summary aimed at the job they want next (only from their facts).
For every line, quote the part of their answers it comes from in "source".
Return JSON only:
{"summary": "...", "jobs": [{"index": 0, "bullets": [{"text": "...", "source": "their words this line is based on"}], "questions": ["a short question that would let a line show a number or result"]}],
 }`;
  const r = await ask([{ role: "system", content: sys }, { role: "user", content: facts }]);
  const base = profile0 ? JSON.parse(JSON.stringify(profile0)) : { schema: Profile.SCHEMA, name: answers.firstName ? `${answers.firstName} ${answers.lastName || ""}`.trim() : "Your Name", contact: {}, rules: Profile.EXAMPLE.rules };
  for (const k of ["summaries", "experience", "projects", "skills", "education", "headers", "bases"]) base[k] = arr(base[k]);
  const p = base;
  const known = knownTerms(p, answers);
  const rejected = [], questions = [];
  const expIds = new Set(p.experience.map((e) => e.id)), sumIds = new Set(p.summaries.map((s) => s.id)), skIds = new Set(p.skills.map((s) => s.id));
  const newExp = [];
  for (const [i, j] of arr(iv.jobs).entries()) {
    if (!j.title && !j.employer) continue;
    const out = arr(r.jobs).find((x) => Number(x.index) === i) || {};
    const sources = [j.title, j.employer, j.location, j.daily, j.proud, j.numbers, j.tools, ...arr(j.confirmed).map(yesSource)].filter(Boolean);
    const bt = new Set();
    const bullets = [];
    for (const b of arr(out.bullets)) {
      const text = Profile.stripDashes(String(b.text || "")).trim();
      const v = vet(text, sources, p, [...known, ...specificTerms(j.title), ...specificTerms(j.employer)]);
      if (v.ok) bullets.push({ id: slug(text.split(/\s+/).slice(0, 2).join(" "), bt), text, approved: false, source: String(b.source || "").slice(0, 300) });
      else rejected.push({ job: j.title, text, why: v.why });
    }
    // Nothing the AI wrote survived the check: the person's own words, as they gave them.
    if (!bullets.length && j.daily) for (const part of String(j.daily).split(/[.;\n]+/).map((x) => x.trim()).filter((x) => words(x).length >= 2).slice(0, 3)) {
      bullets.push({ id: slug(part.split(/\s+/).slice(0, 2).join(" "), bt), text: part[0].toUpperCase() + part.slice(1), approved: false, source: part });
    }
    // The things they said yes to when the app jogged their memory.
    if (arr(j.confirmed).length) {
      const extra = await linesFromConfirmed(j, j.confirmed, p, answers);
      for (const l of extra.lines) {
        if (bullets.some((b) => b.text.toLowerCase() === l.text.toLowerCase())) continue;
        bullets.push({ id: slug(l.text.split(/\s+/).slice(0, 2).join(" "), bt), text: l.text, approved: false, source: l.source, ...(l.warning ? { warning: l.warning } : {}), recalled: true });
      }
      rejected.push(...extra.rejected.map((x) => ({ job: j.title, ...x })));
    }
    for (const q of arr(out.questions).slice(0, 3)) questions.push({ job: `${j.title} at ${j.employer}`, question: String(q) });
    const dates = `${j.start || ""}${j.start || j.end || j.current ? " – " : ""}${j.current ? "Present" : j.end || ""}`.trim();
    newExp.push({ id: slug(j.employer || j.title, expIds), title: j.title || "", org: j.employer || "", location: j.location || "", dates, minBullets: Math.min(2, bullets.length), bullets });
  }
  // The second pass: anything the person's answers don't back up gets a visible note for them.
  const toCheck = [];
  newExp.forEach((e, k) => {
    const j = arr(iv.jobs).filter((x) => x.title || x.employer)[k] || {};
    const src = [j.title, j.employer, j.daily, j.proud, j.numbers, j.tools, ...arr(j.confirmed).map(yesSource)].filter(Boolean).join(". ");
    for (const b of e.bullets) if (!b.recalled) toCheck.push({ b, text: b.text, source: src });
    for (const b of e.bullets) delete b.recalled;
  });
  const verdict = await factCheck(toCheck);
  toCheck.forEach((x, i) => {
    if (verdict === null) x.b.warning = "This line wasn't double-checked (the check didn't run). Read it carefully.";
    else if (verdict[i]) x.b.warning = `Check this: "${verdict[i]}" isn't in your answers. Edit it out or delete the line if it isn't true.`;
  });
  p.experience.push(...newExp);
  let sumText = Profile.stripDashes(String(r.summary || "")).trim();
  let sv = vet(sumText, [facts], p, known);
  // One more try for the summary, saying exactly what was wrong with the first.
  if (sumText && !sv.ok) {
    try {
      const again = await ask([{ role: "system", content: `Write a 2 to 3 sentence resume summary from a person's own answers, aimed at the job they want next.\n${GUIDE}\nYour last try was rejected because it ${sv.why.join("; ")}. Avoid these words too: ${arr((p.rules || {}).bannedWords).join(", ")}.\nReturn JSON only: {"summary": "..."}` },
        { role: "user", content: facts }]);
      const t2 = Profile.stripDashes(String(again.summary || "")).trim();
      const v2 = vet(t2, [facts], p, known);
      if (v2.ok) { sumText = t2; sv = v2; }
    } catch { /* keep the first result's verdict */ }
  }
  let summaryId = null;
  if (sumText && sv.ok) {
    const sumCheck = await factCheck([{ text: sumText, source: facts }]);
    const warning = sumCheck === null ? "This summary wasn't double-checked. Read it carefully." : sumCheck[0] ? `Check this: "${sumCheck[0]}" isn't in your answers.` : undefined;
    summaryId = slug("summary", sumIds);
    p.summaries.push({ id: summaryId, text: sumText, approved: false, source: "your answers", ...(warning ? { warning } : {}) });
  }
  else if (sumText) rejected.push({ job: "Summary", text: sumText, why: sv.why });
  // Skills, languages and certifications are the person's own lists, as they typed them: no AI involved.
  const skillIds = [];
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const list = (...xs) => [...new Map(xs.join(",").split(/\s*[,;\n]\s*/).map((x) => x.trim()).filter(Boolean).map((x) => [x.toLowerCase(), cap(x)])).values()];
  for (const [label, items] of [["Skills", list(iv.skills || "", ...arr(iv.jobs).map((j) => j.tools || ""))], ["Languages", list(iv.languages || "")], ["Certifications", list(iv.certifications || "")]]) {
    if (!items.length || (label === "Languages" && items.length === 1 && /^english$/i.test(items[0]))) continue;
    const id = slug(label, skIds);
    skillIds.push(id);
    p.skills.push({ id, label, items: items.join(", "), approved: false });
  }
  for (const e of arr(iv.education)) if (e.school) p.education.push({ school: e.school, detail: e.earned || "", dates: e.year || "", approved: false });
  // A layout that shows all of it, newest job first.
  const bid = slug("created", new Set(p.bases.map((b) => b.id)));
  p.bases.push({ id: bid, description: "Made with the resume creator", approved: false, header: null, summary: summaryId || (p.summaries[0] || {}).id,
    skills: skillIds.length ? skillIds : p.skills.slice(0, 2).map((s) => s.id),
    sections: [{ kind: "experience", items: newExp.filter((e) => e.bullets.length).map((e) => ({ id: e.id, bullets: e.bullets.slice(0, 4).map((b) => b.id) })) }, ...(p.education.length ? [{ kind: "education" }] : [])] });
  if (!p.summaries.length) { p.summaries.push({ id: "summary", text: `${iv.target ? iv.target + " " : ""}candidate.`.trim(), approved: false }); p.bases[p.bases.length - 1].summary = "summary"; }
  return { profile: p, rejected, questions };
}

// ---------- improve: suggestions for the lines the user already has ----------

// Every suggestion: { path, kind: "bullet"|"summary", original, text, why, question }
export async function suggestImprovements(profile, answers = {}, { paths = null, max = 24 } = {}) {
  const p = approvedOnly(profile);
  const items = [];
  for (const k of ["experience", "projects"]) for (const e of arr(p[k])) for (const b of arr(e.bullets)) {
    const path = `${k}.${e.id}.${b.id}`;
    if (!paths || paths.includes(path)) items.push({ path, kind: "bullet", job: `${e.title}${e.org ? ", " + e.org : ""}${/present|now/i.test(e.dates || "") ? " (current job)" : ""}`, text: b.text });
  }
  for (const s of arr(p.summaries)) { const path = `summaries.${s.id}`; if (!paths || paths.includes(path)) items.push({ path, kind: "summary", text: s.text }); }
  if (!items.length) return [];
  const list = items.slice(0, max);
  const sys = `You are an experienced recruiter helping someone improve their own resume lines.
${GUIDE}
For each line: if it already follows the guide, return "keep": true. Otherwise return a better "text" that says the same facts, a short "why" a recruiter would give,
and, when a number or result the person didn't give would make it much stronger, a short friendly "question" to ask them (for example "About how many customers did you serve on a typical day?").
Return JSON only: {"lines": [{"i": 0, "keep": false, "text": "...", "why": "...", "question": "..."}]}`;
  const user = `THEIR OTHER FACTS (for context only; do not move facts between lines)\n${JSON.stringify(Tailor.catalog(p)).slice(0, 12000)}\n\nLINES TO REVIEW\n` +
    list.map((x, i) => `${i}. [${x.kind === "summary" ? "summary" : x.job}] ${x.text}`).join("\n");
  const r = await ask([{ role: "system", content: sys }, { role: "user", content: user }]);
  const known = knownTerms(p, answers);
  const out = [];
  for (const s of arr(r.lines)) {
    const it = list[Number(s.i)];
    if (!it) continue;
    const text = Profile.stripDashes(String(s.text || "")).trim();
    const question = String(s.question || "").trim();
    if (s.keep || !text || text === it.text) { if (question) out.push({ ...it, original: it.text, text: "", why: "", question }); continue; }
    const v = vet(text, [it.text], p, known, it.text);
    if (v.ok) out.push({ path: it.path, kind: it.kind, job: it.job, original: it.text, text, why: String(s.why || "").slice(0, 200), question });
    // The rewrite added something: don't show it. Ask the question, if there is one, so the user can supply it.
    else if (question) out.push({ path: it.path, kind: it.kind, job: it.job, original: it.text, text: "", why: "", question });
  }
  const offered = out.filter((x) => x.text);
  const verdict = await factCheck(offered.map((x) => ({ text: x.text, source: x.original })));
  offered.forEach((x, i) => {
    if (verdict === null || verdict[i]) { x.text = ""; x.why = ""; }
  });
  return out.filter((x) => x.text || x.question);
}

// The user answered a question: rewrite that one line with their answer as a new fact.
export async function rewriteWithAnswer(profile, answers, { path, original, question, answer }) {
  const sys = `You rewrite one resume line using a fact the person just gave.
${GUIDE}
Return JSON only: {"text": "...", "why": "..."}`;
  const r = await ask([{ role: "system", content: sys }, { role: "user", content: `LINE: ${original}\nQUESTION: ${question}\nTHEIR ANSWER: ${answer}` }]);
  const text = Profile.stripDashes(String(r.text || "")).trim();
  const v = vet(text, [original, answer], approvedOnly(profile), knownTerms(approvedOnly(profile), answers), original);
  if (!v.ok) return { path, original, text: "", why: "", error: `The rewrite ${v.why.join("; ")}, so it wasn't used. You can edit the line yourself.` };
  const fc = await factCheck([{ text, source: `${original} ${answer}` }]);
  if (fc === null || fc[0]) return { path, original, text: "", why: "", error: fc === null ? "The rewrite couldn't be double-checked, so it wasn't used. Try again." : `The rewrite added "${fc[0]}", which you didn't say, so it wasn't used.` };
  return { path, original, text, why: String(r.why || "").slice(0, 200), question: "" };
}

// Put an accepted suggestion into the profile. mode "replace" changes the line in place; "add" keeps
// both, as two versions of the same fact (the app never puts both on one resume).
export function applySuggestion(profile, { path, text, mode = "replace" }) {
  const p = JSON.parse(JSON.stringify(profile));
  const parts = String(path).split(".");
  if (parts[0] === "summaries") {
    const s = arr(p.summaries).find((x) => x.id === parts[1]);
    if (!s) throw new Error("That summary is gone.");
    if (mode === "add") p.summaries.push({ id: `${s.id}_v${p.summaries.length + 1}`, text, approved: true });
    else Object.assign(s, { text, approved: true });
    return p;
  }
  const e = arr(p[parts[0]]).find((x) => x.id === parts[1]);
  const b = e && arr(e.bullets).find((x) => x.id === parts[2]);
  if (!b) throw new Error("That line is gone.");
  if (mode === "add") {
    const stem = b.id.split("_")[0];
    let n = 2; while (e.bullets.some((x) => x.id === `${stem}_v${n}`)) n++;
    e.bullets.push({ id: `${stem}_v${n}`, text, approved: true });
  } else Object.assign(b, { text, approved: true });
  return p;
}

// ---------- jog the memory: "Did you also ...?" ----------
// People forget half of what they did. For each job, the official task list for that kind of work
// (O*NET, U.S. Department of Labor) is turned into plain yes/no questions. Only what the person
// says yes to becomes a fact, and only those facts become lines.

const qid = (s) => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return "q" + h.toString(36); };

// job: { title, employer, daily, proud, tools, existing: [lines already on the resume] }
// -> { occupation, items: [{ id, q, task, from: "onet"|"ai" }] }
export async function recallFor(job) {
  const { findOccupations } = await import("./onet.js");
  const cands = findOccupations(job.title, 5);
  const said = [job.daily, job.proud, job.tools, ...arr(job.existing)].filter(Boolean).join("\n");
  const fallback = () => {
    const o = cands[0];
    return { occupation: o ? o.title : "", items: o ? o.tasks.slice(0, 10).map((t) => ({ id: qid(t), q: `Did you: ${t.charAt(0).toLowerCase()}${t.slice(1).replace(/\.$/, "")}?`, task: t, from: "onet" })) : [] };
  };
  const sys = `You help someone remember what they did at a job, so their resume isn't missing things.
You get their job title, employer, what they already said, and official task lists (U.S. Department of Labor O*NET) for the occupations that job title might be.
1. Pick the occupation that best fits this job ("occupation": its index).
2. Turn the most relevant tasks from it (or from the second-best one) into up to 12 short, plain yes/no questions a non-expert understands
   ("Did you count the cash drawer at the end of a shift?"), fitted to this employer, and skip anything they already said. Each cites its task as "t": [occupationIndex, taskIndex].
3. Add up to 3 more questions about things very common in this specific job or kind of workplace that the lists miss (no "t" for those).
Questions only ask; they never assume. Return JSON only: {"occupation": 0, "questions": [{"q": "Did you ...?", "t": [0, 3]}]}`;
  const user = `JOB: ${job.title}${job.employer ? " at " + job.employer : ""}\nWHAT THEY ALREADY SAID:\n${said || "(nothing yet)"}\n\nOCCUPATIONS AND THEIR TASKS:\n` +
    cands.map((o, i) => `${i}. ${o.title}\n${o.tasks.slice(0, 18).map((t, k) => `   ${k}. ${t}`).join("\n")}`).join("\n");
  let r;
  try { r = await ask([{ role: "system", content: sys }, { role: "user", content: user }]); } catch { return fallback(); }
  const occ = cands[Number(r.occupation)] || cands[0];
  const items = [], seen = new Set();
  let ideas = 0;
  for (const x of arr(r.questions)) {
    const q = String(x.q || "").trim();
    if (!q || !/\?$/.test(q) || seen.has(q.toLowerCase())) continue;
    let task = "", from = "ai";
    // The model writes the reference in more than one way: [0, 3], "0,3", "0-3", {"o": 0, "t": 3}.
    const ref = Array.isArray(x.t) ? x.t : typeof x.t === "string" ? x.t.split(/[^0-9]+/).filter(Boolean) : x.t && typeof x.t === "object" ? [x.t.o ?? x.t.occupation, x.t.t ?? x.t.task] : null;
    if (ref && ref.length >= 2) { const o = cands[Number(ref[0])]; task = o ? o.tasks[Number(ref[1])] || "" : ""; }
    // No usable reference: the official task the question repeats most of the words of.
    if (!task) task = closestTask(q, cands) || "";
    if (task) from = "onet";
    if (from === "ai" && ++ideas > 3) continue;
    seen.add(q.toLowerCase());
    items.push({ id: qid(q), q, task, from });
    if (items.length >= 15) break;
  }
  return items.length ? { occupation: occ ? occ.title : "", items } : fallback();
}

const STOPW = new Set(["did", "you", "the", "a", "an", "and", "or", "to", "of", "for", "in", "on", "at", "with", "your", "any", "ever", "when", "they", "them", "their", "it", "as", "by", "like"]);
const content = (s) => String(s).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOPW.has(w)).map((w) => w.replace(/(ing|ed|es|s)$/, ""));
export function closestTask(q, cands) {
  const qw = new Set(content(q));
  let best = null, score = 0;
  for (const o of cands.slice(0, 2)) for (const t of o.tasks) {
    const tw = content(t);
    const hit = tw.filter((w) => qw.has(w)).length / Math.max(3, Math.min(qw.size, tw.length));
    if (hit > score) { score = hit; best = t; }
  }
  return score >= 0.5 ? best : null;
}

// What a "yes" says, as the source a line may be written from.
const yesSource = (c) => [c.q.replace(/^did you\s*/i, "").replace(/\?$/, ""), c.task, c.detail].filter(Boolean).join(". ");

// Lines for one job from the things the person said yes to. Returns [{ text, source, warning? }] and what was left out.
export async function linesFromConfirmed(job, confirmed, profile, answers = {}) {
  if (!arr(confirmed).length) return { lines: [], rejected: [] };
  const sys = `You write resume lines from things a person confirmed they did at a job.
${GUIDE}
Write one line per confirmed item (you may join two closely related items into one line). Use their detail (how many, how often) when they gave one, and keep a guess a guess:
"maybe 20" or "about 20" becomes "about 20", never "averaging 20" or "20". Keep "help" or "assist" when the question said help. Never add other numbers, places or results.
Return JSON only: {"lines": [{"text": "...", "from": [0]}]}`;
  const list = (cs) => cs.map((c, i) => `${i}. ${c.q}${c.detail ? `  Their detail: ${c.detail}` : ""}`).join("\n");
  const p = profile || {};
  const known = [...knownTerms(p, answers), ...specificTerms(job.title), ...specificTerms(job.employer)];
  const write = async (cs, note = "") => {
    const r = await ask([{ role: "system", content: sys + note }, { role: "user", content: `JOB: ${job.title}${job.employer ? " at " + job.employer : ""}\nTHEY CONFIRMED:\n${list(cs)}` }]);
    return arr(r.lines).map((l) => {
      const text = Profile.stripDashes(String(l.text || "")).trim();
      const used = arr(l.from).map((i) => cs[Number(i)]).filter(Boolean);
      const from = used.length ? used : cs;
      const v = vet(text, [...from.map(yesSource), job.title, job.employer || ""], p, known, from.map((c) => `${c.q} ${c.detail || ""}`).join(" "));
      return { text, from, v };
    });
  };
  const out = [], rejected = [];
  const keep = (x) => out.some((y) => y.text.toLowerCase() === x.text.toLowerCase()) || out.push({ text: x.text, source: "You said yes to: " + x.from.map((c) => c.q).join(" / ") + (x.from.some((c) => c.detail) ? ` (${x.from.map((c) => c.detail).filter(Boolean).join("; ")})` : ""), check: x.from.map(yesSource).join(". ") });
  const first = await write(confirmed);
  first.filter((x) => x.v.ok).forEach(keep);
  // One more try for the lines that broke a rule, saying what was wrong with each.
  const bad = first.filter((x) => !x.v.ok && x.text);
  if (bad.length) {
    const cs = [...new Set(bad.flatMap((x) => x.from))];
    const note = `\nYour last lines for these items were rejected: ${bad.map((x) => `"${x.text}" (${x.v.why.join("; ")})`).join(" ")}. Write them again without those problems.`;
    try {
      for (const x of await write(cs, note)) (x.v.ok ? keep(x) : rejected.push({ text: x.text, why: x.v.why }));
    } catch { bad.forEach((x) => rejected.push({ text: x.text, why: x.v.why })); }
  }
  const verdict = await factCheck(out.map((x) => ({ text: x.text, source: x.check })));
  out.forEach((x, i) => {
    if (verdict === null) x.warning = "This line wasn't double-checked. Read it carefully.";
    else if (verdict[i]) x.warning = `Check this: "${verdict[i]}" goes beyond what you said yes to.`;
    delete x.check;
  });
  return { lines: out, rejected };
}

// Resume page: add lines to a job already on the resume, from what the person said yes to.
export async function addRecalled(profile, entryId, confirmed, answers = {}) {
  const p = JSON.parse(JSON.stringify(profile));
  const e = arr(p.experience).find((x) => x.id === entryId) || arr(p.projects).find((x) => x.id === entryId);
  if (!e) throw new Error("That job is gone.");
  const { lines, rejected } = await linesFromConfirmed({ title: e.title, employer: e.org }, confirmed, approvedOnly(p), answers);
  const bt = new Set(arr(e.bullets).map((b) => b.id));
  for (const l of lines) e.bullets.push({ id: slug(l.text.split(/\s+/).slice(0, 2).join(" "), bt), text: l.text, approved: false, source: l.source, ...(l.warning ? { warning: l.warning } : {}) });
  return { profile: p, added: lines.length, rejected };
}
