// A dry run of one live posting inside the real app (Electron, from source or an
// installed build): the example profile, a real AI key, one queued posting,
// and the autopilot's own loop. It must end "filled" (or stop safely), never submit.
//
//   JA_API_KEY=sk-or-... node test/e2e/live-in-app.mjs <freehire-slug>
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron } from "playwright-core";

const slug = process.argv[2];
if (!process.env.JA_API_KEY || !slug) { console.error("usage: JA_API_KEY=... node test/e2e/live-in-app.mjs <freehire-slug>"); process.exit(2); }
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "ja-live-app-"));
process.env.JA_DATA_DIR = data;

// Seed the data folder the way finishing the setup would.
const { Profile } = await import("../../core/engine.js");
const { approvedExample, exampleAnswers, examplePrefs } = await import("../helpers.js");
const { call } = await import("../../core/freehire.js");
const { applyUrl } = await import("../../core/discover.js");
if (process.env.JA_REUSE_BROWSERS) fs.symlinkSync(process.env.JA_REUSE_BROWSERS, path.join(data, "browsers"));
const w = (n, o) => fs.writeFileSync(path.join(data, n), JSON.stringify(o, null, 2));
w("profile.json", approvedExample(Profile));
w("answers.json", exampleAnswers());
w("prefs.json", { ...examplePrefs(), titles: [] }); // no searching: only the seeded job
w("settings.json", { onboarded: true, acceptedTerms: true, dryRun: true, paused: true, headless: !process.env.HEADED, browser: process.env.JA_BROWSER || "auto", minutesBetweenApplies: 1 });
const d = await call("get_job", { slug });
const via = d.apply_via || d.source;
const db = new DatabaseSync(path.join(data, "autopilot.db"));
db.exec(`CREATE TABLE IF NOT EXISTS jobs (slug TEXT PRIMARY KEY, key TEXT, title TEXT, company TEXT, location TEXT, work_mode TEXT, source TEXT,
  url TEXT, apply_url TEXT, salary TEXT, posted_at TEXT, found_at TEXT DEFAULT (datetime('now')), status TEXT DEFAULT 'queued', reason TEXT,
  attempts INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')), applied_at TEXT, reviewed INTEGER DEFAULT 0, resume_file TEXT, screenshot TEXT, details TEXT)`);
db.prepare("INSERT INTO jobs (slug, key, title, company, location, work_mode, source, url, apply_url, status, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?)")
  .run(slug, "k", d.title, d.company, d.location || "", d.work_mode || "", via, d.official_job_url, await applyUrl(via, d.official_job_url), JSON.stringify({ description: d.description }));
db.close();
console.log(`seeded: ${d.title} at ${d.company}`);

const require = createRequire(import.meta.url);
const exe = process.env.JA_APP_EXE || require("electron");
const args = process.env.JA_APP_EXE ? [] : [ROOT];
if (process.platform === "linux") args.push("--no-sandbox", ...(process.env.DISPLAY ? [] : ["--ozone-platform=headless"]));
const app = await electron.launch({ executablePath: exe, args, env: { ...process.env, JA_DATA_DIR: data }, timeout: 120000 });
app.process().stdout.on("data", (x) => process.stdout.write("[app] " + x));
const win = await app.firstWindow();
await win.waitForSelector('h1:has-text("Overview")');
const api = (p, b) => win.evaluate(([p, b]) => window.ja.api(p, b), [p, b]);
assert.ok((await api("/api/ai/save", { apiKey: process.env.JA_API_KEY })).hasKey);
await api("/api/settings", { paused: false });

let job;
for (let t = 0; t < 120; t++) {
  await new Promise((r) => setTimeout(r, 10000));
  job = await api("/api/job/" + encodeURIComponent(slug));
  if (!["queued", "working"].includes(job.status)) break;
}
await win.screenshot({ path: path.join(data, "dashboard.png") });
console.log(`\nstatus: ${job.status}\nreason: ${job.reason}`);
assert.notStrictEqual(job.status, "applied", "a dry run never submits");
assert.notStrictEqual(job.status, "submitting");
if (job.status === "filled") {
  // The review gate: Go live opens only after the user checks this one.
  assert.ok((await api("/api/golive", { confirm: true })).error, "go live is locked before review");
  await api("/api/job/" + encodeURIComponent(slug), { action: "reviewed" });
  assert.ok(!(await api("/api/golive", { confirm: false })).dryRun, "still needs an explicit confirm");
}
console.log("files:", data);
await app.close();
