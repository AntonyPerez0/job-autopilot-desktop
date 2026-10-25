// Live check of "Help me remember": questions for a few jobs, then lines from some yes answers.
//   JA_API_KEY=sk-or-... node scripts/live-recall.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-recall-"));
process.env.JA_DATA_DIR = dir;
const store = await import("../core/store.js");
store.setDataDir(dir);
const S = await import("../core/studio.js");
const jobs = [{ title: "Cashier", employer: "Corner Market", daily: "ran the register, stocked the cooler" },
  { title: "Babysitter", employer: "Self-employed", daily: "watched two kids after school" },
  { title: "Stock Associate", employer: "Target", daily: "unloaded the truck" }];
for (const j of jobs) {
  const t = Date.now();
  const r = await S.recallFor(j);
  console.log(`\n${j.title} at ${j.employer} -> ${r.occupation} (${Math.round((Date.now() - t) / 1000)}s)`);
  for (const it of r.items) console.log(`  [${it.from}] ${it.q}`);
  j.items = r.items;
}
// Say yes to the first three for the cashier, with a detail on one.
const confirmed = jobs[0].items.slice(0, 3).map((x, i) => ({ q: x.q, task: x.task, detail: i === 0 ? "maybe 20 times a shift" : "" }));
const l = await S.linesFromConfirmed(jobs[0], confirmed, {}, {});
console.log("\nLINES FROM YES ANSWERS:");
for (const x of l.lines) console.log(`  - ${x.text}${x.warning ? "\n    " + x.warning : ""}\n    (${x.source})`);
console.log("  left out:", l.rejected.map((x) => `${x.text} [${x.why.join("; ")}]`));
fs.rmSync(dir, { recursive: true, force: true });
