// Housekeeping at each start: old activity, and the files of jobs that were left out or stopped long ago, go;
// everything about an application that was sent stays.
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { openDb, getDb, getJob } = await import("../core/db.js");
const { tidy } = await import("../core/tidy.js");
openDb();

test("old activity and the files of jobs left out long ago go; a sent application keeps everything", () => {
  const db = getDb(), shots = store.dataDir("shots"), resumes = store.dataDir("resumes");
  const add = (slug, status, days, extra = {}) => {
    db.prepare(`INSERT INTO jobs (slug, title, company, status, details, resume_file, screenshot, applied_at, updated_at) VALUES (?, 'Cashier', 'Globex', ?, ?, ?, ?, ?, datetime('now', ?))`)
      .run(slug, status, JSON.stringify({ description: "The posting's text", category: "retail", resume: { fileName: "Jordan_Lee_resume.pdf" }, ...extra }), `${slug}.pdf`, `${slug}-filled.jpg`,
        status === "applied" ? new Date(Date.now() - days * 86400000).toISOString() : null, `-${days} days`);
    for (const f of [`${slug}-filled.jpg`, `${slug}-after.jpg`]) fs.writeFileSync(path.join(shots, f), "x");
    for (const f of [`${slug}.pdf`, `${slug}-Jordan_Lee_resume.pdf`]) fs.writeFileSync(path.join(resumes, f), "x");
    db.prepare("INSERT INTO events (slug, level, message, at) VALUES (?, 'info', 'found', datetime('now', ?))").run(slug, `-${days} days`);
  };
  add("old-skip", "skipped", 45); add("new-skip", "skipped", 5); add("old-fail", "failed", 200); add("sent", "applied", 400);
  add("old", "skipped", 45); add("old-er", "applied", 45); // a slug that begins like another's
  db.prepare("INSERT INTO events (level, message, at) VALUES ('info', 'search done', datetime('now', '-100 days'))").run();
  fs.writeFileSync(path.join(resumes, "preview-swe-1.pdf"), "x");
  fs.utimesSync(path.join(resumes, "preview-swe-1.pdf"), new Date(Date.now() - 3 * 86400000), new Date(Date.now() - 3 * 86400000));
  fs.writeFileSync(path.join(resumes, "preview-swe-2.pdf"), "x");

  const r = tidy();
  const has = (dir, f) => fs.existsSync(path.join(dir, f));
  // Left out 45 days ago: files and the posting's text gone, the rest of what's known about it kept.
  assert.ok(!has(shots, "old-skip-filled.jpg") && !has(shots, "old-skip-after.jpg") && !has(resumes, "old-skip.pdf") && !has(resumes, "old-skip-Jordan_Lee_resume.pdf"));
  assert.deepStrictEqual([getJob("old-skip").resume_file, getJob("old-skip").screenshot], [null, null]);
  assert.deepStrictEqual(JSON.parse(getJob("old-skip").details), { category: "retail", resume: { fileName: "Jordan_Lee_resume.pdf" } });
  // Recent, or sent: untouched.
  for (const s of ["new-skip", "sent", "old-er"]) assert.ok(has(shots, `${s}-filled.jpg`) && has(resumes, `${s}.pdf`) && has(resumes, `${s}-Jordan_Lee_resume.pdf`) && JSON.parse(getJob(s).details).description, s);
  // Stopped 200 days ago: its files go, what it asked stays.
  assert.ok(!has(shots, "old-fail-filled.jpg") && JSON.parse(getJob("old-fail").details).description);
  // Activity: over 90 days old goes, a sent application's stays.
  const left = db.prepare("SELECT slug FROM events WHERE message != 'search done' AND slug IS NOT NULL ORDER BY id").all().map((e) => e.slug);
  assert.strictEqual(db.prepare("SELECT COUNT(*) n FROM events WHERE message = 'search done'").get().n, 0);
  assert.deepStrictEqual(left.sort(), ["new-skip", "old", "old-er", "old-skip", "sent"].sort());
  assert.ok(!has(resumes, "preview-swe-1.pdf") && has(resumes, "preview-swe-2.pdf"));
  assert.ok(r.files >= 9 && r.events === 2 && r.postings === 2, JSON.stringify(r));
  assert.deepStrictEqual(tidy(), { events: 0, files: 0, postings: 0 }, "nothing left to do the second time");
});
