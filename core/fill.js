// "Fill out my page": when a resume is short, ask for the real things people usually leave out
// (other work, training with its year, records and recognition, volunteering, school, the numbers behind
// a line), and turn the answers into resume pieces. Nothing is made up and nothing is used until approved.
//   fillQuestions(profile)                 -> { jobs, certs, numbers }  what to ask
//   applyFill(profile, input, answers)     -> { profile, added, rejected }
import { Profile } from "./engine.js";
import { GUIDE, ask, createFromInterview, factCheck, knownTerms, numbersIn, rewriteWithAnswer, specificTerms } from "./studio.js";
import { POLISH_RULES, polishCreated, vet } from "./polish.js";

const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => String(x == null ? "" : x).trim();
const clean = (t) => Profile.stripDashes(str(t)).replace(/\s+/g, " ").replace(/\.$/, "");
const isCert = (s) => /certif|licen/i.test(String(s.label || ""));
const shownLines = (p) => {
  const lay = arr(p.bases).find((b) => b.approved) || arr(p.bases)[0];
  const out = [];
  for (const s of arr(lay && lay.sections)) for (const it of arr(s.items)) {
    const e = arr(p[s.kind]).find((x) => x.id === it.id);
    for (const id of arr(it.bullets)) { const b = e && arr(e.bullets).find((x) => x.id === id); if (b) out.push({ path: `${s.kind}.${e.id}.${b.id}`, job: e.title, text: b.text }); }
  }
  return out;
};

export const FILL_PROMPTS = {
  jobs: "Any other work, even small? Part-time, seasonal, side jobs, a family business, delivery or gig apps, the military.",
  certs: "Licenses and training: add the year and who issued it, and anything missing (CDL endorsements, OSHA 10, first aid or CPR, flagger, forklift).",
  records: "Records and recognition at each job: years without an accident or claim, employee of the month, a thank-you or commendation, being trusted with the hard jobs.",
  volunteer: "Volunteering or outside work: coaching, church or community help, fixing things for neighbors.",
  school: "School and courses: trade or driving school, shop classes, online courses (with the year).",
};

// What to ask: the fixed questions, the jobs to ask about, their certifications to add details to, and
// one AI question per line that would read stronger with a number they haven't given.
export async function fillQuestions(profile) {
  const p = profile || {};
  const jobs = arr(p.experience).map((e) => ({ id: e.id, title: e.title, org: e.org || "" }));
  const certs = [...new Set(arr(p.skills).filter(isCert).flatMap((s) => String(s.items).split(/\s*,\s*/)).filter(Boolean))];
  const bare = shownLines(p).filter((l) => !numbersIn(l.text).size).slice(0, 10);
  let numbers = [];
  if (bare.length) {
    try {
      const r = await ask([{ role: "system", content: `A recruiter wants scope on resume lines: how many, how often, how big, how fast. For the lines below that would gain the most from a number, write one short, plain question for the person (at most 5 lines). Never suggest a number or an answer in the question.
Return JSON only: {"questions": [{"path": "...", "question": "..."}]}` }, { role: "user", content: JSON.stringify(bare) }]);
      const by = new Map(bare.map((l) => [l.path, l]));
      numbers = arr(r.questions).filter((q) => by.has(q.path) && str(q.question)).slice(0, 5)
        .map((q) => ({ path: q.path, job: by.get(q.path).job, original: by.get(q.path).text, question: str(q.question).slice(0, 200) }));
    } catch { /* the fixed questions still work without these */ }
  }
  const schools = arr(p.education).map((e) => [e.school, e.detail, e.dates].filter(Boolean).join(", ")).filter(Boolean);
  return JSON.parse(JSON.stringify({ prompts: FILL_PROMPTS, jobs, certs, schools, numbers }));
}

const certText = (c) => { const extra = [str(c.issuer), str(c.year)].filter(Boolean).join(", "); return clean(c.name) + (extra ? ` (${extra})` : ""); };
const dedupe = (xs) => [...new Map(xs.map((x) => [x.toLowerCase().replace(/\s*\(.*\)$/, ""), x])).values()];
const titleCase = (t) => clean(t).replace(/\b([a-z])([a-z]{2,})/g, (m, a, b) => a.toUpperCase() + b);
// Lines a layout shows per entry: 5 for the first job, 3 for the others (docs/resume-research.md).
const capFor = (base, eid) => { const sec = arr(base.sections).find((s) => s.kind === "experience"); return sec && arr(sec.items)[0] && sec.items[0].id === eid ? 5 : 3; };
const lastIn = (taken, pre) => { let n = 2, id = pre; while (taken.has(id)) id = `${pre}-${n++}`; taken.add(id); return id; };

// input: { jobs: [{ title, employer, location, start, end, current, daily, numbers, tools }],
//   volunteer: [{ title, employer, start, end, current, daily }], certs: [{ name, issuer, year }],
//   records: [{ id: experience id, text }], school: [{ school, earned, year }],
//   numbers: [{ path, original, question, answer }] }
export async function applyFill(profile, input = {}, answers = {}) {
  let p = JSON.parse(JSON.stringify(profile));
  for (const k of ["experience", "projects", "skills", "education", "summaries", "headers", "bases"]) p[k] = arr(p[k]);
  const added = [], rejected = [];
  const bases = p.bases.filter((b) => arr(b.sections).some((s) => s.kind === "experience"));

  // Other jobs and volunteer work: the creator writes their lines, the recruiter's pass picks the best.
  const jobs = arr(input.jobs).filter((j) => str(j.title) || str(j.employer)).map((j) => ({ ...j, title: titleCase(j.title) }));
  const vol = arr(input.volunteer).filter((j) => str(j.title) || str(j.employer)).map((j) => ({ ...j, title: titleCase(j.title) || "Volunteer", volunteer: true }));
  if (jobs.length || vol.length) {
    const before = { bases: p.bases.map((b) => b.id), summaries: p.summaries.map((s) => s.id), skills: p.skills.map((s) => s.id) };
    const r = await createFromInterview({ jobs: [...jobs, ...vol] }, p, answers);
    let q = r.profile;
    // Keep the person's resume as it is: no new layout or summary, just the new entries.
    q.bases = q.bases.filter((b) => before.bases.includes(b.id));
    q.summaries = q.summaries.filter((s) => before.summaries.includes(s.id));
    const ids = r.created.experience.filter((id) => arr(q.experience.find((e) => e.id === id)?.bullets).length);
    const volIds = new Set(ids.filter((id, k) => (r.created.experience.indexOf(id) >= jobs.length)));
    for (const e of q.experience) if (volIds.has(e.id)) e.volunteer = true;
    rejected.push(...r.rejected.filter((x) => x.job !== "Summary")); // their summary stays, so a new one's fate doesn't matter
    if (ids.length) {
      try { const pol = await polishCreated(q, { ids, skillIds: [], answers, linesOnly: true }); q = pol.profile; rejected.push(...pol.rejected); }
      catch { /* the creator's lines stand */ }
      const show = (id) => { const e = q.experience.find((x) => x.id === id); return { id, bullets: e.bullets.slice(0, e.current || /present/i.test(e.dates) ? 4 : 3).map((b) => b.id) }; };
      for (const b of q.bases) if (bases.some((x) => x.id === b.id)) {
        const sec = b.sections.find((s) => s.kind === "experience");
        sec.items = [...arr(sec.items).filter((it) => !ids.includes(it.id)), ...ids.filter((id) => !volIds.has(id)).map(show), ...ids.filter((id) => volIds.has(id)).map(show)];
      }
      // Tools they named for the new work join their list of the same kind; the combined list takes
      // the old one's place once approved, so the page never shows the same heading twice.
      for (const s of q.skills.filter((s) => !before.skills.includes(s.id))) {
        s.label = /language/i.test(s.label) ? s.label : /certif|licen/i.test(s.label) ? "Licenses & Certifications" : /\b(app|apps|software|system|systems)\b/i.test(s.items) && !String(s.items).includes(",") ? "Software & Systems" : "Equipment & Tools";
        const old = q.skills.find((x) => before.skills.includes(x.id) && (x.label === s.label || (s.label === "Equipment & Tools" && /^(skills|equipment|tools)/i.test(x.label))));
        if (old) {
          s.items = dedupe([...String(old.items).split(/\s*,\s*/), ...String(s.items).split(/\s*,\s*/)].filter(Boolean)).join(", ");
          s.label = old.label; s.replaces = old.id;
        }
        for (const b of q.bases) if (bases.some((x) => x.id === b.id) && !arr(b.skills).includes(s.id)) {
          const at = old ? arr(b.skills).indexOf(old.id) : -1;
          const lang = arr(b.skills).findIndex((id) => /language/i.test((q.skills.find((x) => x.id === id) || {}).label || ""));
          if (at >= 0) b.skills.splice(at, 0, s.id); else if (lang >= 0) b.skills.splice(lang, 0, s.id); else b.skills = [...arr(b.skills), s.id];
        }
      }
      for (const id of ids) added.push({ kind: volIds.has(id) ? "volunteer" : "job", title: q.experience.find((e) => e.id === id).title });
    }
    p = q;
  }

  // Certifications with their issuer and year: one new list that takes the old one's place once approved.
  const certs = arr(input.certs).filter((c) => str(c.name));
  if (certs.length) {
    const old = p.skills.find(isCert);
    const have = old ? String(old.items).split(/\s*,\s*/).filter(Boolean) : [];
    const byName = new Map(certs.map((c) => [clean(c.name).toLowerCase(), certText(c)]));
    const items = dedupe([...have.map((x) => byName.get(x.toLowerCase()) || x), ...certs.map(certText)]);
    const id = lastIn(new Set(p.skills.map((s) => s.id)), "licenses-certifications");
    p.skills.push({ id, label: "Licenses & Certifications", items: items.join(", "), approved: false, source: "your answers", ...(old ? { replaces: old.id } : {}) });
    for (const b of p.bases) {
      const at = arr(b.skills).indexOf(old && old.id);
      if (at >= 0) b.skills.splice(at, 0, id); else b.skills = [id, ...arr(b.skills)];
    }
    added.push({ kind: "certifications", title: items.join(", ") });
  }

  // A record or recognition at a job: one line, in resume wording, first in that job.
  const recs = arr(input.records).filter((x) => str(x.text) && p.experience.some((e) => e.id === x.id));
  if (recs.length) {
    const known = knownTerms(p, answers);
    let out = {};
    try {
      out = await ask([{ role: "system", content: `Turn what a person said about a record or recognition at a job into one resume line each, using only their words' facts.\n${GUIDE}\n${POLISH_RULES}\nThe line is about the record or recognition itself, led by it. Don't restate a duty their other lines for that job already say.\nReturn JSON only: {"lines": [{"n": 0, "text": "..."}]}` },
        { role: "user", content: recs.map((x, n) => { const e = p.experience.find((y) => y.id === x.id); return `${n}. JOB: ${e.title}${/present/i.test(e.dates || "") ? " (current: present tense)" : " (past tense)"}\n   THEIR OTHER LINES: ${arr(e.bullets).map((b) => b.text).join(" | ")}\n   THEY SAID: ${x.text}`; }).join("\n") }]);
    } catch { out = {}; }
    const toCheck = [];
    const tries = recs.map((x, n) => {
      const e = p.experience.find((y) => y.id === x.id), said = clean(x.text);
      const check = (t) => (clean(t) ? vet(clean(t), [said, e.title, e.org || ""], p, [...known, ...specificTerms(e.title)], said) : { ok: false, why: ["empty"] });
      const text = clean((arr(out.lines).find((l) => Number(l.n) === n) || {}).text);
      return { x, e, said, check, text, v: check(text) };
    });
    // A line that failed a check gets one more try with the reason; their raw words never go on the page.
    const again = tries.filter((t) => !t.v.ok);
    if (again.length) {
      try {
        const r2 = await ask([{ role: "system", content: `Rewrite each record or recognition as one professional resume line, using only what they said.\n${GUIDE}\nEach item says why the last try was rejected; fix exactly that. Keep every number exactly as they gave it.\nReturn JSON only: {"lines": [{"n": 0, "text": "..."}]}` },
          { role: "user", content: again.map((t, n) => `${n}. JOB: ${t.e.title}${/present/i.test(t.e.dates || "") ? " (current: present tense)" : " (past tense)"}\n   THEY SAID: ${t.said}\n   LAST TRY: ${t.text || "(none)"} -> rejected: ${t.v.why.join("; ")}`).join("\n") }]);
        for (const l of arr(r2.lines)) { const t = again[Number(l.n)]; if (!t) continue; const v = t.check(l.text); if (v.ok) { t.text = clean(l.text); t.v = v; } }
      } catch { /* reported below */ }
    }
    for (const { e, said, text, v } of tries) {
      if (!v.ok) { rejected.push({ job: e.title, text: text || said, why: [...v.why, "type this one as a line yourself under All your resume pieces"] }); continue; }
      const id = lastIn(new Set(e.bullets.map((b) => b.id)), "record");
      const b = { id, text, approved: false, source: said };
      e.bullets.unshift(b);
      if (text !== b.source) toCheck.push({ b, text, source: said });
      // First in the job; the last line makes room (it stays available for tailoring).
      for (const base of p.bases) for (const s of arr(base.sections)) for (const it of arr(s.items)) if (it.id === e.id) {
        const cap = capFor(base, e.id), next = [id, ...arr(it.bullets)];
        it.bullets = arr(it.bullets).length >= cap ? next.slice(0, cap) : next;
      }
      added.push({ kind: "record", title: `${e.title}: ${text}` });
    }
    const verdict = toCheck.length ? await factCheck(toCheck.map((x) => ({ text: x.text, source: x.source }))) : [];
    toCheck.forEach((x, k) => {
      if (verdict === null) x.b.warning = "This line wasn't double-checked. Read it carefully.";
      else if (verdict[k]) x.b.warning = `Check this: "${verdict[k]}" goes beyond what you said.`;
    });
  }

  // School and courses, as they typed them.
  for (const s of arr(input.school).filter((x) => str(x.school))) {
    p.education.push({ school: clean(s.school), detail: clean(s.earned), dates: str(s.year), approved: false });
    for (const b of bases) { const base = p.bases.find((x) => x.id === b.id); if (base && !base.sections.some((x) => x.kind === "education")) base.sections.push({ kind: "education" }); }
    added.push({ kind: "school", title: clean(s.school) });
  }

  // A number behind a line: the line rewritten with it, taking the old line's place once approved.
  for (const x of arr(input.numbers).filter((x) => str(x.answer) && x.path)) {
    const [k, eid, bid] = String(x.path).split(".");
    const e = arr(p[k]).find((y) => y.id === eid), old = e && arr(e.bullets).find((b) => b.id === bid);
    if (!old) continue;
    const r = await rewriteWithAnswer(p, answers, { path: x.path, original: old.text, question: str(x.question), answer: str(x.answer), current: /present/i.test(e.dates || "") });
    if (r.error || !r.text) {
      // No rewording passed: their own line with their answer, word for word.
      const plain = `${clean(old.text)}, ${clean(x.answer).replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase())}`;
      if (!vet(plain, [old.text, x.answer], p, knownTerms(p, answers), old.text).ok || plain.length > 170) { rejected.push({ job: e.title, text: x.answer, why: [r.error || "no rewrite"] }); continue; }
      r.text = plain; r.warning = "Your line with your answer added as you typed it. Reword it if it reads awkwardly.";
    }
    r.text = clean(r.text);
    let n = 2; while (e.bullets.some((b) => b.id === `${bid}_v${n}`)) n++;
    const id = `${bid}_v${n}`;
    e.bullets.splice(e.bullets.indexOf(old), 0, { id, text: r.text, approved: false, source: `${old.text}. ${x.question} ${x.answer}`, replaces: bid, ...(r.warning ? { warning: r.warning } : {}) });
    for (const b of p.bases) for (const s of arr(b.sections)) for (const it of arr(s.items)) if (it.id === eid && arr(it.bullets).includes(bid)) it.bullets.splice(it.bullets.indexOf(bid), 0, id);
    added.push({ kind: "number", title: `${e.title}: ${r.text}` });
  }
  return JSON.parse(JSON.stringify({ profile: p, added, rejected }));
}
