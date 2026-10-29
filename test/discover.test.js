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

let status = 200, screens = [];
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const user = JSON.parse(b).messages.find((m) => m.role === "user").content;
    screens.push((user.match(/POSTING: (.+)/) || [])[1]);
    res.writeHead(status, { "content-type": "application/json" });
    res.end(status === 200 ? JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: "apply", reason: "fits", level: "mid" }) } }] }) : JSON.stringify({ error: { message: "bad request" } }));
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
  results = [posting("fake-lookalike", "Acme Staffing Partners", "https://lookalike.invalid/jobs/1"), posting("fake-acme", "Acme", "https://apply.workable.com/acme/j/ABC123/")];
  await D.discover();
  assert.ok(getJob("fake-lookalike"), "the look-alike is stored");
  assert.ok(getJob("fake-acme"), "and the employer's own posting too: not pushed out");
  assert.strictEqual(screens.length, 2, "each screened separately");
  assert.strictEqual(siteKey("https://apply.workable.com/acme/j/ABC123/"), "apply.workable.com/acme");
  assert.strictEqual(siteKey("https://boards.greenhouse.io/embed/job_app?for=acme"), "boards.greenhouse.io", "no tenant in the path: the host alone");
  const rows = [{ slug: "x", company: "Acme", title: "Software Engineer", url: "https://lookalike.invalid/jobs/9", status: "applied" }];
  assert.strictEqual(sameRoleAs({ slug: "y", company: "Acme", title: "Software Engineer", url: "https://apply.workable.com/acme/j/1" }, rows), null, "applied elsewhere doesn't count here");
  assert.ok(sameRoleAs({ slug: "y", company: "Acme", title: "Software Engineer", url: "https://lookalike.invalid/jobs/2" }, rows), "the same site does");
});

test("a posting whose screening fails is tried a few times, then kept as skipped and never screened again (audit 4.5)", async () => {
  status = 400;
  results = [posting("fake-flaky", "Initech", "https://apply.workable.com/initech/j/X1/")];
  for (let i = 1; i <= D.SCREEN_TRIES; i++) {
    screens = [];
    await D.discover();
    assert.strictEqual(screens.length, 1, `search ${i}: screened once`);
    assert.strictEqual(!!getJob("fake-flaky"), i === D.SCREEN_TRIES, `search ${i}: stored only after the last try`);
  }
  assert.strictEqual(getJob("fake-flaky").status, "skipped");
  assert.match(getJob("fake-flaky").reason, /screen failed 3 times/);
  screens = [];
  await D.discover();
  assert.strictEqual(screens.length, 0, "not screened again");
  status = 200;
});
