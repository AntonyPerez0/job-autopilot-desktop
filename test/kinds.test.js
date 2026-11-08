// Kinds of work left out before the AI reads a posting: the ones the person said aren't for them, and the ones the
// app learned (four or more of a kind the AI found to be other work, none that fit), unless they brought it back.
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { openDb, getDb } = await import("../core/db.js");
openDb();
const K = await import("../core/kinds.js");

let n = 0;
const add = (category, status, reason) => getDb().prepare("INSERT INTO jobs (slug, key, title, company, url, status, reason, details) VALUES (?, ?, 'Engineer', 'Acme', 'https://x.example', ?, ?, ?)")
  .run(`k${++n}`, `k${n}`, status, reason, JSON.stringify({ category }));

test("names people read", () => {
  assert.strictEqual(K.kindName("qa"), "QA and testing");
  assert.strictEqual(K.kindName("industrial_engineering"), "Industrial engineering");
  assert.strictEqual(K.kindName("some_new_kind"), "Some new kind");
});

test("a screening reason that says the work is a different kind, not a missing skill or too senior", () => {
  for (const r of ["This is a hardware validation role, a different field from the candidate's software QA background.",
    "Despite the QA title, the work is clinical laboratory testing, unrelated to the candidate's experience.",
    "The role is not one of the candidate's target titles and centers on a specialized medical device domain."]) assert.match(r, K.OTHER_KIND, r);
  for (const r of ["Requires 5+ years of experience; the candidate has 2.", "Needs Kubernetes, which the candidate lacks."]) assert.doesNotMatch(r, K.OTHER_KIND, r);
});

test("learned: four of a kind found to be other work and none that fit; one that fit keeps the kind", () => {
  for (let i = 0; i < 4; i++) add("industrial_engineering", "skipped", "screen: a different field from the candidate's software background");
  for (let i = 0; i < 5; i++) add("healthcare", "skipped", "screen: a different kind of work than the candidate's");
  add("healthcare", "queued", "screen: fits");
  for (let i = 0; i < 3; i++) add("design", "skipped", "screen: a different field");
  for (let i = 0; i < 6; i++) add("qa", "skipped", "screen: requires 5+ years");
  assert.deepStrictEqual(K.learnedKinds().map((k) => k.code), ["industrial_engineering"]);
});

test("left out: theirs first, then the learned ones; a kind they brought back is never learned again", () => {
  assert.deepStrictEqual(K.hiddenKinds({ notForMeKinds: ["sales"] }).map((k) => [k.code, k.by]), [["sales", "you"], ["industrial_engineering", "app"]]);
  assert.deepStrictEqual(K.hiddenKinds({ keepKinds: ["industrial_engineering"] }), []);
  assert.deepStrictEqual(K.hiddenKinds({ notForMeKinds: ["industrial_engineering"] }).map((k) => k.by), ["you"], "listed once");
});

test("prefs keep kinds as short codes, at most 60", () => {
  const p = store.clampPrefs({ notForMeKinds: [...Array(80)].map((_, i) => "kind_" + i), keepKinds: "qa" });
  assert.strictEqual(p.notForMeKinds.length, 60);
  assert.deepStrictEqual(p.keepKinds, []);
});
