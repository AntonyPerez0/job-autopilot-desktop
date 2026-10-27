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
import { execFileSync } from "node:child_process";
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
    // Mock GitHub API.
    if (req.url.startsWith("/gh/")) {
      const u = req.url.slice(3).split("?")[0];
      const repo = { name: "bird-feeder-cam", description: "Bird feeder camera", language: "Python", stargazers_count: 2, fork: false, pushed_at: "2026-09-01T00:00:00Z", html_url: "https://github.com/jordanlee-example/bird-feeder-cam", topics: [] };
      if (u === "/users/jordanlee-example") return reply({ login: "jordanlee-example" });
      if (u === "/users/jordanlee-example/repos") return reply([repo]);
      if (u === "/repos/jordanlee-example/bird-feeder-cam") return reply(repo);
      if (u.endsWith("/readme")) { res.writeHead(200, { "content-type": "text/plain" }); return res.end("# Bird Feeder Cam\nStreams live video of a bird feeder from a Raspberry Pi."); }
      if (u.endsWith("/languages")) return reply({ Python: 100 });
      if (u.endsWith("/contributors")) return reply([{ login: "jordanlee-example", contributions: 9 }]);
      res.writeHead(404); return res.end("{}");
    }
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
    else if (/experienced recruiter helping/.test(sys)) content = { lines: [{ i: 0, keep: false, text: "Built the Python and PostgreSQL scheduling service that 40 clinics use to book patients", why: "leads with what you built" },
      { i: 1, keep: false, text: "Set up CI that cut failed deploys by 80%", why: "made up", question: "Roughly how many deploys failed before?" }] };
    else if (/help someone remember/.test(sys)) content = { occupation: 0, questions: [{ q: "Did you restock shelves when they ran low?", t: [0, 0] }, { q: "Did you help unload deliveries?", t: [0, 1] }] };
    else if (/confirmed they did at a job/.test(sys)) content = { lines: [{ text: "Restocked shelves when they ran low, about twice a shift", from: [0] }] };
    else if (/resume project lines for a person's own GitHub/.test(sys)) content = { projects: [{ i: 0, title: "Bird Feeder Cam", lines: ["Streams live video of a bird feeder from a Raspberry Pi"] }] };
    else if (/one-page resume from a person's own answers/.test(sys)) content = { summary: "", jobs: [{ index: 0, bullets: [{ text: "Stocked shelves and helped customers find items", source: "stocked shelves, helped customers" }] }], skills: [] };
    else if (/You screen job postings/.test(sys)) content = { decision: "skip", reason: "mock screen", level: "unclear" };
    reply({ choices: [{ message: { content: JSON.stringify(content) } }] });
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const apiBase = `http://127.0.0.1:${server.address().port}/v1`;
process.env.JA_GITHUB_API = `http://127.0.0.1:${server.address().port}/gh`;

const require = createRequire(import.meta.url);
const exe = process.env.JA_APP_EXE || require("electron");
const args = process.env.JA_APP_EXE ? [] : [ROOT];
if (process.platform === "linux") args.push("--no-sandbox", ...(process.env.DISPLAY ? [] : ["--ozone-platform=headless"]));
console.log("launching", exe);
// colorScheme null: the page follows the app's own light/dark setting instead of Playwright's default of light.
const app = await electron.launch({ executablePath: exe, args, env: { ...process.env, JA_DATA_DIR: data, JA_BACKUP_DIR: backups }, timeout: 120000, colorScheme: null });
app.process().stdout.on("data", (d) => { if (process.env.JA_E2E_LOG) process.stdout.write("[app] " + d); });
app.process().stderr.on("data", (d) => { const t = String(d); if (/Error|unhandled|FATAL/i.test(t) && !/dbus|gl_|EGL|ANGLE|viz_main|Display.cpp|egl_util|ozone|gpu/i.test(t)) process.stdout.write("[app err] " + t); });
const win = await app.firstWindow();
win.setDefaultTimeout(60000);
// The whole screen, so the window's own title bar shows too (on the CI runners; skipped elsewhere).
async function screenShot(n) {
  if (!["win32", "darwin"].includes(process.platform)) return;
  await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setBounds({ x: 0, y: process.platform === "darwin" ? 30 : 0, width: 1000, height: 680 }); w.show(); w.focus(); });
  await new Promise((r) => setTimeout(r, 1200));
  const f = path.join(OUT, `${n}.png`);
  try {
    if (process.platform === "darwin") execFileSync("screencapture", ["-x", f]);
    else execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object System.Drawing.Bitmap $b.Width,$b.Height; $g=[System.Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size); $i.Save('${f}')`]);
  } catch (e) { console.log("screen capture failed:", e.message.split("\n")[0]); }
}
const shot = (n) => win.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: true }).catch(() => {});
const next = () => win.click("#next");
const heading = (t) => win.waitForSelector(`h1:has-text("${t}")`);

try {
  await heading("Apply to jobs while you do something else");
  await win.waitForSelector('h3:has-text("Welcome back")');
  await shot("1-welcome");
  await win.click("#hist-import");
  await win.waitForSelector('#hist-msg .msg.ok:has-text("Imported 2")');
  await win.click('.jobkind:has-text("Both")');
  await win.check("#terms");
  await next();

  await heading("Connect an AI model");
  // A local model through Ollama: no key, models found on the server, the context window checked.
  assert.ok(await win.isVisible('.steps-list:has-text("Make a free OpenRouter account")'), "OpenRouter steps shown first");
  await win.click('summary:has-text("Other ways to connect an AI")');
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

  await heading("Your resume");
  await win.setInputFiles("input[type=file]", resumeFile);
  // Projects from GitHub first; the resume read next is added to them.
  await win.click('summary:has-text("Add projects from my GitHub")');
  await win.fill("[name=gh_user]", "jordanlee-example");
  await win.click("[data-gh-look]");
  await win.check('[data-repo="bird-feeder-cam"] input[value=ai]');
  assert.ok(await win.isChecked('[data-repo="bird-feeder-cam"] [data-pick]'), "own project ticked by default");
  await win.click("[data-gh-add]");
  await win.waitForSelector('[data-gh-out] .msg.ok:has-text("Added 1 project")');
  await shot("3b-github");
  await shot("3-upload");
  await win.click("[data-go]");
  await heading("Approve every piece");
  await shot("4-review-before");
  const groups = await win.locator("[data-all]").count();
  for (let g = 0; g < groups; g++) await win.locator("[data-all]").nth(g).click();
  await shot("4-review-approved");
  await next();

  await heading("About you");
  assert.strictEqual(await win.inputValue("input[name=firstName]"), "Jordan");
  assert.strictEqual(await win.inputValue("input[name=email]"), "jordan.lee@example.com");
  await win.fill("input[name=city]", "Austin");
  // Legal answers are never pre-filled: the app refuses to go on until the person picks them.
  assert.ok(!(await win.isChecked("input[name=workAuthorized][value=yes]")), "work authorization is not pre-filled");
  await next();
  assert.match(await win.locator("#err").innerText(), /allowed to work/);
  await win.check("input[name=workAuthorized][value=yes]");
  await win.check("input[name=needsSponsorship][value=no]");
  await win.check("input[name=over18][value=yes]");
  await win.fill("input[name=ytype]", "Software engineering");
  await win.fill("input[name=yyears]", "3");
  await shot("5-questions");
  await next();

  await heading("What jobs to look for");
  await win.fill("[data-titles] input", "Software Engineer");
  await win.press("[data-titles] input", "Enter");
  await win.click('.chip-add:has-text("Cashier")');
  assert.ok(await win.isVisible('[data-titles] .tag:has-text("Cashier")'), "a suggested title is added with one click");
  assert.ok(await win.isChecked('.board input[value=hiringcafe]'), "HiringCafe on by default");
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
  await screenShot("8z-screen");
  assert.ok(await win.isVisible("#live"), "Go live switch shown");
  // "Checking..." while the app's own check runs, then "Check for updates".
  await win.waitForSelector('#update-side button:has-text("Check for updates")', { timeout: 60000 });
  assert.ok(!(await win.$eval("#live", (e) => e.classList.contains("on"))), "starts in dry run");

  const settings = JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8"));
  assert.strictEqual(settings.onboarded, true);
  assert.strictEqual(settings.dryRun, true);
  const secrets = fs.readFileSync(path.join(data, "secrets.json"), "utf8");
  assert.ok(!secrets.includes("test-key-not-real"), "the API key is not stored in plain text");
  const profile = JSON.parse(fs.readFileSync(path.join(data, "profile.json"), "utf8"));
  assert.ok(profile.summaries.every((s) => s.approved), "approved on the review screen");
  const cam = profile.projects.find((x) => x.github);
  assert.ok(cam && cam.aiBuilt && cam.bullets[0].text.startsWith("Built with AI coding agents"), "the GitHub project, marked as built with AI");
  assert.ok(cam.bullets.every((b) => b.approved), "its lines approved on the review screen");
  assert.ok(profile.bases.filter((b) => b.approved).some((b) => b.sections.some((x) => x.kind === "projects" && x.items.some((it) => it.id === cam.id))), "and in a layout");
  assert.strictEqual(profile.name, "Jordan Lee", "the resume's name, not a placeholder");

  // The imported history is in this install, and the backup was rewritten with it.
  const { DatabaseSync } = await import("node:sqlite");
  const jobs = new DatabaseSync(path.join(data, "autopilot.db")).prepare("SELECT slug, status FROM jobs WHERE slug LIKE 'old-job-%' ORDER BY slug").all();
  assert.deepStrictEqual(jobs.map((j) => `${j.slug}:${j.status}`), ["old-job-1:applied", "old-job-2:failed"]);
  assert.ok(fs.existsSync(path.join(backups, "applied-jobs.json.gz.bak")), "previous backup kept");

  const prefsSaved = JSON.parse(fs.readFileSync(path.join(data, "prefs.json"), "utf8"));
  assert.deepStrictEqual(prefsSaved.titles, ["Software Engineer", "Cashier"]);
  assert.ok(prefsSaved.boards.hiringcafe && prefsSaved.boards.freehire);
  // Add a job by its link.
  await win.click('button:has-text("Add a job")');
  await win.fill("#aj-url", "https://www.google.com/search?q=jobs+near+me");
  await win.click("#aj-go");
  await win.waitForSelector('#aj-msg .msg.err:has-text("Google search page")');
  await shot("8b-add-job");
  // A job on a site that needs an account goes to "Apply yourself", with Open and "I applied".
  await win.fill("#aj-url", "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Austin-TX/Cashier_R1");
  await win.click("#aj-go");
  await win.waitForSelector('#aj-msg .msg.ok:has-text("Apply yourself")', { timeout: 60000 });
  await win.click("#aj-close");
  await win.click('.nav:has-text("Apply yourself")');
  await win.waitForSelector("tbody tr");
  await win.click("tbody tr");
  await win.waitForSelector('#drawer button:has-text("I applied")');
  await shot("8c-apply-yourself");
  await win.click('#drawer button:has-text("I applied")');
  await win.waitForSelector('#drawer .badge:has-text("Applied")');
  await win.click("#drawer .dr-close");
  await win.click('.nav:has-text("Overview")');

  // A job that stopped on questions only the user can answer: answered in the job's panel, it goes back in the queue.
  new DatabaseSync(path.join(data, "autopilot.db")).prepare("INSERT INTO jobs (slug, title, company, location, status, reason, details, attempts) VALUES (?, ?, ?, ?, 'failed', ?, ?, 1)").run(
    "initech-ask", "Backend Engineer", "Initech", "Austin, TX",
    "could not fill every required field: needs you: How many years of professional software engineering experience do you have?* (no number for this kind of experience in your answers); required, no answer: Are you currently enrolled in full-time studies?",
    JSON.stringify({ report: { decide: [{ label: "How many years of professional software engineering experience do you have?*", note: "no number for this kind of experience in your answers" }] },
      fields: [{ type: "text", label: "How many years of professional software engineering experience do you have?*", required: true }, { type: "select", label: "Are you currently enrolled in full-time studies?", required: true, options: ["Select...", "Yes", "No"] }] }));
  await win.click('button:has-text("Search now")');
  await win.click('.banner:has-text("waiting for your answer") button:has-text("Answer now")');
  await win.waitForSelector("#ask-form");
  await win.fill('#ask-form [name=ask-0]', "3");
  await win.selectOption('#ask-form [name=ask-1]', "No");
  await shot("8d-answer");
  await win.click("#ask-go");
  await win.waitForSelector('#drawer .badge:has-text("Queued"), #drawer .badge:has-text("Applying now")');
  const yours = JSON.parse(fs.readFileSync(path.join(data, "answers.json"), "utf8")).yourAnswers;
  assert.deepStrictEqual(yours.map((x) => [x.value, x.scope]), [["3", "all"], ["No", "all"]], "answers saved for the next applications too");
  await win.click("#drawer .dr-close");

  // Simple (the default) hides statistics, activity and the extra pages; Advanced shows everything.
  await win.click('.nav:has-text("Overview")');
  assert.ok(!(await win.isVisible('.nav:has-text("Skipped")')), "Simple: no Skipped page in the sidebar");
  assert.ok(!(await win.isVisible('.card:has-text("Applications per day")')), "Simple: no charts on the Overview");
  assert.ok(await win.isVisible('.card:has-text("Recent applications")'));
  await shot("8e-simple");
  await win.click('[data-mode="advanced"]');
  await win.waitForSelector('.nav:has-text("Skipped")', { state: "visible" });
  assert.ok(await win.isVisible('.card:has-text("Applications per day")'), "Advanced: the charts are back");
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8")).uiMode, "advanced", "the choice is kept");

  // Settings and profile pages render.
  await win.click('.nav:has-text("Settings")');
  await win.waitForSelector("#sec-prefs .tags");
  await win.waitForSelector('#sec-history .hint:has-text("3 so far")');
  await win.waitForSelector('#update-card button:has-text("Update now")');
  await shot("9-settings");
  // Job site accounts: off until the user turns it on, agrees to sign-up terms, and gives a password sites accept.
  await win.click('details:has(#sec-accounts) > summary');
  await win.waitForSelector("#sec-accounts [name=acc_on]");
  await win.check("#sec-accounts [name=acc_on]");
  await win.fill("#sec-accounts [name=acc_pass]", "password");
  await win.click('[data-save="accounts"]');
  await win.waitForSelector('#msg-accounts .msg.err:has-text("Tick the box")');
  await win.check("#sec-accounts [name=acc_consent]");
  await win.click('[data-save="accounts"]');
  await win.waitForSelector('#msg-accounts .msg.err:has-text("uppercase letter")');
  await win.fill("#sec-accounts [name=acc_pass]", "Tow-Truck-2026!");
  await win.click('[data-save="accounts"]');
  await win.waitForSelector('#msg-accounts .msg.ok');
  await shot("9c-accounts");
  const acc = JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8")).siteAccounts;
  assert.deepStrictEqual([acc.enabled, acc.consent, acc.email], [true, true, "jordan.lee@example.com"], "turned on with the user's email");
  assert.ok(!fs.readFileSync(path.join(data, "settings.json"), "utf8").includes("Tow-Truck-2026!"), "the password is not stored in plain text");
  // Appearance: Dark switches the whole app through Electron's nativeTheme and is remembered; "Match my computer" undoes it.
  const theme = () => app.evaluate(({ nativeTheme }) => [nativeTheme.themeSource, nativeTheme.shouldUseDarkColors]);
  await win.check('#sec-theme input[value=dark]');
  for (let k = 0; k < 20 && (await theme())[0] !== "dark"; k++) await new Promise((r) => setTimeout(r, 250));
  assert.deepStrictEqual(await theme(), ["dark", true], "dark mode on");
  await win.waitForFunction(() => matchMedia("(prefers-color-scheme: dark)").matches, null, { timeout: 10000 });
  await screenShot("9z-screen-dark");
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(data, "settings.json"), "utf8")).theme, "dark", "the choice is saved");
  await win.check('#sec-theme input[value=light]');
  for (let k = 0; k < 20 && (await theme())[0] !== "light"; k++) await new Promise((r) => setTimeout(r, 250));
  assert.deepStrictEqual(await theme(), ["light", false], "light mode on");
  await win.waitForFunction(() => !matchMedia("(prefers-color-scheme: dark)").matches, null, { timeout: 10000 });
  await win.check('#sec-theme input[value=system]');
  // Playwright inside the packaged app: find the installed browsers, and optionally download Chromium.
  await win.click('details:has(#sec-running) > summary');
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
  await win.click('.nav:has-text("Resume")');
  await win.waitForSelector("#sec-studio .check-item");
  await shot("10-resume-check");
  // Improve: one faithful rewrite to accept; one that invented "80%" shows only its question.
  await win.click('button:has-text("Suggest improvements for every line")');
  await win.waitForSelector("#sec-studio .sugg");
  assert.ok(await win.isVisible('#sec-studio .sugg:has-text("Roughly how many deploys")'), "the invented rewrite became a question");
  assert.ok(!(await win.isVisible('#sec-studio .sugg textarea:has-text("80%")')), "and its text is not offered");
  await shot("11-resume-improve");
  await win.click('#sec-studio .sugg:has-text("40 clinics") button:has-text("Use this")');
  await win.waitForFunction(() => !document.querySelector('#sec-studio .sugg textarea') || ![...document.querySelectorAll('#sec-studio .sugg textarea')].some((t) => /40 clinics/.test(t.value)));
  const prof = JSON.parse(fs.readFileSync(path.join(data, "profile.json"), "utf8"));
  assert.ok(prof.experience[0].bullets.some((b) => b.text.startsWith("Built the Python and PostgreSQL scheduling service")), "accepted line saved");
  // Create: a job from the interview, added to the current resume, waiting for approval.
  await win.click('details:has(#sec-create) > summary');
  await win.fill('#sec-create [name=c_title]', "Stock Associate");
  await win.fill('#sec-create [name=c_employer]', "Corner Market");
  await win.fill('#sec-create [name=c_daily]', "stocked shelves, helped customers");
  // Jog the memory: answer Yes to one question, with a detail.
  await win.click('#sec-create button:has-text("Help me remember what I did")');
  await win.waitForSelector('#sec-create .recall-item:has-text("restock shelves")');
  await win.click('#sec-create .recall-item:has-text("restock shelves") [data-yes]');
  await win.fill('#sec-create .recall-item:has-text("restock shelves") [data-detail]', "about twice a shift");
  await win.click('#sec-create .recall-item:has-text("unload deliveries") [data-no]');
  await shot("12a-remember");
  await win.check('#sec-create [name=c_merge]');
  await win.click('#sec-create [data-cgo]');
  await win.waitForSelector('#sec-review .rv-group:has-text("Stock Associate")');
  await win.click('details:has(#sec-review) > summary').catch(() => {});
  const created = JSON.parse(fs.readFileSync(path.join(data, "profile.json"), "utf8")).experience.find((e) => e.title === "Stock Associate");
  assert.ok(created.bullets.some((b) => /twice a shift/.test(b.text) && /You said yes to/.test(b.source)), "a remembered task became a line, with its source");
  await shot("12-resume-created");
  console.log("E2E PASS: onboarding completed; AI calls:", calls.length);
} catch (e) {
  await shot("failure");
  console.error("E2E FAIL:", e);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
  server.close();
}
