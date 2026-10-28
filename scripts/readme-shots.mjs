// The README's screenshots, made again from the app as it is now:
//   node scripts/readme-shots.mjs          (Linux without a screen: add nothing; with one, it opens a window)
// Everything shown is made up: the example person (Jordan Lee) and fictional companies. The AI is a local
// stand-in that answers the app's questions the same way every time, so no key is needed and nothing leaves the computer.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron } from "playwright-core";
import { Profile } from "../core/engine.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "docs", "images");
const require = createRequire(import.meta.url);
const SIZE = { width: 1440, height: 900 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- the stand-in AI ----------
const say = (sys, user) => {
  if (/A recruiter wants scope on resume lines/.test(sys)) {
    const lines = JSON.parse(user);
    const ask = (t) => /GitHub Actions CI/.test(t) ? "How many times a week does the team deploy now, roughly?"
      : /online store/.test(t) ? "About how many orders a month did the online store take?"
      : /records hikes/.test(t) ? "About how many people use Trail Tracker?" : "";
    return { questions: lines.map((l) => ({ path: l.path, question: ask(l.text) })).filter((q) => q.question).slice(0, 3) };
  }
  if (/what work they could go for next/.test(sys)) return { jobs: [0, 0], ideas: ["QA Engineer", "Data Engineer", "Systems Administrator", "Technical Writer"] };
  if (/pick the official occupation that is the same work/.test(sys)) {
    const want = { "QA Engineer": /Quality Assurance/, "Data Engineer": /Database Architects/, "Systems Administrator": /Network and Computer Systems Administrators/, "Technical Writer": /Technical Writers/ };
    return { map: [...user.matchAll(/^TITLE \d+: (.+)\n((?: {2}\d+\. .+\n?)*)/gm)].map((m) => {
      const opts = m[2].trim().split("\n").map((l) => l.replace(/^\s*\d+\.\s*/, ""));
      const i = opts.findIndex((o) => (want[m[1]] || /^$/).test(o));
      return i; }) };
  }
  if (/work they can realistically go for next/.test(sys)) {
    const verdict = {
      "QA Engineer": { status: "ready", why: "You set up GitHub Actions CI with unit and integration tests, cutting failed deploys from weekly to rare." },
      "Systems Administrator": { status: "step", need: "A Linux certification such as CompTIA Linux+", how: "Self-study and the exam, usually 2 to 3 months and about $370 for the exam." },
      "Data Engineer": { status: "step", need: "A small data pipeline project (for example with Airflow or dbt) to show employers", how: "Build one from a public dataset and publish it on GitHub, usually a few weekends and free." },
      "Technical Writer": { status: "ready", why: "You designed a public REST API and wrote its OpenAPI docs for two partner integrations." },
      "Computer Systems Analysts": { status: "ready", search: "Systems Analyst", why: "You built a scheduling service that 40 clinics use to book patients." },
      "Information Technology Project Managers": { status: "step", search: "IT Project Manager", need: "A project management certificate such as CAPM", how: "An online course and exam, usually 1 to 2 months and about $300." },
      "Database Architects": { status: "step", search: "Database Architect", need: "A database certification such as AWS Certified Database", how: "Self-study and the exam, usually 2 to 3 months and about $300." },
    };
    return { jobs: [...user.matchAll(/^(j\d+) \| ([^|(]+?)(?: \(official occupation: ([^)]+)\))? \|/gm)].map(([, id, name]) => {
      const v = verdict[name.trim()];
      return v ? { id, search: v.search || name.trim(), ...v } : { id, status: "no", search: name.trim(), why: "" };
    }) };
  }
  if (/fact-check/.test(sys)) return { lines: [] };
  return {};
};
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    res.writeHead(200, { "content-type": "application/json" });
    if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "z-ai/glm-5.3-flash" }] }));
    const m = JSON.parse(b || "{}").messages || [];
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(say(m[0] && m[0].content || "", m[1] && m[1].content || "")) } }] }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));

// ---------- a made-up person with a few weeks of applications ----------
const data = fs.mkdtempSync(path.join(os.tmpdir(), "ja-shots-"));
const w = (f, o) => fs.writeFileSync(path.join(data, f), JSON.stringify(o));
const profile = JSON.parse(JSON.stringify(Profile.EXAMPLE));
for (const k of ["experience", "projects", "skills", "education", "summaries", "bases", "headers"]) for (const e of profile[k] || []) { e.approved = true; for (const x of e.bullets || []) x.approved = true; }
w("profile.json", profile);
const settings = { onboarded: true, acceptedTerms: true, dryRun: true, paused: true, uiMode: "simple", ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "z-ai/glm-5.3-flash" } };
w("settings.json", settings);
w("prefs.json", { minPay: 45, minPayPer: "hour", titles: ["Software Engineer", "Backend Engineer"], cities: [{ name: "Austin", label: "Austin, TX", country: "US", admin1: "TX", lat: 30.27, lon: -97.74 }], remote: true, boards: {} });
w("answers.json", { firstName: "Jordan", lastName: "Lee", email: "jordan.lee@example.com", phone: "+1 (512) 555-0142", city: "Austin", state: "TX" });
const db = new DatabaseSync(path.join(data, "autopilot.db"));
db.exec(fs.readFileSync(path.join(ROOT, "core", "db.js"), "utf8").match(/CREATE TABLE IF NOT EXISTS jobs[\s\S]*?\);\nCREATE TABLE IF NOT EXISTS events[\s\S]*?\);/)[0]);
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace("T", " ").slice(0, 19);
const add = db.prepare("INSERT INTO jobs (slug, title, company, location, work_mode, source, url, apply_url, salary, status, reason, details, applied_at, updated_at, found_at, posted_at, attempts) VALUES (?, ?, ?, ?, ?, 'greenhouse', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)");
const job = (slug, title, company, location, status, h, { reason = "", details = {}, salary = "", mode = "" } = {}) =>
  add.run(slug, title, company, location, mode, `https://example.com/jobs/${slug}`, `https://example.com/apply/${slug}`, salary, status, reason, JSON.stringify(details), status === "applied" ? ago(h) : null, ago(h), ago(h + 2), ago(h + 60));
job("globex-swe", "Software Engineer", "Globex", "Austin, TX", "applied", 1, { salary: "USD 120,000-140,000/year" });
job("initech-be", "Backend Engineer", "Initech", "Remote, US", "applied", 26);
job("acme-plat", "Platform Engineer", "Acme", "Austin, TX", "applied", 50);
job("vandelay-api", "API Engineer", "Vandelay Industries", "Dallas, TX", "applied", 98);
job("hooli-full", "Full Stack Engineer", "Hooli", "Remote, US", "applied", 120);
job("stark-web", "Web Developer", "Stark Industries", "Austin, TX", "applied", 150);
job("umbrella-sre", "Site Reliability Engineer", "Umbrella", "Remote, US", "queued", 2);
job("cyberdyne-swe2", "Software Engineer II", "Cyberdyne", "Austin, TX", "queued", 2);
job("soylent-py", "Python Developer", "Soylent", "Round Rock, TX", "queued", 3);
job("wonka-full", "Full Stack Engineer", "Wonka", "Round Rock, TX", "filled", 4, { mode: "hybrid", reason: "dry run: filled, not submitted", details: {
  audit: ["Every answer matched your approved resume", "No legal agreement was guessed"],
  kit: [{ label: "First name", value: "Jordan", kind: "text" }, { label: "Email", value: "jordan.lee@example.com", kind: "text" },
    { label: "Why do you want to work here?", value: "I like building tools people use every day, like the scheduling service 40 clinics use.", kind: "draft", note: "From your summary and your Acme Health line" },
    { label: "Resume", value: "Jordan_Lee_resume.pdf", kind: "file" }, { label: "Are you legally authorized to work in the US?", value: "", kind: "decide", note: "Left for you: the app never answers legal questions for you" }],
  plan: { notClaimed: [{ what: "Kubernetes", why: "Not in your approved resume" }] } } });
job("initech-data", "Data Engineer", "Initech", "Austin, TX", "failed", 6, {
  reason: "could not fill every required field: still empty: Which office would you work from?; required, no answer: How did you hear about us?",
  details: { fields: [{ type: "listbox", label: "Which office would you work from? *" }, { type: "select", label: "How did you hear about us?", options: ["Select...", "LinkedIn", "Company website", "A friend or colleague", "Job board"] }],
    askOptions: { "which office would you work from": ["Austin (downtown)", "Austin (Domain)", "Remote"] } } });
job("globex-ml", "ML Engineer", "Globex", "Remote, US", "manual", 8, { reason: "Apply yourself: this site needs your own account" });
job("acme-sec", "Security Engineer", "Acme", "Austin, TX", "skipped", 9, { reason: "not a fit: needs a security clearance" });
const ev = db.prepare("INSERT INTO events (slug, level, message, at) VALUES (?, ?, ?, ?)");
ev.run("globex-swe", "info", "applied: the employer confirmed it", ago(1));
ev.run("wonka-full", "info", "filled (dry run): every required field answered", ago(4));
db.close();

// ---------- the screenshots ----------
const args = [ROOT];
if (process.platform === "linux") args.push("--no-sandbox", ...(process.env.DISPLAY ? [] : ["--ozone-platform=headless"]));
const launch = (dir) => electron.launch({ executablePath: require("electron"), args, env: { ...process.env, JA_DATA_DIR: dir, JA_API_KEY: "readme" }, timeout: 120000 });
const shot = async (win, name, el) => {
  const f = path.join(OUT, name + ".png");
  if (!el) await win.screenshot({ path: f });
  else {
    // Part of the page, with a margin around it; scrolled into a window tall enough to hold it.
    const pad = el === "#drawer" ? 0 : 16;
    const box = await win.evaluate(([sel, pad]) => {
      const e = document.querySelector(sel); e.scrollIntoView({ block: "start" });
      const r = e.getBoundingClientRect();
      return { x: Math.max(0, r.left - pad), y: Math.max(0, r.top - pad), width: r.width + 2 * pad, height: r.height + 2 * pad };
    }, [el, pad]);
    await wait(300);
    await win.screenshot({ path: f, clip: { ...box, width: Math.min(box.width, SIZE.width - box.x) } });
  }
  console.log("saved", path.relative(ROOT, f));
};

let app = await launch(data);
let win = await app.firstWindow();
win.setDefaultTimeout(60000);
await win.setViewportSize(SIZE);
await win.waitForSelector('h1:has-text("Overview")');
await wait(1500);
// The front page, light and dark.
for (const scheme of ["light", "dark"]) { await win.emulateMedia({ colorScheme: scheme }); await wait(600); await shot(win, `overview-${scheme}`); }
await win.emulateMedia({ colorScheme: "light" });
// A filled application, with every check shown (Advanced).
await win.click('[data-mode="advanced"]');
await win.waitForSelector("#toast.show", { state: "detached" }).catch(() => {}); await wait(2600);
await win.evaluate(() => { location.hash = "#filled"; }); await wait(1200);
await win.evaluate(() => openJob("wonka-full")); await win.waitForSelector("#drawer.open"); await wait(900);
await shot(win, "review");
await win.keyboard.press("Escape"); await wait(500);
// A question the app stopped on, with the form's own choices.
await win.evaluate(() => { location.hash = "#failed"; }); await wait(1200);
await win.evaluate(() => openJob("initech-data")); await win.waitForSelector("#ask-form"); await wait(700);
await win.selectOption('#ask-form select >> nth=0', { index: 1 });
await shot(win, "answer-choices", "#drawer");
await win.keyboard.press("Escape"); await wait(500);
// Move up.
await win.evaluate(() => { location.hash = "#settings"; }); await wait(1500);
if (!(await win.isVisible("[data-mugo]"))) await win.click('summary:has-text("Jobs to look for")');
await win.fill("[data-mutoward]", "more infrastructure and data work");
await win.click("[data-mugo]");
await win.waitForSelector("[data-mulist] .sugg-item");
await win.setViewportSize({ width: SIZE.width, height: 1600 }); await wait(500);
await shot(win, "move-up", "[data-moveup]");
await win.setViewportSize(SIZE);
// Fill out my page, with a few answers typed in.
await win.evaluate(() => { location.hash = "#profile"; }); await wait(1500);
await win.evaluate(() => { const b = document.querySelector("[data-fill-open]"); b.closest("details") && (b.closest("details").open = true); b.scrollIntoView(); });
await win.click("[data-fill-open]");
await win.waitForSelector("[data-fgo]");
const nums = win.locator("[data-fnum] input");
if (await nums.count()) await nums.nth(0).fill("about 15 times a week");
const card = win.locator('[data-fwork="job"]').first();
await card.locator("[name=f_title]").fill("Math tutor");
await card.locator("[name=f_employer]").fill("Initech Learning Center");
await card.locator("[name=f_start]").fill("2020");
await card.locator("[name=f_end]").fill("2022").catch(() => {});
await card.locator("textarea").first().fill("tutored high school students in algebra and intro programming, two evenings a week");
// A window tall enough to hold it all (a taller-than-window capture resizes the page and shifts it), then the
// top of it: the numbers behind your lines and other work.
await win.setViewportSize({ width: SIZE.width, height: 2800 }); await wait(600);
const box = await win.evaluate(() => {
  const form = document.querySelector("[data-fill] .form.fill");
  form.scrollIntoView({ block: "start" });
  const f = form.getBoundingClientRect(), end = document.querySelector('[data-fadd="job"]').getBoundingClientRect();
  return { x: f.left - 16, y: Math.max(0, f.top - 16), width: f.width + 32, height: end.bottom - f.top + 32 };
});
await wait(300);
await win.screenshot({ path: path.join(OUT, "fill-form.png"), clip: box });
console.log("saved docs/images/fill-form.png");
await win.setViewportSize(SIZE);
await app.close();

// The first-run setup, from a fresh start.
const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "ja-shots-new-"));
app = await launch(fresh);
win = await app.firstWindow();
await win.setViewportSize(SIZE);
await win.emulateMedia({ colorScheme: "light" });
await win.waitForSelector('h1:has-text("Apply to jobs while you do something else")');
await wait(800);
await shot(win, "welcome");
await app.close();
ai.close();
