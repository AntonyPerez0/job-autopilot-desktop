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
  reply = (sys) => {
    if (/Which official occupation/.test(sys)) return { i: 1 }; // Light Truck Drivers
    if (/fact-check/.test(sys)) return { lines: [{ i: 1, unsupported: "hazmat endorsement" }] };
    return { jobs: [
      { code: "53-3032.00", status: "ready", search: "Class A CDL Driver", why: "You drive a tow truck with a Class B CDL" },
      { code: "43-5052.00", status: "ready", search: "Mail Carrier", why: "You hold a hazmat endorsement" },
      { code: "53-3052.00", status: "step", search: "Transit Bus Driver", why: "", need: "Passenger (P) endorsement", how: "A DMV test, usually a few weeks" },
      { code: "99-9999.00", status: "ready", search: "Astronaut", why: "x" }] };
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
