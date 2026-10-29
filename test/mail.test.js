// Mail parsing (the parts that need no mailbox): security codes and confirmation emails.
import test from "node:test";
import assert from "node:assert";
import { CODE_SUBJECT, CONFIRM, findCode, htmlToText, matchConfirmation, roleCore, PRESETS } from "../core/mail.js";
import * as M from "../core/mail.js";

test("Greenhouse security code", () => {
  const body = htmlToText(`<p>Hi Jordan,</p><p>Copy and paste this code into the security code field on your application: <b>Ab3dE9xQ</b></p><p>Thanks</p>`);
  assert.strictEqual(findCode(body), "Ab3dE9xQ");
  assert.ok(CODE_SUBJECT.test("Security code for your application to Globex"));
});

test("generic verification code; plain words and years are not codes", () => {
  assert.strictEqual(findCode("Your verification code: 482913\nIt expires in 10 minutes."), "482913");
  assert.strictEqual(findCode("Welcome to the team\nSincerely\n2026"), null);
});

test("confirmation emails", () => {
  assert.ok(CONFIRM.test("Thank you for applying to Globex"));
  assert.ok(CONFIRM.test("We've received your application"));
  assert.ok(!CONFIRM.test("Your weekly newsletter"));
  assert.deepStrictEqual(roleCore("Backend Engineer, New Grad - Globex (Remote)", "Globex"), ["backend", "engineer", "grad"]);
  const hits = [{ date: "2026-10-01T10:00:00Z", subject: "Thank you for applying to Globex", text: "We received your application for Backend Engineer, New Grad." }];
  assert.match(matchConfirmation(hits, "Globex", "Backend Engineer, New Grad"), /Thank you/);
  assert.strictEqual(matchConfirmation([{ ...hits[0], text: "for Data Scientist" }, { ...hits[0], text: "for Product Designer" }], "Globex", "Backend Engineer"), null);
  assert.match(matchConfirmation([{ ...hits[0], text: "We will be in touch." }], "Globex", "Backend Engineer"), /names no role/);
});

test("presets cover the four big providers, with steps", () => {
  for (const k of ["gmail", "yahoo", "outlook", "icloud"]) assert.ok(PRESETS[k].steps.length >= 2, k);
  assert.ok(PRESETS.outlook.unsupported, "Outlook.com no longer allows app passwords for IMAP");
});

test("the confirmation link in a Workday sign-up email", async () => {
  const { findLink } = await import("../core/mail.js");
  const html = `<p>Welcome</p><a href="https://globex.wd5.myworkdayjobs.com/en-US/careers/activate/abc123?x=1&amp;y=2">Verify Account</a>
    <a href="https://www.myworkday.com/privacy">Privacy</a><a href="https://globex.wd5.myworkdayjobs.com/unsubscribe">Unsubscribe</a>`;
  assert.strictEqual(findLink(html, "", "globex.wd5.myworkdayjobs.com"), "https://globex.wd5.myworkdayjobs.com/en-US/careers/activate/abc123?x=1&y=2");
  assert.strictEqual(findLink("", "Confirm here: https://acme.example.com/confirm?t=9 thanks", ""), "https://acme.example.com/confirm?t=9");
  assert.strictEqual(findLink("<a href='https://acme.example.com/terms'>Terms</a>", "", ""), null);
});

// Security audit 2.8 and 2.9: whose email the app believes.
const AR = (d, pass = true) => `Authentication-Results: mx.google.com;\r\n       dkim=${pass ? "pass" : "fail"} header.i=@${d} header.s=s1;\r\n       spf=pass smtp.mailfrom=${d}\r\nFrom: x\r\nSubject: y`;
test("a code is taken only from Greenhouse, DKIM-signed, by arrival time; a newer code from anyone else is ignored", () => {
  const since = 1_800_000_000;
  const gh = { from: "no-reply@us.greenhouse-mail.io", headers: AR("us.greenhouse-mail.io"), internalDate: new Date((since + 30) * 1000), subject: "Security code for your application to Globex",
    text: "Copy and paste this code into the security code field on your application: AbC12345" };
  const other = { from: "codes@unrelated-site.test", headers: AR("unrelated-site.test"), internalDate: new Date((since + 90) * 1000), subject: "Your verification code", text: "Your verification code: ZZZ99999" };
  assert.strictEqual(M.pickCode([other, gh], since), "AbC12345", "the employer's, not the newer one");
  assert.strictEqual(M.pickCode([other], since), null);
  assert.strictEqual(M.pickCode([{ ...gh, headers: AR("us.greenhouse-mail.io", false) }], since), null, "DKIM must pass");
  assert.strictEqual(M.pickCode([{ ...gh, headers: AR("evil.test") + "\r\n" + AR("greenhouse.io") }], since), null, "only the provider's own, topmost verdict counts");
  assert.strictEqual(M.pickCode([{ ...gh, internalDate: new Date((since - 3600) * 1000) }], since), null, "arrived before the submit, by the server's clock");
});

test("a confirmation link is opened only from the site that asked, pointing to that site", () => {
  const since = 1_800_000_000, at = new Date((since + 20) * 1000);
  const wd = { from: "globex@myworkday.com", internalDate: at, subject: "Verify your account", html: '<a href="https://globex.wd5.myworkdayjobs.com/verify?u=x">Verify</a>', plain: "" };
  assert.strictEqual(M.pickLink([wd], since, "globex.wd5.myworkdayjobs.com"), "https://globex.wd5.myworkdayjobs.com/verify?u=x");
  const evil = { from: "accounts@unrelated-site.test", internalDate: at, subject: "Confirm your account", html: '<a href="https://unrelated-site.test/confirm">Confirm</a>', plain: "" };
  assert.strictEqual(M.pickLink([evil], since, "globex.wd5.myworkdayjobs.com"), null, "unrelated-site.test is not opened");
  const spoof = { ...wd, html: '<a href="https://unrelated-site.test/verify">Verify</a>' };
  assert.strictEqual(M.pickLink([spoof], since, "globex.wd5.myworkdayjobs.com"), null, "from Workday, but pointing elsewhere");
  assert.strictEqual(M.siteOf("jobs.acme.co.uk"), "acme.co.uk");
});

test("a 'thank you for applying' email counts only from the job's own system, signed, naming the employer in full (audit 4.7)", () => {
  const ok = { from: "no-reply@us.greenhouse-mail.io", headers: AR("us.greenhouse-mail.io"), subject: "Thank you for applying to Acme Health" };
  const job = { company: "Acme Health", url: "https://job-boards.greenhouse.io/acmehealth/jobs/1" };
  assert.ok(M.confirmationOk(ok, job));
  assert.ok(!M.confirmationOk({ ...ok, from: "jobs@acme-careers.test", headers: AR("acme-careers.test") }, job), "another sender");
  assert.ok(!M.confirmationOk({ ...ok, headers: AR("us.greenhouse-mail.io", false) }, job), "no DKIM pass");
  assert.ok(!M.confirmationOk({ ...ok, subject: "Thank you for applying to Acme" }, job), "only the first word of the company");
  assert.ok(!M.confirmationOk(ok, { company: "Acme Health", url: "https://jobs.lever.co/acmehealth/1" }), "Greenhouse mail for a Lever job");
  const own = { company: "Pollo Regio", url: "https://careers.polloregio.com/jobs/9" };
  assert.ok(M.confirmationOk({ from: "hr@polloregio.com", headers: AR("polloregio.com"), subject: "Pollo Regio: we received your application" }, own), "the employer's own site");
});
