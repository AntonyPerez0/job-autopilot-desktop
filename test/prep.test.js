// Interview prep notes: from the posting and the person's own approved lines only. A story keeps to its line; a number
// the line doesn't have is the AI's, so that part is left for the person to tell.
import test from "node:test";
import assert from "node:assert";
import { approvedExample, tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile } = await import("../core/engine.js");
const { prepFor } = await import("../core/prep.js");

const profile = approvedExample(Profile);
const lines = [];
for (const k of ["experience", "projects"]) for (const e of profile[k]) for (const b of e.bullets) lines.push({ id: `${e.id}.${b.id}`, text: b.text });
const job = { title: "Support Engineer", company: "Globex", details: JSON.stringify({ description: "Help customers with our API. Write Python scripts. On call one week a month." }) };

test("prep notes: questions from the posting, stories from their own lines, nothing made up", async () => {
  const [one, two] = lines;
  let asked;
  const chat = async (msgs) => {
    asked = msgs;
    return {
      about: ["Answer customers' API questions", "Write Python scripts"],
      questions: [{ q: "Tell us about a time you fixed a hard bug.", why: "The posting asks for debugging.", use: [one.id, "made-up.id"] }],
      stories: [
        { line: one.id, title: "Booking", situation: "40 clinics booked patients by phone.", task: "Build the booking service.", action: "Built it in Python and PostgreSQL.", result: "Bookings rose by 93% in 2 weeks.", fill: ["how many patients book each week"] },
        { line: "not-a-line", title: "Invented", situation: "x", task: "x", action: "x", result: "x" },
        { line: two.id, title: "Second", situation: "A team needed a tool.", task: "", action: "Built it.", result: "" },
      ],
      ask: ["What does a good first month look like?"],
    };
  };
  const p = await prepFor(job, profile, chat);
  assert.ok(asked[1].content.includes(one.id) && asked[1].content.includes("Help customers with our API"), "the AI sees their lines and the posting");
  assert.deepStrictEqual(p.about, ["Answer customers' API questions", "Write Python scripts"]);
  assert.deepStrictEqual(p.questions[0].use, [one.text], "only their own lines, by their words");
  assert.strictEqual(p.stories.length, 2, "a story must stand on one of their lines");
  const s = p.stories[0];
  assert.strictEqual(s.line, one.text);
  assert.strictEqual(s.situation, "40 clinics booked patients by phone.", "their own number stays");
  assert.strictEqual(s.result, "", "a number their line doesn't have is left out");
  assert.ok(s.fill.some((x) => /result in your own words/.test(x)));
  assert.ok(s.fill.includes("how many patients book each week"));
  assert.deepStrictEqual(p.ask, ["What does a good first month look like?"]);
});

test("no approved lines: nothing to build stories from", async () => {
  await assert.rejects(prepFor(job, { experience: [], projects: [] }, async () => ({})), /no approved lines/);
});
