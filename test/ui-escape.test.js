// Text from a resume or a job board can't become markup or script in the app's window (security audit 2.11, 2.12).
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const UI = path.resolve(import.meta.dirname, "..", "ui");
let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true }); });
test.after(async () => { if (browser) await browser.close(); });

const EVIL_ID = 'acme" autofocus onfocus="window.PWNED=1" x="';

test("Fill out my page: a job id with a quote stays inside the Records input's attributes (audit 2.11)", async () => {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><body><div id="host"></div></body>`);
  await page.evaluate((id) => {
    window.ja = { api: async (p) => p === "/api/resume/fill/questions"
      ? { prompts: { jobs: "j", certs: "c", records: "r", volunteer: "v", school: "s", ai: "a" }, jobs: [{ id, title: "Software Engineer", org: "Acme" }], certs: [], schools: [], numbers: [] } : {} };
  }, EVIL_ID);
  await page.addScriptTag({ content: fs.readFileSync(path.join(UI, "forms.js"), "utf8") });
  await page.evaluate(() => window.Forms.fillPage(document.getElementById("host"), { profile: { experience: [] }, prefs: {} }, () => {}));
  await page.waitForSelector("[name=f_rec_0]");
  // name, value and placeholder, plus the label link the app's accessibility pass adds (aria-labelledby)
  const attrs = await page.$$eval("input[name^=f_rec_]", (els) => els.map((e) => [...e.attributes].map((a) => a.name).filter((n) => !/^aria-(labelledby|describedby)$/.test(n)).sort()));
  assert.deepStrictEqual(attrs, [["name", "placeholder", "value"]], "only its own attributes");
  await page.focus("[name=f_rec_0]");
  assert.strictEqual(await page.evaluate(() => window.PWNED), undefined, "no handler ran");
  assert.strictEqual(await page.$$eval("[onfocus]", (els) => els.length), 0);
  await page.close();
});

test("no inline event handler carries a value: jobs, links, pages and tabs go through data- attributes (audit 2.12)", () => {
  for (const f of ["index.html", "forms.js", "onboarding.html"]) {
    const src = fs.readFileSync(path.join(UI, f), "utf8");
    const bad = src.match(/\son[a-z]+="[^"]*\$\{[^"]*"/g) || [];
    assert.deepStrictEqual(bad, [], `${f}: ${bad.slice(0, 3).join(" | ")}`);
  }
  const index = fs.readFileSync(path.join(UI, "index.html"), "utf8");
  assert.match(index, /data-open-job="\$\{esc\(j\.slug\)\}"/);
  assert.match(index, /closest\("\[data-open-job\], \[data-open-url\], \[data-go\], \[data-tab\]"\)/);
});
