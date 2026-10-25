// Loads the Apply Helper add-on's own scripts (profile checks, the one-page
// PDF, the tailoring prompt and plan checks) into a Node vm, the same way the
// add-on's tests do, and adds what an unattended run needs: the user's facts
// in the prompt, the truth rules, and a second-pass fact-check.
import fs from "node:fs";
import vm from "node:vm";
import { getAnswers, getPrefs, getProfile, getSecret, getSettings } from "./store.js";
import { autopilotRules, candidateFacts, fullName, homeLocation, standardAnswers } from "./facts.js";
import { truthGuard } from "./truth.js";

const VENDOR = new URL("../vendor/apply-helper/", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, VENDOR), "utf8");
// A model call that hangs must not hold an application forever: every request the add-on makes gets a deadline.
const fetchWithDeadline = (url, opts = {}) => fetch(url, { ...opts, signal: opts.signal || AbortSignal.timeout(Number(process.env.JA_AI_TIMEOUT_MS) || 180000) });
const ctx = vm.createContext({ console, setTimeout, TextEncoder, TextDecoder, Uint8Array, fetch: fetchWithDeadline, URL });
for (const f of ["lib/pdf-lib.min.js", "profile.js", "resume_pdf.js", "tailor.js"]) vm.runInContext(read(f), ctx, { filename: f });
export const { Tailor, Profile, ResumePDF } = ctx;

export const CONTENT_JS = read("icons.js") + "\n" + read("content.js");

const arr = (x) => (Array.isArray(x) ? x : []);
const ok = (x) => x && x.approved === true;

// Only what the user approved reaches a resume. Bases keep only approved pieces.
export function approvedOnly(p) {
  const out = JSON.parse(JSON.stringify(p || {}));
  out.summaries = arr(out.summaries).filter(ok);
  out.skills = arr(out.skills).filter(ok);
  out.headers = arr(out.headers).filter(ok);
  out.education = arr(out.education).filter(ok);
  for (const k of ["experience", "projects"]) {
    out[k] = arr(out[k]).map((e) => {
      const bullets = arr(e.bullets).filter(ok);
      const n = { ...e, bullets };
      if (e.minBullets) n.minBullets = Math.min(e.minBullets, bullets.length);
      if (e.pinned) n.pinned = arr(e.pinned).filter((id) => bullets.some((b) => b.id === id));
      return n;
    }).filter((e) => e.bullets.length);
  }
  const has = (list, id) => arr(list).some((x) => x.id === id);
  out.bases = arr(out.bases).filter(ok).map((b) => ({
    ...b,
    summary: has(out.summaries, b.summary) ? b.summary : (out.summaries[0] || {}).id,
    header: b.header && has(out.headers, b.header) ? b.header : null,
    skills: (() => { const s = arr(b.skills).filter((id) => has(out.skills, id)); return s.length ? s : out.skills.slice(0, 3).map((x) => x.id); })(),
    sections: arr(b.sections).map((s) => {
      if (s.kind === "education") return { kind: "education" };
      const pool = s.kind === "experience" ? out.experience : out.projects;
      const items = arr(s.items).map((it) => {
        const e = pool.find((x) => x.id === it.id);
        if (!e) return null;
        const bullets = arr(it.bullets).filter((id) => e.bullets.some((x) => x.id === id));
        return { ...it, bullets: bullets.length ? bullets : e.bullets.slice(0, e.minBullets || 2).map((x) => x.id) };
      }).filter(Boolean);
      return { ...s, items };
    }).filter((s) => s.kind === "education" ? out.education.length : s.items.length),
  }));
  return out;
}

// The profile the engine works from: approved pieces, plus the user's own contact facts and answers.
export function loadProfile(raw = getProfile(), a = getAnswers()) {
  if (!raw) throw new Error("No profile yet. Finish onboarding first.");
  const p = approvedOnly(raw);
  p.schema = Profile.SCHEMA;
  p.name = fullName(a) || p.name;
  p.contact = { ...(p.contact || {}), location: homeLocation(a) || (p.contact || {}).location, email: a.email || (p.contact || {}).email,
    phone: a.phone || (p.contact || {}).phone, linkedin: a.linkedin || "", github: a.github || "", website: a.website || "" };
  for (const k of Object.keys(p.contact)) if (!p.contact[k]) delete p.contact[k];
  p.answers = standardAnswers(a);
  p.cannotClaim = [...new Set([...arr(raw.cannotClaim), ...arr(a.cannotClaim)].filter(Boolean))];
  p.rules = raw.rules || Profile.EXAMPLE.rules;
  const errs = Profile.validate(p);
  if (errs.length) throw new Error("The profile has problems: " + errs.slice(0, 3).join(" ") + " Open Profile to fix them.");
  return p;
}

export const aiSettings = () => {
  const s = getSettings().ai;
  return { apiBase: s.apiBase || "https://openrouter.ai/api/v1", apiKey: getSecret("apiKey"), model: s.model || "z-ai/glm-5.3-flash" };
};

async function retry(fn, n = 3) {
  let last;
  for (let i = 0; i < n; i++) {
    try { return await fn(); } catch (e) { last = e; if (/Model API 4(0[0-3]|04)/.test(e.message)) break; await new Promise((r) => setTimeout(r, 4000 * (i + 1))); }
  }
  throw last;
}

export async function plan(profile, posting, a = getAnswers(), prefs = getPrefs()) {
  const msgs = Tailor.prompt(profile, posting);
  msgs[0].content += "\n\n" + autopilotRules(a, profile, prefs);
  return retry(() => Tailor.chat(aiSettings(), msgs));
}

// A cheap first look from the posting text alone, before a browser opens.
export async function screen(profile, job, description, a = getAnswers(), prefs = getPrefs()) {
  const f = candidateFacts(a, profile, prefs);
  const facts = {
    ...f,
    skills: arr(profile.skills).map((s) => `${s.label}: ${s.items}`),
    projects: arr(profile.projects).map((p) => p.title),
    targetTitles: prefs.titles,
  };
  const levels = arr(prefs.seniority).join(", ") || "any";
  const sys = `You screen job postings for one candidate and decide if they should apply. Their facts follow.
Say "apply" only when ALL hold:
- The role matches what they are looking for: one of their target titles or close to one (${JSON.stringify(prefs.titles || [])})${arr(prefs.keywords).length ? `, ideally involving ${JSON.stringify(prefs.keywords)}` : ""}.
- The level fits: they accept ${levels} roles, and the posting asks for at most ${f.maxYearsRequired} years of experience as a must-have (a range that starts at ${f.maxYearsRequired} or less is fine).
- They meet every must-have requirement, judged honestly from their facts. Must-haves on their cannot-claim list are fails. Preferred items do not matter.
${f.wantsInternships ? "" : "- It is not an internship or co-op.\n"}${f.graduation && !f.stillStudying ? `- It is not a program only for current students or for a graduating class after ${f.graduation}.\n` : ""}- It does not require a security clearance, license or degree their facts do not show.
- Work authorization: they ${f.authorizedToWork ? "are" : "are NOT"} authorized to work in ${f.authCountry} and ${f.needsSponsorship ? "NEED" : "do not need"} sponsorship. A posting that rules out candidates needing sponsorship is a fail if they need it.
Otherwise "skip". Return JSON only: {"decision": "apply|skip", "reason": "one short sentence", "level": "entry|mid|senior|unclear"}`;
  const user = `CANDIDATE FACTS\n${JSON.stringify(facts)}\n\nPOSTING: ${job.title} at ${job.company} (${job.location})\n${String(description || "").slice(0, 16000)}`;
  const r = await retry(() => Tailor.chat(aiSettings(), [{ role: "system", content: sys }, { role: "user", content: user }]));
  return { ok: r.decision === "apply", reason: String(r.reason || "").slice(0, 300), level: r.level };
}

export async function build(profile, p, fields, { a = getAnswers(), prefs = getPrefs(), jobLocal = false } = {}) {
  const { spec, extra, notes } = Tailor.checkPlan(profile, p);
  const r = await Tailor.fit(profile, spec, extra);
  const fileName = Tailor.fileName(profile, p);
  const kit = Tailor.kit(profile, p, fields, fileName);
  const facts = candidateFacts(a, profile, prefs);
  const audit = truthGuard(kit, fields, facts, a, { jobLocal });
  audit.push(...await reviewDrafts(profile, kit, facts));
  return { pdf: Buffer.from(r.pdf), slack: r.slack, overflow: r.overflow, fileName, kit, audit, warnings: notes.concat(r.warnings) };
}

// A second, fresh model call fact-checks every AI-written answer against the user's approved facts.
export async function reviewDrafts(profile, kit, facts) {
  const drafts = kit.filter((k) => k.kind === "draft" && k.value);
  if (!drafts.length) return [];
  const agentBuilt = arr(profile.projects).filter((p) => p.aiBuilt).map((p) => p.title);
  const years = Object.entries(facts.yearsByType || {}).map(([t, n]) => `${t}: ${n}`).join("; ") || "none listed";
  const sys = `You fact-check job application answers written for ${profile.name}. You see their complete approved facts.
For each answer, check every sentence:
- Every fact (employer, role, project, number, tool, feature, scope) must appear in the facts. Anything not there is false.
- Their years of experience, by type, are exactly: ${years}; all professional work: ${facts.totalYears}. Never imply more.
- They can never claim: ${JSON.stringify(facts.cannotClaim || [])}.
${agentBuilt.length ? `- These projects were built by AI coding agents they directed: ${JSON.stringify(agentBuilt)}. A sentence using a fact from
  one of them must say AI coding agents built it, in that same sentence, and must not say "I built/wrote/shipped/made" it.\n` : ""}- Claims about the employer are allowed only if they restate the posting.
If an answer is fully true, return it unchanged with "ok": true. Otherwise return "ok": false and a corrected answer
that keeps their voice and length and removes or fixes only what is wrong. If it cannot be fixed, return "answer": "".
Return JSON only: {"answers": [{"i": 0, "ok": true|false, "answer": "...", "problems": ["..."]}]}`;
  const user = `FACTS\n${JSON.stringify(Tailor.catalog(profile))}\n\nSTANDARD ANSWERS\n${arr(profile.answers).map((x) => `${x.label}: ${x.value}`).join("\n")}\n\nANSWERS TO CHECK\n` +
    drafts.map((d, i) => `${i}. Question: ${d.label}\nAnswer: ${d.value}`).join("\n\n");
  let r;
  try { r = await retry(() => Tailor.chat(aiSettings(), [{ role: "system", content: sys }, { role: "user", content: user }]), 2); }
  catch (e) {
    for (const d of drafts) { d.kind = "decide"; d.value = ""; d.note = "fact-check failed, so the AI answer was not used"; }
    return [`fact-check unavailable (${e.message}); AI-written answers were withheld`];
  }
  const notes = [];
  const seen = new Set();
  for (const x of (r && r.answers) || []) {
    const d = drafts[x.i];
    if (!d) continue;
    seen.add(x.i);
    if (x.ok) continue;
    const fixed = String(x.answer || "").trim();
    const issues = fixed ? Profile.textIssues(fixed, profile) : ["empty"];
    notes.push(`fact-check on "${d.label.slice(0, 70)}": ${arr(x.problems).join("; ").slice(0, 300)}`);
    if (fixed && !issues.length) { d.value = fixed; d.note = "corrected by the fact-check"; }
    else { d.kind = "decide"; d.value = ""; d.note = "the fact-check could not make this answer true"; }
  }
  // An answer the checker skipped was not checked, so it is not used.
  drafts.forEach((d, i) => {
    if (!seen.has(i)) { d.kind = "decide"; d.value = ""; d.note = "the fact-check did not confirm this answer"; notes.push(`fact-check skipped "${d.label.slice(0, 70)}"; withheld`); }
  });
  return notes;
}

// Settings > AI: one tiny call proves the key, base URL and model work.
export async function testAI({ apiBase, apiKey, model }) {
  const r = await Tailor.chat({ apiBase, apiKey, model }, [{ role: "user", content: 'Reply with the JSON {"ok": true}.' }]);
  return !!(r && r.ok);
}

export async function listModels({ apiBase, apiKey }) {
  const res = await fetch(String(apiBase || "").replace(/\/+$/, "") + "/models", { headers: apiKey ? { authorization: "Bearer " + apiKey } : {}, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`models list: ${res.status}`);
  const data = await res.json();
  return arr(data.data).map((m) => ({ id: m.id, name: m.name || m.id, prompt: m.pricing && m.pricing.prompt, completion: m.pricing && m.pricing.completion }))
    .sort((x, y) => x.id.localeCompare(y.id));
}
