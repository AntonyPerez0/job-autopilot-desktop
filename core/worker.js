// The loop: search on a schedule, apply to one queued job at a time, respect
// the daily cap and the pause switch, and never stop on an error.
import fs from "node:fs";
import { getDb, log, setJob, getJob, appliedToday, nextDayStart } from "./db.js";
import { discover } from "./discover.js";
import { sameRoleAs, sameUrlAs } from "./dedupe.js";
import { abortCurrent, applyTo, httpsOk, STEPS, toHttps } from "./apply.js";
import { hostOf, isGovUrl } from "./ats.js";
import { acquireBrowser, closeAppPage, closeBrowser, newAppPage } from "./browser.js";
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
import { findConfirmation } from "./mail.js";
import { dataDir, getSecret, getSettings } from "./store.js";

const CONFIG = new Proxy({}, { get: (_, k) => getSettings()[k] });
const db = new Proxy({}, { get: (_, k) => { const d = getDb(); return typeof d[k] === "function" ? d[k].bind(d) : d[k]; } });

// The mailbox from Settings, with its password from secure storage, or null.
export function mailbox() {
  const m = getSettings().mailbox;
  const pass = m && getSecret("mailPassword");
  return m && m.host && m.user && pass ? { ...m, pass } : null;
}

export const state = { now: "starting", job: null, lastSearch: null, nextSearch: null, lastApply: 0, wake: null, progress: null };

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

function nextJob() {
  return db.prepare(`SELECT * FROM jobs WHERE status = 'queued' AND attempts < ?
    ORDER BY (reason LIKE 'you answered %') DESC, (details LIKE '%"addedByUser":true%') DESC, (work_mode = 'remote') ASC, posted_at DESC LIMIT 1`).get(CONFIG.maxAttempts);
}

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
  state.now = "applying"; state.job = { slug: job.slug, title: job.title, company: job.company };
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
  const dryRun = !!CONFIG.dryRun;
  log(job.slug, `applying: ${job.title} at ${job.company}${dryRun ? " (dry run)" : ""}`);
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
    });
    log(job.slug, `${maybe ? "failed" : r.status}: ${reason}`, r.status === "failed" || maybe ? "warn" : "info");
    return r.status === "applied" || r.status === "filled" || maybe;
  } catch (e) {
    await abortCurrent();
    if ((getJob(job.slug) || {}).status === "submitting") {
      setJob(job.slug, { status: "failed", reason: "error right after pressing Submit (" + e.message.slice(0, 200) + "): it may have gone through. Check your email before using Try again." });
      log(job.slug, "error after Submit, not retried: " + e.message, "error");
      return false;
    }
    const retry = TRANSIENT.test(e.message) && job.attempts + 1 < CONFIG.maxAttempts;
    setJob(job.slug, { status: retry ? "queued" : "failed", reason: "error: " + plainAiError(e.message).slice(0, 400) });
    log(job.slug, `error${retry ? " (will retry)" : ""}: ${e.message}`, "error");
    return false;
  }
}

let running = false, stopping = false, held = false;
// An update waiting to install: finish the application in progress, start no new one.
export const hold = (on) => { held = !!on; kick(); };
export const stop = () => { stopping = true; kick(); };

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
  // Once the mailbox is set up, Greenhouse jobs that stopped at the emailed code get another go.
  if (mailbox()) {
    const n = db.prepare("UPDATE jobs SET status = 'queued', attempts = 0 WHERE status = 'failed' AND (reason LIKE 'security code:%' OR reason LIKE 'verify email:%')").run().changes;
    if (n) log(null, `mailbox configured: ${n} jobs that needed an emailed code are queued again`);
  }
  log(null, `autopilot started (${CONFIG.dryRun ? "dry run" : "live"}, cap ${CONFIG.dailyCap}/day)`);
  while (!stopping) {
    try {
      // The browser stays open between applications, and closes whenever there is a long wait.
      if (CONFIG.paused) { state.now = "paused"; state.progress = null; await closeBrowser(); await sleep(30000); continue; }
      const due = !state.lastSearch || Date.now() - state.lastSearch > CONFIG.searchEveryMinutes * 60000;
      if (due) {
        state.now = "searching";
        state.progress = { kind: "search", startedAt: Date.now(), phase: "search", i: 0, n: 0 };
        try { await discover((u) => Object.assign(state.progress, u), { browser: searchBrowser }); } catch (e) { log(null, "discovery failed: " + e.message, "error"); }
        state.progress = null;
        state.lastSearch = Date.now();
        state.nextSearch = state.lastSearch + CONFIG.searchEveryMinutes * 60000;
      }
      if (CONFIG.paused) continue;
      // Dry run on a new install: fill one application, then wait until the user has looked at it.
      if (CONFIG.dryRun && !CONFIG.reviewedDryRun && db.prepare("SELECT 1 FROM jobs WHERE status = 'filled' LIMIT 1").get()) {
        state.now = "waiting for you to review the first filled application";
        await closeBrowser();
        await sleep(30000);
        continue;
      }
      if (appliedToday() >= CONFIG.dailyCap) {
        state.now = `daily cap reached (${CONFIG.dailyCap})`;
        state.resumesAt = nextDayStart();
        await closeBrowser();
        await sleep(5 * 60000);
        continue;
      }
      state.resumesAt = null;
      const wait = state.lastApply + CONFIG.minutesBetweenApplies * 60000 - Date.now();
      if (wait > 0) {
        state.now = "waiting between applications";
        state.progress = { kind: "wait", from: state.lastApply, until: state.lastApply + CONFIG.minutesBetweenApplies * 60000 };
        await sleep(Math.min(wait, 60000));
        state.progress = null;
        continue;
      }
      if (held) { state.now = "updating: no new applications until the update is installed"; await sleep(5000); continue; }
      const job = nextJob();
      if (!job) { await closeBrowser(); state.now = "queue empty, waiting for the next search"; await sleep(Math.min(5 * 60000, Math.max(30000, state.nextSearch - Date.now()))); continue; }
      const used = await applyOne(job);
      if (used) state.lastApply = Date.now();
    } catch (e) {
      log(null, "loop error: " + e.message, "error");
      await sleep(60000);
    }
  }
  await closeBrowser();
  running = false;
  state.now = "stopped";
}
