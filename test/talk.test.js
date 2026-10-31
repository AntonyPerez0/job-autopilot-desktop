// "Tell it in my own words": the chat that stands in for the creator's form. The AI's notes count only where
// they're the person's own words; the resume is then written from them like from the form.
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { tempDataDir } from "./helpers.js";

const dir = tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(dir);
const T = await import("../core/talk.js");
const { handle } = await import("../core/api.js");

let reply = () => ({}), down = false;
const seen = [];
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const m = JSON.parse(b);
    seen.push(m.messages);
    if (down) { res.writeHead(429, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: { message: "busy" } })); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(m.messages[0].content, m.messages[1] && m.messages[1].content)) } }] }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" } });
test.after(() => ai.close());

const you = (text, re) => ({ who: "you", text, ...(re ? { re } : {}) });

test("notes count only where they're the person's own words", () => {
  const turns = [you("i've been a cashier at Corner Market in Austin since march 2021. i run the register and stock the cooler, maybe 150 customers a day. i also trained the new people"),
    you("yeah 4 of them", "About how many new people did you train?"),
    you("I speak Spanish and English. Food handler card. Lincoln High, graduated 2019")];
  const { iv, left, unsure } = T.checkNotes({ target: "Store lead",
    jobs: [{ title: "Cashier", employer: "Corner Market", location: "Austin", start: "Mar 2021", current: true,
      daily: "run the register, stock the cooler; managed the store's inventory system", numbers: "maybe 150 customers a day; cut wait times 30%",
      proud: "trained 4 new people", tools: "cash register, Square POS" },
    { title: "Shift Supervisor", employer: "Big Box Inc", start: "June 2018", end: "2019", daily: "run the register" }],
    education: [{ school: "Lincoln High School", earned: "Diploma", year: "2019" }, { school: "Austin Community College", earned: "", year: "" }],
    certifications: "Food handler card, ServSafe Manager", languages: "Spanish, English", skills: "cash handling" }, turns);
  const [j] = iv.jobs;
  assert.deepStrictEqual([j.title, j.employer, j.location, j.start, j.current], ["Cashier", "Corner Market", "Austin", "Mar 2021", true]);
  assert.strictEqual(j.daily, "run the register; stock the cooler", "a system they never named, and being in charge, are left out");
  assert.strictEqual(j.numbers, "maybe 150 customers a day", "an invented result is left out");
  assert.strictEqual(j.proud, "trained 4 new people", "an answer counts with the question it answered");
  assert.strictEqual(j.tools, "", "a register they ran isn't a tool they named; Square they never said");
  assert.ok(left.includes("cut wait times 30%") && left.includes("Square POS"));
  const [j2] = iv.jobs.slice(1);
  assert.deepStrictEqual([j2.employer, j2.start, j2.end], ["", "", "2019"], "an employer and a year they never gave are dropped");
  assert.deepStrictEqual(unsure.map((u) => u.title), ["Shift Supervisor"], "a title they never used is asked about");
  assert.match(unsure[0].question, /Is "Shift Supervisor" the right job title/);
  assert.deepStrictEqual(iv.education, [{ school: "Lincoln High School", earned: "", year: "2019" }], "a school they never named is dropped");
  assert.strictEqual(iv.certifications, "Food handler card");
  assert.strictEqual(iv.languages, "Spanish, English");
  assert.strictEqual(iv.skills, "", "a skill they never named stays off");
  assert.strictEqual(iv.target, "", "a wish they never said isn't theirs");
  assert.match(T.notReady({ iv, unsure }), /Shift Supervisor/);
  assert.strictEqual(T.notReady({ iv, unsure: [] }), "");
  assert.match(T.notReady({ iv: { ...iv, jobs: [{ ...j, daily: "", proud: "", numbers: "" }] }, unsure: [] }), /what you did at Corner Market/);
  assert.match(T.notReady({ iv: { jobs: [], education: [] }, unsure: [] }), /at least one job/);
});

test("names written properly; a job without a title is asked about first", () => {
  assert.deepStrictEqual(["city of Sacramento sign shop", "iPhone repair tech", "the home depot"].map(T.nameCase), ["City of Sacramento Sign Shop", "iPhone Repair Tech", "The Home Depot"]);
  const { iv, unsure } = T.checkNotes({ jobs: [{ title: "", employer: "city sign shop", daily: "made street signs" }], education: [{ school: "hiram johnson high school", earned: "high school" }] },
    [you("i made street signs at the city sign shop. finished high school at hiram johnson")]);
  assert.strictEqual(iv.jobs[0].employer, "City Sign Shop");
  assert.deepStrictEqual(iv.education[0], { school: "Hiram Johnson High School", earned: "high school", year: "" });
  assert.strictEqual(unsure[0].question, "What was your job title at City Sign Shop?");
  assert.match(T.notReady({ iv, unsure }), /job title at City Sign Shop/);
});

test("the coach updates its notes instead of starting over", async () => {
  T.clearTalk();
  reply = () => ({ reply: "ok", question: "And then?", ideas: [], notes: { jobs: [{ title: "Cashier", employer: "Corner Market", daily: "run the register" }] } });
  await T.say("I'm a cashier at Corner Market, I run the register", "");
  await T.say("about 150 customers a day", "And then?");
  assert.match(seen[seen.length - 1][1].content, /YOUR NOTES SO FAR:\n\{"target":"","jobs":\[\{"title":"Cashier","employer":"Corner Market"/);
});

test("a month they didn't say: only the year is kept", () => {
  const { iv } = T.checkNotes({ jobs: [{ title: "Driver", start: "Jun 2020", end: "Aug 2022", daily: "drove the van" }] }, [you("I was a driver from 2020 to august 2022, drove the van")]);
  assert.deepStrictEqual([iv.jobs[0].start, iv.jobs[0].end], ["2020", "Aug 2022"]);
});

test("the conversation: a reply, the one question, other ideas; a title they never used comes first", async () => {
  T.clearTalk();
  reply = (sys) => (/friendly resume coach/.test(sys) ? {
    reply: "Got it: you stock shelves at Corner Market.", question: "About when did you start there?",
    ideas: ["Did you ever train anyone?", "Did you train anyone new?", "Tell me about your tools.", "Which machines did you use?"],
    notes: { jobs: [{ title: "Stock Associate", employer: "Corner Market", daily: "stock shelves" }] } } : {});
  const t = await T.say("I stock shelves at Corner Market", "");
  assert.strictEqual(t.turns.length, 2);
  const c = t.turns[1];
  assert.strictEqual(c.who, "coach");
  assert.match(c.question, /Is "Stock Associate" the right job title for your work at Corner Market/);
  assert.deepStrictEqual(c.ideas, ["About when did you start there?", "Did you ever train anyone?", "Which machines did you use?"], "the coach's question moves to the ideas; the same question twice and a non-question are dropped");
  assert.strictEqual(t.unsure.length, 1);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, "talk.json"), "utf8")).turns.length, 2, "kept on this computer");
  // Saying yes to the title makes it theirs.
  reply = (sys) => (/friendly resume coach/.test(sys) ? { reply: "Thanks.", question: "About when did you start there?", ideas: [],
    notes: { jobs: [{ title: "Stock Associate", employer: "Corner Market", daily: "stock shelves" }] } } : {});
  const t2 = await T.say("yes", c.question);
  assert.strictEqual(t2.turns[2].re, c.question);
  assert.strictEqual(t2.unsure.length, 0);
  assert.match(seen[seen.length - 1][1].content, /PERSON \(answering "Is "Stock Associate" the right job title/, "the coach sees which question was answered");
  // Only a question the coach just asked can be the one being answered.
  const t3 = await T.say("about 2 years", "Did you manage the store?");
  assert.strictEqual(t3.turns[4].re, undefined);
});

test("limits: a message that would go over is refused and not kept; a failed reply can be asked again", async () => {
  T.clearTalk();
  reply = () => ({ reply: "ok", question: "And then?", ideas: [], notes: { jobs: [] } });
  for (let i = 0; i < 7; i++) await T.say("x".repeat(4000), "");
  await assert.rejects(T.say("y".repeat(4000), ""), /a lot to go on/);
  assert.strictEqual(T.getTalk().turns.filter((t) => t.who === "you").length, 7);
  T.clearTalk();
  down = true;
  await assert.rejects(T.say("I drive for DoorDash", ""), /429/);
  down = false;
  assert.strictEqual(T.getTalk().turns.length, 1, "their message is kept while the AI didn't answer");
  reply = () => ({ reply: "ok", question: "How long?", ideas: [], notes: { jobs: [{ title: "Driver", employer: "DoorDash", daily: "drive" }] } });
  const t = await T.say("", "");
  assert.deepStrictEqual(t.turns.map((x) => x.who), ["you", "coach"]);
});

test("Help me remember in the chat: what they said yes to is their message, under that job", async () => {
  assert.strictEqual(T.yesText([{ q: "Did you count the cash drawer at the end of a shift?" }, { q: "Were you trusted with the store keys?", detail: "" },
    { q: "Did you restock shelves when they ran low?", detail: "about twice a shift" }, { q: "" }]),
  "Yes, I did these:\n- count the cash drawer at the end of a shift\n- Were you trusted with the store keys? Yes\n- restock shelves when they ran low (about twice a shift)");
  assert.strictEqual(T.yesText([]), "");
  T.clearTalk();
  const notes = (daily) => ({ jobs: [{ title: "Cashier", employer: "Corner Market", daily }, { title: "Stock Associate", employer: "Corner Market", daily: "stock shelves" }] });
  reply = () => ({ reply: "ok", question: "How long have you worked there?", ideas: [], notes: notes("run the register") });
  await T.say("I'm a cashier at Corner Market, I run the register", "");
  await assert.rejects(T.say("", "", { recall: { job: 3, confirmed: [{ q: "Did you count the drawer?" }] } }), /That job is gone/);
  await assert.rejects(T.say("", "", { recall: { job: 0, confirmed: [] } }), /Say yes/);
  reply = () => ({ reply: "ok", question: "About how many times a shift?", ideas: [], notes: notes("run the register; count the cash drawer at the end of a shift; restock shelves when they ran low") });
  const t = await T.say("ignored", "How long have you worked there?", { recall: { job: 0, confirmed: [{ q: "Did you count the cash drawer at the end of a shift?" }, { q: "Did you restock shelves when they ran low?" }] } });
  const mine = t.turns[2];
  assert.match(mine.text, /^Yes, I did these:\n- count the cash drawer/);
  assert.strictEqual(mine.about, "Cashier at Corner Market");
  assert.strictEqual(mine.re, undefined, "yes answers don't answer the coach's question");
  assert.strictEqual(t.notes.jobs[0].daily, "run the register; count the cash drawer at the end of a shift; restock shelves when they ran low", "the yes answers count as their words");
  assert.match(seen[seen.length - 1][1].content, /PERSON \(about their job as Cashier at Corner Market\): Yes, I did these/);
  // The job it's about is the AI's reading: a title they never used stays theirs to confirm.
  const again = await T.say("", "", { recall: { job: 1, confirmed: [{ q: "Did you unload deliveries?" }] } });
  assert.deepStrictEqual(again.unsure.map((u) => u.title), ["Stock Associate"]);
  assert.doesNotMatch(T.theirWords(again.turns), /Stock Associate/);
});

test("Write my resume: the chat's notes become the creator's interview", async () => {
  await handle("/api/resume/talk/clear", {});
  reply = (sys) => {
    if (/friendly resume coach/.test(sys)) return { reply: "Got it.", question: "About how many customers a day?", ideas: [],
      notes: { target: "", jobs: [{ title: "Cashier", employer: "Corner Market", start: "2021", current: true, daily: "run the register, stock the cooler; handled payroll", numbers: "", proud: "", tools: "" }] } };
    if (/one-page resume from a person's own answers/.test(sys)) return { summary: "", jobs: [{ index: 0, bullets: [{ text: "Run the register and stock the cooler", source: "run the register, stock the cooler" }] }] };
    return {};
  };
  const nothing = await handle("/api/resume/talk/write", { merge: false });
  assert.match(nothing.error, /Tell me about your work first/);
  const t = await handle("/api/resume/talk", { text: "I'm a cashier at Corner Market since 2021, I run the register and stock the cooler", re: "" });
  assert.strictEqual(t.turns[1].question, "About how many customers a day?");
  const r = await handle("/api/resume/talk/write", { merge: false });
  assert.ifError(r.error);
  const e = r.profile.experience.find((x) => x.org === "Corner Market");
  assert.strictEqual(e.title, "Cashier");
  assert.deepStrictEqual(e.bullets.map((b) => b.text), ["Run the register and stock the cooler"]);
  const asked = seen.find((m) => /one-page resume from a person's own answers/.test(m[0].content))[1].content;
  assert.match(asked, /run the register; stock the cooler/);
  assert.doesNotMatch(asked, /payroll/, "payroll, which they never said, never reaches the resume writer");
  assert.ok(e.bullets.every((b) => b.approved === false), "nothing is used until approved");
  assert.match(e.dates, /2021 – Present/);
});
