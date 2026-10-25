// Ported from the add-on's test/run_fill.py and run_shadow.py: load content.js
// into real Chromium on the mock forms, scrape, fill from a kit, check what
// landed, and that nothing was submitted. All values are the example person's.
// Set CHROMIUM_PATH to use a system Chromium.
import test from "node:test";
import assert from "node:assert";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { chromium } from "playwright-core";
import { CONTENT_JS } from "../core/engine.js";
import { SHIM } from "../core/apply.js";

const FIX = path.join(import.meta.dirname, "fixtures");
let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true }); });
test.after(async () => { if (browser) await browser.close(); });

async function open(file) {
  const page = await browser.newPage();
  await page.addInitScript(SHIM);
  await page.goto(pathToFileURL(path.join(FIX, file)).href);
  await page.evaluate(CONTENT_JS);
  return page;
}
const send = (page, msg) => page.evaluate((m) => window.__apSend(m), msg);
const T = "text";
const resume = (name) => ({ name, b64: Buffer.from("%PDF-1.4 test").toString("base64") });

test("form.html: scrape and fill a Greenhouse-style form", async () => {
  const page = await open("form.html");
  const scraped = await send(page, { type: "scrape" });
  assert.ok(scraped.fields.length >= 15, `found ${scraped.fields.length} fields`);
  const kit = { header: {}, fields: [
    ["Resume/CV *", "Lee_Globex_SoftwareEngineer.pdf", "file", ""],
    ["GPA (optional)", "", "decide", "not on record"],
    ["Are you currently eligible to work in the United States? *", "Yes, I am currently eligible to work in the country where this role is based.", T, ""],
    ["Will you require visa sponsorship now or in the future? *", "No, I do not require visa sponsorship now or in the future to continue working in the country where this role is based.", T, ""],
    ["When are you available to start full-time? *", "Q4 2026 (October - December)", T, ""],
    ["First location preference *", "", "decide", "pick the closest office"],
    ["Why do you want to work here?", "I build scheduling APIs today and want to work on payments next.", "draft", ""],
    ["LinkedIn Profile, Github, Personal Website, or Portfolio", "https://jordanlee.example.com", T, ""],
    ["First name", "Jordan", T, ""], ["Last name", "Lee", T, ""],
    ["Email", "jordan.lee@example.com", T, ""], ["Phone", "+1 (512) 555-0142", T, ""],
    ["Website", "https://jordanlee.example.com", T, ""], ["Location", "Austin, TX", T, ""],
    ["Country", "United States", T, ""],
    ["Current or most recent employer", "Acme Health", T, ""],
    ["Current or most recent job title", "Software Engineer", T, ""],
  ].map(([label, value, kind, note]) => ({ label, value, kind, note, file: kind === "file" ? value : undefined })) };
  const rep = await send(page, { type: "fill", kit, resume: resume("Lee_Globex_SoftwareEngineer.pdf") });
  const v = (sel) => page.$eval(sel, (e) => e.value);
  assert.strictEqual(await v("#first_name"), "Jordan");
  assert.strictEqual(await v("#last_name"), "Lee");
  assert.strictEqual(await v("#email"), "jordan.lee@example.com");
  assert.strictEqual(await v("#phone"), "+1 (512) 555-0142");
  assert.strictEqual(await page.$eval("#resume", (e) => e.files[0] && e.files[0].name), "Lee_Globex_SoftwareEngineer.pdf");
  assert.strictEqual(await page.$eval("#cover", (e) => e.files.length), 0, "cover letter untouched");
  assert.strictEqual(await v("#linkedin"), "https://jordanlee.example.com");
  assert.strictEqual(await v("#gpa"), "", "decide stays blank");
  assert.strictEqual(await v("#elig"), "1");
  assert.strictEqual(await page.$eval("input[name=spons][value=n]", (e) => e.checked), true);
  assert.strictEqual(await v("#start"), "Q4 2026 (October - December)");
  assert.strictEqual(await v("#why"), "I build scheduling APIs today and want to work on payments next.");
  assert.deepStrictEqual(rep.drafts.map((x) => x.label), ["Why do you want to work here?"]);
  assert.strictEqual(await v("#first_loc"), "");
  assert.strictEqual(await v("#employer"), "Acme Health");
  assert.strictEqual(await v("#jobtitle"), "Software Engineer");
  assert.strictEqual(await v("#country"), "United States");
  assert.strictEqual(await v("#loc-value"), "Austin, Texas, United States", "type-to-search location");
  assert.strictEqual(await page.$eval("#consent", (e) => e.checked), false, "consent never ticked without an answer");
  assert.strictEqual(await page.evaluate(() => !!window.SUBMITTED), false, "never submitted");
  assert.ok(rep.missing.some((x) => /favorite Globex API/.test(x.label)), "unanswered custom question reported");
  assert.ok(rep.decide.some((x) => /certify/.test(x.label)), "consent reported for the user");
  await page.close();
});

test("shadow.html: web components, slots, custom radios", async () => {
  const page = await open("shadow.html");
  const scraped = await send(page, { type: "scrape" });
  assert.strictEqual(scraped.fields.length, 21);
  assert.deepStrictEqual(scraped.fields.filter((f) => f.label.startsWith("A. Within")).map((f) => f.options), [["Yes", "No"]]);
  assert.deepStrictEqual(scraped.fields.filter((f) => f.label.startsWith("Expected Graduation")).map((f) => f.options).pop(), ["2025", "2026", "2027", "2028"]);
  assert.deepStrictEqual(scraped.fields.filter((f) => f.label.trim().replace(/\*/g, "") === "").map((f) => f.label), []);
  assert.ok(scraped.fields.some((f) => f.label.startsWith("What school do you currently attend")));
  assert.ok(scraped.fields.some((f) => f.type === "radio" && f.label.startsWith("Are you legally authorized")));
  const kit = { header: {}, fields: [
    ["Choose a file or drop it here 10MB size limit", "Lee_Initech.pdf", "file"],
    ["First name*", "Jordan", T], ["Last name*", "Lee", T], ["Email*", "jordan.lee@example.com", T],
    ["Confirm your email*", "jordan.lee@example.com", T], ["City*", "Austin, TX", T],
    ["Phone number*", "+1 (512) 555-0142", T], ["LinkedIn", "https://www.linkedin.com/in/jordanlee-example", T],
    ['What school do you currently attend or most recently attended? If unlisted, please select "Other" *', "University of Texas at Austin", T],
    ["Are you legally authorized to work in the country in which you are applying for a role? *", "Yes", T],
    ["Do you now, or will you in the future, require visa sponsorship to work for Initech in the country of hire? *", "No", T],
    ["Have you ever worked at Initech in any capacity?*", "No", T],
    ["A. Within the past 5 years, have you ever been an employee of the U.S. Federal Government? *", "No", T],
    ["Are you a protected veteran?", "Prefer not to say", "suggest"],
    ["Expected Graduation Date? *", "May 2026", T],
    ["Gender", "Prefer not to say", "suggest"],
    ["Today's date *", "10/23/2026", T],
    ["You declare that you have read and understand the privacy notice of Initech. *", "Yes", T],
  ].map(([label, value, kind]) => ({ label, value, kind, note: "", file: kind === "file" ? value : undefined })) };
  await send(page, { type: "fill", kit, resume: resume("Lee_Initech.pdf") });
  const hosts = Object.fromEntries(await page.evaluate(() => [...document.querySelectorAll("x-field")].map((h) => [h.getAttribute("label"), h.getAttribute("data-value")])));
  const attr = (sel, a) => page.evaluate(([s, x]) => document.querySelector(s) && document.querySelector(s).getAttribute(x), [sel, a]);
  const q = (tag, n) => page.evaluate(([t, i]) => document.querySelectorAll(t)[i].getAttribute("data-value"), [tag, n]);
  assert.strictEqual(hosts["First name"], "Jordan");
  assert.strictEqual(hosts["Last name"], "Lee");
  assert.strictEqual(hosts["Email"], "jordan.lee@example.com");
  assert.strictEqual(hosts["Confirm your email"], "jordan.lee@example.com");
  assert.strictEqual(hosts["City"], "Austin, TX");
  assert.strictEqual(await attr("x-phone", "data-value"), "+1 (512) 555-0142");
  assert.strictEqual(await attr("x-upload", "data-file"), "Lee_Initech.pdf");
  const nested = await page.evaluate(() => [...document.querySelector("x-section").shadowRoot.querySelectorAll("x-field")].map((h) => h.getAttribute("data-value")));
  assert.strictEqual(nested[0], "https://www.linkedin.com/in/jordanlee-example");
  assert.strictEqual(nested[1], null, "Facebook left empty");
  assert.strictEqual(await q("x-q", 0), "University of Texas at Austin");
  assert.strictEqual(await q("x-yesno", 0), "yes");
  assert.strictEqual(await q("x-yesno", 1), "no");
  assert.strictEqual(await q("x-pick", 0), "n");
  assert.strictEqual(await attr("x-rgroup", "data-value"), "no");
  assert.strictEqual(await q("x-rgroup", 1), "p", "veteran declines");
  assert.strictEqual(await attr("#grad", "data-value"), "2026");
  assert.strictEqual(await attr("#gender", "data-value"), "I don't wish to answer");
  assert.strictEqual(await q("x-q", 1), "10/23/2026");
  assert.strictEqual(await attr("x-check", "data-value"), "true", "privacy declaration ticked");
  assert.strictEqual(await page.evaluate(() => document.querySelector("x-consent").shadowRoot.getElementById("mk").checked), false, "marketing box untouched");
  assert.strictEqual(await page.evaluate(() => !!window.SUBMITTED), false);
  await page.close();
});

test("gate: required empty fields and unanswered button groups are caught; the right submit button is chosen", async () => {
  const { CHECK_JS, GROUPS_JS, SUBMIT_JS, answerGroups } = await import("../core/apply.js");
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.join(FIX, "gate.html")).href);
  assert.deepStrictEqual(await page.evaluate(CHECK_JS), ["City *"]);
  const groups = await page.evaluate(GROUPS_JS);
  assert.deepStrictEqual(groups.filter((g) => g.required).map((g) => g.label), ["Do you now or in the future require sponsorship? *"]);
  const left = await answerGroups(page, [{ label: "Do you now or in the future require sponsorship? *", value: "No", kind: "text" }]);
  assert.deepStrictEqual(left, []);
  assert.strictEqual(await page.evaluate(() => document.querySelectorAll(".yesno")[0].children[1].getAttribute("aria-pressed")), "true");
  assert.deepStrictEqual((await page.evaluate(GROUPS_JS)).filter((g) => g.required), [], "answered group no longer blocks");
  assert.strictEqual(await page.evaluate(SUBMIT_JS), "submit application", "the form's button, not the header's Apply");
  assert.strictEqual(await page.evaluate(() => !!window.SUBMITTED), false);
  await page.close();
});
