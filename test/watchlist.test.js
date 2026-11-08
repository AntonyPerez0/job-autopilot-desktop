// Companies the person would love to work for: their own job boards on Greenhouse, Lever or Ashby, found from a name
// or a link and read directly on every search (no network here: every request is answered by the test).
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const W = await import("../core/sources/watchlist.js");

const BOARDS = {
  "https://boards-api.greenhouse.io/v1/boards/globex/jobs?content=true": { jobs: [{ id: 11, title: "Support Engineer", location: { name: "Remote - US" }, absolute_url: "https://globex.example/jobs/11", first_published: "2026-11-01T10:00:00-05:00", content: "&lt;p&gt;Help &amp;amp; fix&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;" }] },
  "https://boards-api.greenhouse.io/v1/boards/globex": { name: "Globex Corporation" },
  "https://api.lever.co/v0/postings/initech?mode=json": [{ id: "ab-12", text: "QA Analyst", categories: { location: "Austin, TX" }, workplaceType: "onsite", country: "us", hostedUrl: "https://jobs.lever.co/initech/ab-12", applyUrl: "https://jobs.lever.co/initech/ab-12/apply", createdAt: 1762000000000, descriptionPlain: "Test things.", lists: [{ text: "Requirements", content: "<li>2+ years</li>" }] }],
  "https://api.ashbyhq.com/posting-api/job-board/hooli?includeCompensation=true": { jobs: [{ id: "x-9", title: " Data Analyst ", location: "New York", secondaryLocations: [{ location: "Remote - USA" }, { location: "Remote - UK" }], isRemote: true, jobUrl: "https://jobs.ashbyhq.com/hooli/x-9", applyUrl: "https://jobs.ashbyhq.com/hooli/x-9/application", publishedAt: "2026-11-02T00:00:00Z", compensation: { compensationTierSummary: "$90K – $110K" }, descriptionPlain: "Analyze data." }, { id: "x-10", title: "Hidden", isListed: false }] },
};
const get = async (url) => (url in BOARDS ? BOARDS[url] : null);

test("a board from a link: the board, a posting on it, or a careers page that embeds it", () => {
  assert.deepStrictEqual(W.boardFromUrl("https://job-boards.greenhouse.io/globex/jobs/123"), { ats: "greenhouse", token: "globex" });
  assert.deepStrictEqual(W.boardFromUrl("https://boards.greenhouse.io/embed/job_board?for=globex"), { ats: "greenhouse", token: "globex" });
  assert.deepStrictEqual(W.boardFromUrl("https://jobs.lever.co/initech/ab-12"), { ats: "lever", token: "initech" });
  assert.deepStrictEqual(W.boardFromUrl("https://jobs.ashbyhq.com/hooli"), { ats: "ashby", token: "hooli" });
  assert.strictEqual(W.boardFromUrl("https://careers.globex.example/jobs"), null);
  assert.strictEqual(W.boardFromUrl("not a link"), null);
  assert.deepStrictEqual(W.boardInHtml('<script src="https://boards.greenhouse.io/embed/job_board/js?for=globex"></script>'), { ats: "greenhouse", token: "globex" });
  assert.deepStrictEqual(W.boardInHtml('<a href="https://jobs.lever.co/initech">Jobs</a>'), { ats: "lever", token: "initech" });
  assert.strictEqual(W.boardInHtml("<p>No board</p>"), null);
});

test("a name: where freehire saw the company's postings, else the usual board names", async () => {
  const ask = async (name, args) => (name === "search_companies" ? { companies: [{ name: "Globex", slug: "globex-corp" }] }
    : { jobs: args.company_slugs[0] === "globex-corp" ? [{ official_job_url: "https://job-boards.greenhouse.io/globex/jobs/11" }] : [] });
  assert.deepStrictEqual(await W.findBoard("Globex", { get, ask }), { name: "Globex", ats: "greenhouse", token: "globex", jobs: 1 });
  const none = async () => ({ companies: [] });
  assert.deepStrictEqual(await W.findBoard("Hooli, Inc.", { get, ask: none }), { name: "Hooli, Inc.", ats: "ashby", token: "hooli", jobs: 2 });
  assert.strictEqual(await W.findBoard("Nobody Here", { get, ask: none }), null);
});

test("a link: a posting's own board, or the board a careers page shows, named as the board names itself", async () => {
  assert.deepStrictEqual(await W.findBoard("https://job-boards.greenhouse.io/globex/jobs/11", { get }), { name: "Globex Corporation", ats: "greenhouse", token: "globex", jobs: 1 });
  assert.deepStrictEqual(await W.findBoard("https://careers.initech.example/", { get, page: async () => '<a href="https://jobs.lever.co/initech">Open roles</a>' }),
    { name: "Initech", ats: "lever", token: "initech", jobs: 1 });
  assert.strictEqual(await W.findBoard("https://careers.nobody.example/", { get, page: async () => "<p>Email us</p>" }), null);
});

test("each board's postings, in the shape every source gives, at the front of the queue and never too old", async () => {
  const logs = [];
  const watch = [{ name: "Globex", ats: "greenhouse", token: "globex" }, { name: "Initech", ats: "lever", token: "initech" }, { name: "Hooli", ats: "ashby", token: "hooli" }, { name: "Gone", ats: "lever", token: "gone" }];
  const out = await W.search({ watch, remoteCountry: "US" }, { get, log: (m) => logs.push(m) });
  assert.strictEqual(out.length, 3, "unlisted postings are left out");
  const [g, l, a] = out;
  assert.strictEqual(g.board, "watchlist");
  assert.strictEqual(g.slug, "wl-gh-globex-11");
  assert.strictEqual(g.work_mode, "remote");
  assert.strictEqual(g.apply_url, "https://job-boards.greenhouse.io/embed/job_app?for=globex&token=11");
  assert.match(g.description, /Help & fix/);
  assert.match(g.description, /- Python/);
  assert.strictEqual(g.posted_at, "2026-11-01T15:00:00.000Z");
  assert.deepStrictEqual([l.title, l.location, l.countries, l.apply_url], ["QA Analyst", "Austin, TX", ["US"], "https://jobs.lever.co/initech/ab-12/apply"]);
  assert.match(l.description, /Requirements\n- 2\+ years/);
  assert.deepStrictEqual([a.title, a.location, a.work_mode, a.countries, a.salary], ["Data Analyst", "Remote - USA", "remote", ["US"], "$90K – $110K"], "the remote place in their own country");
  assert.ok(logs.some((m) => /Gone's job board on lever is gone/.test(m)));
});

test("prefs keep only boards the app can read, at most 30", async () => {
  const store = await import("../core/store.js");
  const p = store.clampPrefs({ watch: [{ name: "A", ats: "greenhouse", token: "a" }, { name: "B", ats: "workday", token: "b" }, { name: "C", ats: "lever", token: "../x" }, ...[...Array(40)].map((_, i) => ({ name: "N" + i, ats: "ashby", token: "n" + i }))] });
  assert.strictEqual(p.watch.length, 30);
  assert.deepStrictEqual(p.watch[0], { name: "A", ats: "greenhouse", token: "a" });
  assert.ok(!p.watch.some((w) => w.ats === "workday" || w.token === "../x"));
});
