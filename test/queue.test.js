// What the worker applies to next: the ones the person asked for first (a practice run sent for real), then
// companies they chose, local before remote, newest first; a job waits while they ask a referral; at one company
// the best match goes first, and a company that has had as many applications this month as they allow gets no more.
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { openDb, getDb, getJob, sqlTime } = await import("../core/db.js");
openDb();
const W = await import("../core/worker.js");

const day = 86400000;
function add(slug, f = {}) {
  getDb().prepare(`INSERT INTO jobs (slug, key, title, company, location, work_mode, url, apply_url, status, reason, posted_at, details, real, hold_until, applied_at, attempts)
    VALUES (?, ?, ?, ?, 'Austin, TX', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(slug, slug, f.title || "Cashier", f.company || "Globex", f.work_mode || "", `https://jobs.example/${slug}`,
    `https://jobs.example/${slug}/apply`, f.status || "queued", f.reason || null, f.posted_at || new Date(Date.now() - (f.age || 0) * day).toISOString(),
    JSON.stringify(f.details || {}), f.real || 0, f.hold_until || null, f.applied_at || null, f.attempts || 0);
}
const reset = (prefs = {}) => {
  getDb().prepare("DELETE FROM jobs").run();
  store.saveSettings({ dryRun: false, maxAttempts: 3 });
  store.savePrefs({ perCompanyMonth: 0, ...prefs });
};

test("the order: sent for real, answered, added by link, companies they chose, then local before remote and newest first", () => {
  reset();
  add("remote-new", { company: "A Co", work_mode: "remote", age: 0 });
  add("local-old", { company: "B Co", age: 5 });
  add("local-new", { company: "C Co", age: 1 });
  add("watched", { company: "D Co", work_mode: "remote", age: 9, details: { board: "watchlist" } });
  add("by-link", { company: "E Co", age: 20, details: { addedByUser: true } });
  add("answered", { company: "F Co", age: 30, reason: "you answered 2 questions; trying again with your answers" });
  add("for-real", { company: "G Co", age: 40, real: 1 });
  const order = [];
  for (let i = 0; i < 7; i++) { const j = W.pickNext(); order.push(j.slug); getDb().prepare("UPDATE jobs SET status = 'applied' WHERE slug = ?").run(j.slug); }
  assert.deepStrictEqual(order, ["for-real", "answered", "by-link", "watched", "local-new", "local-old", "remote-new"]);
  assert.strictEqual(W.pickNext(), null);
});

test("a job held for a referral waits until its time, and peekNext agrees with pickNext", () => {
  reset();
  add("held", { company: "A Co", age: 0, hold_until: sqlTime(Date.now() + 2 * day) });
  add("free", { company: "B Co", age: 3 });
  assert.strictEqual(W.pickNext().slug, "free");
  assert.strictEqual(W.peekNext().slug, "free");
  getDb().prepare("UPDATE jobs SET hold_until = ? WHERE slug = 'held'").run(sqlTime(Date.now() - 60000));
  assert.strictEqual(W.pickNext().slug, "held", "its wait is over");
});

test("at one company the best match goes first", () => {
  reset({ perCompanyMonth: 2 });
  add("weak-new", { company: "Globex", age: 0, details: { check: { met: 1, checked: 4 } } });
  add("strong-old", { company: "Globex, Inc.", age: 6, details: { check: { met: 4, checked: 4 } } });
  add("other", { company: "Initech", age: 9 });
  assert.strictEqual(W.pickNext().slug, "strong-old");
});

test("a company with as many applications this month as they allow gets no more, and the reason says so", () => {
  reset({ perCompanyMonth: 1 });
  add("sent-before", { company: "Globex", status: "applied", applied_at: new Date(Date.now() - 3 * day).toISOString() });
  add("globex-2", { company: "Globex LLC", age: 0 });
  add("initech", { company: "Initech", age: 2 });
  assert.strictEqual(W.pickNext().slug, "initech");
  const g = getJob("globex-2");
  assert.strictEqual(g.status, "skipped");
  assert.match(g.reason, /already an application to Globex LLC in the last 30 days, your limit for one company/);
  // Older than 30 days doesn't count; no limit means no limit.
  reset({ perCompanyMonth: 1 });
  add("long-ago", { company: "Globex", status: "applied", applied_at: new Date(Date.now() - 40 * day).toISOString() });
  add("globex-3", { company: "Globex", age: 0 });
  assert.strictEqual(W.pickNext().slug, "globex-3");
  reset({ perCompanyMonth: 0 });
  for (const k of [1, 2, 3]) add(`sent-${k}`, { company: "Globex", status: "applied", applied_at: new Date(Date.now() - (5 + k) * day).toISOString() });
  add("globex-4", { company: "Globex", age: 0 });
  assert.strictEqual(W.pickNext().slug, "globex-4", "no limit");
});

test("never two applications to one company within a few days: the later one waits its turn, and the rest go meanwhile", () => {
  reset({ perCompanyMonth: 3 });
  add("sent-yesterday", { company: "Globex", status: "applied", applied_at: new Date(Date.now() - 1 * day).toISOString() });
  add("globex-new", { company: "Globex Inc", age: 0 });
  add("initech", { company: "Initech", age: 5 });
  assert.strictEqual(W.peekNext().slug, "initech");
  assert.strictEqual(W.pickNext().slug, "initech");
  getDb().prepare("UPDATE jobs SET status = 'applied', applied_at = ? WHERE slug = 'initech'").run(new Date().toISOString());
  assert.strictEqual(W.pickNext(), null, "only Globex is left, and it waits");
  assert.strictEqual(W.pickNext.waiting, 1);
  assert.strictEqual(getJob("globex-new").status, "queued", "waiting, not skipped");
  getDb().prepare("UPDATE jobs SET applied_at = ? WHERE slug = 'sent-yesterday'").run(new Date(Date.now() - (W.SPACING_DAYS + 0.1) * day).toISOString());
  assert.strictEqual(W.pickNext().slug, "globex-new", "a few days later");
});

test("practice runs sent all together go first, but a few days apart at one company and within the monthly limit", () => {
  reset({ perCompanyMonth: 2 });
  add("pr-g1", { company: "Globex", real: 2, age: 3 });
  add("pr-g2", { company: "Globex", real: 2, age: 2 });
  add("pr-g3", { company: "Globex", real: 2, age: 1 });
  add("pr-i1", { company: "Initech", real: 2, age: 9 });
  add("plain", { company: "Hooli", age: 0 });
  const sent = [];
  const send = (slug, daysAgo) => { sent.push(slug); getDb().prepare("UPDATE jobs SET status = 'applied', applied_at = ? WHERE slug = ?").run(new Date(Date.now() - daysAgo * day).toISOString(), slug); };
  send(W.pickNext().slug, 0);
  send(W.pickNext().slug, 0);
  assert.deepStrictEqual(sent, ["pr-g3", "pr-i1"], "one per company, before the ordinary queue");
  assert.strictEqual(W.pickNext().slug, "plain", "the second at Globex waits a few days");
  getDb().prepare("UPDATE jobs SET applied_at = ? WHERE slug = 'pr-g3'").run(new Date(Date.now() - 5 * day).toISOString());
  send(W.pickNext().slug, 0);
  assert.strictEqual(sent[2], "pr-g2");
  assert.strictEqual(W.pickNext().slug, "plain");
  assert.strictEqual(getJob("pr-g1").status, "skipped", "two at Globex this month: the limit");
  assert.match(getJob("pr-g1").reason, /your limit for one company/);
});

test("what the person asked for isn't held back by the company limit", () => {
  reset({ perCompanyMonth: 1 });
  add("sent-before", { company: "Globex", status: "applied", applied_at: new Date().toISOString() });
  add("theirs", { company: "Globex", real: 1 });
  assert.strictEqual(W.pickNext().slug, "theirs");
});

test("practice mode sends nothing, except a practice run the person chose to send", () => {
  store.saveSettings({ dryRun: true });
  assert.strictEqual(W.practiceFor({ real: 0 }), true);
  assert.strictEqual(W.practiceFor({ real: 1 }), false);
  store.saveSettings({ dryRun: false });
  assert.strictEqual(W.practiceFor({ real: 0 }), false);
});

test("practice mode has an end: the first practice application waits to be checked, then a few more until the person looks again", () => {
  reset();
  const fill = (slug, at) => { add(slug, { status: "filled" }); getDb().prepare("UPDATE jobs SET filled_at = ? WHERE slug = ?").run(at, slug); };
  store.saveSettings({ dryRun: true, reviewedDryRun: false, practiceLookedAt: null });
  assert.strictEqual(W.practiceHold(), "", "nothing filled in yet");
  fill("first", new Date().toISOString());
  assert.match(W.practiceHold(), /check the first practice application/);
  const t0 = Date.now();
  store.saveSettings({ reviewedDryRun: true, practiceLookedAt: new Date(t0).toISOString() });
  assert.strictEqual(W.practiceHold(), "");
  fill("before-update", null);
  fill("p2", new Date(t0 + 1000).toISOString());
  fill("p3", new Date(t0 + 2000).toISOString());
  assert.strictEqual(W.practiceHold(), "", "two new ones (one from before the update has no fill time and doesn't count)");
  fill("p4", new Date(t0 + 3000).toISOString());
  assert.match(W.practiceHold(), /look at the 3 new practice applications/);
  store.saveSettings({ practiceLookedAt: new Date(t0 + 4000).toISOString() });
  assert.strictEqual(W.practiceHold(), "", "they looked: it carries on");
  store.saveSettings({ dryRun: false });
  assert.strictEqual(W.practiceHold(), "", "sending for real: never held");
});

test("practice applications count toward the daily limit in practice mode; sending for real, only what's sent does", () => {
  reset();
  add("sent", { status: "applied", applied_at: new Date().toISOString() });
  add("practiced", { status: "filled" });
  add("practiced-before", { status: "filled" });
  getDb().prepare("UPDATE jobs SET filled_at = ? WHERE slug = 'practiced'").run(new Date().toISOString());
  getDb().prepare("UPDATE jobs SET filled_at = ? WHERE slug = 'practiced-before'").run(new Date(Date.now() - 3 * day).toISOString());
  store.saveSettings({ dryRun: true });
  assert.strictEqual(W.doneToday(), 2);
  store.saveSettings({ dryRun: false });
  assert.strictEqual(W.doneToday(), 1);
});

test("closed postings: only freehire's own are asked about, 50 at a time, and an error counts as open", async () => {
  const jobs = [...Array(60)].map((_, i) => ({ slug: `fh-${i}`, details: JSON.stringify({ board: "freehire" }) }));
  jobs.push({ slug: "hc-1", details: JSON.stringify({ board: "hiringcafe" }) });
  const calls = [];
  const closed = await W.closedOnes(jobs, async (name, args) => { calls.push([name, args.slugs.length]); return { jobs: args.slugs.map((s) => ({ slug: s, status: s === "fh-3" || s === "fh-55" ? "closed" : "open" })) }; });
  assert.deepStrictEqual(calls, [["check_jobs_open", 50], ["check_jobs_open", 10]]);
  assert.deepStrictEqual([...closed].sort(), ["fh-3", "fh-55"]);
  assert.deepStrictEqual([...await W.closedOnes(jobs, async () => { throw new Error("down"); })], []);
});

test("Finish with me: what can be finished, one at a time, and Stop before it starts cancels it", () => {
  reset();
  add("stopped", { status: "failed", reason: "could not fill every required field: needs you: Phone" });
  add("maybe", { status: "failed", reason: "submitted but no confirmation appeared. Submit was pressed, so it may have gone through." });
  add("practice", { status: "filled", reason: "practice run: filled and checked, not sent" });
  add("signin", { status: "manual", reason: "Apply yourself: careers.example asks you to sign in or create an account first" });
  add("queued", {});
  assert.ok(W.finishable(getJob("stopped")));
  assert.ok(!W.finishable(getJob("maybe")), "never one that may have gone through");
  assert.ok(W.finishable(getJob("practice")));
  assert.ok(W.finishable(getJob("signin")));
  assert.ok(!W.finishable(getJob("queued")));
  assert.ok(!W.finishable({ status: "manual", apply_url: "https://www.governmentjobs.com/careers/x/jobs/1" }), "never a government job site");
  assert.ok(!W.finishable({ status: "failed", reason: "x", apply_url: "ftp://example.com/form" }), "nothing that isn't https");
  assert.strictEqual(W.requestFinish("stopped"), null);
  assert.strictEqual(W.state.finish.phase, "waiting");
  assert.match(W.requestFinish("practice"), /finishing Globex first/);
  assert.strictEqual(W.finishControl("sent"), false, "'I sent it' only counts on their turn");
  assert.ok(W.finishControl("stop"));
  assert.strictEqual(W.state.finish, null, "cancelled before it started");
  assert.match(W.requestFinish("maybe"), /can't be finished/);
});

test("Finish with me in the worker: the person's turn counts as possibly sent; sent, it's applied; stopped, it's back as it was with their answers", async () => {
  reset();
  store.saveSettings({ dryRun: true, windowMode: "headless" });
  add("f-sent", { status: "failed", reason: "could not fill every required field: needs you: Shirt size" });
  assert.strictEqual(W.requestFinish("f-sent"), null);
  let during;
  await W.runFinish(async (job, hooks, opts) => {
    assert.strictEqual(opts.dryRun, false, "the person sends it, practice mode or not");
    assert.strictEqual(getJob("f-sent").status, "working");
    opts.finish.turn("fill in \"Shirt size\", then press Submit.");
    during = { phase: W.state.finish.phase, why: W.state.finish.why, status: getJob("f-sent").status };
    return { status: "applied", reason: "you finished it, and the employer's page confirmed it", details: { finishTyped: [{ label: "Shirt size *", value: "Medium" }] } };
  });
  assert.deepStrictEqual(during, { phase: "yours", why: "fill in \"Shirt size\", then press Submit.", status: "submitting" });
  const sent = getJob("f-sent");
  assert.deepStrictEqual([sent.status, sent.reason, !!sent.applied_at], ["applied", "you finished it, and the employer's page confirmed it", true]);
  assert.strictEqual(W.state.finish, null);
  assert.deepStrictEqual([W.state.finishDone.slug, W.state.finishDone.status], ["f-sent", "applied"]);

  add("f-stop", { status: "filled", reason: "practice run: filled and checked, not sent" });
  W.requestFinish("f-stop");
  await W.runFinish(async (job, hooks, opts) => { opts.finish.turn("check it"); return { status: "finish-stopped", outcome: "stopped", maybeSent: false, details: { finishTyped: [{ label: "Why Globex?", value: "Close to home." }] } }; });
  const back = getJob("f-stop");
  assert.deepStrictEqual([back.status, back.reason], ["filled", "practice run: filled and checked, not sent"], "back where it was");
  assert.ok(store.getAnswers().yourAnswers.some((x) => x.scope === "f-stop" && x.value === "Close to home."), "kept for its next try");

  add("f-maybe", { status: "failed", reason: "a CAPTCHA challenge blocked the submit" });
  W.requestFinish("f-maybe");
  await W.runFinish(async (job, hooks, opts) => { opts.finish.turn("solve the CAPTCHA, then press Submit."); return { status: "finish-stopped", outcome: "timeout", maybeSent: true, details: {} }; });
  assert.match(getJob("f-maybe").reason, /may have gone through/);
  assert.strictEqual(W.state.finishDone.maybe, true);
  assert.ok(!W.finishable(getJob("f-maybe")), "never again on its own");

  add("f-crash", { status: "failed", reason: "page 2 was not accepted" });
  W.requestFinish("f-crash");
  await W.runFinish(async () => { throw new Error("Target page, context or browser has been closed"); });
  assert.deepStrictEqual([getJob("f-crash").status, getJob("f-crash").reason], ["failed", "page 2 was not accepted"], "before their turn: as it was");
  assert.strictEqual(W.state.finishDone.outcome, "error");
});
