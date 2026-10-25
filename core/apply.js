// One application, start to finish, in a browser window the user can watch:
// open the form, read it with the add-on's content.js, plan and build the
// resume, fill, check, submit, and confirm the employer got it.
import fs from "node:fs";
import path from "node:path";
import { CONTENT_JS, loadProfile, plan, build } from "./engine.js";
import { log } from "./db.js";
import { launch } from "./browser.js";
import { dataDir, getAnswers, getPrefs, getSettings } from "./store.js";
import { waitForCode } from "./mail.js";
import { withinRadius } from "./geo.js";

// The steps of one application, in order, as the dashboard shows them.
export const STEPS = [
  ["browser", "Starting browser"], ["open", "Opening application"], ["read", "Reading the form"],
  ["plan", "Tailoring with AI"], ["build", "Resume and fact-check"], ["fill", "Filling the form"],
  ["verify", "Checking every answer"], ["submit", "Submitting"], ["code", "Reading email code"], ["confirm", "Waiting for confirmation"],
];
const SHOTS = () => dataDir("shots");
const RESUMES = () => dataDir("resumes");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// content.js talks to the add-on through browser.runtime; stand that in.
export const SHIM = `(() => { if (window.__apSend) return;
  window.__apListeners = [];
  window.browser = { runtime: {
    onMessage: { addListener: (f) => window.__apListeners.push(f) },
    sendMessage: async () => ({ ok: true }), getURL: (p) => p } };
  window.__apSend = async (msg) => { for (const f of window.__apListeners) { const r = f(msg); if (r !== undefined) return await r; } };
})();`;

// Required fields still empty or invalid after the fill, read from the page itself.
export const CHECK_JS = `(() => {
  const out = [];
  const seen = new Set();
  const lab = (el) => {
    const id = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    const t = (id && id.innerText) || el.getAttribute('aria-label') || (el.closest('label') || {}).innerText ||
      ((el.closest('fieldset, [class*=field], [class*=question]') || {}).innerText || '').split('\\n')[0] || el.name || '';
    return t.replace(/\\s+/g, ' ').trim().slice(0, 120);
  };
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (el.disabled || el.type === 'hidden' || !(el.required || el.getAttribute('aria-required') === 'true')) continue;
    if (el.closest('[aria-hidden=true]') && el.type !== 'file') continue;
    // Dropdown widgets keep their value outside the input; content.js reports those itself.
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete') || el.closest('[class*=select__], [class*=combobox], [role=combobox]')) continue;
    if (el.type !== 'file' && el.type !== 'radio' && el.type !== 'checkbox' && !el.getClientRects().length) continue;
    // A checkbox or radio group is answered when any box in it is ticked (Greenhouse marks every box required).
    let group = el.parentElement;
    for (let i = 0; i < 8 && group && group.querySelectorAll('input[type=checkbox], input[type=radio]').length < 2; i++) group = group.parentElement;
    const ticked = (el.name && document.querySelectorAll('input[name="' + CSS.escape(el.name) + '"]:checked').length) ||
      (group && group.querySelector('input[type=checkbox]:checked, input[type=radio]:checked'));
    const empty = el.type === 'checkbox' || el.type === 'radio'
      ? !ticked && !el.checked
      : el.type === 'file' ? !(el.files && el.files.length) : !String(el.value || '').trim();
    if (el.type === 'file' && empty && /\\.(pdf|docx?)\\b/i.test((el.closest('[class*=field], [class*=upload], fieldset') || document.body).innerText)) continue;
    if (el.type === 'checkbox' && el.closest('[class*=yesno], [class*=button-group]')) continue; // button groups: checked below
    // a box in an answered group is reported invalid on its own; the group's ticked state is what counts
    const invalid = el.type !== 'checkbox' && el.type !== 'radio' && el.validity && !el.validity.valid;
    const key = el.name || el.id || lab(el);
    if ((empty || invalid) && !seen.has(key)) { seen.add(key); out.push(lab(el) || key); }
  }
  return out;
})()`;

export const SUBMIT_JS = `(() => {
  const vis = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const txt = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const cands = [...document.querySelectorAll('button, input[type=submit], [role=button]')].filter(vis);
  // Best first: a page can carry an "Apply" button in its header above the real one.
  const ranks = [/^submit( your| my)? application$/, /^(submit|send( my)? application|submit & apply)$/, /^apply( now)?$/];
  let b = null;
  for (const rx of ranks) { b = cands.filter((e) => rx.test(txt(e))).pop(); if (b) break; }
  b = b || cands.find((e) => e.type === 'submit' && /submit|apply/.test(txt(e)));
  if (!b) return null;
  b.setAttribute('data-ap-submit', '1');
  return txt(b);
})()`;

// Questions answered by pressing one of a few buttons (Ashby's Yes/No): content.js
// can tick the hidden box for "Yes" but cannot press "No". List the unanswered ones.
export const GROUPS_JS = `(() => {
  const out = [];
  const conts = new Set();
  for (const b of document.querySelectorAll('button[aria-pressed]')) if (b.parentElement) conts.add(b.parentElement);
  let n = 0;
  for (const c of conts) {
    const btns = [...c.querySelectorAll(':scope > button[aria-pressed]')];
    if (btns.length < 2 || btns.length > 6 || !c.getClientRects().length) continue;
    if (btns.some((b) => b.getAttribute('aria-pressed') === 'true')) continue;
    const entry = c.closest('[class*=fieldEntry], [class*=field-entry], fieldset, [class*=question]') || c.parentElement;
    const lab = entry.querySelector('label, legend, [class*=title], [class*=label]');
    const label = ((lab && lab.innerText) || '').replace(/\\s+/g, ' ').trim();
    const gid = 'g' + (n++);
    c.setAttribute('data-ap-group', gid);
    out.push({ gid, label, text: (entry.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 1500), options: btns.map((b) => b.innerText.trim()),
      required: /_required|required/.test((lab && lab.className) || '') || /\\*\\s*$/.test(label) });
  }
  return out;
})()`;

// Type-to-search boxes (Ashby's Location and School) left empty: no typed text and no
// chosen value shown next to them.
export const COMBOS_JS = `(() => {
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll('input[role=combobox], input[aria-autocomplete=list]')) {
    if (!el.getClientRects().length || el.disabled || String(el.value || '').trim()) continue;
    const entry = el.closest('[class*=fieldEntry], [class*=field-entry], .field, fieldset, [class*=question]') || el.parentElement.parentElement;
    if (entry.querySelector('[class*=single-value], [class*=singleValue], [class*=multi-value], [class*=chip]')) continue;
    const lab = entry.querySelector('label, legend, [class*=title]');
    const label = ((lab && lab.innerText) || el.getAttribute('aria-label') || el.placeholder || '').replace(/\\s+/g, ' ').trim();
    const cid = 'c' + (n++);
    el.setAttribute('data-ap-combo', cid);
    out.push({ cid, label, text: (entry.innerText || '').replace(/\\s+/g, ' ').slice(0, 600),
      required: /_required|required/.test((lab && lab.className) || '') || /\\*\\s*$/.test(label) || el.required || el.getAttribute('aria-required') === 'true' });
  }
  return out;
})()`;

// Type-to-search boxes answered from the user's own facts: their city, their school.
let COMBO_FALLBACK = [];
function comboFallback(a) {
  const school = ([...(a.education || [])].filter((e) => e && e.school).sort((x, y) => String(y.end || "").localeCompare(String(x.end || "")))[0] || {}).school;
  return [
    [/location|city|where do you (live|reside)/i, a.city || ""],
    [/school|university|college|institution/i, school || ""],
  ].filter(([, v]) => v);
}

async function fillCombos(page, kit, regionHint = "") {
  const left = [];
  for (const f of page.frames()) {
    for (const c of await f.evaluate(COMBOS_JS).catch(() => [])) {
      const a = kitAnswer(kit, c.label, c.text);
      const fb = COMBO_FALLBACK.find(([rx]) => rx.test(c.label));
      const value = (fb && fb[1]) || (a && a.value);
      if (!value) { if (c.required) left.push(c.label); continue; }
      const box = f.locator(`[data-ap-combo="${c.cid}"]`);
      try {
        await box.click();
        await box.pressSequentially(value.slice(0, 30), { delay: 60 });
        await sleep(2500);
        const opts = f.locator("[role=option]:visible");
        const texts = await opts.allInnerTexts();
        const want = nk(value);
        const region = nk(regionHint);
        let i = region ? texts.findIndex((t) => nk(t).startsWith(want) && nk(t).includes(region)) : -1;
        if (i < 0) i = texts.findIndex((t) => nk(t).includes(want));
        if (i < 0 && texts.length === 1) i = 0;
        if (i >= 0) await opts.nth(i).click();
        else { await box.fill(""); if (c.required) left.push(c.label); }
        await sleep(400);
      } catch { if (c.required) left.push(c.label); }
    }
  }
  return left;
}

// Dropdowns the add-on could not set (a long option in a Greenhouse react-select): open
// it by its label, type the start of the answer, and click the option with that exact text.
async function fixDropdowns(page, kit, labels) {
  for (const label of labels) {
    const k = kitAnswer(kit, label);
    if (!k || !k.value) continue;
    const name = label.replace(/\*\s*$/, "").trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const f of page.frames()) {
      const box = f.getByRole("combobox", { name: new RegExp("^\\s*" + name) }).first();
      if (!(await box.count().catch(() => 0))) continue;
      try {
        const ack = ACK.test(label) && !BINDING.test(label);
        await box.click();
        if (!ack) await box.pressSequentially(k.value.split(/\s+/).slice(0, 4).join(" "), { delay: 40 });
        await sleep(900);
        const opts = f.locator("[role=option]:visible");
        const texts = (await opts.allInnerTexts()).map((t) => t.trim());
        let i = texts.findIndex((t) => nk(t) === nk(k.value));
        if (i < 0) i = texts.findIndex((t) => nk(t).startsWith(nk(k.value).slice(0, 30)));
        // "Please acknowledge the privacy notice": the one affirmative option, whatever its wording
        const yesish = texts.map((t, n) => [t, n]).filter(([t]) => /acknowledg|agree|accept|^yes\b|i have read/i.test(t) && !/not|decline|disagree/i.test(t));
        if (i < 0 && ack && yes(k.value) && yesish.length === 1) i = yesish[0][1];
        if (i >= 0) await opts.nth(i).click(); else await page.keyboard.press("Escape");
      } catch { /* the recheck below reports it */ }
      break;
    }
  }
}

// Does the field with this label visibly hold an answer? (A dropdown shows its chosen option
// next to an empty search input, so the add-on can miss it.)
export const SHOWS_VALUE_JS = `(label) => {
  const norm = (t) => String(t || '').replace(/[\\s\\u00a0]+/g, ' ').replace(/\\*\\s*$/, '').trim().toLowerCase();
  const want = norm(label);
  const lab = [...document.querySelectorAll('label, legend')].find((l) => norm(l.innerText) === want);
  if (!lab) return false;
  const ctl = lab.htmlFor && document.getElementById(lab.htmlFor);
  if (ctl && ctl.tagName !== 'INPUT' && ctl.tagName !== 'TEXTAREA') return !!ctl.value;
  if (ctl && ctl.getAttribute('role') !== 'combobox') return !!String(ctl.value || '').trim() || ctl.checked;
  const box = ctl && lab.parentElement.contains(ctl) ? lab.parentElement
    : ((ctl || lab).parentElement.closest('[class*=container], [class*=field]') || lab.parentElement);
  const sel = box.querySelector('#aria-selection, [class*=single-value], [class*=singleValue]');
  if (sel && /selected|\\S/.test(sel.innerText) && !/^select\\b/i.test(sel.innerText.trim())) return true;
  const shown = [...box.querySelectorAll('div')].filter((d) => !d.children.length).map((d) => d.innerText.trim()).filter(Boolean);
  return shown.some((t) => !/^(select|choose|please|start typing|search)/i.test(t) && !/required|error|invalid|must|cannot be blank/i.test(t) && norm(t) !== want);
}`;

async function showsValue(page, label) {
  for (const f of page.frames()) if (await f.evaluate(`(${SHOWS_VALUE_JS})(${JSON.stringify(label)})`).catch(() => false)) return true;
  return false;
}

const ACK = /acknowledg|privacy (notice|policy)|i (have )?read|terms of (use|service)|consent to (the )?(processing|collection)/i;
const BINDING_RX = /arbitration|waive|waiver|jury|non-?compete|non-?solicit|class action|release of (claims|liability)|background check|drug (test|screen)/i;
// A plain arbitration agreement is accepted only when the user chose that in Settings
// (for every employer, or only the ones on their list); anything that also waives a
// jury trial, class actions or claims always waits for the user.
let allowArbitration = false;
const BINDING = { test: (label) => BINDING_RX.test(label) &&
  !(allowArbitration && /arbitration/i.test(label) && !/waive|waiver|jury|class action|release of|non-?compete|background|drug/i.test(label)) };
const yes = (v) => /^\s*(yes|y|true|i agree|i acknowledge|acknowledged?)\b/i.test(String(v || ""));
const nk = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function kitAnswer(kit, label, text = "") {
  const k = nk(label), whole = nk(text);
  const usable = (x) => x.kind !== "file" && x.value;
  const stem = (x) => nk(x.label.replace(/:\s*(yes\s*no|no\s*yes)\s*$/i, ""));
  const hit = kit.find((x) => usable(x) && nk(x.label) === k) ||
    kit.find((x) => usable(x) && k.length > 12 && (nk(x.label).startsWith(k.slice(0, 40)) || k.startsWith(nk(x.label).slice(0, 40)))) ||
    // the add-on may have named the field after its help text instead of its question
    kit.find((x) => usable(x) && /:\s*(yes\s*no|no\s*yes)\s*$/i.test(x.label) && stem(x).length > 20 && whole.includes(stem(x).slice(0, 80)));
  return hit && hit.kind !== "decide" && hit.kind !== "blank" ? hit : null;
}

export async function answerGroups(page, kit) {
  const unanswered = [];
  for (const f of page.frames()) {
    const groups = await f.evaluate(GROUPS_JS).catch(() => []);
    for (const g of groups) {
      const a = kitAnswer(kit, g.label, g.text);
      const want = a && g.options.find((o) => nk(o) === nk(a.value)) ||
        a && g.options.find((o) => nk(a.value).startsWith(nk(o) + " ") || nk(a.value) === nk(o));
      if (!want) { if (g.required) unanswered.push(g.label); continue; }
      await f.locator(`[data-ap-group="${g.gid}"] > button`).filter({ hasText: new RegExp(`^\\s*${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) }).first().click().catch(() => {});
      await sleep(200);
    }
  }
  return unanswered;
}

const SUCCESS = /thank(s| you)[^.]{0,40}(appl|submi|interest)|application (has been |was )?(received|submitted|complete)|we('ve| have) received your application|successfully (submitted|applied)|your application is (in|on its way)|application submitted/i;

async function codeBoxes(page) {
  for (const f of page.frames()) if (await f.locator("input[maxlength='1']:visible").count().catch(() => 0) >= 6) return true;
  return false;
}

// Greenhouse answers 428 when it wants the emailed code (reCAPTCHA scored the browser low).
async function waitOutcome(page, before, wantsCode) {
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    const t = await pageText(page);
    if (SUCCESS.test(t) || /confirmation|thank|success|submitted/i.test(page.url()) && page.url() !== before) return "applied";
    if (wantsCode() || await codeBoxes(page)) return "code";
  }
  return null;
}

const emailCode = (mailbox, since) => (mailbox ? waitForCode(mailbox, since, 180) : Promise.resolve(null));

// Type the code into the code box (one input, or one box per character), then confirm.
async function enterCode(page, code) {
  for (const f of page.frames()) {
    const boxes = f.locator("input[maxlength='1']:visible");
    const n = await boxes.count().catch(() => 0);
    if (n >= 4) {
      for (let i = 0; i < Math.min(n, code.length); i++) await boxes.nth(i).fill(code[i]).catch(() => {});
    } else {
      const one = f.locator("input[id*=code i]:visible, input[name*=code i]:visible, input[aria-label*=code i]:visible, input[autocomplete=one-time-code]:visible").first();
      if (!(await one.count().catch(() => 0))) continue;
      await one.fill(code).catch(() => {});
    }
    await sleep(500);
    const label = await f.evaluate(SUBMIT_JS).catch(() => null);
    const btn = label ? f.locator("[data-ap-submit]").first() : f.getByRole("button", { name: /verify|confirm|submit/i }).first();
    await btn.click({ timeout: 10000 }).catch(() => {});
    return true;
  }
  return false;
}

export function arbitrationAllowed(a, company) {
  if (a.arbitration === "plain") return true;
  if (a.arbitration === "list") return (a.arbitrationCompanies || []).some((c) => c && new RegExp(`\\b${String(c).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(company || ""));
  return false;
}

async function inject(page) {
  for (const f of page.frames()) {
    try { await f.evaluate(SHIM + "\n" + CONTENT_JS); } catch { /* detached or blocked frame */ }
  }
}

async function eachFrame(page, msg) {
  await inject(page);
  const out = [];
  for (const f of page.frames()) {
    try {
      const r = await f.evaluate((m) => window.__apSend && window.__apSend(m), msg);
      if (r) out.push(Object.assign(r, { frame: f }));
    } catch { /* frame went away */ }
  }
  return out;
}

async function scrapeAll(page) {
  let parts = [];
  for (let t = 0; t < 8; t++) {
    parts = await eachFrame(page, { type: "scrape" });
    if (Math.max(0, ...parts.map((p) => p.fields.length)) >= 3) break;
    await sleep(2500);
  }
  const top = parts.find((p) => p.frame === page.mainFrame()) || parts[0] || { text: "", fields: [] };
  let text = top.text || "";
  const big = Math.max(0, ...parts.map((p) => p.fields.length));
  if (big >= 5) for (const p of parts) if (p.fields.length < 3) p.fields = [];
  const fields = [], seen = new Set();
  for (const p of parts) {
    if (p !== top && p.fields.length) text += "\n\n" + (p.text || "").slice(0, 8000);
    for (const f of p.fields) {
      const k = f.label + "|" + f.type;
      if (!seen.has(k)) { seen.add(k); fields.push(f); }
    }
  }
  return { text, fields };
}

async function pageText(page) {
  let t = "";
  for (const f of page.frames()) t += "\n" + (await f.evaluate(() => document.body ? document.body.innerText : "").catch(() => ""));
  return t;
}

async function shot(page, slug, tag) {
  const file = `${safeName(slug)}-${tag}.jpg`;
  try { await page.screenshot({ path: path.join(SHOTS(), file), fullPage: true, type: "jpeg", quality: 60, timeout: 20000 }); return file; }
  catch { return null; }
}

// Make sure the resume landed: some upload widgets ignore a script-set file.
async function ensureResume(page, file) {
  const all = [];
  for (const f of page.frames()) {
    for (const h of await f.$$("input[type=file]").catch(() => [])) {
      const info = await h.evaluate((e) => {
        let n = e, ctx = "";
        // the nearest ancestor that carries a label-ish text
        for (let i = 0; i < 6 && n && !ctx; i++, n = n.parentElement) ctx = (n.innerText || "").trim();
        const entry = e.closest("[class*=fieldEntry], [class*=field-entry], .field, fieldset") || e.parentElement;
        // Ashby's "autofill from resume" box only parses the file; the Resume field needs its own.
        const autofill = !!e.closest("[class*=autofill]");
        const shown = /\.(pdf|docx?)\b/i.test((entry && entry.innerText) || "");
        return { has: !!(e.files && e.files.length) || shown, autofill,
          ctx: (ctx + " " + (e.name || "") + " " + (e.id || "")).toLowerCase().slice(0, 200) };
      }).catch(() => null);
      if (info && !info.autofill) all.push({ h, ...info });
    }
  }
  if (all.some((x) => x.has && !/cover/.test(x.ctx))) return; // the resume is in place
  for (const { h, ctx } of all) {
    if (/cover/.test(ctx)) continue;
    if (/resume|\bcv\b/.test(ctx) || all.length === 1) {
      await h.setInputFiles(file).catch(() => {});
      return;
    }
  }
}

const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);

// hooks: progress(stepKey), onFilled(page), status(text), opts: { dryRun, settings, answers, prefs, mailbox, browser }
export async function applyTo(job, hooks = {}, opts = {}) {
  const settings = opts.settings || getSettings();
  const a = opts.answers || getAnswers();
  const prefs = opts.prefs || getPrefs();
  const dryRun = opts.dryRun ?? settings.dryRun;
  allowArbitration = arbitrationAllowed(a, job.company);
  COMBO_FALLBACK = comboFallback(a);
  const jobLocal = withinRadius(job.location, prefs);
  const step = (k) => { try { hooks.progress && hooks.progress(k); } catch { /* display only */ } };
  step("browser");
  const profile = opts.profile || loadProfile();
  const details = JSON.parse(job.details || "{}");
  let browser;
  const result = { details };
  try {
    const launched = opts.browser ? { ctx: opts.browser } : await launch({ headless: settings.headless, choice: settings.browser, onStatus: (t) => hooks.status && hooks.status(t) });
    browser = launched.ctx;
    const page = await browser.newPage();
    for (const p of browser.pages()) if (p !== page && p.url() === "about:blank") await p.close().catch(() => {});
    page.setDefaultTimeout(30000);
    if (process.env.AP_DEBUG) {
      page.on("response", (r) => { if (r.request().method() !== "GET") console.log("NET", r.status(), r.request().method(), r.url().slice(0, 160)); });
      page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 200)); });
    }
    step("open");
    log(job.slug, "opening " + job.apply_url);
    const resp = await page.goto(job.apply_url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (resp && resp.status() >= 400) return { ...result, status: "skipped", reason: `posting page returned ${resp.status()} (probably closed)` };
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(2000);

    step("read");
    let { text, fields } = await scrapeAll(page);
    if (fields.length < 3) {
      // A posting page with an "Apply" button in front of the form.
      const btn = page.getByRole("button", { name: /^\s*apply( now| for this job)?\s*$/i }).or(page.getByRole("link", { name: /^\s*apply( now| for this job)?\s*$/i })).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click().catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        await sleep(2500);
        ({ text, fields } = await scrapeAll(page));
      }
    }
    if (fields.length < 3) return { ...result, status: "failed", reason: "no application form found on the page", screenshot: await shot(page, job.slug, "noform") };
    if (/no longer (accepting|available|open)|position (has been )?filled|job (is )?closed|page not found/i.test(text.slice(0, 3000)) && fields.length < 5) {
      return { ...result, status: "skipped", reason: "posting is closed" };
    }

    const postingText = [text, details.description ? "\n\nFULL POSTING (from freehire):\n" + details.description : ""].join("").slice(0, 30000);
    step("plan");
    log(job.slug, `${fields.length} fields; asking ${settings.ai.model} for a plan`);
    const p = await plan(profile, { url: job.apply_url, text: postingText, fields }, a, prefs);
    const hardFails = ((p.fit || {}).hardFails || []).filter((f) => f && f.requirement);
    result.details = { ...details, plan: { employer: p.employer, jobTitle: p.jobTitle, base: p.base, summary: p.summary, notClaimed: p.notClaimed || [] }, hardFails, fields };
    if (hardFails.length) {
      return { ...result, status: "skipped", reason: "fails a must-have: " + hardFails.map((f) => `${f.requirement}${f.why ? " (" + f.why + ")" : ""}`).join("; ").slice(0, 600) };
    }

    step("build");
    const b = await build(profile, p, fields, { a, prefs, jobLocal });
    if (b.overflow) return { ...result, status: "failed", reason: "resume would not fit on one page" };
    const resumeFile = `${safeName(job.slug)}.pdf`;
    const resumePath = path.join(RESUMES(), resumeFile);
    // The upload carries the add-on's name (Lastname_Employer_Title.pdf); keep a copy under that name too.
    const named = path.join(RESUMES(), safeName(job.slug) + "-" + b.fileName);
    fs.writeFileSync(resumePath, b.pdf);
    fs.writeFileSync(named, b.pdf);
    result.resume_file = resumeFile;
    result.details.kit = b.kit.filter((k) => k.fieldIndex !== undefined || k.kind === "file");
    result.details.resume = { fileName: b.fileName, slack: b.slack, warnings: b.warnings };
    if (allowArbitration) for (const k of b.kit) {
      if (/arbitration/i.test(k.label) && !BINDING.test(k.label) && (k.kind === "decide" || !k.value)) {
        Object.assign(k, { kind: "text", value: "Yes", note: `accepted: your settings allow plain arbitration agreements${a.arbitration === "list" ? " for " + job.company : ""}` });
        b.audit.push(`arbitration agreement accepted for ${job.company}, per your settings`);
      }
    }
    result.details.audit = b.audit;
    for (const a of b.audit) log(job.slug, "truth check: " + a);

    step("fill");
    log(job.slug, "filling the form");
    const fillMsg = { type: "fill", kit: { fields: b.kit, header: {} }, resume: { name: b.fileName, b64: b.pdf.toString("base64") } };
    const first = await eachFrame(page, fillMsg);
    await ensureResume(page, named);
    // Resume parsers (Ashby's autofill, Lever's) rewrite the form a few seconds after
    // the upload. Let them finish, then fill again: only empty fields get touched.
    await sleep(7000);
    let second = await eachFrame(page, fillMsg);
    // "Please acknowledge the privacy notice" dropdowns whose option is not literally "Yes".
    // Never for arbitration, waivers or other binding agreements: those stay with the user.
    for (const alt of ["Acknowledge", "I acknowledge", "I agree", "Accept"]) {
      const stuck = second.flatMap((r) => r.decide || []).filter((x) => /^Could not set it/.test(x.note || "") &&
        ACK.test(x.label) && !BINDING.test(x.label)).map((x) => x.label);
      if (!stuck.length) break;
      const kit2 = b.kit.map((k) => (stuck.includes(k.label) ? { ...k, value: alt } : k));
      const again = await eachFrame(page, { ...fillMsg, kit: { fields: kit2, header: {} } });
      second = second.map((r) => {
        const a = again.find((x) => x.frame === r.frame);
        if (!a) return r;
        return { ...r, filled: [...(r.filled || []), ...(a.filled || [])], decide: (r.decide || []).filter((x) => !stuck.includes(x.label) || (a.decide || []).some((y) => y.label === x.label)) };
      });
    }
    await ensureResume(page, named);
    await answerGroups(page, b.kit);
    await fillCombos(page, b.kit, a.state || a.country || "");
    const stuck = second.flatMap((r) => [...(r.missing || []), ...(r.decide || []).filter((x) => /^Could not set it/.test(x.note || ""))])
      .map((x) => x.label).filter((l) => !BINDING.test(l));
    if (stuck.length) await fixDropdowns(page, b.kit, stuck);
    await sleep(2500);
    // A last pass fills nothing new; it reports what is still empty after every fix above.
    const last = stuck.length ? await eachFrame(page, fillMsg) : second;
    const rep = { filled: [], kept: [], decide: [], drafts: [], missing: [] };
    for (const r of [...first, ...second]) for (const k of ["filled", "drafts"]) for (const x of r[k] || []) if (!rep[k].some((y) => y.label === x.label)) rep[k].push({ label: x.label, note: x.note });
    for (const r of last) for (const k of ["decide", "missing"]) for (const x of r[k] || []) {
      // a field the add-on calls empty but that visibly holds an answer is answered
      if ((k === "missing" || /^Could not set it/.test(x.note || "")) && await showsValue(page, x.label)) continue;
      rep[k].push({ label: x.label, note: x.note });
    }
    step("verify");
    if (hooks.onFilled) await hooks.onFilled(page);
    const groupsLeft = [];
    for (const f of page.frames()) {
      for (const g of await f.evaluate(GROUPS_JS).catch(() => [])) if (g.required) groupsLeft.push(g.label);
      for (const c of await f.evaluate(COMBOS_JS).catch(() => [])) if (c.required && !(await showsValue(page, c.label))) groupsLeft.push(c.label);
    }
    result.details.report = rep;

    // Gates: nothing required may be left empty, guessed, or waiting on a person.
    const required = new Set(fields.filter((f) => f.required).map((f) => f.label));
    const blocking = [
      ...rep.missing.map((x) => `required, no answer: ${x.label}`),
      ...rep.decide.filter((x) => required.has(x.label)).map((x) => `needs you: ${x.label}${x.note ? " (" + x.note + ")" : ""}`),
      ...groupsLeft.map((l) => `required, no answer: ${l}`),
    ];
    for (const f of page.frames()) {
      const empty = await f.evaluate(CHECK_JS).catch(() => []);
      for (const l of empty) if (!blocking.some((x) => x.includes(l))) blocking.push(`still empty: ${l}`);
    }
    result.screenshot = await shot(page, job.slug, "filled");
    if (blocking.length) return { ...result, status: "failed", reason: "could not fill every required field: " + blocking.slice(0, 6).join("; ") };
    if (dryRun) return { ...result, status: "filled", reason: "dry run: filled and checked, not submitted" };

    // Submit.
    step("submit");
    let frame = null, label = null;
    for (const f of page.frames()) {
      label = await f.evaluate(SUBMIT_JS).catch(() => null);
      if (label) { frame = f; break; }
    }
    if (!frame) return { ...result, status: "failed", reason: "no submit button found" };
    const before = page.url();
    let got428 = false;
    page.on("response", (r) => { if (r.status() === 428 && r.request().method() === "POST") got428 = true; });
    log(job.slug, `pressing "${label}"`);
    await frame.locator("[data-ap-submit]").first().scrollIntoViewIfNeeded().catch(() => {});
    await frame.locator("[data-ap-submit]").first().click({ timeout: 15000 });

    step("confirm");
    const submittedAt = Date.now() / 1000;
    let outcome = await waitOutcome(page, before, () => got428);
    if (outcome === "code") {
      step("code");
      log(job.slug, "the employer emailed a security code; reading it from the inbox");
      const code = await emailCode(opts.mailbox, submittedAt);
      if (!code) {
        result.screenshot = await shot(page, job.slug, "after");
        return { ...result, status: "failed", reason: "security code: Greenhouse emailed a verification code and the autopilot could not read it (no mailbox access, or it did not arrive in 3 minutes)" };
      }
      got428 = false;
      step("confirm");
      await enterCode(page, code);
      outcome = await waitOutcome(page, page.url(), () => got428);
      if (outcome === "code") outcome = null;
    }
    result.screenshot = await shot(page, job.slug, "after");
    if (outcome === "applied") return { ...result, status: "applied", reason: `submitted ("${label}")` };
    const errs = [];
    for (const f of page.frames()) {
      errs.push(...await f.evaluate(() => [...document.querySelectorAll('[class*=error], [role=alert], .invalid-feedback, [aria-invalid=true]')]
        .map((e) => (e.innerText || e.getAttribute("aria-label") || e.name || "").trim()).filter(Boolean).slice(0, 6)).catch(() => []));
    }
    const captcha = await page.$('iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha"][src*="challenge"]').catch(() => null);
    if (errs.some((e) => /matching images|select all|captcha|i'?m not a robot/i.test(e))) {
      return { ...result, status: "failed", reason: "an image CAPTCHA blocked the submit (cannot be solved unattended)" };
    }
    return { ...result, status: "failed", reason: captcha ? "a CAPTCHA challenge blocked the submit" : "submitted but no confirmation appeared" + (errs.length ? ": " + [...new Set(errs)].join("; ").slice(0, 400) : "") };
  } finally {
    if (browser && !opts.browser) await browser.close().catch(() => {});
  }
}
