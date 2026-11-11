// The loop: search on a schedule, apply to one queued job at a time, respect
// the daily cap and the pause switch, and never stop on an error.
import fs from "node:fs";
import { getDb, log, setJob, getJob, appliedToday, practicedToday, practiceSince, nextDayStart } from "./db.js";
import { discover } from "./discover.js";
import { companyKey, sameRoleAs, sameUrlAs } from "./dedupe.js";
import { abortCurrent, applyTo, httpsOk, STEPS, toHttps } from "./apply.js";
import { hostOf, isGovUrl } from "./ats.js";
import { acquireBrowser, closeAppPage, closeBrowser, newAppPage, showBrowser } from "./browser.js";
import { windowModeOf } from "./apply.js";

// Sources that are read in a browser (HiringCafe) get a tab in the same out-of-the-way window.
const searchBrowser = {
  async page() {
    const s = getSettings();
    const b = await acquireBrowser({ windowMode: windowModeOf(s), choice: s.browser });
    return newAppPage(b, windowModeOf(s));
  },
  done: (page) => closeAppPage(page, windowModeOf(getSettings())),
};
import { isLocal, plainAiError } from "./llm.js";
import { call } from "./freehire.js";
import { classifyReply, findConfirmation, mailSince, maybeEmployer, replyJob, replySnippet } from "./mail.js";
import { dataDir, getPrefs, getSecret, getSettings, saveSettings } from "./store.js";
import { saveYourAnswers } from "./asked.js";

const CONFIG = new Proxy({}, { get: (_, k) => getSettings()[k] });
const db = new Proxy({}, { get: (_, k) => { const d = getDb(); return typeof d[k] === "function" ? d[k].bind(d) : d[k]; } });

// The mailbox from Settings, with its password from secure storage, or null.
export function mailbox() {
  const m = getSettings().mailbox;
  const pass = m && getSecret("mailPassword");
  return m && m.host && m.user && pass ? { ...m, pass } : null;
}

// trouble: what keeps every application from being tried right now ({ text, kind, at }), or null.
export const state = { now: "starting", job: null, lastSearch: null, nextSearch: null, lastApply: 0, wake: null, progress: null, trouble: null };

// How long each step usually takes, learned from past runs, for the time-left estimate.
const TIMINGS = () => dataDir("timings.json");
let timing;
function loadTimings() {
  timing = Object.assign({ browser: 5, open: 12, read: 10, account: 40, plan: 25, build: 30, fill: 30, verify: 4, submit: 3, code: 12, confirm: 8 },
    (() => { try { return JSON.parse(fs.readFileSync(TIMINGS(), "utf8")); } catch { return {}; } })());
}
function learn(key, seconds) {
  if (!(key in timing) || seconds <= 0 || seconds > 600) return;
  timing[key] = Math.round((timing[key] * 0.7 + seconds * 0.3) * 10) / 10;
  try { fs.writeFileSync(TIMINGS(), JSON.stringify(timing)); } catch { /* estimate only */ }
}

function applyProgress(job) {
  if (!timing) loadTimings();
  const p = { kind: "apply", startedAt: Date.now(), step: null, stepAt: Date.now(), done: [],
    steps: STEPS.map(([key, label]) => ({ key, label, typical: timing[key] })) };
  state.progress = p;
  return (key) => {
    const now = Date.now();
    if (p.step && p.step !== key) { learn(p.step, (now - p.stepAt) / 1000); if (!p.done.includes(p.step)) p.done.push(p.step); }
    if (key === "confirm" && !p.done.includes("code") && p.step !== "code") p.skipCode = true;
    p.step = key; p.stepAt = now;
    p.steps.forEach((x) => { x.typical = timing[x.key]; });
  };
}
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); state.wake = () => { clearTimeout(t); r(); }; });
export const kick = () => { if (state.wake) state.wake(); };
export const forceSearch = () => { state.lastSearch = null; kick(); };
export { searchBrowser };

const TRANSIENT = /timeout|timed out|net::|ECONN|socket|Target (page|closed)|browser has been closed|Model API 5|Model API 429|fetch failed|download failed|No browser could be started|aborted/i;

// Trouble that isn't about the job being tried: no internet, the AI not connected or out of credit, no browser, a full
// disk. Every job would fail the same way, so none is tried (or marked as stopped) until it's sorted out.
// -> { kind: "internet" | "ai" | "resume" | "browser" | "disk", text } or null
export function trouble(message) {
  const m = String(message || "");
  if (/SQLITE_FULL|ENOSPC|database or disk is full/i.test(m)) return { kind: "disk", text: "This computer's disk is full. Free some space; the app carries on when there's room." };
  if (/net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|ADDRESS_UNREACHABLE|NETWORK_ACCESS_DENIED|PROXY_CONNECTION_FAILED)|ENOTFOUND|EAI_AGAIN/i.test(m)) return { kind: "internet", text: "This computer isn't connected to the internet. The app carries on when it is." };
  if (/Add your API key|Model API 40[123]\b|invalid api key|no auth|unauthori[sz]ed|insufficient (credits|funds|balance)|out of credits?|credit limit|Model API 404\b|model.*(not found|does not exist|no endpoints)/i.test(m)) {
    return { kind: "ai", text: /Add your API key/i.test(m) ? "The AI isn't connected. Open Settings > AI and connect it." : plainAiError(m) };
  }
  if (/fetch failed|ECONNREFUSED/i.test(m)) return { kind: "ai", text: "The app couldn't reach the AI service. Check your internet connection; the app tries again in a few minutes." };
  if (/Your resume has a problem|There's no resume yet/i.test(m)) return { kind: "resume", text: m.split("\n")[0].slice(0, 300) };
  if (/application browser is already open|No browser could be started|Chromium download failed/i.test(m)) {
    return { kind: "browser", text: /already open/i.test(m) ? "The browser the app applies with is already open in another window. Close that window (or restart Job Autopilot); the app tries again in a few minutes."
      : "The app couldn't start a browser to apply with. Install Google Chrome or Microsoft Edge; the app tries again in a few minutes." };
  }
  return null;
}
// Why an application stopped, in words a person can act on (never a browser's or a program's own error text).
export function plainRunError(message) {
  const m = String(message || "");
  if (/application timed out/i.test(m)) return "This application took too long, so the app stopped it. Press Try again, or Finish it with me.";
  if (/Target (page|closed)|browser has been closed|context.{0,20}closed|page.{0,20}closed/i.test(m)) return "The browser window was closed while the app was filling this in. Press Try again.";
  if (/net::ERR_|Timeout \d+ms exceeded|page\.goto|waiting for (selector|locator|navigation)/i.test(m)) return "The job site didn't load, or took too long to answer. Press Try again later, or Finish it with me.";
  const ai = plainAiError(m);
  if (ai !== m) return ai;
  // Anything else: its first line only, without a program's call log.
  return m.split(/\n|Call log:/)[0].replace(/^(page|locator|frame|browserType|elementHandle)\.\w+: /, "").trim().slice(0, 300) || "Something went wrong. Press Try again.";
}

// What goes next: the ones the person picked first (one practice run sent for real, questions answered, a job added by
// its link), then practice runs sent for real all together, new jobs at companies they want to work for, and the rest:
// near ones before remote ones, newest first. Jobs held for a referral wait.
//   real: 1, the person chose to send this practice run; 2, it went with all the others.
const QUEUE_SQL = `SELECT * FROM jobs WHERE status = 'queued' AND attempts < ? AND (hold_until IS NULL OR hold_until <= datetime('now'))
  ORDER BY (real = 1) DESC, (reason LIKE 'you answered %') DESC, (details LIKE '%"addedByUser":true%' OR details LIKE '%"applyAnyway":true%') DESC, (real = 2) DESC,
  (details LIKE '%"board":"watchlist"%') DESC,
  (work_mode = 'remote') ASC, posted_at DESC LIMIT 500`;
const parse = (s) => { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };
const theirs = (j) => { if (j.real === 1 || /^you answered /.test(j.reason || "")) return true; const d = parse(j.details); return !!(d.addedByUser || d.applyAnyway); };
// How well the posting's requirements are covered by the resume (checked without the AI), 0 to 1.
const fit = (j) => { const c = parse(j.details).check; return c && c.checked ? c.met / c.checked : 0.5; };

// Many applications to one employer close together read as spam to its recruiters and its application system: never
// two to the same company within SPACING_DAYS (the later one waits its turn), and at most the person's monthly limit.
export const SPACING_DAYS = 3;
// Applications sent in the last 30 days, by employer (a practice run sends nothing, so it doesn't count).
function sentByCompany() {
  const out = new Map();
  for (const r of db.prepare(`SELECT company, applied_at FROM jobs WHERE (status IN ('applied', 'submitting') OR (status = 'failed' AND reason LIKE '%may have gone through%'))
    AND applied_at > datetime('now', '-30 days')`).all()) {
    const k = companyKey(r.company), at = Date.parse(r.applied_at) || 0;
    const x = out.get(k) || { n: 0, last: 0 };
    out.set(k, { n: x.n + 1, last: Math.max(x.last, at) });
  }
  return out;
}

// The next job. At an employer with several in the queue, the best match first. One applied to in the last few days
// waits; one that already has as many applications this month as the person allows gets no more (those are skipped,
// with the reason). What the person picked themselves goes as soon as its turn comes. look: just see what's next.
function choose(look) {
  const limit = Number(getPrefs().perCompanyMonth) || 0;
  const rows = db.prepare(QUEUE_SQL).all(CONFIG.maxAttempts);
  const sent = sentByCompany(), done = new Set();
  let waiting = 0;
  for (const first of rows) {
    if (theirs(first)) return { job: first, waiting };
    const key = companyKey(first.company);
    if (done.has(key)) continue;
    done.add(key);
    const same = rows.filter((r) => !theirs(r) && companyKey(r.company) === key);
    const s = sent.get(key) || { n: 0, last: 0 };
    if (limit && s.n >= limit) {
      if (!look) {
        for (const r of same) setJob(r.slug, { status: "skipped", reason: `already ${limit === 1 ? "an application" : limit + " applications"} to ${first.company} in the last 30 days, your limit for one company` });
        log(first.slug, `left out ${same.length} job${same.length === 1 ? "" : "s"} at ${first.company}: your limit of ${limit} a month for one company`);
      }
      continue;
    }
    if (Date.now() - s.last < SPACING_DAYS * 86400000) { waiting += same.length; continue; }
    return { job: same.reduce((best, r) => (fit(r) > fit(best) + 1e-9 ? r : best), first), waiting };
  }
  return { job: null, waiting };
}
export function pickNext() {
  const c = choose(false);
  pickNext.waiting = c.waiting;
  return c.job;
}
const nextJob = pickNext;
export const peekNext = () => choose(true).job;

// Which of these jobs freehire says have closed (freehire's own postings only; up to 50 slugs a call). -> Set of slugs
export async function closedOnes(jobs, ask = call) {
  const mine = jobs.filter(isFreehireJob).map((j) => j.slug);
  const out = new Set();
  for (let i = 0; i < mine.length; i += 50) {
    try {
      const r = await ask("check_jobs_open", { slugs: mine.slice(i, i + 50).map((x) => encodeURIComponent(String(x))) });
      for (const j of r.jobs || []) if (j.status === "closed") out.add(decodeURIComponent(j.slug));
    } catch { /* unknown: treated as open, and checked again just before it's sent */ }
  }
  return out;
}

// Practice applications filled in since the person last opened one, before the app waits for them to look.
export const PRACTICE_WAITING = 3;
// Practice mode has an end: on a new install one practice application, then nothing more until the person checks it;
// after that, at most PRACTICE_WAITING more until they open one again. -> why the app waits, or "".
export function practiceHold() {
  if (!CONFIG.dryRun) return "";
  if (!CONFIG.reviewedDryRun && db.prepare("SELECT 1 FROM jobs WHERE status = 'filled' LIMIT 1").get()) return "waiting for you to check the first practice application";
  const fresh = practiceSince(CONFIG.practiceLookedAt).length;
  return fresh >= PRACTICE_WAITING ? `waiting for you to look at the ${fresh} new practice applications` : "";
}
// Today's applications toward the daily limit: the ones sent, and in practice mode the practice ones too, so practicing
// goes at the pace sending would.
export const doneToday = () => appliedToday() + (CONFIG.dryRun ? practicedToday() : 0);

// Practice mode sends nothing, except the jobs the person asked to send for real.
export const practiceFor = (job) => !!CONFIG.dryRun && !job.real;

// Applied, mid-submit, or possibly sent (an interrupted submit, here or on another computer).
const APPLIED_SQL = "SELECT slug, company, title, url, apply_url, applied_at, status FROM jobs WHERE status IN ('applied', 'submitting') OR (status = 'failed' AND reason LIKE '%may have gone through%')";
function appliedSameRole(job) {
  const rows = db.prepare(APPLIED_SQL).all().map((r) => ({ ...r, status: r.status === "failed" ? "submitting" : r.status }));
  return sameRoleAs(job, rows) || sameUrlAs(job, rows);
}

// Applications made outside the app (by hand) show up only as the employer's confirmation email.
async function inboxConfirms(job) {
  const m = mailbox();
  if (!m) return null;
  return findConfirmation(m, job.company, job.title, 60, job.apply_url || job.url);
}

// Only freehire's own postings are asked about: no other board's job is ever named to freehire.me.
export function isFreehireJob(job) {
  try { return (JSON.parse(job.details || "{}") || {}).board === "freehire"; } catch { return false; }
}
export async function stillOpen(job) {
  if (!isFreehireJob(job)) return true;
  try {
    const r = await call("check_jobs_open", { slugs: [encodeURIComponent(String(job.slug))] });
    const j = (r.jobs || [])[0];
    // freehire only knows its own postings: "not_found" (every HiringCafe job, for one) says nothing about whether it's open.
    return !j || j.status !== "closed";
  } catch { return true; }
}

// Replies from employers: at most once an hour, the mailbox is read (never changed) for emails from the employers
// the person applied to in the last 120 days. Each is matched to its application and sorted without AI (mail.js);
// "thanks for applying" emails aren't kept. force: now, whatever the time. -> how many new replies, or null.
export const REPLY_EVERY_MINUTES = 60;
export async function checkReplies({ force = false, read = mailSince } = {}) {
  const m = mailbox();
  if (!m) return null;
  const last = Date.parse(getSettings().repliesCheckedAt || "") || 0;
  if (!force && Date.now() - last < REPLY_EVERY_MINUTES * 60000) return null;
  const jobs = db.prepare(`${APPLIED_SQL.replace(" FROM jobs WHERE ", " FROM jobs WHERE applied_at > datetime('now', '-120 days') AND (")})`).all();
  saveSettings({ repliesCheckedAt: new Date().toISOString() });
  if (!jobs.length) return 0;
  const first = Math.min(...jobs.map((j) => Date.parse(j.applied_at) || Date.now()));
  const since = new Date(Math.max(first - 86400000, last ? last - 2 * 86400000 : 0, Date.now() - 120 * 86400000));
  const mails = (await read(m, since, (x) => maybeEmployer(x.from, jobs))) || [];
  let added = 0;
  for (const mail of mails) {
    const j = replyJob(mail, jobs);
    if (!j) continue;
    const kind = classifyReply(mail.subject, mail.text);
    if (kind === "received") continue;
    const r = db.prepare("INSERT OR IGNORE INTO replies (id, slug, at, sender, subject, kind, snippet) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(String(mail.id).slice(0, 500), j.slug, mail.date, String(mail.from).slice(0, 300), String(mail.subject).slice(0, 300), kind, replySnippet(mail.text));
    if (r.changes) { added++; log(j.slug, `reply from ${j.company}: ${kind} ("${String(mail.subject).slice(0, 120)}")`); }
  }
  return added;
}

// run(signal): when the time is up, the signal is aborted (applyTo stops at its next step) and the wait ends.
export async function withTimeout(run, ms) {
  const ctrl = new AbortController();
  let t;
  const late = new Promise((_, rej) => { t = setTimeout(() => { ctrl.abort(); rej(new Error("application timed out")); }, ms); });
  return Promise.race([run(ctrl.signal), late]).finally(() => clearTimeout(t));
}

async function applyOne(job) {
  try { return await applyOneInner(job); } finally { state.job = null; state.progress = null; }
}

// Government job sites need the person's own account, and GovernmentJobs.com forbids automated access:
// a job there is never opened by the app, even if it was queued by hand (hosts read by ats.hostOf, so a
// trailing dot or capitals don't hide one).
// Nothing is opened over plain http (an http:// link is tried as https:// in applyTo), and nothing that isn't a
// web address at all.
async function applyOneInner(job) {
  if (!httpsOk(toHttps(job.apply_url || job.url))) {
    setJob(job.slug, { status: "manual", reason: "Apply yourself: the application link isn't a web address the app can open over https (an encrypted connection)" });
    log(job.slug, "not a web address: left for you to apply to");
    return false;
  }
  if (isGovUrl(job.apply_url || job.url)) {
    setJob(job.slug, { status: "manual", reason: `Apply yourself on ${hostOf(job.apply_url || job.url).replace(/^www\./, "")}: it needs your own account there, so the app doesn't open it` });
    log(job.slug, "government job site: left for you to apply to");
    return false;
  }
  state.now = "applying"; state.job = { slug: job.slug, title: job.title, company: job.company, practice: practiceFor(job) };
  setJob(job.slug, { status: "working", attempts: job.attempts + 1 });
  const twin = appliedSameRole(job);
  if (twin) {
    setJob(job.slug, { status: "skipped", reason: `already applied to this role at ${twin.company} (${twin.title}, ${String(twin.applied_at || "").slice(0, 10)})` });
    log(job.slug, "skipped: already applied to the same role through another posting");
    return false;
  }
  const mail = await inboxConfirms(job);
  if (mail) {
    setJob(job.slug, { status: "skipped", reason: `already applied: confirmation email in your inbox (${mail})` });
    log(job.slug, "skipped: the inbox already has this employer's confirmation for this role");
    return false;
  }
  if (!(await stillOpen(job))) {
    setJob(job.slug, { status: "skipped", reason: "posting closed before the app got to it" });
    log(job.slug, "closed before we got to it");
    return false;
  }
  const dryRun = practiceFor(job);
  log(job.slug, `applying: ${job.title} at ${job.company}${dryRun ? " (practice application)" : CONFIG.dryRun ? " (for real: you asked to send this one)" : ""}`);
  const track = applyProgress(job);
  // pressedAt: when Submit was really pressed (the step after it began). From then on the job counts as
  // possibly sent, toward the daily cap and for never applying twice, whatever the page shows next.
  let signal = null, pressedAt = null;
  const progress = (key) => {
    if (signal && signal.aborted) return; // a run that timed out reports nothing more
    track(key);
    if (key === "submit" && !dryRun) setJob(job.slug, { status: "submitting", applied_at: new Date().toISOString() });
    if (key === "confirm" && !dryRun && !pressedAt) { pressedAt = new Date().toISOString(); setJob(job.slug, { status: "submitting", applied_at: pressedAt }); }
  };
  try {
    // A model on the user's own computer can take many minutes per step.
    const limit = (isLocal(getSettings().ai) ? 60 : 12) * 60000;
    const r = await withTimeout((s) => { signal = s; return applyTo(job, { progress, status: (t) => { if (!s.aborted) state.now = t; } }, { dryRun, mailbox: mailbox(), signal: s }); }, limit);
    // A job added by its link gets its real title and employer once the AI has read the page.
    const p = (r.details && r.details.plan) || {};
    const known = (x) => x && !/\b(not stated|unknown|n\/a)\b/i.test(x);
    if (JSON.parse(job.details || "{}").addedByUser && known(p.employer) && known(p.jobTitle)) setJob(job.slug, { company: p.employer, title: p.jobTitle });
    // Submit was pressed but no confirmation came: it may have gone through, so it's never sent again on its own.
    const maybe = !!pressedAt && r.status !== "applied";
    const reason = maybe && !/may have gone through/.test(r.reason || "") ? `${String(r.reason || "").replace(/\.?$/, "")}. Submit was pressed, so it may have gone through. Check your email before using Try again.` : r.reason;
    setJob(job.slug, {
      status: maybe ? "failed" : r.status, reason, details: r.details || null,
      resume_file: r.resume_file || null, screenshot: r.screenshot || null,
      applied_at: r.status === "applied" ? new Date().toISOString() : pressedAt,
      ...(r.status === "filled" ? { filled_at: new Date().toISOString() } : {}),
    });
    log(job.slug, `${maybe ? "failed" : r.status}: ${reason}`, r.status === "failed" || maybe ? "warn" : "info");
    return r.status === "applied" || r.status === "filled" || maybe;
  } catch (e) {
    await abortCurrent();
    if ((getJob(job.slug) || {}).status === "submitting") {
      setJob(job.slug, { status: "failed", reason: "something went wrong right after Submit was pressed, so it may have gone through. Check your email before using Try again." });
      log(job.slug, "error after Submit, not retried: " + e.message, "error");
      return false;
    }
    const retry = TRANSIENT.test(e.message) && job.attempts + 1 < CONFIG.maxAttempts;
    // Not about this job: it stays up next with no try used, and nothing more is tried for a few minutes.
    const t = trouble(e.message);
    if (t) {
      setJob(job.slug, { status: "queued", attempts: job.attempts });
      if (!state.trouble || state.trouble.text !== t.text) log(null, `waiting: ${t.text} (${String(e.message).split("\n")[0].slice(0, 200)})`, "warn");
      state.trouble = { ...t, at: state.trouble && state.trouble.text === t.text ? state.trouble.at : Date.now() };
      return "wait";
    }
    setJob(job.slug, { status: retry ? "queued" : "failed", reason: "error: " + plainRunError(e.message).slice(0, 400) });
    log(job.slug, `error${retry ? " (will retry)" : ""}: ${e.message}`, "error");
    return false;
  }
}

// ---------- "Finish with me" ----------
// The person finishes one application themselves, in a window in front of them, once the app has filled in what it
// can. It starts as soon as the worker is free (a search under way stops early for it), paused or not and whatever
// today's count: the person is the one who presses Submit.
const fin = { want: null, stop: false, sent: false };
export const FINISH = { every: 2000, minutes: 30 };
// How long nothing is tried after trouble that isn't about one job (no internet, the AI, the browser).
const troubleWait = () => Number(process.env.JA_TROUBLE_WAIT_MS) || 5 * 60000;
// What can be finished this way: an application that stopped (not one that may have gone through), a practice run,
// and one left to the person that the app may open (never a government job site, nothing without https).
export function finishable(j) {
  if (!j) return false;
  const link = j.apply_url || j.url;
  if (!httpsOk(toHttps(link)) || isGovUrl(link)) return false;
  if (j.status === "failed") return !/may have gone through/.test(j.reason || "");
  return j.status === "filled" || j.status === "manual";
}
export function requestFinish(slug) {
  const j = getJob(slug);
  if (!finishable(j)) return "That application can't be finished this way.";
  if (state.finish && state.finish.slug !== slug) return `You're finishing ${state.finish.company} first. Stop that one, or finish it, then try again.`;
  if (state.finish) return null;
  Object.assign(fin, { want: slug, stop: false, sent: false });
  state.finish = { slug, title: j.title, company: j.company, phase: "waiting", at: Date.now() };
  kick();
  return null;
}
// "stop": the person stops (before it starts: it doesn't); "sent": they say they sent it themselves.
export function finishControl(what) {
  if (!state.finish) return false;
  if (what === "stop" && fin.want) { fin.want = null; state.finish = null; return true; }
  if (what === "sent" && state.finish.phase !== "yours") return false;
  if (what === "stop") fin.stop = true;
  if (what === "sent") fin.sent = true;
  kick();
  return true;
}

// apply: applyTo, or a stand-in in tests.
export async function runFinish(apply = applyTo) {
  const slug = fin.want;
  fin.want = null;
  const job = getJob(slug);
  if (!finishable(job)) { state.finish = null; return; }
  const before = { status: job.status, reason: job.reason };
  state.now = "finishing an application with you";
  state.job = { slug, title: job.title, company: job.company };
  state.finish = { ...state.finish, phase: "filling", at: Date.now() };
  setJob(slug, { status: "working" });
  log(slug, `finish with me: filling in ${job.title} at ${job.company}, then it's your turn`);
  const finish = {
    ...FINISH,
    stopped: () => fin.stop, sent: () => fin.sent,
    // From the person's first turn, Submit may be pressed: after a crash it counts as possibly sent, never sent again.
    turn: (why) => {
      state.finish = { ...state.finish, phase: "yours", why, since: Date.now() };
      state.now = "your turn";
      if ((getJob(slug) || {}).status !== "submitting") setJob(slug, { status: "submitting" });
      log(slug, `your turn: ${why}`);
    },
  };
  const track = applyProgress(job);
  let outcome = "error", error = "";
  try {
    const limit = (isLocal(getSettings().ai) ? 90 : 60) * 60000;
    const r = await withTimeout((s) => apply({ ...job, apply_url: job.apply_url || job.url }, { progress: (k) => { if (!s.aborted) track(k); }, status: (t) => { if (!s.aborted) state.now = t; } },
      { dryRun: false, finish, mailbox: mailbox(), signal: s }), limit);
    outcome = r.outcome || r.status;
    const keep = { details: r.details || null, resume_file: r.resume_file || null, screenshot: r.screenshot || null };
    if (r.status === "applied") {
      setJob(slug, { ...keep, status: "applied", reason: r.reason, applied_at: new Date().toISOString(), reviewed: 1 });
      log(slug, `applied: ${r.reason}`);
    } else if (r.status === "finish-stopped") {
      const maybe = !!r.maybeSent;
      setJob(slug, { ...keep, status: maybe ? "failed" : before.status,
        reason: maybe ? "a button that sends it (Submit, or Next on a form with several pages) was pressed while you finished it, and no confirmation came: it may have gone through. Check your email before using Try again." : before.reason });
      log(slug, `finish with me ${r.outcome === "timeout" ? "ran out of time" : "stopped"}${maybe ? ": Submit was pressed, so it may have gone through" : ""}`, maybe ? "warn" : "info");
      // What they typed into the questions the app couldn't answer: kept for this job, for its next try.
      const typed = (r.details && r.details.finishTyped) || [];
      if (typed.length) saveYourAnswers(getJob(slug), typed.map((x) => ({ ...x, remember: false })));
    } else {
      setJob(slug, { ...keep, status: r.status, reason: r.reason });
      log(slug, `${r.status}: ${r.reason}`);
    }
  } catch (e) {
    await abortCurrent();
    const maybe = (getJob(slug) || {}).status === "submitting";
    setJob(slug, maybe ? { status: "failed", reason: `finishing it stopped (${plainAiError(e.message).slice(0, 160)}) after your turn began: it may have gone through. Check your email before using Try again.` }
      : { status: before.status, reason: before.reason });
    log(slug, `finish with me stopped: ${e.message}`, "warn");
    error = plainAiError(e.message).slice(0, 200);
  } finally {
    const now = getJob(slug) || {};
    state.finishDone = { slug, title: job.title, company: job.company, status: now.status, outcome, at: Date.now(),
      maybe: now.status === "failed" && /may have gone through/.test(now.reason || ""), ...(error ? { error } : {}) };
    state.finish = null; state.job = null; state.progress = null;
    Object.assign(fin, { stop: false, sent: false });
    // Out of the way again, if that's where the person keeps the window.
    if (windowModeOf(getSettings()) === "minimized") await showBrowser(false).catch(() => {});
  }
}

let running = false, stopping = false, held = false;
// An update waiting to install: finish the application in progress, start no new one.
export const hold = (on) => { held = !!on; kick(); };
export const stop = () => { stopping = true; kick(); };
export const isRunning = () => running;

// Once the mailbox is connected, jobs that stopped at an emailed code get another go. Once, when it's connected: tried
// again at every start, a code that never arrives (it went to Spam) would have each one filled in and sent again and
// again, a new code emailed every time.
export function retryCodeJobs() {
  if (!mailbox()) return 0;
  const n = db.prepare("UPDATE jobs SET status = 'queued', attempts = 0 WHERE status = 'failed' AND (reason LIKE 'security code:%' OR reason LIKE 'verify email:%')").run().changes;
  if (n) { log(null, `mailbox connected: ${n} job${n === 1 ? "" : "s"} that needed an emailed code ${n === 1 ? "is" : "are"} up next again`); kick(); }
  return n;
}

export async function run() {
  if (running) return;
  running = true; stopping = false;
  loadTimings();
  db.prepare("UPDATE jobs SET status = 'queued' WHERE status = 'working'").run();
  // Stopped between pressing Submit and the employer's answer: it may have gone through.
  // Never press it again on our own; the inbox decides, or the user does.
  for (const j of db.prepare("SELECT * FROM jobs WHERE status = 'submitting'").all()) {
    const mail = await inboxConfirms(j);
    if (mail) { setJob(j.slug, { status: "applied", applied_at: new Date().toISOString(), reason: `submitted; confirmed by email after a restart (${mail})` }); log(j.slug, "restart: the confirmation email shows it went through"); }
    else { setJob(j.slug, { status: "failed", reason: "interrupted right after pressing Submit: it may have gone through. Check your email before using Try again." }); log(j.slug, "restart: interrupted mid-submit, not retried", "warn"); }
  }
  log(null, `autopilot started (${CONFIG.dryRun ? "practice mode" : "sending for real"}, up to ${CONFIG.dailyCap} a day)`);
  while (!stopping) {
    try {
      // Replies are read while paused too: the person still wants to hear back.
      try { await checkReplies(); } catch (e) { log(null, "reading replies failed: " + e.message, "warn"); }
      if (fin.want && !held) { await runFinish(); continue; }
      // The browser stays open between applications, and closes whenever there is a long wait.
      if (CONFIG.paused) { state.now = "paused"; state.progress = null; state.trouble = null; await closeBrowser(); await sleep(30000); continue; }
      const due = !state.lastSearch || Date.now() - state.lastSearch > CONFIG.searchEveryMinutes * 60000;
      if (due) {
        state.now = "searching";
        state.progress = { kind: "search", startedAt: Date.now(), phase: "search", i: 0, n: 0 };
        // Someone waiting to finish an application: the search stops early, and runs again once they're done.
        const ctx = { browser: searchBrowser, yieldTo: () => !!fin.want && !held };
        try { await discover((u) => Object.assign(state.progress, u), ctx); } catch (e) { log(null, "discovery failed: " + e.message, "error"); }
        state.progress = null;
        if (ctx.stoppedEarly) continue;
        state.lastSearch = Date.now();
        state.nextSearch = state.lastSearch + CONFIG.searchEveryMinutes * 60000;
      }
      if (CONFIG.paused) continue;
      const hold = practiceHold();
      if (hold) {
        state.now = hold;
        await closeBrowser();
        await sleep(30000);
        continue;
      }
      if (doneToday() >= CONFIG.dailyCap) {
        state.now = `daily cap reached (${CONFIG.dailyCap})`;
        state.resumesAt = nextDayStart();
        await closeBrowser();
        await sleep(5 * 60000);
        continue;
      }
      state.resumesAt = null;
      const gap = CONFIG.minutesBetweenApplies * 60000 * (state.gapFactor || 1);
      const wait = state.lastApply + gap - Date.now();
      if (wait > 0) {
        state.now = "waiting between applications";
        state.progress = { kind: "wait", from: state.lastApply, until: state.lastApply + gap };
        await sleep(Math.min(wait, 60000));
        state.progress = null;
        continue;
      }
      if (held) { state.now = "updating: no new applications until the update is installed"; await sleep(5000); continue; }
      const job = nextJob();
      if (!job) {
        state.trouble = null;
        await closeBrowser();
        state.now = pickNext.waiting ? "the next jobs are at companies you applied to in the last few days: they wait" : "queue empty, waiting for the next search";
        await sleep(Math.min(5 * 60000, Math.max(30000, state.nextSearch - Date.now())));
        continue;
      }
      const used = await applyOne(job);
      if (used === "wait") { state.now = "waiting: " + state.trouble.text; await closeBrowser(); await sleep(troubleWait()); continue; }
      state.trouble = null;
      // The next gap is the person's setting plus up to half again, so applications don't go out like clockwork.
      if (used === true) { state.lastApply = Date.now(); state.gapFactor = 1 + Math.random() * 0.5; }
    } catch (e) {
      // The log is in the database: when that's what broke (a full disk), the loop still goes on.
      try { log(null, "loop error: " + e.message, "error"); } catch { /* said below */ }
      const t = trouble(e.message);
      if (t) { state.trouble = { ...t, at: Date.now() }; state.now = "waiting: " + t.text; }
      await sleep(60000);
    }
  }
  await closeBrowser();
  running = false;
  state.now = "stopped";
}
