// Job site accounts on a practice copy of a Workday site (served by Playwright under a real
// *.myworkdayjobs.com address): sign up, confirm from the "email", sign in, fill every page, and
// stop before Submit in a dry run; sign straight in the next time; never without the user's go-ahead.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { chromium } from "playwright-core";
import { approvedExample, exampleAnswers, examplePrefs, tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
process.env.JA_SITE_PASSWORD = "Tow-Truck-2026!";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile } = await import("../core/engine.js");
const { applyTo } = await import("../core/apply.js");
const { openDb } = await import("../core/db.js");
const A = await import("../core/accounts.js");
openDb();

const HOST = "https://globex.wd5.myworkdayjobs.com";
const site = { accounts: {}, submitted: 0, verifyLinks: [] };
const W = (id) => `data-automation-id="${id}"`;
const shell = (body, script = "") => `<!doctype html><html><body>${body}<script>${script}</script></body></html>`;
const PAGES = {
  "/en-US/careers/job/Austin/Driver_R1": shell(`<h1>Delivery Driver</h1><p>Drive the route.</p><button ${W("adventureButton")} onclick="document.getElementById('m').hidden=false">Apply</button>
    <div id="m" hidden><a ${W("applyManually")} href="/en-US/careers/job/Austin/Driver_R1/apply">Apply Manually</a></div>`),
  "/en-US/careers/job/Austin/Driver_R1/apply": shell(`<div id="in"><h2>Sign In</h2><label>Email Address<input ${W("email")} type="email" id="e"></label><label>Password<input ${W("password")} type="password" id="p"></label>
      <button ${W("signInSubmitButton")} onclick="go('signin')">Sign In</button><button ${W("createAccountLink")} onclick="document.getElementById('in').hidden=true;document.getElementById('up').hidden=false">Create Account</button></div>
    <div id="up" hidden><h2>Create Account</h2><label>Email Address<input ${W("email")} type="email" id="e2"></label><label>Password<input ${W("password")} type="password" id="p2"></label>
      <label>Verify New Password<input ${W("verifyPassword")} type="password" id="v2"></label><label><input type="checkbox" ${W("createAccountCheckbox")} id="t2">I agree to the terms</label>
      <button ${W("createAccountSubmitButton")} onclick="go('create')"><div ${W("click_filter")}></div>Create Account</button></div>
    <div id="msg" role="alert"></div>`,
  `async function go(what) {
     const up = what === 'create';
     const body = up ? { email: e2.value, password: p2.value, verify: v2.value, terms: t2.checked } : { email: e.value, password: p.value };
     const r = await (await fetch('/api/' + what, { method: 'POST', body: JSON.stringify(body) })).json();
     if (r.next) location.href = r.next; else { msg.textContent = r.message; if (r.signin) { document.getElementById('up').hidden = true; document.getElementById('in').hidden = false; } }
   }`),
  "/apply/my-information": shell(`<h2>My Information</h2><label for="fn">First Name *</label><input id="fn" required><label for="ln">Last Name *</label><input id="ln" required>
    <label for="ph">Phone Number *</label><input id="ph" required>
    <button ${W("pageFooterNextButton")} onclick="if(fn.value&&ln.value&&ph.value)location.href='/apply/questions'">Save and Continue</button>`),
  "/apply/questions": shell(`<h2>Application Questions</h2><label for="ad">Are you 18 or older? *</label><select id="ad" required><option value="">Select One</option><option>Yes</option><option>No</option></select>
    <label for="dl">Do you have a valid driver's license? *</label><select id="dl" required><option value="">Select One</option><option>Yes</option><option>No</option></select>
    <button ${W("pageFooterNextButton")} onclick="if(ad.value&&dl.value)location.href='/apply/review'">Save and Continue</button>`),
  "/apply/review": shell(`<h2>Review</h2><p>Check your application.</p><button ${W("pageFooterNextButton")} onclick="fetch('/api/submit',{method:'POST'}).then(()=>{document.body.innerHTML='<h2>Thank you for applying!</h2>'})">Submit</button>`),
};
function api(path, body) {
  if (path === "/api/create") {
    if (!body.terms) return { message: "You must agree to the terms." };
    if (body.password !== body.verify) return { message: "Passwords do not match." };
    if (site.accounts[body.email]) return { message: "An account with this email already exists.", signin: true };
    site.accounts[body.email] = { password: body.password, verified: false };
    site.verifyLinks.push(`${HOST}/verify?u=${encodeURIComponent(body.email)}`);
    return { message: "We've sent you an email. Verify your account to sign in.", signin: true };
  }
  if (path === "/api/signin") {
    const a = site.accounts[body.email];
    if (!a || a.password !== body.password) return { message: "Wrong email address or password." };
    if (!a.verified) return { message: "Verify your email address before you sign in." };
    return { next: "/apply/my-information" };
  }
  if (path === "/api/submit") { site.submitted++; return { ok: true }; }
  return {};
}

const ANSWERS = { "first name": "Jordan", "last name": "Lee", "phone number": "+1 (512) 555-0142", "are you 18 or older": "Yes", "do you have a valid driver's license": "Yes" };
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const msg = JSON.parse(b);
    const user = (msg.messages.find((m) => m.role === "user") || {}).content || "";
    const fields = (user.split("FORM FIELDS ON THE PAGE")[1] || "").split("\n").map((l) => l.match(/^(\d+)\. (.+?) \[/)).filter(Boolean);
    const answers = fields.map(([, i, label]) => {
      const v = ANSWERS[label.replace(/\*/g, "").trim().toLowerCase().replace(/\?$/, "")];
      return v ? { i: Number(i), label, kind: "fill", value: v } : { i: Number(i), label, kind: "decide" };
    });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ employer: "Globex", jobTitle: "Delivery Driver", fit: { hardFails: [] }, base: "swe", answers }) } }] }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" }, windowMode: "headless" });
store.saveAnswers(exampleAnswers()); store.savePrefs(examplePrefs()); store.saveProfile(approvedExample(Profile));

let browser, ctx;
test.before(async () => {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  ctx = await browser.newContext();
  await ctx.route(`${HOST}/**`, async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.startsWith("/api/")) return route.fulfill({ contentType: "application/json", body: JSON.stringify(api(u.pathname, JSON.parse(route.request().postData() || "{}"))) });
    if (u.pathname === "/verify") { const a = site.accounts[u.searchParams.get("u")]; if (a) a.verified = true; return route.fulfill({ contentType: "text/html", body: shell("<h2>Your account is verified</h2>") }); }
    const body = PAGES[u.pathname];
    return route.fulfill({ status: body ? 200 : 404, contentType: "text/html", body: body || "not found" });
  });
});
test.after(async () => { await browser.close(); ai.close(); });
const job = (slug) => ({ slug, title: "Delivery Driver", company: "Globex", location: "Austin, TX", apply_url: `${HOST}/en-US/careers/job/Austin/Driver_R1`, details: "{}" });
let linkAsked = 0;
const waitLink = async (since, host) => { linkAsked++; assert.strictEqual(host, "globex.wd5.myworkdayjobs.com"); return site.verifyLinks.at(-1) || null; };
const on = (extra = {}) => store.saveSettings({ siteAccounts: { enabled: true, consent: true, email: "jordan.lee@example.com", ...extra } });

test("off (the default): a Workday sign-in goes to Apply yourself", async () => {
  const r = await applyTo(job("wd-off"), {}, { dryRun: true, browser: ctx, waitLink });
  assert.strictEqual(r.status, "manual", r.reason);
  assert.match(r.reason, /sign in or create an account/);
  assert.strictEqual(Object.keys(site.accounts).length, 0, "no account was made");
});

test("on, dry run: makes the account, confirms it from the email, signs in, fills every page, stops before Submit", async () => {
  on();
  const r = await applyTo(job("wd-dry"), {}, { dryRun: true, browser: ctx, waitLink });
  assert.strictEqual(r.status, "filled", r.reason);
  assert.match(r.reason, /signed in, filled all 2 pages and stopped before Submit/);
  assert.deepStrictEqual(Object.keys(site.accounts), ["jordan.lee@example.com"]);
  assert.strictEqual(site.accounts["jordan.lee@example.com"].password, "Tow-Truck-2026!", "the user's own password");
  assert.ok(site.accounts["jordan.lee@example.com"].verified, "confirmed through the emailed link");
  assert.strictEqual(linkAsked, 1);
  assert.strictEqual(site.submitted, 0, "a dry run never submits");
  assert.ok(r.details.audit.some((x) => /accepted globex\.wd5\.myworkdayjobs\.com's terms of use/.test(x)), "the terms it accepted are on the record");
  assert.ok(r.details.kit.some((k) => k.page === 2 && k.value === "Yes"), "page 2 answered");
  assert.strictEqual(A.knownAccount("globex.wd5.myworkdayjobs.com").status, "created");
});

test("on, live, the next job at the same company: signs straight in and submits", async () => {
  const r = await applyTo(job("wd-live"), {}, { dryRun: false, browser: ctx, waitLink });
  assert.strictEqual(r.status, "applied", r.reason);
  assert.strictEqual(site.submitted, 1);
  assert.strictEqual(Object.keys(site.accounts).length, 1, "no second account");
  assert.strictEqual(linkAsked, 1, "no new confirmation email needed");
});

test("an account that exists with another password stops with a clear reason", async () => {
  site.accounts["sam.rivera@example.com"] = { password: "Someone-Else-1!", verified: true };
  on({ email: "sam.rivera@example.com" });
  const list = A.listAccounts().filter((x) => x.host !== "globex.wd5.myworkdayjobs.com");
  (await import("node:fs")).writeFileSync(`${process.env.JA_DATA_DIR}/site-accounts.json`, JSON.stringify(list));
  const r = await applyTo(job("wd-other"), {}, { dryRun: true, browser: ctx, waitLink });
  assert.strictEqual(r.status, "failed");
  assert.match(r.reason, /could not sign in to globex\.wd5\.myworkdayjobs\.com: Wrong email address or password/);
  assert.strictEqual(site.accounts["sam.rivera@example.com"].password, "Someone-Else-1!", "the existing account is left alone");
});

test("passwords job sites would refuse are caught when the user saves them", () => {
  assert.deepStrictEqual(A.passwordProblems("Tow-Truck-2026!"), []);
  assert.deepStrictEqual(A.passwordProblems("password"), ["an uppercase letter", "a number", "a symbol such as ! or #"]);
  assert.ok(A.isWorkday("https://acme.wd1.myworkdayjobs.com/x") && !A.isWorkday("https://boards.greenhouse.io/acme"));
});
