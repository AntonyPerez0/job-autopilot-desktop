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
  for (const s of ["p1", "p2"]) assert.deepStrictEqual([getJob(s).status, getJob(s).real, getJob(s).attempts], ["queued", 1, 0]);
  assert.strictEqual(store.getSettings().reviewedDryRun, true);
  assert.strictEqual(W.practiceFor(getJob("p1")), false, "sent for real even in practice mode");
  const no = await handle("/api/job/p1", { action: "send" });
  assert.match(no.error, /Only a practice run/);
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
  assert.match(j.people[0].note, /^Hi Kim, .*Cashier role at Initech, Inc\./);
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
