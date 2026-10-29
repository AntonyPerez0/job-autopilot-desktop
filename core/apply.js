// One application, start to finish, in a browser window the user can watch:
// open the form, read it with the add-on's content.js, plan and build the
// resume, fill, check, submit, and confirm the employer got it.
import fs from "node:fs";
import path from "node:path";
import { CONTENT_JS, loadProfile, plan, build } from "./engine.js";
import { log } from "./db.js";
import { acquireBrowser, closeAppPage, closeBrowser, newAppPage } from "./browser.js";
import { dataDir, getAnswers, getPrefs, getSettings } from "./store.js";
import { mailDomainsFor, waitForCode, waitForLink } from "./mail.js";
import { isWorkday, siteAccounts, workdayAccount, workdayApplyManually } from "./accounts.js";
import { withinRadius } from "./geo.js";
import { hostOf, isApplicationSystem, isGovUrl } from "./ats.js";
import { applyYourAnswers, yourAnswersFor } from "./asked.js";
import { LOGIN_WALL_JS } from "./ats.js";

// The steps of one application, in order, as the dashboard shows them.
export const STEPS = [
  ["browser", "Starting browser"], ["open", "Opening application"], ["read", "Reading the form"], ["account", "Signing in to the job site"],
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
// React dropdowns (react-select: Greenhouse, Lever and many more) are set through the component itself, which
// lives in the page's own world, not in the isolated one content.js runs in. These run there, each with nothing
// but the page's own option lists, or one field and the one value the page receives anyway when it's filled.
const RS_CORE = `
  const rsOf = (el) => { try { const k = Object.keys(el).find((x) => x.startsWith("__reactFiber")); let f = k && el[k];
    for (let i = 0; f && i < 40; i++, f = f.return) { const sn = f.stateNode; if (sn && typeof sn.selectOption === "function" && sn.props) return sn; } } catch (e) { /* not React */ } return null; };
  const rsOpts = (rs) => { const out = []; for (const o of Array.from(rs.props.options || [])) { if (o && o.options) out.push(...Array.from(o.options)); else if (o) out.push(o); } return out; };
  const rsLab = (rs, o) => { try { return String(rs.props.getOptionLabel ? rs.props.getOptionLabel(o) : o.label).replace(/\\s+/g, " ").trim(); } catch (e) { return String((o && o.label) || ""); } };
  const nk = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const labelOf = (el) => { const byFor = el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    const byIds = (el.getAttribute("aria-labelledby") || "").split(/\\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((x) => x.innerText).join(" ");
    const entry = el.closest("[class*=fieldEntry], [class*=field-entry], .field, fieldset, [class*=question]") || el.parentElement.parentElement;
    const lab = entry && entry.querySelector("label, legend, [class*=title]");
    return ((byFor && byFor.innerText) || byIds || (lab && lab.innerText) || el.getAttribute("aria-label") || el.placeholder || "").replace(/\\s+/g, " ").trim(); };
`;
export const COMBOS_JS = `(() => {${RS_CORE}
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll('input[role=combobox], input[aria-autocomplete=list]')) {
    if (!el.getClientRects().length || el.disabled) continue;
    const entry = el.closest('[class*=fieldEntry], [class*=field-entry], .field, fieldset, [class*=question]') || el.parentElement.parentElement;
    // a React dropdown says itself whether something is chosen (text typed into it but not picked isn't an answer)
    const rs = rsOf(el), v = rs && rs.props.value;
    if (rs ? v != null && v !== "" && (typeof v.length !== "number" || v.length > 0) : String(el.value || '').trim()) continue;
    if (!rs && entry.querySelector('[class*=single-value], [class*=singleValue], [class*=multi-value], [class*=chip]')) continue;
    const lab = entry.querySelector('label, legend, [class*=title]');
    const label = ((lab && lab.innerText) || el.getAttribute('aria-label') || el.placeholder || '').replace(/\\s+/g, ' ').trim();
    const cid = 'c' + (n++);
    el.setAttribute('data-ap-combo', cid);
    out.push({ cid, label, text: (entry.innerText || '').replace(/\\s+/g, ' ').slice(0, 600),
      required: /_required|required/.test((lab && lab.className) || '') || /\\*\\s*$/.test(label) || el.required || el.getAttribute('aria-required') === 'true' });
  }
  return out;
})()`;

// [{ label, options }] for every React dropdown in the frame.
export const RS_OPTIONS_JS = `(() => {${RS_CORE}
  const out = [];
  for (const el of document.querySelectorAll("input[role=combobox], input[aria-autocomplete=list]")) {
    const rs = rsOf(el);
    if (rs) out.push({ label: labelOf(el), options: rsOpts(rs).slice(0, 80).map((o) => rsLab(rs, o)).filter(Boolean) });
  }
  return out;
})()`;
// The React dropdowns in a frame with nothing chosen yet, tagged for RS_PICK_JS: [{ cid, label }].
const RS_EMPTY_JS = `(() => {${RS_CORE}
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll("input[role=combobox], input[aria-autocomplete=list]")) {
    const rs = rsOf(el);
    if (!rs || el.disabled) continue;
    const v = rs.props.value;
    if (v != null && v !== "" && (typeof v.length !== "number" || v.length > 0)) continue;
    const cid = "r" + (n++);
    el.setAttribute("data-ap-combo", cid);
    out.push({ cid, label: labelOf(el) });
  }
  return out;
})()`;

// Pick `value` in the dropdown COMBOS_JS tagged `cid`: true picked, false no such option, null not React.
// region: the person's state or country, to tell one Austin from another in a list of places.
export const RS_PICK_JS = (cid, value, region = "") => `(async () => {${RS_CORE}
  const el = document.querySelector('[data-ap-combo="' + ${JSON.stringify(String(cid))} + '"]');
  const rs = el && rsOf(el);
  if (!rs) return null;
  const want = nk(${JSON.stringify(String(value))});
  const find = (list) => { const l = list.map((o) => nk(rsLab(rs, o))); let i = l.indexOf(want); if (i < 0) i = l.findIndex((x) => x.startsWith(want)); if (i < 0) i = l.findIndex((x) => want.length > 2 && x.includes(want)); return i; };
  let opts = rsOpts(rs), i = find(opts);
  if (i < 0 && typeof rs.props.loadOptions === "function") {
    try { const r = await rs.props.loadOptions(${JSON.stringify(String(value).slice(0, 60))}, () => {}); const list = Array.from((r && (Array.isArray(r) ? r : r.options)) || []);
      const flat = list.flatMap((o) => (o && o.options ? Array.from(o.options) : [o])); const j = find(flat); if (j >= 0) { opts = flat; i = j; } } catch (e) { /* the loader failed */ }
  }
  // search-as-you-type lists (a city): type the start through the component and wait for its suggestions
  if (i < 0 && typeof rs.props.onInputChange === "function") {
    try { rs.props.onInputChange(${JSON.stringify(String(value).split(",")[0].slice(0, 60))}, { action: "input-change", prevInputValue: "" }); } catch (e) { /* ignore */ }
    const city = nk(${JSON.stringify(String(value).split(",")[0])}), reg = nk(${JSON.stringify(String(region))});
    for (let t = 0; t < 24 && i < 0; t++) {
      await new Promise((r) => setTimeout(r, 250));
      opts = rsOpts(rs); i = find(opts);
      if (i < 0 && city.length > 2) {
        const l = opts.map((o) => nk(rsLab(rs, o))), starts = l.map((x, k) => (x.startsWith(city) ? k : -1)).filter((k) => k >= 0);
        const inRegion = reg ? starts.filter((k) => (" " + l[k] + " ").includes(" " + reg + " ")) : [];
        i = inRegion.length ? inRegion[0] : starts.length === 1 ? starts[0] : -1;
      }
    }
  }
  if (i < 0) return false;
  rs.selectOption(opts[i]);
  return true;
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

// React dropdowns first, from the page's world, one field and its one answer at a time: content.js, in its
// isolated world, can only type into them, which is slow and can pick the wrong entry from a list of places.
export async function fillReactSelects(page, kit, regionHint = "") {
  for (const f of formFrames(page)) {
    for (const c of await f.evaluate(RS_EMPTY_JS).catch(() => [])) {
      const a = kitAnswer(kit, c.label);
      const fb = COMBO_FALLBACK.find(([rx]) => rx.test(c.label));
      const value = (a && a.value && fb && fb[1]) || (a && a.value);
      if (value) { await f.evaluate(RS_PICK_JS(c.cid, value, regionHint)).catch(() => null); await sleep(150); }
    }
  }
}

export async function fillCombos(page, kit, regionHint = "") {
  const left = [];
  for (const f of formFrames(page)) {
    for (const c of await f.evaluate(COMBOS_JS).catch(() => [])) {
      const a = kitAnswer(kit, c.label, c.text);
      const fb = COMBO_FALLBACK.find(([rx]) => rx.test(c.label));
      const value = (fb && fb[1]) || (a && a.value);
      if (!value) { if (c.required) left.push(c.label); continue; }
      // A React dropdown takes the answer through its own component first; typing is the fallback.
      if (await f.evaluate(RS_PICK_JS(c.cid, value, regionHint)).catch(() => null)) { await sleep(400); continue; }
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
    for (const f of formFrames(page)) {
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

// Type-to-search lists (Greenhouse's School) can settle on a look-alike when the exact
// entry is not in the first page of results ("Austin Peay State University" for
// "University of Texas at Austin"). Check what each one shows against the answer, search
// again by its telling words, and clear it when the right entry cannot be found.
const GENERIC = new Set(["university", "college", "of", "the", "at", "in", "and", "school", "institute", "campus", "main"]);
export const tellingWords = (s) => [...new Set(nk(s).split(" ").filter((w) => w.length > 1 && !GENERIC.has(w)).map((w) => w.replace(/s$/, "")))];
// A school must name exactly the same entry; a place only needs to contain the city ("Austin" in "Austin, Texas, United States").
export function sameEntry(shown, want, place = false) {
  const S = tellingWords(shown), W = tellingWords(want);
  if (!W.length) return false;
  return W.every((w) => S.includes(w)) && (place || S.every((w) => W.includes(w)));
}
const SHOWN_JS = (el) => {
  // The chosen option sits beside the input, a few levels up, inside the same field.
  for (let n = el.parentElement, i = 0; n && i < 8; n = n.parentElement, i++) {
    const v = n.querySelector("[class*=single-value], [class*=singleValue]");
    if (v) return v.innerText.trim();
    if (n.matches("[class*=field], fieldset, form")) break;
  }
  return "";
};

export async function verifyCombos(page, kit, fields) {
  const notes = [];
  const combos = (fields || []).filter((f) => f.type === "combo" && /school|university|college|institution|location|city/i.test(f.label));
  for (const f of combos) {
    const k = kitAnswer(kit, f.label);
    if (!k || !k.value || tellingWords(k.value).length === 0) continue;
    const name = f.label.replace(/\*\s*$/, "").trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const fr of formFrames(page)) {
      const box = fr.getByRole("combobox", { name: new RegExp("^\\s*" + name) }).first();
      if (!(await box.count().catch(() => 0))) continue;
      const shown = await box.evaluate(SHOWN_JS).catch(() => "");
      const place = /location|city/i.test(f.label);
      const want = place ? String(k.value).split(",")[0] : k.value;
      if (!shown || sameEntry(shown, want, place)) break;
      const words = tellingWords(want).sort((a, b) => b.length - a.length);
      let fixed = false;
      for (const q of [...new Set([words.join(" "), ...words])]) {
        try {
          await box.click();
          await box.fill("");
          await box.pressSequentially(q, { delay: 40 });
          await sleep(1800);
          const opts = fr.locator("[role=option]:visible");
          const texts = (await opts.allInnerTexts()).map((t) => t.trim());
          const hits = texts.map((t, i) => [t, i]).filter(([t]) => sameEntry(t, want, place)).sort((a, b) => a[0].length - b[0].length);
          if (hits.length) { await opts.nth(hits[0][1]).click(); fixed = true; break; }
          await page.keyboard.press("Escape");
        } catch { /* try the next search */ }
      }
      if (fixed) notes.push(`"${f.label.slice(0, 60)}": replaced "${shown}" with the entry for "${want}"`);
      else {
        // Wrong is worse than empty: clear it and leave it for the user.
        await box.click().catch(() => {});
        await box.fill("").catch(() => {});
        await page.keyboard.press("Backspace").catch(() => {});
        await page.keyboard.press("Escape").catch(() => {});
        notes.push(`"${f.label.slice(0, 60)}": the list showed "${shown}", not "${want}", and "${want}" could not be found, so it was cleared`);
        k.kind = "decide"; k.note = `"${want}" is not in this list; pick it yourself`;
      }
      break;
    }
  }
  return notes;
}

// An "I acknowledge" or "I authorize" question can carry a waiver in the text printed under
// it rather than in its label. Read the text around the question; if it gives up rights,
// the answer is the user's to give.
export const WAIVER_RX = /arbitrat|waive|waiver|jury trial|class action|release (of )?(all |any )?(claims|liability)|hold harmless|indemnif/i;
const ACKISH = /acknowledg|authori[sz]|certif|attest|agree|consent|i (have )?read|terms/i;
export const NEARBY_JS = `(label) => {
  const norm = (t) => String(t || '').replace(/[\\s\\u00a0]+/g, ' ').replace(/\\*\\s*$/, '').trim().toLowerCase();
  const want = norm(label);
  const lab = [...document.querySelectorAll('label, legend, [class*=label], [class*=question]')].find((l) => norm(l.innerText) === want);
  if (!lab) return '';
  let box = lab.closest('[class*=field], fieldset, .question, [class*=question]') || lab.parentElement;
  let text = box.innerText || '';
  for (let n = box.nextElementSibling, i = 0; n && i < 3 && text.length < 4000; n = n.nextElementSibling, i++) {
    if (n.querySelector('input, select, textarea, [role=combobox]')) break;
    text += '\\n' + (n.innerText || '');
  }
  return text.slice(0, 6000);
}`;

export async function holdBindingAcks(page, kit) {
  const notes = [];
  for (const k of kit) {
    if (k.fieldIndex === undefined || k.kind === "decide" || k.kind === "blank" || k.kind === "file" || !ACKISH.test(k.label)) continue;
    let text = "";
    for (const f of page.frames()) { text = await f.evaluate(`(${NEARBY_JS})(${JSON.stringify(k.label)})`).catch(() => ""); if (text) break; }
    const m = text.replace(k.label, "").match(WAIVER_RX);
    if (!m) continue;
    if (allowArbitration && /arbitrat/i.test(m[0]) && !/waive|waiver|jury|class action|release|hold harmless|indemnif/i.test(text)) continue;
    notes.push(`"${k.label.slice(0, 70)}": the text with it mentions "${m[0]}", so it waits for you`);
    Object.assign(k, { kind: "decide", value: "", note: `this acknowledgement includes "${m[0]}"; read it and answer it yourself` });
  }
  return notes;
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

// The choices of a question the app stopped on, read from the page, so the person picks one of the
// form's own answers instead of guessing its wording: a native list is read; a custom one is opened,
// read and closed again without choosing anything.
export async function choicesOn(page, label) {
  const name = String(label).replace(/\*\s*$/, "").trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!name) return [];
  const clean = (list) => [...new Set(list.map((t) => String(t).replace(/\s+/g, " ").trim()).filter((t) => t && t.length < 200 && !/^(select|choose|please select|--|—)/i.test(t)))].slice(0, 60);
  for (const f of formFrames(page)) {
    const rx = new RegExp("^\\s*" + name, "i");
    for (const box of [f.getByLabel(rx).first(), f.getByRole("combobox", { name: rx }).first(), f.getByRole("button", { name: rx }).first()]) {
      if (!(await box.count().catch(() => 0))) continue;
      try {
        const tag = await box.evaluate((el) => el.tagName);
        if (tag === "SELECT") return clean(await box.locator("option").allInnerTexts());
        if (tag === "INPUT" && /radio|checkbox/i.test(await box.getAttribute("type") || "")) continue;
        await box.click({ timeout: 4000 });
        await sleep(900);
        const texts = clean(await f.locator("[role=option]:visible, [data-automation-id=promptOption]:visible").allInnerTexts());
        await page.keyboard.press("Escape").catch(() => {});
        if (texts.length > 1) return texts;
      } catch { /* not this one */ }
    }
  }
  return [];
}

async function showsValue(page, label) {
  for (const f of page.frames()) if (await f.evaluate(`(${SHOWS_VALUE_JS})(${JSON.stringify(label)})`).catch(() => false)) return true;
  return false;
}

const ACK = /acknowledg|privacy (notice|policy)|i (have )?read|terms of (use|service)|consent to (the )?(processing|collection)/i;
export const BINDING_RX = /arbitration|waive|waiver|jury|non-?compete|non-?solicit|class action|release of (claims|liability)|background check|drug (test|screen)/i;
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
  for (const f of formFrames(page)) {
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

const emailCode = (mailbox, since, domains) => (mailbox ? waitForCode(mailbox, since, 180, domains) : Promise.resolve(null));

// Who may send the code for this form: the system the Submit frame is on, or the employer's own site (the job's
// apply link). The code goes only into that frame.
export const codeSenders = (frameUrl, applyUrl) => [...new Set([...mailDomainsFor(frameUrl), ...mailDomainsFor(applyUrl)])];

// Type the code into the code box (one input, or one box per character) of the frame where Submit was
// pressed, then confirm. No other frame sees it.
export async function enterCode(frame, code) {
  for (const f of [frame]) {
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

// Some sites (Paycom) render a pop-up form inside a section marked aria-hidden, which the form
// reader rightly skips. When a box there is plainly on screen and not covered, the mark is wrong:
// take it off, so the form is read.
export const UNHIDE_JS = `(() => {
  let n = 0;
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (el.getAttribute('aria-hidden') === 'true') continue;
    const h = el.closest('[aria-hidden=true]');
    if (!h || h.hasAttribute('data-ap-unhid')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight) continue;
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top || !(top === el || el.contains(top) || top.contains(el) || (el.labels && [...el.labels].some((l) => l.contains(top))))) continue;
    h.setAttribute('aria-hidden', 'false'); h.setAttribute('data-ap-unhid', '1'); n++;
  }
  return n;
})()`;

// ---------- which frames may see the person's data ----------
// Only the form itself: frames on the main page's origin or the job's own apply link, or an application system
// the app knows (ats.js) embedding its form. An ad, a tracker or any other page in a frame never receives an
// answer, the resume, or the bridge to content.js.
const originOf = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.origin : null; } catch { return null; } };
export function frameAllowed(mainUrl, frameUrl, applyUrl = "") {
  const o = originOf(frameUrl);
  if (!o) return false;
  if (o === originOf(mainUrl) || (applyUrl && o === originOf(applyUrl))) return true;
  return new URL(frameUrl).protocol === "https:" && isApplicationSystem(frameUrl);
}
// The job's apply link, for each page an application uses.
const JOB_LINK = new WeakMap();
// The main frame is the page the app itself opened; the gate is for the frames inside it. Checked again at
// every call: frames navigate.
export const formFrames = (page) => page.frames().filter((f) => f === page.mainFrame() || frameAllowed(page.url(), f.url(), JOB_LINK.get(page)));

// A message for one frame. A fill goes only to a frame that has form fields, with the whole kit (it lands in the
// frame's isolated world, where the page can't read it, and content.js matches it to the fields as it always
// has), and with the resume only when the frame has a file input. shape: { fields: count, file }. null: nothing.
export function frameMessage(msg, shape) {
  if (msg.type !== "fill") return msg;
  if (!shape || !shape.fields) return null;
  return { ...msg, resume: shape.file ? msg.resume : null };
}
// How many form controls a frame has, and whether one takes a file, counted inside web components too: cheap,
// unlike a full scrape, which opens dropdowns to read their options.
const FORM_SHAPE_JS = `(() => { let fields = 0, file = false;
  const walk = (root) => { for (const el of root.querySelectorAll("input:not([type=hidden]), select, textarea, [role=combobox], [role=radio], [role=checkbox], [role=listbox], [contenteditable=true]")) { fields++; if (el.type === "file") file = true; }
    for (const h of root.querySelectorAll("*")) if (h.shadowRoot) walk(h.shadowRoot); };
  walk(document); return { fields, file }; })()`;

// The bridge to content.js lives in an isolated world of each frame (CDP Page.createIsolatedWorld), the way a
// browser extension's content script does: page script can't define, wrap or read __apSend/__apListeners.
const SESSIONS = new WeakMap(), WORLDS = new WeakMap();
const bareUrl = (u) => String(u || "").split("#")[0];
async function sessionFor(page, frame) {
  for (let f = frame; f; f = f.parentFrame()) {
    if (SESSIONS.has(f)) return { s: SESSIONS.get(f), root: f };
    try { const s = await page.context().newCDPSession(f === page.mainFrame() ? page : f); SESSIONS.set(f, s); return { s, root: f }; }
    catch { /* this frame shares its parent's target */ }
  }
  return null;
}
async function cdpFrameId(s, root, frame) {
  const { frameTree } = await s.send("Page.getFrameTree");
  const chain = [];
  for (let f = frame; f && f !== root; f = f.parentFrame()) chain.unshift(f);
  let node = frameTree;
  for (const f of chain) {
    const k = f.parentFrame().childFrames().filter((c) => bareUrl(c.url()) === bareUrl(f.url())).indexOf(f);
    const cands = (node.childFrames || []).filter((c) => bareUrl(c.frame.url) === bareUrl(f.url()));
    node = cands[Math.max(0, k)];
    if (!node) return null;
  }
  return node.frame.id;
}
async function worldOf(page, frame) {
  const w = WORLDS.get(frame);
  if (w && w.url === frame.url()) return w;
  const ses = await sessionFor(page, frame);
  if (!ses) return null;
  const frameId = await cdpFrameId(ses.s, ses.root, frame);
  if (!frameId) return null;
  const { executionContextId } = await ses.s.send("Page.createIsolatedWorld", { frameId, worldName: "job-autopilot", grantUniveralAccess: false });
  const ev = async (expression) => {
    const r = await ses.s.send("Runtime.evaluate", { expression, contextId: executionContextId, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("content script: " + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text || "failed").slice(0, 200));
    return r.result ? r.result.value : undefined;
  };
  await ev(SHIM + "\n" + CONTENT_JS);
  const nw = { url: frame.url(), ev };
  WORLDS.set(frame, nw);
  return nw;
}
async function inWorld(page, frame, expression) {
  for (let t = 0; t < 2; t++) {
    try { const w = await worldOf(page, frame); return w ? await w.ev(expression) : undefined; }
    catch (e) { WORLDS.delete(frame); if (t) throw e; } // the frame navigated: a fresh world, once
  }
}

async function inject(page) {
  for (const f of formFrames(page)) {
    try { await inWorld(page, f, UNHIDE_JS); } catch { /* detached or blocked frame */ }
  }
}

export async function eachFrame(page, msg) {
  await inject(page);
  const out = [];
  for (const f of formFrames(page)) {
    try {
      // A fill goes to a frame only when it has fields right now, and the resume only with a file input.
      let m = msg;
      if (msg.type === "fill") {
        m = frameMessage(msg, await inWorld(page, f, FORM_SHAPE_JS));
        if (!m) continue;
      }
      const r = await inWorld(page, f, `window.__apSend(${JSON.stringify(m)})`);
      if (r) out.push(Object.assign(r, { frame: f }));
    } catch { /* frame went away */ }
  }
  return out;
}

export async function scrapeAll(page) {
  let parts = [];
  for (let t = 0; t < 8; t++) {
    parts = await eachFrame(page, { type: "scrape" });
    if (Math.max(0, ...parts.map((p) => p.fields.length)) >= 3) break;
    await sleep(2500);
  }
  // React dropdowns' options, which the isolated scrape can't read: from the page's own lists, matched by label.
  const nkl = (s) => String(s || "").toLowerCase().replace(/\*/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  for (const p of parts) {
    if (!p.fields.some((f) => f.type === "combo" && !f.options)) continue;
    const lists = await p.frame.evaluate(RS_OPTIONS_JS).catch(() => []);
    for (const f of p.fields) {
      if (f.type !== "combo" || f.options) continue;
      const l = lists.find((x) => nkl(x.label) === nkl(f.label));
      if (l && l.options.length > 1) f.options = l.options;
    }
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
  for (const f of formFrames(page)) {
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

// A timed-out run shuts the browser down, so nothing it was doing can carry on.
export const abortCurrent = () => closeBrowser();

// https only; plain http just for this computer itself (127.0.0.1, localhost), which never leaves it.
// An http:// link to another computer, as https:// (most sites answer both); anything else as it is.
export const toHttps = (u) => { const s = String(u || ""); return /^http:\/\//i.test(s) && !httpsOk(s) ? "https://" + s.slice(7) : s; };
export function httpsOk(u) {
  try { const x = new URL(String(u)); return x.protocol === "https:" || (x.protocol === "http:" && /^(127\.0\.0\.1|localhost|\[::1\])$/.test(x.hostname)); } catch { return false; }
}

// "minimized" unless the user chose otherwise; the old headless switch still counts.
export const windowModeOf = (s) => s.windowMode || (s.headless ? "headless" : "minimized");

const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);

// "Next" on a form split over several pages (Paycom, SmartRecruiters, many hourly-job forms).
export const NEXT_JS = `(() => {
  const vis = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.disabled;
  const txt = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const rx = /^(next|next step|next page|continue|save (and|&) continue|save (and|&) next|proceed|continue to next step|next: .{1,40}|continue to .{1,40})(\\s*[>→»])?$/;
  const b = [...document.querySelectorAll('button, input[type=submit], input[type=button], [role=button], a.btn, a.button')].filter(vis).filter((e) => rx.test(txt(e))).pop();
  if (!b) return null;
  b.setAttribute('data-ap-next', '1');
  return txt(b);
})()`;

// Buttons and links that open the form from a posting page. Never "Apply with LinkedIn/Indeed".
const APPLY_RX = /^\s*(apply( now| online| here| today)?|apply for (this|the) (job|position|role)|apply to this (job|position)|i'?m interested|start (your |my )?application|begin application)\s*[>→»]?\s*$/i;

// Cookie banners cover the page and swallow clicks. Decline the optional ones; accept only when there is no other way.
const COOKIE_NO = /^\s*(decline all|reject all|decline|reject|reject optional|only necessary|necessary only|use necessary cookies only|deny|refuse all)\s*$/i;
const COOKIE_YES = /^\s*(accept all|accept|accept cookies|allow all|i agree|agree|got it|ok|okay)\s*$/i;
export async function dismissCookies(page) {
  for (const rx of [COOKIE_NO, COOKIE_YES]) {
    for (const f of page.frames()) {
      const b = f.getByRole("button", { name: rx }).first();
      if (await b.isVisible().catch(() => false)) { await b.click({ timeout: 5000 }).catch(() => {}); await sleep(600); return true; }
    }
  }
  return false;
}

// The tab that holds the form on some posting pages (Workable's "Application").
const TAB_RX = /^\s*(application|apply)\s*$/i;

async function openForm(page, slug) {
  await dismissCookies(page);
  let btn = page.getByRole("button", { name: APPLY_RX }).or(page.getByRole("link", { name: APPLY_RX })).first();
  if (!(await btn.isVisible().catch(() => false))) {
    btn = page.getByRole("tab", { name: TAB_RX }).or(page.getByRole("link", { name: TAB_RX })).first();
    if (!(await btn.isVisible().catch(() => false))) return page;
  }
  // The form may open in a new tab: only a popup this page opened, never any other window in the browser
  // (one left open by an earlier posting would otherwise get this job's answers).
  const popup = page.waitForEvent("popup", { timeout: 6000 }).catch(() => null);
  await btn.click({ timeout: 10000 }).catch(() => btn.click({ force: true, timeout: 5000 }).catch(() => {}));
  let next = await popup;
  if (next && (await next.opener().catch(() => null)) !== page) next = null;
  const target = next || page;
  await target.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await target.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await sleep(2500);
  if (next) log(slug, "the form opened in a new tab: " + next.url().slice(0, 120));
  return target;
}

async function loginWall(page) {
  let pw = 0, fields = 0, signIn = false;
  for (const f of page.frames()) {
    const r = await f.evaluate(LOGIN_WALL_JS).catch(() => null);
    if (r) { pw += r.pw; fields += r.fields; signIn = signIn || r.signIn; }
  }
  return (pw > 0 && fields < 8) || (signIn && fields < 3);
}

const CLOSED_RX = /no longer (accepting|available|open)|position (has been )?filled|job (is )?closed|page not found|job not found|job you requested was not found|posting (is )?(closed|expired)|this job (has )?expired/i;
const MAX_PAGES = 8;

// hooks: progress(stepKey), onFilled(page), status(text), opts: { dryRun, settings, answers, prefs, mailbox, browser }
export async function applyTo(job, hooks = {}, opts = {}) {
  const settings = opts.settings || getSettings();
  const a = opts.answers || getAnswers();
  const prefs = opts.prefs || getPrefs();
  const dryRun = opts.dryRun ?? settings.dryRun;
  // "Back to dry run" or Pause pressed while this application runs stops it before anything is sent: the
  // settings are read again right before Submit, the emailed code and the confirmation wait.
  const at0 = getSettings();
  const halted = () => { const s = getSettings(); return (s.dryRun && !at0.dryRun) ? "you switched back to dry run" : (s.paused && !at0.paused) ? "you paused the autopilot" : ""; };
  allowArbitration = arbitrationAllowed(a, job.company);
  COMBO_FALLBACK = comboFallback(a);
  const jobLocal = withinRadius(job.location, prefs);
  // A run the worker gave up on (it timed out) stops at its next step, page load or press: nothing more is
  // sent, and nothing more is reported for it.
  const cut = () => { if (opts.signal && opts.signal.aborted) throw new Error("application timed out"); };
  const step = (k) => { cut(); try { hooks.progress && hooks.progress(k); } catch { /* display only */ } };
  step("browser");
  const profile = opts.profile || loadProfile();
  const details = JSON.parse(job.details || "{}");
  const pages = [];
  let page, bh = null, pagesBefore = null;
  const result = { details };
  const manual = (reason) => ({ ...result, status: "manual", reason: "Apply yourself: " + reason });
  try {
    const mode = windowModeOf(settings);
    bh = opts.browser ? { ctx: opts.browser } : await acquireBrowser({ windowMode: mode, choice: settings.browser, onStatus: (t) => hooks.status && hooks.status(t) });
    pagesBefore = new Set(bh.ctx.pages());
    page = await newAppPage(bh, mode);
    const link = toHttps(job.apply_url);
    JOB_LINK.set(page, link);
    pages.push(page);
    page.setDefaultTimeout(30000);
    if (process.env.AP_DEBUG) {
      page.on("response", (r) => { if (r.request().method() !== "GET") console.log("NET", r.status(), r.request().method(), r.url().slice(0, 160)); });
      page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text().slice(0, 200)); });
    }
    step("open");
    // Only over https, never a government job site, checked again wherever the page may have moved.
    if (!httpsOk(link)) return manual("the application link isn't a web address the app can open over https (an encrypted connection)");
    const unsafePage = () => (isGovUrl(page.url()) ? manual(`it moved to ${hostOf(page.url()).replace(/^www\./, "")}, a government job site that needs your own account there, so the app doesn't fill it`)
      : !httpsOk(page.url()) ? manual(`the form is on a page without https (${hostOf(page.url()) || page.url().slice(0, 40)}), so the app doesn't fill it`) : null);
    log(job.slug, "opening " + link + (link !== job.apply_url ? " (the link said http://)" : ""));
    cut();
    // An http:// link opened as https://: a site that doesn't answer there is the person's to apply to.
    const resp = await page.goto(link, { waitUntil: "domcontentloaded", timeout: 60000 }).catch((e) => { if (link === job.apply_url) throw e; return "no https"; });
    if (resp === "no https") return manual(`${hostOf(link)} only answers over plain http (unencrypted), so the app doesn't open it`);
    if (resp && resp.status() >= 400) return { ...result, status: "skipped", reason: `posting page returned ${resp.status()} (probably closed)` };
    if (unsafePage()) return unsafePage();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await sleep(2000);
    if (unsafePage()) return unsafePage(); // a redirect that came after the first page loaded

    step("read");
    await dismissCookies(page);
    let { text, fields } = await scrapeAll(page);
    if (fields.length < 3 && !CLOSED_RX.test(text.slice(0, 3000))) {
      // A posting page with an "Apply" button in front of the form.
      const target = await openForm(page, job.slug);
      if (target !== page) { pages.push(target); page = target; page.setDefaultTimeout(30000); JOB_LINK.set(page, link); }
      if (unsafePage()) return unsafePage();
      ({ text, fields } = await scrapeAll(page));
    }
    if (CLOSED_RX.test(text.slice(0, 3000)) && fields.length < 5) return { ...result, status: "skipped", reason: "posting is closed" };
    if (isWorkday(page.url()) && await workdayApplyManually(page)) ({ text, fields } = await scrapeAll(page));
    // A Workday site, and the user let the app make accounts: sign up (or sign in) with their email and password.
    const creds = siteAccounts(settings);
    let signedIn = false;
    const accountNotes = [];
    // Only on a Workday page itself: a stored Workday link that led somewhere else never gets the password.
    if (creds && isWorkday(page.url())) {
      step("account");
      const getLink = opts.waitLink || ((since, host) => (opts.mailbox ? waitForLink(opts.mailbox, since, host, 180) : Promise.resolve(null)));
      // the confirmation link is opened right after: not for a run that has timed out
      const waitLink = async (since, host) => { cut(); const l = await getLink(since, host); cut(); return l; };
      const r = await workdayAccount(page, creds, { waitLink, log: (m) => log(job.slug, m), allowArbitration });
      if (!r.ok) return { ...result, status: "failed", reason: r.reason, screenshot: await shot(page, job.slug, "account") };
      signedIn = true;
      accountNotes.push(...r.notes);
      for (const x of r.notes) log(job.slug, x);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      ({ text, fields } = await scrapeAll(page));
    }
    if (await loginWall(page)) return { ...manual(`${new URL(page.url()).hostname} asks you to sign in or create an account first`), screenshot: await shot(page, job.slug, "signin") };
    if (fields.length < 3) return { ...manual("the app found no form it can fill on this page (it may be a chat, or a site the app does not know)"), screenshot: await shot(page, job.slug, "noform") };

    const postingText = [text, details.description ? "\n\nFROM THE JOB LISTING:\n" + details.description : ""].join("").slice(0, 30000);
    const allKit = [], allFields = [], audit = [...accountNotes];
    const rep = { filled: [], kept: [], decide: [], drafts: [], missing: [] };
    let resume = null; // built on the first page, uploaded wherever a page asks for it
    for (let n = 1; ; n++) {
      step("plan");
      log(job.slug, `${n > 1 ? `page ${n}: ` : ""}${fields.length} fields; asking ${settings.ai.model} for a plan`);
      const pageNote = n > 1 ? `\n\n(This is page ${n} of the application form; earlier pages are already filled in.)` : "";
      const p = await plan(profile, { url: page.url(), text: postingText + pageNote, fields }, a, prefs);
      if (n === 1) {
        // A "fail" whose own reason says the requirement is met is the model contradicting itself.
        const metAnyway = (f) => /\b(meets|satisf(ies|y)|exceeds|has (the )?(required|enough))\b/i.test(f.why || "") && !/\b(not|no|lacks?|without|fails?|short)\b|n't/i.test(f.why || "");
        const hardFails = ((p.fit || {}).hardFails || []).filter((f) => f && f.requirement && !metAnyway(f));
        result.details = { ...details, plan: { employer: p.employer, jobTitle: p.jobTitle, base: p.base, summary: p.summary, notClaimed: p.notClaimed || [] }, hardFails };
        // A job the user added by hand is theirs to judge: the must-haves are noted, not a reason to skip.
        if (hardFails.length && !details.addedByUser) {
          return { ...result, status: "skipped", reason: "fails a must-have: " + hardFails.map((f) => `${f.requirement}${f.why ? " (" + f.why + ")" : ""}`).join("; ").slice(0, 600) };
        }
      }

      step("build");
      const b = await build(profile, p, fields, { a, prefs, jobLocal });
      if (!resume) {
        if (b.overflow) return { ...result, status: "failed", reason: "resume would not fit on one page" };
        const resumeFile = `${safeName(job.slug)}.pdf`;
        const named = path.join(RESUMES(), safeName(job.slug) + "-" + b.fileName);
        fs.writeFileSync(path.join(RESUMES(), resumeFile), b.pdf);
        fs.writeFileSync(named, b.pdf);
        resume = { file: resumeFile, named, fileName: b.fileName, pdf: b.pdf };
        result.resume_file = resumeFile;
        result.details.resume = { fileName: b.fileName, slack: b.slack, warnings: b.warnings };
      } else {
        for (const k of b.kit) if (k.kind === "file") { k.value = resume.fileName; k.file = resume.fileName; }
      }
      if (allowArbitration) for (const k of b.kit) {
        if (/arbitration/i.test(k.label) && !BINDING.test(k.label) && (k.kind === "decide" || !k.value)) {
          Object.assign(k, { kind: "text", value: "Yes", note: `accepted: your settings allow plain arbitration agreements${a.arbitration === "list" ? " for " + job.company : ""}` });
          b.audit.push(`arbitration agreement accepted for ${job.company}, per your settings`);
        }
      }
      b.audit.push(...await holdBindingAcks(page, b.kit));
      // Last: what the user answered themselves when an earlier try stopped on these questions.
      b.audit.push(...applyYourAnswers(b.kit, fields, yourAnswersFor(job, a)));
      for (const x of b.audit) log(job.slug, "truth check: " + x);
      audit.push(...b.audit);

      step("fill");
      log(job.slug, n > 1 ? `filling page ${n}` : "filling the form");
      const filled = await fillPage(page, b, fields, resume, a, job);
      audit.push(...filled.notes);
      for (const k of ["filled", "drafts", "decide", "missing"]) rep[k].push(...filled.rep[k]);
      allKit.push(...b.kit.filter((k) => k.fieldIndex !== undefined || k.kind === "file").map((k) => (n > 1 ? { ...k, page: n } : k)));
      allFields.push(...fields);
      result.details = { ...result.details, kit: allKit, fields: allFields, audit, report: rep, pages: n };

      step("verify");
      if (hooks.onFilled) await hooks.onFilled(page);
      result.screenshot = await shot(page, job.slug, n > 1 ? `filled-p${n}` : "filled");
      if (filled.blocking.length) {
        // The choices of each question it stopped on, so the person can pick the form's own answer.
        const askOptions = {};
        for (const item of filled.blocking.slice(0, 6)) {
          const label = item.replace(/^(required, no answer|needs you|still empty): /, "").replace(/ \(.*\)$/, "");
          const f = allFields.find((x) => nk(x.label) === nk(label));
          if (f && (f.options || []).length > 1) continue;
          const opts = await choicesOn(page, label).catch(() => []);
          if (opts.length > 1) askOptions[nk(label)] = opts;
        }
        result.details.askOptions = askOptions;
        return { ...result, status: "failed", reason: `could not fill every required field${n > 1 ? ` (page ${n})` : ""}: ` + filled.blocking.slice(0, 6).join("; ") };
      }

      // A form on several pages: "Next" until the page with the real Submit button.
      let nextFrame = null, nextLabel = null;
      for (const f of formFrames(page)) { nextLabel = await f.evaluate(NEXT_JS).catch(() => null); if (nextLabel) { nextFrame = f; break; } }
      if (!nextFrame) break;
      // A dry run never moves past the first page: some sites save an application as soon as you press Next.
      // On a site where the app signed in, pages are saved to the user's own account as a draft and nothing is
      // sent before Submit, so a dry run fills every page and stops there.
      if (dryRun && !signedIn) return { ...result, status: "filled", reason: `dry run: page 1 of a form with several pages filled and checked; later pages are filled when you go live` };
      if (n >= MAX_PAGES) return { ...result, status: "failed", reason: `the form kept asking for more after ${MAX_PAGES} pages` };
      const before = page.url(), beforeLabels = fields.map((f) => f.label).join("|");
      log(job.slug, `pressing "${nextLabel}"`);
      cut();
      await nextFrame.locator("[data-ap-next]").first().click({ timeout: 15000 });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await sleep(3000);
      if (unsafePage()) return unsafePage();
      if (await loginWall(page)) return manual(`after page ${n}, ${new URL(page.url()).hostname} asks you to sign in or create an account`);
      ({ fields } = await scrapeAll(page));
      // Still on the same page: the site refused it (an error the app could not see before).
      if (page.url() === before && fields.map((f) => f.label).join("|") === beforeLabels) {
        const errs = await pageErrors(page);
        return { ...result, status: "failed", reason: `page ${n} was not accepted${errs.length ? ": " + errs.join("; ").slice(0, 400) : ""}`, screenshot: await shot(page, job.slug, `stuck-p${n}`) };
      }
      // A review page with only a Submit button left.
      if (!fields.length) break;
    }
    if (dryRun) return { ...result, status: "filled", reason: signedIn ? `dry run: signed in, filled all ${result.details.pages || 1} pages and stopped before Submit` : "dry run: filled and checked, not submitted" };

    // Submit.
    step("submit");
    let frame = null, label = null;
    for (const f of formFrames(page)) {
      label = await f.evaluate(SUBMIT_JS).catch(() => null);
      if (label) { frame = f; break; }
    }
    if (!frame) return { ...result, status: "failed", reason: "no submit button found" };
    const before = page.url();
    let got428 = false;
    page.on("response", (r) => { if (r.status() === 428 && r.request().method() === "POST") got428 = true; });
    if (halted()) return manual(`${halted()} while this application was being filled, so it was not submitted. It's filled in and waiting: check it and submit it yourself, or try again later`);
    log(job.slug, `pressing "${label}"`);
    await frame.locator("[data-ap-submit]").first().scrollIntoViewIfNeeded().catch(() => {});
    cut();
    await frame.locator("[data-ap-submit]").first().click({ timeout: 15000 });

    step("confirm");
    const submittedAt = Date.now() / 1000;
    if (halted()) return manual(`${halted()} just as Submit was pressed: it may have gone through. Check your email or the site before applying again`);
    let outcome = await waitOutcome(page, before, () => got428);
    if (outcome === "code") {
      // Only a code from the form's own system (or the employer's own site), signed by it.
      const senders = codeSenders(frame.url(), job.apply_url);
      if (!senders.length) {
        result.screenshot = await shot(page, job.slug, "after");
        return { ...result, status: "failed", reason: "security code: the form asks for an emailed code, and the app can't tell who should send it. Open the application and enter it yourself" };
      }
      if (halted()) return manual(`${halted()} before the emailed code was entered, so the application wasn't finished. Open it and enter the code yourself`);
      step("code");
      log(job.slug, "the employer emailed a security code; reading it from the inbox");
      const code = await emailCode(opts.mailbox, submittedAt, senders);
      if (!code) {
        result.screenshot = await shot(page, job.slug, "after");
        return { ...result, status: "failed", reason: `security code: the employer emailed a verification code and the autopilot could not read it (no mailbox access, or no signed email from ${senders.join(" or ")} in 3 minutes)` };
      }
      got428 = false;
      step("confirm");
      cut();
      await enterCode(frame, code);
      outcome = await waitOutcome(page, page.url(), () => got428);
      if (outcome === "code") outcome = null;
    }
    result.screenshot = await shot(page, job.slug, "after");
    if (outcome === "applied") return { ...result, status: "applied", reason: `submitted ("${label}")` };
    const errs = await pageErrors(page);
    const captcha = await page.$('iframe[src*="recaptcha/api2/bframe"], iframe[src*="hcaptcha"][src*="challenge"]').catch(() => null);
    if (errs.some((e) => /matching images|select all|captcha|i'?m not a robot/i.test(e))) {
      return { ...result, status: "failed", reason: "an image CAPTCHA blocked the submit (cannot be solved unattended)" };
    }
    return { ...result, status: "failed", reason: captcha ? "a CAPTCHA challenge blocked the submit" : "submitted but no confirmation appeared" + (errs.length ? ": " + [...new Set(errs)].join("; ").slice(0, 400) : "") };
  } finally {
    // The browser stays open for the next application; only this job's tabs close, and every other page
    // that appeared while it ran (popups, windows a page opened), so nothing of this job reaches the next.
    for (const pg of pages.reverse()) await closeAppPage(pg, windowModeOf(settings));
    if (bh && pagesBefore) for (let round = 0; round < 5; round++) {
      const extra = bh.ctx.pages().filter((pg) => !pagesBefore.has(pg) && !pg.isClosed());
      if (!extra.length) break;
      for (const pg of extra) await closeAppPage(pg, windowModeOf(settings));
    }
  }
}

async function pageErrors(page) {
  const errs = [];
  for (const f of page.frames()) {
    errs.push(...await f.evaluate(() => [...document.querySelectorAll('[class*=error], [role=alert], .invalid-feedback, [aria-invalid=true]')]
      .map((e) => (e.innerText || e.getAttribute("aria-label") || e.name || "").trim()).filter(Boolean).slice(0, 6)).catch(() => []));
  }
  return [...new Set(errs)];
}

// Some sites fill in a location from the computer's internet address (Workable guesses a nearby
// city). A box that already holds a place other than the user's own is cleared, so the user's
// answer goes in instead.
export const CLEAR_STALE_JS = `([label, want]) => {
  const norm = (t) => String(t || '').replace(/[\\s\\u00a0]+/g, ' ').replace(/\\(optional\\)|\\*/gi, '').trim().toLowerCase();
  const target = norm(label);
  const lab = [...document.querySelectorAll('label, legend')].find((l) => norm(l.innerText) === target);
  if (!lab) return null;
  const box = (lab.htmlFor && document.getElementById(lab.htmlFor)) || (lab.closest('[class*=field], fieldset, div') || lab.parentElement).querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea');
  if (!box || !box.value || want.some((w) => box.value.toLowerCase().includes(w))) return null;
  const old = box.value;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value').set;
  setter.call(box, '');
  box.dispatchEvent(new Event('input', { bubbles: true }));
  box.dispatchEvent(new Event('change', { bubbles: true }));
  return old;
}`;
const PLACE_RX = /address|location|city|where do you live|zip|postal/i;

// Fill one page of the form from its kit, with every fix the private version learned, then check it.
async function fillPage(page, b, fields, resume, a, job) {
  const notes = [];
  const fillMsg = { type: "fill", kit: { fields: b.kit, header: {} }, resume: { name: resume.fileName, b64: resume.pdf.toString("base64") } };
  await fillReactSelects(page, b.kit, a.state || a.country || "");
  let first = await eachFrame(page, fillMsg);
  const want = [a.city, a.zip].filter(Boolean).map((x) => String(x).toLowerCase());
  let cleared = 0;
  if (want.length) for (const r of first) for (const k of r.kept || []) {
    if (!PLACE_RX.test(k.label)) continue;
    const old = await r.frame.evaluate(`(${CLEAR_STALE_JS})(${JSON.stringify([k.label, want])})`).catch(() => null);
    if (old) { cleared++; notes.push(`"${k.label.slice(0, 50)}" held "${old.slice(0, 60)}" (the site's guess, not your city), so it was replaced`); }
  }
  if (cleared) { await sleep(500); first = await eachFrame(page, fillMsg); }
  await ensureResume(page, resume.named);
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
      const x = again.find((y) => y.frame === r.frame);
      if (!x) return r;
      return { ...r, filled: [...(r.filled || []), ...(x.filled || [])], decide: (r.decide || []).filter((y) => !stuck.includes(y.label) || (x.decide || []).some((z) => z.label === y.label)) };
    });
  }
  await ensureResume(page, resume.named);
  await answerGroups(page, b.kit);
  await fillCombos(page, b.kit, a.state || a.country || "");
  const stuck = second.flatMap((r) => [...(r.missing || []), ...(r.decide || []).filter((x) => /^Could not set it/.test(x.note || ""))])
    .map((x) => x.label).filter((l) => !BINDING.test(l));
  if (stuck.length) await fixDropdowns(page, b.kit, stuck);
  for (const n of await verifyCombos(page, b.kit, fields)) { notes.push("list check: " + n); log(job.slug, "list check: " + n); }
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
  const groupsLeft = [];
  for (const f of formFrames(page)) {
    for (const g of await f.evaluate(GROUPS_JS).catch(() => [])) if (g.required) groupsLeft.push(g.label);
    for (const c of await f.evaluate(COMBOS_JS).catch(() => [])) if (c.required && !(await showsValue(page, c.label))) groupsLeft.push(c.label);
  }
  // Gates: nothing required may be left empty, guessed, or waiting on a person.
  const required = new Set(fields.filter((f) => f.required).map((f) => f.label));
  const blocking = [
    ...rep.missing.map((x) => `required, no answer: ${x.label}`),
    ...rep.decide.filter((x) => required.has(x.label)).map((x) => `needs you: ${x.label}${x.note ? " (" + x.note + ")" : ""}`),
    ...groupsLeft.map((l) => `required, no answer: ${l}`),
  ];
  for (const f of formFrames(page)) {
    const empty = await f.evaluate(CHECK_JS).catch(() => []);
    for (const l of empty) if (!blocking.some((x) => x.includes(l))) blocking.push(`still empty: ${l}`);
  }
  return { rep, blocking, notes };
}
