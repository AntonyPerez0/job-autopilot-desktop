// What a search stores (security audit 4.4, 4.5): a look-alike posting on another site can't push out the
// employer's own or share its screening, and a posting whose screening keeps failing isn't screened forever.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { approvedExample, exampleAnswers, tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile } = await import("../core/engine.js");
const { openDb, getJob } = await import("../core/db.js");
const { SOURCES } = await import("../core/sources/index.js");
const D = await import("../core/discover.js");
const { sameRoleAs, siteKey } = await import("../core/dedupe.js");
openDb();

let status = 200, screens = [], failIf = null;
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const user = JSON.parse(b).messages.find((m) => m.role === "user").content;
    screens.push((user.match(/POSTING: (.+)/) || [])[1]);
    const code = failIf && failIf(user) ? 400 : status;
    res.writeHead(code, { "content-type": "application/json" });
    res.end(code === 200 ? JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: "apply", reason: "fits", level: "mid" }) } }] }) : JSON.stringify({ error: { message: "bad request" } }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
test.after(() => ai.close());
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" } });
store.saveAnswers(exampleAnswers()); store.saveProfile(approvedExample(Profile));
store.savePrefs({ titles: ["Software Engineer"], remote: true, remoteCountry: "US", cities: [], boards: { fake: true, freehire: false, hiringcafe: false }, postedWithinDays: 30 });

let results = [];
SOURCES.fake = { id: "fake", name: "Fake board", search: async () => results };
const posting = (slug, company, url) => ({ slug, title: "Software Engineer", company, location: "Remote", work_mode: "remote", countries: ["US"], url, apply_url: url,
  ats: "workable", kind: "auto", board: "fake", posted_at: new Date().toISOString(), level: "", minYears: null, sponsorship: null, description: "Build services." });

test("a look-alike employer on another site is stored and screened on its own (audit 4.4)", async () => {
  screens = [];
  results = [posting("fake-lookalike", "Acme Staffing Partners", "https://lookalike.invalid/jobs/1"), posting("fake-same-name", "Acme", "https://lookalike2.invalid/jobs/1"), posting("fake-acme", "Acme", "https://apply.workable.com/acme/j/ABC123/")];
  await D.discover();
  assert.ok(getJob("fake-lookalike"), "the look-alike is stored");
  assert.ok(getJob("fake-acme"), "and the employer's own posting too: not pushed out");
  assert.ok(getJob("fake-same-name"), "a look-alike with the exact name is stored too");
  assert.strictEqual(screens.length, 3, "each screened separately");
  assert.strictEqual(siteKey("https://apply.workable.com/acme/j/ABC123/"), "apply.workable.com/acme");
  assert.strictEqual(siteKey("https://boards.greenhouse.io/embed/job_app?for=acme"), "boards.greenhouse.io", "no tenant in the path: the host alone");
  const rows = [{ slug: "x", company: "Acme", title: "Software Engineer", url: "https://lookalike.invalid/jobs/9", status: "applied" }];
  assert.strictEqual(sameRoleAs({ slug: "y", company: "Acme", title: "Software Engineer", url: "https://apply.workable.com/acme/j/1" }, rows), null, "applied elsewhere doesn't count here");
  assert.ok(sameRoleAs({ slug: "y", company: "Acme", title: "Software Engineer", url: "https://lookalike.invalid/jobs/2" }, rows), "the same site does");
});

test("a posting whose screening fails is tried a few times, then kept as skipped and not screened again for a day (audit 4.5, plan step 9)", async () => {
  failIf = (user) => /at Initech/.test(user);
  const { getDb } = await import("../core/db.js");
  for (let i = 1; i <= D.SCREEN_TRIES; i++) {
    screens = [];
    results = [posting("fake-flaky", "Initech", "https://apply.workable.com/initech/j/X1/"), posting("fake-fine-" + i, "Hooli " + i, `https://apply.workable.com/hooli${i}/j/A/`)];
    await D.discover();
    assert.ok(screens.some((x) => /Initech/.test(x)), `search ${i}: screened`);
    assert.strictEqual(!!getJob("fake-flaky"), i === D.SCREEN_TRIES, `search ${i}: stored only after the last try`);
  }
  assert.strictEqual(getJob("fake-flaky").status, "skipped");
  assert.match(getJob("fake-flaky").reason, /screen failed 3 times/);
  screens = [];
  await D.discover();
  assert.ok(!screens.some((x) => /Initech/.test(x)), "not screened again the same day");
  // A day later it gets one more try; failing again, it's skipped again at once.
  getDb().prepare("UPDATE jobs SET updated_at = datetime('now', '-2 days') WHERE slug = 'fake-flaky'").run();
  screens = [];
  results = [posting("fake-flaky", "Initech", "https://apply.workable.com/initech/j/X1/"), posting("fake-fine-x", "Hooli X", "https://apply.workable.com/hoolix/j/A/")];
  await D.discover();
  assert.strictEqual(screens.filter((x) => /Initech/.test(x)).length, 1, "one more try");
  assert.strictEqual(getJob("fake-flaky").status, "skipped");
  failIf = null;
});

test("when the AI itself is down (every screening fails), no posting uses up a try (plan step 9)", async () => {
  status = 400;
  for (let i = 0; i < D.SCREEN_TRIES + 1; i++) { results = [posting("fake-outage", "Globex", "https://apply.workable.com/globex/j/O1/")]; await D.discover(); }
  assert.strictEqual(getJob("fake-outage"), undefined, "still waiting to be screened");
  status = 200; screens = [];
  await D.discover();
  assert.strictEqual(getJob("fake-outage").status, "queued", "screened once the AI is back");
});

test("the same employer on its own site and on its application system is one posting; another domain with its name is not (plan step 6)", async () => {
  const { siteInfo, sameSite } = await import("../core/dedupe.js");
  assert.deepStrictEqual(siteInfo("https://boards.greenhouse.io/acme/jobs/1"), { site: "boards.greenhouse.io/acme", tenant: "acme", own: "" });
  assert.strictEqual(siteInfo("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1").tenant, "acme");
  assert.strictEqual(siteInfo("https://careers-acme.icims.com/jobs/1").tenant, "acme");
  assert.strictEqual(siteInfo("https://careers.acme.co.uk/jobs/1").own, "acme");
  assert.ok(sameSite({ url: "https://boards.greenhouse.io/acme/jobs/1" }, { url: "https://www.acme.com/careers/1" }));
  assert.ok(!sameSite({ url: "https://www.acme.com/careers/1" }, { url: "https://acme.io/careers/1" }), "two own domains never stand in for each other");
  assert.ok(!sameSite({ url: "https://boards.greenhouse.io/acme/jobs/1" }, { url: "https://lookalike.invalid/jobs/1" }));
  status = 200; screens = [];
  results = [posting("fake-own", "Umbrella", "https://www.umbrella.com/careers/swe-1"), posting("fake-gh", "Umbrella", "https://boards.greenhouse.io/umbrella/jobs/77"),
    posting("fake-io", "Umbrella", "https://umbrella.io/jobs/swe")];
  await D.discover();
  assert.ok(getJob("fake-own"), "the employer's own posting");
  assert.strictEqual(getJob("fake-gh"), undefined, "its copy on Greenhouse is the same job");
  assert.ok(getJob("fake-io"), "umbrella.io is another site");
});
