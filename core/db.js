// Jobs and activity, in SQLite. node:sqlite is built into Electron's Node, so
// there is no native module to rebuild per platform.
import { DatabaseSync } from "node:sqlite";
import { dataDir, getSettings } from "./store.js";

let db;
export function openDb(file = dataDir("autopilot.db")) {
  db = new DatabaseSync(file);
  db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS jobs (
  slug TEXT PRIMARY KEY,
  key TEXT,                 -- employer + title, to catch the same role on two boards
  title TEXT, company TEXT, location TEXT, work_mode TEXT, source TEXT,
  url TEXT, apply_url TEXT, salary TEXT, posted_at TEXT,
  found_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'queued', -- queued | working | submitting | applied | filled (dry run) | skipped | failed
  reason TEXT,
  attempts INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  applied_at TEXT,
  reviewed INTEGER DEFAULT 0,  -- the user checked this filled application
  resume_file TEXT, screenshot TEXT,
  details TEXT              -- JSON: plan summary, answers, report
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT DEFAULT (datetime('now')),
  slug TEXT, level TEXT, message TEXT
);
`);
  return db;
}
export const getDb = () => db || openDb();

export function log(slug, message, level = "info") {
  console.log(`[${new Date().toISOString()}] ${level} ${slug || "-"} ${message}`);
  getDb().prepare("INSERT INTO events (slug, level, message) VALUES (?, ?, ?)").run(slug || null, level, String(message).slice(0, 2000));
}

export function setJob(slug, fields) {
  const keys = Object.keys(fields);
  const sql = `UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE slug = ?`;
  getDb().prepare(sql).run(...keys.map((k) => (fields[k] !== null && typeof fields[k] === "object" ? JSON.stringify(fields[k]) : fields[k])), slug);
}

export const getJob = (slug) => getDb().prepare("SELECT * FROM jobs WHERE slug = ?").get(slug);

const startHour = () => Math.max(0, Math.min(23, Number(getSettings().dayStartsAtHour) || 0));

// An application "day" runs from dayStartsAtHour to the same hour the next day (local time).
export function appliedToday() {
  const shift = `-${startHour()} hours`;
  return getDb().prepare("SELECT COUNT(*) n FROM jobs WHERE status IN ('applied', 'submitting') AND date(applied_at, 'localtime', ?) = date('now', 'localtime', ?)").get(shift, shift).n;
}

// When the current application day ends, as a timestamp.
export function nextDayStart(now = new Date()) {
  const t = new Date(now);
  t.setHours(startHour(), 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t.getTime();
}
