// A diagnostics report: what the app tried and where it stopped, in one file the person can send to whoever helps them
// with the app. For each application that stopped: the questions the form asked (with its own choices), why the app
// couldn't answer them, and how it answered the rest; the jobs left to them and why; the app's recent activity, its
// settings and what's set up. Personal details are left out unless the person chooses to include them: their name,
// contact details and links become "[email]", "[phone]" and so on, and of their answers only whether each is set.
import os from "node:os";
import { getDb } from "./db.js";
import { getAnswers, getPrefs, getProfile, getSecret, getSettings } from "./store.js";
import { asksFor } from "./asked.js";

const arr = (x) => (Array.isArray(x) ? x : []);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

// The person's own details, wherever they appear in a string, replaced by what they are.
export function redactor(answers = {}, profile = {}) {
  const pairs = [], phones = [];
  const add = (v, tag) => { const s = String(v || "").trim(); if (s.length >= 3) pairs.push([s, tag]); };
  const c = (profile && profile.contact) || {};
  add(answers.email, "[email]"); add(c.email, "[email]");
  for (const p of [answers.phone, c.phone]) {
    add(p, "[phone]");
    const digits = String(p || "").replace(/\D/g, "");
    if (digits.length >= 7) { add(digits, "[phone]"); add(digits.slice(-10), "[phone]"); phones.push(digits.slice(-10)); }
  }
  add(profile && profile.name, "[name]");
  add([answers.firstName, answers.lastName].filter(Boolean).join(" "), "[name]");
  add(answers.firstName, "[first name]"); add(answers.lastName, "[last name]"); add(answers.preferredName, "[first name]");
  add(answers.street, "[street address]"); add(answers.zip, "[zip code]");
  for (const k of ["linkedin", "github", "website"]) { add(answers[k], `[${k}]`); add(c[k], `[${k}]`); }
  for (const l of String(answers.otherLinks || "").split(/\s+/)) add(l, "[link]");
  pairs.sort((x, y) => y[0].length - x[0].length);
  const rx = pairs.map(([v, tag]) => [new RegExp(`(?<![A-Za-z0-9])${esc(v)}(?![A-Za-z0-9])`, "gi"), tag]);
  // The phone number however it's written: "(512) 555-0142", "512.555.0142", "+1 512 555 0142".
  for (const d of new Set(phones)) rx.push([new RegExp(`(?<![0-9])(\\+?1[\\s.-]?)?\\(?${d.split("").join("[\\s().-]{0,2}")}(?![0-9])`, "g"), "[phone]"]);
  // The person's own folder holds their account's name ("C:\\Users\\maria").
  const homeDir = os.homedir();
  if (homeDir && homeDir.length > 3) rx.push([new RegExp(esc(homeDir), "gi"), "[home folder]"]);
  const one = (s) => { let t = String(s); for (const [r, tag] of rx) t = t.replace(r, tag); return t.replace(EMAIL, "[email]"); };
  const deep = (v) => (typeof v === "string" ? one(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);
  return deep;
}

const KEEP = new Set(["country", "authCountry", "state", "noticePeriod", "startAvailability", "heardAbout", "canLift", "hoursWanted", "relocation", "travel"]);
// What the person said about themselves on legal and personal questions: only whether it's answered.
const PRIVATE = new Set(["workAuthorized", "needsSponsorship", "citizen", "over18", "over21", "convictions", "driversLicense", "drivingRecord", "transportation", "ownVehicle"]);
// The app's notes on an application quote answers ("work authorization: "No" corrected to "Yes" on ..."): the question
// stays, what was answered goes.
const scrub = (line) => String(line)
  .replace(/^((?:truth check: |list check: )?(?:work authorization|sponsorship|citizenship|legal agreement|gender|race|hispanic|veteran|disability|orientation|relocation|years)[^:]*): "[^"]*" corrected to (?:"[^"]*"|a question for you) on /i, "$1: corrected on ")
  .replace(/your (standing )?answer "[^"]*" (used|isn't)/gi, "your $1answer $2");
// Which answers are set, without what they say.
function answersSummary(a) {
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (k === "yourAnswers") continue;
    if (k === "demographics") out[k] = Object.fromEntries(Object.entries(v || {}).map(([d, x]) => [d, x === "decline" ? "decline" : x ? "answered" : "empty"]));
    else if (Array.isArray(v)) out[k] = `${v.length} item${v.length === 1 ? "" : "s"}`;
    else if (typeof v === "boolean" || typeof v === "number") out[k] = v;
    // The choices that steer answers (yes/no, ask/none) and answers about no one in particular (the country, the
    // notice period) are kept; anything else typed is only "set".
    else out[k] = !v ? "empty" : PRIVATE.has(k) ? "set" : KEEP.has(k) || /^(yes|no|ask|none|never|plain|list|clean|either|full|part|some|radius|anywhere|decline)$/i.test(String(v)) ? v : "set";
  }
  out.yourAnswers = arr(a.yourAnswers).map((x) => ({ question: x.label, scope: x.scope === "all" ? "every application" : "one job", company: x.company || "" }));
  return out;
}

function profileSummary(p) {
  if (!p) return null;
  const bullets = ["experience", "projects"].flatMap((k) => arr(p[k]).flatMap((e) => arr(e.bullets)));
  return { experience: arr(p.experience).map((e) => ({ title: e.title, lines: arr(e.bullets).length, approved: arr(e.bullets).filter((b) => b.approved).length })),
    projects: arr(p.projects).length, lines: bullets.length, approvedLines: bullets.filter((b) => b.approved).length,
    summaries: arr(p.summaries).length, approvedSummaries: arr(p.summaries).filter((s) => s.approved).length,
    skills: arr(p.skills).map((s) => ({ label: s.label, approved: !!s.approved })), education: arr(p.education).length, layouts: arr(p.bases).length };
}

const parse = (s) => { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };
const hostOf = (u) => { try { return new URL(String(u)).hostname; } catch { return ""; } };

// What one stopped (or practice) application looked like: its questions, how each was answered, and why it stopped.
function application(j, personal) {
  const d = parse(j.details);
  return {
    slug: j.slug, title: j.title, company: j.company, status: j.status, reason: j.reason, attempts: j.attempts, updated: j.updated_at, found: j.found_at,
    source: j.source, site: hostOf(j.apply_url || j.url), url: j.url, applyUrl: j.apply_url,
    waitingOn: asksFor(j, d).map((q) => ({ question: q.label, why: q.note, choices: q.options, kind: q.file ? "file" : q.long ? "long text" : q.choice ? "choice" : "text" })),
    fields: arr(d.fields).slice(0, 150).map((f) => ({ label: f.label, type: f.type, required: !!f.required, choices: arr(f.options).slice(0, 60) })),
    answers: arr(d.kit).slice(0, 150).map((k) => ({ question: k.label, how: k.kind, note: k.note || "", ...(personal ? { value: k.value } : { value: k.value ? "[given]" : "" }) })),
    leftForYou: arr((d.report || {}).decide), missing: arr((d.report || {}).missing), checks: personal ? arr(d.audit) : arr(d.audit).map(scrub), mustHaves: arr(d.hardFails), pages: d.pages || null,
    fit: d.check ? { met: d.check.met, checked: d.check.checked } : null,
  };
}

// The report. app: { version, packaged } from the window's side.
export function diagnostics({ personal = false, app = {}, state = {}, lastSearch = {} } = {}) {
  const db = getDb(), s = getSettings(), a = getAnswers(), p = getProfile(), prefs = getPrefs();
  const rows = (sql, ...args) => db.prepare(sql).all(...args);
  const counts = Object.fromEntries(rows("SELECT status, COUNT(*) n FROM jobs GROUP BY status").map((r) => [r.status, r.n]));
  const skippedWhy = rows("SELECT reason, COUNT(*) n FROM jobs WHERE status = 'skipped' GROUP BY substr(reason, 1, 60) ORDER BY n DESC LIMIT 40");
  const { mailbox, siteAccounts, ai, ...rest } = s;
  const report = {
    format: "job-autopilot/diagnostics@1", createdAt: new Date().toISOString(), personalDetails: personal ? "included" : "left out",
    app: { version: app.version || "", packaged: !!app.packaged, platform: process.platform, arch: process.arch, os: `${os.type()} ${os.release()}`, electron: process.versions.electron || "", node: process.versions.node },
    settings: { ...rest, ai: { provider: (ai || {}).provider, server: hostOf((ai || {}).apiBase), model: (ai || {}).model, keySaved: !!getSecret("apiKey") },
      mailbox: mailbox ? { connected: !!getSecret("mailPassword"), server: mailbox.host, preset: mailbox.preset } : null,
      siteAccounts: { enabled: !!(siteAccounts || {}).enabled, consent: !!(siteAccounts || {}).consent, passwordSaved: !!getSecret("sitePassword") } },
    lookingFor: { ...prefs, alreadyApplied: `${String(prefs.alreadyApplied || "").split("\n").filter((x) => x.trim()).length} lines` },
    aboutYou: personal ? a : answersSummary(a),
    resume: personal ? p : profileSummary(p),
    now: { doing: state.now || "", job: state.job || null, lastSearch, counts, skippedWhy: skippedWhy.map((r) => ({ reason: r.reason, count: r.n })) },
    stopped: rows("SELECT * FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC LIMIT 100").map((j) => application(j, personal)),
    practice: rows("SELECT * FROM jobs WHERE status = 'filled' ORDER BY updated_at DESC LIMIT 20").map((j) => application(j, personal)),
    forYou: rows("SELECT slug, title, company, source, url, apply_url, reason, updated_at FROM jobs WHERE status = 'manual' ORDER BY updated_at DESC LIMIT 100"),
    queued: rows("SELECT slug, title, company, source, url, apply_url, reason, attempts FROM jobs WHERE status IN ('queued', 'working') ORDER BY updated_at DESC LIMIT 50"),
    applied: rows("SELECT title, company, source, applied_at FROM jobs WHERE status = 'applied' ORDER BY applied_at DESC LIMIT 30"),
    skipped: rows("SELECT title, company, source, reason FROM jobs WHERE status = 'skipped' ORDER BY updated_at DESC LIMIT 60"),
    activity: rows("SELECT at, slug, level, message FROM events ORDER BY id DESC LIMIT 1500").map((e) => (personal ? e : { ...e, message: scrub(e.message) })),
  };
  return personal ? report : { ...redactor(a, p)(report), personalDetails: "left out" };
}
