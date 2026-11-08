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
-- Replies from employers, found in the connected mailbox: kept on this computer only.
CREATE TABLE IF NOT EXISTS replies (
  id TEXT PRIMARY KEY,      -- the email's Message-ID
  slug TEXT, at TEXT, sender TEXT, subject TEXT,
  kind TEXT,                -- offer | interview | assessment | info | rejection | other
  snippet TEXT, seen INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS replies_slug ON replies(slug);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT DEFAULT (datetime('now')),
  slug TEXT, level TEXT, message TEXT
);
`);
  // Columns added since, for databases made before them:
  //   real: the person asked to send this one for real, even in practice mode
  //   hold_until: they know someone there; the app waits (SQLite time) so they can ask for a referral first
  //   stage: where an application stands, set by the person (interviewing | offer | rejected | withdrew)
  //   followed_up_at: when they followed up on it ("no": they chose not to)
  for (const [col, type] of [["real", "INTEGER DEFAULT 0"], ["hold_until", "TEXT"], ["stage", "TEXT"], ["followed_up_at", "TEXT"]]) {
    if (!db.prepare("SELECT 1 FROM pragma_table_info('jobs') WHERE name = ?").get(col)) db.exec(`ALTER TABLE jobs ADD COLUMN ${col} ${type}`);
  }
  return db;
}

// A time as SQLite writes its own (datetime('now')): "2026-11-08 14:05:00", so the two compare as text.
export const sqlTime = (d = new Date()) => new Date(d).toISOString().replace("T", " ").slice(0, 19);
export const getDb = () => db || openDb();

export function log(slug, message, level = "info") {
  console.log(`[${new Date().toISOString()}] ${level} ${slug || "-"} ${message}`);
  getDb().prepare("INSERT INTO events (slug, level, message) VALUES (?, ?, ?)").run(slug || null, level, String(message).slice(0, 2000));
}

// Told about every status change, so the application history backup stays current.
const listeners = [];
export const onJobStatus = (fn) => listeners.push(fn);

export function setJob(slug, fields) {
  const keys = Object.keys(fields);
  const sql = `UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE slug = ?`;
  getDb().prepare(sql).run(...keys.map((k) => (fields[k] !== null && typeof fields[k] === "object" ? JSON.stringify(fields[k]) : fields[k])), slug);
  if ("status" in fields) for (const fn of listeners) { try { fn(slug, fields.status); } catch { /* a backup problem never stops the autopilot */ } }
}

export const getJob = (slug) => getDb().prepare("SELECT * FROM jobs WHERE slug = ?").get(slug);

const startHour = () => Math.max(0, Math.min(23, Number(getSettings().dayStartsAtHour) || 0));

// An application "day" runs from dayStartsAtHour to the same hour the next day (local time). Every row with a
// submit time today counts: applied, mid-submit, or pressed without a confirmation ("may have gone through").
export function appliedToday() {
  const shift = `-${startHour()} hours`;
  return getDb().prepare("SELECT COUNT(*) n FROM jobs WHERE applied_at IS NOT NULL AND applied_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' AND date(applied_at, 'localtime', ?) = date('now', 'localtime', ?)").get(shift, shift).n;
}

// When the current application day ends, as a timestamp.
export function nextDayStart(now = new Date()) {
  const t = new Date(now);
  t.setHours(startHour(), 0, 0, 0);
  if (t <= now) t.setDate(t.getDate() + 1);
  return t.getTime();
}
