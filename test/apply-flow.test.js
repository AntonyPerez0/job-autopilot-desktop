// The apply flow on local pages, with a mock AI provider, in real Chromium:
// an "Apply now" button that opens the form in a new tab, a form on two pages,
// the final Submit, a dry run that stops before "Next", and a sign-in wall
// that goes to "Apply yourself". Set CHROMIUM_PATH to use a system Chromium.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { chromium } from "playwright-core";
import { approvedExample, exampleAnswers, examplePrefs, tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile } = await import("../core/engine.js");
const { applyTo } = await import("../core/apply.js");
const { openDb } = await import("../core/db.js");
openDb();

const ANSWERS = { "first name": "Jordan", "last name": "Lee", email: "jordan.lee@example.com", phone: "+1 (512) 555-0142",
  "are you 18 or older": "Yes", "days available": "Weekends" };
const PAGES = {
  "/posting": `<h1>Cashier</h1><p>Ring up customers.</p><a href="/form" target="_blank">Apply now</a>`,
  "/form": `<form id="f" onsubmit="return false">
    <div id="p1"><label for="fn">First name *</label><input id="fn" required><label for="ln">Last name *</label><input id="ln" required>
      <label for="em">Email *</label><input id="em" type="email" required>
      <button type="button" id="next" onclick="if(!document.getElementById('fn').value)return;document.getElementById('p1').style.display='none';document.getElementById('p2').style.display='block'">Next</button></div>
    <div id="p2" style="display:none"><label for="ph">Phone *</label><input id="ph" required>
      <label for="ad">Are you 18 or older? *</label><select id="ad" required><option value="">Select...</option><option>Yes</option><option>No</option></select>
      <label for="da">Days available *</label><input id="da" required>
      <button type="submit" onclick="window.SUBMITTED=JSON.stringify([fn.value,ln.value,em.value,ph.value,ad.value,da.value]);document.body.innerHTML='<h2>Thank you for applying!</h2>'">Submit application</button></div>
  </form>`,
  "/ask": `<form id="f" onsubmit="return false"><label for="fn">First name *</label><input id="fn" required>
    <label for="st">Are you currently enrolled in full-time studies? *</label><select id="st" required><option value="">Select...</option><option>Yes</option><option>No</option></select>
    <label for="yr">How many years of professional experience do you have? *</label><input id="yr" required>
    <button type="submit" onclick="if(!fn.value||!st.value||!yr.value)return;window.SUBMITTED=1;document.body.innerHTML='<h2>Thank you for applying!</h2>'">Submit application</button></form>`,
  // One page, whose Submit tells the server (audit 2.10).
  "/form-ping": `<form id="f" onsubmit="return false"><label for="fn">First name *</label><input id="fn" required><label for="ln">Last name *</label><input id="ln" required>
    <label for="em">Email *</label><input id="em" type="email" required>
    <button type="submit" onclick="fetch('/done',{method:'POST',body:'sent'}).then(()=>{document.body.innerHTML='<h2>Thank you for applying!</h2>'})">Submit application</button></form>`,
  // Submit is sent, but the page never confirms (audit 4.1).
  "/form-silent": `<form id="f" onsubmit="return false"><label for="fn">First name *</label><input id="fn" required><label for="ln">Last name *</label><input id="ln" required>
    <label for="em">Email *</label><input id="em" type="email" required>
    <button type="submit" onclick="fetch('/done',{method:'POST',body:'silent'})">Submit application</button></form>`,
  // A posting that moves to a government job site (audit 4.3).
  "/to-gov": `<p>Moving</p><script>location.replace("https://www.governmentjobs.com/careers/acme/jobs/1/clerk")</script>`,
  // A window left open by an earlier posting that keeps opening pages (audit 1.2).
  "/leftover": `<h1>Old posting</h1><script>let n = 0; const t = setInterval(() => { window.open("/stray?" + (++n), "_blank"); if (n >= 20) clearInterval(t); }, 300);</script>`,
  "/stray": `<h1>Sign in</h1><label for="u">Email</label><input id="u"><label for="pw">Password</label><input id="pw" type="password">`,
  "/signin": `<h1>Careers</h1><p>Sign in or create an account to apply.</p><label>Email<input></label><label>Password<input type="password"></label><button>Sign in</button>`,
};
let submitted = null, sends = 0;
const site = http.createServer((req, res) => {
  if (req.url === "/done") { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { submitted = b; sends++; res.end("ok"); }); return; }
  const body = PAGES[req.url.split("?")[0]];
  res.writeHead(body ? 200 : 404, { "content-type": "text/html" });
  res.end(`<!doctype html><html><body>${body || "not found"}</body></html>`);
});
// Mock AI: answers each listed field from ANSWERS by its label.
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const msg = JSON.parse(b);
    const user = (msg.messages.find((m) => m.role === "user") || {}).content || "";
    const fields = (user.split("FORM FIELDS ON THE PAGE")[1] || "").split("\n").map((l) => l.match(/^(\d+)\. (.+?) \[/)).filter(Boolean);
    const answers = fields.map(([, i, label]) => {
      const v = ANSWERS[label.replace(/\*/g, "").trim().toLowerCase().replace(/\?$/, "")];
      return v ? { i: Number(i), label, kind: "fill", value: v } : /resume|cv/i.test(label) ? { i: Number(i), label, kind: "resume" } : { i: Number(i), label, kind: "decide", note: "no answer in your facts" };
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ employer: "Globex", jobTitle: "Cashier", fit: { hardFails: [] }, base: "swe", answers }) } }] }));
  });
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${site.address().port}`;
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" }, windowMode: "headless" });
store.saveAnswers(exampleAnswers()); store.savePrefs(examplePrefs()); store.saveProfile(approvedExample(Profile));

let browser, ctx;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined }); ctx = await browser.newContext(); });
test.after(async () => { await browser.close(); site.close(); ai.close(); });
const job = (path, slug) => ({ slug, title: "Cashier", company: "Globex", location: "Austin, TX", apply_url: base + path, details: "{}" });

test("dry run: opens the form from the posting, fills page 1, never presses Next", async () => {
  const r = await applyTo(job("/posting", "t-dry"), {}, { dryRun: true, browser: ctx });
  assert.strictEqual(r.status, "filled", r.reason);
  assert.match(r.reason, /page 1 of a form with several pages/);
  assert.ok(r.details.kit.some((k) => k.value === "Jordan"));
});

test("live: fills both pages, submits, sees the confirmation", async () => {
  const pagesBefore = ctx.pages().length;
  const r = await applyTo(job("/posting", "t-live"), {}, { dryRun: false, browser: ctx });
  assert.strictEqual(r.status, "applied", r.reason);
  assert.strictEqual(r.details.pages, 2);
  assert.ok(r.details.kit.some((k) => k.page === 2 && k.value === "Weekends"), "page 2 answers recorded");
  assert.ok(ctx.pages().length <= pagesBefore + 1, "the job's tabs were closed");
});

test("a sign-in wall goes to Apply yourself", async () => {
  const r = await applyTo(job("/signin", "t-signin"), {}, { dryRun: false, browser: ctx });
  assert.strictEqual(r.status, "manual");
  assert.match(r.reason, /sign in or create an account/);
});

test("a question only the user can answer: the job stops, the user answers in the app, the next try uses the answers", async () => {
  const { asksFor, saveYourAnswers } = await import("../core/asked.js");
  const j = job("/ask", "t-ask");
  const first = await applyTo(j, {}, { dryRun: false, browser: ctx });
  assert.strictEqual(first.status, "failed");
  const asks = asksFor({ ...j, status: first.status, reason: first.reason }, first.details);
  assert.deepStrictEqual(asks.map((q) => q.label.replace(/\s*\*$/, "")).sort(), ["Are you currently enrolled in full-time studies?", "How many years of professional experience do you have?"]);
  assert.deepStrictEqual(asks.find((q) => /enrolled/.test(q.label)).options, ["Yes", "No"]);
  saveYourAnswers(j, asks.map((q) => ({ label: q.label, value: /enrolled/.test(q.label) ? "No" : "2", remember: true })));
  const second = await applyTo(j, {}, { dryRun: false, browser: ctx });
  assert.strictEqual(second.status, "applied", second.reason);
  assert.ok(second.details.audit.some((x) => /your answer used for "Are you currently enrolled/.test(x)));
  assert.ok(second.details.kit.some((k) => k.note === "your answer" && k.value === "2"));
});

test("a window left open by another posting never becomes this job's form, and nothing this job opened outlives it (audit 1.2)", async () => {
  const leftover = await ctx.newPage();
  await leftover.goto(base + "/leftover");
  const before = new Set(ctx.pages());
  const r = await applyTo(job("/posting", "t-leftover"), {}, { dryRun: true, browser: ctx });
  assert.strictEqual(r.status, "filled", r.reason);
  assert.ok(r.details.kit.some((k) => k.value === "Jordan"), "the form is the posting's own popup");
  assert.ok(!r.details.kit.some((k) => /password/i.test(k.label)), "never a stray sign-in page");
  const after = ctx.pages().filter((pg) => !before.has(pg));
  assert.deepStrictEqual(after.map((pg) => pg.url()), [], "no page opened during the job is left");
  await leftover.close();
  for (const pg of ctx.pages().filter((x) => /\/stray/.test(x.url()))) await pg.close();
});

test("'Back to dry run' or Pause pressed during a live run stops the Submit (audit 2.10)", async () => {
  for (const [label, change] of [["dry run", { dryRun: true }], ["pause", { paused: true }]]) {
    store.saveSettings({ dryRun: false, paused: false });
    submitted = null;
    const t = setTimeout(() => store.saveSettings(change), 10000);
    const r = await applyTo(job("/form-ping", "t-halt-" + label.replace(" ", "")), {}, { dryRun: false, browser: ctx });
    clearTimeout(t);
    assert.strictEqual(r.status, "manual", `${label}: ${r.reason}`);
    assert.match(r.reason, label === "pause" ? /paused the autopilot/ : /switched back to dry run/);
    assert.strictEqual(submitted, null, `${label}: Submit never fired`);
  }
  store.saveSettings({ dryRun: true, paused: false });
});

test("a run that timed out stops before Submit and reports nothing more (audit 4.2)", async () => {
  store.saveSettings({ dryRun: false, paused: false });
  submitted = null;
  const ctrl = new AbortController(), after = [];
  setTimeout(() => ctrl.abort(), 10000);
  await assert.rejects(applyTo(job("/form-ping", "t-timeout"), { progress: (k) => { if (ctrl.signal.aborted) after.push(k); } }, { dryRun: false, browser: ctx, signal: ctrl.signal }), /timed out/);
  assert.strictEqual(submitted, null, "Submit never fired");
  assert.deepStrictEqual(after, [], "no step reported after the timeout");
  const { withTimeout } = await import("../core/worker.js");
  let seen;
  await assert.rejects(withTimeout((sig) => { seen = sig; return new Promise(() => {}); }, 50), /timed out/);
  assert.ok(seen.aborted, "the run's signal is aborted when its time is up");
  store.saveSettings({ dryRun: true });
});

test("http:// is never opened, and a page that moves to a government site ends as Apply yourself (audit 4.3, 4.6)", async () => {
  const hits = [];
  await ctx.route("http://plain.example/**", (r) => { hits.push(r.request().url()); return r.fulfill({ contentType: "text/html", body: PAGES["/form-ping"] }); });
  await ctx.route("https://www.governmentjobs.com/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><html><body>${PAGES["/form-ping"]}</body></html>` }));
  const plain = await applyTo({ ...job("/", "t-http"), apply_url: "http://plain.example/jobs/1" }, {}, { dryRun: true, browser: ctx });
  assert.strictEqual(plain.status, "manual");
  assert.match(plain.reason, /doesn't use https/);
  assert.deepStrictEqual(hits, [], "never reached page.goto");
  const gov = await applyTo(job("/to-gov", "t-gov"), {}, { dryRun: true, browser: ctx });
  assert.strictEqual(gov.status, "manual", gov.reason);
  assert.match(gov.reason, /government job site/);
  await ctx.unroute("http://plain.example/**"); await ctx.unroute("https://www.governmentjobs.com/**");
});

// The whole loop, in the app's own browser (Playwright's Chromium): skipped where it isn't installed.
const { chromiumPath } = await import("../core/browser.js");
test("dailyCap 1: the loop stops after one Submit, even when the page doesn't confirm (audit 4.1)", { skip: !chromiumPath() && "no Playwright Chromium here" }, async () => {
  const db = (await import("../core/db.js")).getDb();
  const { appliedToday, getJob } = await import("../core/db.js");
  const worker = await import("../core/worker.js");
  db.prepare("DELETE FROM jobs").run();
  store.savePrefs({ ...examplePrefs(), boards: { freehire: false, hiringcafe: false, simplify: false, google: false } });
  store.saveSettings({ dryRun: false, paused: false, reviewedDryRun: true, dailyCap: 1, minutesBetweenApplies: 0, maxAttempts: 3, searchEveryMinutes: 600, browser: "chromium", windowMode: "headless" });
  for (const slug of ["cap-1", "cap-2"]) db.prepare("INSERT INTO jobs (slug, key, title, company, location, url, apply_url, status, details) VALUES (?, ?, 'Cashier', ?, 'Austin, TX', ?, ?, 'queued', '{}')")
    .run(slug, slug, slug === "cap-1" ? "Globex" : "Initech", base + "/form-silent?" + slug, base + "/form-silent?" + slug);
  sends = 0;
  const run = worker.run();
  try {
    for (let i = 0; i < 240 && !/daily cap reached/.test(worker.state.now); i++) await new Promise((r) => setTimeout(r, 1000));
    assert.match(worker.state.now, /daily cap reached/);
  } finally { worker.stop(); await run; }
  assert.strictEqual(sends, 1, "one Submit");
  const first = getJob("cap-1");
  assert.strictEqual(first.status, "failed");
  assert.match(first.reason, /may have gone through/);
  assert.ok(first.applied_at, "its submit time is kept");
  assert.strictEqual(getJob("cap-2").status, "queued", "the next one waits for tomorrow");
  assert.strictEqual(appliedToday(), 1);
  store.saveSettings({ dryRun: true, dailyCap: 10 });
});
