// "Fill out my page", with a mock AI: other work, certifications with their year, a record, school and a
// number behind a line become unapproved pieces in the person's layout; nothing invented gets through.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile, approvedOnly } = await import("../core/engine.js");
const F = await import("../core/fill.js");

let reply = () => ({});
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const m = JSON.parse(b);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(m.messages[0].content, m.messages[1].content)) } }] }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" } });
test.after(() => ai.close());

const resume = () => ({ schema: Profile.SCHEMA, name: "Sam Rivera", contact: {}, rules: Profile.EXAMPLE.rules,
  summaries: [{ id: "summary", text: "Tow truck driver with a Class B CDL.", approved: true }], headers: [], projects: [], education: [],
  experience: [{ id: "tow", title: "Tow Truck Driver", org: "Initech Towing", dates: "Mar 2021 – Present", bullets: [
    { id: "calls", text: "Respond to dispatched breakdown and accident calls", approved: true },
    { id: "hook", text: "Secure vehicles with chains, straps and winch cables", approved: true }] }],
  skills: [{ id: "lic", label: "Licenses & Certifications", items: "Class B CDL, WreckMaster 4/5", approved: true }],
  bases: [{ id: "main", description: "General", approved: true, header: null, summary: "summary", skills: ["lic"],
    sections: [{ kind: "experience", items: [{ id: "tow", bullets: ["calls", "hook"] }] }] }] });

test("questions: the fixed ones, their certifications, and a number question only for real lines", async () => {
  reply = (sys) => (/A recruiter wants scope/.test(sys) ? { questions: [{ path: "experience.tow.calls", question: "How many calls in a typical shift?" }, { path: "made.up", question: "x" }] } : {});
  const q = await F.fillQuestions(resume());
  assert.deepStrictEqual(Array.from(q.certs), ["Class B CDL", "WreckMaster 4/5"]);
  assert.deepStrictEqual(q.jobs.map((j) => j.id), ["tow"]);
  assert.deepStrictEqual(q.numbers.map((x) => x.path), ["experience.tow.calls"]);
  assert.strictEqual(q.numbers[0].original, "Respond to dispatched breakdown and accident calls");
  assert.ok(q.prompts.records);
});

test("answers become unapproved pieces in the layout; the resume used today doesn't change", async () => {
  reply = (sys, user) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/You write a one-page resume/.test(sys)) return { summary: "A new summary that should not replace theirs", jobs: [
      { index: 0, bullets: [{ text: "Delivered packages on weekend routes", source: "weekend package delivery" }, { text: "Managed a fleet of 40 vans", source: "x" }] },
      { index: 1, bullets: [{ text: "Coached a youth soccer team on Saturdays", source: "coach youth soccer" }] }] };
    if (/You are an experienced recruiter turning/.test(sys)) return { jobs: [] };
    if (/Turn what a person said about a record/.test(sys)) return { lines: [{ n: 0, text: "Recognized as employee of the month in 2023 by Initech Towing" }] };
    if (/You rewrite one resume line/.test(sys)) {
      assert.match(user, /about 10 calls/);
      return { text: "Respond to about 10 dispatched breakdown and accident calls a shift" };
    }
    return {};
  };
  const before = approvedOnly(resume());
  const r = await F.applyFill(resume(), {
    jobs: [{ title: "Delivery Driver", employer: "Globex", start: "2019", end: "2020", daily: "weekend package delivery", tools: "Hand truck" }],
    volunteer: [{ title: "Youth Soccer Coach", employer: "Acme Park League", daily: "coach youth soccer on Saturdays" }],
    certs: [{ name: "WreckMaster 4/5", issuer: "WreckMaster", year: "2022" }, { name: "OSHA 10", year: "2021" }],
    records: [{ id: "tow", text: "employee of the month in 2023" }],
    school: [{ school: "Sacramento Truck Driving School", earned: "Class B CDL training", year: "2020" }],
    numbers: [{ path: "experience.tow.calls", question: "How many calls a shift?", answer: "about 10 calls a shift" }],
  });
  const p = r.profile;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(approvedOnly(p))).bases[0].sections[0], JSON.parse(JSON.stringify(before)).bases[0].sections[0], "nothing new is used before approval");
  assert.strictEqual(p.bases.length, 1, "no extra layout");
  assert.deepStrictEqual(p.summaries.map((s) => s.id), ["summary"], "their summary stays");
  const del = p.experience.find((e) => e.title === "Delivery Driver");
  assert.deepStrictEqual(del.bullets.map((b) => b.text), ["Delivered packages on weekend routes"], "the invented fleet line is left out");
  const coach = p.experience.find((e) => e.title === "Youth Soccer Coach");
  assert.strictEqual(coach.volunteer, true);
  assert.deepStrictEqual(p.bases[0].sections[0].items.map((it) => it.id), ["tow", del.id, coach.id], "new work after theirs, volunteering last");
  const certs = p.skills.find((s) => s.replaces === "lic");
  assert.strictEqual(certs.items, "Class B CDL, WreckMaster 4/5 (WreckMaster, 2022), OSHA 10 (2021)");
  assert.strictEqual(certs.approved, false);
  const tow = p.experience.find((e) => e.id === "tow");
  assert.strictEqual(tow.bullets[0].text, "Recognized as employee of the month in 2023 by Initech Towing");
  const num = tow.bullets.find((b) => b.replaces === "calls");
  assert.strictEqual(num.text, "Respond to about 10 dispatched breakdown and accident calls a shift");
  assert.strictEqual(p.education[0].school, "Sacramento Truck Driving School");
  assert.ok(p.bases[0].sections.some((s) => s.kind === "education"));
  assert.ok(r.rejected.some((x) => /40 vans/.test(x.text)));

  // Approve everything: the new pieces take their places.
  for (const k of ["skills", "education"]) for (const x of p[k]) x.approved = true;
  for (const e of p.experience) for (const b of e.bullets) b.approved = true;
  const ok = approvedOnly(p);
  assert.deepStrictEqual(ok.skills.map((s) => s.id).includes("lic"), false, "the old certifications list is replaced");
  const lay = ok.bases[0].sections[0].items[0].bullets.map((id) => ok.experience[0].bullets.find((b) => b.id === id).text);
  assert.deepStrictEqual(lay, ["Recognized as employee of the month in 2023 by Initech Towing", "Respond to about 10 dispatched breakdown and accident calls a shift", "Secure vehicles with chains, straps and winch cables"]);
});

test("tools from new work join the list of that kind; a record keeps the job within its line budget", async () => {
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/You write a one-page resume/.test(sys)) return { jobs: [{ index: 0, bullets: [{ text: "Delivered packages on weekend routes", source: "weekend package delivery" }] }] };
    if (/You are an experienced recruiter turning/.test(sys)) return { jobs: [] };
    if (/Turn what a person said about a record/.test(sys)) return { lines: [{ n: 0, text: "Kept a clean record with no damage claims in 4 years" }] };
    return {};
  };
  const p0 = resume();
  p0.skills.push({ id: "tools", label: "Equipment & Tools", items: "Winch, Flatbed", approved: true });
  p0.bases[0].skills.push("tools");
  const old = p0.experience.find((e) => e.id === "tow");
  for (const t of ["Jump-start and unlock vehicles at the roadside", "Collect payments and tow receipts", "Place cones and flares at accident scenes"]) old.bullets.push({ id: t.slice(0, 4).toLowerCase(), text: t, approved: true });
  p0.bases[0].sections[0].items[0].bullets = old.bullets.map((b) => b.id);
  const r = await F.applyFill(p0, { jobs: [{ title: "delivery driver", employer: "Globex", daily: "weekend package delivery", tools: "Hand truck" }], records: [{ id: "tow", text: "no damage claims in 4 years" }] });
  const p = r.profile;
  assert.ok(p.experience.some((e) => e.title === "Delivery Driver"), "titles get their capitals");
  const tools = p.skills.find((s) => s.replaces === "tools");
  assert.strictEqual(tools.items, "Winch, Flatbed, Hand truck");
  for (const s of p.skills) s.approved = true;
  for (const e of p.experience) for (const b of e.bullets) b.approved = true;
  const ok = approvedOnly(p);
  assert.strictEqual(ok.skills.filter((s) => s.label === "Equipment & Tools").length, 1, "one Equipment & Tools heading");
  const tow = ok.bases[0].sections[0].items.find((it) => it.id === "tow");
  assert.strictEqual(tow.bullets.length, 5, "the record is first and the job still shows 5 lines");
  assert.strictEqual(tow.bullets[0], p.experience.find((e) => e.id === "tow").bullets[0].id);
});

test("a number answer whose rewording fails is added to their own line, word for word", async () => {
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [{ i: 0, unsupported: "completing" }] };
    if (/You rewrite one resume line/.test(sys)) return { text: "Respond to dispatched breakdown and accident calls, completing about 10 a shift" };
    return {};
  };
  const r = await F.applyFill(resume(), { numbers: [{ path: "experience.tow.calls", question: "How many calls a shift?", answer: "About 10 calls a shift" }] });
  const b = r.profile.experience[0].bullets.find((x) => x.replaces === "calls");
  assert.strictEqual(b.text, "Respond to dispatched breakdown and accident calls, about 10 calls a shift");
  assert.match(b.warning, /as you typed it/);
});
