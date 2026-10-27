// Reading a stopped question's choices from the real page: a native list, a custom list that opens
// on click, and a button that opens a list (Workday style). Nothing is chosen.
import test from "node:test";
import assert from "node:assert";
import { chromium } from "playwright-core";
import { choicesOn } from "../core/apply.js";

let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true }); });
test.after(async () => { if (browser) await browser.close(); });

const PAGE = `<!doctype html><body>
<label for="s">How did you hear about us?</label><select id="s"><option value="">Select...</option><option>LinkedIn</option><option>Job board</option></select>
<label id="cl">Work authorization status *</label>
<input role="combobox" aria-labelledby="cl" aria-controls="lb" aria-expanded="false" onclick="document.getElementById('lb').hidden=false">
<ul id="lb" role="listbox" hidden><li role="option">U.S. citizen</li><li role="option">Permanent resident</li></ul>
<button aria-haspopup="listbox" onclick="document.getElementById('wd').hidden=false">Preferred shift</button>
<div id="wd" hidden><div data-automation-id="promptOption">Days</div><div data-automation-id="promptOption">Nights</div></div>
<script>document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { lb.hidden = true; wd.hidden = true; } });</script>
</body>`;

test("the form's own choices, read without picking one", async () => {
  const page = await browser.newPage();
  await page.setContent(PAGE);
  assert.deepStrictEqual(await choicesOn(page, "How did you hear about us?"), ["LinkedIn", "Job board"]);
  assert.deepStrictEqual(await choicesOn(page, "Work authorization status *"), ["U.S. citizen", "Permanent resident"]);
  assert.deepStrictEqual(await choicesOn(page, "Preferred shift"), ["Days", "Nights"]);
  assert.strictEqual(await page.inputValue("#s"), "", "nothing chosen");
  assert.strictEqual(await page.isHidden("#lb"), true, "the list is closed again");
  assert.deepStrictEqual(await choicesOn(page, "A question that isn't there"), []);
  await page.close();
});
