// Federal jobs from USAJOBS (with a mock of its API), and government job sites the app never opens.
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const vault = new Map();
store.setSecretStore({ get: (k) => vault.get(k) || "", set: (k, v) => vault.set(k, v) });
const U = await import("../core/sources/usajobs.js");
const { manualReason } = await import("../core/discover.js");
const { classify } = await import("../core/ats.js");

const item = (id, over = {}) => ({ MatchedObjectId: id, MatchedObjectDescriptor: {
  PositionTitle: "Motor Vehicle Operator", PositionURI: `https://www.usajobs.gov/job/${id}`, ApplyURI: [`https://www.usajobs.gov/job/${id}?PostingChannelID=RESTAPI`],
  PositionLocationDisplay: "Sacramento, California", OrganizationName: "Veterans Health Administration", DepartmentName: "Department of Veterans Affairs",
  QualificationSummary: "Must have a valid state driver's license.", PositionRemuneration: [{ MinimumRange: "24.10", MaximumRange: "28.12", RateIntervalCode: "PH" }],
  PublicationStartDate: "2026-10-20T00:00:00Z", ApplicationCloseDate: "2026-11-03T23:59:59Z",
  UserArea: { Details: { JobSummary: "Drive government vehicles.", MajorDuties: ["Transports passengers", "Inspects the vehicle"], WhoMayApply: { Name: "United States Citizens" }, LowGrade: "06", HighGrade: "06" } }, ...over } });

test("a USAJOBS listing becomes a job: pay, place, closing date, and always the person's to apply to", () => {
  const j = U.normalize(item("812345600"));
  assert.strictEqual(j.slug, "usaj-812345600");
  assert.strictEqual(j.title, "Motor Vehicle Operator");
  assert.strictEqual(j.company, "Veterans Health Administration, Department of Veterans Affairs");
  assert.strictEqual(j.salary, "$24-$28/hour");
  assert.strictEqual(j.kind, "account");
  assert.strictEqual(j.ats, "usajobs");
  assert.match(j.description, /Who may apply: United States Citizens/);
  assert.match(j.description, /Transports passengers/);
  assert.match(j.description, /Applications close Nov 3, 2026/);
  assert.match(manualReason(j), /Apply yourself on USAJOBS: it needs a free Login.gov account.*applications close Nov 3/);
  const yearly = U.normalize(item("1", { PositionRemuneration: [{ MinimumRange: "92108", MaximumRange: "119746", RateIntervalCode: "PA" }] }));
  assert.strictEqual(yearly.salary, "$92,108-$119,746/year");
});

test("the search: the person's titles near their city and remote, public jobs only, with their key and email", async () => {
  await store.setSecret("usajobsKey", "k123");
  store.saveSettings({ usajobsEmail: "jordan@example.com" });
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { seen.push({ url: String(url), h: opts.headers }); return new Response(JSON.stringify({ SearchResult: { SearchResultItems: [item(String(seen.length))] } }), { status: 200 }); };
  try {
    const prefs = { titles: ["Driver"], cities: [{ name: "Sacramento", region: "California", country: "US", label: "Sacramento, California, United States" }], radius: 25, remote: true, remoteCountry: "US", postedWithinDays: 14 };
    const jobs = await U.search(prefs, {});
    assert.strictEqual(jobs.length, 2);
    assert.strictEqual(seen[0].h["Authorization-Key"], "k123");
    assert.strictEqual(seen[0].h["User-Agent"], "jordan@example.com");
    const q0 = new URL(seen[0].url).searchParams, q1 = new URL(seen[1].url).searchParams;
    assert.strictEqual(q0.get("LocationName"), "Sacramento, California");
    assert.strictEqual(q0.get("Radius"), "25");
    assert.strictEqual(q0.get("WhoMayApply"), "public");
    assert.strictEqual(q1.get("RemoteIndicator"), "True");
  } finally { globalThis.fetch = real; }
});

test("a refused key stops the searches and says so; no key means no searches", async () => {
  const real = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async () => { n++; return new Response("{}", { status: 401 }); };
  const logs = [];
  await store.setSecret("usajobsKey", "k123");
  try {
    await U.search({ titles: ["Driver", "Clerk"], cities: [{ name: "Sacramento", region: "California", country: "US" }], radius: 25 }, { log: (m) => logs.push(m) });
    assert.strictEqual(n, 1, "one refusal is enough");
    assert.match(logs[0], /refused/);
    await assert.rejects(U.testKey("bad", "x@example.com"), /didn't accept that key/);
  } finally { globalThis.fetch = real; }
  await store.setSecret("usajobsKey", "");
  assert.deepStrictEqual(await U.search({ titles: ["Driver"], cities: [] }, { log: () => {} }), []);
});

test("government job sites are the person's to apply to, and GovernmentJobs.com is never fetched", async () => {
  assert.strictEqual(classify("https://www.governmentjobs.com/careers/sacramento/jobs/4712345/sign-maker").ats, "neogov");
  assert.strictEqual(classify("https://www.usajobs.gov/job/812345600").kind, "account");
  assert.strictEqual(classify("https://calcareers.ca.gov/CalHrPublic/Jobs/JobPosting.aspx?JobControlId=471234").ats, "calcareers");
  const real = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = async () => { fetched++; return new Response("<html></html>"); };
  try {
    const { resolveLink } = await import("../core/addjob.js");
    const j = await resolveLink("https://www.governmentjobs.com/careers/sacramento/jobs/4712345/sign-maker");
    assert.strictEqual(fetched, 0, "the page is never opened");
    assert.strictEqual(j.title, "sign maker");
    assert.strictEqual(j.company, "Sacramento");
    assert.match(manualReason(j), /GovernmentJobs.com: it needs a free account there, and the app doesn't open that site/);
  } finally { globalThis.fetch = real; }
});
