// What the app takes from freehire (with a mock of its server): every application system the app can fill,
// postings like the ones applied to, the evidence that a posting isn't real, the requirement check without AI,
// and replies from employers read from the mailbox.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { approvedExample, exampleAnswers, tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const vault = new Map();
store.setSecretStore({ get: (k) => vault.get(k) || "", set: (k, v) => vault.set(k, v) });
const { Profile } = await import("../core/engine.js");
const { openDb, getDb, getJob } = await import("../core/db.js");
openDb();
const F = await import("../core/sources/freehire.js");
const R = await import("../core/requirements.js");
const M = await import("../core/mail.js");
const D = await import("../core/discover.js");
const W = await import("../core/worker.js");
const { SOURCES } = await import("../core/sources/index.js");

// freehire.me, mocked: what each tool was asked, and what it answers.
const asked = [];
let answer = () => ({});
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, opts) => {
  if (!/freehire\.me/.test(String(u))) return realFetch(u, opts);
  const p = JSON.parse(opts.body).params;
  asked.push({ tool: p.name, args: p.arguments });
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: answer(p.name, p.arguments) } }), { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });

// The AI, mocked: every screen says apply, and is counted.
let screens = 0;
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    screens++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ decision: "apply", reason: "fits", level: "entry" }) } }] }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
test.after(() => ai.close());
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" } });
store.saveAnswers(exampleAnswers()); store.saveProfile(approvedExample(Profile));

const fhJob = (slug, over = {}) => ({ slug, title: "Software Engineer", company: "Acme Health", location: "Remote", work_mode: "remote", countries: ["US"], source: "greenhouse",
  url: `https://freehire.me/jobs/${slug}`, official_job_url: `https://boards.greenhouse.io/acmehealth/jobs/${slug.replace(/\D/g, "") || 1}`, posted_at: new Date().toISOString(), ...over });

test("freehire is asked for every application system the app fills, and Workday only with site accounts", async () => {
  assert.ok(F.BOARDS.length >= 25, `${F.BOARDS.length} systems`);
  for (const b of ["greenhouse", "paycom", "paylocity", "careerplug", "hireology", "bamboohr", "isolvedhire"]) assert.ok(F.BOARDS.includes(b), b);
  assert.ok(!F.BOARDS.includes("isolved"), "freehire's own name for it");
  assert.ok(!F.boardsFor().includes("workday"));
  store.saveSettings({ siteAccounts: { enabled: true, consent: true, email: "jordan.lee@example.com" } }); vault.set("sitePassword", "Secret-pass-1");
  assert.ok(F.boardsFor().includes("workday"), "Workday too once the app may make accounts there");
  store.saveSettings({ siteAccounts: { enabled: false } }); vault.delete("sitePassword");
  asked.length = 0;
  answer = (tool) => (tool === "search_jobs" ? { jobs: [] } : {});
  await F.search({ titles: ["Cashier"], cities: [], remote: true, remoteCountry: "US", postedWithinDays: 14 });
  assert.deepStrictEqual(asked[0].args.sources, F.BOARDS);
  assert.deepStrictEqual(D.searches({ titles: ["Cashier"], remote: true, remoteCountry: "US", cities: [] })[0].sources, F.BOARDS);
});

test("more like this: postings like the ones applied to, through the same filters", async () => {
  asked.length = 0;
  answer = (tool) => (tool === "similar_jobs" ? { jobs: [fhJob("fh-like-1", { title: "Backend Engineer" })] } : { jobs: [] });
  const seeds = [...Array(8)].map((_, i) => ({ slug: `fh-seed-${i}`, title: "Software Engineer", company: `Co ${i}` }));
  const out = await F.search({ titles: ["Software Engineer"], cities: [], remote: true, remoteCountry: "US" }, { seeds });
  const sims = asked.filter((x) => x.tool === "similar_jobs");
  assert.strictEqual(sims.length, F.SIMILAR_PER_CYCLE, "a few seeds per search, the rest on the next ones");
  assert.deepStrictEqual(sims[0].args, { slug: "fh-seed-0", limit: 20 });
  assert.strictEqual(out[0].similarTo, "Software Engineer at Co 0");
  const next = asked.length;
  await F.search({ titles: ["Software Engineer"], cities: [], remote: true, remoteCountry: "US" }, { seeds });
  assert.strictEqual(asked.slice(next).find((x) => x.tool === "similar_jobs").args.slug, "fh-seed-5", "the next seeds take their turn");
  // Seeds: freehire postings applied to (or a filled one the person checked), never another board's.
  const db = getDb();
  const ins = (slug, status, board, reviewed = 0) => db.prepare("INSERT INTO jobs (slug, title, company, status, reviewed, applied_at, details) VALUES (?, 'Software Engineer', 'Initech', ?, ?, datetime('now'), ?)").run(slug, status, reviewed, JSON.stringify({ board }));
  ins("seed-a", "applied", "freehire"); ins("seed-b", "applied", "hiringcafe"); ins("seed-c", "filled", "freehire", 1); ins("seed-d", "queued", "freehire");
  assert.deepStrictEqual(D.similarSeeds(db).map((x) => x.slug).sort(), ["seed-a", "seed-c"]);
  db.prepare("DELETE FROM jobs").run();
});

test("whether a posting is real: freehire's evidence in plain words", () => {
  const r = F.realness({ reality: "likely-evergreen", fake_freshness: true, ghost_level: "likely", ghost_criteria: ["evergreen_posting", "ats_absent"], first_seen_at: "2026-06-01T12:00:00Z", last_seen_at: "2026-10-30T12:00:00Z" });
  assert.strictEqual(r.level, "likely");
  assert.match(r.notes.join(" "), /always-open posting/);
  assert.match(r.notes.join(" "), /posted date was refreshed: freehire has seen this posting since Jun 1, 2026/);
  assert.match(r.notes.join(" "), /Likely not being filled: it's reposted again and again, and it's gone from the employer's own job board\./);
  assert.match(r.notes.join(" "), /Last confirmed open on the employer's site Oct 30, 2026/);
  assert.strictEqual(F.realness({}), null, "nothing observed, nothing said");
});

test("requirements, checked without the AI: what counts, what's left to the form, and what skips a job", () => {
  const p = approvedExample(Profile), a = exampleAnswers();
  const have = R.resumeText(p, a);
  const c = (text, priority = "required", ans = a) => R.checkLine({ text, priority }, have, ans);
  assert.strictEqual(c("Current CNA certification").status, "missing");
  assert.ok(c("Current CNA certification").hard, "a required certificate they don't list");
  assert.ok(!c("Works alongside CNAs and RNs").hard, "a plural mention isn't a requirement");
  assert.ok(!c("Demonstrate competency in all required CNA skills and training").hard, "skills, not the certificate");
  assert.ok(c("Must hold a current CNA Certification and a current BLS Certification").hard);
  assert.strictEqual(c("CPR certification within 30 days of hire").status, "later");
  assert.ok(!c("CNA certification", "preferred").hard, "preferred never skips");
  assert.strictEqual(c("Bachelor's degree in Computer Science").status, "met");
  assert.ok(!c("Master's degree or equivalent experience").hard, "or equivalent: the AI judges");
  assert.ok(c("Master's degree in Nursing").hard);
  assert.strictEqual(c("Valid driver's license").status, "form", "not answered: the form asks");
  assert.ok(c("Valid driver's license", "required", { ...a, driversLicense: "no" }).hard);
  assert.strictEqual(c("Must be 21 years or older", "required", { ...a, over21: "yes" }).status, "met");
  assert.strictEqual(c("Class A CDL required").status, "missing");
  assert.strictEqual(R.checkLine({ text: "Class B CDL required", priority: "required" }, R.resumeText({ ...p, skills: [...p.skills, { id: "l", label: "Licenses", items: "Class A CDL", approved: true }] }, a), a).status, "met", "a Class A holder drives B");
  assert.strictEqual(c("Experience with Python and PostgreSQL").status, "met");
  assert.strictEqual(c("3+ years with Excel and QuickBooks").status, "missing", "named tools, not years of any work");
  assert.strictEqual(c("Ability to work well with others").status, "unchecked");
  assert.strictEqual(c("Must pass a background check").status, "form");
  // The lines: freehire's list (a "preferred" in the text wins over its label), else the description's own.
  assert.deepStrictEqual(R.requirementLines({ requirements: [{ text: "At least one year of driving experience preferred", priority: "required" }, { text: "Previous cannabis experience not required", priority: "required" }] }),
    [{ text: "At least one year of driving experience preferred", priority: "preferred" }]);
  const lines = R.requirementLines({ description: "About the job\nWe care for people.\n\nRequirements:\n- Current CNA certification\n- Must be able to lift 50 lbs\n\nNice to have:\n- Spanish\n\nBenefits\n- Dental" });
  assert.deepStrictEqual(lines.map((x) => `${x.priority}: ${x.text}`), ["required: Current CNA certification", "required: Must be able to lift 50 lbs", "preferred: Spanish"]);
  const all = R.checkRequirements({ description: "Requirements:\n- Current CNA certification\n- High school diploma or GED" }, p, a);
  assert.deepStrictEqual([all.met, all.checked], [1, 2]);
  assert.deepStrictEqual(all.gaps, ["a CNA certification, and your resume doesn't list one"]);
});

test("discovery: a must-have they lack skips the job with no AI call; the check and the evidence are kept", async () => {
  store.savePrefs({ titles: ["Software Engineer", "Nursing Assistant"], remote: true, remoteCountry: "US", cities: [], boards: { fake: true }, postedWithinDays: 30, seniority: ["junior", "middle"] });
  SOURCES.fake = { id: "fake", name: "Fake board", search: async () => [
    { ...F.normalize(fhJob("fh-cna-1", { title: "Nursing Assistant", company: "Mercy Care", official_job_url: "https://boards.greenhouse.io/mercy/jobs/1" })), details: async () => ({ description: "", requirements: [{ text: "Current CNA certification", priority: "required" }], kind: "auto", url: "https://boards.greenhouse.io/mercy/jobs/1" }) },
    { ...F.normalize(fhJob("fh-swe-1")), details: async () => ({ description: "Build things.", requirements: [{ text: "Experience with Python", priority: "required" }, { text: "Kubernetes", priority: "preferred" }], kind: "auto", url: "https://boards.greenhouse.io/acmehealth/jobs/1",
      real: F.realness({ reality: "fresh", first_seen_at: new Date().toISOString() }) }) },
    { ...F.normalize(fhJob("fh-ghost-1", { company: "Hooli", official_job_url: "https://boards.greenhouse.io/hooli/jobs/1" })), details: async () => ({ ghost: true, real: F.realness({ ghost_level: "likely", ghost_criteria: ["silent_applications"] }), description: "", kind: "auto", url: "https://boards.greenhouse.io/hooli/jobs/1" }) },
  ] };
  screens = 0;
  await D.discover();
  delete SOURCES.fake;
  const cna = getJob("fh-cna-1");
  assert.strictEqual(cna.status, "skipped");
  assert.strictEqual(cna.reason, "the posting requires a CNA certification, and your resume doesn't list one (checked without the AI)");
  assert.strictEqual(screens, 1, "only the software job went to the AI");
  const swe = JSON.parse(getJob("fh-swe-1").details);
  assert.deepStrictEqual([swe.check.met, swe.check.checked], [1, 2]);
  assert.strictEqual(swe.check.items[1].priority, "preferred");
  assert.match(swe.real.notes[0], /Looks like a live opening/);
  assert.match(getJob("fh-ghost-1").reason, /likely not being filled \(people who applied there heard nothing back\)/);
});

test("replies from employers: sorted by their own words", () => {
  const k = (subject, text) => M.classifyReply(subject, text);
  assert.strictEqual(k("Your application to Acme Health", "Thank you for your interest. Unfortunately, we have decided to move forward with other candidates."), "rejection");
  assert.strictEqual(k("Next steps", "We'd love to set up a time to talk. Please share your availability for a 30 minute phone screen."), "interview");
  assert.strictEqual(k("Thanks for applying", "We received your application. If your experience matches what we need, we will reach out to schedule an interview."), "received", "a maybe isn't an invitation");
  assert.strictEqual(k("Assessment", "Please complete the following assessment on HireVue within 3 days."), "assessment");
  assert.strictEqual(k("Offer", "We are pleased to extend an offer of employment."), "offer");
  assert.strictEqual(k("Quick question", "Please provide two references."), "info");
  assert.strictEqual(k("After your interview", "Thank you for interviewing with us. Unfortunately we will not be moving forward."), "rejection", "a no that mentions the interview is still a no");
  assert.strictEqual(M.replySnippet("Hi Jordan,\nCan you talk Tuesday?\n\nOn Mon, Oct 3, 2026 at 9:00 AM Acme wrote:\n> Thanks for applying"), "Hi Jordan, Can you talk Tuesday?");
});

const signed = (d) => `Authentication-Results: mx.example.com; dkim=pass header.d=${d}; spf=pass\r\nFrom: x@${d}\r\nSubject: s`;
const applied = [{ slug: "a1", company: "Acme Health", title: "Software Engineer", url: "https://boards.greenhouse.io/acmehealth/jobs/1", apply_url: "", applied_at: "2026-10-20T10:00:00Z" },
  { slug: "a2", company: "Acme Health", title: "Data Analyst", url: "https://boards.greenhouse.io/acmehealth/jobs/2", apply_url: "", applied_at: "2026-10-25T10:00:00Z" },
  { slug: "b1", company: "Initech", title: "Cashier", url: "https://recruiting.paylocity.com/Recruiting/Jobs/Details/9", apply_url: "", applied_at: "2026-10-22T10:00:00Z" }];
const reply = (over) => ({ from: "Acme Health Recruiting <no-reply@greenhouse.io>", headers: signed("greenhouse.io"), subject: "Your application", text: "Thanks for applying to Acme Health.", date: "2026-11-01T10:00:00Z", ...over });

test("replies from employers: matched to the application they answer, only when the employer really sent them", () => {
  assert.strictEqual(M.replyJob(reply({ text: "Hi! About the Data Analyst role at Acme Health: can you talk Tuesday?" }), applied).slug, "a2", "the role it names");
  assert.strictEqual(M.replyJob(reply({}), applied).slug, "a2", "else the latest application there");
  assert.strictEqual(M.replyJob(reply({ from: "Jane <jane@acmehealth.com>", headers: signed("acmehealth.com"), text: "Software Engineer interview at Acme Health" }), applied).slug, "a1", "the employer's own domain");
  assert.strictEqual(M.replyJob(reply({ from: "Paylocity <no-reply@paylocity.com>", headers: signed("paylocity.com"), text: "Initech received your application" }), applied).slug, "b1");
  assert.strictEqual(M.replyJob(reply({ headers: "Authentication-Results: mx.example.com; dkim=fail header.d=greenhouse.io" }), applied), null, "not signed: never counted");
  assert.strictEqual(M.replyJob(reply({ from: "Acme <hr@acme-careers.test>", headers: signed("acme-careers.test") }), applied), null, "a look-alike domain");
  assert.strictEqual(M.replyJob(reply({ from: "Globex Recruiting <no-reply@greenhouse.io>", text: "Thanks for applying to Globex." }), applied), null, "it names another employer");
  assert.strictEqual(M.replyJob(reply({ date: "2026-10-01T10:00:00Z" }), applied), null, "older than the application");
  assert.ok(M.maybeEmployer("x <a@greenhouse.io>", applied) && M.maybeEmployer("x <a@acmehealth.com>", applied) && !M.maybeEmployer("x <a@newsletter.test>", applied));
});

test("replies from employers: read at most hourly, kept on this computer, shown on the job", async () => {
  const { handle } = await import("../core/api.js");
  const db = getDb();
  db.prepare("DELETE FROM jobs").run();
  for (const j of applied) db.prepare("INSERT INTO jobs (slug, title, company, url, status, applied_at) VALUES (?, ?, ?, ?, 'applied', ?)").run(j.slug, j.title, j.company, j.url, new Date(Date.now() - 5 * 86400000).toISOString());
  assert.strictEqual(await W.checkReplies({ force: true }), null, "no mailbox, nothing read");
  store.saveSettings({ mailbox: { host: "imap.example.com", port: 993, user: "jordan.lee@example.com" } }); vault.set("mailPassword", "app-password");
  const now = new Date().toISOString();
  let reads = 0, since = null;
  const read = async (_cfg, s, keep) => { reads++; since = s; return [
    reply({ id: "<m1@greenhouse.io>", text: "Data Analyst at Acme Health: please share your availability for a phone screen.", date: now }),
    reply({ id: "<m2@greenhouse.io>", text: "Thanks for applying to Acme Health. We received your application.", date: now }),
    reply({ id: "<m3@spam.test>", from: "Acme <x@spam.test>", headers: signed("spam.test"), date: now }),
  ].filter((m) => keep(m)); };
  assert.strictEqual(await W.checkReplies({ force: true, read }), 1, "the interview; the receipt isn't kept; the stranger never matched");
  assert.ok(Date.now() - since.getTime() >= 5 * 86400000, "read from before the first application");
  assert.strictEqual(await W.checkReplies({ read }), null, "not again within the hour");
  assert.strictEqual(await W.checkReplies({ force: true, read }), 0, "the same email isn't added twice");
  assert.strictEqual(reads, 2);
  const st = await handle("/api/status");
  assert.deepStrictEqual([st.replies.unseen, st.replies.act, st.replies.first.kind, st.replies.first.company], [1, 1, "interview", "Acme Health"]);
  const list = await handle("/api/jobs?status=applied");
  assert.strictEqual(list.find((j) => j.slug === "a2").reply, "interview");
  const job = await handle("/api/job/a2");
  assert.strictEqual(job.replies[0].kind, "interview");
  assert.match(job.replies[0].snippet, /phone screen/);
  assert.strictEqual((await handle("/api/status")).replies.unseen, 0, "opened: seen");
});
