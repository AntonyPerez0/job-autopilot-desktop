// Live check for everyday jobs: search HiringCafe (in Chromium) for cashier jobs
// near Austin with the example profile, screen them with the real AI, then dry-run
// one application the app can fill. Nothing is submitted.
//
//   JA_API_KEY=sk-or-... [JA_TITLE=Cashier] [JA_CHROMIUM=/path] node scripts/live-hourly.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-hourly-"));
process.env.JA_DATA_DIR = dir;
const store = await import("../core/store.js");
store.setDataDir(dir);
const { Profile } = await import("../core/engine.js");
const { exampleAnswers, examplePrefs, approvedExample } = await import("../test/helpers.js");
const { chromium } = await import("playwright-core");
const { discover } = await import("../core/discover.js");
const { applyTo } = await import("../core/apply.js");
const { getDb, openDb } = await import("../core/db.js");
openDb();
store.saveSettings({ windowMode: "headless" });
store.saveAnswers({ ...exampleAnswers(), daysAvailable: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], shifts: ["Mornings", "Afternoons", "Evenings"],
  transportation: "yes", driversLicense: "yes", canLift: "40", hoursWanted: "either", startAvailability: "Right away" });
store.savePrefs({ ...examplePrefs(), titles: [process.env.JA_TITLE || "Cashier"], jobKind: "hourly", seniority: ["junior", "middle"], remote: false,
  boards: { hiringcafe: true }, maxYearsRequired: 3, postedWithinDays: 14 });
store.saveProfile(approvedExample(Profile));

const b = await chromium.launch({ executablePath: process.env.JA_CHROMIUM || "/usr/bin/chromium", headless: true });
const ctx = await b.newContext({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" });
const browser = { page: () => ctx.newPage(), done: (p) => p.close() };
const t0 = Date.now();
if (!process.env.JA_SKIP_SEARCH) await discover((u) => { if (u.phase === "search") console.log("  search:", u.label); }, { browser });
const rows = getDb().prepare("SELECT slug, title, company, location, source, status, reason, apply_url FROM jobs").all();
const by = (s) => rows.filter((r) => r.status === s);
console.log(`\n${Math.round((Date.now() - t0) / 1000)}s: ${rows.length} kept after filters; queued ${by("queued").length}, apply yourself ${by("manual").length}, skipped ${by("skipped").length}`);
for (const r of by("queued").slice(0, 5)) console.log("  queued:", r.title, "|", r.company, "|", r.location, "|", r.source);
for (const r of by("manual").slice(0, 3)) console.log("  yours:", r.title, "|", r.company, "|", r.reason.slice(0, 110));
for (const r of by("skipped").slice(0, 3)) console.log("  skipped:", r.title, "|", r.company, "|", r.reason.slice(0, 110));

if (process.env.JA_URL) {
  const { addJob } = await import("../core/addjob.js");
  console.log("added:", await addJob(process.env.JA_URL, { browserPage: browser }));
}
const order = (process.env.JA_PREFER || "careerplug,jazzhr,workable,paycom,jobvite,paylocity").split(",");
const queued = getDb().prepare("SELECT * FROM jobs WHERE status = 'queued'").all();
const pick = (process.env.JA_URL ? queued.filter((q) => q.slug.startsWith("link-")) : queued).sort((x, y) => ((order.indexOf(x.source) + 1 || 99) - (order.indexOf(y.source) + 1 || 99)))[0];
if (pick) {
  console.log(`\ndry run: ${pick.title} at ${pick.company} (${pick.source})\n  ${pick.apply_url}`);
  const job = getDb().prepare("SELECT * FROM jobs WHERE slug = ?").get(pick.slug);
  const r = await applyTo(job, { progress: (k) => console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${k}`) }, { dryRun: true, browser: ctx });
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(r, null, 2));
  console.log(`status: ${r.status}\nreason: ${r.reason}`);
  for (const k of (r.details && r.details.kit) || []) console.log(`   ${String(k.kind).padEnd(7)} ${k.label.slice(0, 60)} => ${String(k.value || "").slice(0, 60)}`);
}
console.log("\nfiles:", dir);
await b.close();
