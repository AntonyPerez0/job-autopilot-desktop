// Truth rules, built from the user's own answers (the example person here).
import test from "node:test";
import assert from "node:assert";
import { truthGuard, parseRange, yearsOption, yearsType } from "../core/truth.js";
import { candidateFacts } from "../core/facts.js";
import { exampleAnswers, examplePrefs } from "./helpers.js";

const profile = { experience: [{ title: "Software Engineer", org: "Acme Health", dates: "Jun 2023 - Present" }], cannotClaim: [] };
const setup = (patch = {}) => {
  const a = { ...exampleAnswers(), ...patch };
  return { a, facts: candidateFacts(a, profile, examplePrefs()) };
};
// One model answer for one field; returns the corrected kit entry and the audit notes.
function check(label, value, options, patch, ctx) {
  const { a, facts } = setup(patch);
  const kit = [{ label, value, kind: "text", fieldIndex: 0 }];
  const notes = truthGuard(kit, [{ label, options }], facts, a, ctx);
  return { k: kit[0], notes };
}

test("sponsorship: corrected to No for someone who needs none", () => {
  const opts = ["Yes, I will require sponsorship", "No, I do not require sponsorship"];
  assert.strictEqual(check("Will you require visa sponsorship?", "Yes, I will require sponsorship", opts).k.value, opts[1]);
  assert.strictEqual(check("Will you require visa sponsorship?", "No", undefined).notes.length, 0);
});

test("sponsorship: corrected to Yes for someone who needs it", () => {
  const opts = ["Yes", "No"];
  const r = check("Will you now or in the future require sponsorship?", "No", opts, { needsSponsorship: "yes" });
  assert.strictEqual(r.k.value, "Yes");
  assert.strictEqual(r.k.kind, "text");
});

test("work authorization follows the user's answer both ways", () => {
  assert.strictEqual(check("Are you legally authorized to work in the US?", "No", ["Yes", "No"]).k.value, "Yes");
  assert.strictEqual(check("Are you legally authorized to work in the US?", "Yes", ["Yes", "No"], { workAuthorized: "no" }).k.value, "No");
});

test("years: parse ranges", () => {
  assert.deepStrictEqual(parseRange("0-1 years"), { lo: 0, hi: 1 });
  assert.deepStrictEqual(parseRange("5+ years"), { lo: 5, hi: Infinity });
  assert.deepStrictEqual(parseRange("None"), { lo: 0, hi: 0 });
  assert.ok(parseRange("Less than 1 year").hi < 1);
  assert.deepStrictEqual(parseRange("3"), { lo: 3, hi: 3 });
  assert.strictEqual(yearsOption(["0-1", "1-2", "3-5", "5+"], 3), "3-5");
  assert.strictEqual(yearsOption(["Less than 1 year", "1-3 years", "3-5 years", "More than 5 years"], 3), "3-5 years");
});

test("years: question matched to the user's type", () => {
  const { facts } = setup();
  assert.strictEqual(yearsType("How many years of professional software engineering experience do you have?", facts), "Software engineering");
  assert.strictEqual(yearsType("Years of experience with Python", facts), "Python");
  assert.strictEqual(yearsType("How many years of experience do you have?", facts), "total");
  assert.strictEqual(yearsType("How many years of Kubernetes experience do you have?", facts), null);
});

test("years: an inflated answer is corrected to the bucket holding the user's number", () => {
  const r = check("How many years of software engineering experience do you have?", "5+", ["0-1", "1-2", "3-5", "5+"]);
  assert.strictEqual(r.k.value, "3-5");
  assert.ok(/3 years/.test(r.notes[0]));
  assert.strictEqual(check("Years of experience with TypeScript", "4", undefined).k.value, "2");
  assert.strictEqual(check("Years of experience with TypeScript", "2", undefined).notes.length, 0);
});

test("years: yes/no threshold questions", () => {
  assert.strictEqual(check("Do you have 5+ years of Python experience?", "Yes", ["Yes", "No"]).k.value, "No");
  assert.strictEqual(check("Do you have 2+ years of Python experience?", "No", ["Yes", "No"]).k.value, "Yes");
});

test("years: a type the user never gave becomes a question for them", () => {
  const r = check("How many years of Kubernetes experience do you have?", "2", undefined);
  assert.strictEqual(r.k.kind, "decide");
  assert.strictEqual(r.k.value, "");
});

test("how you heard: never a referral", () => {
  assert.strictEqual(check("How did you hear about us?", "Employee referral", ["LinkedIn", "Employee referral", "Job board", "Other"]).k.value, "Job board");
  assert.strictEqual(check("How did you hear about this job?", "LinkedIn", undefined).k.value, "Job board");
});

test("start date and notice period come from the user's answers", () => {
  assert.strictEqual(check("When can you start?", "Immediately", ["Immediately", "2 weeks", "1 month"]).k.value, "2 weeks");
  assert.strictEqual(check("What is your notice period?", "1 month", undefined).k.value, "2 weeks");
  assert.strictEqual(check("When can you start?", "Two weeks after accepting an offer", undefined).notes.length, 0);
});

test("relocation follows the user's choice and the job's distance", () => {
  assert.strictEqual(check("Are you willing to relocate?", "Yes", ["Yes", "No"], { relocation: "no" }).k.value, "No");
  assert.strictEqual(check("Are you willing to relocate?", "No", ["Yes", "No"], { relocation: "anywhere" }).k.value, "Yes");
  assert.strictEqual(check("Are you open to relocating to Austin?", "No", ["Yes", "No"], { relocation: "radius" }, { jobLocal: true }).k.value, "Yes");
  assert.strictEqual(check("Are you open to relocating to Boston?", "Yes", ["Yes", "No"], { relocation: "radius" }, { jobLocal: false }).k.value, "No");
});

test("demographics default to decline", () => {
  const opts = ["Male", "Female", "Non-binary", "I don't wish to answer"];
  assert.strictEqual(check("Gender", "Male", opts).k.value, "I don't wish to answer");
  assert.strictEqual(check("Are you a protected veteran?", "I am not a protected veteran",
    ["I am a protected veteran", "I am not a protected veteran", "I don't wish to answer"]).k.value, "I don't wish to answer");
  const own = check("Gender", "I don't wish to answer", opts, { demographics: { ...exampleAnswers().demographics, gender: "Female" } });
  assert.strictEqual(own.k.value, "Female");
});

test("graduation date from the user's education", () => {
  assert.strictEqual(check("Expected graduation year", "2026", ["2021", "2022", "2023"]).k.value, "2022");
  assert.strictEqual(check("What is your graduation date?", "December 2021", undefined).k.value, "May 2022");
});

test("decide answers and standard answers are never touched", () => {
  const { a, facts } = setup();
  const kit = [
    { label: "Will you require sponsorship?", value: "", kind: "decide", fieldIndex: 0 },
    { label: "Requires employer sponsorship now or in the future", value: "No", kind: "text" },
  ];
  assert.deepStrictEqual(truthGuard(kit, [], facts, a), []);
  assert.strictEqual(kit[0].kind, "decide");
});

test("no truthful option means a question for the user", () => {
  const r = check("Will you require sponsorship?", "Yes", ["Yes", "Maybe"]);
  assert.strictEqual(r.k.kind, "decide");
});

test("'authorized to work (with or without sponsorship)' is an authorization question", () => {
  // Found in a live dry run: the sponsorship rule used to flip this to "No".
  const r = check("Are you authorized to work in the United States (with or without sponsorship)?*", "No", ["Yes", "No"]);
  assert.strictEqual(r.k.value, "Yes");
  assert.match(r.notes[0], /work authorization/);
  assert.strictEqual(check("Are you authorized to work in the United States (with or without sponsorship)?*", "Yes", ["Yes", "No"]).notes.length, 0);
});

test("a question mixing authorization and sponsorship is left to the model", () => {
  const r = check("Are you legally authorized to work in the US, and will you now or in the future require sponsorship?", "Yes, and I do not require sponsorship", undefined);
  assert.strictEqual(r.notes.length, 0);
});

test("legal agreements and legal history are never answered by the AI", () => {
  for (const label of ["Do you currently have any non-compete or non-solicit agreements?*", "Do you agree to the arbitration agreement?*",
    "If extended an offer, are you willing to submit to a background check?*", "Have you ever been convicted of a felony?*",
    "I agree to waive my right to a jury trial"]) {
    const r = check(label, "Yes", ["Yes", "No"]);
    assert.strictEqual(r.k.kind, "decide", label);
    assert.strictEqual(r.k.value, "");
  }
});

test("background check consent follows the user's own setting", () => {
  const label = "If extended an offer, are you willing to submit to a background check?*";
  assert.strictEqual(check(label, "No", ["Yes", "No"], { screenings: "yes" }).k.value, "Yes");
  assert.strictEqual(check(label, "Yes", ["Yes", "No"], { screenings: "yes" }).notes.length, 0);
  assert.strictEqual(check("I consent to a background check and waive all claims", "Yes", ["Yes", "No"], { screenings: "yes" }).k.kind, "decide");
});

test("criminal-history questions: the user's own answer, never the AI's", () => {
  const label = "Have you ever been convicted of a felony?*";
  assert.strictEqual(check(label, "No", ["Yes", "No"]).k.kind, "decide", "no answer given: always asks");
  assert.strictEqual(check(label, "Yes", ["Yes", "No"], { convictions: "none" }).k.value, "No");
  assert.strictEqual(check(label, "No", ["Yes", "No"], { convictions: "none" }).notes.length, 0);
  assert.strictEqual(check("I authorize a criminal background check and waive all claims", "Yes", ["Yes", "No"], { convictions: "none", screenings: "yes" }).k.kind, "decide");
});
