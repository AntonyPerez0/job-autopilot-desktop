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

test("the choices of a stopped question: read from the page, matched despite small wording differences; a file is not a question", () => {
  const reason = "could not fill every required field: still empty: Work authorization status; required, no answer: How did you hear about us; required, no answer: Resume";
  const details = { fields: [{ label: "Work authorization status *", type: "listbox" }, { label: "How did you hear about us?", type: "select", options: ["Select...", "LinkedIn", "Job board", "Referral"] }, { label: "Resume", type: "file" }],
    askOptions: { "work authorization status": ["U.S. citizen", "Permanent resident", "Visa holder"] } };
  const asks = A.asksFor({ status: "failed", reason }, details);
  assert.deepStrictEqual(asks[0].options, ["U.S. citizen", "Permanent resident", "Visa holder"], "read from the page when it stopped");
  assert.deepStrictEqual(asks[1].options, ["LinkedIn", "Job board", "Referral"], "the field's own list, matched despite the question mark");
  assert.strictEqual(asks[2].file, true, "a resume upload is not a question to type into");
  const noList = A.asksFor({ status: "failed", reason: "could not fill every required field: still empty: Preferred shift" }, { fields: [{ label: "Preferred shift", type: "combo" }] });
  assert.strictEqual(noList[0].choice, true, "a list whose choices couldn't be read says so");
  assert.deepStrictEqual(noList[0].options, []);
});

// From a diagnostics report: a ZIP code typed for one form ("ZIP *") was asked again by the next ("Zip Code:*").
test("an answer to a question every form asks (ZIP, street, county) goes into About you, for every form", () => {
  store.saveAnswers({ zip: "", street: "", county: "", city: "Fremont", yourAnswers: [
    { key: "zip", label: "ZIP *", value: "94538", scope: "all" }, { key: "address", label: "Address *", value: "4141 Main St Apt 3", scope: "all" },
    { key: "why us", label: "Why us?", value: "Because", scope: "one-job" }] });
  assert.deepStrictEqual(A.promoteYourAnswers(), { zip: "94538", street: "4141 Main St Apt 3" });
  assert.strictEqual(store.getAnswers().zip, "94538");
  assert.deepStrictEqual(A.promoteYourAnswers(), {}, "once");
  A.saveYourAnswers({ slug: "paylocity-1", company: "Initech" }, [{ label: "County", value: "Alameda", remember: false }, { label: "Address Line 1", value: "4141 Main St Apt 3, Fremont, CA 94538", remember: true }]);
  assert.deepStrictEqual([store.getAnswers().county, store.getAnswers().street], ["Alameda", "4141 Main St Apt 3"]);
  for (const [l, k] of [["Zip Code:*", "zip"], ["Postal code", "zip"], ["Address Line 1", "street"], ["Email address", null], ["Address Line 2(optional)", null], ["Are you a U.S. citizen?", "citizen"]]) assert.strictEqual(A.standardKey(l), k, l);
});

test("a kept answer that isn't one of a form's choices isn't forced on it", () => {
  const kit = [{ label: "How did you hear about us?(optional)", value: "Online Job Board", kind: "text", fieldIndex: 0 }];
  const fields = [{ label: "How did you hear about us?(optional)", type: "radio", options: ["Online Job Board", "Company Website", "Social Media", "Other"] }];
  const notes = A.applyYourAnswers(kit, fields, [{ key: A.labelKey("How did you hear about us?"), label: "How did you hear about us?", value: "linkedin", scope: "all" }]);
  assert.strictEqual(kit[0].value, "Online Job Board");
  assert.match(notes[0], /isn't one of the choices/);
  // The same question with its yes/no buttons read into the label is the same question.
  assert.strictEqual(A.labelKey("Are you enrolled?: Yes No"), A.labelKey("Are you enrolled?"));
});
