// Housekeeping, once at each start, so the app's folder doesn't grow for ever:
// - activity older than 90 days goes (an application that was sent keeps its own);
// - a job left out over 30 days ago loses the posting's text, its screenshots and the resume made for it; one that
//   stopped, was left to the person or was only practice loses its screenshots and resume after 120 days;
// - resume previews older than a day go.
// What was sent is never touched: every sent application keeps its answers, its resume and its screenshots.
import fs from "node:fs";
import path from "node:path";
import { getDb, log } from "./db.js";
import { dataDir } from "./store.js";

const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SHOT_TAGS = "filled(-p\\d+)?|after|stopped|account|botcheck|signin|noform|refused|stuck-p\\d+";

export function tidy() {
  const db = getDb();
  const out = { events: 0, files: 0, postings: 0 };
  out.events = db.prepare(`DELETE FROM events WHERE at < datetime('now', '-90 days')
    AND (slug IS NULL OR slug NOT IN (SELECT slug FROM jobs WHERE status IN ('applied', 'submitting') OR applied_at IS NOT NULL))`).run().changes;
  const shots = dataDir("shots"), resumes = dataDir("resumes");
  const shotFiles = fs.readdirSync(shots);
  const rm = (dir, name) => { try { fs.rmSync(path.join(dir, name)); out.files++; } catch { /* already gone */ } };
  const old = db.prepare(`SELECT slug, status, details, resume_file, screenshot FROM jobs WHERE applied_at IS NULL AND
    ((status = 'skipped' AND updated_at < datetime('now', '-30 days')) OR (status IN ('failed', 'manual', 'filled') AND updated_at < datetime('now', '-120 days')))
    AND (resume_file IS NOT NULL OR screenshot IS NOT NULL OR (status = 'skipped' AND details LIKE '%"description"%'))`).all();
  const upd = db.prepare("UPDATE jobs SET resume_file = NULL, screenshot = NULL, details = ? WHERE slug = ?");
  for (const j of old) {
    let d = {}; try { d = JSON.parse(j.details || "{}") || {}; } catch { /* none */ }
    const safe = safeName(j.slug), mine = new RegExp(`^${esc(safe)}-(${SHOT_TAGS})\\.jpg$`);
    for (const f of shotFiles) if (mine.test(f)) rm(shots, f);
    if (j.resume_file) rm(resumes, path.basename(j.resume_file));
    if (d.resume && d.resume.fileName) rm(resumes, `${safe}-${path.basename(String(d.resume.fileName))}`);
    if (j.status === "skipped" && d.description) { delete d.description; out.postings++; }
    upd.run(JSON.stringify(d), j.slug);
  }
  for (const f of fs.readdirSync(resumes)) {
    if (!/^preview-.*\.pdf$/.test(f)) continue;
    try { if (Date.now() - fs.statSync(path.join(resumes, f)).mtimeMs > 86400000) rm(resumes, f); } catch { /* gone */ }
  }
  if (out.events || out.files || out.postings) log(null, `tidied up: ${out.events} old activity lines, ${out.files} old files, the text of ${out.postings} old postings`);
  return out;
}
