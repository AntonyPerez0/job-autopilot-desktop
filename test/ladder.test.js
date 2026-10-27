// "Move up": better-paying jobs from official data (which jobs lead to which, typical pay where they live),
// judged against the person's facts with a mock AI; invented reasons are dropped.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const L = await import("../core/ladder.js");

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

test("the step-up list comes from the official data: related work, better pay where they live, at most one step more preparation", () => {
  const ca = L.stepsFrom("53-3033.00", { state: "CA" }); // Light Truck Drivers
  assert.ok(ca.length >= 3);
  assert.ok(ca.some((x) => x.code === "53-3032.00"), "heavy truck driving is a step up");
  const base = L.payOf("53-3033.00", "CA").hourly;
  assert.ok(ca.every((x) => x.pay.hourly >= base * 1.1), "only jobs paying at least 10% more");
  assert.ok(ca.every((x) => x.zone <= L.zoneOf("53-3033.00") + 1), "at most one step more preparation");
  assert.ok(!ca.some((x) => x.code === "47-5044.00"), "underground mining is rare in California: left out");
  assert.ok(L.stepsFrom("53-3033.00", { state: "CA", nowHourly: 30 }).every((x) => x.pay.hourly >= 33), "measured against what they make now");
  assert.strictEqual(L.stateOf({ state: "California" }, {}), "CA");
  assert.strictEqual(L.stateOf({}, { cities: [{ country: "US", admin1: "TX" }] }), "TX");
});

test("ready now or one step away, from their facts only: invented reasons dropped, a license class they lack is a step", async () => {
  const p = { schema: 1, name: "Sam Rivera", experience: [{ id: "tow", title: "Tow Truck Driver", org: "Initech Towing", dates: "Mar 2021 – Present",
    bullets: [{ id: "a", text: "Respond to dispatched breakdown and accident calls", approved: true }] }],
    skills: [{ id: "l", label: "Licenses & Certifications", items: "Class B CDL", approved: true }], education: [], projects: [], summaries: [], bases: [] };
  reply = (sys, user) => {
    if (/what work they could go for next/.test(sys)) return { jobs: [1], ideas: [] }; // Light Truck Drivers
    if (/fact-check/.test(sys)) return { lines: [{ i: 1, unsupported: "hazmat endorsement" }] };
    const id = (name) => (user.match(new RegExp("^(j\\d+) \\| " + name, "m")) || [])[1];
    return { jobs: [
      { id: id("Heavy and Tractor-Trailer"), status: "ready", search: "Class A CDL Driver", why: "You drive a tow truck with a Class B CDL" },
      { id: id("Postal Service Mail Carriers"), status: "ready", search: "Mail Carrier", why: "You hold a hazmat endorsement" },
      { id: id("Bus Drivers, Transit"), status: "step", search: "Transit Bus Driver", why: "", need: "Passenger (P) endorsement", how: "A DMV test, usually a few weeks" },
      { id: "j99", status: "ready", search: "Astronaut", why: "x" }] };
  };
  const r = await L.moveUp(p, { state: "CA" }, { titles: [] });
  assert.strictEqual(r.state, "CA");
  assert.ok(r.from.pay.hourly > 0);
  assert.deepStrictEqual(r.ready.map((x) => x.title), [], "the mail carrier reason was invented; the Class A job needs a license they don't hold");
  const titles = r.step.map((x) => x.title);
  assert.ok(titles.includes("Class A CDL Driver") && titles.includes("Transit Bus Driver"));
  assert.match(r.step.find((x) => x.title === "Class A CDL Driver").need, /Class A/);
  assert.ok(!JSON.stringify(r).includes("Astronaut"), "only occupations from the list");
  assert.ok(r.step.every((x) => x.gain > 0 && /California/.test(x.pay.area)));
});

test("not only the next rung: every job they had, ideas from their skills and projects, about the same pay counts, and what isn't for them is left out", async () => {
  const p = { schema: 1, name: "Jordan Lee", experience: [
    { id: "tw", title: "Technical Writer", org: "Globex", dates: "Jan 2022 – Present", bullets: [{ id: "a", text: "Write API reference docs and tutorials for developers", approved: true }] },
    { id: "sup", title: "Customer Support Specialist", org: "Initech", dates: "2019 – 2021", bullets: [{ id: "b", text: "Answered customer tickets about billing and accounts", approved: true }] }],
    projects: [{ id: "pr", title: "Trail app", bullets: [{ id: "c", text: "Built a React web app with a Node.js API and a Postgres database", approved: true }] }],
    skills: [{ id: "s", label: "Programming", items: "JavaScript, React, Node.js, SQL", approved: true }], education: [], summaries: [], bases: [] };
  const seen = [];
  reply = (sys, user) => {
    if (/what work they could go for next/.test(sys)) {
      seen.push(user);
      return { jobs: [0, 0], ideas: ["Web Developer", "Software Developer", "Technical Writer"] };
    }
    if (/fact-check/.test(sys)) return { lines: [] };
    // which official occupation each idea is: the first listed match
    if (/pick the official occupation that is the same work/.test(sys)) { seen.push(user); return { map: [...user.matchAll(/^TITLE/gm)].map(() => 0) }; }
    seen.push(user);
    const lines = [...user.matchAll(/^(j\d+) \| ([^|]+) \|/gm)];
    return { jobs: lines.map((m) => ({ id: m[1], status: "ready", search: m[2].replace(/ \(official.*$/, "").trim(), why: "You built a React web app with a Node.js API" })) };
  };
  const r = await L.moveUp(p, { state: "CA" }, { titles: ["Software Engineer"], moveToward: "more coding", notForMe: [{ code: "27-3041.00", title: "Editor" }] });
  assert.match(seen[0], /JOB 1: Customer Support Specialist/, "every job, not just the latest");
  assert.match(seen[0], /more coding/, "what they'd like to move toward");
  assert.match(seen[0], /Trail app/, "their projects count");
  assert.doesNotMatch(seen[1], /Technical Writer\n/, "their own job title isn't an idea");
  const list = seen[2];
  assert.match(list, /^j0 \| Web Developer \(official occupation: Web Developers\)/m, "an idea from their skills, listed first, with its official occupation for the pay");
  assert.match(list, /Software Developer \(official occupation: Software Developers\)/, "an idea is a job title of its own");
  assert.doesNotMatch(list, /\| Technical Writers \|/, "not their own job again");
  assert.doesNotMatch(list, /\| Editors \|/, "what they said isn't for them");
  const codes = [...r.ready, ...r.step].map((x) => x.code);
  assert.ok(!codes.includes("27-3041.00"));
  assert.deepStrictEqual(r.based, ["Technical Writer", "Customer Support Specialist"]);
  const web = r.ready.find((x) => x.code === "15-1254.00");
  assert.ok(web && web.gain > 0, "web developer: from their skills, and it pays more");
  assert.ok(r.ready.some((x) => x.same), "work at about the same pay is kept too, and marked");
  assert.ok(r.ready.filter((x) => x.same).every((x) => x.gain >= -10 && x.gain < 10));
  assert.ok(r.ready.every((x) => x.gain >= -10));
});
