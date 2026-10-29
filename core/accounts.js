// Accounts on job sites that make you sign up before you can apply. Off unless the user turns it on
// (Settings > Job site accounts), with the email and the one password they chose. Workday first:
// each company's Workday site is its own account. The confirmation email is read from the mailbox.
import fs from "node:fs";
import { dataDir, getSecret, getSettings } from "./store.js";
import { BINDING_RX, WAIVER_RX } from "./apply.js"; // read only inside functions, so the circular import is fine

const FILE = () => dataDir("site-accounts.json");
const arr = (x) => (Array.isArray(x) ? x : []);
export const WORKDAY = /(^|\.)(myworkdayjobs|myworkday|workday)\.com$/i;
export const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/\.+$/, ""); } catch { return ""; } };
export const isWorkday = (u) => WORKDAY.test(hostOf(u));

// The user's choice and credentials, or null when the app must leave sign-ups to them.
export function siteAccounts(s = getSettings()) {
  const a = s.siteAccounts || {};
  const password = getSecret("sitePassword");
  return a.enabled && a.consent && a.email && password ? { email: a.email, password } : null;
}
export const canSignUp = (url, s) => !!siteAccounts(s) && isWorkday(url);

// Workday's own rules for passwords; most sites ask for about the same.
export function passwordProblems(p) {
  const s = String(p || ""), out = [];
  if (s.length < 8) out.push("at least 8 characters");
  if (!/[A-Z]/.test(s)) out.push("an uppercase letter");
  if (!/[a-z]/.test(s)) out.push("a lowercase letter");
  if (!/\d/.test(s)) out.push("a number");
  if (!/[^A-Za-z0-9]/.test(s)) out.push("a symbol such as ! or #");
  return out;
}

export function listAccounts() { try { return arr(JSON.parse(fs.readFileSync(FILE(), "utf8"))); } catch { return []; } }
export function knownAccount(host) { return listAccounts().find((x) => x.host === host) || null; }
export function recordAccount(host, fields) {
  const list = listAccounts();
  const i = list.findIndex((x) => x.host === host);
  const entry = { ...(i >= 0 ? list[i] : { host, createdAt: new Date().toISOString() }), ...fields, updatedAt: new Date().toISOString() };
  if (i >= 0) list[i] = entry; else list.push(entry);
  fs.writeFileSync(FILE(), JSON.stringify(list, null, 2));
  return entry;
}

// ---------- Workday: sign up or sign in, in the page the application opened in ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = (id) => `[data-automation-id="${id}"]`;
// The first element on screen for any of the selectors (pages keep hidden copies of their forms).
async function firstVisible(page, sels) {
  for (const sel of [].concat(sels)) {
    for (const el of await page.locator(sel).all().catch(() => [])) if (await el.isVisible().catch(() => false)) return el;
  }
  return null;
}
async function visible(page, sel) { return !!(await firstVisible(page, sel)); }
async function clickFirst(page, sels) {
  {
    const el = await firstVisible(page, sels);
    if (el) {
      // Workday lays a transparent "click_filter" over its buttons; clicking the button itself can miss.
      const filter = el.locator(W("click_filter")).first();
      if (await filter.count().catch(() => 0)) await filter.click({ timeout: 8000 }).catch(() => el.click({ force: true, timeout: 8000 }));
      else await el.click({ timeout: 8000 }).catch(() => el.click({ force: true, timeout: 8000 }));
      return true;
    }
  }
  return false;
}
async function fillFirst(page, sels, value) {
  const el = await firstVisible(page, sels);
  if (!el) return false;
  await el.fill(value);
  return true;
}
const pageText = (page) => page.evaluate(() => document.body.innerText).catch(() => "");
const passwordShown = (page) => visible(page, "input[type=password]");
async function errorText(page) {
  const t = await page.locator(`${W("errorMessage")}, [role=alert], [class*=error]`).allInnerTexts().catch(() => []);
  return t.map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ").slice(0, 300);
}
const VERIFY_RX = /verify (your|the) (email|account)|check your (email|inbox)|verification (email|link)|activate your account|we('ve| have) sent/i;
const EXISTS_RX = /already (exists|in use|registered|associated)|account with this email/i;

const SIGN_IN = {
  email: [W("email"), "input[type=email]", "input[name*=email i]", "input[autocomplete=username]"],
  password: [W("password"), "input[type=password]"],
  submit: [W("signInSubmitButton"), "button:has-text('Sign In')", "[role=button]:has-text('Sign In')"],
};
const CREATE = {
  link: [W("createAccountLink"), "button:has-text('Create Account')", "a:has-text('Create Account')", "[role=button]:has-text('Create Account')"],
  verify: [W("verifyPassword"), "input[autocomplete=new-password] >> nth=1", "input[name*=confirm i][type=password]", "input[name*=verify i][type=password]"],
  terms: [W("createAccountCheckbox"), "input[type=checkbox]", "[role=checkbox]"],
  submit: [W("createAccountSubmitButton"), "button:has-text('Create Account')", "[role=button]:has-text('Create Account')"],
};

// The sign-up's terms box, chosen by what its label says, never by where it is: only ordinary terms of use or a
// privacy policy, with nothing binding in it (waived rights, a background check), and arbitration only when the
// person allowed plain arbitration in Settings (for every employer, or this one). { box, text } for the one to
// tick; { binding } when the only terms on offer bind the person to more; null when there's no box.
const TERMS_RX = /\b(terms|privacy|conditions|policy|policies)\b/i;
const MORE_THAN_ARBITRATION = /waive|waiver|jury|class action|release (of )?(all |any )?(claims|liability)|hold harmless|indemnif|non-?compete|non-?solicit|background check|drug (test|screen)/i;
export async function termsBox(page, { allowArbitration = false } = {}) {
  let binding = null;
  for (const sel of CREATE.terms) {
    for (const el of await page.locator(sel).all().catch(() => [])) {
      if (!(await el.isVisible().catch(() => false))) continue;
      const text = await el.evaluate((e) => {
        const byId = (ids) => (ids || "").split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((x) => x.innerText).join(" ");
        const lab = (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) || e.closest("label");
        return [e.getAttribute("aria-label"), byId(e.getAttribute("aria-labelledby")), lab && lab.innerText, !lab && e.parentElement ? e.parentElement.innerText : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 600);
      }).catch(() => "");
      if (!TERMS_RX.test(text)) continue;
      const plainArbitration = allowArbitration && /arbitrat/i.test(text) && !MORE_THAN_ARBITRATION.test(text);
      if ((WAIVER_RX.test(text) || BINDING_RX.test(text)) && !plainArbitration) { binding = binding || text; continue; }
      return { box: el, text };
    }
  }
  return binding ? { binding } : null;
}

// The email and password are typed only into a Workday page: checked again after every click that can
// navigate, and right before each box is filled.
const LEFT = (page) => `the page left Workday (${hostOf(page.url()) || "no page"}), so no email or password was typed`;
const fillOnWorkday = async (page, sels, value) => (isWorkday(page.url()) ? fillFirst(page, sels, value) : false);

async function signIn(page, creds) {
  if (!(await passwordShown(page))) await clickFirst(page, [W("signInLink"), W("utilityButtonSignIn"), "button:has-text('Sign In')", "a:has-text('Sign In')"]);
  await sleep(1500);
  if (!isWorkday(page.url())) return LEFT(page);
  if (!(await fillOnWorkday(page, SIGN_IN.email, creds.email))) return isWorkday(page.url()) ? "no email box on the sign-in page" : LEFT(page);
  if (!(await fillOnWorkday(page, SIGN_IN.password, creds.password))) return isWorkday(page.url()) ? "no password box on the sign-in page" : LEFT(page);
  await clickFirst(page, SIGN_IN.submit);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await sleep(3000);
  if (!(await passwordShown(page))) return null;
  return (await errorText(page)) || "the site did not accept the sign-in";
}

// "Apply" on a Workday posting opens a choice (autofill from a resume, or apply manually): the app fills the form itself.
export async function workdayApplyManually(page) {
  if (!(await clickFirst(page, [W("applyManually"), "button:has-text('Apply Manually')", "a:has-text('Apply Manually')"]))) return false;
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await sleep(2500);
  return true;
}

// Returns { ok, created, notes[] } or { ok: false, reason }.
// waitLink(sinceSeconds, host) -> the confirmation link from the mailbox, or null.
export async function workdayAccount(page, creds, { waitLink, log = () => {}, allowArbitration = false } = {}) {
  const host = hostOf(page.url());
  const notes = [];
  if (!isWorkday(page.url())) return { ok: false, reason: LEFT(page) };
  if (!(await passwordShown(page)) && !(await visible(page, CREATE.link.join(", ")))) return { ok: true, created: false, notes }; // already signed in
  const known = knownAccount(host);
  let created = false;
  if (!known || known.status === "failed") {
    log(`creating an account on ${host}`);
    await clickFirst(page, CREATE.link);
    await sleep(2000);
    const since = Date.now() / 1000;
    if (!isWorkday(page.url())) return { ok: false, reason: LEFT(page) };
    if (!(await fillOnWorkday(page, SIGN_IN.email, creds.email))) return { ok: false, reason: isWorkday(page.url()) ? `${host}: the sign-up form did not appear` : LEFT(page) };
    if (!(await visible(page, CREATE.verify))) return { ok: false, reason: `${host}: the sign-up form did not appear` };
    if (!(await fillOnWorkday(page, SIGN_IN.password, creds.password))) return { ok: false, reason: LEFT(page) };
    if (!(await fillOnWorkday(page, CREATE.verify, creds.password))) return { ok: false, reason: LEFT(page) };
    const terms = await termsBox(page, { allowArbitration });
    if (terms && terms.binding) return { ok: false, reason: `${host}'s sign-up asks you to accept "${terms.binding.slice(0, 160)}", which binds you to more than terms of use. Open it and decide yourself` };
    if (terms) {
      await terms.box.check({ timeout: 5000 }).catch(() => terms.box.click({ force: true }));
      if (await terms.box.isChecked().catch(() => true)) notes.push(`accepted ${host}'s terms of use to create the account ("${terms.text.slice(0, 120)}"), as your settings allow`);
    }
    await clickFirst(page, CREATE.submit);
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await sleep(3000);
    if (!isWorkday(page.url())) return { ok: false, reason: LEFT(page) };
    const err = await errorText(page), text = await pageText(page);
    if (EXISTS_RX.test(err + " " + text)) {
      log(`an account for this email already exists on ${host}; signing in`);
      recordAccount(host, { email: creds.email, status: "existed" });
    } else if (await passwordShown(page) && err && !VERIFY_RX.test(err + " " + text)) {
      recordAccount(host, { email: creds.email, status: "failed", error: err });
      return { ok: false, reason: `${host} did not accept the new account: ${err}` };
    } else {
      created = true;
      recordAccount(host, { email: creds.email, status: VERIFY_RX.test(text) ? "unverified" : "created" });
      notes.push(`created an account on ${host} with ${creds.email}`);
    }
    if (VERIFY_RX.test(text)) {
      log(`${host} sent a confirmation email; reading it from the inbox`);
      const link = waitLink ? await waitLink(since, host) : null;
      if (!link) return { ok: false, reason: `verify email: ${host} sent a confirmation email and the app could not read it (connect your mailbox in Settings, or open the email and click the link yourself; the app tries again after)` };
      const tab = await page.context().newPage();
      await tab.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
      await sleep(4000);
      await tab.close().catch(() => {});
      recordAccount(host, { status: "created" });
      notes.push(`confirmed the account from the email ${host} sent`);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await sleep(2500);
    }
  }
  if (!isWorkday(page.url())) return { ok: false, reason: LEFT(page) };
  if (await passwordShown(page) || await visible(page, SIGN_IN.submit.join(", "))) {
    const problem = await signIn(page, creds);
    if (problem) {
      if (VERIFY_RX.test(problem + " " + await pageText(page)) && waitLink) {
        const link = await waitLink(Date.now() / 1000 - 3600, host);
        if (link) { const tab = await page.context().newPage(); await tab.goto(link).catch(() => {}); await sleep(4000); await tab.close().catch(() => {}); if (!(await signIn(page, creds))) return { ok: true, created, notes }; }
      }
      return { ok: false, reason: `could not sign in to ${host}: ${problem}${known ? "" : " (if you already had an account there with another password, change it to the one in Settings > Job site accounts)"}` };
    }
  }
  notes.push(`signed in to ${host}`);
  return { ok: true, created, notes };
}
