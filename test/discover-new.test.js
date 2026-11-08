// What a search does with the newer choices: kinds of work left out before the AI reads them, recruiters and scams
// left out without the AI, a wait for a referral where the person knows someone, companies they chose read however
// old the opening, near misses on years when they chose to apply to those, and a search that stops early so the
// person can finish an application.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { approvedExample, exampleAnswers, tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile } = await import("../core/engine.js");
const { openDb, getDb, getJob, sqlTime } = await import("../core/db.js");
const { SOURCES } = await import("../core/sources/index.js");
const D = await import("../core/discover.js");
const R = await import("../core/referrals.js");
openDb();

let screened = [], prompts = [];
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const msgs = JSON.parse(b).messages;
    prompts.push(msgs.find((m) => m.role === "system").content);
    screened.push((msgs.find((m) => m.role === "user").content.match(/POSTING: .+? at (.+?) \(/) || [])[1]);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: "apply", reason: "fits", level: "mid" }) } }] }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
test.after(() => ai.close());
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" } });
store.saveAnswers(exampleAnswers()); store.saveProfile(approvedExample(Profile));
const PREFS = { titles: ["Support Engineer"], remote: true, remoteCountry: "US", cities: [], boards: { fake: true, freehire: false, hiringcafe: false }, postedWithinDays: 14,
  excludeAgencies: true, seniority: ["junior", "middle"], maxYearsRequired: 5, referralHoldDays: 3, stretchYears: 0, notForMeKinds: [], keepKinds: [], watch: [] };
store.savePrefs(PREFS);

let results = [];
SOURCES.fake = { id: "fake", name: "Fake board", search: async () => results };
let n = 0;
const posting = (title, extra = {}) => ({ slug: `p${++n}`, title, company: `Company ${n}`, location: "Remote", work_mode: "remote", countries: ["US"],
  url: `https://apply.workable.com/c${n}/j/${n}/`, apply_url: `https://apply.workable.com/c${n}/j/${n}/`, ats: "workable", kind: "auto", board: "fake",
  posted_at: new Date().toISOString(), level: "", minYears: null, sponsorship: null, description: "Help customers with our product.", ...extra });
const run = async (list, prefs = {}, ctx = {}) => { results = list; screened = []; prompts = []; store.savePrefs({ ...PREFS, ...prefs }); await D.discover(() => {}, ctx); };

test("a kind of work they left out is skipped before the AI reads it", async () => {
  const a = posting("Support Engineer", { category: "healthcare" }), b = posting("Support Engineer", { category: "support" });
  await run([a, b], { notForMeKinds: ["healthcare"] });
  assert.strictEqual(getJob(a.slug).status, "skipped");
  assert.match(getJob(a.slug).reason, /not the kind of work you're looking for \(Healthcare\)/);
  assert.deepStrictEqual(screened, [b.company], "only the other one is screened");
  assert.strictEqual(JSON.parse(getJob(b.slug).details).category, "support", "its kind is kept");
});

test("scams and recruiters are left out without the AI, with the agencies setting", async () => {
  const fee = posting("Support Engineer", { description: "Pay a $60 training fee before you start." });
  const agency = posting("Support Engineer", { company_slug: "talent-co" });
  await run([fee, agency], {}, { call: async () => ({ industries: ["staffing-and-recruiting"], tagline: "", open_jobs: 900 }) });
  assert.match(getJob(fee.slug).reason, /^not an employer hiring: it asks applicants to pay/);
  assert.match(getJob(agency.slug).reason, /^not an employer hiring: .* is a recruiting or staffing company/);
  assert.deepStrictEqual(screened, []);
  const allowed = posting("Support Engineer", { description: "Pay a $60 training fee before you start." });
  await run([allowed], { excludeAgencies: false });
  assert.strictEqual(getJob(allowed.slug).status, "queued", "their choice");
});

test("where they know someone, the job waits so they can ask for a referral", async () => {
  R.saveConnections([{ first: "Sam", last: "Rivera", url: "", company: "Globex, Inc.", position: "Manager" }, { first: "Kim", last: "Park", url: "", company: "Initech", position: "Engineer" }]);
  const known = posting("Support Engineer", { company: "Globex" }), other = posting("Support Engineer");
  await run([known, other]);
  const held = getJob(known.slug).hold_until;
  assert.ok(held > sqlTime(Date.now() + 2.9 * 86400000) && held < sqlTime(Date.now() + 3.1 * 86400000), held);
  assert.strictEqual(getJob(other.slug).hold_until, null);
  const later = posting("Support Engineer", { company: "Initech" });
  await run([later], { referralHoldDays: 0 });
  assert.strictEqual(getJob(later.slug).hold_until, null, "they chose not to wait");
  R.clearConnections();
});

test("an opening at a company they chose counts however long it's been up", async () => {
  const old = new Date(Date.now() - 90 * 86400000).toISOString();
  const watched = posting("Support Engineer", { board: "watchlist", posted_at: old }), stale = posting("Support Engineer", { posted_at: old });
  await run([watched, stale]);
  assert.strictEqual(getJob(watched.slug).status, "queued");
  assert.strictEqual(getJob(stale.slug), undefined, "too old elsewhere");
});

test("near misses on years: the screening is told, only when they chose it", async () => {
  await run([posting("Support Engineer")], { stretchYears: 1 });
  assert.match(prompts[0], /at most 1 year short of it/);
  await run([posting("Support Engineer")], { stretchYears: 0 });
  assert.doesNotMatch(prompts[0], /year short of it/);
});

test("someone waiting to finish an application: the search stops and reads nothing more", async () => {
  const a = posting("Support Engineer");
  const ctx = { yieldTo: () => true };
  await run([a], {}, ctx);
  assert.strictEqual(ctx.stoppedEarly, true);
  assert.strictEqual(getJob(a.slug), undefined);
  let left = 1;
  const b = posting("Support Engineer"), c = posting("Support Engineer");
  const ctx2 = { yieldTo: () => left-- <= 0 && screened.length > 0 };
  await run([b, c], {}, ctx2);
  assert.strictEqual(ctx2.stoppedEarly, true);
  assert.strictEqual(screened.length, 1, "stopped between postings");
  assert.strictEqual(getDb().prepare("SELECT COUNT(*) n FROM jobs WHERE slug IN (?, ?)").get(b.slug, c.slug).n, 1);
});
