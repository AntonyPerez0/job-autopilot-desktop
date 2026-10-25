// Application history: small on disk, survives a reinstall, moves to a new computer,
// and once imported the same jobs are never applied to again.
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-backup-"));
process.env.JA_BACKUP_DIR = backupDir;
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const db = await import("../core/db.js");
const h = await import("../core/history.js");
const { sameUrlAs, sameRoleAs } = await import("../core/dedupe.js");

const add = (d, slug, status, extra = {}) => d.prepare(`INSERT INTO jobs (slug, key, title, company, location, url, apply_url, status, reason, applied_at, details)
  VALUES (?, 'k', ?, ?, 'Austin, TX', ?, ?, ?, ?, '2026-10-01T10:00:00Z', ?)`).run(slug, extra.title || "Backend Engineer", extra.company || "Globex",
  `https://jobs.lever.co/globex/${slug}`, `https://jobs.lever.co/globex/${slug}/apply`, status, extra.reason || "", JSON.stringify({ description: "x".repeat(5000) }));

test("only applied (or possibly sent) jobs are kept, and small", () => {
  const d = db.openDb(path.join(process.env.JA_DATA_DIR, "a.db"));
  add(d, "a1", "applied");
  add(d, "a2", "submitting");
  add(d, "a3", "failed", { reason: "interrupted right after pressing Submit: it may have gone through. Check your email" });
  add(d, "q1", "queued"); add(d, "f1", "filled"); add(d, "s1", "skipped"); add(d, "e1", "failed", { reason: "could not fill every required field" });
  const jobs = h.collect();
  assert.deepStrictEqual(jobs.map((j) => j.s), ["a1", "a2", "a3"]);
  assert.ok(jobs[1].maybe && jobs[2].maybe && !jobs[0].maybe);
  const buf = h.exportHistory("test");
  assert.ok(buf.length < 1000, `${buf.length} bytes for 3 jobs`);
  assert.ok(!zlib.gunzipSync(buf).toString().includes("xxxxx"), "no posting text, answers or resumes");
});

test("5,000 applications fit in well under a megabyte", () => {
  const d = db.openDb(path.join(process.env.JA_DATA_DIR, "big.db"));
  d.exec("BEGIN");
  for (let i = 0; i < 5000; i++) add(d, `job-${i}-abcdefgh`, "applied", { title: `Software Engineer ${i % 50}, Platform`, company: `Company ${i % 700} Inc.` });
  d.exec("COMMIT");
  const buf = h.exportHistory("test");
  console.log(`5,000 jobs: ${Math.round(buf.length / 1024)} KB`);
  assert.ok(buf.length < 300 * 1024);
});

test("import on a new computer: added, upgraded, never applied to again", () => {
  const old = db.openDb(path.join(process.env.JA_DATA_DIR, "old.db"));
  add(old, "a1", "applied", { company: "Initech", title: "Data Engineer" });
  add(old, "a2", "submitting", { company: "Hooli", title: "Web Developer" });
  store.savePrefs({ alreadyApplied: "Umbrella - Analyst" });
  const file = h.exportHistory("test");

  const fresh = db.openDb(path.join(process.env.JA_DATA_DIR, "new.db"));
  store.savePrefs({ alreadyApplied: "Acme - Designer" });
  add(fresh, "a1", "queued", { company: "Initech", title: "Data Engineer" }); // found again before the import
  const r = h.importHistory(file);
  assert.deepStrictEqual([r.added, r.updated, r.already], [1, 1, 0]);
  assert.strictEqual(db.getJob("a1").status, "applied");
  assert.strictEqual(db.getJob("a2").status, "failed", "a possibly-sent job waits for the user");
  assert.match(db.getJob("a2").reason, /may have gone through/);
  assert.match(store.getPrefs().alreadyApplied, /Acme - Designer[\s\S]*Umbrella - Analyst/);
  // Importing twice changes nothing.
  const again = h.importHistory(file);
  assert.deepStrictEqual([again.added, again.updated], [0, 0]);
  // The same role or the same address on another board counts as applied.
  const rows = fresh.prepare("SELECT slug, company, title, url, apply_url, status FROM jobs WHERE status = 'applied'").all();
  assert.ok(sameRoleAs({ slug: "x", company: "Initech", title: "Data Engineer (Remote)" }, rows));
  assert.ok(sameUrlAs({ slug: "y", url: "https://jobs.lever.co/globex/a1?lever-source=x" }, rows));
  assert.throws(() => h.importHistory(Buffer.from("{}")), /not a Job Autopilot history/);
});

test("the backup outside the app only grows, and keeps the previous copy", () => {
  db.openDb(path.join(process.env.JA_DATA_DIR, "b1.db"));
  add(db.getDb(), "old-1", "applied");
  const file = h.writeBackup("test");
  assert.strictEqual(file, path.join(backupDir, h.FILE_NAME));
  // A reinstall that applies to one job before importing must not lose the rest.
  db.openDb(path.join(process.env.JA_DATA_DIR, "b2.db"));
  add(db.getDb(), "new-1", "applied");
  h.writeBackup("test");
  const peek = h.peekBackup();
  assert.strictEqual(peek.count, 2);
  assert.ok(fs.existsSync(file + ".bak"));
  // An empty install never writes an empty backup over it.
  db.openDb(path.join(process.env.JA_DATA_DIR, "b3.db"));
  h.writeBackup("test");
  assert.strictEqual(h.peekBackup().count, 2);
  store.saveSettings({ historyBackup: false });
  db.openDb(path.join(process.env.JA_DATA_DIR, "b4.db"));
  add(db.getDb(), "new-2", "applied");
  assert.strictEqual(h.writeBackup("test"), null, "turned off in Settings");
  store.saveSettings({ historyBackup: true });
});
