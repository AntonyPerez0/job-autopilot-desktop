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

test("an allowed frame with fields gets the whole kit (in its isolated world); the resume only with a file input; no fields, nothing", () => {
  const msg = { type: "fill", kit: { fields: KIT, header: {} }, resume: { name: "r.pdf", b64: "x" } };
  const three = A.frameMessage(msg, [{ label: "Given name", type: "text" }, { label: "E-mail address", type: "text" }]);
  assert.strictEqual(three.kit.fields.length, KIT.length, "content.js matches the labels itself, as before");
  assert.strictEqual(three.resume, null);
  assert.ok(A.frameMessage(msg, [{ label: "Resume/CV", type: "file" }]).resume);
  assert.strictEqual(A.frameMessage(msg, []), null, "a frame without fields gets nothing");
});

test("only the form's own origin or a known ATS embed", () => {
  assert.ok(A.frameAllowed("https://acme.example/jobs/1", "https://acme.example/frame"));
  assert.ok(A.frameAllowed("https://acme.example/jobs/1", "https://boards.greenhouse.io/embed/job_app?for=acme"));
  assert.ok(A.frameAllowed("https://acme.example/jobs/1", "https://job-boards.greenhouse.io./embed"), "trailing dot");
  assert.ok(!A.frameAllowed("https://acme.example/jobs/1", "https://ads.tracker.example/pixel"));
  assert.ok(!A.frameAllowed("https://acme.example/jobs/1", "https://evilgreenhouse.io/embed"), "a lookalike domain");
  assert.ok(!A.frameAllowed("https://acme.example/jobs/1", "about:blank"));
  assert.ok(!A.frameAllowed("https://acme.example/jobs/1", "http://acme.example/frame"), "same host, other scheme: another origin");
  // every application system the app knows, and the job's own link; never a job board or a government site
  for (const u of ["https://careers-acme.icims.com/jobs/1/apply", "https://acme.jobs.jobvite.com/x", "https://acme.bamboohr.com/careers/1", "https://acme.wd5.myworkdayjobs.com/x", "https://recruiting.paylocity.com/x"])
    assert.ok(A.frameAllowed("https://acme.example/jobs/1", u), u);
  for (const u of ["https://www.indeed.com/viewjob?jk=1", "https://www.governmentjobs.com/careers/x", "http://careers-acme.icims.com/jobs/1"])
    assert.ok(!A.frameAllowed("https://acme.example/jobs/1", u), u);
  assert.ok(A.frameAllowed("https://www.acme.example/careers", "https://apply.acme-hr.example/form", "https://apply.acme-hr.example/job/1"), "the job's own apply link");
});

test("an emailed code goes only into the frame where Submit was pressed, from that form's own system (audit 2.8, plan step 4)", async () => {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.body.insertAdjacentHTML("beforeend", '<label for="sc">Security code</label><input id="sc" name="security_code"><button type="button">Verify</button>'); });
  const ad = page.frames().find((f) => f !== page.mainFrame());
  await ad.evaluate(() => { document.body.insertAdjacentHTML("beforeend", '<input id="adcode" name="code"><button>Submit</button>'); });
  await A.enterCode(page.mainFrame(), "AbC12345");
  assert.strictEqual(await page.inputValue("#sc"), "AbC12345");
  assert.strictEqual(await ad.inputValue("#adcode"), "", "the other frame got nothing");
  assert.deepStrictEqual(A.codeSenders("https://job-boards.greenhouse.io/globex/jobs/1", "https://globex.example/careers/1"), ["greenhouse.io", "greenhouse-mail.io", "globex.example"]);
  assert.deepStrictEqual(A.codeSenders("https://careers-acme.icims.com/jobs/1", ""), ["icims.com"]);
  assert.deepStrictEqual(A.codeSenders("https://greenhouse.io.evil.test/x", ""), ["evil.test"], "a look-alike is only itself");
  await page.close();
});

test("a form embedded from an application system the app knows (iCIMS here) is filled; the tracker beside it still gets nothing (plan step 1)", async () => {
  const page = await browser.newPage();
  const seen = [];
  await page.route("https://careers.acme.example/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><body><h1>Join Acme</h1>
    <iframe src="https://careers-acme.icims.com/jobs/1/apply" width="600" height="300"></iframe><iframe src="https://pixel.tracker.example/p" width="10" height="10"></iframe></body>` }));
  await page.route("https://careers-acme.icims.com/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><body>
    <label for="fn">First name</label><input id="fn"><label for="em">Email</label><input id="em" type="email"></body>` }));
  await page.route("https://pixel.tracker.example/**", (r) => r.fulfill({ contentType: "text/html", body: `<!doctype html><body><label for="e3">Email</label><input id="e3">
    <script>setInterval(() => { if (document.getElementById("e3").value || window.__apListeners) parent.postMessage("leak", "*"); }, 50)</script></body>` }));
  await page.exposeFunction("__leak", (m) => seen.push(m));
  await page.goto("https://careers.acme.example/jobs/1");
  await page.evaluate(() => addEventListener("message", (e) => window.__leak(String(e.data))));
  await page.waitForTimeout(500);
  const out = await A.eachFrame(page, { type: "fill", kit: { fields: KIT, header: {} }, resume: null });
  await page.waitForTimeout(500);
  const icims = page.frames().find((f) => /icims/.test(f.url())), px = page.frames().find((f) => /tracker/.test(f.url()));
  assert.strictEqual(await icims.inputValue("#fn"), "Jordan");
  assert.strictEqual(await icims.inputValue("#em"), "jordan.lee@example.com");
  assert.strictEqual(await px.inputValue("#e3"), "", "the tracker's field stayed empty");
  assert.deepStrictEqual(seen, []);
  assert.ok(out.some((r) => r.frame === icims) && !out.some((r) => r.frame === px));
  await page.close();
});

test("React dropdowns: their options are read and the answer is set through the component, in the page's world, with one value (plan step 3)", async () => {
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><body><form>
    <div class="field"><label for="fn">First name</label><input id="fn"></div>
    <div class="field"><label for="ln">Last name</label><input id="ln"></div>
    <div class="field"><label for="ctry">Country *</label><input id="ctry" role="combobox" aria-autocomplete="list" aria-expanded="false"></div></form>
    <script>
      const el = document.getElementById("ctry"), seen = [];
      const opts = [{ label: "Canada", value: "CA" }, { label: "United States", value: "US" }];
      el.__reactFiber$x1 = { stateNode: null, return: { stateNode: { props: { options: opts }, selectOption(o) { el.dataset.picked = o.value; seen.push(o); } }, return: null } };
      window.__seen = seen;
    </script></body>`);
  const { fields } = await A.scrapeAll(page);
  assert.deepStrictEqual(fields.find((f) => /Country/.test(f.label)).options, ["Canada", "United States"], "the page's own options, for the model");
  await A.fillCombos(page, [{ label: "Country", kind: "fill", value: "United States" }, { label: "Desired salary", kind: "fill", value: "120000" }]);
  assert.strictEqual(await page.getAttribute("#ctry", "data-picked"), "US", "picked through the component");
  assert.strictEqual(await page.inputValue("#ctry"), "", "not typed");
  await page.close();
});
