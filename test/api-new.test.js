// The window's routes for the newer features, end to end on a temporary database: practice runs sent for real, kinds
// of work left out and brought back, LinkedIn connections and referral waits, where an application stands and its
// follow-up, Finish with me requested and stopped, the answers typed while finishing, and pay a form stopped on.
import test from "node:test";
import assert from "node:assert";
import { exampleAnswers, tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { handle } = await import("../core/api.js");
const { openDb, getDb, getJob, sqlTime } = await import("../core/db.js");
const W = await import("../core/worker.js");
openDb();
store.saveAnswers({ ...exampleAnswers(), salary: "" });
store.saveSettings({ dryRun: true, reviewedDryRun: false, maxAttempts: 3 });

const day = 86400000;
function add(slug, f = {}) {
  getDb().prepare(`INSERT INTO jobs (slug, key, title, company, url, apply_url, status, reason, details, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(slug, slug, f.title || "Cashier", f.company || "Globex", `https://jobs.example/${slug}`, `https://jobs.example/${slug}/apply`, f.status || "queued", f.reason || null,
      JSON.stringify(f.details || {}), f.applied_at || null);
}

test("practice runs sent for real: each queued again as real, first in line, and the review is done", async () => {
  add("p1", { status: "filled", reason: "practice run: filled and checked, not sent" });
  add("p2", { status: "filled", reason: "practice run: filled and checked, not sent" });
  add("p3", { status: "filled" });
  const one = await handle("/api/job/p3", { action: "send" });
  assert.strictEqual(one.status, "queued");
  assert.strictEqual(one.real, 1);
  const all = await handle("/api/practice/send", { slugs: ["p1", "p2"] });
  assert.deepStrictEqual(all, { queued: 2, closed: 0 });
  for (const s of ["p1", "p2"]) assert.deepStrictEqual([getJob(s).status, getJob(s).real, getJob(s).attempts], ["queued", 2, 0], "sent with the others: the company rules apply");
  assert.strictEqual(store.getSettings().reviewedDryRun, true);
  assert.strictEqual(W.practiceFor(getJob("p1")), false, "sent for real even in practice mode");
  const no = await handle("/api/job/p1", { action: "send" });
  assert.match(no.error, /Only a practice application/);
});

test("not this kind of work: the kind is left out, the waiting ones of that kind are skipped, and Undo brings them all back", async () => {
  add("hc1", { details: { category: "healthcare" } });
  add("hc2", { status: "failed", reason: "could not fill every required field: needs you: License", details: { category: "healthcare" } });
  add("rt1", { details: { category: "retail" } });
  const r = await handle("/api/job/hc1", { action: "notkind" });
  assert.strictEqual(r.leftOut.name, "Healthcare");
  assert.deepStrictEqual(r.leftOut.jobs.map((j) => j.slug).sort(), ["hc1", "hc2"]);
  assert.strictEqual(getJob("hc2").status, "skipped");
  assert.strictEqual(getJob("rt1").status, "queued");
  assert.deepStrictEqual((await handle("/api/kinds")).map((k) => [k.code, k.by]), [["healthcare", "you"]]);
  await handle("/api/job/hc1", { action: "notkind-undo", code: "healthcare", jobs: r.leftOut.jobs });
  assert.strictEqual(getJob("hc2").status, "failed");
  assert.match(getJob("hc2").reason, /needs you: License/);
  assert.deepStrictEqual(await handle("/api/kinds"), []);
  assert.deepStrictEqual((await handle("/api/kinds", { hide: "retail" })).map((k) => k.code), ["retail"]);
  assert.deepStrictEqual(await handle("/api/kinds", { show: "retail" }), []);
  assert.deepStrictEqual(store.getPrefs().keepKinds, ["retail"], "brought back: never learned again");
  assert.ok((await handle("/api/job/rt1", { action: "notkind" })).leftOut);
  const plain = await handle("/api/job/p1", { action: "notkind" });
  assert.match(plain.error, /doesn't know what kind of work/);
});

test("LinkedIn connections: imported, queued jobs where they know someone wait, the job shows who with a note, and Apply now", async () => {
  getDb().prepare("DELETE FROM jobs").run();
  add("known", { company: "Initech, Inc." });
  add("stranger", { company: "Hooli" });
  const csv = "Notes:\n\nFirst Name,Last Name,URL,Email Address,Company,Position,Connected On\nKim,Park,https://www.linkedin.com/in/kim-example,,Initech,Engineer,01 Jan 2025\n";
  const imp = await handle("/api/connections/import", { csv });
  assert.deepStrictEqual(imp, { count: 1, companies: 1, held: 1 });
  assert.ok(getJob("known").hold_until > sqlTime());
  assert.strictEqual(getJob("stranger").hold_until, null);
  const j = await handle("/api/job/known");
  assert.deepStrictEqual(j.people.map((p) => p.first), ["Kim"]);
  assert.match(j.people[0].note, /^(Hi|Hello) Kim[,!] .*Cashier (role|opening) at Initech, Inc\./);
  assert.ok(j.held);
  const st = await handle("/api/status");
  assert.deepStrictEqual([st.referrals.count, st.referrals.first.slug], [1, "known"]);
  const now = await handle("/api/job/known", { action: "apply-now" });
  assert.strictEqual(now.held, null);
  assert.match((await handle("/api/connections/import", { csv: "a,b\n1,2" })).error, /isn't LinkedIn's/);
  assert.strictEqual((await handle("/api/connections/clear", {})).count, 0);
  assert.strictEqual((await handle("/api/connections")).count, 0);
});

test("where an application stands, and its follow-up", async () => {
  add("sent1", { status: "applied", applied_at: new Date(Date.now() - 15 * day).toISOString() });
  let j = await handle("/api/job/sent1");
  assert.strictEqual(j.standing, "waiting");
  assert.ok(j.stages.interviewing);
  assert.deepStrictEqual((await handle("/api/followups")).map((x) => x.slug), ["sent1"]);
  assert.strictEqual((await handle("/api/status")).followups, 1);
  j = await handle("/api/job/sent1", { action: "stage", stage: "interviewing" });
  assert.strictEqual(j.standing, "interviewing");
  assert.deepStrictEqual(await handle("/api/followups"), [], "interviewing: no follow-up");
  const st = await handle("/api/status");
  assert.deepStrictEqual([st.interviews.count, st.interviews.first.slug], [1, "sent1"], "time to get ready");
  await handle("/api/job/sent1", { action: "stage", stage: "auto" });
  await handle("/api/job/sent1", { action: "nofollow" });
  assert.deepStrictEqual(await handle("/api/followups"), []);
  assert.match((await handle("/api/job/sent1", { action: "stage", stage: "hired-twice" })).error, /Which stage/);
  assert.match((await handle("/api/job/stranger", { action: "stage", stage: "offer" })).error, /Only an application that was sent/);
});

test("Finish with me from the window: asked for, shown, stopped; and the answers typed while finishing, kept or not", async () => {
  add("fin1", { status: "failed", reason: "could not fill every required field: needs you: Shirt size" });
  assert.strictEqual((await handle("/api/job/fin1")).finishable, true);
  await handle("/api/job/fin1", { action: "finish" });
  assert.strictEqual((await handle("/api/status")).state.finish.slug, "fin1");
  assert.match((await handle("/api/job/fin1", { action: "finish-sent" })).error, /isn't your turn yet/);
  await handle("/api/job/fin1", { action: "finish-stop" });
  assert.strictEqual((await handle("/api/status")).state.finish, null, "cancelled before it started");
  assert.match((await handle("/api/job/fin1", { action: "finish-stop" })).error, /isn't being finished/);
  add("fin2", { status: "applied", applied_at: new Date().toISOString(), details: { finishTyped: [{ label: "Shirt size *", value: "Medium" }, { label: "Why Globex?", value: "I like it." }, { label: "Have you ever been convicted of a felony?", value: "No" }] } });
  const j = await handle("/api/job/fin2");
  assert.deepStrictEqual(j.typed.map((x) => x.label), ["Shirt size *", "Why Globex?"], "never a legal question");
  const k = await handle("/api/job/fin2", { action: "keep-typed", labels: ["Shirt size *"] });
  assert.deepStrictEqual(k.typed, []);
  const mine = store.getAnswers().yourAnswers.filter((x) => x.scope === "all").map((x) => [x.label, x.value]);
  assert.deepStrictEqual(mine, [["Shirt size *", "Medium"]]);
});

test("desired pay: asked for once a form stopped on it", async () => {
  assert.ok(!(await handle("/api/status")).missingAnswers.includes("your desired pay"));
  add("pay1", { status: "failed", reason: "could not fill every required field: needs you: Desired salary (numbers only) *" });
  assert.ok((await handle("/api/status")).missingAnswers.includes("your desired pay"));
  store.saveAnswers({ salary: "$40,000 a year" });
  assert.ok(!(await handle("/api/status")).missingAnswers.includes("your desired pay"));
});

test("why jobs weren't applied to: grouped, each with the setting behind it; Apply anyway puts one up next, and its must-haves don't skip it again", async () => {
  add("sk1", { status: "skipped", reason: "asks for 8+ years of experience (you have about 4; jobs asking for more than 5 are left out)" });
  add("sk2", { status: "skipped", reason: "asks for 6+ years of experience (you have about 4; jobs asking for more than 5 are left out)" });
  add("sk3", { status: "skipped", reason: "pays at most $12/hour, under your lowest pay" });
  add("sk4", { status: "skipped", reason: "something no group knows" });
  const r = await handle("/api/skips");
  const g = Object.fromEntries(r.groups.map((x) => [x.why, x]));
  assert.strictEqual(g["asked for more years of experience than you have"].count, 2);
  assert.deepStrictEqual(g["asked for more years of experience than you have"].fix, { label: "Change my years", section: "prefs", field: "yearsInField" });
  assert.deepStrictEqual([g["paid less than your lowest pay"].count, g["paid less than your lowest pay"].fix.field], [1, "minPay"]);
  assert.strictEqual(r.groups.at(-1).why, "for other reasons", "the ones no group knows come last");
  assert.strictEqual((await handle("/api/config")).years.have, 4, "the years their answers show, for Settings");
  const any = await handle("/api/job/sk1", { action: "apply-anyway" });
  assert.deepStrictEqual([any.status, any.reason, any.details.applyAnyway], ["queued", "you chose to apply anyway", true]);
  assert.match((await handle("/api/job/sk1", { action: "apply-anyway" })).error, /isn't one the app left out/);
  assert.strictEqual((await handle("/api/skips")).groups.find((x) => x.why === "asked for more years of experience than you have").count, 1);
});

test("more years allowed: the jobs left out for years that fit now are forgotten, so the next search checks them again", async () => {
  store.savePrefs({ yearsInField: 2, stretchYears: 1, maxYearsRequired: 3 });
  add("yr4", { status: "skipped", reason: "asks for 4+ years of experience (you have about 2; jobs asking for more than 3 are left out)" });
  add("yr9", { status: "skipped", reason: "asks for 9+ years of experience (you have about 2; jobs asking for more than 3 are left out)" });
  await handle("/api/prefs/save", { prefs: { yearsInField: 4 } });
  assert.strictEqual(getJob("yr4"), undefined, "asks for 4: fits up to 5 now");
  assert.strictEqual(getJob("yr9").status, "skipped", "asks for 9: still too many");
  await handle("/api/prefs/save", { prefs: { yearsInField: 1 } });
  assert.strictEqual(getJob("yr9").status, "skipped", "fewer years forget nothing");
});

test("the list of applications for unemployment claims: every one sent or maybe sent, by date, in a spreadsheet that can't run formulas", async () => {
  add("log1", { status: "applied", company: '=HYPERLINK("http://x.example")', title: "Stocker, nights", applied_at: "2026-10-02T12:00:00.000Z" });
  add("log2", { status: "failed", reason: "no confirmation appeared. Submit was pressed, so it may have gone through. Check your email before using Try again.", applied_at: "2026-10-01T12:00:00.000Z" });
  add("log3", { status: "failed", reason: "page 2 was not accepted" });
  add("log4", { status: "applied", reason: "applied by you on the employer's site", applied_at: "2026-10-03T12:00:00.000Z" });
  const r = await handle("/api/applications/log");
  const lines = r.csv.split("\r\n");
  assert.strictEqual(lines[0], "Date applied,Employer,Job title,Location,How,Link,Status");
  const row = (slug) => lines.find((l) => l.includes(`https://jobs.example/${slug},`));
  assert.strictEqual(row("log1"), `2026-10-02,"'=HYPERLINK(""http://x.example"")","Stocker, nights",,Online application,https://jobs.example/log1,Sent`);
  assert.match(row("log2"), /^2026-10-01,Globex,Cashier,,Online application,https:\/\/jobs\.example\/log2,May have gone through$/);
  assert.match(row("log4"), /You applied on the employer's site/);
  assert.strictEqual(row("log3"), undefined, "nothing that wasn't sent");
  const dates = lines.slice(1, -1).map((l) => l.slice(0, 10));
  assert.deepStrictEqual(dates, [...dates].sort(), "oldest first");
  assert.strictEqual(r.count, lines.length - 2);
});

test("the status: practice applications new since the person last looked, what stopped for another reason, and the last day; opening one is looking", async () => {
  getDb().prepare("DELETE FROM jobs").run();
  store.saveSettings({ dryRun: true, reviewedDryRun: false, practiceLookedAt: "2026-11-01T00:00:00.000Z" });
  const fill = (slug, at) => { add(slug, { status: "filled", reason: "practice run: filled and checked, not sent" }); getDb().prepare("UPDATE jobs SET filled_at = ? WHERE slug = ?").run(at, slug); };
  const now = Date.now();
  fill("before-update", null);
  fill("looked-at", "2026-10-30T00:00:00.000Z");
  fill("new1", new Date(now - 3000).toISOString()); fill("new2", new Date(now - 2000).toISOString()); fill("new3", new Date(now - 1000).toISOString());
  add("captcha", { status: "failed", reason: "a CAPTCHA challenge blocked the submit" });
  add("question", { status: "failed", reason: "could not fill every required field: needs you: Phone" });
  add("maybe", { status: "failed", reason: "no confirmation appeared. Submit was pressed, so it may have gone through. Check your email before using Try again." });
  add("sent", { status: "applied", applied_at: new Date(now - 1000).toISOString() });
  add("left-out", { status: "skipped", reason: "posting closed" });
  let s = await handle("/api/status");
  assert.deepStrictEqual([s.practice.count, s.practice.unchecked, s.practice.held, s.practice.first.slug], [5, 3, true, "new1"]);
  assert.deepStrictEqual([s.stopped.count, s.stopped.first.slug], [1, "captcha"], "a question has its own To do item");
  assert.deepStrictEqual([s.maybe.count, s.maybe.first.slug], [1, "maybe"], "and so has one that may have gone through");
  assert.deepStrictEqual({ ...s.day }, { sent: 1, practiced: 3, notApplied: 1 });
  assert.strictEqual(W.doneToday(), 4, "practice applications count toward the daily limit");
  assert.match(W.practiceHold(), /check the first practice application/);
  store.saveSettings({ reviewedDryRun: true });
  assert.match(W.practiceHold(), /look at the 3 new practice applications/);
  store.saveSettings({ reviewedDryRun: false });
  getDb().prepare("INSERT INTO events (slug, level, message) VALUES ('new2', 'info', 'applying: Cashier at Globex (practice run)')").run();
  const j = await handle("/api/job/new2");
  assert.deepStrictEqual(j.events.map((e) => e.message), ["applying: Cashier at Globex (practice run)"], "its history");
  s = await handle("/api/status");
  assert.deepStrictEqual([s.practice.unchecked, s.practice.held, s.settings.reviewedDryRun], [0, false, true], "opened: checked, so sending can start");
  assert.strictEqual(W.practiceHold(), "", "they looked: the app carries on");
  const at = store.getSettings().practiceLookedAt;
  await handle("/api/job/new3");
  assert.strictEqual(store.getSettings().practiceLookedAt, at, "nothing new: nothing written");
});

test("back to practice: what was lined up to be sent for real goes back to being practice, so nothing is sent", async () => {
  getDb().prepare("DELETE FROM jobs").run();
  store.saveSettings({ dryRun: false, reviewedDryRun: true });
  add("r1", { status: "filled" }); add("r2", { status: "filled" });
  await handle("/api/practice/send", {});
  assert.ok(getJob("r1").real > 0 && getJob("r1").status === "queued");
  await handle("/api/settings", { dryRun: true });
  for (const s of ["r1", "r2"]) assert.strictEqual(getJob(s).real, 0, "no longer marked to be sent");
  assert.strictEqual(W.practiceFor(getJob("r1")), true, "filled in as practice the next time");
  // One chosen afterwards, in practice mode, is still sent: that's what "Send only this one for real" is.
  getDb().prepare("UPDATE jobs SET status = 'filled' WHERE slug = 'r2'").run();
  await handle("/api/job/r2", { action: "send" });
  assert.strictEqual(W.practiceFor(getJob("r2")), false);
});

test("the daily limit and the tries per job are never none: Pause is the way to stop", async () => {
  const s = await handle("/api/settings", { dailyCap: 0, maxAttempts: 0 });
  assert.strictEqual(s.dailyCap, 1);
  assert.strictEqual(s.maxAttempts, 1);
});
