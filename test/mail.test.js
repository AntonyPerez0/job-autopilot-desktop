// Mail parsing (the parts that need no mailbox): security codes and confirmation emails.
import test from "node:test";
import assert from "node:assert";
import { CODE_SUBJECT, CONFIRM, findCode, htmlToText, matchConfirmation, roleCore, PRESETS } from "../core/mail.js";

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
