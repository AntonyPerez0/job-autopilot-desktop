// Uploaded resumes (PDF or DOCX) -> text -> a profile (the add-on's
// profileFromText), several resumes merged into one, every piece unapproved
// until the user approves it on the review screen.
import path from "node:path";
import { Tailor, aiSettings } from "./engine.js";
import { fmtRange } from "./dates.js";

export async function resumeText(name, bytes) {
  const ext = path.extname(String(name)).toLowerCase();
  const data = new Uint8Array(bytes);
  if (ext === ".pdf") {
    // unpdf ships a build of pdf.js with no native parts, so it runs inside Electron.
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(data);
    const { text } = await extractText(doc, { mergePages: false });
    return [].concat(text).join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  if (ext === ".docx") {
    const mammoth = (await import("mammoth")).default;
    const r = await mammoth.extractRawText({ buffer: Buffer.from(data) });
    return r.value.trim();
  }
  if (ext === ".txt" || ext === ".md") return Buffer.from(data).toString("utf8");
  throw new Error(`${name}: only PDF and DOCX resumes can be read (save a .doc as .docx first)`);
}

const arr = (x) => (Array.isArray(x) ? x : []);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function freeId(id, taken) {
  let base = String(id || "item").replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "item", n = 2, out = base;
  while (taken.has(out)) out = `${base}-${n++}`;
  taken.add(out);
  return out;
}

// Fold profile `b` into `a`: same job (org + title) or project (title) joins bullets, same skills label joins items.
export function mergeProfiles(a, b) {
  const out = JSON.parse(JSON.stringify(a));
  // Only projects so far (from GitHub): the resume brings the name and contact details.
  if (!a.name || /^your name$/i.test(a.name)) { out.name = b.name || out.name; out.contact = { ...(b.contact || {}), ...(a.contact || {}) }; }
  const map = { summaries: {}, headers: {}, skills: {}, experience: {}, projects: {}, bullets: {} };
  for (const k of ["summaries", "headers"]) {
    const taken = new Set(arr(out[k]).map((x) => x.id));
    out[k] = arr(out[k]);
    for (const x of arr(b[k])) {
      const same = out[k].find((y) => norm(y.text) === norm(x.text));
      if (same) { map[k][x.id] = same.id; continue; }
      const id = freeId(x.id, taken);
      map[k][x.id] = id;
      out[k].push({ ...x, id });
    }
  }
  {
    const taken = new Set(arr(out.skills).map((x) => x.id));
    out.skills = arr(out.skills);
    for (const s of arr(b.skills)) {
      const same = out.skills.find((y) => norm(y.label) === norm(s.label));
      if (same) {
        const items = String(same.items || "").split(/,\s*/).filter(Boolean);
        for (const it of String(s.items || "").split(/,\s*/)) if (it && !items.some((x) => norm(x) === norm(it))) items.push(it);
        same.items = items.join(", ");
        map.skills[s.id] = same.id;
      } else { const id = freeId(s.id, taken); map.skills[s.id] = id; out.skills.push({ ...s, id }); }
    }
  }
  for (const k of ["experience", "projects"]) {
    const taken = new Set(arr(out[k]).map((x) => x.id));
    out[k] = arr(out[k]);
    for (const e of arr(b[k])) {
      const same = out[k].find((y) => (k === "experience" ? norm(y.org) === norm(e.org) && norm(y.title) === norm(e.title) : norm(y.title) === norm(e.title)));
      const target = same || (() => { const n = { ...e, id: freeId(e.id, taken), bullets: [] }; out[k].push(n); return n; })();
      map[k][e.id] = target.id;
      const bt = new Set(arr(target.bullets).map((x) => x.id));
      target.bullets = arr(target.bullets);
      map.bullets[e.id] = {};
      for (const bl of arr(e.bullets)) {
        const dup = target.bullets.find((x) => norm(x.text) === norm(bl.text));
        if (dup) { map.bullets[e.id][bl.id] = dup.id; continue; }
        const id = freeId(bl.id, bt);
        map.bullets[e.id][bl.id] = id;
        target.bullets.push({ ...bl, id });
      }
    }
  }
  out.education = arr(out.education);
  for (const ed of arr(b.education)) if (!out.education.some((x) => norm(x.school) === norm(ed.school) && norm(x.detail) === norm(ed.detail))) out.education.push(ed);
  const bt = new Set(arr(out.bases).map((x) => x.id));
  out.bases = arr(out.bases);
  for (const base of arr(b.bases)) {
    out.bases.push({
      ...base, id: freeId(base.id, bt),
      summary: map.summaries[base.summary] || base.summary,
      header: base.header ? map.headers[base.header] || null : null,
      skills: arr(base.skills).map((s) => map.skills[s] || s),
      sections: arr(base.sections).map((s) => (s.kind === "education" ? s : {
        ...s, items: arr(s.items).map((it) => ({ ...it, id: map[s.kind][it.id] || it.id, bullets: arr(it.bullets).map((x) => (map.bullets[it.id] || {})[x] || x) })),
      })),
    });
  }
  out.cannotClaim = [...new Set([...arr(a.cannotClaim), ...arr(b.cannotClaim)])];
  return out;
}

// Mark every piece unapproved: the user approves each one on the review screen.
export function unapproved(p) {
  const out = JSON.parse(JSON.stringify(p));
  for (const k of ["summaries", "headers", "skills", "education", "bases"]) for (const x of arr(out[k])) x.approved = false;
  for (const k of ["experience", "projects"]) for (const e of arr(out[k])) for (const b of arr(e.bullets)) b.approved = false;
  return out;
}

// Turn uploaded files into one profile. files: [{ name, bytes }]
export async function importResumes(files, onStep = () => {}, settings = aiSettings()) {
  let merged = null;
  const texts = [];
  for (const [i, f] of files.entries()) {
    onStep(`Reading ${f.name}`);
    const text = await resumeText(f.name, f.bytes);
    if (text.length < 200) throw new Error(`${f.name}: almost no text could be read (a scanned image?). Export it from Word or Google Docs as a PDF or DOCX and try again.`);
    texts.push(text);
    onStep(`Turning ${f.name} into a profile (${i + 1} of ${files.length})`);
    const p = await Tailor.profileFromText(settings, text);
    merged = merged ? mergeProfiles(merged, p) : p;
  }
  // The "own voice" paragraph is for words the person wrote themselves; the AI copies the example's and invents one.
  if (merged) delete merged.essaySample;
  // Dates one way ("Jun 2021 – Present"), whatever style the uploaded resume used.
  if (merged) for (const k of ["experience", "projects"]) for (const e of merged[k] || []) if (e.dates) e.dates = fmtRange(e.dates);
  return { profile: unapproved(merged), texts };
}
