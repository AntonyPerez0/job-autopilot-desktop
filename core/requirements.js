// What a posting asks for, checked against the person's approved resume and their About-you answers, with no AI
// (the idea of freehire's deterministic match score: credit only what the resume shows). A license, certificate,
// degree, age or driver's license the posting requires and the person clearly doesn't have skips the job with the
// reason, before any paid AI call; everything else is shown ("Your resume shows 5 of 7") and the AI screen decides.
import { approvedOnly } from "./engine.js";

const arr = (x) => (Array.isArray(x) ? x : []);
const MAX = 15;

// A line that limits a requirement: preferred ones never skip a job, and "not required" isn't one at all.
const PREFERRED = /\b(preferred|a plus|nice to have|bonus|desired|desirable|ideally|helpful|advantageous)\b/i;
const NOT_REQUIRED = /\bnot required\b|\bno (prior )?experience (is )?(required|needed|necessary)\b/i;
// "CPR within 30 days of hire", "willing to obtain", "we'll train": not needed to apply.
const LATER = /\b(within|by) (the first )?\d+ (days|weeks|months)|\bwilling(ness)? to (obtain|get|earn|complete)|\b(ability|able) to (obtain|get)\b|\bor (be )?(eligible|in the process|currently enrolled)|\bin progress\b|\b(upon|after|prior to|before) (hire|start)|\bwe (will )?(provide|pay for|sponsor|offer)\b|\btraining (is )?provided\b|\bobtain(ed)? (within|after)\b/i;
// Experience or training that counts in place of a degree.
const EQUIVALENT = /\bor (equivalent|related|comparable|relevant)\b|\bin lieu\b|\bequivalent (combination|experience)\b|\bor \d+\+? years?\b/i;

// ---------- the requirement lines ----------

const HEADING = /^(?:[#*\s]*)(requirements?|qualifications?|minimum qualifications|basic qualifications|preferred qualifications|required (skills|experience|qualifications)|what you('ll)? (need|bring)|what we('re| are) looking for|who you are|about you|you have|must[- ]haves?|skills( and| &) (experience|abilities)|experience( and| &) (skills|education)|education( and| &) experience|nice to haves?|bonus points|pluses)\b[^.\n]{0,40}:?\s*$/i;
const OTHER_HEADING = /^(?:[#*\s]*)(responsibilities|what you('ll)? do|duties|about (the|this) (role|job|position|company)|benefits|perks|compensation|pay|salary|schedule|our (company|team|mission)|who we are|why (join|work)|how to apply|location|equal opportunity|eeo)\b[^.\n]{0,40}:?\s*$/i;
const BULLET = /^\s*([-*•·–▪◦●]|\d{1,2}[.)])\s+/;
const MUST = /\b(required|requires?|must|minimum|at least|valid|current|active|certif\w*|licen[cs]\w*|diploma|degree|ged)\b/i;

// The posting's own requirement lines: freehire's structured list when it has one, else the bullets under the
// description's requirements heading, else its lines that say "must", "required" or name a license or degree.
export function requirementLines(job) {
  const out = [];
  const add = (text, priority) => {
    const t = String(text || "").replace(BULLET, "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (t.length < 4 || NOT_REQUIRED.test(t) || out.some((x) => x.text === t) || out.length >= MAX) return;
    out.push({ text: t, priority: PREFERRED.test(t) ? "preferred" : priority === "preferred" ? "preferred" : "required" });
  };
  for (const r of arr(job.requirements)) add(typeof r === "string" ? r : r && r.text, r && r.priority);
  if (out.length) return out;
  const lines = String(job.description || "").slice(0, 20000).split(/\r?\n|(?<=[.;])\s+(?=[-*•·]\s)/).map((x) => x.trim()).filter(Boolean);
  let mode = null;
  for (const l of lines) {
    if (l.length < 70 && HEADING.test(l)) { mode = /prefer|nice|bonus|plus/i.test(l) ? "preferred" : "required"; continue; }
    if (l.length < 70 && OTHER_HEADING.test(l)) { mode = null; continue; }
    if (mode && (BULLET.test(l) || l.length < 200)) add(l, mode);
  }
  if (out.length) return out;
  for (const l of lines) if (l.length < 250 && MUST.test(l)) for (const part of l.split(/(?<=[.;])\s+/)) if (MUST.test(part)) add(part, "required");
  return out;
}

// ---------- what the person has ----------

// Licenses and certificates: [name, in a requirement, on the resume (defaults to the same)].
const CREDS = [
  ["a CNA certification", /\bC\.?N\.?A\b|certified nurs(e|ing) (aide|assistant)/i],
  ["an LPN or LVN license", /\bL[PV]N\b|licensed (practical|vocational) nurse/i],
  ["an RN license", /\bRN\b|registered nurse/i],
  ["an EMT certification", /\bEMT(-?B)?\b|emergency medical technician/i],
  ["a paramedic license", /\bparamedic (licen|certif)|\blicensed paramedic|\bNRP\b/i, /\bparamedic\b|\bNRP\b/i],
  ["CPR or BLS certification", /\b(CPR|BLS)\b|basic life support/i],
  ["a food handler card", /food handler|food safety (card|certif)|servsafe/i],
  ["ServSafe Manager certification", /servsafe manager|food (protection|safety) manager/i],
  ["a forklift certification", /forklift (certif|licen|operator certif)|certified forklift|\bforklift\b[^.]{0,30}\b(certif|licen)/i, /forklift/i],
  ["an OSHA card", /\bOSHA[- ]?(10|30)\b/i],
  ["a home health aide certification", /\bHHA\b|home health aide (certif|licen)|certified home health aide/i, /\bHHA\b|home health aide/i],
  ["a phlebotomy certification", /phlebotom(y|ist) (certif|licen)|certified phlebotom|\bCPT\b[^.]{0,20}phlebotom/i, /phlebotom/i],
  ["a pharmacy technician certification", /\bCPhT\b|(certified|licensed|registered) pharmacy tech|pharmacy tech\w* (licen|certif|registration)/i, /\bCPhT\b|pharmacy tech/i],
  ["a medical assistant certification", /\b(CMA|RMA|CCMA|NCMA)\b|certified medical assistant|medical assistant certif/i],
  ["a security guard license", /guard card|security (guard |officer )?licen[cs]e|\bBSIS\b|security guard registration/i],
  ["a TWIC card", /\bTWIC\b/i],
  ["a hazmat endorsement", /hazmat|hazardous materials endorsement/i],
  ["a tanker endorsement", /tanker endorsement|\bN endorsement\b/i, /tanker/i],
  ["a passenger endorsement", /passenger endorsement|\bP endorsement\b/i, /passenger/i],
  ["CompTIA A+", /comptia a\+|\bA\+ certif/i, /\bA\+/],
  ["CompTIA Security+", /security\+/i],
  ["CompTIA Network+", /network\+/i],
  ["a PMP certification", /\bPMP\b/i],
  ["a CPA license", /\bCPA\b/i],
  ["a real estate license", /real estate (licen|salesperson licen)/i, /real estate licen|realtor/i],
  ["an insurance license", /(insurance|life (and|&) health|P&C|property (and|&) casualty) licen/i, /insurance licen|life (and|&) health|P&C|property (and|&) casualty/i],
  ["a cosmetology license", /cosmetolog(y|ist) licen|licensed cosmetologist/i, /cosmetolog/i],
  ["an electrician license", /journeyman|electrician'?s? licen|licensed electrician/i],
  ["a notary commission", /\bnotary\b/i],
];
// A line that asks for the credential itself: to hold it, a current or valid one, the certificate, the license.
const HOLDS = /\b(hold|holds|have|has|possess|current|valid|active|certified|certification|certificate|licen[cs]e[ds]?|registered|registry|registration|card|endorsement|credential)\b/i;
const CLASS = /\bclass[\s-]*([abc])\b|\bcdl[\s-]*([abc])\b|\b([abc])[\s-]*cdl\b/i;
const DEGREES = [[4, /\bmaster'?s\b|\bMBA\b|\bM\.S\.\B/i], [3, /\bbachelor'?s?\b|\bB\.?[AS]\.?\b|\bBSc\b|four[- ]year (college )?degree|college degree|university degree/i],
  [2, /\bassociate'?s? (degree|of)\b|\bA\.?A\.?S?\.?\b(?= degree|,|\s|$)|two[- ]year degree/i], [1, /high school|\bGED\b|\bdiploma\b/i]];
const DEGREE_NAME = { 1: "a high school diploma or GED", 2: "an associate degree", 3: "a bachelor's degree", 4: "a master's degree" };
const levelOf = (t) => { for (const [n, rx] of DEGREES) if (rx.test(t)) return n; return 0; };
const lower = (s) => String(s || "").toLowerCase();

// Everything the resume says, approved pieces only, and the highest degree on it (null: no education listed).
export function resumeText(profile, answers = {}) {
  const p = approvedOnly(profile || {});
  const parts = [p.name, ...arr(p.summaries).map((s) => s.text), ...arr(p.skills).map((s) => `${s.label}: ${s.items}`)];
  for (const k of ["experience", "projects"]) for (const e of arr(p[k])) parts.push(e.title, e.org, ...arr(e.bullets).map((b) => b.text));
  const edu = [...arr(p.education).map((e) => `${e.school} ${e.detail || ""}`), ...arr(answers.education).map((e) => `${e.school || ""} ${e.degree || ""} ${e.field || ""}`)];
  parts.push(...edu);
  const known = edu.filter((x) => x.trim());
  return { text: parts.filter(Boolean).join("\n"), degree: known.length ? Math.max(0, ...known.map(levelOf)) : null };
}

// freehire's skill tags are slugs ("cpp", "nodejs"); the words a resume uses for them.
const SKILL_WORDS = { cpp: ["c++"], csharp: ["c#"], nodejs: ["node.js", "node"], golang: ["go", "golang"], js: ["javascript"], ts: ["typescript"], k8s: ["kubernetes"], postgres: ["postgresql", "postgres"] };
const skillWords = (slug) => SKILL_WORDS[slug] || [slug.replace(/-/g, " ")];
const has = (text, w) => new RegExp(`(^|[^a-z0-9+#.])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9+#])`, "i").test(text);
// The specific things a line names (tools, systems, languages): written with capitals or symbols.
const STOP = /^(must|ability|able|strong|excellent|good|knowledge|experience|proven|minimum|required|preferred|work|working|the|and|or|with|in|of|a|an|to|for|on|at|be|is|are|we|you|our|your|team|teams|valid|current|high|school|years?|including|plus|bonus|us|u\.s|united|states)$/i;
function namedThings(line, skills) {
  const out = new Set();
  // A capital at the start of a sentence says nothing, except in a line that is only a name or two ("Kubernetes").
  const short = String(line).trim().split(/\s+/).length <= 3;
  for (const m of String(line).matchAll(/[A-Za-z][A-Za-z0-9+#./-]*/g)) {
    const w = m[0].replace(/[.,/-]+$/, "");
    if (w.length < 2 || STOP.test(w) || (m.index === 0 && !short) || (w.length <= 3 && w.includes("/"))) continue;
    if (/^[A-Z]/.test(w) || /[0-9+#]/.test(w)) out.add(w.toLowerCase());
  }
  for (const s of arr(skills)) for (const w of skillWords(String(s).toLowerCase())) if (has(line, w)) out.add(w);
  return [...out];
}

// ---------- the check ----------

// One requirement -> { status: met | missing | later | form | unchecked, why, hard } where hard means a must-have the
// person clearly lacks (the job is skipped for it without the AI), and later one they can get after they're hired.
export function checkLine(line, have, answers = {}, skills = []) {
  const t = line.text, later = LATER.test(t), req = line.priority === "required" && !later;
  const res = (status, why, hard = false) => (status === "missing" && hard && later
    ? { ...line, status: "later", why: `${why.replace(/, and your resume doesn't list one$/, "")}: you can get it after you're hired`, hard: false }
    : { ...line, status, why, hard: hard && req && status === "missing" });
  // A license class: a Class A holder can drive B and C jobs; a B holder can drive C.
  const cls = t.match(CLASS);
  if (cls && /\b(cdl|licen[cs]e|class)\b/i.test(t)) {
    const need = (cls[1] || cls[2] || cls[3]).toUpperCase();
    const held = [...have.text.matchAll(new RegExp(CLASS.source, "gi"))].map((x) => (x[1] || x[2] || x[3]).toUpperCase());
    if (held.some((c) => c <= need)) return res("met", `you hold a Class ${held.sort()[0]} CDL`);
    return res("missing", held.length ? `a Class ${need} CDL; you hold Class ${held.sort()[0]}` : `a Class ${need} CDL, and your resume doesn't list one`, true);
  }
  for (const [name, need, own = need] of CREDS) {
    if (!need.test(t)) continue;
    if (own.test(have.text)) return res("met", `your resume lists ${name.replace(/^an? /, "")}`);
    // "Competency in all required CNA skills" asks for skills, not for the certificate itself.
    return res("missing", `${name}, and your resume doesn't list one`, HOLDS.test(t));
  }
  if (/\bcdl\b|commercial driver'?s licen/i.test(t)) {
    if (/\bcdl\b|commercial driver/i.test(have.text)) return res("met", "your resume lists a CDL");
    return res("missing", "a CDL, and your resume doesn't list one", true);
  }
  const need = levelOf(t);
  if (need && /\b(degree|diploma|ged|bachelor|associate|master|mba|education)\b/i.test(t)) {
    if (have.degree === null) return res("unchecked", "your resume lists no school, so the AI judges this one");
    if (have.degree >= need) return res("met", `your resume shows ${DEGREE_NAME[have.degree]}`);
    return res("missing", `${DEGREE_NAME[need]}${EQUIVALENT.test(t) ? " (or equivalent experience, so it isn't a must-have)" : ""}`, !EQUIVALENT.test(t));
  }
  if (/driver'?s licen[cs]e|licen[cs]e to drive|valid (state )?licen[cs]e\b/i.test(t)) {
    if (answers.driversLicense === "yes" || /driver'?s licen|\bcdl\b/i.test(have.text)) return res("met", "you have a driver's license");
    if (answers.driversLicense === "no") return res("missing", "a driver's license (you said you don't have one)", true);
    return res("form", "you answer this on the application");
  }
  const age = t.match(/\b(?:at least|must be|minimum(?: age)?(?: of)?|be)\s+(\d{2})\s*(?:\+|years|yrs|or older)/i);
  if (age && [18, 21].includes(Number(age[1]))) {
    const v = answers[Number(age[1]) === 21 ? "over21" : "over18"];
    if (v === "yes") return res("met", `you're ${age[1]} or older`);
    if (v === "no") return res("missing", `being ${age[1]} or older`, true);
    return res("form", "you answer this on the application");
  }
  const lift = t.match(/\blift\w*\b[^.]{0,30}?(\d{2,3})\s*(lbs?|pounds)/i);
  if (lift) {
    if (Number(answers.canLift) >= Number(lift[1])) return res("met", `you can lift ${answers.canLift} pounds`);
    return res("form", "you answer this on the application");
  }
  if (/\b(background check|drug (test|screen)|schedule|weekends?|holidays|shifts?|overtime|reliable transportation|authori[sz]ed to work|sponsorship|on-?site|in-?office|relocat)/i.test(t)) return res("form", "you answer this on the application");
  // Named tools and systems first: "3+ years with Excel" is about Excel, not about years of any work.
  const things = namedThings(t, skills);
  if (things.length) {
    const hit = things.filter((w) => has(have.text, w));
    if (hit.length && hit.length >= things.length / 2) return res("met", `your resume shows ${hit.slice(0, 3).join(", ")}`);
    return res("missing", `not on your resume: ${things.filter((w) => !hit.includes(w)).slice(0, 3).join(", ")}`);
  }
  const yrs = t.match(/\b(\d{1,2})\+?\s*(?:or more\s+)?years?\b/i);
  if (yrs && /experience/i.test(t) && Number(answers.totalYears) > 0) {
    return Number(answers.totalYears) >= Number(yrs[1]) ? res("met", `you have about ${answers.totalYears} years of work`) : res("missing", `${yrs[1]}+ years (you have about ${answers.totalYears})`);
  }
  return res("unchecked", "the AI reads this one");
}

// job: { requirements, description, skills } -> { items, met, checked, gaps: [why] }
export function checkRequirements(job, profile, answers = {}) {
  const have = resumeText(profile, answers);
  const items = requirementLines(job).map((l) => checkLine(l, have, answers, job.skills));
  const met = items.filter((x) => x.status === "met").length, missing = items.filter((x) => x.status === "missing").length;
  return { items, met, checked: met + missing, gaps: items.filter((x) => x.hard).map((x) => x.why) };
}
