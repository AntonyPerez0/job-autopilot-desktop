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
const { acquireBrowser, newAppPage, closeAppPage, windowState, showBrowser, closeBrowser, tucked } = await import("../../core/browser.js");
const { execSync } = await import("node:child_process");
// On macOS, put another app in front first: the browser must not take focus from it.
const front = () => { try { return execSync('lsappinfo info -only bundleid "$(lsappinfo front)"').toString().trim(); } catch { return ""; } };
if (process.platform === "darwin") { execSync("open -a TextEdit"); await new Promise((r) => setTimeout(r, 2000)); }
const { CONTENT_JS } = await import("../../core/engine.js");
const { SHIM } = await import("../../core/apply.js");

const t0 = Date.now();
const b = await acquireBrowser({ windowMode: "minimized", choice: process.env.JA_BROWSER || "auto" });
console.log(`launched ${b.channel} in ${Date.now() - t0} ms; out of the way: ${await tucked(b.ctx.pages()[0])}`);
const stillFront = async (when) => {
  if (process.platform !== "darwin") return;
  await new Promise((r) => setTimeout(r, 800));
  assert.match(front(), /TextEdit/, `TextEdit keeps focus ${when}`);
};
await stillFront("after the browser starts");
for (let job = 1; job <= 2; job++) {
  const page = await newAppPage(b, "minimized");
  assert.ok(await tucked(page), `job ${job}: out of the way after a new tab`);
  await stillFront(`after job ${job}'s new tab`);
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
  assert.ok(await tucked(page), `job ${job}: still out of the way after filling and the screenshot`);
  await stillFront(`after job ${job}'s screenshot`);
  if (job === 1) {
    assert.ok(await showBrowser(true));
    assert.strictEqual(await windowState(page), "normal", "Show the browser brings it up");
    assert.ok(!(await tucked(page)), "and on screen");
    assert.ok(await showBrowser(false));
    assert.ok(await tucked(page), "Minimize puts it away again");
    if (process.platform === "darwin") { execSync("open -a TextEdit"); await new Promise((r) => setTimeout(r, 1500)); }
  }
  await closeAppPage(page, "minimized");
  await stillFront(`after job ${job}'s tab closes`);
}
assert.ok(b.ctx.pages().length >= 1, "the window survives between applications");
await closeBrowser();
console.log("MINIMIZED PASS");
