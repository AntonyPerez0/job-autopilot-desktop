// "Tell it in my own words": instead of filling in the creator's form, the person talks about their work in a
// chat. Each message gets a short reply, the one question that would help the resume most (what's missing, then
// digging into what went well, how many, which tools), a few other ideas to talk about, and notes sorted into
// jobs, school and skills.
//
// The notes are the AI's reading of the chat, so before any of it counts as a fact it's checked against the
// person's own words, with no AI: a part that adds a number, a name or a claim they never typed is left out, and
// a job title they never used is asked about before the resume is written. The checked notes are the creator's
// interview, and the resume is written from them exactly as from the form, through every check there.
import { readJSON, writeJSON } from "./store.js";
import { addedFacts, ask, claimWords, lineWords, numbersIn, sameLine } from "./studio.js";

const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x, n = 2000) => (typeof x === "string" ? x.trim().slice(0, n) : "");

// One message, the messages in one chat, and all they type together: what one paid call reads stays bounded.
export const LIMITS = { chars: 4000, turns: 40, total: 30000 };

// turns: [{ who: "you", text, re }] and [{ who: "coach", text, question, ideas }]. re: the question a message answers.
// What they said, with the question each answer was to: "4" means something only next to "How many did you train?".
export const theirWords = (turns) => arr(turns).filter((t) => t.who === "you").map((t) => (t.re ? `(asked: ${t.re}) ${t.text}` : t.text)).join("\n");

const norm = (s) => ` ${String(s || "").toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim()} `;
const said = (s, words) => norm(s).trim() !== "" && norm(words).includes(norm(s));
const share = (s, words) => { const w = [...lineWords(s)], have = lineWords(words); return w.length ? w.filter((x) => have.has(x)).length / w.length : 0; };
const numsOk = (s, words) => { const have = numbersIn(words); return [...numbersIn(s)].every((n) => have.has(n)); };

// A note is theirs when nearly all its words are, and it adds no number, name or claim ("managed", "reduced") they didn't give.
export const backed = (part, words) => share(part, words) >= 0.75 && !addedFacts(part, [words]).length && !claimWords(part, [words]).length;
// A name (an employer, a school) may be written a little differently ("Lincoln High School" for "Lincoln High").
const nameOk = (s, words) => said(s, words) || (share(s, words) >= 0.6 && numsOk(s, words));
// A job title is the most-read line of a resume: every word of it has to be theirs.
const titleOk = (s, words) => said(s, words) || (lineWords(s).size > 0 && [...lineWords(s)].every((w) => lineWords(words).has(w)));
const itemOk = (s, words) => said(s, words) || (lineWords(s).size > 0 && [...lineWords(s)].every((w) => lineWords(words).has(w)) && !addedFacts(s, [words]).length);

const PARTS = /\s*[;\n]+\s*|(?<=[.!?])\s+|,\s+(?=\D)/;
// "Jun 2023" stays only when they gave that year (and the month, or it becomes "2023").
function dateOf(d, words) {
  const t = str(d, 40);
  if (!t || !numbersIn(t).size || !numsOk(t, words)) return "";
  const mon = (t.match(/[a-z]{3,}/i) || [])[0];
  return mon && !norm(words).includes(" " + mon.slice(0, 3).toLowerCase()) ? t.replace(/[a-z]+\.?,?\s*/gi, "").trim() : t;
}

// The AI's notes -> { iv, left, unsure }: the creator's interview made only of what they said, the parts left
// out, and the titles to ask about.
export function checkNotes(notes, turns) {
  const words = theirWords(turns);
  const n = notes && typeof notes === "object" ? notes : {};
  const left = [], unsure = [];
  const keep = (text) => {
    const parts = str(text, 5000).split(PARTS).map((x) => x.replace(/[.]+$/, "").trim()).filter(Boolean);
    const ok = parts.filter((p) => backed(p, words));
    left.push(...parts.filter((p) => !ok.includes(p)));
    return ok.join("; ");
  };
  const list = (text) => {
    const items = str(text, 2000).split(/\s*[,;\n]\s*/).filter(Boolean);
    const ok = items.filter((x) => itemOk(x, words));
    left.push(...items.filter((x) => !ok.includes(x)));
    return ok.join(", ");
  };
  const jobs = [];
  for (const j of arr(n.jobs).slice(0, 20)) {
    if (!j || typeof j !== "object") continue;
    const title = str(j.title, 120), employer = str(j.employer, 120);
    const job = { title, employer: nameOk(employer, words) ? employer : "", location: nameOk(str(j.location, 120), words) ? str(j.location, 120) : "",
      start: dateOf(j.start, words), end: j.current === true ? "" : dateOf(j.end, words), current: j.current === true,
      daily: keep(j.daily), proud: keep(j.proud), numbers: keep(j.numbers), tools: list(j.tools) };
    if (!job.title && !job.employer) continue;
    if (title && !titleOk(title, words)) unsure.push({ title, employer: job.employer, question: `Is "${title}" the right job title for your work${job.employer ? ` at ${job.employer}` : ""}? If not, what was it called?` });
    jobs.push(job);
  }
  const education = arr(n.education).slice(0, 10).filter((e) => e && nameOk(str(e.school, 200), words))
    .map((e) => ({ school: str(e.school, 200), earned: itemOk(str(e.earned, 120), words) ? str(e.earned, 120) : "", year: numsOk(str(e.year, 40), words) ? str(e.year, 40) : "" }));
  const target = str(n.target, 200);
  const iv = { target: share(target, words) >= 0.5 && numsOk(target, words) ? target : "", jobs, education,
    certifications: list(n.certifications), skills: list(n.skills), languages: list(n.languages) };
  return { iv, left, unsure };
}

// What's still missing before a resume can be written from the notes; "" when nothing is.
export function notReady({ iv, unsure }) {
  if (!iv.jobs.length && !iv.education.length) return "Tell me about at least one job (or your school, if you haven't worked yet) first.";
  if (unsure.length) return `Before I write it: ${unsure[0].question}`;
  const thin = iv.jobs.find((j) => !j.daily && !j.proud && !j.numbers);
  if (thin) return `Tell me what you did at ${thin.employer || thin.title} on a normal day first. A few words is enough.`;
  return "";
}

const SYS = `You are a friendly resume coach in a chat. The person is telling you about their work in their own words, so the app can write their resume. Most people undersell themselves and forget things; your questions help them remember and say more. You never write resume lines here, and you never put words in their mouth.

Return two things.

1. "notes": everything they have said so far, sorted into jobs (newest first), school and skills, in THEIR OWN WORDS. Copy their phrases (fix spelling, drop filler like "um" or "like"); never summarize, reword, add, guess or improve. Anything they didn't say stays empty. Part-time jobs, gig work, a family business and volunteering are jobs too. An answer to a question goes with the job the question was about. When they correct something, use the correction.
   - title: the job title as they said it. If they never said one, the plainest title for what they described.
   - start, end: as they said them ("Jun 2023", "2021"). current: true only if they said they still work there.
   - daily: what they did on a normal day. proud: what went well, their part and how they did it. numbers: the numbers they gave, with the words around them. tools: tools, machines, vehicles and software they named, comma-separated.
   - certifications, skills, languages: comma-separated, only ones they named. target: the kind of job they want next, if they said.

2. Coach them:
   - "reply": one or two short, plain sentences back about what they just said. No flattery or praise words ("impressive", "amazing"), and no claims they didn't make.
   - "question": the one question that would help their resume most right now. In this order: what's missing for a job (its title, the employer, about when, what they did on a normal day); then digging into something they mentioned (what went well, what their part was and how they did it; how many, how often, how much; which tools or machines; training others; being trusted with keys, cash, opening or closing; recognition); then what people leave out (other jobs, school or training, licenses and certificates, languages).
   - "ideas": up to 3 other short questions they could answer instead, each about something different.
   Each question asks one thing, in plain words anyone understands, about something they mentioned or something common in that kind of job. Questions only ask: never assume they did something. Never ask about something they already told you, and never about pay, age, health, family or anything private.

Return JSON only:
{"reply": "...", "question": "...?", "ideas": ["...?"], "notes": {"target": "", "jobs": [{"title": "", "employer": "", "location": "", "start": "", "end": "", "current": false, "daily": "", "proud": "", "numbers": "", "tools": ""}], "education": [{"school": "", "earned": "", "year": ""}], "certifications": "", "skills": "", "languages": ""}}`;

export const transcriptText = (turns) => arr(turns).map((t) => (t.who === "coach"
  ? `COACH: ${t.text}${t.question ? ` ${t.question}` : ""}${arr(t.ideas).length ? ` (Other ideas: ${t.ideas.join(" ")})` : ""}`
  : `PERSON${t.re ? ` (answering "${t.re}")` : ""}: ${t.text}`)).join("\n");

// The coach's answer to the conversation so far: its turn, and the checked notes.
export async function coach(turns, { target = "" } = {}) {
  const r = await ask([{ role: "system", content: SYS }, { role: "user", content: `${target ? `THE JOB THEY'RE LOOKING FOR (from their settings): ${target}\n\n` : ""}${transcriptText(turns)}` }]);
  const checked = checkNotes(r.notes, turns);
  const q = (x) => str(typeof x === "string" ? x : x && x.q, 300);
  let question = q(r.question);
  const ideas = arr(r.ideas).map(q);
  // A title they never used is asked about first: it heads the job on the resume.
  if (checked.unsure.length) { if (question) ideas.unshift(question); question = checked.unsure[0].question; }
  const out = [];
  for (const x of ideas) if (/\?$/.test(x) && !sameLine(x, question) && !out.some((y) => sameLine(x, y))) out.push(x);
  const turn = { who: "coach", text: str(r.reply, 600), question, ideas: out.slice(0, 3) };
  return { turn, ...checked };
}

// The conversation is kept on this computer until they start over, so leaving the page loses nothing.
const FILE = "talk.json";
export const getTalk = () => { const t = readJSON(FILE, null); return t && Array.isArray(t.turns) ? t : { turns: [] }; };
export const clearTalk = () => writeJSON(FILE, { turns: [] });

// Their next message (or none, to ask the coach again after a failed try) -> the conversation as saved.
export async function say(text, re, { target = "" } = {}) {
  const t = getTalk();
  const msg = str(text, LIMITS.chars);
  if (msg) {
    const mine = t.turns.filter((x) => x.who === "you");
    if (mine.length >= LIMITS.turns || mine.reduce((n, x) => n + x.text.length, 0) + msg.length > LIMITS.total) throw new Error("That's a lot to go on already. Press Write my resume; you can add more afterwards.");
    // Only a question the coach just asked can be the one they're answering.
    const last = [...t.turns].reverse().find((x) => x.who === "coach");
    const asked = last ? [last.question, ...arr(last.ideas)] : [];
    t.turns.push({ who: "you", text: msg, ...(re && asked.includes(re) ? { re } : {}) });
    writeJSON(FILE, { turns: t.turns });
  }
  if (!t.turns.length || t.turns[t.turns.length - 1].who !== "you") return t;
  const r = await coach(t.turns, { target });
  const saved = { turns: [...t.turns, r.turn], notes: r.iv, unsure: r.unsure, left: r.left.length };
  writeJSON(FILE, saved);
  return saved;
}
