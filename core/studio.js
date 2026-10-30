// Resume studio: make a resume from the user's own answers to a few questions,
// improve the one they have, and check it against what recruiters look for.
//
// Honesty comes first, as everywhere in the app:
// - the AI only rewords what the user said; it never adds a number, tool, employer
//   or result the user didn't give (checked below, not just asked for in the prompt);
// - where a number or result would make a line stronger, it asks the user instead of guessing;
// - nothing it writes is used until the user approves it.
import { Profile, STEADY, Tailor, aiSettings, approvedOnly } from "./engine.js";
import { aiRequest, isLocal } from "./llm.js";
import { cacheKey, cached, remember } from "./aicache.js";
import { houseStyle } from "./style.js";
import { fmtDate } from "./dates.js";

const arr = (x) => (Array.isArray(x) ? x : []);
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);

// ---------- the recruiter checklist (no AI: plain rules, same answer every time) ----------

const WEAK_START = /^(responsible for|duties (included|include)|helped( to)?|worked (on|with|as)|assisted( with)?|tasked with|in charge of|involved in|participated in|was |were |did |handled various|various)\b/i;
const PRONOUN = /\b(I|me|my|mine|myself|we|our|ourselves)\b/;
const HAS_NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|dozens?|hundreds?|thousands?)\b/i;
const CLICHE = /\b(hard[- ]working|team player|detail[- ]oriented|go[- ]getter|self[- ]starter|results[- ]driven|think outside the box|synergy|dynamic|passionate|rock ?star|ninja|guru|best of breed|proven track record)\b/i;
// The phrasing AI tools put on every resume: recruiters spot it, and it makes every applicant sound the same.
// A word the person used themselves is theirs to keep; anything else is said plainly instead.
export const AI_TELLS = /\b(spearhead(ed|ing|s)?|cross[- ]functional (initiatives?|collaboration|teams?)|operational excellence|drive (operational|business) (excellence|results|growth)|drove (operational|business) (excellence|results|growth)|results[- ]driven|proven track record|track record of success|leverag(ed|ing|e)|utiliz(ed|ing|e)|robust|seamless(ly)?|cutting[- ]edge|state[- ]of[- ]the[- ]art|foster(ed|ing)|synerg(y|ies|ize)|dynamic (professional|environment|team)|passionate about|adept at|fast[- ]paced environment|best[- ]in[- ]class|game[- ]chang(er|ing)|value[- ]add(ed)?|holistic|end[- ]to[- ]end solutions?|thought leader(ship)?|go[- ]to person|wide (range|variety) of|tapestry|delve|meticulous(ly)?|showcas(ed|ing)|pivotal role|instrumental in)\b/i;
export const aiTells = (text, sources = []) => { const src = sources.join(" ").toLowerCase(); return [...new Set((String(text).match(new RegExp(AI_TELLS.source, "gi")) || []).map((x) => x.toLowerCase()))].filter((x) => !src.includes(x)); };
// "Customer support, customer service and customer-focused communication": one word three times is stuffing.
const STOP = /^(with|from|that|this|their|they|them|into|onto|over|each|every|about|other|and|the|for|per|day|week|month|year|years|shift|shifts|team|teams)$/;
export function stuffedWord(text) {
  const n = new Map();
  // "step-by-step" and "mis-picks" are one word each.
  for (const w of String(text).toLowerCase().split(/[^a-z0-9+#-]+/).map((x) => x.replace(/^-+|-+$/g, "")).filter((x) => x.length > 3 && !STOP.test(x))) {
    const k = w.replace(/(ers|ing|ed|er|es|s)$/, "");
    n.set(k, (n.get(k) || 0) + 1);
    if (n.get(k) >= 3) return w;
  }
  return "";
}
// A result ("Cut", "Reduced", a percentage) reads strongest with how it was done (Google's X-Y-Z).
// Only a line that opens with the result: one that opens with what was done ("Wrote a refund guide...") says how already.
const RESULT = /^(cut|reduced|lowered|decreased|increased|raised|grew|boosted|improved|saved|doubled|tripled|halved|dropped|shortened|sped up|eliminated|recovered|won)\b/i;
// "by setting up CI" says how; "by 40%" only says how much.
const METHOD = /\b(using|through|via|thanks to)\b|\bby (?!\d|about\b|around\b|roughly\b|nearly\b|over\b|almost\b|more\b|up to\b|half\b|a (third|quarter|half)\b)[a-z]/i;
export const AI_TOOL = /\b(chatgpt|gpt-?\d\w*|claude( code)?|copilot|gemini|midjourney|cursor|perplexity|llms?|generative ai|ai tools?|an ai)\b/i;

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
    else if (fit.slack > 200) add("length", "tip", "There's room for more", `About ${Math.round(fit.slack / 12)} empty lines at the bottom. Use "Fill out my page" below: a few questions about other work, training and records that people usually leave out.`);
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
  const twice = bullets.filter((b) => repeatedPhrase(b.text) || stuffedWord(b.text));
  if (twice.length) add("twice", "fix", "Say it once", "These lines repeat the same words. Recruiters skim, and screening software marks a word repeated over and over as keyword stuffing; each line should say one thing once.", twice.map((b) => ({ ...b, why: repeatedPhrase(b.text) ? `"${repeatedPhrase(b.text)}" twice` : `"${stuffedWord(b.text)}" three times or more` })));
  const casual = bullets.filter((b) => CASUAL.test(b.text));
  if (casual.length) add("casual", "fix", "Make these sound like a resume", "These read the way people talk (\"take calls\", \"like cars in ditches\", \"guys\"). Recruiters expect the trade's professional wording for the same facts.", casual.map((b) => ({ ...b, why: casualBits(b.text)[0] })));
  const cliche = [...bullets, ...arr(p.summaries).map((s) => ({ path: `summaries.${s.id}`, text: s.text }))].filter((b) => CLICHE.test(b.text));
  if (cliche.length) add("cliche", "fix", "Swap buzzwords for facts", "\"Hard-working team player\" is on every resume. Show it with something you did instead.", cliche.map((b) => ({ ...b, why: (b.text.match(CLICHE) || [""])[0] })));
  const robotic = [...bullets, ...arr(p.summaries).map((s) => ({ path: `summaries.${s.id}`, text: s.text }))].filter((b) => aiTells(b.text).length);
  if (robotic.length) add("ai-words", "fix", "Sounds like AI wrote it", "Words like \"spearheaded\", \"leveraged\" or \"cross-functional initiatives\" are what AI tools put on every resume, and recruiters notice. Say the same thing the way you'd explain it in an interview.", robotic.map((b) => ({ ...b, why: aiTells(b.text)[0] })));
  const how = bullets.filter((b) => RESULT.test(b.text.trim()) && HAS_NUMBER.test(b.text) && !METHOD.test(b.text));
  if (how.length) add("how", "tip", "Say how you did it", "A result reads strongest as what changed, by how much, and how you did it (Google's X-Y-Z: accomplished X, as measured by Y, by doing Z). These say what changed but not how. Add the how, in your own words.", how.map((b) => ({ ...b, why: "no \"by ...\"" })));
  const dropped = bullets.filter((b) => AI_TOOL.test(b.text) && !HAS_NUMBER.test(b.text));
  if (dropped.length) add("ai-proof", "tip", "Show what the AI did", "Hiring managers want proof, not a tool's name: the problem, the tool and the result (\"Cut weekly reporting from 2 hours to 30 minutes by using ...\"). Add the result if you know it.", dropped.map((b) => ({ ...b, why: "names an AI tool without a result" })));
  const unlinked = arr(p.projects).filter((e) => e.title && !e.link && !e.url);
  if (unlinked.length) add("links", "tip", "Link your projects", "A link (a GitHub page, a public document) lets a recruiter see the work for themselves. Add one to each project that has one.", unlinked.map((e) => ({ path: `projects.${e.id}`, text: e.title, why: "no link" })));
  const banned = bullets.filter((b) => Profile.textIssues(b.text, p).some((x) => /^uses/.test(x)));
  if (banned.length) add("banned", "fix", "Words on your avoid list", "These lines use words from your list of words to avoid.", banned.map((b) => ({ ...b, why: Profile.textIssues(b.text, p).join(", ") })));
  if (bullets.length >= 3) {
    const withNum = bullets.filter((b) => HAS_NUMBER.test(b.text)).length;
    if (withNum / bullets.length < 0.3) add("numbers", "tip", "Show size and results where you can", `Only ${withNum} of ${bullets.length} lines have a number. "Served about 200 customers a day" says more than "Served customers". Only use numbers you know are true; the improver will ask you for them.`,
      bullets.filter((b) => !HAS_NUMBER.test(b.text)).slice(0, 8).map((b) => ({ ...b, why: "no number" })));
    else add("numbers", "good", "Lines show size and results", `${withNum} of ${bullets.length} lines have a number.`);
  }
  // Lines per job as the resume shows them: 3 to 5 for the latest job, 2 or 3 for the others. Extra approved
  // lines are fine: they stay available for tailoring to a posting.
  const shown = new Map();
  const lay = arr(p.bases)[0];
  for (const sec of arr(lay && lay.sections)) for (const it of arr(sec.items)) shown.set(it.id, arr(it.bullets).length);
  arr(p.experience).forEach((e, i) => {
    const n = shown.has(e.id) ? shown.get(e.id) : Math.min(arr(e.bullets).length, i === 0 ? 5 : 3);
    if (n === 1) add(`few-${e.id}`, "tip", `Add a line to ${e.title}`, "Two or three lines per job looks complete.");
    if (n > (i === 0 ? 5 : 3)) add(`many-${e.id}`, "tip", `Trim ${e.title} on the page`, `The layout shows ${n} lines; recruiters read ${i === 0 ? "3 to 5 for the latest job" : "2 or 3 for older jobs"}.`);
  });
  const dates = arr(p.experience).map((e) => e.dates).filter(Boolean);
  const styles = new Set(dates.map((d) => (/\b[A-Z][a-z]{2,8}\.? \d{4}/.test(d) ? "month" : /\d{1,2}\/\d{4}/.test(d) ? "slash" : "year")));
  // Most often it's a job with only the year among jobs with the month: say which ones need the month.
  const yearOnly = arr(p.experience).filter((e) => e.dates && !/[A-Za-z]{3}\.? \d{4}|\d{1,2}\/\d{4}/.test(e.dates.replace(/present/i, "")));
  if (styles.size > 1 && styles.has("month") && yearOnly.length) add("dates", "fix", "Add the month to these dates", "Your other jobs show the month and year (\"Jun 2023 – Present\"). Add the month to these so every date reads the same way; if you're not sure of it, the year alone is fine.", yearOnly.map((e) => ({ path: `experience.${e.id}`, text: e.dates, why: e.title })));
  else if (styles.size > 1) add("dates", "fix", "Write dates the same way", "Pick one style, such as \"Jun 2023 – Present\", for every job.", arr(p.experience).map((e) => ({ path: `experience.${e.id}`, text: e.dates, why: e.title })));
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
  // "both teams" is two teams, and "a couple" or "a pair" is two as well.
  if (/\b(both|a pair of|a couple of)\b/i.test(src)) srcNums.add("2");
  const ok = new Set(allowed.map((x) => String(x).toLowerCase()));
  const problems = [];
  for (const n of numbersIn(suggestion)) if (!srcNums.has(n)) problems.push(`the number ${n}`);
  // "ChatGPT-drafted", "Zendesk-based": a compound of words they gave adds nothing new.
  const given = (w) => srcLower.includes(w) || ok.has(w);
  // ... and so is a name of theirs with a plain ending: "ChatGPT-assisted", "Excel-based".
  const ENDING = /^(assisted|based|made|built|drafted|written|generated|powered|enabled|supported|tracked)$/;
  for (const w of specificTerms(suggestion)) if (!given(w) && !(w.includes("-") && w.split("-").every((x, k) => x && (given(x) || lineWords(src).has(x.replace(/(ing|ed|es|s|e)$/, "")) || (k > 0 && ENDING.test(x)))))) problems.push(`"${w}"`);
  return problems;
}

// Praise the person didn't claim: allowed only when their own words use it.
const INFLATE = /\b(proven|expert|expertise|seasoned|highly[- ]skilled|skilled|adept|proficient|precision|meticulous|expertly|high[- ]performance|high[- ]performing|exceptional|outstanding|extensive|world[- ]class|top[- ]performing|award[- ]winning|experienced|mastery|master of|spearhead(ed|ing)?|leverag(ed|ing|e)|orchestrat(ed|ing|e)|transformed|revolutioni[sz]ed|synerg\w*|hard[- ]working|team player|detail[- ]oriented|results[- ]driven|passionate|motivated|calm|careful|steady|dedicated|diligent|reliable|dependable)\b/gi;
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

// A number the person gave as a guess ("about 8 to 12 calls") must stay a guess wherever it is used.
export function droppedApprox(sources, text) {
  const src = String(sources.join(" ")).toLowerCase(), t = String(text || "").toLowerCase();
  const APPROX_WORDS = "about|approximately|roughly|around|nearly|almost|maybe|up to|over|more than|~";
  const out = [];
  for (const m of src.matchAll(new RegExp(`\\b(${APPROX_WORDS})\\s*(\\$?\\d[\\d,.]*)`, "g"))) {
    const num = m[2].replace(/^\$/, "");
    const at = t.search(new RegExp(`(^|[^\\d.,])\\$?${num.replace(/[.,]/g, "\\$&")}(?![\\d])`));
    if (at < 0) continue;
    const before = t.slice(Math.max(0, at - 20), at + 1);
    if (!new RegExp(`\\b(${APPROX_WORDS})\\s*\\$?$`).test(before.trim()) && !new RegExp(`(${APPROX_WORDS})\\s*\\$?\\d*$`).test(before)) out.push(`${m[1]} ${m[2]}`);
  }
  return [...new Set(out)];
}

// Words a rewording may bring in without adding a fact: common resume verbs, connectors, and plain
// synonyms ("car" -> "vehicle", "guys" -> "hires"). Anything else new is a claim the person didn't make.
const REWORD_OK = new Set(("handle handled handles manage managed operate operated operates coordinate coordinated secure secured secures produce produced produces fabricate fabricated " +
  "maintain maintained maintains troubleshoot troubleshot diagnose diagnosed resolve resolved respond responded responds complete completed completes deliver delivered support supported " +
  "assist assisted train trained trains inspect inspected inspects install installed installs perform performed performs provide provided ensure ensured prepare prepared process processed " +
  "build built follow followed use used using work worked serve served answer answered drive drove transport transported load loaded unload unloaded keep kept record recorded log logged " +
  "communicate communicated update updated document documented review reviewed check checked verify verified repair repaired fix fixed set placed place direct directed control controlled " +
  "with using during across while through within under into onto from each every daily routine regular regularly short notice quickly safely accurately on-site onsite site sites " +
  "vehicle vehicles car cars customer customers client clients hire hires employee employees staff team crew scene scenes shift shifts call calls job jobs work tasks task equipment tool tools " +
  "specification specifications spec specs order orders request requests issue issues problem problems service services standard standards quality new including such " +
  "pre trip post inspection inspections run runs ran conduct conducted carry carried " +
  "law enforcement officer officers incident incidents roadside assistance recovery recoveries off-road road field signage dispatched dispatch fleet commercial " +
  "operation operations procedure procedures protocol protocols documentation paperwork accurate accurately timely promptly efficiently professionally " +
  "fabricate fabricated fabrication production produced specified per according requirement requirements").split(/\s+/));
export function newWords(text, sources) {
  const have = new Set(lineWords(sources.join(" ")));
  return [...lineWords(text)].filter((w) => !have.has(w) && !REWORD_OK.has(w) && ![...REWORD_OK].some((x) => x.replace(/(ing|ed|es|s|e)$/, "") === w));
}
// New words that make a claim (a system, a result, being in charge) are never allowed in a rewording.
const CLAIM_WORDS = /^(specializ|specialist|system|software|ticket|crm|sla|database|network|server|compliance|complian|regulat|osha|dot|mutcd|certif|licen|led|lead|supervis|manag|direct|oversaw|improv|reduc|increas|sav|cut|boost|award|expert|senior|budget|revenue|profit|cost|percent|zero|100)/;
// Checked against every new word, even ones REWORD_OK allows elsewhere ("managed" is a fine verb only when they said so).
export const claimWords = (text, sources) => { const have = new Set(lineWords(sources.join(" "))); return [...lineWords(text)].filter((w) => !have.has(w) && CLAIM_WORDS.test(w)); };

// The way people talk, not the way a resume reads: flagged by the recruiter check and rewritten by the polish step.
export const CASUAL = /\b(guys|stuff|things|a lot of|lots of|kinda|pretty much|got to|gotta|went out|around fast|real quick|on it\b|hard ones?|like (cars|trucks|a|the)\b|that (dispatch|the boss|they) (sends?|gave|gives)|take( the| dispatch)? calls|deal with|helped out|did (the|a|some)\b|a bunch|tons of|basically|super\b|okay|ok\b)/i;
export const casualBits = (t) => (String(t).match(new RegExp(CASUAL.source, "gi")) || []).map((x) => x.trim());

// Accept a suggested line only if it adds nothing and breaks no rule; otherwise say why.
// original: the line being reworded, whose limiting words must survive.
// "off-road vehicle recoveries, including complex off-road vehicle recoveries": the same two-word phrase twice in a line.
export function repeatedPhrase(text) {
  // Only the words that carry meaning: "cones and flares ... cones and flares" is a repeat too.
  const w = String(text).toLowerCase().split(/[^a-z0-9'-]+/).filter((x) => x.length > 3 && !/^(with|from|that|this|their|they|them|into|onto|over|each|every|about|other)$/.test(x));
  const seen = new Map();
  for (let i = 0; i + 1 < w.length; i++) {
    const k = `${w[i]} ${w[i + 1]}`;
    if (seen.has(k) && i - seen.get(k) > 1) return k;
    if (!seen.has(k)) seen.set(k, i);
  }
  return "";
}

const DOWN = /\b(dropp\w*|drop|down|fell|fewer|less|lower(ed|ing)?|decreas\w*|reduc\w*|cut|cuts|cutting|shorten\w*|shorter|faster|halv\w*|from [^.;]*\d[^.;]* to [^.;]*\d)\b/i;
const UP = /\b(up|rose|grew|growing|more|higher|increas\w*|doubl\w*|tripl\w*|gain\w*|rais\w*|boost\w*)\b/i;
export function changeVerbs(sources) {
  const out = [];
  for (const s of sources.map(String)) for (const part of s.split(/[.;\n]+/)) {
    if (!HAS_NUMBER.test(part)) continue;
    if (DOWN.test(part)) out.push("cut", "cuts", "cutting", "reduced", "reduce", "reduces", "reducing", "lowered", "lowering", "decreased", "decreasing", "shortened", "shortening");
    if (UP.test(part)) out.push("increased", "increase", "increases", "increasing", "raised", "raising", "grew", "growing", "boosted", "boosting");
  }
  return [...new Set(out)];
}

// A line that states a change with its size ("duplicate tickets dropped 50%"), and one already written as
// result, measure, method ("Cut duplicate tickets 50% by writing a refund guide").
export const resultLine = (t) => changeVerbs([String(t)]).length > 0;
export const xyzLine = (t) => RESULT.test(String(t).trim()) && /\bby [a-z]+ing\b/i.test(String(t));

// Whether some line already says this part of their answer: most of its meaningful words are in one line.
const stemW = (w) => w.replace(/(ing|ed|es|s|e)$/, "");
const meaning = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !/^(the|and|with|for|our|my|their|them|they|was|were|got|every|about|from|into|that|this|then|also|before|after|each|one|two|all|some|any|more)$/.test(w)).map(stemW));
export function covers(lines, part) {
  const want = [...meaning(part)];
  if (!want.length) return true;
  return lines.some((l) => { const have = meaning(l); return want.filter((w) => have.has(w)).length / want.length >= 0.5; });
}

export function vet(text, sources, profile, allowed = [], original = null) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, why: ["empty"] };
  const src = sources.join(" ").toLowerCase();
  const why = [...addedFacts(t, sources, allowed).map((x) => `adds ${x}, which you didn't say`), ...Profile.textIssues(t, profile)];
  for (const m of t.matchAll(INFLATE)) if (!src.includes(m[0].toLowerCase())) why.push(`calls you "${m[0]}", which you didn't say`);
  if (original) for (const h of droppedHedges(original, t)) why.push(`drops "${h}", which makes the claim bigger`);
  for (const h of droppedApprox(sources, t)) if (!why.some((w) => w.includes(`"${h.split(" ")[0]}"`))) why.push(`says the number without "${h.split(" ").slice(0, -1).join(" ")}", which makes a guess sound exact`);
  if (PRONOUN.test(t)) why.push("uses I/my");
  const tells = aiTells(t, [...sources, ...allowed]).filter((x) => !why.some((w) => w.toLowerCase().includes(x)));
  if (tells.length) why.push(`sounds AI-written ("${tells[0]}"); say it plainly`);
  // Said three times by them too ("step-by-step", "every step"), it's their wording, not stuffing.
  const stuffed = stuffedWord(t);
  const theirs = (w) => (sources.join(" ").toLowerCase().match(new RegExp(`\\b${w.replace(/(ers|ing|ed|er|es|s)$/, "")}`, "g")) || []).length >= 3;
  if (stuffed && !theirs(stuffed)) why.push(`says "${stuffed}" three times; say it once`);
  // Being in charge, a system, a result: a word like that has to come from them. A change they stated with
  // its size ("dropped by 50%", "from 2 hours to 30 minutes") may take the plain verb for it ("Cut", "Increased").
  const claims = claimWords(t, [...sources, ...allowed, ...changeVerbs(sources)]);
  if (claims.length && !why.some((w) => /claim/.test(w))) why.push(`adds a claim you didn't make: ${claims.slice(0, 3).join(", ")}`);
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

export const GUIDE = `How recruiters want resume lines written:
- Start with a strong action verb (Served, Trained, Built, Organized, Resolved, Cut, Opened, Stocked, Led). Past tense for anything already done or finished, even at a current job; present tense only for ongoing daily duties at a current job. Never change the tense of a line that already uses the past tense for something finished.
- Never describe the person with praise they didn't use themselves (proven, expert, experienced, skilled, seasoned, high-performing, exceptional).
- "Manage", "oversee", "lead", "supervise" and "improve" are claims of being in charge or of a result: use them only when they said so. Say the task itself instead: "Manage customer inquiries" -> "Answer customer inquiries"; "Managed closing" -> "Closed the store"; "Managed returns" -> "Processed returns". Keep every word that limits a claim (about, helped, part-time, assisted, leaning, shared).
- Professional, specific wording: the terms people in that trade use on a resume, never the casual way someone talks about their day. "Take calls and drive to breakdowns" -> "Respond to dispatched breakdown and accident calls"; "cars in ditches" -> "off-road vehicle recoveries"; "talk with police" -> "coordinate with law enforcement on scene"; "ran the vinyl cutter" -> "operated the vinyl cutter"; "went out with the crew" -> "installed ... as part of a field crew"; "fast" -> "on short notice"; "guys" -> "hires"; "like X" -> "including X". The same facts, better words; never a bigger claim.
- Avoid empty corporate phrases ("service delivery", "stakeholders", "various tasks", "synergy").
- Write it the way they would explain it in an interview: plain and specific. Never the phrasing AI tools put on every resume: spearheaded, cross-functional initiatives, operational excellence, results-driven, proven track record, leveraged, utilized, robust, seamless, cutting-edge, fostered, dynamic, passionate about, adept at, fast-paced environment, instrumental in.
- When they gave a result, how much it changed and how they did it, write it as result, measure, method (Google's X-Y-Z: "Accomplished X, as measured by Y, by doing Z"): "Cut failed deploys from weekly to rare by setting up CI with unit and integration tests". Use only the parts they gave; never make up a result, a measure or a method to complete the pattern.
- An AI tool they used is a tool like any other: name it with what it did and the result they gave, never just "Used ChatGPT". When they said how they checked its work ("then checked every step with my lead"), keep that in the line: it's what makes it believable.
- A skill or keyword goes inside the line that shows it being used, once; never a list of keywords in a line, never the same word three times.
- Say what was done and, when the person gave one, the size or result (how many, how much, how often, what improved). Every number they gave goes into a line, exactly as given (with its "about").
- One line each: about 8 to 20 words, at most 150 characters. No "I", "my" or "we". No buzzwords (hard-working, team player, detail-oriented, passionate, results-driven).
- Words a hiring manager in that field uses. Keep the person's own specific terms (machines, tools, product names).
- No em dashes.
- The summary starts with what they do or did ("Tow truck driver with a Class B CDL..."), never with "Possesses", "Skilled in" or "Experienced".
THE HONESTY RULE (most important): use only facts the person gave. Never add a number, percentage, amount, tool, employer, certification, title or result they did not state. If a line would be stronger with a number or result you don't have, do NOT guess: write the honest line without it and ask a short question to get it.`;

const settings = () => aiSettings();
// The model sometimes answers with broken JSON; ask again (up to three times) before giving up.
// What the resume writer is doing right now, for the "Write my resume" screen to show while it waits.
export const progress = { step: "", n: 0, of: 0, at: 0 };
export function setProgress(n, of, step) { Object.assign(progress, { n, of, step, at: Date.now() }); }

// A cloud call that hasn't answered in a while gets a second, identical one; whichever answers first wins,
// and the other is cancelled then (each runs with its own abort signal, which aiFetch honours).
export function hedged(call, after) {
  const ctrls = [];
  const start = () => { const c = new AbortController(); ctrls.push(c); return [aiRequest.run({ signal: c.signal }, call), c]; };
  if (!after) return start()[0];
  return new Promise((resolve, reject) => {
    let done = false, failed = 0, timer;
    const settle = ([p, mine]) => p.then((v) => { if (!done) { done = true; clearTimeout(timer); for (const c of ctrls) if (c !== mine) c.abort(); resolve(v); } },
      (e) => { if (++failed === (timer === null ? 2 : 1) && !done) { done = true; clearTimeout(timer); for (const c of ctrls) if (c !== mine) c.abort(); reject(e); } });
    settle(start());
    timer = setTimeout(() => { timer = null; if (!done) settle(start()); }, after);
  });
}

// How many paid AI attempts one request from the window may make (each API route starts a fresh budget):
// a loop that would keep calling the model stops with a plain message instead.
export const ASK_BUDGET = 120;
let askLeft = ASK_BUDGET;
export function resetAskBudget(n = ASK_BUDGET) { askLeft = n; }

export async function ask(messages) {
  // The same question gets the same answer: providers vary their wording even at temperature 0, so the
  // answer is remembered (core/aicache.js) and the same facts make the same resume, run after run.
  const key = cacheKey(settings(), messages, STEADY);
  const hit = cached(key);
  if (hit !== undefined) return hit;
  let last;
  for (let i = 0; i < 3; i++) {
    if (askLeft <= 0) throw new Error("This used more AI calls than one request may make, so it stopped. Try again with less at once.");
    askLeft--;
    const t0 = Date.now();
    try {
      // The most likely answer every time (temperature 0, a fixed seed): the same facts give the same resume.
      const r = await hedged(() => Tailor.chat(settings(), messages, STEADY), isLocal(settings()) ? 0 : 35000);
      if (process.env.JA_TIME) console.error(`[ai ${((Date.now() - t0) / 1000).toFixed(1)}s] ${String(messages[0].content).split("\n")[0].slice(0, 70)}`);
      // A plain object either way: a fresh answer comes from the vendored code's sandbox, a remembered one from a file.
      const plain = JSON.parse(JSON.stringify(r));
      remember(key, plain);
      return plain;
    } catch (e) {
      last = e;
      if (process.env.JA_TIME) console.error(`[ai fail ${((Date.now() - t0) / 1000).toFixed(1)}s] ${e.message.slice(0, 80)}`);
      // a refusal (bad key, no credit, no such model) or a rate limit isn't helped by asking again at once
      if (/Model API 4(0[0-3]|04|29)/.test(e.message)) break;
      if (i < 2) await new Promise((r) => setTimeout(r, 4000 * (i + 1)));
    }
  }
  throw last;
}

// A line the fact check flagged ("on register and return procedures" when they only said they trained
// cashiers): one more try without that part, through both checks again; it replaces the line only if both pass.
// items: [{ b, text, source, flag, check(t) -> { ok } }] -> how many were fixed (their warnings are cleared).
export async function refixFlagged(items) {
  if (!items.length) return 0;
  let r = {};
  try {
    r = await ask([{ role: "system", content: `Each resume line below has a part the person never said. Rewrite the line without that part: keep everything else, every number with its "about", and the professional wording. Never add anything new.\n${GUIDE}\nReturn JSON only: {"lines": [{"n": 0, "text": "..."}]}` },
      { role: "user", content: items.map((x, n) => `${n}. LINE: ${x.text}\n   NOT IN THEIR WORDS: ${x.flag}\n   THEIR WORDS: ${x.source}`).join("\n") }]);
  } catch { return 0; }
  const cands = [];
  for (const l of arr(r.lines)) {
    const x = items[Number(l.n)];
    if (!x || cands.some((c) => c.x === x)) continue;
    const t = houseStyle(Profile.stripDashes(String(l.text || "")).trim()).replace(/\.$/, "");
    if (t && t !== x.text && x.check(t).ok) cands.push({ x, t });
  }
  if (!cands.length) return 0;
  const verdict = await factCheck(cands.map((c) => ({ text: c.t, source: c.x.source })));
  let fixed = 0;
  cands.forEach((c, k) => { if (verdict && !verdict[k]) { c.x.b.text = c.t; delete c.x.b.warning; fixed++; } });
  return fixed;
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

// "Tow Truck Driver with a Class B CDL. Before that, Sign Shop Worker at City of Sacramento."
export function plainSummary(iv) {
  const jobs = arr(iv.jobs).filter((j) => j.title);
  const cur = jobs.find((j) => j.current) || jobs[0];
  const certs = String(iv.certifications || "").split(/\s*[,;\n]\s*/).filter(Boolean).slice(0, 3);
  const list = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(", ") + " and " + xs[xs.length - 1] : xs[0]);
  const parts = [];
  if (cur) parts.push(`${cur.title}${cur.employer ? " at " + cur.employer : ""}${certs.length ? `, with ${list(certs)}` : ""}.`);
  else if (certs.length) parts.push(`Holds ${list(certs)}.`);
  const before = jobs.filter((j) => j !== cur).slice(0, 2);
  if (before.length) parts.push(`Before that, ${list(before.map((j) => `${j.title}${j.employer ? " at " + j.employer : ""}`))}.`);
  const school = arr(iv.education).find((e) => e.school);
  if (!parts.length && school) parts.push(`${school.earned || "Studied"} at ${school.school}.`);
  return parts.join(" ") || "Summary to write.";
}

// interview: { target, summary, jobs: [{ title, employer, location, start, end, current, daily, proud, numbers, tools }],
//   education: [{ school, earned, year }], certifications, skills, languages, volunteer }
export function interviewText(iv) {
  const lines = [];
  if (iv.target) lines.push(`JOB THEY WANT NEXT: ${iv.target}`);
  if (iv.summary) lines.push(`ABOUT THEM, IN THEIR WORDS: ${iv.summary}`);
  arr(iv.jobs).forEach((j, i) => {
    lines.push(`\nJOB ${i + 1}: ${j.title || "?"} at ${j.employer || "?"}${j.location ? ", " + j.location : ""} (${j.start || "?"} to ${j.current ? "now" : j.end || "?"})${j.current ? " CURRENT JOB: write its ongoing duties in the present tense" : " PAST JOB: past tense"}`);
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
Never ask a question about something they already answered (their dates, how long they worked there, or a number they gave).
Write 2 to 4 lines per job from what they said (not from the "They also confirmed" items: those get their own lines separately), and a 2 to 3 sentence summary aimed at the job they want next (only from their facts).
Every result or accomplishment they describe under "What went well" gets a line of its own (up to 5 lines for that job if needed): those are the lines recruiters read first, so never drop or merge one away.
For every line, quote the part of their answers it comes from in "source".
Return JSON only:
{"summary": "...", "jobs": [{"index": 0, "bullets": [{"text": "...", "source": "their words this line is based on"}], "questions": ["a short question that would let a line show a number or result"]}],
 }`;
  const base = profile0 ? JSON.parse(JSON.stringify(profile0)) : { schema: Profile.SCHEMA, name: answers.firstName ? `${answers.firstName} ${answers.lastName || ""}`.trim() : "Your Name", contact: {}, rules: Profile.EXAMPLE.rules };
  for (const k of ["summaries", "experience", "projects", "skills", "education", "headers", "bases"]) base[k] = arr(base[k]);
  const p = base;
  setProgress(1, 4, "Writing lines from your answers");
  // The lines from their "Help me remember" yes answers don't depend on the rest: written at the same time.
  const fromYes = arr(iv.jobs).map((j) => (arr(j.confirmed).length ? linesFromConfirmed(j, j.confirmed, p, answers).catch(() => ({ lines: [], rejected: [] })) : null));
  const r = await ask([{ role: "system", content: sys }, { role: "user", content: facts }]);
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
    const allowedHere = [...known, ...specificTerms(j.title), ...specificTerms(j.employer)];
    const failed = [];
    for (const b of arr(out.bullets)) {
      const text = houseStyle(Profile.stripDashes(String(b.text || "")).trim()).replace(/\.$/, "");
      if (bullets.some((x) => sameLine(x.text, text))) continue;
      const v = vet(text, sources, p, allowedHere);
      if (v.ok) bullets.push({ id: slug(text.split(/\s+/).slice(0, 2).join(" "), bt), text, approved: false, source: String(b.source || "").slice(0, 300) });
      else failed.push({ text, source: String(b.source || ""), why: v.why });
    }
    // A line refused for a word ("Manage", "Skilled") still carries a fact of theirs: one more try with the
    // reason, so a number or a result isn't lost over wording.
    if (failed.length) {
      let r2 = {};
      try {
        r2 = await ask([{ role: "system", content: `Rewrite each resume line using only the person's facts.\n${GUIDE}\nEach item says why the last try was rejected; fix exactly that and keep every number.${j.current ? " This is their current job: present tense for ongoing duties." : " This is a past job: past tense."}\nReturn JSON only: {"lines": [{"n": 0, "text": "..."}]}` },
          { role: "user", content: `JOB: ${j.title} at ${j.employer}\nTHEIR WORDS: ${sources.join(". ")}\n\n` + failed.map((x, n) => `${n}. LAST TRY: ${x.text} -> rejected: ${x.why.join("; ")}`).join("\n") }]);
      } catch { r2 = {}; }
      failed.forEach((x, n) => {
        const t2 = houseStyle(Profile.stripDashes(String((arr(r2.lines).find((l) => Number(l.n) === n) || {}).text || "")).trim()).replace(/\.$/, "");
        const v2 = t2 ? vet(t2, sources, p, allowedHere) : { ok: false };
        if (v2.ok && !bullets.some((y) => sameLine(y.text, t2))) bullets.push({ id: slug(t2.split(/\s+/).slice(0, 2).join(" "), bt), text: t2, approved: false, source: x.source.slice(0, 300) });
        else rejected.push({ job: j.title, text: x.text, why: x.why });
      });
    }
    // Nothing the AI wrote survived the check: the person's own words, as they gave them.
    if (!bullets.length && j.daily) for (const part of String(j.daily).split(/[.;\n]+/).map((x) => x.trim()).filter((x) => words(x).length >= 2).slice(0, 3)) {
      bullets.push({ id: slug(part.split(/\s+/).slice(0, 2).join(" "), bt), text: part[0].toUpperCase() + part.slice(1), approved: false, source: part });
    }
    // Every number they gave goes into a line: one the lines left out ("about 200 customers a shift") gets a
    // line of its own, written from the part of their answer that says it, and checked like the rest.
    const given = [j.daily, j.proud, j.numbers].filter(Boolean).join(". ");
    const usedNums = new Set(bullets.flatMap((b) => [...numbersIn(b.text)]));
    const missing = [...numbersIn(given)].filter((n) => !usedNums.has(n) && !(Number(n) >= 1950 && Number(n) <= 2100));
    // ... and an AI tool they used is proof hiring managers look for: it gets a line too, even without a number.
    const aiSaid = AI_TOOL.test(given) && !bullets.some((b) => AI_TOOL.test(b.text));
    // ... and each duty they described ("checked the truck before every route") that no line covers.
    const parts = given.split(/(?<=[.;!?])\s+|,\s+(?=[a-z])/).map((x) => x.trim()).filter((x) => x.split(/\s+/).length >= 3);
    const uncovered = parts.filter((x) => !covers(bullets.map((b) => b.text), x)).slice(0, 4);
    if (missing.length || aiSaid || uncovered.length) {
      const said = parts.filter((x) => missing.some((n) => numbersIn(x).has(n)) || (aiSaid && AI_TOOL.test(x)) || uncovered.includes(x));
      try {
        const r3 = await ask([{ role: "system", content: `Write one resume line for each fact below, using only that fact's words and every number in it exactly, with its "about".\n${GUIDE}${j.current ? "\nThis is their current job: present tense for ongoing duties." : "\nThis is a past job: past tense."}\nReturn JSON only: {"lines": [{"n": 0, "text": "..."}]}` },
          { role: "user", content: `JOB: ${j.title} at ${j.employer}\n` + said.map((x, n) => `${n}. ${x}`).join("\n") }]);
        for (const l of arr(r3.lines)) {
          const t = houseStyle(Profile.stripDashes(String(l.text || "")).trim()).replace(/\.$/, "");
          if (!t || bullets.some((y) => sameLine(y.text, t)) || !vet(t, sources, p, allowedHere).ok) continue;
          const forPart = said[Number(l.n)] || "";
          if (![...numbersIn(t)].some((n) => missing.includes(n)) && !(aiSaid && AI_TOOL.test(t)) && !(uncovered.includes(forPart) && covers([t], forPart))) continue;
          bullets.push({ id: slug(t.split(/\s+/).slice(0, 2).join(" "), bt), text: t, approved: false, source: said[Number(l.n)] || given.slice(0, 300) });
        }
      } catch { /* the lines they have stand */ }
    }
    // The things they said yes to when the app jogged their memory.
    if (arr(j.confirmed).length) {
      const extra = await fromYes[i];
      for (const l of extra.lines) {
        if (bullets.some((b) => sameLine(b.text, l.text))) continue;
        bullets.push({ id: slug(l.text.split(/\s+/).slice(0, 2).join(" "), bt), text: l.text, approved: false, source: l.source, ...(l.warning ? { warning: l.warning } : {}), recalled: true });
      }
      rejected.push(...extra.rejected.map((x) => ({ job: j.title, ...x })));
    }
    // Never ask for what they already gave: their dates (so how long they worked there), or a number they typed.
    const asked = (q) => (/how (many|long)\b.*\b(years?|months?)\b|how long have you|how long did you/i.test(q) && (j.start || j.end || j.current)) ||
      (numbersIn(j.numbers || "").size > 0 && /how many|average|number of/i.test(q) &&
        String(j.numbers).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3).some((w) => q.toLowerCase().includes(w.replace(/s$/, ""))));
    for (const q of arr(out.questions).filter((q) => !asked(String(q))).slice(0, 3)) questions.push({ job: `${j.title} at ${j.employer}`, question: String(q) });
    const dates = `${fmtDate(j.start)}${j.start || j.end || j.current ? " – " : ""}${j.current ? "Present" : fmtDate(j.end)}`.trim();
    newExp.push({ id: slug(j.employer || j.title, expIds), title: j.title || "", org: j.employer || "", location: j.location || "", dates, minBullets: Math.min(2, bullets.length), bullets });
  }
  // The second pass: anything the person's answers don't back up gets a visible note for them.
  setProgress(2, 4, "Checking every line against what you said");
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
  let sumText = houseStyle(Profile.stripDashes(String(r.summary || "")).trim());
  let sv = vet(sumText, [facts], p, known);
  // A summary never talks about pay or wanting to leave.
  const PAY = /\b(pay|pays|paid|salary|money|wages?)\b/i;
  if (sumText && PAY.test(sumText)) sv = { ok: false, why: [...sv.why, "talks about pay; say what you bring instead"] };
  // One more try for the summary, saying exactly what was wrong with the first.
  if (sumText && !sv.ok) {
    try {
      const again = await ask([{ role: "system", content: `Write a 2 to 3 sentence resume summary from a person's own answers, aimed at the job they want next.\n${GUIDE}\nYour last try was rejected because it ${sv.why.join("; ")}. Avoid these words too: ${arr((p.rules || {}).bannedWords).join(", ")}.\nReturn JSON only: {"summary": "..."}` },
        { role: "user", content: facts }]);
      const t2 = houseStyle(Profile.stripDashes(String(again.summary || "")).trim());
      let v2 = vet(t2, [facts], p, known);
      if (PAY.test(t2)) v2 = { ok: false, why: [...v2.why, "talks about pay"] };
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
  // No summary the checks accepted: a plain one built from their own titles and licenses, no AI words.
  if (!p.summaries.length) { p.summaries.push({ id: "summary", text: plainSummary(iv), approved: false, source: "your job titles and certifications" }); p.bases[p.bases.length - 1].summary = "summary"; }
  return { profile: p, rejected, questions, created: { experience: newExp.map((e) => e.id), skills: skillIds } };
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
    const text = houseStyle(Profile.stripDashes(String(s.text || "")).trim());
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
export async function rewriteWithAnswer(profile, answers, { path, original, question, answer, current = null }) {
  const sys = `You rewrite one resume line using a fact the person just gave.
${GUIDE}
Return JSON only: {"text": "...", "why": "..."}`;
  const r = await ask([{ role: "system", content: sys }, { role: "user", content: `LINE: ${original}\nQUESTION: ${question}\nTHEIR ANSWER: ${answer}${current === null ? "" : current ? "\nTHIS IS THEIR CURRENT JOB: keep the present tense" : "\nTHIS IS A PAST JOB: past tense"}` }]);
  let text = houseStyle(Profile.stripDashes(String(r.text || "")).trim());
  const v = vet(text, [original, answer], approvedOnly(profile), knownTerms(approvedOnly(profile), answers), original);
  if (!v.ok) return { path, original, text: "", why: "", error: `The rewrite ${v.why.join("; ")}, so it wasn't used. You can edit the line yourself.` };
  let fc = await factCheck([{ text, source: `${original} ${answer}` }]);
  // The second check doubted something: one more try that leaves it out, through both checks again.
  if (fc && fc[0]) {
    try {
      const r2 = await ask([{ role: "system", content: sys }, { role: "user", content: `LINE: ${original}\nQUESTION: ${question}\nTHEIR ANSWER: ${answer}\nYour last try "${text}" was rejected because "${fc[0]}" isn't in the line or the answer. Use only the line's own words plus their answer.` }]);
      const t2 = houseStyle(Profile.stripDashes(String(r2.text || "")).trim());
      if (t2 && vet(t2, [original, answer], approvedOnly(profile), knownTerms(approvedOnly(profile), answers), original).ok) {
        const fc2 = await factCheck([{ text: t2, source: `${original} ${answer}` }]);
        if (fc2 && !fc2[0]) { text = t2; fc = fc2; r.why = r2.why; }
      }
    } catch { /* the first verdict stands */ }
  }
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
  const { findOccupations, BOSS, SAYS_BOSS } = await import("./onet.js");
  const said = [job.daily, job.proud, job.tools, ...arr(job.existing)].filter(Boolean).join("\n");
  // A supervisor's or manager's list comes last unless they say they supervised.
  const boss = SAYS_BOSS.test(`${job.title} ${said}`);
  const pool = findOccupations(job.title, 6);
  const cands = [...pool.filter((o) => boss || !BOSS.test(o.title)), ...pool.filter((o) => !boss && BOSS.test(o.title))].slice(0, 5);
  const fallback = () => {
    const o = cands[0];
    return { occupation: o ? o.title : "", items: o ? o.tasks.slice(0, 10).map((t) => ({ id: qid(t), q: `Did you: ${t.charAt(0).toLowerCase()}${t.slice(1).replace(/\.$/, "")}?`, task: t, from: "onet" })) : [] };
  };
  const sys = `You help someone remember what they did at a job, so their resume isn't missing things.
You get their job title, employer, what they already said, and official task lists (U.S. Department of Labor O*NET) for the occupations that job title might be.
1. Pick the occupation that best fits the work they describe ("occupation": its index), not just the title's words. Never a supervisor's or manager's list unless they say they supervised or managed.
   If none of them is the work they describe (a sign shop worker is not a retail salesperson), set "occupation": -1 and write up to 12 questions about what this job usually involves instead, without "t".
2. Turn the most relevant tasks from it (or from the second-best one) into up to 12 short, plain yes/no questions a non-expert understands
   ("Did you count the cash drawer at the end of a shift?"), fitted to this employer, and skip anything they already said. Each cites its task as "t": [occupationIndex, taskIndex].
3. Add up to 3 more questions about things very common in this specific job or kind of workplace that the lists miss (no "t" for those).
Questions only ask; they never assume. Return JSON only: {"occupation": 0, "questions": [{"q": "Did you ...?", "t": [0, 3]}]}`;
  const user = `JOB: ${job.title}${job.employer ? " at " + job.employer : ""}\nWHAT THEY ALREADY SAID:\n${said || "(nothing yet)"}\n\nOCCUPATIONS AND THEIR TASKS:\n` +
    cands.map((o, i) => `${i}. ${o.title}\n${o.tasks.slice(0, 18).map((t, k) => `   ${k}. ${t}`).join("\n")}`).join("\n");
  let r;
  try { r = await ask([{ role: "system", content: sys }, { role: "user", content: user }]); } catch { return fallback(); }
  const none = Number(r.occupation) === -1;
  const occ = none ? null : cands[Number(r.occupation)] || cands[0];
  const items = [], seen = new Set();
  let ideas = 0;
  for (const x of arr(r.questions)) {
    const q = String(x.q || "").trim();
    // Yes/no questions only: "What types of materials did you use?" can't be answered with Yes.
    if (!q || !/\?$/.test(q) || !/^(did|do|have|had|were|was|are|is|could|can|would)\b/i.test(q) || seen.has(q.toLowerCase())) continue;
    let task = "", from = "ai";
    // The model writes the reference in more than one way: [0, 3], "0,3", "0-3", {"o": 0, "t": 3}.
    const ref = Array.isArray(x.t) ? x.t : typeof x.t === "string" ? x.t.split(/[^0-9]+/).filter(Boolean) : x.t && typeof x.t === "object" ? [x.t.o ?? x.t.occupation, x.t.t ?? x.t.task] : null;
    if (!none && ref && ref.length >= 2) { const o = cands[Number(ref[0])]; task = o ? o.tasks[Number(ref[1])] || "" : ""; }
    // No usable reference: the official task the question repeats most of the words of.
    if (!task && !none) task = closestTask(q, cands) || "";
    if (task) from = "onet";
    if (from === "ai" && ++ideas > (none ? 12 : 3)) continue;
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

// Two lines that say the same thing in other words ("Set out cones..." twice, "Trained two new guys" and
// "Trained new employees"): most of the longer one's words are in the shorter one.
export const lineWords = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPW.has(w)).map((w) => w.replace(/(ing|ed|es|s|e)$/, "")));
export function sameLine(a, b) {
  const x = lineWords(a), y = lineWords(b);
  if (!x.size || !y.size) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  const hits = [...small].filter((w) => big.has(w)).length;
  return hits >= 2 && hits / small.size >= 0.5;
}

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
  // A job they still have: ongoing duties in the present tense, like the rest of that job's lines.
  const now = job.current || /present|now|current/i.test(String(job.dates || job.end || ""));
  const tense = now ? "\nThey still work at this job: write ongoing duties in the present tense (\"Secure vehicles...\", not \"Secured vehicles...\")." : "\nThis job is in the past: write every line in the past tense.";
  const write = async (cs, note = "") => {
    const r = await ask([{ role: "system", content: sys + tense + note }, { role: "user", content: `JOB: ${job.title}${job.employer ? " at " + job.employer : ""}${now ? " (they work here now)" : ""}\nTHEY CONFIRMED:\n${list(cs)}` }]);
    return arr(r.lines).map((l) => {
      const text = houseStyle(Profile.stripDashes(String(l.text || "")).trim()).replace(/\.$/, "");
      const used = arr(l.from).map((i) => cs[Number(i)]).filter(Boolean);
      const from = used.length ? used : cs;
      const v = vet(text, [...from.map(yesSource), job.title, job.employer || ""], p, known, from.map((c) => `${c.q} ${c.detail || ""}`).join(" "));
      return { text, from, v };
    });
  };
  const out = [], rejected = [];
  const keep = (x) => out.some((y) => sameLine(y.text, x.text)) || out.push({ text: x.text, source: "You said yes to: " + x.from.map((c) => c.q).join(" / ") + (x.from.some((c) => c.detail) ? ` (${x.from.map((c) => c.detail).filter(Boolean).join("; ")})` : ""), check: x.from.map(yesSource).join(". ") });
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
  const { lines, rejected } = await linesFromConfirmed({ title: e.title, employer: e.org, dates: e.dates }, confirmed, approvedOnly(p), answers);
  const bt = new Set(arr(e.bullets).map((b) => b.id));
  for (const l of lines) e.bullets.push({ id: slug(l.text.split(/\s+/).slice(0, 2).join(" "), bt), text: l.text, approved: false, source: l.source, ...(l.warning ? { warning: l.warning } : {}) });
  return { profile: p, added: lines.length, rejected };
}
