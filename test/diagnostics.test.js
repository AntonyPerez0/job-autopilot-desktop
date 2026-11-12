// The diagnostics report: for each stopped application, what the form asked (with its choices) and why the app
// couldn't answer; personal details left out unless the person includes them.
import test from "node:test";
import assert from "node:assert";
import { approvedExample, exampleAnswers, tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
store.setSecretStore({ get: (k) => (k === "apiKey" ? "sk-or-secret-key" : ""), set: () => {} });
const { Profile } = await import("../core/engine.js");
const { getDb, openDb, log } = await import("../core/db.js");
openDb();
const { diagnostics, redactor } = await import("../core/diagnostics.js");

store.saveAnswers({ ...exampleAnswers(), zip: "78701", yourAnswers: [{ key: "notice", label: "Notice period?", value: "Ten days, after my lease ends", scope: "all", company: "Initech" }] });
store.saveProfile(approvedExample(Profile));
store.saveSettings({ ai: { provider: "openrouter", apiBase: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash" }, mailbox: { host: "imap.gmail.com", user: "jordan.lee@example.com", preset: "gmail" } });
getDb().prepare("INSERT INTO jobs (slug, title, company, url, apply_url, source, status, reason, details, attempts) VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, ?, 1)").run(
  "cs-1", "Software Engineer", "Concept Solutions", "https://recruiting.paylocity.com/Recruiting/Jobs/Details/1", "https://recruiting.paylocity.com/Recruiting/Jobs/Apply/1", "paylocity",
  "could not fill every required field: required, no answer: Country",
  JSON.stringify({ fields: [{ label: "Country", type: "select", required: true, options: ["Select...", "United States of America", "Canada"] }, { label: "Email", type: "email", required: true }],
    kit: [{ label: "Email", value: "jordan.lee@example.com", kind: "text", note: "from your answers" }, { label: "Country", value: "", kind: "decide", note: "no option matched United States" }],
    report: { decide: [{ label: "Country", note: "no option matched United States" }], missing: [] } }));
log("cs-1", "applying for Jordan Lee (jordan.lee@example.com, +1 (512) 555-0142)");

test("each stopped application: the question, the form's choices, why it stopped, and how the rest were answered", () => {
  const r = diagnostics({ app: { version: "1.2.3" } });
  assert.strictEqual(r.format, "job-autopilot/diagnostics@1");
  const [a] = r.stopped;
  assert.deepStrictEqual(a.waitingOn, [{ question: "Country", why: "no option matched United States", choices: ["United States of America", "Canada"], kind: "choice" }]);
  assert.strictEqual(a.site, "recruiting.paylocity.com");
  assert.deepStrictEqual(a.fields[0].choices, ["Select...", "United States of America", "Canada"]);
  assert.deepStrictEqual(a.answers.map((x) => [x.question, x.how, x.value]), [["Email", "text", "[given]"], ["Country", "decide", ""]], "how each was answered, not what");
  assert.strictEqual(r.now.counts.failed, 1);
  assert.strictEqual(r.settings.ai.keySaved, true);
});

test("personal details are left out unless the person includes them, and no secret is ever in it", () => {
  const out = JSON.stringify(diagnostics({}));
  for (const x of ["jordan.lee@example.com", "Jordan Lee", "555-0142", "5125550142", "78701", "100 Example St", "after my lease ends", "sk-or-secret-key", "linkedin.com/in/jordanlee-example"]) assert.ok(!out.includes(x), `left out: ${x}`);
  assert.match(out, /applying for \[name\] \(\[email\], \[phone\]\)/);
  const r = diagnostics({});
  assert.deepStrictEqual([r.aboutYou.email, r.aboutYou.workAuthorized, r.aboutYou.needsSponsorship, r.aboutYou.zip, r.aboutYou.country], ["set", "set", "set", "set", "United States"], "what they said about themselves: only that it's answered");
  // However the phone number is written, and what the app's notes quote of their answers.
  const red = redactor({ phone: "+1 (512) 555-0142" });
  for (const p of ["512-555-0142", "512.555.0142", "(512) 555 0142", "+1 512 555 0142", "15125550142"]) assert.ok(!/555/.test(red(`call ${p} today`)), p);
  assert.strictEqual(red("order 5125550142999"), "order 5125550142999", "a longer number is not the phone");
  log("cs-1", 'truth check: work authorization: "No" corrected to "Yes" on "Are you legally authorized to work in the US?"');
  log("cs-1", 'truth check: your answer "42 Oak Lane" isn\'t one of the choices for "Where do you live?", so it wasn\'t used there');
  const act = diagnostics({}).activity.map((e) => e.message).join("\n");
  assert.match(act, /work authorization: corrected on "Are you legally authorized to work in the US\?"/);
  assert.ok(!/42 Oak Lane|corrected to "Yes"/.test(act), "the question stays, the answer goes");
  assert.match(diagnostics({ personal: true }).activity.map((e) => e.message).join("\n"), /42 Oak Lane/);
  assert.deepStrictEqual(r.aboutYou.yourAnswers, [{ question: "Notice period?", scope: "every application", company: "Initech" }]);
  assert.strictEqual(r.resume.approvedSummaries, r.resume.summaries);
  assert.deepStrictEqual(r.settings.mailbox, { connected: false, server: "imap.gmail.com", preset: "gmail" });
  const mine = JSON.stringify(diagnostics({ personal: true }));
  assert.ok(mine.includes("jordan.lee@example.com") && mine.includes("after my lease ends"), "included when asked for");
  assert.ok(!mine.includes("sk-or-secret-key"), "the key never");
  assert.strictEqual(redactor({ firstName: "Al" })("Al Smith"), "Al Smith", "too short to replace safely");
});
