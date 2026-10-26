// "Not sure what to look for?": suggestions from the resume, the pay floor, and years from the creator's dates.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { approvedExample, tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile } = await import("../core/engine.js");
const { payPerHour, suggestTitles } = await import("../core/suggest.js");
const { yearsFromInterview } = await import("../core/api.js");
const { candidateFacts } = await import("../core/facts.js");

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

test("pay as an hourly figure, from any posting's pay text", () => {
  assert.deepStrictEqual(payPerHour("$28-$30/hour"), { min: 28, max: 30 });
  assert.deepStrictEqual(payPerHour("$20/hour"), { min: 20, max: 20 });
  assert.deepStrictEqual(payPerHour("$72,800-$78,000/year"), { min: 35, max: 37.5 });
  assert.deepStrictEqual(payPerHour("USD 104k-124.8k/year"), { min: 50, max: 60 });
  assert.deepStrictEqual(payPerHour("$1,200-$1,600/week"), { min: 30, max: 40 });
  assert.strictEqual(payPerHour(""), null);
  assert.strictEqual(payPerHour("Competitive"), null);
});

test("suggestions come from the approved resume, pay-more first, never titles already searched or claims on the never list", async () => {
  store.saveProfile(approvedExample(Profile));
  store.savePrefs({ titles: ["Software Engineer"], jobKind: "office" });
  store.saveAnswers({ cannotClaim: ["Kubernetes"] });
  let seen = "";
  reply = (sys, user) => { if (/fact-check/.test(sys)) return { lines: [{ i: 0, unsupported: "Certified in bucket trucks" }] }; seen = user; return { titles: [
    { title: "Utility Driver", why: "You are certified in bucket truck operation", pay: "more" },
    { title: "Data Engineer", why: "Built Python and PostgreSQL services", pay: "similar" },
    { title: "Backend Engineer", why: "Built REST APIs in Python and Node.js", pay: "more" },
    { title: "Software Engineer", why: "already searched", pay: "more" },
    { title: "Kubernetes Administrator", why: "no", pay: "more" },
    { title: "QA Tester", why: "Set up CI tests", pay: "less" } ] }; };
  const r = await suggestTitles();
  assert.deepStrictEqual(r.map((x) => x.title), ["Backend Engineer", "Data Engineer", "QA Tester"], "the one the fact-check doubted is gone");
  assert.strictEqual(r[0].payText, "", "the AI's sense of pay orders the list but is never shown as a fact");
  assert.match(seen, /REST APIs|PostgreSQL/, "the AI sees the approved resume");
  const p = approvedExample(Profile);
  for (const e of p.experience) for (const b of e.bullets) b.approved = false;
  for (const s of p.skills) s.approved = false;
  store.saveProfile(p);
  await assert.rejects(suggestTitles(), /resume first/, "nothing approved yet: nothing to suggest from");
});

test("years of experience from the creator's own dates, rounded down, overlaps counted once", () => {
  const now = new Date(2026, 9, 25);
  const iv = { jobs: [{ title: "Tow Truck Driver", start: "Mar 2021", current: true }, { title: "Sign Shop Worker", start: "Jun 2016", end: "Feb 2021" },
    { title: "Weekend Helper", start: "2020", end: "2021" }, { title: "No Dates" }] };
  const r = yearsFromInterview(iv, { years: [{ type: "Sign shop worker", years: 4 }] }, now);
  assert.deepStrictEqual(r.years, [{ type: "Sign shop worker", years: 4 }, { type: "Tow Truck Driver", years: 5.5 }, { type: "Weekend Helper", years: 1 }], "a number the person entered stays theirs");
  assert.strictEqual(r.totalYears, 10, "125 months: 10.4 years, rounded down to the half year");
  assert.deepStrictEqual(yearsFromInterview(iv, { years: [], totalYears: 3 }, now).totalYears, undefined, "a total they gave stays");
});

test("the screen sees practical facts (car, record, age), and only the ones given", () => {
  const f = candidateFacts({ over18: "yes", over21: "yes", driversLicense: "yes", ownVehicle: "no", drivingRecord: "clean", canLift: "75", daysAvailable: ["Saturday"] }, null, {});
  assert.deepStrictEqual(f.practical, { over18: "Yes", over21: "Yes", driversLicense: "Yes", ownInsuredVehicle: "No", cleanDrivingRecord: "Yes", canLiftPounds: 75, daysAvailable: "Saturday" });
  assert.deepStrictEqual(candidateFacts({}, null, {}).practical, {});
});
