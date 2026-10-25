// Live check of the resume studio with the real AI: write a resume from interview
// answers (an everyday job), then suggest improvements to the example resume.
//   JA_API_KEY=sk-or-... node scripts/live-studio.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-studio-"));
process.env.JA_DATA_DIR = dir;
const store = await import("../core/store.js");
store.setDataDir(dir);
const { Profile } = await import("../core/engine.js");
const S = await import("../core/studio.js");
const { approvedExample, exampleAnswers } = await import("../test/helpers.js");

const iv = { target: "Retail sales associate",
  jobs: [{ title: "Cashier", employer: "Corner Market", location: "Austin, TX", start: "Jun 2024", current: true,
    daily: "ran the register, counted my drawer at close, stocked the cooler, helped people find stuff, cleaned up",
    proud: "trained 3 new cashiers. my drawer was never short. got employee of the month in march", numbers: "about 150 customers a shift", tools: "Square register" },
  { title: "Babysitter", employer: "Self-employed", start: "2022", end: "2024", daily: "watched two kids after school, homework help, made dinner", proud: "families kept asking me back" }],
  education: [{ school: "Lincoln High School", earned: "Diploma", year: "2023" }], certifications: "Food Handler", languages: "English, Spanish", skills: "cash handling, customer service" };
let t = Date.now();
const c = await S.createFromInterview(iv, null, { firstName: "Sam", lastName: "Rivera" });
console.log(`CREATE (${Math.round((Date.now() - t) / 1000)}s)`);
for (const e of c.profile.experience) { console.log(` ${e.title}, ${e.org} (${e.dates})`); for (const b of e.bullets) console.log("   -", b.text, b.warning ? "\n     WARNING: " + b.warning : ""); }
console.log(" summary:", (c.profile.summaries[0] || {}).text, (c.profile.summaries[0] || {}).warning || "");
console.log(" skills:", c.profile.skills.map((s) => `${s.label}: ${s.items}`).join(" | "));
console.log(" left out:", c.rejected.map((r) => `${r.text} [${r.why.join("; ")}]`));
console.log(" questions:", c.questions.map((q) => q.question));

t = Date.now();
const p = approvedExample(Profile);
const s = await S.suggestImprovements(p, exampleAnswers());
console.log(`\nIMPROVE (${Math.round((Date.now() - t) / 1000)}s): ${s.length} suggestions`);
for (const x of s) console.log(` NOW: ${x.original}\n  NEW: ${x.text || "(no rewrite)"}${x.why ? `  [${x.why}]` : ""}${x.question ? `\n  ASK: ${x.question}` : ""}`);
