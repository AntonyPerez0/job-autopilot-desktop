// Job sources and links: where a link leads, what each source's results become,
// which jobs the app applies to and which go to "Apply yourself".
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { examplePrefs, tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { classify, classifyNamed } = await import("../core/ats.js");
const hc = await import("../core/sources/hiringcafe.js");
const sim = await import("../core/sources/simplify.js");
const g = await import("../core/sources/google.js");
const { locationOk, manualReason } = await import("../core/discover.js");
const { jobPostingFrom, addJob } = await import("../core/addjob.js");
const { openDb, getJob } = await import("../core/db.js");
openDb();

test("where a link leads", () => {
  assert.strictEqual(classify("https://job-boards.greenhouse.io/embed/job_app?for=x&token=1").kind, "auto");
  assert.strictEqual(classify("https://acme.careerplug.com/jobs/1/apps/new").kind, "auto");
  assert.strictEqual(classify("https://www.paycomonline.net/v4/ats/web.php/jobs/ViewJobDetails?job=1").kind, "auto");
  assert.strictEqual(classify("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/x").kind, "account");
  assert.strictEqual(classify("https://careers-acme.icims.com/jobs/1/job").kind, "account");
  assert.strictEqual(classify("https://olivia.paradox.ai/co/Acme/Job?job_id=1").kind, "chat");
  assert.strictEqual(classify("https://www.indeed.com/viewjob?jk=1").kind, "board");
  assert.strictEqual(classify("https://careers.acme-grocery.com/job/1").kind, "unknown");
  assert.strictEqual(classifyNamed("paradox", "https://careers.acme.com/x").kind, "chat", "HiringCafe's own name for the system counts");
  assert.match(manualReason({ kind: "account", url: "https://acme.wd5.myworkdayjobs.com/x" }), /acme\.wd5\.myworkdayjobs\.com makes you create an account/);
  assert.strictEqual(manualReason({ kind: "unknown", url: "https://x.com" }), null);
});

const HIT = {
  id: "careerplug___acme___1", requisition_id: "abc123", source: "careerplug", is_expired: false,
  apply_url: "https://acme.careerplug.com/jobs/1/apps/new", _geoloc: [{ lat: 30.5, lon: -97.82 }],
  job_information: { title: "Cashier" },
  v5_processed_job_data: { company_name: "Acme Hardware", formatted_workplace_location: "Cedar Park, Texas, United States", workplace_type: "Onsite",
    seniority_level: "No Prior Experience Required", requirements_summary: "Friendly, can lift 25 pounds.", listed_compensation_frequency: "Hourly",
    hourly_min_compensation: 14, hourly_max_compensation: 16, listed_compensation_currency: "USD", estimated_publish_date_millis: Date.now() - 86400000,
    commitment: ["Part Time"], min_industry_and_role_yoe: null, workplace_countries: ["US"] },
};

test("HiringCafe results", () => {
  const j = hc.normalize(HIT);
  assert.strictEqual(j.slug, "hc-abc123");
  assert.strictEqual(j.title, "Cashier");
  assert.strictEqual(j.company, "Acme Hardware");
  assert.strictEqual(j.kind, "auto");
  assert.strictEqual(j.level, "junior");
  assert.strictEqual(j.salary, "$14-$16/hour");
  assert.match(j.description, /lift 25 pounds/);
  const prefs = examplePrefs();
  assert.ok(locationOk(j, prefs), "Cedar Park is inside 25 miles of Austin, by its coordinates");
  assert.ok(!locationOk({ ...j, geo: [{ lat: 32.78, lon: -96.8 }] }, prefs), "Dallas is not");
  const url = decodeURIComponent(hc.searchUrl("Cashier", { id: "x", options: { radius: 25 } }, prefs));
  assert.match(url, /"searchQuery":"Cashier"/);
  assert.match(url, /"dateFetchedPastNDays":14/);
  assert.strictEqual(hc.levelOf("Senior Level"), "senior");
});

test("Simplify list entries", () => {
  const j = sim.normalize({ id: "11111111-2222-3333-4444-555555555555", t: "Software Engineer, New Grad", c: "Globex", l: ["Austin, TX", "Remote in USA"],
    u: "https://jobs.lever.co/globex/1", p: Math.floor(Date.now() / 1000), s: "Does Not Offer Sponsorship" }, "newgrad");
  assert.strictEqual(j.slug, "simplify-11111111-2222-3333-4444-555555555555");
  assert.strictEqual(j.kind, "auto");
  assert.strictEqual(j.sponsorship, false);
  assert.strictEqual(j.level, "junior");
});

test("Google Jobs: the employer's own form is preferred over job boards", () => {
  const j = g.normalize({ title: "Barista", company_name: "Bean Co", location: "Austin, TX", description: "Make coffee.", via: "Indeed",
    apply_options: [{ title: "Indeed", link: "https://www.indeed.com/viewjob?jk=1" }, { title: "Bean Co", link: "https://beanco.applytojob.com/apply/abc" }],
    detected_extensions: { schedule_type: "Part-time" } });
  assert.strictEqual(j.apply_url, "https://beanco.applytojob.com/apply/abc");
  assert.strictEqual(j.kind, "auto");
  const only = g.normalize({ title: "Barista", company_name: "Bean Co", apply_options: [{ title: "Indeed", link: "https://www.indeed.com/viewjob?jk=1" }] });
  assert.strictEqual(only.kind, "board", "only a job board: the user applies there");
});

test("job details from a page's JobPosting data", () => {
  const html = `<html><head><title>x</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Line Cook",
    "hiringOrganization":{"@type":"Organization","name":"Taco Place"},"jobLocation":{"@type":"Place","address":{"addressLocality":"Round Rock","addressRegion":"TX"}},
    "description":"<p>Cook &amp; prep.</p>","datePosted":"2026-10-20"}</script></head></html>`;
  assert.deepStrictEqual(jobPostingFrom(html), { title: "Line Cook", company: "Taco Place", location: "Round Rock, TX", work_mode: "", description: "Cook & prep.", posted_at: "2026-10-20" });
});

test("adding a job by its link", async () => {
  const page = `<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Line Cook","hiringOrganization":{"name":"Taco Place"},"description":"Cook."}</script></head><body><form><input name="a"></form></body></html>`;
  const s = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(page); });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${s.address().port}/jobs/1`;
    const r = await addJob(url);
    assert.strictEqual(r.status, "queued");
    const j = getJob(r.slug);
    assert.strictEqual(j.title, "Line Cook");
    assert.strictEqual(j.company, "Taco Place");
    assert.ok(JSON.parse(j.details).addedByUser);
    const again = await addJob(url);
    assert.ok(again.again, "adding it twice only queues it again");
    const wd = await addJob("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Austin/Cashier_1");
    assert.strictEqual(wd.status, "manual", "an account site goes straight to Apply yourself");
    await assert.rejects(addJob("https://www.google.com/search?q=jobs+near+me"), /Google search page/);
    await assert.rejects(addJob("not a link"), /web address/);
  } finally { s.close(); }
});

test("a job title from the link itself, for pages built by JavaScript", async () => {
  const { titleFromPath } = await import("../core/addjob.js");
  assert.strictEqual(titleFromPath(new URL("https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Austin-TX/Cashier---Front-End_R123")), "Cashier - Front End");
  assert.strictEqual(titleFromPath(new URL("https://x.com/jobs/12345")), "");
});

test("HiringCafe pay: the listed period, an hourly wage filed under the wrong period, no $17-$17", () => {
  assert.strictEqual(hc.salaryOf({ listed_compensation_frequency: "Hourly", hourly_min_compensation: 17, hourly_max_compensation: 17 }), "$17/hour");
  assert.strictEqual(hc.salaryOf({ listed_compensation_frequency: "Hourly", hourly_min_compensation: 28, hourly_max_compensation: 30 }), "$28-$30/hour");
  assert.strictEqual(hc.salaryOf({ listed_compensation_frequency: "Weekly", weekly_min_compensation: 20, weekly_max_compensation: 24, yearly_min_compensation: 1040 }), "$20-$24/hour");
  assert.strictEqual(hc.salaryOf({ listed_compensation_frequency: "Weekly", weekly_min_compensation: 1200, weekly_max_compensation: 1500 }), "$1,200-$1,500/week");
  assert.strictEqual(hc.salaryOf({ listed_compensation_frequency: "Yearly", yearly_min_compensation: 72800, yearly_max_compensation: 78000 }), "$72,800-$78,000/year");
  assert.strictEqual(hc.salaryOf({ listed_compensation_frequency: "Hourly", hourly_min_compensation: 23.25, hourly_max_compensation: 23.25 }), "$23.25/hour");
  assert.strictEqual(hc.salaryOf({ listed_compensation_frequency: "Hourly" }), null);
});
