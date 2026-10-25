// The application browser in "minimized" mode on a real desktop (run on the macOS and
// Windows CI runners): it starts minimized, stays minimized as tabs open and forms are
// filled, screenshots still work, and it can be shown and put away again.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

process.env.JA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ja-min-"));
const OUT = path.join(import.meta.dirname, "..", "out", "e2e");
fs.mkdirSync(OUT, { recursive: true });
const { acquireBrowser, newAppPage, windowState, showBrowser, closeBrowser } = await import("../../core/browser.js");
const { CONTENT_JS } = await import("../../core/engine.js");
const { SHIM } = await import("../../core/apply.js");

const t0 = Date.now();
const b = await acquireBrowser({ windowMode: "minimized", choice: process.env.JA_BROWSER || "auto" });
console.log(`launched ${b.channel} in ${Date.now() - t0} ms`);
for (let job = 1; job <= 2; job++) {
  const page = await newAppPage(b, "minimized");
  assert.strictEqual(await windowState(page), "minimized", `job ${job}: minimized after a new tab`);
  await page.addInitScript(SHIM);
  await page.goto(pathToFileURL(path.join(import.meta.dirname, "..", "fixtures", "form.html")).href);
  await page.evaluate(CONTENT_JS);
  const kit = { header: {}, fields: [{ label: "First name", value: "Jordan", kind: "text" }, { label: "Last name", value: "Lee", kind: "text" }, { label: "Email", value: "jordan.lee@example.com", kind: "text" }] };
  await page.evaluate((k) => window.__apSend({ type: "fill", kit: k }), kit);
  assert.strictEqual(await page.$eval("#first_name", (e) => e.value), "Jordan", "filled while minimized");
  const s0 = Date.now();
  const file = path.join(OUT, `minimized-job${job}.jpg`);
  await page.screenshot({ path: file, fullPage: true, type: "jpeg", quality: 60, timeout: 20000 });
  const size = fs.statSync(file).size;
  console.log(`job ${job}: screenshot ${size} bytes in ${Date.now() - s0} ms`);
  assert.ok(size > 15000, "the screenshot has the form in it");
  assert.strictEqual(await windowState(page), "minimized", `job ${job}: still minimized after filling and the screenshot`);
  if (job === 1) {
    assert.ok(await showBrowser(true));
    assert.strictEqual(await windowState(page), "normal", "Show the browser brings it up");
    assert.ok(await showBrowser(false));
    assert.strictEqual(await windowState(page), "minimized");
  }
  if (page.context().pages().length > 1) await page.close(); else await page.goto("about:blank");
}
assert.ok(b.ctx.pages().length >= 1, "the window survives between applications");
await closeBrowser();
console.log("MINIMIZED PASS");
