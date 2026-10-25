// Ported from the Apply Helper add-on (test/tailor.test.js): every base resume
// of the example profile fits one page, and the plan validator refuses what it
// should. Runs on Profile.EXAMPLE only.
import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { Tailor, Profile } from "../core/engine.js";

const profile = Profile.EXAMPLE;
const out = path.join(import.meta.dirname, "out");
fs.mkdirSync(out, { recursive: true });

test("profiles validate", () => {
  assert.deepStrictEqual(Array.from(Profile.validate(profile)), []);
});

test("every base resume fits on one page", async () => {
  for (const base of profile.bases) {
    const { spec } = Tailor.checkPlan(profile, { base: base.id });
    const r = await Tailor.fit(profile, spec, []);
    fs.writeFileSync(path.join(out, `${base.id}.pdf`), Buffer.from(r.pdf));
    assert.ok(!r.overflow, `${base.id} on one page`);
  }
});

test("plan validator drops invented ids, keeps pinned and minimum bullets", () => {
  const exp = profile.experience[0];
  const ai = profile.projects.find((p) => p.aiBuilt && (p.pinned || []).length);
  const plan = {
    base: "nope", summary: "invented summary text", skills: ["fake", profile.skills[0].id],
    sections: [
      { kind: "experience", items: [{ id: exp.id, bullets: [exp.bullets[0].id, "made_up"] }, { id: "ghost", bullets: ["x"] }] },
      { kind: "projects", items: [{ id: ai.id, bullets: ai.bullets.filter((b) => !ai.pinned.includes(b.id)).slice(0, 1).map((b) => b.id) }] },
    ],
    extra: ["ghost.x", `${exp.id}.${exp.bullets[1].id}`],
  };
  const { spec, notes, extra } = Tailor.checkPlan(profile, plan);
  assert.strictEqual(spec.base, profile.bases[0].id);
  assert.strictEqual(spec.summary, profile.bases[0].summary, "unapproved summary falls back");
  assert.deepStrictEqual(Array.from(spec.skills), [profile.skills[0].id]);
  const e = spec.sections.find((s) => s.kind === "experience").items;
  assert.strictEqual(e.length, 1, "unknown entry dropped");
  assert.ok(e[0].bullets.length >= (exp.minBullets || 2), "min bullets");
  assert.ok(!e[0].bullets.includes("made_up"));
  const p = spec.sections.find((s) => s.kind === "projects").items.find((i) => i.id === ai.id);
  assert.ok(p.bullets.includes(ai.pinned[0]), "AI-built project keeps its framing bullet");
  assert.strictEqual(extra.length, 1);
  assert.ok(notes.length >= 2);
});

test("form kit: banned words and cannot-claim terms go to the user", () => {
  const fields = [{ label: "Why us?", type: "textarea" }, { label: "Salary", type: "text" }, { label: "Resume", type: "file" }, { label: "Email", type: "text" }];
  const banned = profile.rules.bannedWords[0];
  const claim = profile.cannotClaim[0];
  const k = Tailor.kit(profile, { answers: [
    { i: 0, kind: "draft", value: `I am ${banned} about this \u2014 and ${claim} too.` },
    { i: 1, kind: "decide", note: "range not stated" },
    { i: 2, kind: "resume" },
    { i: 3, kind: "fill", value: "me@example.com" },
  ] }, fields, "X.pdf");
  assert.strictEqual(k[0].kind, "decide");
  assert.ok(/write it yourself/.test(k[0].note));
  assert.strictEqual(k[1].kind, "decide");
  assert.strictEqual(k[2].kind, "file");
  assert.strictEqual(k[3].value, "me@example.com");
});

test("form kit: suggest fills, skip blanks, a label without its option suffix finds the field", () => {
  const f2 = [{ label: "When are you available?: Q4 2026 (October - December)", type: "checkbox" }, { label: "GPA", type: "text" },
    { label: "First location preference", type: "combo" }];
  const k2 = Tailor.kit(profile, { answers: [
    { i: 5, label: "When are you available?", kind: "suggest", value: "Q4 2026 (October - December)" },
    { i: 1, label: "GPA", kind: "skip" },
    { i: 2, label: "First location preference", kind: "suggest", value: "Seattle", note: "closest" },
  ] }, f2, "X.pdf");
  assert.strictEqual(k2[0].label, f2[0].label);
  assert.strictEqual(k2[0].kind, "suggest");
  assert.strictEqual(k2[1].kind, "blank");
  assert.strictEqual(k2[2].value, "Seattle");
});

test("resume file name", () => {
  const last = profile.name.split(" ").pop();
  assert.strictEqual(Tailor.fileName(profile, { employer: "", jobTitle: "!!" }), last + ".pdf");
  assert.strictEqual(Tailor.fileName(profile, { employer: "Globex, Inc.", jobTitle: "software engineer, early career" }), last + "_GlobexInc_SoftwareEngineerEarly.pdf");
});
