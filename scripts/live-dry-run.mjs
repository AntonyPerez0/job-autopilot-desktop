// A dry run against one live posting, outside the app: the same applyTo code
// fills a real Greenhouse, Lever or Ashby form with the example person's
// profile and answers, checks every answer, and never submits.
//
//   JA_API_KEY=sk-or-... node scripts/live-dry-run.mjs [posting-url-or-freehire-slug]
//
// Writes the screenshot, resume and report to a temp folder and prints the path.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-live-"));
process.env.JA_DATA_DIR = dir;
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(dir, "browsers");
if (!process.env.JA_API_KEY) { console.error("Set JA_API_KEY (an OpenRouter key)."); process.exit(2); }

const store = await import("../core/store.js");
const { Profile } = await import("../core/engine.js");
const { exampleAnswers, examplePrefs, approvedExample } = await import("../test/helpers.js");
const { applyTo } = await import("../core/apply.js");
const { applyUrl } = await import("../core/discover.js");
const { call } = await import("../core/freehire.js");
store.setDataDir(dir);
store.saveSettings({ headless: process.env.HEADED ? false : true, browser: process.env.JA_BROWSER || "auto", dryRun: true });
store.saveAnswers(exampleAnswers());
store.savePrefs(examplePrefs());
store.saveProfile(approvedExample(Profile));

async function pick(arg) {
  if (arg && /^https?:/.test(arg)) {
    const src = /greenhouse/.test(arg) ? "greenhouse" : /lever\.co/.test(arg) ? "lever" : /ashbyhq/.test(arg) ? "ashby" : null;
    return { slug: "manual-" + Date.now(), title: "(from URL)", company: "(from URL)", location: "", source: src, apply_url: await applyUrl(src, arg), details: "{}" };
  }
  let d;
  if (arg) d = await call("get_job", { slug: arg });
  else {
    const { remoteOk } = await import("../core/geo.js");
    const r = await call("search_jobs", { query: process.env.JA_QUERY || "software engineer", countries: ["US"], work_mode: ["remote"], sources: ["greenhouse", "lever", "ashby"], posted_within_days: 7, limit: 30 });
    for (const j of r.jobs || []) {
      if (!remoteOk(j, "US") || /senior|staff|principal|lead|manager/i.test(j.title)) continue;
      const full = await call("get_job", { slug: j.slug });
      const via = full.apply_via || full.source;
      if (["greenhouse", "lever", "ashby"].includes(via) && await applyUrl(via, full.official_job_url).catch(() => null)) { d = full; break; }
    }
  }
  const via = d.apply_via || d.source;
  return { slug: d.slug, title: d.title, company: d.company, location: d.location || "", work_mode: d.work_mode, source: via,
    url: d.official_job_url, apply_url: await applyUrl(via, d.official_job_url), details: JSON.stringify({ description: d.description }) };
}

const job = await pick(process.argv[2]);
console.log(`dry run: ${job.title} at ${job.company}\n  ${job.apply_url}`);
const t0 = Date.now();
const r = await applyTo(job, { progress: (k) => console.log(`  [${((Date.now() - t0) / 1000).toFixed(0)}s] ${k}`), status: (s) => console.log("  " + s) }, { dryRun: true });
fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(r, null, 2));
console.log(`\nstatus: ${r.status}\nreason: ${r.reason}`);
const rep = (r.details && r.details.report) || {};
console.log(`filled ${(rep.filled || []).length}, drafts ${(rep.drafts || []).length}, left for the user ${(rep.decide || []).length}, missing ${(rep.missing || []).length}`);
for (const a of (r.details && r.details.audit) || []) console.log("  truth check: " + a);
console.log(`\nfiles: ${dir}`);
process.exit(r.status === "filled" || r.status === "failed" || r.status === "skipped" ? 0 : 1);
