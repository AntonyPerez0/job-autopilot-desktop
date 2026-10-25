// Temporary probe: which ways of keeping the browser out of sight still allow screenshots on macOS.
import { execSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { pathToFileURL } from "node:url";
process.env.JA_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ja-probe-"));
const { acquireBrowser, newAppPage, windowState } = await import("../../core/browser.js");
const front = () => { try { return execSync('lsappinfo info -only bundleid "$(lsappinfo front)"').toString().trim(); } catch (e) { return "?"; } };
execSync("open -a TextEdit"); await new Promise((r) => setTimeout(r, 2000));
console.log("front before:", front());
const b = await acquireBrowser({ windowMode: "minimized" });
await new Promise((r) => setTimeout(r, 1500));
console.log("front after launch+refocus:", front());
const page = await newAppPage(b, "minimized");
await new Promise((r) => setTimeout(r, 1000));
console.log("front after new tab:", front(), "state", await windowState(page));
await page.goto(pathToFileURL(path.join(import.meta.dirname, "..", "fixtures", "form.html")).href);
const s = await page.context().newCDPSession(page);
const { windowId } = await s.send("Browser.getWindowForTarget");
const shot = async (tag) => { try { const t = Date.now(); const buf = await page.screenshot({ timeout: 8000 }); console.log(tag, "screenshot OK", buf.length, Date.now() - t, "ms"); } catch (e) { console.log(tag, "screenshot FAILED", e.message.split("\n")[0]); } };
await shot("minimized:");
for (const [tag, bounds] of [["offscreen right", { left: 20000, top: 200, width: 1280, height: 800 }], ["offscreen left", { left: -20000, top: 200, width: 1280, height: 800 }], ["offscreen below", { left: 0, top: 20000, width: 1280, height: 800 }]]) {
  await s.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
  await s.send("Browser.setWindowBounds", { windowId, bounds });
  await new Promise((r) => setTimeout(r, 500));
  console.log(tag, "bounds now", JSON.stringify((await s.send("Browser.getWindowBounds", { windowId })).bounds), "front", front());
  await shot(tag + ":");
}
await s.send("Browser.setWindowBounds", { windowId, bounds: { left: 50, top: 50, width: 1280, height: 800 } });
execSync("open -a TextEdit"); await new Promise((r) => setTimeout(r, 1500));
console.log("behind TextEdit, front:", front());
await shot("behind other app:");
console.log("screen:", execSync("system_profiler SPDisplaysDataType | grep Resolution || true").toString().trim());
await b.ctx.close();
