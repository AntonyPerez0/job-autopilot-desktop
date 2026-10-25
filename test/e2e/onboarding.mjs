// End-to-end: launch the app (from source, or an installed build via
// JA_APP_EXE), walk the whole first-run setup against a local mock
// OpenAI-compatible server with a sample resume built from the example
// profile, and check the dashboard comes up in dry run.
//
//   node test/e2e/onboarding.mjs                 # from source
//   JA_APP_EXE="/Applications/Job Autopilot.app/Contents/MacOS/Job Autopilot" node test/e2e/onboarding.mjs
import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright-core";
import { Tailor, Profile } from "../../core/engine.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "test", "out", "e2e");
fs.mkdirSync(OUT, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "ja-e2e-"));
// A history left by an earlier install, where the app keeps it (Documents/Job Autopilot, here a temp folder).
const backups = fs.mkdtempSync(path.join(os.tmpdir(), "ja-e2e-backup-"));
fs.writeFileSync(path.join(backups, "applied-jobs.json.gz"), (await import("node:zlib")).gzipSync(JSON.stringify({ format: "job-autopilot/history@1", exportedAt: "2026-10-01T00:00:00Z",
  jobs: [{ s: "old-job-1", c: "Initech", t: "Data Engineer", at: "2026-09-30T10:00:00Z", u: "https://jobs.lever.co/initech/1" },
    { s: "old-job-2", c: "Hooli", t: "Web Developer", at: "2026-09-29T10:00:00Z", maybe: 1 }], alreadyApplied: "" })));

// The sample resume: the example person's base layout as a PDF.
const { spec } = Tailor.checkPlan(Profile.EXAMPLE, { base: Profile.EXAMPLE.bases[0].id });
const pdf = await Tailor.fit(Profile.EXAMPLE, spec, []);
const resumeFile = path.join(OUT, "Jordan_Lee_resume.pdf");
fs.writeFileSync(resumeFile, Buffer.from(pdf.pdf));

// Mock AI provider.
const calls = [], ollama = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const reply = (obj) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.url.endsWith("/models")) return reply({ data: [{ id: "z-ai/glm-5.3-flash", name: "GLM 5.3 Flash" }, { id: "mock/other", name: "Other" }] });
    const msg = JSON.parse(body || "{}");
    // Ollama's own API: the app sends the context length here.
    if (req.url === "/api/chat") {
      ollama.push(msg.options && msg.options.num_ctx);
      const text = (msg.messages || []).map((m) => m.content).join("\n");
      const content = /code word/.test(text) ? { code: msg.options.num_ctx >= 16384 ? "MARIGOLD-7" : "unknown" } : { ok: true };
      return reply({ message: { role: "assistant", content: JSON.stringify(content) }, done: true });
    }
    const sys = ((msg.messages || [])[0] || {}).content || "";
    calls.push(sys.slice(0, 60));
    let content = { ok: true };
    const all = (msg.messages || []).map((m) => m.content).join("\n");
    if (/code word/.test(all)) content = { code: "MARIGOLD-7" };
    else if (/Turn this resume into JSON/.test(sys)) content = JSON.parse(JSON.stringify(Profile.EXAMPLE));
    else if (/You screen job postings/.test(sys)) content = { decision: "skip", reason: "mock screen", level: "unclear" };
    reply({ choices: [{ message: { content: JSON.stringify(content) } }] });
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const apiBase = `http://127.0.0.1:${server.address().port}/v1`;

const require = createRequire(import.meta.url);
const exe = process.env.JA_APP_EXE || require("electron");
const args = process.env.JA_APP_EXE ? [] : [ROOT];
if (process.platform === "linux") args.push("--no-sandbox", ...(process.env.DISPLAY ? [] : ["--ozone-platform=headless"]));
console.log("launching", exe);
const app = await electron.launch({ executablePath: exe, args, env: { ...process.env, JA_DATA_DIR: data, JA_BACKUP_DIR: backups }, timeout: 120000 });
app.process().stdout.on("data", (d) => { if (process.env.JA_E2E_LOG) process.stdout.write("[app] " + d); });
app.process().stderr.on("data", (d) => { const t = String(d); if (/Error|unhandled|FATAL/i.test(t) && !/dbus|gl_|EGL|ANGLE|viz_main|Display.cpp|egl_util|ozone|gpu/i.test(t)) process.stdout.write("[app err] " + t); });
const win = await app.firstWindow();
win.setDefaultTimeout(60000);
const shot = (n) => win.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true }).catch(() => {});
const next = () => win.click("#next");
const heading = (t) => win.waitForSelector(`h1:has-text("${t}")`);

try {
  await heading("Apply to jobs while you do something else");
  await win.waitForSelector('h3:has-text("Welcome back")');
  await shot("1-welcome");
  await win.click("#hist-import");
  await win.waitForSelector('#hist-msg .msg.ok:has-text("Imported 2")');
  await win.check("#terms");
  await next();

  await heading("Connect an AI model");
  // A local model through Ollama: no key, models found on the server, the context window checked.
  await win.check('input[name=prov][value=ollama]');
  await win.fill("input[name=apiBase]", apiBase);
  assert.ok(!(await win.isVisible("input[name=apiKey]")), "no key for a local model");
  await win.click("[data-models]");
  await win.waitForSelector('.msg.ok:has-text("found")');
  assert.ok(["mock/other", "z-ai/glm-5.3-flash"].includes(await win.inputValue("input[name=model]")), "the first model found is picked");
  await win.click("[data-test]");
  await win.waitForSelector('.msg.ok:has-text("long postings")');
  assert.deepStrictEqual(ollama, [16384, 16384], "both test calls went to Ollama's own API with a 16k context");
  await shot("2-ai-local");
  // Then the remote path, which the rest of this test uses.
  await win.check('input[name=prov][value=custom]');
  await win.fill("input[name=apiBase]", apiBase);
  await win.fill("input[name=apiKey]", "test-key-not-real");
  await win.fill("input[name=model]", "z-ai/glm-5.3-flash");
  await win.click("[data-test]");
  await win.waitForSelector(".msg.ok");
  await shot("2-ai");
  await next();

  await heading("Upload your resume");
  await win.setInputFiles("input[type=file]", resumeFile);
  await shot("3-upload");
  await win.click("[data-go]");
  await heading("Approve every piece");
  await shot("4-review-before");
  const groups = await win.locator("[data-all]").count();
  for (let g = 0; g < groups; g++) await win.locator("[data-all]").nth(g).click();
  await shot("4-review-approved");
  await next();

  await heading("Answers to the usual questions");
  assert.strictEqual(await win.inputValue("input[name=firstName]"), "Jordan");
  assert.strictEqual(await win.inputValue("input[name=email]"), "jordan.lee@example.com");
  await win.fill("input[name=city]", "Austin");
  await win.fill("input[name=ytype]", "Software engineering");
  await win.fill("input[name=yyears]", "3");
  await shot("5-questions");
  await next();

  await heading("What jobs to look for");
  await win.fill("[data-titles] input", "Software Engineer");
  await win.press("[data-titles] input", "Enter");
  await win.fill("[data-city]", "Austin");
  await win.click('.suggest-list div:has-text("Austin")');
  await shot("6-prefs");
  await next();

  await heading("Connect your mailbox");
  await shot("7-mailbox");
  await win.click("#skip");

  await heading("Ready for a dry run");
  await next();

  await win.waitForSelector('h1:has-text("Overview")');
  await win.waitForSelector(".banner.violet");
  await shot("8-dashboard");
  assert.ok(await win.isVisible("#live"), "Go live switch shown");
  assert.ok(await win.isVisible('#update-side button:has-text("Check for updates")'), "update check in the sidebar");
  assert.ok(!(await win.$eval("#live", (e) => e.classList.contains("on"))), "starts in dry run");

  const settings = JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8"));
  assert.strictEqual(settings.onboarded, true);
  assert.strictEqual(settings.dryRun, true);
  const secrets = fs.readFileSync(path.join(data, "secrets.json"), "utf8");
  assert.ok(!secrets.includes("test-key-not-real"), "the API key is not stored in plain text");
  const profile = JSON.parse(fs.readFileSync(path.join(data, "profile.json"), "utf8"));
  assert.ok(profile.summaries.every((s) => s.approved), "approved on the review screen");

  // The imported history is in this install, and the backup was rewritten with it.
  const { DatabaseSync } = await import("node:sqlite");
  const jobs = new DatabaseSync(path.join(data, "autopilot.db")).prepare("SELECT slug, status FROM jobs WHERE slug LIKE 'old-job-%' ORDER BY slug").all();
  assert.deepStrictEqual(jobs.map((j) => `${j.slug}:${j.status}`), ["old-job-1:applied", "old-job-2:failed"]);
  assert.ok(fs.existsSync(path.join(backups, "applied-jobs.json.gz.bak")), "previous backup kept");

  // Settings and profile pages render.
  await win.click('.nav:has-text("Settings")');
  await win.waitForSelector("#sec-prefs .tags");
  await win.waitForSelector('#sec-history .hint:has-text("2 so far")');
  await win.waitForSelector('#update-card button:has-text("Update now")');
  await shot("9-settings");
  // Playwright inside the packaged app: find the installed browsers, and optionally download Chromium.
  await win.click("#sec-running [data-detect]");
  const found = await win.waitForSelector('#sec-running .msg.ok:has-text("Chrome:")', { timeout: 180000 });
  console.log("browsers:", await found.innerText());
  if (process.env.JA_E2E_CHROMIUM) {
    await win.click("#sec-running [data-install]");
    const done = await win.waitForSelector("#sec-running .msg.ok, #sec-running .msg.err", { timeout: 900000, state: "attached" });
    await win.waitForFunction(() => !/Downloading/.test(document.querySelector("#sec-running [data-msg]").innerText), null, { timeout: 900000 });
    const t = await win.innerText("#sec-running [data-msg]");
    console.log("chromium:", t);
    assert.match(t, /Chromium is ready/);
    assert.ok(done);
  }
  await win.click('.nav:has-text("Profile")');
  await win.waitForSelector("#sec-review .rv-group");
  await shot("10-profile");
  console.log("E2E PASS: onboarding completed; AI calls:", calls.length);
} catch (e) {
  await shot("failure");
  console.error("E2E FAIL:", e);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  server.close();
}
