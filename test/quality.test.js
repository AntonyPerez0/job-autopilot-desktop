// Postings that aren't an employer hiring, found without the AI: scams (a fee to pay, interviews over chat apps,
// resumes to a personal address, one opening in many cities from a company with almost no jobs), and recruiters or
// staffing companies hiring for someone else, from the posting and what freehire knows about the company.
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { companyInfo, schemeReason } = await import("../core/quality.js");

const job = (description, extra = {}) => ({ title: "Customer Service Representative", company: "Globex", location: "Austin, TX", description, ...extra });

test("an ordinary posting passes, and saying there's no fee is not asking for one", () => {
  assert.strictEqual(schemeReason(job("Answer calls and help customers. Benefits include training. Apply on our site.")), "");
  assert.strictEqual(schemeReason(job("There is no application fee. We never charge a training fee to candidates.")), "");
});

test("the signs of a scam", () => {
  assert.match(schemeReason(job("New hires pay a $99 training fee, refunded after 90 days.")), /asks applicants to pay/);
  assert.match(schemeReason(job("You'll buy equipment with a check we send: deposit the check we mail you.")), /asks applicants to pay/);
  assert.match(schemeReason(job("Interviews are conducted on Telegram with our hiring manager.")), /WhatsApp, Telegram or text chat/);
  assert.match(schemeReason(job("Text us on WhatsApp to schedule your screening.")), /WhatsApp, Telegram or text chat/);
  assert.match(schemeReason(job("Send your resume to globex.hiring@gmail.com today.")), /personal email/);
  assert.strictEqual(schemeReason(job("Our team uses Telegram bots for alerts.")), "", "a chat app named for another reason");
});

test("recruiters and staffing companies, from the posting or the company", () => {
  assert.match(schemeReason(job("We are hiring on behalf of our client, a leading bank.")), /recruiter posted it/);
  assert.match(schemeReason(job("Answer calls."), { industries: ["staffing-and-recruiting"] }), /recruiting or staffing company/);
  assert.match(schemeReason(job("Answer calls."), { industries: [], tagline: "Offshore recruiting for US startups" }), /recruiting or staffing company/);
  assert.strictEqual(schemeReason(job("Answer calls."), { industries: ["retail"], tagline: "Groceries since 1950" }), "");
});

test("pay by the month in dollars, and one opening in many places from a company with almost no jobs", () => {
  assert.match(schemeReason(job("Remote role.", { salary: "USD 1,500-2,000/month", countries: ["us"] })), /pays by the month/);
  const many = { location: "Phoenix, AZ; Denver, CO; Salt Lake City, UT; Portland, OR; United States" };
  assert.match(schemeReason(job("Entry-level QA tester.", many), { open_jobs: 3 }), /posted in 5 places by a company with only 3 jobs/);
  assert.strictEqual(schemeReason(job("Entry-level QA tester.", many), { open_jobs: 400 }), "", "a big employer hiring in many cities");
});

test("freehire's page on a company is asked once a week, and a failed lookup is no answer", async () => {
  let calls = 0;
  const ask = async (name, args) => { calls++; assert.strictEqual(name, "get_company"); return { industries: ["software"], tagline: "We make apps", open_jobs: 12, slug: args.slug }; };
  const a = await companyInfo("globex", ask);
  assert.deepStrictEqual(a, { industries: ["software"], tagline: "We make apps", open_jobs: 12 });
  await companyInfo("globex", ask);
  assert.strictEqual(calls, 1, "kept for a week");
  assert.strictEqual(await companyInfo("initech", async () => { throw new Error("down"); }), null);
  assert.strictEqual(await companyInfo("", ask), null);
});
