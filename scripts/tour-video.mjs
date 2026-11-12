// The 60-second tour at the top of the README, made again from the app as it is now:
//   node scripts/tour-video.mjs          -> out/tour.mp4 (needs ffmpeg)
// It runs the real app three times (the first two setup screens; the rest of the setup and the first practice
// application; a couple of weeks later) and records the window. Everything shown is made up: the example person
// (Jordan Lee) and fictional companies. No AI is called and nothing leaves the computer.
// GitHub only plays a video in a README from a file dropped into one of its own text boxes: drag out/tour.mp4 into a
// comment box on github.com (it needn't be posted), and put the link it gives in the README.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron } from "playwright-core";
import { Profile } from "../core/engine.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const OUT = path.join(ROOT, "out");
const require = createRequire(import.meta.url);
// The window is recorded a little shorter than the video: the captions go in a band under it, clear of the app.
const SIZE = { width: 1280, height: 656 }, BAND = 64;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ja-shots-"));

// ---------- made-up data ----------
const AI = { provider: "custom", apiBase: "http://127.0.0.1:9/v1", model: "z-ai/glm-5.3-flash" };
const ANSWERS = { firstName: "Jordan", lastName: "Lee", email: "jordan.lee@example.com", phone: "+1 (512) 555-0142", street: "100 Example St", city: "Austin", state: "TX", zip: "78701",
  workAuthorized: "yes", needsSponsorship: "no", over18: "yes", totalYears: 4.5, years: [{ type: "Software engineering", years: 3 }] };
const PREFS = { jobKind: "office", titles: ["Software Engineer", "Backend Engineer"], cities: [{ name: "Austin", label: "Austin, TX", country: "US", admin1: "TX", lat: 30.27, lon: -97.74 }], remote: true,
  boards: { freehire: true, hiringcafe: false, simplify: false, google: false } };
// Nowhere to search, so the app in the recording never goes looking (the setup wants one place ticked, so it's set
// once the setup has been through that step).
const NO_SEARCH = { boards: { freehire: false, hiringcafe: false, simplify: false, google: false } };
const ago = (h) => new Date(Date.now() - h * 3600e3).toISOString().replace("T", " ").slice(0, 19);
function seed(dir, { settings, profile = null, jobs = [], reply = false }) {
  const w = (f, o) => fs.writeFileSync(path.join(dir, f), JSON.stringify(o));
  w("settings.json", { acceptedTerms: true, searchEveryMinutes: 100000, ai: AI, ...settings });
  w("prefs.json", settings.onboarded ? { ...PREFS, ...NO_SEARCH } : PREFS); w("answers.json", ANSWERS);
  if (profile) w("profile.json", profile);
  const db = new DatabaseSync(path.join(dir, "autopilot.db"));
  db.exec(fs.readFileSync(path.join(ROOT, "core", "db.js"), "utf8").match(/CREATE TABLE IF NOT EXISTS jobs[\s\S]*?\);\nCREATE TABLE IF NOT EXISTS events[\s\S]*?\);/)[0]);
  db.exec("ALTER TABLE jobs ADD COLUMN filled_at TEXT");
  const add = db.prepare("INSERT INTO jobs (slug, title, company, location, source, url, apply_url, salary, status, reason, details, applied_at, updated_at, found_at, posted_at, filled_at, attempts) VALUES (?, ?, ?, ?, 'greenhouse', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)");
  for (const [slug, title, company, location, status, h, x = {}] of jobs) {
    add.run(slug, title, company, location, `https://example.com/jobs/${slug}`, `https://example.com/apply/${slug}`, x.salary || "", status, x.reason || "", JSON.stringify(x.details || {}),
      status === "applied" ? new Date(Date.now() - h * 3600e3).toISOString() : null, ago(h), ago(h + 2), ago(h + 60), status === "filled" ? new Date(Date.now() - h * 3600e3).toISOString() : null);
  }
  if (reply) db.prepare("INSERT INTO replies (id, slug, at, sender, subject, kind, snippet) VALUES (?, ?, ?, ?, ?, ?, ?)").run("<r1@globex.test>", "globex-swe", new Date(Date.now() - 2 * 3600e3).toISOString(),
    "Globex Recruiting <jobs@globex.test>", "Next steps for Software Engineer", "interview", "Hi Jordan, we'd like to set up a 30 minute call. What times work for you this week?");
  db.close();
}
const KIT = [{ label: "First name", value: "Jordan", kind: "text" }, { label: "Email", value: "jordan.lee@example.com", kind: "text" },
  { label: "Are you legally authorized to work in the US?", value: "Yes", kind: "text" },
  { label: "Why do you want to work here?", value: "I like building tools people use every day, like the scheduling service 40 clinics use.", kind: "draft", note: "From your summary and your Acme Health line" },
  { label: "Resume", value: "Jordan_Lee_resume.pdf", kind: "file" }];
const PRACTICE = ["wonka-full", "Full Stack Engineer", "Wonka", "Round Rock, TX", "filled", 1, { salary: "USD 110,000-130,000/year", reason: "practice run: filled and checked, not sent",
  details: { kit: KIT, audit: ["Every answer matched your approved resume"], check: { met: 2, checked: 2, items: [{ text: "Experience with Python", priority: "required", status: "met", why: "your resume shows python" },
    { text: "REST APIs", priority: "required", status: "met", why: "your resume shows rest apis" }] } } }];
const LEFT_OUT = [["acme-sec", "Security Engineer", "Acme", "Austin, TX", "skipped", 3, { reason: "the posting requires a security clearance, and your resume doesn't list one" }],
  ["hooli-staff", "Staff Engineer", "Hooli", "Remote, US", "skipped", 3, { reason: "asks for 8+ years of experience (you have about 4.5; jobs asking for more than 6 are left out)" }]];
const approved = () => { const p = JSON.parse(JSON.stringify(Profile.EXAMPLE));
  for (const k of ["experience", "projects", "skills", "education", "summaries", "bases", "headers"]) for (const e of p[k] || []) { e.approved = true; for (const x of e.bullets || []) x.approved = true; } return p; };

// ---------- recording ----------
const args = [ROOT];
if (process.platform === "linux") args.push("--no-sandbox", ...(process.env.DISPLAY ? [] : ["--ozone-platform=headless"]));
const clips = [];
// One run of the app: play(win, say, press) acts the scene out; the part before the first caption is cut.
async function scene(name, dir, play) {
  const videos = path.join(tmp, name);
  const app = await electron.launch({ executablePath: require("electron"), args, env: { ...process.env, JA_DATA_DIR: dir, JA_BACKUP_DIR: path.join(dir, "none") }, timeout: 120000,
    recordVideo: { dir: videos, size: SIZE } });
  const win = await app.firstWindow();
  const opened = Date.now();
  win.setDefaultTimeout(60000);
  await win.setViewportSize(SIZE);
  await win.emulateMedia({ colorScheme: "light" });
  await wait(1500); // the recording catches up with the window's size
  let from = null;
  // A dot where the pointer is (a recording doesn't show it on its own).
  const dress = () => win.evaluate(() => {
    if (document.getElementById("tour-dot")) return;
    const dot = document.createElement("div"); dot.id = "tour-dot";
    dot.style.cssText = "position:fixed;left:-50px;top:-50px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(79,70,229,.55);border:2px solid #fff;box-shadow:0 0 0 1px rgba(79,70,229,.8);z-index:99999;pointer-events:none;transition:transform .12s";
    document.body.append(dot);
    addEventListener("mousemove", (e) => { dot.style.left = e.clientX + "px"; dot.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", () => { dot.style.transform = "scale(.6)"; }, true);
    addEventListener("mouseup", () => { dot.style.transform = "scale(1)"; }, true);
  });
  const cues = [];
  let at = { x: SIZE.width / 2, y: SIZE.height / 2 };
  // A caption, from now until the next one.
  const say = async (text, ms = 3500) => {
    const t = (Date.now() - opened) / 1000;
    if (from === null) from = t;
    cues.push({ at: t, text });
    await wait(ms);
  };
  const press = async (selector, { after = 600 } = {}) => {
    await dress();
    const el = win.locator(selector).first();
    await el.scrollIntoViewIfNeeded();
    await wait(150);
    const b = await el.boundingBox();
    const to = { x: b.x + Math.min(b.width / 2, 120), y: b.y + b.height / 2 };
    await win.mouse.move(at.x, at.y);
    await win.mouse.move(to.x, to.y, { steps: 20 });
    at = to;
    await wait(250);
    await win.mouse.down(); await wait(110); await win.mouse.up();
    await wait(after);
  };
  try { await play(win, say, press); }
  catch (e) { await win.screenshot({ path: path.join(OUT, "tour-stuck.png") }).catch(() => {}); await app.close().catch(() => {}); throw e; }
  const length = (Date.now() - opened) / 1000;
  const video = win.video();
  await app.close();
  clips.push({ file: await video.path(), from: Math.max(0, from || 0), to: length, cues });
}

// 1. The first two setup screens, as a new person sees them.
const d1 = fs.mkdtempSync(path.join(os.tmpdir(), "ja-shots-"));
await scene("one", d1, async (win, say, press) => {
  await win.waitForSelector('h1:has-text("Apply to jobs while you do something else")');
  await wait(600);
  await say("Job Autopilot finds jobs that fit you, and applies for you.", 3000);
  await press('.jobkind:has-text("Office")', { after: 400 });
  await say("Say what kind of work you want.", 1300);
  await win.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })); await wait(900);
  await press("#terms", { after: 400 });
  await press("#next", { after: 300 });
  await win.waitForSelector('h1:has-text("Connect an AI")');
  await say("Connect an AI once: it costs about a cent per application.", 3200);
});

// 2. The rest of the setup, then the first practice application.
const d2 = fs.mkdtempSync(path.join(os.tmpdir(), "ja-shots-"));
seed(d2, { settings: { setupStep: 2 }, jobs: [PRACTICE, ...LEFT_OUT] });
await scene("two", d2, async (win, say, press) => {
  await win.waitForSelector('h1:has-text("Your resume")');
  await wait(600);
  await win.evaluate(() => { const e = document.getElementById("err"); if (e) e.innerHTML = ""; });
  await say("Add your resume, or tell the app about your work and it writes one with you.", 3300);
  await press("[data-example]", { after: 300 });
  await win.waitForSelector('h1:has-text("Check your resume")');
  await say("Read every line. Only what you approve is ever sent.", 2800);
  await press("[data-approve-everything]", { after: 700 });
  await press("[data-yes]", { after: 900 });
  await press("#next", { after: 300 });
  await win.waitForSelector('h1:has-text("About you")');
  await say("Your details, typed once. Legal questions are always yours to answer.", 2800);
  await press("#next", { after: 300 });
  await win.waitForSelector('h1:has-text("What jobs to look for")');
  await say("The jobs you want, where, and how far you'd go.", 2600);
  await press("#next", { after: 300 });
  await win.waitForSelector('h1:has-text("ready to practice")');
  await win.evaluate((p) => window.ja.api("/api/prefs/save", { prefs: p }), NO_SEARCH);
  await say("It starts in practice mode: applications are filled in, and nothing is sent.", 2800);
  await press("#next", { after: 300 });
  await win.waitForSelector('h1:has-text("Overview")');
  await wait(900);
  await say("A little later: your first practice application is ready to check.", 2800);
  await press('.todo-card [data-open-job="wonka-full"]', { after: 300 });
  await win.waitForSelector("#drawer.open");
  await wait(500);
  await say("Every answer it gave, and where each one came from.", 2000);
  await win.evaluate(() => document.getElementById("drawer").scrollTo({ top: 420, behavior: "smooth" })); await wait(1900);
  await win.evaluate(() => document.getElementById("drawer").scrollTo({ top: 0, behavior: "smooth" })); await wait(900);
  await say("When it looks right, start sending.", 1200);
  await press("#drawer [data-start-sending]", { after: 300 });
  await win.waitForSelector(".modal #m-go");
  await say("From then on it applies for you, up to 10 a day.", 3000);
});

// 3. A couple of weeks later.
const d3 = fs.mkdtempSync(path.join(os.tmpdir(), "ja-shots-"));
seed(d3, { settings: { onboarded: true, dryRun: false, reviewedDryRun: true, uiMode: "simple", dismissed: ["tip-todo", "mailbox-tip"] }, profile: approved(), reply: true, jobs: [
  ["soylent-py", "Python Developer", "Soylent", "Round Rock, TX", "applied", 3, { details: { kit: KIT } }],
  ["globex-swe", "Software Engineer", "Globex", "Austin, TX", "applied", 30, { salary: "USD 120,000-140,000/year", details: { kit: KIT } }],
  ["initech-be", "Backend Engineer", "Initech", "Remote, US", "applied", 52, { details: { kit: KIT } }],
  ["acme-plat", "Platform Engineer", "Acme", "Austin, TX", "applied", 75, { details: { kit: KIT } }],
  ["vandelay-api", "API Engineer", "Vandelay Industries", "Dallas, TX", "applied", 98, { details: { kit: KIT } }],
  ["hooli-full", "Full Stack Engineer", "Hooli", "Remote, US", "applied", 120, { details: { kit: KIT } }],
  ["globex-ml", "Platform Engineer", "Stark Industries", "Austin, TX", "manual", 8, { reason: "Apply yourself: this site needs your own account" }],
  ...LEFT_OUT] });
await scene("three", d3, async (win, say, press) => {
  await win.waitForSelector('h1:has-text("Overview")');
  await wait(1200);
  await say("It keeps applying at a steady pace, and tells you when an employer writes back.", 3600);
  await press('.todo-card [data-open-job="globex-swe"]', { after: 300 });
  await win.waitForSelector("#drawer.open");
  await say("Whatever needs you waits in your To do list. The rest it does on its own.", 3800);
});

// ---------- one file ----------
const font = (() => { try { return execFileSync("fc-match", ["-f", "%{file}", "sans:bold"]).toString().trim(); } catch { return ""; } })();
const parts = clips.map((c, i) => {
  const out = path.join(tmp, `part${i}.mp4`);
  const text = c.cues.map((q, n) => {
    const f = path.join(tmp, `cue-${i}-${n}.txt`);
    fs.writeFileSync(f, q.text);
    const a = Math.max(0, q.at - c.from), b = (c.cues[n + 1] ? c.cues[n + 1].at : c.to) - c.from;
    return `drawtext=${font ? `fontfile=${font}:` : ""}textfile=${f}:fontcolor=white:fontsize=23:x=(w-text_w)/2:y=${SIZE.height}+(${BAND}-text_h)/2:enable='between(t,${a.toFixed(2)},${b.toFixed(2)})'`;
  });
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", c.from.toFixed(2), "-to", c.to.toFixed(2), "-i", c.file,
    "-vf", [`fps=30`, `scale=${SIZE.width}:${SIZE.height}:flags=lanczos`, `pad=${SIZE.width}:${SIZE.height + BAND}:0:0:color=0x13161d`, ...text, "format=yuv420p"].join(","),
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-an", out]);
  return out;
});
const list = path.join(tmp, "list.txt");
fs.writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
const final = path.join(OUT, "tour.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", final]);
const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", final]).toString().trim());
console.log(`saved ${path.relative(ROOT, final)}: ${seconds.toFixed(1)} seconds, ${(fs.statSync(final).size / 1e6).toFixed(1)} MB`);
for (const d of [tmp, d1, d2, d3]) fs.rmSync(d, { recursive: true, force: true });
