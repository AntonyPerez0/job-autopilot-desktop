// Questions only the user can answer. When an application stops on a required question the app
// had no true answer for, the user answers it in the app; the answer is kept (for this job, or for
// every application that asks the same thing) and the job goes back in the queue.
import { getAnswers, saveAnswers } from "./store.js";

const arr = (x) => (Array.isArray(x) ? x : []);
// "How many years of experience do you have?*" and "How many years of experience do you have? (optional)" are one question,
// and so is the same question with its yes/no buttons or its list's choices read into the label.
export const labelKey = (s) => String(s || "").toLowerCase().replace(/:\s*(yes\s*no|no\s*yes)\s*$/, "").replace(/\s+select\s*\.\.\..*$/, "")
  .replace(/\(optional\)|\(required\)|\*|\u2731/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

// Questions every form asks the same way, whatever its wording: an answer to one is the person's answer to all of them,
// kept with their other answers (About you) so every form gets it, and the AI sees it too.
const STANDARD = [
  ["zip", /^(zip|postal|post|postcode)( (postal|zip))?( code)?$/],
  ["street", /^(street|home|mailing|residential|current|permanent)? ?address( line)?( 1| one)?$|^street( address)?$/],
  ["county", /^(county|county of residence)$/],
  ["citizen", /^are you an? (u ?s |united states |american )?citizen( of the united states)?$/],
];
export const standardKey = (label) => { const k = labelKey(label); const hit = STANDARD.find(([, rx]) => rx.test(k)); return hit ? hit[0] : null; };
const yn = (v) => (/^\s*yes\b/i.test(v) ? "yes" : /^\s*no\b/i.test(v) ? "no" : "");

// The person's answers to those questions, as About you answers. Returns what changed ({} when nothing did).
export function standardFrom(list, a = getAnswers()) {
  const out = {};
  for (const x of arr(list)) {
    const k = standardKey(x.label), v = String(x.value || "").trim();
    if (!k || !v) continue;
    if (k === "citizen") { if (yn(v)) out.citizen = yn(v); continue; }
    // "4141 Main St, Fremont, CA 94538" typed into a street box: the street part.
    if (k === "street" && a.city && v.toLowerCase().includes(String(a.city).toLowerCase()) && v.includes(",")) out.street = v.split(",")[0].trim();
    else out[k] = v;
  }
  for (const k of Object.keys(out)) if (String(a[k] || "") === out[k]) delete out[k];
  return out;
}

// Answers given before this version, kept only under the wording of one form ("ZIP *"), become About you answers
// when About you doesn't have them yet.
export function promoteYourAnswers() {
  const a = getAnswers();
  const found = standardFrom(arr(a.yourAnswers).filter((x) => x.scope === "all"), a);
  const add = Object.fromEntries(Object.entries(found).filter(([k]) => !String(a[k] || "").trim()));
  if (Object.keys(add).length) saveAnswers(add);
  return add;
}

const KINDS = "required, no answer|needs you|still empty";
const SECRET_RX = /pass ?word|passcode|\bpin\b|social security|\bssn\b|\bsin\b|bank account|routing number|account number|credit card|card number|\bcvv\b|passport (number|no)|tax (id|number)|\bitin\b/i;
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
    // Never asked for, never kept: a password, or a number that is a secret. The person types it on the form itself.
    if (SECRET_RX.test(label)) { out.push({ label, note: "", options: [], required: true, long: false, secret: true }); continue; }
    // A file the app couldn't attach is not a question to type an answer to.
    if ((f && f.type === "file") || (!f && /^(resume|cv|cover letter|attach|upload)\b/i.test(label) && fields.some((x) => x.type === "file"))) {
      out.push({ label, note: "", options: [], required: true, long: false, file: true });
      continue;
    }
    // The choices read from the page when it stopped, else the ones read when the form was opened.
    const seenOpts = arr((details.askOptions || {})[nkey(label)]);
    const options = (seenOpts.length > 1 ? seenOpts : arr(f && f.options)).map(String).filter((o) => o && !/^(select|choose|please select)\b/i.test(o));
    const choice = options.length > 1 || !!(f && /select|combo|listbox|radio/.test(f.type || ""));
    // The AI's advice to "add it to the profile's standard answers" is what answering here does.
    note = note.replace(/[;,.]?\s*(confirm (it )?and )?add [^.;]*(standard answers|the profile)[^.;]*[.;]?/gi, "").replace(/\s*—\s*$/, "").trim();
    const std = standardKey(label);
    if (std) note = `${note ? note.replace(/\.?$/, ". ") : ""}Answer once: it's kept under About you and goes into every form that asks.`;
    out.push({ label, note, options: options.length > 1 ? options : [], required: true, choice, ...(std ? { standard: std } : {}),
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
  // A ZIP code, a street address, a county, whether they're a citizen: the same for every form.
  const std = standardFrom(arr(answers).filter((x) => x.remember || standardKey(x.label) !== "citizen"));
  if (Object.keys(std).length) saveAnswers(std);
  return n;
}

export function removeYourAnswer(key, scope) {
  saveAnswers({ yourAnswers: arr(getAnswers().yourAnswers).filter((x) => !(x.key === key && (!scope || x.scope === scope))) });
}

// Put the user's own answers into a page's kit, over anything the AI or the checks decided: the
// question is theirs and so is the answer. A job-only answer wins over one kept for every application.
const onk = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Is the answer one of the field's own choices (or close to one)? A field with no choices takes anything.
export function fitsChoices(value, options) {
  const opts = arr(options).filter((o) => o && !/^(select|choose|please select)\b/i.test(o));
  if (opts.length < 2) return true;
  const v = onk(value);
  return opts.some((o) => { const n = onk(o); return n === v || (v.length > 2 && (n.startsWith(v + " ") || v.startsWith(n + " "))); });
}

export function applyYourAnswers(kit, fields, mine) {
  const notes = [];
  const byKey = new Map();
  for (const x of [...mine].sort((p, q) => (p.scope === "all") - (q.scope === "all"))) if (!byKey.has(x.key)) byKey.set(x.key, x);
  for (const f of arr(fields)) {
    const x = byKey.get(labelKey(f.label));
    if (!x) continue;
    // "LinkedIn" kept for "How did you hear about us?" doesn't fit a form whose choices are "Online Job Board",
    // "Social Media"...: the answer worked out for this form stays.
    if (!fitsChoices(x.value, f.options)) {
      notes.push(`your answer "${String(x.value).slice(0, 40)}" isn't one of the choices for "${f.label.slice(0, 60)}", so it wasn't used there`);
      byKey.delete(x.key);
      continue;
    }
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
