// Which frames see the person's data (security audit 1.1): only the form's own frames get the kit lines for
// their own fields, the resume only where there's a file input, and page script can't reach the bridge.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { chromium } from "playwright-core";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const A = await import("../core/apply.js");

const records = [];
const TOP = `<!doctype html><html><head><script>
  // The page tries to get there first: define the bridge, and listen on it.
  window.__apListeners = [(m) => { fetch("/record?from=top-listener", { method: "POST", body: JSON.stringify(m) }); }];
  window.__apSend = async (m) => { fetch("/record?from=top-send", { method: "POST", body: JSON.stringify(m) }); };
</script></head><body>
  <label for="fn">First name</label><input id="fn" name="fn">
  <label for="em">Email</label><input id="em" name="em" type="email">
  <label for="ph">Phone</label><input id="ph" name="ph">
  <iframe src="http://localhost:PORT/ad" width="300" height="200"></iframe>
</body></html>`;
const AD = `<!doctype html><html><body>
  <label for="e2">Email</label><input id="e2" name="e2"><input type="file">
  <script>
    // A third-party frame tapping the bridge if it ever appears, and reading any field it can.
    setInterval(() => {
      if (window.__apListeners && !window.__tapped) { window.__tapped = 1; window.__apListeners.push((m) => { fetch("/record?from=ad-listener", { method: "POST", body: JSON.stringify(m) }); }); }
      if (document.getElementById("e2").value) fetch("/record?from=ad-field", { method: "POST", body: document.getElementById("e2").value });
    }, 50);
  </script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/record")) { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { records.push({ from: req.url, body: b }); res.end("ok"); }); return; }
  res.writeHead(200, { "content-type": "text/html" });
  res.end((req.url.startsWith("/ad") ? AD : TOP).replace("PORT", server.address().port));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
test.before(async () => { browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true }); });
test.after(async () => { if (browser) await browser.close(); server.close(); });

const KIT = [
  { label: "First name", kind: "text", value: "Jordan" }, { label: "Email", kind: "text", value: "jordan.lee@example.com" }, { label: "Phone", kind: "text", value: "+1 (512) 555-0142" },
  { label: "Gender", kind: "text", value: "Prefer not to say" }, { label: "Desired salary", kind: "text", value: "120000" }, { label: "Resume", kind: "file", value: "Jordan_Lee_resume.pdf" }];

test("a cross-origin frame and the page's own script get nothing; the form gets only its own fields' answers", async () => {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(500);
  const out = await A.eachFrame(page, { type: "fill", kit: { fields: KIT, header: {} }, resume: { name: "Jordan_Lee_resume.pdf", b64: Buffer.from("%PDF-1.4 test").toString("base64") } });
  await page.waitForTimeout(800);
  assert.deepStrictEqual(records, [], "nothing reached the page's script or the ad frame");
  assert.strictEqual(out.length, 1, "only the top frame answered");
  assert.strictEqual(out[0].frame, page.mainFrame());
  assert.deepStrictEqual(out[0].filled.map((x) => x.label).sort(), ["Email", "First name", "Phone"]);
  assert.strictEqual(await page.inputValue("#fn"), "Jordan");
  const ad = page.frames().find((f) => f !== page.mainFrame());
  assert.strictEqual(await ad.inputValue("#e2"), "", "the ad's Email field stayed empty");
  await page.close();
});

test("a frame's message carries only the kit lines for its own fields, and the resume only with a file input", () => {
  const msg = { type: "fill", kit: { fields: KIT, header: {} }, resume: { name: "r.pdf", b64: "x" } };
  const three = A.frameMessage(msg, [{ label: "First name", type: "text" }, { label: "Email", type: "text" }, { label: "Phone", type: "text" }]);
  assert.deepStrictEqual(three.kit.fields.map((k) => k.value), ["Jordan", "jordan.lee@example.com", "+1 (512) 555-0142"]);
  assert.strictEqual(three.resume, null);
  const file = A.frameMessage(msg, [{ label: "Resume/CV", type: "file" }]);
  assert.deepStrictEqual(file.kit.fields.map((k) => k.label), ["Resume"]);
  assert.ok(file.resume);
  assert.strictEqual(A.frameMessage(msg, [{ label: "Search this site", type: "text" }]), null, "no matching field: nothing at all");
});

test("only the form's own origin or a known ATS embed", () => {
  assert.ok(A.frameAllowed("https://acme.example/jobs/1", "https://acme.example/frame"));
  assert.ok(A.frameAllowed("https://acme.example/jobs/1", "https://boards.greenhouse.io/embed/job_app?for=acme"));
  assert.ok(A.frameAllowed("https://acme.example/jobs/1", "https://job-boards.greenhouse.io./embed"), "trailing dot");
  assert.ok(!A.frameAllowed("https://acme.example/jobs/1", "https://ads.tracker.example/pixel"));
  assert.ok(!A.frameAllowed("https://acme.example/jobs/1", "https://evilgreenhouse.io/embed"), "a lookalike domain");
  assert.ok(!A.frameAllowed("https://acme.example/jobs/1", "about:blank"));
  assert.ok(!A.frameAllowed("https://acme.example/jobs/1", "http://acme.example/frame"), "same host, other scheme: another origin");
});
