// "What do jobs like mine pay?": freehire's figures for the person's kind of work, level and country (every freehire
// answer here is the test's own), and the rule that turns their desired pay into what each form asks.
import test from "node:test";
import assert from "node:assert";
import { exampleAnswers, tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const P = await import("../core/pay.js");
const { autopilotRules } = await import("../core/facts.js");

const facets = { Cashier: [["retail", 70], ["sales", 20], ["hospitality", 10]], Barista: [["hospitality", 90], ["retail", 10]], "QA Engineer": [["qa", 90], ["software_engineering", 10]] };
const BANDS = {
  "qa|junior|US": [{ currency: "USD", p25: 74554, p50: 82500, p75: 93317, period: "year", sample_size: 38 }, { currency: "USD", p25: 25, p50: 31, p75: 34, period: "hour", sample_size: 9 }],
  "retail|junior|US": [{ currency: "USD", p25: 16, p50: 17, p75: 19, period: "hour", sample_size: 3 }],
  "retail||US": [{ currency: "USD", p25: 18, p50: 18, p75: 20, period: "hour", sample_size: 151 }, { currency: "USD", p25: 60000, p50: 60000, p75: 65000, period: "year", sample_size: 48 }],
};
const calls = [];
const ask = async (name, args) => {
  calls.push([name, args]);
  if (name === "job_market_stats") return { facets: { category: (facets[args.query] || []).map(([value, count]) => ({ value, count })) } };
  if (name === "salary_stats") return { bands: BANDS[`${args.category}|${args.seniority || ""}|${args.country}`] || [] };
  throw new Error("unexpected " + name);
};

test("their country, and their level from their years among the levels they look for", () => {
  assert.strictEqual(P.countryCode({ country: "United States" }), "US");
  assert.strictEqual(P.countryCode({ country: "Canada" }), "CA");
  assert.strictEqual(P.countryCode({ country: "de" }), "DE");
  assert.strictEqual(P.countryCode({}, { remoteCountry: "gb" }), "GB");
  assert.strictEqual(P.levelFor(1, { seniority: ["junior", "middle"] }), "junior");
  assert.strictEqual(P.levelFor(4, { seniority: ["junior", "middle"] }), "middle");
  assert.strictEqual(P.levelFor(9, { seniority: ["junior", "middle"] }), "middle", "the nearest level they look for");
  assert.strictEqual(P.levelFor(0, { seniority: ["senior"] }), "senior");
  assert.strictEqual(P.levelFor(0, {}), "junior");
});

test("the kind of work: each title counts the same", async () => {
  assert.strictEqual(await P.kindOfWork(["Cashier", "Barista"], "US", ask), "hospitality");
  assert.strictEqual(await P.kindOfWork(["Cashier"], "US", ask), "retail");
  assert.strictEqual(await P.kindOfWork(["Nothing Like It"], "US", ask), null);
});

test("pay at their level, by the year for office work; too few postings at their level: every level", async () => {
  const qa = await P.suggestPay({ titles: ["QA Engineer"], years: 1, answers: { country: "United States" }, prefs: { seniority: ["junior"], jobKind: "office" }, ask });
  assert.deepStrictEqual([qa.kind, qa.level, qa.period, qa.low, qa.mid, qa.high, qa.n, qa.text], ["QA and testing", "junior", "year", 74554, 82500, 93317, 38, "$82,500 a year"]);
  assert.deepStrictEqual(qa.others.map((b) => b.text), ["$31 an hour"]);
  const shop = await P.suggestPay({ titles: ["Cashier"], years: 0, answers: {}, prefs: { seniority: ["junior"], jobKind: "hourly" }, ask });
  assert.deepStrictEqual([shop.level, shop.period, shop.mid, shop.n, shop.text], [null, "hour", 18, 151, "$18 an hour"], "3 postings at entry level are too few");
  const none = await P.suggestPay({ titles: ["Barista"], years: 0, answers: {}, prefs: {}, ask });
  assert.deepStrictEqual([none.kind, none.n], ["Hospitality", 0]);
  await assert.rejects(P.suggestPay({ titles: [], ask }), /Add the jobs you're looking for first/);
  assert.deepStrictEqual(calls.filter(([n]) => n === "salary_stats").map(([, a]) => a.seniority || "any"), ["junior", "junior", "any", "junior", "any"]);
});

test("the forms get their desired pay in the period they ask, or the posted range when there's none", () => {
  const rules = (salary) => autopilotRules({ ...exampleAnswers(), salary }, { experience: [] }, { maxYearsRequired: 5 });
  const mine = rules("$82,500 a year");
  assert.match(mine, /Desired pay: "\$82,500 a year", the candidate's own figure/);
  assert.match(mine, /12 months, 52 weeks or 2,080 working hours/);
  assert.match(mine, /the low end of the posted range instead/);
  assert.match(rules(""), /Desired pay: not given\. The middle of a pay range the posting states/);
});
