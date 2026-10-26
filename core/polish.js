// Making a resume read the way recruiters want, without adding a single fact:
//   polishCreated:  after the creator writes a person's lines, keep the strongest few per job, best first,
//                   in professional wording; a headline and a two-sentence summary; skills in clear groups.
//   makeVersion:    one layout per kind of job ("CDL driving", "IT support"), choosing and wording the
//                   person's true lines for that field, plus what that field usually asks for that they
//                   don't show yet (advice for them, never on the resume).
//   recruiterReview: reads the resume as a recruiter would and lists what is weak, line by line.
// Every rewritten line passes the same honesty checks as the rest of the app (vet, then factCheck).
// The rules come from docs/resume-research.md.
import { Profile, Tailor, approvedOnly } from "./engine.js";
import { GUIDE, ask, casualBits, claimWords, factCheck, knownTerms, newWords, numbersIn, sameLine, specificTerms, vet as vet0 } from "./studio.js";

// The app's honesty check, plus: a rewording may use professional words for the same facts, but never a
// word that makes a new claim ("using a ticketing system", "managed", "reduced"), and not many new words at all.
export function vet(text, sources, profile, allowed, original) {
  const v = vet0(text, sources, profile, allowed, original);
  if (original === undefined) return v;
  const why = [...v.why];
  const extra = newWords(text, sources).filter((w) => !allowed.some((a) => String(a).toLowerCase().startsWith(w)));
  const claims = claimWords(text, sources);
  if (claims.length && !why.some((w) => /claim/.test(w))) why.push(`adds a claim your line doesn't make: ${claims.slice(0, 3).join(", ")}`);
  else if (extra.length > 4) why.push(`adds words your line doesn't say: ${extra.slice(0, 4).join(", ")}`);
  const casual = casualBits(text);
  if (casual.length) why.push(`reads casually ("${casual[0]}"); a resume says it more formally`);
  // A number they gave is the strongest part of a line: a rewording may not lose it.
  const kept = numbersIn(text);
  const lost = [...numbersIn(original)].filter((n) => !kept.has(n));
  if (lost.length) why.push(`leaves out your number ${lost.join(", ")}`);
  return { ok: !why.length, why };
}

const arr = (x) => (Array.isArray(x) ? x : []);
const clean = (t) => Profile.stripDashes(String(t || "")).replace(/\s+/g, " ").trim().replace(/\.$/, "");
const slug = (s, taken) => { const b = String(s || "x").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x"; let id = b, n = 2; while (taken.has(id)) id = `${b}-${n++}`; taken.add(id); return id; };
const isCurrent = (e) => /present|now|current/i.test(String(e.dates || ""));

// How many lines a job gets on a one-page resume: the current or latest job most.
export const LINES = { current: 5, recent: 4, older: 3 };
export const SKILL_GROUPS = ["Licenses & Certifications", "Equipment & Tools", "Software & Systems", "Skills", "Languages"];

// From docs/resume-research.md ("Rules for the app"): recruiters spend about 7 seconds on a first look,
// mostly on titles, the top third and the first words of each line.
export const POLISH_RULES = `What recruiters want:
- A headline under the name: the kind of job they do or want plus their strongest credential they hold, about 6 to 12 words ("Class B CDL tow truck driver, WreckMaster certified"). For a driving or trade job the license class goes here. No adjectives about character.
- A summary of two or three short lines: what they do, the scope (numbers they gave), and what they bring to the job they want next (name that job when they are changing fields). No "I", no objective statement ("seeking a challenging position"), no "hard-working", "team player", "detail-oriented", "motivated", "results-driven", "passionate".
- Lines: an action verb first, one sentence of about 12 to 28 words, the most relevant to the job they want first. Lead with scope or a result they gave (how many, how often, trust given to them, people trained, an emergency handled), then the task.
- Turn "responsible for", "duties included", "tasked with", "worked on", "helped with" into the task's own verb ("Responsible for towing cars" -> "Tow cars"), but keep "helped" when they only helped.
- Plain, concrete verbs: never "spearheaded", "leveraged", "orchestrated", "transformed" or other big words their facts don't support.
- Every number they gave stays exactly as they gave it, with its "about"; use each one somewhere.
- Professional, technical register: the terms people in their trade use on a resume, never everyday talk. "Take dispatch calls and drive to breakdowns" -> "Respond to dispatched breakdown and accident calls"; "hard recoveries like cars in ditches" -> "complex off-road vehicle recoveries"; "talking with police" -> "coordinating with law enforcement on scene"; "turned signs around fast" -> "produced signs on short notice"; "went out with the crew" -> "installed signs as part of a field crew"; "two new guys" -> "two new hires". Proper capitals for names ("City of Sacramento"); standard abbreviations only (CDL, DOT). Same facts, never a bigger claim, and no corporate filler.
- Tense: present for the current job's ongoing work, past for everything else. No trailing full stops.
- Never mention pay, money wanted, or why they want to leave ("a role that pays better"). If the job they want is vague, aim at the work their facts show instead.
- Merge two lines that say nearly the same thing. Drop the weakest lines rather than keeping many.`;

// A headline and a summary from the person's facts, through the honesty checks, with one more try that
// says what was wrong. -> { headline, summary, rejected }
async function topOfPage(first, facts, p, known, aim) {
  const rejected = [];
  const check = (h, s0) => ({ h: clean(h), s: clean(s0), hv: vet(clean(h), [facts], p, known), sv: vet(clean(s0), [facts], p, known) });
  // A summary says what they are ("Tow truck driver with..."), not a duty list that starts with a verb.
  const VERB_START = /^(operate|operated|maintain|maintained|respond|responded|manage|managed|handle|handled|perform|performed|deliver|delivered|make|made|work|worked|provide|provided|fabricate|fabricated|keep|kept|drive|drove|train|trained|assist|assisted|use|used|complete|completed|collect|collected|install|installed|run|ran|serve|served)\b/i;
  const okH = (x) => x.h && x.hv.ok && x.h.split(/\s+/).length <= 16, okS = (x) => x.s && x.sv.ok && !/\b(pay|pays|paid|salary|money)\b/i.test(x.s) && !VERB_START.test(x.s);
  let c = check(first.headline, first.summary);
  if (!okH(c) || !okS(c)) {
    const why = [!okH(c) && c.h ? `the headline "${c.h}" ${c.hv.why.join("; ") || "was too long"}` : "", !okS(c) && c.s ? `the summary ${c.sv.why.join("; ") || (VERB_START.test(c.s) ? "started with a verb like a resume line; start with what they are, e.g. 'Tow truck driver with a Class B CDL...'" : "mentioned pay")}` : ""].filter(Boolean).join(". ");
    try {
      const r2 = await ask([{ role: "system", content: `Write a resume headline (6 to 12 words) and a two-sentence summary from a person's facts only, ${aim}.\n${POLISH_RULES}\nYour last try was rejected: ${why}. Use only their own words for any claim about them; no praise words at all.\nReturn JSON only: {"headline": "...", "summary": "..."}` },
        { role: "user", content: facts }]);
      const c2 = check(r2.headline, r2.summary);
      if (!okH(c) && okH(c2)) { c.h = c2.h; c.hv = c2.hv; }
      if (!okS(c) && okS(c2)) { c.s = c2.s; c.sv = c2.sv; }
    } catch { /* keep what passed */ }
  }
  if (c.h && !okH(c)) rejected.push({ job: "Headline", text: c.h, why: c.hv.why.length ? c.hv.why : ["too long"] });
  // No headline passed: a plain one from their own title and credentials.
  if (!okH(c) && first.fallbackHeadline) { c.h = first.fallbackHeadline; c.hv = { ok: true, why: [] }; }
  if (c.s && !okS(c)) rejected.push({ job: "Summary", text: c.s, why: c.sv.why.length ? c.sv.why : ["mentions pay"] });
  return { headline: okH(c) ? c.h : "", summary: okS(c) ? c.s : "", rejected };
}

// "Tow Truck Driver with Class B CDL and WreckMaster 4/5": their own title and credentials, nothing else.
function plainHeadline(job, certGroups) {
  if (!job || !job.title) return "";
  const certs = certGroups.flatMap((g) => String(g.items).split(/\s*,\s*/)).filter(Boolean).slice(0, 2);
  return certs.length ? `${job.title} with ${certs.join(" and ")}` : job.title;
}

function sourcesOf(e) { return arr(e.bullets).map((b) => [b.text, b.source].filter(Boolean).join(". ")); }

// ---------- after the creator: the strongest lines, a headline and summary, grouped skills ----------

// profile: the creator's output (new lines unapproved). ids: the experience entries the creator just made.
// linesOnly: just the lines (for entries added to an existing resume); the headline, summary and skills stay as they are.
export async function polishCreated(profile, { target = "", ids = null, skillIds = null, answers = {}, linesOnly = false } = {}) {
  const p = JSON.parse(JSON.stringify(profile));
  const entries = arr(p.experience).filter((e) => !ids || ids.includes(e.id));
  if (!entries.length) return { profile: p, notes: [], rejected: [] };
  const ordered = [...entries];
  const limit = (e, i) => (linesOnly ? (isCurrent(e) ? LINES.recent : LINES.older) : i === 0 ? (isCurrent(e) ? LINES.current : LINES.recent) : LINES.older);
  // Only the skill lists the creator just made are regrouped; ones the person already approved stay as they are.
  const mine = arr(p.skills).filter((s) => (skillIds ? skillIds.includes(s.id) : !s.approved));
  const skillItems = [...new Set(mine.flatMap((s) => String(s.items).split(/\s*,\s*/)).filter(Boolean))];
  const payload = {
    target: target || "",
    jobs: ordered.map((e, i) => ({ i, title: e.title, employer: e.org, dates: e.dates, current: isCurrent(e), keep: limit(e, i),
      lines: arr(e.bullets).map((b, k) => ({ k, text: b.text })) })),
    skills: skillItems,
    certifications: mine.filter((s) => /certif|licen/i.test(s.label)).map((s) => s.items).join(", "),
  };
  const sys = `You are an experienced recruiter turning a person's resume lines into a resume that stands out, using ONLY their facts.
${GUIDE}
${POLISH_RULES}
For each job, choose at most "keep" lines, strongest first. Each chosen line is one of theirs reworded, or two of theirs merged ("from": the k numbers used). Keep every number exactly, and keep "about", "helped", "part-time" and similar limits.
Then write "headline" and "summary" (aimed at the job they want next, if given) from these facts only.
Then sort their skills into groups, using only the exact items given (you may drop a duplicate like "Vinyl cutting" when "Vinyl cutter" is there): ${JSON.stringify(SKILL_GROUPS)}.
Return JSON only: {"jobs": [{"i": 0, "lines": [{"text": "...", "from": [0, 3]}]}], "headline": "...", "summary": "...", "skills": [{"label": "Licenses & certifications", "items": ["..."]}]}`;
  const r = await ask([{ role: "system", content: sys }, { role: "user", content: JSON.stringify(payload) }]);
  const known = knownTerms(p, answers);
  const notes = [], rejected = [], toCheck = [];
  // First the choices and their wording; a line that fails a check gets one more try, with the reason.
  const picks = [];
  for (const [i, e] of ordered.entries()) {
    const out = arr(r.jobs).find((x) => Number(x.i) === i);
    if (!out || !arr(out.lines).length) continue;
    const old = arr(e.bullets), used = new Set();
    for (const l of arr(out.lines).slice(0, limit(e, i))) {
      const from = arr(l.from).map(Number).filter((k) => old[k] && !used.has(k));
      if (!from.length) continue;
      from.forEach((k) => used.add(k));
      const src = from.map((k) => [old[k].text, old[k].source].filter(Boolean).join(". "));
      const original = from.map((k) => old[k].text).join(" ");
      const allowed = [...known, ...specificTerms(e.title), ...specificTerms(e.org)];
      const check = (t) => vet(clean(t), [...src, e.title, e.org || ""], p, allowed, original);
      const text = clean(l.text);
      picks.push({ i, e, from, src, original, check, text, v: check(text) });
    }
  }
  const retry = picks.filter((x) => !x.v.ok || !x.text);
  if (retry.length) {
    try {
      const r2 = await ask([{ role: "system", content: `Rewrite each resume line in professional, specific wording a recruiter in that trade expects, using only its facts.\n${GUIDE}\n${POLISH_RULES}\nEach item says why the last try was rejected; fix exactly that. Keep every number with its "about".\nReturn JSON only: {"lines": [{"n": 0, "text": "..."}]}` },
        { role: "user", content: retry.map((x, n) => `${n}. JOB: ${x.e.title}${isCurrent(x.e) ? " (current job: present tense)" : " (past job: past tense)"}\n   THEIR LINE: ${x.original}\n   LAST TRY: ${x.text || "(none)"} -> rejected: ${x.v.why.join("; ") || "empty"}`).join("\n") }]);
      for (const l of arr(r2.lines)) {
        const x = retry[Number(l.n)];
        if (!x) continue;
        const v = x.check(l.text);
        if (v.ok) { x.text = clean(l.text); x.v = v; }
      }
    } catch { /* keep the first try's verdicts */ }
  }
  for (const [i, e] of ordered.entries()) {
    const mine = picks.filter((x) => x.i === i);
    if (!mine.length) continue;
    const old = arr(e.bullets);
    const used = new Set(), next = [];
    const taken = new Set();
    for (const x of mine) {
      const { from, src, text, v } = x;
      const base = old[from[0]];
      if (v.ok && text) {
        const b = { ...base, id: slug(text.split(/\s+/).slice(0, 2).join(" "), taken), text, source: arr(from.map((k) => old[k].source)).filter(Boolean).join(" / ") || base.source, approved: false };
        delete b.warning;
        next.push(b);
        toCheck.push({ b, text, source: src.join(". ") });
      } else {
        rejected.push({ job: e.title, text, why: v.why });
        if (!next.some((y) => sameLine(y.text, base.text))) next.push({ ...base, approved: false, id: slug(base.text.split(/\s+/).slice(0, 2).join(" "), taken), ...(casualBits(base.text).length ? { warning: "This line still reads casually. Reword it, or use Improve on the Resume page." } : {}) });
      }
      from.forEach((k) => used.add(k));
    }
    if (!next.length) continue;
    // The lines left out stay available for tailoring to a posting, below the chosen ones.
    const rest = old.filter((b, k) => !used.has(k) && !next.some((x) => sameLine(x.text, b.text))).map((b) => ({ ...b, approved: b.approved === true ? true : false, id: slug(b.text.split(/\s+/).slice(0, 2).join(" "), taken) }));
    e.bullets = [...next, ...rest];
    e.minBullets = Math.min(2, next.length);
    e.lead = next.map((b) => b.id); // the ones to show by default
    notes.push(`${e.title}: ${next.length} strongest lines first, ${rest.length} more kept for tailoring`);
  }
  // Headline and summary: their facts only, through the same checks; the old ones stay if these fail.
  const facts = ordered.map((e) => [e.title, e.org, e.dates, ...sourcesOf(e)].join(". ")).join("\n") + "\n" + skillItems.join(", ") + "\n" + target;
  r.fallbackHeadline = plainHeadline(ordered[0], arr(p.skills).filter((x) => /certif|licen/i.test(x.label)));
  const top = linesOnly ? { headline: "", summary: "", rejected: [] } : await topOfPage(r, facts, p, known, target ? `aimed at ${target} jobs` : "aimed at the work their facts show");
  rejected.push(...top.rejected);
  const headline = top.headline, summary = top.summary;
  if (headline) {
    const ids0 = new Set(arr(p.headers).map((h) => h.id));
    const id = slug("headline", ids0);
    p.headers = [...arr(p.headers), { id, text: headline, approved: false, source: "your facts" }];
    p.newHeadline = id;
    toCheck.push({ b: p.headers[p.headers.length - 1], text: headline, source: facts });
  }
  if (summary) {
    const ids0 = new Set(arr(p.summaries).map((s) => s.id));
    const id = slug("summary", ids0);
    p.summaries = [{ id, text: summary.endsWith(".") ? summary : summary + ".", approved: false, source: "your facts" }, ...arr(p.summaries)];
    p.newSummary = id;
    toCheck.push({ b: p.summaries[0], text: summary, source: facts });
  }
  // Skills: only items the person typed, in clear groups. Licenses and languages go where they belong
  // without the AI; it only sorts the rest into equipment, software and skills.
  const stemOf = (x) => x.toLowerCase().replace(/(ing|er|ers|s)$/, "").trim();
  const SOFT = /^(driving|customer service|communication|teamwork|team work|leadership|time management|problem solving|work ethic|punctual\w*|reliab\w*|hard work\w*|reading work orders|multitasking|organization)$/i;
  const split = (s0) => String(s0.items).split(/\s*,\s*/).filter(Boolean);
  const certs = mine.filter((s0) => /certif|licen/i.test(s0.label)).flatMap(split);
  const langs = mine.filter((s0) => /language/i.test(s0.label)).flatMap(split);
  const rest = skillItems.filter((x) => !certs.includes(x) && !langs.includes(x));
  const buckets = new Map([["Licenses & Certifications", [...certs]], ["Equipment & Tools", []], ["Software & Systems", []], ["Skills", []], ["Languages", [...langs]]]);
  const soft = [];
  const placedOnce = (x) => [...buckets.values()].flat().some((y) => y.toLowerCase() === x.toLowerCase() || stemOf(y) === stemOf(x));
  const have = new Map(rest.map((x) => [x.toLowerCase(), x]));
  for (const g of arr(r.skills)) {
    const label = ["Equipment & Tools", "Software & Systems", "Skills"].find((x) => x.toLowerCase() === String(g.label || "").toLowerCase());
    for (const raw of arr(g.items)) {
      const x = have.get(String(raw).toLowerCase());
      if (!x || !label || placedOnce(x)) continue;
      if (SOFT.test(x)) { if (!soft.includes(x)) soft.push(x); continue; }
      buckets.get(label).push(x);
    }
  }
  // Nothing they typed is lost: a soft skill is kept off the page, anything else the AI missed goes under Skills.
  for (const x of rest) {
    if (placedOnce(x) || soft.includes(x)) continue;
    if (SOFT.test(x)) soft.push(x); else buckets.get("Skills").push(x);
  }
  if (!linesOnly && mine.length && skillItems.length) {
    const oldIds = new Set(mine.map((s0) => s0.id));
    const taken = new Set(arr(p.skills).filter((s0) => !oldIds.has(s0.id)).map((s0) => s0.id));
    const fresh = [...buckets].filter(([, items]) => items.length).map(([label, items]) => ({ id: slug(label, taken), label, items: items.join(", "), approved: false }));
    const other = soft.length ? [{ id: slug("Other skills", taken), label: "Other skills", items: soft.join(", "), approved: false, offPage: true }] : [];
    p.skills = [...arr(p.skills).filter((s0) => !oldIds.has(s0.id)), ...fresh, ...other];
    for (const b of arr(p.bases)) if (arr(b.skills).some((id) => oldIds.has(id))) b.skills = [...arr(b.skills).filter((id) => !oldIds.has(id)), ...fresh.map((s0) => s0.id)];
    notes.push(`skills in ${fresh.length} groups`);
  }
  // The second, separate AI pass over everything reworded; it knows the tools and skills they listed too.
  const listed = skillItems.length ? `. Tools, skills and licenses they listed: ${skillItems.join(", ")}` : "";
  const verdict = await factCheck(toCheck.map((x) => ({ text: x.text, source: x.source + listed })));
  toCheck.forEach((x, k) => {
    if (verdict === null) x.b.warning = "This line wasn't double-checked. Read it carefully.";
    else if (verdict[k]) x.b.warning = `Check this: "${verdict[k]}" goes beyond what you said.`;
  });
  // The layout the creator made shows the chosen lines, the new headline and the new summary.
  const mineIds = new Set(ordered.map((e) => e.id));
  for (const b of arr(p.bases)) {
    if (!arr(b.sections).some((s) => arr(s.items).some((it) => mineIds.has(it.id)))) continue;
    for (const s of arr(b.sections)) for (const it of arr(s.items)) {
      const e = ordered.find((x) => x.id === it.id);
      if (e && e.lead) it.bullets = e.lead.slice();
    }
    if (p.newSummary && (!b.summary || !arr(p.summaries).some((s) => s.id === b.summary && s.approved))) b.summary = p.newSummary;
    if (p.newHeadline && !b.header) b.header = p.newHeadline;
  }
  for (const e of ordered) delete e.lead;
  delete p.newSummary; delete p.newHeadline;
  return JSON.parse(JSON.stringify({ profile: p, notes, rejected }));
}

// ---------- a version of the resume for one kind of job ----------

// -> { profile (with a new layout, new reworded lines and summary, all unapproved), base, gaps: [...], rejected }
export async function makeVersion(profile, target, answers = {}) {
  const p = JSON.parse(JSON.stringify(profile));
  const ok = approvedOnly(p);
  if (!arr(ok.experience).length) throw new Error("Approve your resume lines first, then make a version from them.");
  const payload = {
    target,
    jobs: arr(ok.experience).map((e, i) => ({ i, id: e.id, title: e.title, employer: e.org, dates: e.dates, current: isCurrent(e), lines: arr(e.bullets).map((b) => ({ id: b.id, text: b.text })) })),
    projects: arr(ok.projects).map((e) => ({ id: e.id, title: e.title, lines: arr(e.bullets).map((b) => ({ id: b.id, text: b.text })) })),
    skills: arr(ok.skills).map((s) => ({ id: s.id, label: s.label, items: s.items })),
    education: arr(ok.education).map((e) => [e.school, e.detail].filter(Boolean).join(", ")),
  };
  const sys = `You are a recruiter for "${target}" jobs, building this person's resume for that kind of job from their approved lines ONLY.
${GUIDE}
${POLISH_RULES}
1. For each job, choose the lines that matter most for ${target} work (current job at most ${LINES.current}, others at most ${LINES.older}), best first, by "id".
   Where a line would mean more to a ${target} recruiter in that field's words, give a reworded version: same facts, same numbers, same limits, nothing added
   (a sign-shop line about fixing the vinyl cutter can become "Troubleshot and maintained..." for a technician job; it cannot gain a tool, a system or a result).
2. A headline and a two-sentence summary for ${target} work, from their facts only.
3. The order of their skill groups for this kind of job (by id).
4. "gaps": what ${target} job ads commonly require that their facts don't show (a certification, a license, a skill), each with one plain sentence on how people usually get it. Advice only; it never goes on the resume.
Return JSON only: {"jobs": [{"id": "...", "lines": [{"id": "...", "text": "reworded, or empty to use as is"}]}], "headline": "...", "summary": "...", "skills": ["skillId"], "gaps": [{"need": "...", "how": "..."}]}`;
  const r = await ask([{ role: "system", content: sys }, { role: "user", content: JSON.stringify(payload) }]);
  const known = knownTerms(p, answers);
  const rejected = [], toCheck = [], items = [];
  for (const j of arr(r.jobs)) {
    const e = arr(p.experience).find((x) => x.id === j.id);
    const okE = arr(ok.experience).find((x) => x.id === j.id);
    if (!e || !okE) continue;
    const taken = new Set(arr(e.bullets).map((b) => b.id));
    const chosen = [];
    for (const l of arr(j.lines).slice(0, isCurrent(e) ? LINES.current : LINES.older)) {
      const orig = arr(okE.bullets).find((b) => b.id === l.id);
      if (!orig || chosen.includes(orig.id)) continue;
      const text = clean(l.text);
      if (!text || text.toLowerCase() === orig.text.toLowerCase().replace(/\.$/, "")) { chosen.push(orig.id); continue; }
      const v = vet(text, [orig.text, orig.source || "", e.title, e.org || ""], p, [...known, ...specificTerms(e.title)], orig.text);
      if (!v.ok) { rejected.push({ job: e.title, text, why: v.why }); chosen.push(orig.id); continue; }
      // A rewording that barely changes the line isn't worth approving again: the original is used.
      const ws = (t) => new Set(String(t).toLowerCase().split(/[^a-z0-9']+/).filter((w) => w.length > 2));
      const a1 = ws(text), a2 = ws(orig.text);
      if ([...a1].filter((w) => !a2.has(w)).length + [...a2].filter((w) => !a1.has(w)).length <= 2) { chosen.push(orig.id); continue; }
      // An existing wording of the same line is reused; a new one waits for approval.
      const same = arr(e.bullets).find((b) => b.text.toLowerCase() === text.toLowerCase() || (b.variantOf === orig.id && sameLine(b.text, text)));
      if (same) { chosen.push(same.id); continue; }
      const b = { id: slug(text.split(/\s+/).slice(0, 2).join(" "), taken), text, approved: false, source: `Your line "${orig.text}", worded for ${target} jobs`, variantOf: orig.id };
      e.bullets.push(b);
      chosen.push(b.id);
      toCheck.push({ b, text, source: [orig.text, orig.source].filter(Boolean).join(". ") });
    }
    if (chosen.length) items.push({ id: e.id, bullets: chosen });
  }
  if (!items.length) throw new Error("The AI didn't choose any lines. Try again.");
  const facts = JSON.stringify(payload);
  r.fallbackHeadline = plainHeadline(arr(ok.experience)[0], arr(ok.skills).filter((x) => /certif|licen/i.test(x.label)));
  const top = await topOfPage(r, facts, p, known, `aimed at ${target} jobs (name that kind of job)`);
  rejected.push(...top.rejected);
  const headline = top.headline, summary = top.summary;
  const tag = slug(target, new Set(arr(p.bases).map((b) => b.id)));
  let header = null, sumId = arr(ok.summaries)[0] ? ok.summaries[0].id : null;
  if (headline) {
    header = slug(`headline ${tag}`, new Set(arr(p.headers).map((h) => h.id)));
    p.headers = [...arr(p.headers), { id: header, text: headline, approved: false, source: `your facts, for ${target} jobs` }];
    toCheck.push({ b: p.headers[p.headers.length - 1], text: headline, source: facts });
  }
  if (summary) {
    sumId = slug(`summary ${tag}`, new Set(arr(p.summaries).map((s) => s.id)));
    p.summaries = [...arr(p.summaries), { id: sumId, text: summary.endsWith(".") ? summary : summary + ".", approved: false, source: `your facts, for ${target} jobs` }];
    toCheck.push({ b: p.summaries[p.summaries.length - 1], text: summary, source: facts });
  }
  const skillIds = arr(r.skills).filter((id) => arr(ok.skills).some((s) => s.id === id && s.label !== "Other skills"));
  const projects = arr(ok.projects).slice(0, 2).map((e) => ({ id: e.id, bullets: arr(e.bullets).slice(0, 2).map((b) => b.id) }));
  const base = { id: tag, description: `${target} jobs`, approved: false, header, summary: sumId,
    skills: skillIds.length ? skillIds : arr(ok.skills).map((s) => s.id),
    sections: [{ kind: "experience", items }, ...(projects.length ? [{ kind: "projects", items: projects }] : []), ...(arr(ok.education).length ? [{ kind: "education" }] : [])] };
  p.bases = [...arr(p.bases), base];
  const verdict = await factCheck(toCheck.map((x) => ({ text: x.text, source: x.source })));
  toCheck.forEach((x, k) => {
    if (verdict === null) x.b.warning = "This line wasn't double-checked. Read it carefully.";
    else if (verdict[k]) x.b.warning = `Check this: "${verdict[k]}" goes beyond your original line.`;
  });
  const gaps = arr(r.gaps).map((g) => ({ need: String(g.need || "").slice(0, 120), how: String(g.how || "").slice(0, 240) })).filter((g) => g.need).slice(0, 5);
  base.gaps = gaps;
  return JSON.parse(JSON.stringify({ profile: p, base: tag, gaps, rejected, newLines: toCheck.length }));
}

// ---------- the recruiter check ----------

// The 10-point recruiter-check rubric from docs/resume-research.md.
export const REVIEW_RULES = `Check it against these, the way a recruiter does in the first 7 seconds and then line by line:
Never ask for a bulleted summary or one that starts with a verb: the summary is two or three sentences that say what the person is.
1. 7-second test: the headline, the most recent title and the key license or certification are readable in the top third.
2. Target match: the job they want (or a close title) is in the headline or summary.
3. Line form: every line starts with a verb, uses the right tense (present for the current job), has no "I"/"my", and runs 2 printed lines or fewer.
4. Accomplishments: at least half the lines show scope (how many, how often, what equipment, who was served) or a result, not just a duty. Volume they gave ("about 8 to 12 calls a shift") and a record ("never damaged a customer's car") ARE accomplishments: praise them, never ask to remove them. When a line lacks one, say what to ASK the person.
5. No fluff: no "responsible for", "duties included", "hard-working", "team player", "detail-oriented", no inflated verbs ("spearheaded", "leveraged").
6. Professional register: every line reads like a professional resume in that trade, not everyday talk ("take calls", "like cars in ditches", "went out with the crew", "around fast", "guys" fail). Flag EVERY casual line and give the professional wording of the same facts in the fix.
6b. Fact fidelity: nothing looks inflated or vague.
7. Line budget: current job 3 to 5 lines, older jobs 2 or 3, no near-duplicate lines, one page.
8. Skills: grouped and labeled (licenses and certifications, equipment and tools, software and systems, languages); hard skills only.
9. Format: dates on every job, standard headings, consistent punctuation (no trailing full stops), proper capitals.
10. Career changers: the summary names the target role and at least two lines use that field's words honestly.`;

export async function recruiterReview(profile, { base = null, target = "" } = {}) {
  const p = approvedOnly(profile);
  const b = arr(p.bases).find((x) => x.id === base) || arr(p.bases)[0];
  if (!b) throw new Error("Approve a layout first (All your resume pieces).");
  if (!target && b.description && / jobs$/.test(b.description)) target = b.description.replace(/ jobs$/, "");
  const { spec } = Tailor.checkPlan(p, { base: b.id });
  const doc = { header: spec.header ? (arr(p.headers).find((h) => h.id === spec.header) || {}).text : "", summary: (arr(p.summaries).find((s) => s.id === spec.summary) || {}).text || "",
    skills: arr(spec.skills).map((id) => arr(p.skills).find((s) => s.id === id)).filter(Boolean).map((s) => `${s.label}: ${s.items}`),
    sections: arr(spec.sections).map((s) => ({ kind: s.kind, items: arr(s.items).map((it) => {
      const e = [...arr(p.experience), ...arr(p.projects)].find((x) => x.id === it.id) || {};
      return { title: e.title, org: e.org, dates: e.dates, lines: arr(it.bullets).map((id) => ({ path: `${s.kind}.${e.id}.${id}`, text: (arr(e.bullets).find((x) => x.id === id) || {}).text })).filter((x) => x.text) };
    }), ...(s.kind === "education" ? { entries: arr(p.education).map((e) => [e.school, e.detail, e.dates].filter(Boolean).join(", ")) } : {}) })) };
  const sys = `You are an experienced recruiter${target ? ` hiring for ${target} roles` : ""} reviewing a one-page resume.
${REVIEW_RULES}
Be specific and kind. Never suggest adding facts the resume doesn't show, and never put an example number, percentage, outcome or fact in a fix ("zero violations", "100% uptime", "e.g. heavy equipment"): when a detail would help, say only what to ask the person.
Return JSON only: {"score": 1-10, "verdict": "one sentence", "strengths": ["..."], "items": [{"path": "the line's path, or 'headline', 'summary', 'skills'", "problem": "...", "fix": "what to change, without inventing facts"}]}`;
  let r = await ask([{ role: "system", content: sys }, { role: "user", content: JSON.stringify(doc) }]);
  // An answer without a score or verdict is a failed read: one more try, then say so.
  if (!Number(r.score) || !String(r.verdict || "").trim()) r = await ask([{ role: "system", content: sys }, { role: "user", content: JSON.stringify(doc) }]);
  if (!Number(r.score) || !String(r.verdict || "").trim()) throw new Error("The recruiter read didn't come back complete. Try again.");
  const known = new Set(["headline", "summary", "skills", "layout"]);
  for (const s of doc.sections) for (const it of s.items) for (const l of it.lines) known.add(l.path);
  const items = arr(r.items).map((x) => ({ path: known.has(x.path) ? x.path : "layout", problem: String(x.problem || "").slice(0, 300), fix: String(x.fix || "").slice(0, 300) })).filter((x) => x.problem).slice(0, 12);
  return JSON.parse(JSON.stringify({ score: Math.max(1, Math.min(10, Number(r.score) || 0)), verdict: String(r.verdict || "").slice(0, 400), strengths: arr(r.strengths).map(String).slice(0, 4), items, base: b.id }));
}
