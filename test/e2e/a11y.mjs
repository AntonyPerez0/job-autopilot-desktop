// Accessibility check: every page and a job's panel, in light and dark, against WCAG 2.2 AA (axe-core),
// at a small window and a large one, plus the keyboard: the sidebar and the job rows are reached with Tab,
// Enter opens a job, Escape closes it and puts the focus back where it was.
//
//   node test/e2e/a11y.mjs           (on Linux CI: xvfb-run -a node test/e2e/a11y.mjs)
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { _electron as electron } from "playwright-core";
import { DatabaseSync } from "node:sqlite";
import { Profile } from "../../core/engine.js";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const OUT = path.join(ROOT, "test", "out", "a11y");
fs.mkdirSync(OUT, { recursive: true });

// A made-up person with a few jobs in every state.
const data = fs.mkdtempSync(path.join(os.tmpdir(), "ja-a11y-"));
const w = (f, o) => fs.writeFileSync(path.join(data, f), JSON.stringify(o));
const profile = JSON.parse(JSON.stringify(Profile.EXAMPLE));
for (const k of ["experience", "projects", "skills", "education", "summaries"]) for (const e of profile[k] || []) { e.approved = true; for (const b of e.bullets || []) b.approved = true; }
w("profile.json", profile);
w("settings.json", { onboarded: true, acceptedTerms: true, dryRun: true, paused: true, uiMode: process.env.MODE || "advanced",
  ai: { provider: "custom", apiBase: "http://127.0.0.1:9/v1", model: "mock" } });
w("prefs.json", { titles: ["Software Engineer", "Data Analyst"], cities: [{ name: "Austin", label: "Austin, TX", country: "US", admin1: "TX", lat: 30.27, lon: -97.74 }], remote: true });
w("answers.json", { firstName: "Jordan", lastName: "Lee", email: "jordan@example.com", phone: "555-0100", city: "Austin", state: "TX" });
const db = new DatabaseSync(path.join(data, "autopilot.db"));
db.exec(fs.readFileSync(path.join(ROOT, "core", "db.js"), "utf8").match(/CREATE TABLE IF NOT EXISTS jobs[\s\S]*?\);\nCREATE TABLE IF NOT EXISTS events[\s\S]*?\);/)[0]);
const job = db.prepare("INSERT INTO jobs (slug, title, company, location, source, url, status, reason, details, applied_at, attempts) VALUES (?, ?, ?, ?, 'greenhouse', ?, ?, ?, ?, ?, 1)");
const J = [
  ["globex-1", "Software Engineer", "Globex", "Austin, TX", "applied", "", {}, "2026-10-20 10:00:00"],
  ["initech-2", "Backend Engineer", "Initech", "Remote", "failed", "could not fill every required field: required, no answer: How did you hear about us?; still empty: Preferred shift",
    { fields: [{ type: "select", label: "How did you hear about us?", options: ["Select...", "LinkedIn", "Job board"] }, { type: "listbox", label: "Preferred shift" }] }, null],
  ["acme-3", "Data Analyst", "Acme", "Austin, TX", "filled", "dry run: filled and checked", { kit: [{ label: "Name", value: "Jordan Lee", kind: "text" }, { label: "Why us?", value: "I like the product.", kind: "draft" }], audit: ["kept to your facts"] }, null],
  ["globex-4", "Data Engineer", "Globex", "Remote", "queued", "", {}, null],
  ["initech-5", "Web Developer", "Initech", "Austin, TX", "manual", "Apply yourself: this site needs your own account", {}, null],
  ["acme-6", "Frontend Engineer", "Acme", "Remote", "skipped", "not a fit: needs 8 years", {}, null],
];
for (const [slug, title, company, location, status, reason, details, at] of J) job.run(slug, title, company, location, `https://example.com/${slug}`, status, reason, JSON.stringify(details), at);
db.prepare("INSERT INTO events (slug, level, message) VALUES (?, ?, ?)").run("globex-1", "info", "applied: the employer confirmed it");
db.close();

const args = process.env.JA_APP_EXE ? [] : [ROOT];
if (process.platform === "linux") args.push("--no-sandbox", ...(process.env.DISPLAY ? [] : ["--ozone-platform=headless"]));
const app = await electron.launch({ executablePath: process.env.JA_APP_EXE || require("electron"), args,
  env: { ...process.env, JA_DATA_DIR: data, JA_API_KEY: "test" }, timeout: 120000 });
const win = await app.firstWindow();
win.setDefaultTimeout(30000);
await win.waitForSelector('h1:has-text("Overview")');

const problems = [];
async function audit(name) {
  await win.evaluate(AXE);
  const r = await win.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] })).violations
    .map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")} :: ${(n.failureSummary || "").split("\n").slice(1, 2).join("").trim().slice(0, 160)}`), count: v.nodes.length })));
  for (const v of r) problems.push({ where: name, ...v });
}
const go = async (view) => { await win.evaluate((v) => { location.hash = "#" + v; }, view); await win.waitForTimeout(700); };
const VIEWS = ["overview", "applied", "queued", "failed", "manual", "filled", "skipped", "all", "log", "profile", "settings"];

for (const size of process.env.QUICK ? [] : [{ width: 900, height: 700 }, { width: 2200, height: 1250 }]) {
  await win.setViewportSize(size).catch(() => {});
  for (const scheme of ["light", "dark"]) {
    await win.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    for (const v of VIEWS) {
      await go(v);
      if (v === "settings" || v === "profile") await win.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
      await win.waitForTimeout(300);
      await audit(`${v} (${scheme}, ${size.width}px)`);
      if (size.width > 1000 && scheme === "dark") await win.screenshot({ path: path.join(OUT, `${v}-${scheme}-${size.width}.png`), fullPage: true });
    }
    for (const slug of ["initech-2", "acme-3"]) {
      await go(slug === "initech-2" ? "failed" : "filled");
      await win.evaluate((s) => openJob(s), slug);
      await win.waitForSelector("#drawer.open");
      await win.waitForTimeout(500);
      await audit(`job panel ${slug} (${scheme}, ${size.width}px)`);
      await win.keyboard.press("Escape");
      await win.waitForSelector("#drawer.open", { state: "detached" }).catch(() => {});
    }
  }
}

// The keyboard alone: Tab reaches the sidebar's pages and a job; Enter opens it; Escape closes it and focus returns.
await win.setViewportSize({ width: 1400, height: 900 }).catch(() => {});
await go("all");
await win.evaluate(() => document.activeElement && document.activeElement.blur());
const reached = new Set();
let opened = false, returned = false;
for (let i = 0; i < 80 && !opened; i++) {
  await win.keyboard.press("Tab");
  const f = await win.evaluate(() => { const a = document.activeElement; return a ? { text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 40), job: a.dataset.job || "", nav: a.classList.contains("nav") } : {}; });
  if (f.nav) reached.add(f.text.split("\n")[0]);
  if (f.job) {
    await win.keyboard.press("Enter");
    await win.waitForSelector("#drawer.open", { timeout: 5000 });
    opened = true;
    await win.waitForTimeout(300);
    const inside = await win.evaluate(() => document.getElementById("drawer").contains(document.activeElement));
    if (!inside) console.log("focus is on:", await win.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 200)));
    assert.ok(inside, "opening a job moves the focus into its panel");
    await win.keyboard.press("Escape");
    await win.waitForTimeout(600);
    returned = await win.evaluate((slug) => document.activeElement && document.activeElement.dataset.job === slug, f.job);
  }
}
await app.close();
console.log("keyboard: sidebar pages reached:", [...reached].join(", "));

// The first-run setup, from a fresh start: the welcome step and the AI step.
const fresh = fs.mkdtempSync(path.join(os.tmpdir(), "ja-a11y-new-"));
const app2 = await electron.launch({ executablePath: process.env.JA_APP_EXE || require("electron"), args, env: { ...process.env, JA_DATA_DIR: fresh }, timeout: 120000 });
const w2 = await app2.firstWindow();
w2.setDefaultTimeout(30000);
await w2.waitForSelector('h1:has-text("Apply to jobs while you do something else")');
const audit2 = async (name) => {
  await w2.evaluate(AXE);
  const r = await w2.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] })).violations
    .map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(" ")} :: ${(n.failureSummary || "").split("\n").slice(1, 2).join("").trim().slice(0, 160)}`), count: v.nodes.length })));
  for (const v of r) problems.push({ where: name, ...v });
};
for (const scheme of ["light", "dark"]) { await w2.emulateMedia({ colorScheme: scheme }); await w2.waitForTimeout(300); await audit2(`setup: welcome (${scheme})`); }
await w2.click('.jobkind:has-text("Both")');
await w2.check("#terms");
await w2.click("#next");
await w2.waitForSelector('h1:has-text("Connect an AI model")');
await w2.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
for (const scheme of ["light", "dark"]) { await w2.emulateMedia({ colorScheme: scheme }); await w2.waitForTimeout(300); await audit2(`setup: AI (${scheme})`); }
await app2.close();
if (!reached.has("Overview") || !reached.has("Settings")) problems.push({ where: "keyboard", id: "keyboard-nav", help: "The sidebar's pages can't all be reached with Tab", nodes: [], count: 1 });
if (!opened) problems.push({ where: "keyboard", id: "keyboard-job", help: "A job can't be opened with the keyboard", nodes: [], count: 1 });
else if (!returned) problems.push({ where: "keyboard", id: "focus-return", help: "Closing a job doesn't put the focus back on it", nodes: [], count: 1 });

fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(problems, null, 2));
const byRule = {};
for (const p of problems) (byRule[p.id] ||= { help: p.help, where: [], nodes: p.nodes }).where.push(p.where);
for (const [id, x] of Object.entries(byRule)) console.log(`✖ ${id}: ${x.help}\n    on ${x.where.length} page(s): ${x.where.slice(0, 4).join("; ")}\n    ${x.nodes.slice(0, 3).join("\n    ")}`);
if (problems.length) { console.log(`A11Y FAIL: ${Object.keys(byRule).length} rule(s)`); process.exit(1); }
console.log("A11Y PASS: WCAG 2.2 AA (axe-core) on every page and a job's panel, light and dark, small and large windows; keyboard checks");
