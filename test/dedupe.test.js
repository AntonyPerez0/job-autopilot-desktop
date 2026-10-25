// Never apply twice: twins across boards, title variants, the user's own list,
// and the worker's restart path for a job stopped mid-submit.
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";
import { cleanUrl, inAppliedList, jobKey, parseAppliedList, roleKey, sameRoleAs } from "../core/dedupe.js";

test("the same role under variant titles has one role key", () => {
  const k = roleKey("Globex", "Software Engineer, New Grad");
  assert.strictEqual(roleKey("Globex Inc.", "Software Engineer, New Grad (Remote)"), k);
  assert.strictEqual(roleKey("Globex", "Software Engineer - Globex, New Grad"), roleKey("Globex", "Software Engineer, New Grad"));
  assert.notStrictEqual(roleKey("Globex", "Senior Software Engineer"), k);
  assert.notStrictEqual(roleKey("Initech", "Software Engineer, New Grad"), k);
});

test("job key ignores punctuation and case", () => {
  assert.strictEqual(jobKey("Globex, Inc.", "Backend Engineer"), jobKey("globex inc", "backend   engineer"));
});

test("an applied twin on another board is found; skipped ones do not count", () => {
  const rows = [
    { slug: "a", company: "Globex", title: "Backend Engineer (Remote)", status: "applied" },
    { slug: "b", company: "Globex", title: "Data Engineer", status: "skipped" },
  ];
  assert.strictEqual(sameRoleAs({ slug: "c", company: "Globex", title: "Backend Engineer" }, rows).slug, "a");
  assert.strictEqual(sameRoleAs({ slug: "d", company: "Globex", title: "Data Engineer" }, rows), null);
  assert.strictEqual(sameRoleAs({ slug: "a", company: "Globex", title: "Backend Engineer (Remote)" }, rows), null, "a job is not its own twin");
  assert.ok(sameRoleAs({ slug: "e", company: "Globex", title: "Backend Engineer" }, [{ ...rows[0], status: "submitting" }]), "mid-submit counts as applied");
});

test("the user's already-applied list: URLs and company/title lines", () => {
  const list = parseAppliedList(`# applied by hand
https://jobs.lever.co/globex/1234abcd-0000-0000-0000-000000000000/apply?src=x
Initech - Backend Engineer
Frontend Developer at Hooli
Umbrella, Data Analyst`);
  assert.ok(inAppliedList(list, { url: "https://jobs.lever.co/globex/1234abcd-0000-0000-0000-000000000000", company: "Globex", title: "x" }));
  assert.ok(inAppliedList(list, { company: "Initech", title: "Backend Engineer (Remote)" }));
  assert.ok(inAppliedList(list, { company: "Hooli", title: "Frontend Developer" }));
  assert.ok(inAppliedList(list, { company: "Umbrella Corp", title: "Data Analyst" }));
  assert.ok(!inAppliedList(list, { company: "Initech", title: "Frontend Developer" }));
  assert.strictEqual(cleanUrl("https://x.com/a/application#top"), "https://x.com/a");
});

test("restart: a job stopped mid-submit is never pressed again", async () => {
  tempDataDir();
  const { getDb, getJob } = await import("../core/db.js");
  const store = await import("../core/store.js");
  store.setDataDir(process.env.JA_DATA_DIR);
  store.saveSettings({ paused: true });
  const db = getDb();
  db.prepare("INSERT INTO jobs (slug, key, title, company, status) VALUES ('s1', 'k', 'Backend Engineer', 'Globex', 'submitting')").run();
  db.prepare("INSERT INTO jobs (slug, key, title, company, status) VALUES ('w1', 'k2', 'Data Engineer', 'Globex', 'working')").run();
  const worker = await import("../core/worker.js");
  const run = worker.run();
  await new Promise((r) => setTimeout(r, 300));
  worker.stop();
  await run;
  assert.strictEqual(getJob("s1").status, "failed");
  assert.match(getJob("s1").reason, /may have gone through/);
  assert.strictEqual(getJob("w1").status, "queued", "an interrupted fill (not submit) goes back to the queue");
});
