// Locations: radius, ambiguous city names, remote by country.
import test from "node:test";
import assert from "node:assert";
import { citiesNear, remoteOk, resolvePlace, searchCities, withinRadius } from "../core/geo.js";
import { titleOk, excludedCompany, searches } from "../core/discover.js";
import { examplePrefs } from "./helpers.js";

const austin = examplePrefs();

test("city search", () => {
  const r = searchCities("Austin, TX");
  assert.strictEqual(r[0].name, "Austin");
  assert.strictEqual(r[0].region, "Texas");
});

test("Dublin, CA is California; plain Dublin is Ireland", () => {
  assert.strictEqual(resolvePlace("Dublin, CA").country, "US");
  assert.strictEqual(resolvePlace("Dublin").country, "IE");
  assert.strictEqual(resolvePlace("Bay Area").name, "San Francisco");
});

test("inside the radius", () => {
  assert.ok(withinRadius("Round Rock, TX", austin));
  assert.ok(withinRadius("Austin, Texas, United States", austin));
  assert.ok(!withinRadius("Dallas, TX", austin));
  assert.ok(!withinRadius("Austin, MN", austin), "same name, other state");
  assert.ok(withinRadius("New York, NY; Austin, TX", austin), "any of several locations");
  assert.ok(withinRadius("Dallas, TX", { ...austin, radius: 200 }));
});

test("cities handed to the search", () => {
  const c = citiesNear(austin);
  assert.strictEqual(c[0], "Austin");
  assert.ok(c.includes("Round Rock"));
  assert.ok(!c.includes("Dallas"));
});

test("remote by country", () => {
  assert.ok(remoteOk({ work_mode: "remote", location: "Remote - US", countries: ["us"] }, "US"));
  assert.ok(!remoteOk({ work_mode: "remote", location: "Remote - Canada", countries: [] }, "US"));
  assert.ok(!remoteOk({ work_mode: "remote", location: "Remote", countries: ["GB"] }, "US"));
  assert.ok(!remoteOk({ work_mode: "onsite", location: "Austin, TX" }, "US"));
});

test("titles, seniority and excluded companies", () => {
  assert.ok(titleOk("Software Engineer II", { ...austin, seniority: ["junior", "middle"] }));
  assert.ok(!titleOk("Senior Software Engineer", austin));
  assert.ok(!titleOk("Software Engineer Intern", austin));
  assert.ok(titleOk("Software Engineer Intern", { ...austin, internships: true }));
  assert.ok(!titleOk("Software Engineer III", { ...austin, seniority: ["junior"] }));
  assert.ok(!titleOk("Account Executive", austin));
  assert.ok(excludedCompany("Initech LLC", austin));
  assert.ok(excludedCompany("Jobgether", austin), "agencies are excluded by default");
  assert.ok(!excludedCompany("Globex", austin));
  const s = searches(austin);
  assert.strictEqual(s.length, 4);
  assert.deepStrictEqual(s[1].countries, ["US"]);
});

test("a license class named in a driving job's title is a must-have, checked without the AI", async () => {
  const { licenseGap } = await import("../core/discover.js");
  const b = { skills: [{ label: "Licenses & Certifications", items: "Class B CDL, Forklift certified" }] };
  assert.match(licenseGap("CLASS A COMMERCIAL DELIVERY DRIVER - SACRAMENTO", b), /Class A CDL; you hold Class B/);
  assert.match(licenseGap("CDL-A Regional Driver", b), /Class A/);
  assert.strictEqual(licenseGap("Class B CDL Driver", b), "");
  assert.strictEqual(licenseGap("Driver Class C", b), "", "a Class B holder can drive Class C");
  assert.strictEqual(licenseGap("Class A Office Building Engineer", b), "", "a building class, not a license");
  assert.strictEqual(licenseGap("Class B Driver", { skills: [{ label: "Licenses", items: "Class A CDL" }] }), "");
  assert.match(licenseGap("Class B Driver", { skills: [{ label: "Skills", items: "Excel" }] }), /doesn't list one/);
});
