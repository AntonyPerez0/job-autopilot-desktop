// Questions only the user can answer. When an application stops on a required question the app
// had no true answer for, the user answers it in the app; the answer is kept (for this job, or for
// every application that asks the same thing) and the job goes back in the queue.
import { getAnswers, saveAnswers } from "./store.js";

const arr = (x) => (Array.isArray(x) ? x : []);
// "How many years of experience do you have?*" and "How many years of experience do you have? (optional)" are one question.
export const labelKey = (s) => String(s || "").toLowerCase().replace(/\(optional\)|\*/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

const KINDS = "required, no answer|needs you|still empty";
const nkey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ITEM = new RegExp(`(${KINDS}): ([\\s\\S]*?)(?=; (?:${KINDS}): |$)`, "g");

// What the job is waiting on, from why it stopped and what the app saw on the form:
// [{ label, note, options, long, required }]
export function asksFor(job, details = {}) {
  const reason = String(job.reason || "");
  if (job.status !== "failed" || !/could not fill every required field/.test(reason)) return [];
  const body = reason.replace(/^could not fill every required field( \(page \d+\))?: /, "");
  const report = details.report || {};
  const known = [...arr(report.decide), ...arr(report.missing)];
  const fields = arr(details.fields);
  const out = [], seen = new Set();
  for (const m of body.matchAll(ITEM)) {
    let text = m[2].trim(), label = text, note = "";
    // "needs you: <label> (<why>)": the label is the one the form report knows, the rest is the note.
    const hit = known.find((x) => x.label && text.startsWith(x.label));
    if (hit) { label = hit.label; note = hit.note || text.slice(hit.label.length).trim().replace(/^\(|\)$/g, ""); }
    else if (m[1] === "needs you" && / \(/.test(text)) { label = text.slice(0, text.indexOf(" (")); note = text.slice(text.indexOf(" (") + 2).replace(/\)$/, ""); }
    const key = labelKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // The field it is, even when the wording differs a little ("Work authorization *" / "Work authorization").
    const f = fields.find((x) => labelKey(x.label) === key) ||
      (key.length >= 8 ? fields.find((x) => { const k = labelKey(x.label); return k.length >= 8 && (k.startsWith(key) || key.startsWith(k)); }) : null);
    // A file the app couldn't attach is not a question to type an answer to.
    if ((f && f.type === "file") || (!f && /^(resume|cv|cover letter|attach|upload)\b/i.test(label) && fields.some((x) => x.type === "file"))) {
      out.push({ label, note: "", options: [], required: true, long: false, file: true });
      continue;
    }
    // The choices read from the page when it stopped, else the ones read when the form was opened.
    const seenOpts = arr((details.askOptions || {})[nkey(label)]);
    const options = (seenOpts.length > 1 ? seenOpts : arr(f && f.options)).map(String).filter((o) => o && !/^(select|choose|please select)\b/i.test(o));
    const choice = options.length > 1 || !!(f && /select|combo|listbox|radio/.test(f.type || ""));
    out.push({ label, note, options: options.length > 1 ? options : [], required: true, choice,
      long: !options.length && !choice && (f ? f.type === "textarea" : /describe|explain|tell us|why do you|cover letter/i.test(label)) });
  }
  return out;
}

// The user's answers that apply to this job.
export function yourAnswersFor(job, a = getAnswers()) {
  return arr(a.yourAnswers).filter((x) => x.scope === "all" || x.scope === job.slug);
}

// Save answers: [{ label, value, remember }]; remember = for every application, otherwise this job only.
export function saveYourAnswers(job, answers) {
  const list = arr(getAnswers().yourAnswers).slice();
  let n = 0;
  for (const x of arr(answers)) {
    const value = String(x.value ?? "").trim(), key = labelKey(x.label);
    if (!value || !key) continue;
    const scope = x.remember ? "all" : job.slug;
    const i = list.findIndex((y) => y.key === key && (y.scope === scope || (scope === "all" && y.scope === job.slug)));
    const entry = { key, label: String(x.label).slice(0, 300), value: value.slice(0, 4000), scope, company: job.company || "", at: new Date().toISOString() };
    if (i >= 0) list[i] = entry; else list.push(entry);
    n++;
  }
  saveAnswers({ yourAnswers: list });
  return n;
}

export function removeYourAnswer(key, scope) {
  saveAnswers({ yourAnswers: arr(getAnswers().yourAnswers).filter((x) => !(x.key === key && (!scope || x.scope === scope))) });
}

// Put the user's own answers into a page's kit, over anything the AI or the checks decided: the
// question is theirs and so is the answer. A job-only answer wins over one kept for every application.
export function applyYourAnswers(kit, fields, mine) {
  const notes = [];
  const byKey = new Map();
  for (const x of [...mine].sort((p, q) => (p.scope === "all") - (q.scope === "all"))) if (!byKey.has(x.key)) byKey.set(x.key, x);
  for (const f of arr(fields)) {
    const x = byKey.get(labelKey(f.label));
    if (!x) continue;
    const items = kit.filter((k) => labelKey(k.label) === x.key);
    if (items.length) for (const k of items) Object.assign(k, { kind: "text", value: x.value, note: "your answer" });
    else kit.push({ label: f.label, value: x.value, kind: "text", note: "your answer" });
    notes.push(`your answer used for "${f.label.slice(0, 70)}"`);
    byKey.delete(x.key);
  }
  // Questions the scrape lists differently (button groups, type-to-search boxes) are matched by label when filling.
  for (const x of byKey.values()) if (!kit.some((k) => labelKey(k.label) === x.key)) kit.push({ label: x.label, value: x.value, kind: "text", note: "your answer" });
  return notes;
}
