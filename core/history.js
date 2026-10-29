// The application history: every job applied to (or that may have gone through),
// kept as a small gzipped file outside the app (Documents/Job Autopilot by
// default) so it survives a reinstall, and can be carried to a new computer.
// Importing it means none of those jobs is ever applied to again.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { getDb, log, onJobStatus } from "./db.js";
import { getPrefs, getSettings, savePrefs } from "./store.js";
import { jobKey } from "./dedupe.js";

export const FORMAT = "job-autopilot/history@1";
export const FILE_NAME = "applied-jobs.json.gz";

let defaultDir = null;
export const setDefaultBackupDir = (d) => { defaultDir = d; };
export const backupDir = () => process.env.JA_BACKUP_DIR || getSettings().historyFolder || defaultDir;
export const backupFile = () => (backupDir() ? path.join(backupDir(), FILE_NAME) : null);

// Only what never-apply-twice needs: no answers, resumes or screenshots.
export function collect() {
  const rows = getDb().prepare(`SELECT slug, company, title, location, url, apply_url, applied_at, status, reason, updated_at FROM jobs
    WHERE status IN ('applied', 'submitting') OR (status = 'failed' AND reason LIKE '%may have gone through%') ORDER BY COALESCE(applied_at, updated_at)`).all();
  return rows.map((r) => {
    const j = { s: r.slug, c: r.company, t: r.title, at: r.applied_at || r.updated_at };
    if (r.location) j.l = r.location;
    if (r.url) j.u = r.url;
    if (r.apply_url && r.apply_url !== r.url) j.a = r.apply_url;
    if (r.status !== "applied") j.maybe = 1;
    return j;
  });
}

export function exportHistory(appVersion = "") {
  const doc = { format: FORMAT, exportedAt: new Date().toISOString(), appVersion, jobs: collect(), alreadyApplied: getPrefs().alreadyApplied || "" };
  return zlib.gzipSync(Buffer.from(JSON.stringify(doc)), { level: 9 });
}

export function parseHistory(buf) {
  let b = Buffer.from(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) b = zlib.gunzipSync(b);
  let doc;
  try { doc = JSON.parse(b.toString("utf8")); } catch { throw new Error("This is not a Job Autopilot history file."); }
  if (!doc || doc.format !== FORMAT || !Array.isArray(doc.jobs)) throw new Error("This is not a Job Autopilot history file.");
  return doc;
}

// Merge a history into this computer's jobs. A job already here as queued, skipped or filled
// becomes applied; nothing already applied changes.
// When it was applied to, as an ISO instant, or null: a date that can't be read ("now") or lies in the future
// would otherwise count toward today's limit forever. SQLite's own "YYYY-MM-DD HH:MM:SS" is UTC.
export function isoAt(x) {
  const s = String(x || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(s)) return null;
  const t = Date.parse(/[ T]\d/.test(s) && !/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s.replace(" ", "T") + "Z" : s);
  return Number.isFinite(t) && t <= Date.now() + 5 * 60000 ? new Date(t).toISOString() : null;
}

export function importHistory(buf) {
  const doc = parseHistory(buf);
  const db = getDb();
  const get = db.prepare("SELECT status FROM jobs WHERE slug = ?");
  const ins = db.prepare(`INSERT INTO jobs (slug, key, title, company, location, url, apply_url, status, reason, applied_at, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`);
  const upd = db.prepare("UPDATE jobs SET status = ?, reason = ?, applied_at = ?, updated_at = datetime('now') WHERE slug = ?");
  let added = 0, updated = 0, already = 0;
  db.exec("BEGIN");
  try {
    for (const j of doc.jobs) {
      if (!j || !j.s || !j.c || !j.t) continue;
      const status = j.maybe ? "failed" : "applied";
      const reason = j.maybe ? "imported: it may have gone through on your other computer. Check your email before using Try again." : "applied (imported from your history)";
      const cur = get.get(j.s);
      if (!cur) { ins.run(j.s, jobKey(j.c, j.t), j.t, j.c, j.l || "", j.u || "", j.a || j.u || "", status, reason, isoAt(j.at)); added++; }
      else if (cur.status === "applied" || cur.status === "submitting" || (cur.status === "failed" && j.maybe)) already++;
      else { upd.run(status, reason, isoAt(j.at), j.s); updated++; }
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  // The hand-made "already applied elsewhere" list comes along too.
  const mine = getPrefs().alreadyApplied || "";
  const lines = new Set(mine.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
  const extra = String(doc.alreadyApplied || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !lines.has(l));
  if (extra.length) savePrefs({ alreadyApplied: [mine.trim(), ...extra].filter(Boolean).join("\n") });
  log(null, `imported application history: ${added} added, ${updated} marked applied, ${already} already here`);
  return { added, updated, already, total: doc.jobs.length, exportedAt: doc.exportedAt };
}

// What a backup holds, without importing it (for the first-run screen).
export function peekBackup(file = backupFile()) {
  try {
    if (!file || !fs.existsSync(file)) return null;
    const doc = parseHistory(fs.readFileSync(file));
    return { file, count: doc.jobs.length, exportedAt: doc.exportedAt };
  } catch { return null; }
}

// Write the backup: temp file then rename, keeping the previous copy as .bak.
export function writeBackup(appVersion = "") {
  const file = backupFile();
  if (!file || getSettings().historyBackup === false) return null;
  // The backup only ever grows: jobs it already holds stay, even ones this computer never saw
  // (a reinstall that applied somewhere before importing must not shrink it).
  let old = null;
  try { if (fs.existsSync(file)) old = parseHistory(fs.readFileSync(file)); } catch { /* unreadable: replaced, the .bak keeps it */ }
  const doc = JSON.parse(zlib.gunzipSync(exportHistory(appVersion)).toString("utf8"));
  if (old) {
    const here = new Set(doc.jobs.map((j) => j.s));
    doc.jobs = [...old.jobs.filter((j) => j && j.s && !here.has(j.s)), ...doc.jobs];
    const lines = new Set(String(doc.alreadyApplied).split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    for (const l of String(old.alreadyApplied || "").split(/\r?\n/).map((x) => x.trim())) if (l) lines.add(l);
    doc.alreadyApplied = [...lines].join("\n");
  }
  if (!doc.jobs.length && !doc.alreadyApplied) return null;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(doc)), { level: 9 }));
  if (fs.existsSync(file)) fs.copyFileSync(file, file + ".bak");
  fs.renameSync(tmp, file);
  return file;
}

// Keep the backup current: rewritten a few seconds after any job is applied to.
export function startBackups(appVersion = "") {
  let t = null;
  const soon = () => { clearTimeout(t); t = setTimeout(() => { try { writeBackup(appVersion); } catch (e) { log(null, "history backup failed: " + e.message, "warn"); } }, 3000); };
  onJobStatus((slug, status) => { if (["applied", "submitting", "failed"].includes(status)) soon(); });
  soon();
}
