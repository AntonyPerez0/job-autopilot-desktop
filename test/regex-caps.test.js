// Text from outside (a README, a job board, a web page, an email, the model's reply) can't stall the app with
// a pattern built to take quadratic time (security audit 3.6): each reader finishes 1 MB of it in under 100 ms.
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const G = await import("../core/github.js");
const U = await import("../core/sources/usajobs.js");
const AJ = await import("../core/addjob.js");
const M = await import("../core/mail.js");
const D = await import("../core/dedupe.js");

const MB = 1024 * 1024;
const fill = (unit) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
const NASTY = ["<", "<a ", "<script>", "<script type=application/ld+json>", "<style>", "<meta property=og:title ", "<title>", "![", "[", "[a](", "(", "{", "/", "a - 1", "<a href='https://x.example/v'>", "a".repeat(50) + " - "].map(fill);
async function fast(label, fn) {
  for (const s of NASTY) {
    const t = performance.now();
    await fn(s);
    const ms = performance.now() - t;
    assert.ok(ms < 100, `${label} on ${JSON.stringify(s.slice(0, 24))}…: ${ms.toFixed(0)} ms`);
  }
}
const withFetch = async (fake, fn) => { const real = globalThis.fetch; globalThis.fetch = fake; try { return await fn(); } finally { globalThis.fetch = real; } };

test("GitHub: a README (repoFacts)", async () => {
  await fast("repoFacts", (readme) => withFetch(async (u) => new Response(/\/readme$/.test(String(u)) ? readme : /\/repos\/[^/]+\/[^/]+$/.test(String(u)) ? JSON.stringify({ name: "r", html_url: "https://github.com/x/r" }) : "[]", { status: 200 }),
    () => G.repoFacts("x", "r")));
  const f = await withFetch(async (u) => new Response(/\/readme$/.test(String(u)) ? "# Tool\n\n<b>Fast</b> [docs](https://d.example) ![badge](https://b.example/x.svg)" : /\/repos\/[^/]+\/[^/]+$/.test(String(u)) ? JSON.stringify({ name: "r", html_url: "https://github.com/x/r" }) : "[]", { status: 200 }), () => G.repoFacts("x", "r"));
  assert.strictEqual(f.readme, "# Tool\n\nFast docs", "still cleaned the same way");
});

test("USAJOBS: a listing's description (strip)", async () => {
  await fast("usajobs strip", (s) => U.normalize({ MatchedObjectId: "1", MatchedObjectDescriptor: { PositionTitle: "Clerk", PositionURI: "https://www.usajobs.gov/job/1", QualificationSummary: s, UserArea: { Details: { JobSummary: s, MajorDuties: [s] } } } }));
});

test("Add a job: the fetched page, read up to 2 MB (resolveLink)", async () => {
  await fast("resolveLink", (s) => withFetch(async () => new Response(s, { status: 200 }), () => AJ.resolveLink("https://jobs.example.com/careers/job/Cashier")));
  let sent = 0;
  const huge = new ReadableStream({ pull(c) { sent += 65536; if (sent > 20 * MB) c.close(); else c.enqueue(new Uint8Array(65536).fill(60)); } });
  const text = await AJ.textUpTo(new Response(huge));
  assert.ok(text.length <= AJ.MAX_PAGE && sent < 3 * MB, `read ${text.length}, pulled ${sent}`);
  const page = `<html><head><title>Cashier - Pollo Regio</title><script type="application/ld+json">{"@type":"JobPosting","title":"Cashier","hiringOrganization":{"name":"Pollo Regio"}}</script></head></html>`;
  assert.strictEqual(AJ.jobPostingFrom(page).company, "Pollo Regio", "still read the same way");
});

test("Mail: an email's HTML (htmlToText, findLink)", async () => {
  await fast("htmlToText", (s) => M.htmlToText(s));
  await fast("findLink", (s) => M.findLink(s, s, "x.example"));
  assert.strictEqual(M.htmlToText("<style>p{}</style><p>Hi <b>Jordan</b></p><script>x()</script>ok").replace(/\s+/g, " ").trim(), "Hi Jordan ok");
  assert.strictEqual(M.findLink('<a href="https://globex.example/verify?x=1">Verify</a>', "", "globex.example"), "https://globex.example/verify?x=1");
});

test("Dedupe: titles, companies and links", async () => {
  await fast("dedupe", (s) => { D.roleKey(s, s); D.familyKey(s, s); D.jobKey(s, s); D.cleanUrl(s); D.parseAppliedList(s.slice(0, 2000)); });
});

test("The model's reply (tailor.js parseJSON)", async () => {
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "..", "vendor", "apply-helper", "tailor.js"), "utf8");
  const parseJSON = new Function(src.match(/function parseJSON\(text\) \{[\s\S]*?\n {2}\}\n/)[0] + "return parseJSON;")();
  await fast("parseJSON", (s) => { try { parseJSON(s); } catch { /* not JSON: an error, quickly */ } });
  assert.deepStrictEqual(parseJSON('Here it is: {"a": {"b": 1}} hope that helps'), { a: { b: 1 } });
  assert.deepStrictEqual(parseJSON('```json\n{"x": 2}\n```'), { x: 2 });
});
