// After applying: where each application stands, which ones are worth a follow-up, and what's working.
import test from "node:test";
import assert from "node:assert";
import { tempDataDir } from "./helpers.js";

tempDataDir();
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { openDb, getDb } = await import("../core/db.js");
openDb();
const T = await import("../core/tracking.js");

const day = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * day).toISOString();
function sent(slug, daysAgo, f = {}) {
  getDb().prepare(`INSERT INTO jobs (slug, key, title, company, url, status, applied_at, stage, followed_up_at, details) VALUES (?, ?, ?, ?, 'https://x.example', ?, ?, ?, ?, ?)`)
    .run(slug, slug, f.title || "Support Engineer", f.company || "Globex", f.status || "applied", iso(daysAgo), f.stage || null, f.followed || null, JSON.stringify(f.details || {}));
}
let r = 0;
const reply = (slug, kind, daysAgo = 1) => getDb().prepare("INSERT INTO replies (id, slug, at, sender, subject, kind) VALUES (?, ?, ?, 'hr@globex.example', 'Re: your application', ?)").run(`m${++r}`, slug, iso(daysAgo), kind);

test("where it stands: the person's word first, else the newest reply that decides something", () => {
  assert.strictEqual(T.stageOf({ stage: "offer" }, [{ kind: "rejection", at: "2026-11-01" }]), "offer");
  assert.strictEqual(T.stageOf({}, [{ kind: "interview", at: "2026-10-01" }, { kind: "rejection", at: "2026-11-01" }]), "rejected");
  assert.strictEqual(T.stageOf({}, [{ kind: "assessment", at: "2026-11-01" }, { kind: "info", at: "2026-11-02" }]), "interviewing");
  assert.strictEqual(T.stageOf({}, [{ kind: "info", at: "2026-11-02" }]), "waiting");
  assert.strictEqual(T.stageOf({ stage: "made-up" }, []), "waiting");
});

test("follow-ups: sent 10 to 60 days ago, nothing back, not followed up, still waiting", () => {
  sent("old-quiet", 14);
  sent("too-new", 3);
  sent("too-old", 90);
  sent("answered", 20); reply("answered", "rejection");
  sent("received-only", 15); reply("received-only", "received");
  sent("followed", 25, { followed: "2026-11-01 10:00:00" });
  sent("declined", 25, { followed: "no" });
  sent("interviewing", 30, { stage: "interviewing" });
  sent("practice", 30, { status: "filled" });
  assert.deepStrictEqual(T.followUps().map((j) => j.slug), ["received-only", "old-quiet"]);
  const note = T.followUpNote({ title: "Support Engineer", company: "Globex", applied_at: "2026-10-20T15:00:00.000Z" }, { firstName: "Jordan", lastName: "Lee" });
  assert.match(note, /applied for the Support Engineer role at Globex on October 20/);
  assert.match(note, /Jordan Lee$/);
});

test("what's working: answers and interviews by where jobs were found and how well they fit, once there are 5", () => {
  getDb().prepare("DELETE FROM jobs").run();
  getDb().prepare("DELETE FROM replies").run();
  const prefs = { titles: ["Support Engineer", "QA Analyst"], seniority: ["junior", "middle"] };
  sent("a1", 5, { details: { board: "freehire", check: { met: 4, checked: 4 } } });
  sent("a2", 6, { details: { board: "freehire", check: { met: 4, checked: 5 } } });
  assert.deepStrictEqual(T.insights(prefs, {}, { people: null }).groups, [], "too few to say");
  sent("a3", 7, { title: "QA Analyst", details: { board: "hiringcafe", check: { met: 1, checked: 4 } } });
  sent("a4", 8, { title: "QA Analyst", details: { board: "hiringcafe" } });
  sent("a5", 9, { details: { addedByUser: true } });
  reply("a1", "interview"); reply("a3", "rejection");
  const x = T.insights(prefs, {}, { people: null });
  assert.strictEqual(x.sent, 5);
  const where = x.groups.find((g) => g.name === "Where it was found").rows;
  assert.deepStrictEqual(where.find((w) => w.label === "freehire"), { label: "freehire", sent: 2, heard: 1, interviews: 1 });
  assert.deepStrictEqual(where.find((w) => w.label === "HiringCafe"), { label: "HiringCafe", sent: 2, heard: 1, interviews: 0 });
  assert.ok(where.some((w) => w.label === "Added by you"));
  const fit = x.groups.find((g) => g.name === "Fit with your resume").rows.map((w) => w.label).sort();
  assert.deepStrictEqual(fit, ["Not checked", "Partial (under half)", "Strong (80%+ of the requirements)"]);
  const titles = x.groups.find((g) => g.name === "Job title").rows.map((w) => w.label).sort();
  assert.deepStrictEqual(titles, ["QA Analyst", "Support Engineer"]);
  assert.ok(!x.groups.some((g) => g.name === "Resume version"), "a slice with one group says nothing");
});
