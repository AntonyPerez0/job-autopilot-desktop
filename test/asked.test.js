// Questions only the user can answer: what a stopped job waits on, saving the answers,
// and using them (over anything the AI decided) when the job runs again.
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const A = await import("../core/asked.js");
const { handle } = await import("../core/api.js");
const { getDb, getJob } = await import("../core/db.js");

const REASON = "could not fill every required field: needs you: How many years of professional software engineering experience do you have?* (no truthful answer for years of experience: no number for this kind of experience in your answers (add it under Years of experience)); required, no answer: Are you currently enrolled in full-time studies?; needs you: Please review and acknowledge Initech's Candidate Privacy Notice (this acknowledgement includes \"waive\"; read it and answer it yourself)";
const DETAILS = {
  report: { decide: [{ label: "How many years of professional software engineering experience do you have?*", note: "no truthful answer for years of experience" }], missing: [] },
  fields: [
    { type: "text", label: "How many years of professional software engineering experience do you have?*", required: true },
    { type: "select", label: "Are you currently enrolled in full-time studies?", required: true, options: ["Select...", "Yes", "No"] },
    { type: "textarea", label: "Please review and acknowledge Initech's Candidate Privacy Notice", required: true },
  ],
};

test("a stopped job lists the questions it waits on, with their choices", () => {
  const asks = A.asksFor({ status: "failed", reason: REASON }, DETAILS);
  assert.deepStrictEqual(asks.map((q) => q.label), ["How many years of professional software engineering experience do you have?*", "Are you currently enrolled in full-time studies?", "Please review and acknowledge Initech's Candidate Privacy Notice"]);
  assert.strictEqual(asks[0].note, "no truthful answer for years of experience");
  assert.deepStrictEqual(asks[1].options, ["Yes", "No"], "the placeholder option is left out");
  assert.match(asks[2].note, /read it and answer it yourself/);
  assert.strictEqual(asks[2].long, true);
  assert.deepStrictEqual(A.asksFor({ status: "failed", reason: "no submit button found" }, DETAILS), [], "only a job stopped on questions");
  assert.deepStrictEqual(A.asksFor({ status: "queued", reason: REASON }, DETAILS), []);
  // Page 2 of a form, and a job from before this version (no report, no fields): still answerable.
  const old = A.asksFor({ status: "failed", reason: "could not fill every required field (page 2): still empty: Desired start date" }, {});
  assert.deepStrictEqual(old.map((q) => [q.label, q.options.length]), [["Desired start date", 0]]);
});

test("your answers go into the form over what the AI or the checks decided", () => {
  const kit = [{ label: "How many years of professional software engineering experience do you have?*", value: "", kind: "decide", note: "no number" },
    { label: "First name", value: "Jordan", kind: "text" }];
  const fields = DETAILS.fields;
  const mine = [{ key: A.labelKey("How many years of professional software engineering experience do you have?"), label: "How many years…", value: "3", scope: "all" },
    { key: A.labelKey("Are you currently enrolled in full-time studies?"), label: "Are you currently enrolled in full-time studies?", value: "No", scope: "all" },
    { key: A.labelKey("Are you currently enrolled in full-time studies?"), label: "Are you currently enrolled in full-time studies?", value: "Yes", scope: "some-job" },
    { key: "a question on a button group", label: "A question on a button group", value: "Yes", scope: "all" }];
  const notes = A.applyYourAnswers(kit, fields, mine);
  assert.deepStrictEqual(kit[0], { label: kit[0].label, value: "3", kind: "text", note: "your answer" }, "the * and spacing don't matter");
  assert.strictEqual(kit.find((k) => /enrolled/.test(k.label)).value, "Yes", "an answer for this job wins over the general one");
  assert.ok(kit.some((k) => k.label === "A question on a button group" && k.value === "Yes"), "a question the scrape listed differently is still offered by label");
  assert.strictEqual(kit.find((k) => k.label === "First name").value, "Jordan");
  assert.strictEqual(notes.length, 2);
});

test("answering in the app saves the answers and puts the job first in the queue", async () => {
  const db = getDb();
  const ins = db.prepare("INSERT INTO jobs (slug, title, company, status, reason, details, attempts, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  ins.run("initech-swe", "Software Engineer", "Initech", "failed", REASON, JSON.stringify(DETAILS), 1, "2026-10-01");
  ins.run("globex-swe", "Software Engineer", "Globex", "queued", "", "{}", 0, "2026-10-20");
  const j = await handle("/api/job/initech-swe");
  assert.strictEqual(j.asks.length, 3);
  assert.ok(!j.details.fields, "the form's fields stay on this side");
  const st = await handle("/api/status");
  assert.deepStrictEqual([st.toAnswer.count, st.toAnswer.first.slug], [1, "initech-swe"]);
  assert.match((await handle("/api/job/initech-swe", { action: "answer", answers: [{ label: j.asks[0].label, value: " " }] })).error, /Type an answer/);
  const r = await handle("/api/job/initech-swe", { action: "answer", answers: [
    { label: j.asks[0].label, value: "3", remember: true }, { label: j.asks[1].label, value: "No", remember: true }, { label: j.asks[2].label, value: "I have read it", remember: false }] });
  assert.strictEqual(r.status, "queued");
  assert.strictEqual(getJob("initech-swe").attempts, 0);
  const saved = await handle("/api/your-answers");
  assert.deepStrictEqual(saved.map((x) => [x.value, x.scope]), [["3", "all"], ["No", "all"], ["I have read it", "initech-swe"]]);
  assert.strictEqual((await handle("/api/status")).next.slug, "initech-swe", "the answered job goes next, before newer postings");
  assert.strictEqual(A.yourAnswersFor({ slug: "globex-swe" }).length, 2, "another job gets only the answers meant for every application");
  await handle("/api/your-answers/remove", { key: saved[0].key, scope: "all" });
  assert.strictEqual((await handle("/api/your-answers")).length, 2);
  const again = await handle("/api/job/initech-swe", { action: "answer", answers: [{ label: j.asks[1].label, value: "Yes", remember: true }] });
  assert.strictEqual(again.status, "queued");
  assert.strictEqual((await handle("/api/your-answers")).filter((x) => x.key === A.labelKey(j.asks[1].label)).length, 1, "answering again replaces the old answer");
});
