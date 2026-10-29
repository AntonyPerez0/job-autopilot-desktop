// What the window sends is bounded before it reaches a paid model call (security audit 3.2).
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { capInterview, capFill, handle } = await import("../core/api.js");

test("an interview: 50 jobs, 5000 characters a field, 30 confirmed lines", () => {
  const iv = capInterview({ goal: "g".repeat(9000), jobs: [...Array(80)].map(() => ({ title: "t".repeat(9000), confirmed: [...Array(60)].map(() => ({ text: "c".repeat(9000) })) })) });
  assert.strictEqual(iv.goal.length, 5000);
  assert.strictEqual(iv.jobs.length, 50);
  assert.strictEqual(iv.jobs[0].title.length, 5000);
  assert.strictEqual(iv.jobs[0].confirmed.length, 30);
  assert.strictEqual(iv.jobs[0].confirmed[0].text.length, 5000);
});

test("Fill out my page: at most 5 numbers, 500 characters each, the same line once", () => {
  const f = capFill({ numbers: [{ path: "a", text: "x".repeat(900) }, { path: "a", text: "again" }, ...[...Array(20)].map((_, i) => ({ path: "p" + i, text: "n" }))] });
  assert.strictEqual(f.numbers.length, 5);
  assert.deepStrictEqual(f.numbers.map((x) => x.path), ["a", "p0", "p1", "p2", "p3"]);
  assert.strictEqual(f.numbers[0].text.length, 500);
});

test("a resume import: at most 20 files, 10 MB each, refused before anything is read", async () => {
  const small = { name: "r.txt", b64: Buffer.from("Jordan Lee").toString("base64") };
  assert.match((await handle("/api/resumes/import", { files: [...Array(21)].map(() => small) })).error, /at most 20/);
  const big = { name: "big.pdf", b64: Buffer.alloc(11 * 1024 * 1024).toString("base64") };
  assert.match((await handle("/api/resumes/import", { files: [big] })).error, /big\.pdf is larger than 10 MB/);
});
