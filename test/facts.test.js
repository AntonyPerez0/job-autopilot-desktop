// The user's facts become the profile's answers and the prompt rules; only approved pieces reach a resume.
import test from "node:test";
import assert from "node:assert";
import { approvedExample, exampleAnswers, examplePrefs } from "./helpers.js";
import { Profile, Tailor, approvedOnly, loadProfile } from "../core/engine.js";
import { autopilotRules, homeLocation, standardAnswers } from "../core/facts.js";
import { mergeProfiles, unapproved } from "../core/importer.js";

test("standard answers from the common questions", () => {
  const a = exampleAnswers();
  const s = Object.fromEntries(standardAnswers(a).map((x) => [x.label, x.value]));
  assert.strictEqual(s["Full name"], "Jordan Lee");
  assert.strictEqual(s["ZIP code"], "78701");
  assert.strictEqual(s["Location"], "Austin, TX");
  assert.strictEqual(s["Requires employer sponsorship now or in the future"], "No");
  assert.strictEqual(s["Graduation date"], "May 2022");
  assert.strictEqual(s["Years of Software engineering experience"], "3");
  assert.strictEqual(s["Gender"], "Decline to self-identify");
  assert.strictEqual(homeLocation({ city: "Toronto", state: "Ontario", country: "Canada" }), "Toronto, Ontario, Canada");
});

test("prompt rules carry the user's facts, not anyone else's", () => {
  const r = autopilotRules(exampleAnswers(), approvedExample(Profile), examplePrefs());
  assert.match(r, /finished school in May 2022/);
  assert.match(r, /Software engineering: 3/);
  assert.match(r, /Austin, TX/);
  assert.match(r, /Internships and co-ops are hard fails/);
  assert.match(r, /more than 5 years/);
});

test("nothing unapproved reaches the resume", () => {
  const p = approvedExample(Profile);
  p.experience[0].bullets[0].approved = false;
  p.summaries[0].approved = false;
  const a = approvedOnly(p);
  assert.ok(!a.experience[0].bullets.some((b) => b.id === p.experience[0].bullets[0].id));
  assert.ok(!a.summaries.some((s) => s.id === p.summaries[0].id));
  assert.strictEqual(a.bases[0].summary, a.summaries[0].id, "a base falls back to an approved summary");
  const prof = loadProfile(p, exampleAnswers());
  const { spec } = Tailor.checkPlan(prof, { base: prof.bases[0].id, summary: p.summaries[0].id });
  assert.notStrictEqual(spec.summary, p.summaries[0].id);
  assert.throws(() => loadProfile(unapproved(Profile.EXAMPLE), exampleAnswers()), /problems/);
});

test("contact and answers come from the common questions", () => {
  const prof = loadProfile(approvedExample(Profile), { ...exampleAnswers(), firstName: "Sam", lastName: "Rivera", email: "sam@example.org" });
  assert.strictEqual(prof.name, "Sam Rivera");
  assert.strictEqual(prof.contact.email, "sam@example.org");
  assert.ok(prof.cannotClaim.includes("Rust"));
});

test("two resumes merge: same job joins bullets, layouts are kept, ids stay unique", () => {
  const a = JSON.parse(JSON.stringify(Profile.EXAMPLE));
  const b = JSON.parse(JSON.stringify(Profile.EXAMPLE));
  b.experience[0].bullets.push({ id: "scheduler", text: "Led the migration to a new booking calendar." });
  b.bases[0].description = "Second resume";
  const m = mergeProfiles(a, b);
  assert.strictEqual(m.experience.length, a.experience.length);
  const ids = m.experience[0].bullets.map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length);
  assert.ok(m.experience[0].bullets.some((x) => /migration/.test(x.text)));
  assert.strictEqual(m.bases.length, 2);
  assert.notStrictEqual(m.bases[1].id, m.bases[0].id);
  assert.deepStrictEqual(Array.from(Profile.validate(m)), []);
  const u = unapproved(m);
  assert.ok(u.summaries.every((s) => s.approved === false));
});

test("resume text from PDF and DOCX", async () => {
  const { resumeText } = await import("../core/importer.js");
  const { spec } = Tailor.checkPlan(Profile.EXAMPLE, { base: Profile.EXAMPLE.bases[0].id });
  const pdf = await Tailor.fit(Profile.EXAMPLE, spec, []);
  const t = await resumeText("r.pdf", Buffer.from(pdf.pdf));
  assert.match(t, /Jordan Lee/);
  assert.match(t, /appointment scheduling service/);
  const fs = await import("node:fs");
  const d = await resumeText("r.docx", fs.readFileSync(new URL("./fixtures/sample-resume.docx", import.meta.url)));
  assert.match(d, /Acme Health/);
  await assert.rejects(resumeText("r.doc", Buffer.from("x")), /only PDF and DOCX/);
});

test("degree abbreviations are spelled out so degree lists match", async () => {
  const { degreeText } = await import("../core/facts.js");
  assert.strictEqual(degreeText("B.S."), "Bachelor of Science (B.S.)");
  assert.strictEqual(degreeText("MBA"), "Master of Business Administration (MBA)");
  assert.strictEqual(degreeText("Bachelor of Arts"), "Bachelor of Arts");
});

test("a look-alike school is not the same entry", async () => {
  const { sameEntry } = await import("../core/apply.js");
  assert.ok(sameEntry("University of Texas - Austin", "University of Texas at Austin"));
  assert.ok(!sameEntry("Austin Peay State University", "University of Texas at Austin"));
  assert.ok(!sameEntry("Ohio University", "Ohio State University"));
  assert.ok(!sameEntry("City University of New York", "New York University"));
  assert.ok(sameEntry("Austin, Texas, United States", "Austin", true));
});

test("hourly-job answers", () => {
  const s = Object.fromEntries(standardAnswers({ ...exampleAnswers(), daysAvailable: ["Monday", "Saturday"], shifts: ["Evenings"], hoursWanted: "part", transportation: "yes", canLift: "40" }).map((x) => [x.label, x.value]));
  assert.strictEqual(s["Days available"], "Monday, Saturday");
  assert.strictEqual(s["Available to work weekends"], "Yes");
  assert.strictEqual(s["Shifts available"], "Evenings");
  assert.strictEqual(s["Desired hours"], "Part-time");
  assert.strictEqual(s["Do you have reliable transportation"], "Yes");
  assert.strictEqual(s["How much weight can you lift"], "40 pounds");
});

test("years of experience come from the resume's job dates when the person hasn't given them, never zero", async () => {
  const { yearsFromDates, candidateFacts } = await import("../core/facts.js");
  const exp = [{ dates: "Jun 2023 – Present" }, { dates: "Jan 2022 – May 2023" }, { dates: "Aug 2020 – Dec 2021" }];
  assert.strictEqual(yearsFromDates(exp, new Date("2026-10-26")), 6, "overlaps and gaps counted once, rounded down");
  assert.ok(candidateFacts({ totalYears: 0 }, { experience: exp }, null).totalYears >= 6);
  assert.strictEqual(candidateFacts({ totalYears: 2 }, { experience: exp }, null).totalYears, 2, "a number they gave wins");
  const { prefillAnswers } = await import("../core/api.js");
  const a = prefillAnswers({ name: "Jordan Lee", contact: {}, experience: [{ title: "Software Engineer", dates: "Jun 2023 – Present" }] }, { years: [] });
  assert.ok(a.totalYears >= 3);
  assert.strictEqual(a.years[0].type, "Software Engineer");
});

test("near misses on years: the rule is there only when the person chose it, and forms still get their real numbers", () => {
  const rules = (stretchYears) => autopilotRules(exampleAnswers(), approvedExample(Profile), { ...examplePrefs(), stretchYears });
  assert.match(rules(1), /at most 1 year short of is NOT a hard fail.*Their answers to "how many years" stay their real numbers/s);
  assert.match(rules(2), /at most 2 years short of/);
  assert.doesNotMatch(rules(0), /short of is NOT a hard fail/);
  assert.doesNotMatch(rules(7), /short of is NOT a hard fail/, "only 1 or 2");
});

test("Finish with me: the form moved on when its address changes or most of its questions do, seen twice in a row", async () => {
  const { movedOn } = await import("../core/apply.js");
  const page1 = ["First name *", "Last name *", "Shirt size *"];
  const same = movedOn("https://jobs.example/apply#top", page1);
  assert.strictEqual(same("https://jobs.example/apply#more", [...page1, "Shirt color"]), false, "one more question is the same page");
  assert.strictEqual(same("https://jobs.example/apply/", page1), false);
  const next = movedOn("https://jobs.example/apply", page1);
  assert.strictEqual(next({ url: () => "https://jobs.example/apply" }, ["Phone *", "Days available *"]), false, "once could be a page still loading");
  assert.strictEqual(next({ url: () => "https://jobs.example/apply" }, ["Phone *", "Days available *"]), true);
  const moved = movedOn("https://jobs.example/apply/1", page1);
  moved("https://jobs.example/apply/2", page1);
  assert.strictEqual(moved("https://jobs.example/apply/2", page1), true, "another address");
});

test("at least 40 to 70 seconds on a form before Submit: spam filters throw out forms sent faster", async () => {
  const { minOnForm } = await import("../core/apply.js");
  const was = process.env.JA_FAST_FORMS;
  delete process.env.JA_FAST_FORMS;
  const waits = [...Array(50)].map(() => minOnForm());
  assert.ok(waits.every((w) => w >= 40000 && w < 70000), String(waits));
  assert.ok(new Set(waits).size > 10, "not the same every time");
  process.env.JA_FAST_FORMS = "1";
  assert.strictEqual(minOnForm(), 0, "tests don't wait");
  if (was === undefined) delete process.env.JA_FAST_FORMS; else process.env.JA_FAST_FORMS = was;
});
