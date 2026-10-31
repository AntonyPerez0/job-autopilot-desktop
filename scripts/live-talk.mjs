// Live check of "Tell it in my own words" with the real AI, one message at a time, so a person can play the
// user and answer whatever the coach asks. The conversation is kept in JA_TALK_DIR between runs.
//   JA_API_KEY=sk-or-... node scripts/live-talk.mjs "i drive a tow truck for ..."   (answers the coach's question)
//   node scripts/live-talk.mjs --new "something else"      (not answering the question)
//   node scripts/live-talk.mjs --remember 0                (the yes/no questions for job 0)
//   node scripts/live-talk.mjs --yes 0 "1,3" "2=about twice a shift"   (send yes answers: question numbers, details)
//   node scripts/live-talk.mjs --write | --reset
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = process.env.JA_TALK_DIR || path.join(os.tmpdir(), "ja-talk-live");
fs.mkdirSync(dir, { recursive: true });
process.env.JA_DATA_DIR = dir;
const store = await import("../core/store.js");
store.setDataDir(dir);
const T = await import("../core/talk.js");
const { recallFor } = await import("../core/studio.js");
const { handle } = await import("../core/api.js");

const [cmd, ...rest] = process.argv.slice(2);
const show = (t) => {
  const c = t.turns[t.turns.length - 1];
  if (c && c.who === "coach") console.log(`COACH: ${c.text}\n  QUESTION: ${c.question}\n  IDEAS: ${c.ideas.join(" | ")}`);
  const n = t.notes || { jobs: [], education: [] };
  for (const [i, j] of n.jobs.entries()) console.log(`  JOB ${i}: ${j.title} @ ${j.employer || "?"} (${j.start || "?"} - ${j.current ? "now" : j.end || "?"})\n     daily: ${j.daily}\n     proud: ${j.proud}\n     numbers: ${j.numbers}\n     tools: ${j.tools}`);
  for (const e of n.education) console.log(`  SCHOOL: ${e.school}, ${e.earned} ${e.year}`);
  console.log(`  certs: ${n.certifications || ""} | skills: ${n.skills || ""} | languages: ${n.languages || ""} | target: ${n.target || ""}`);
  console.log(`  unsure: ${(t.unsure || []).map((u) => u.title).join(", ")} | left out: ${t.left || 0}`);
};
const t0 = Date.now();
const last = () => [...T.getTalk().turns].reverse().find((x) => x.who === "coach");
if (cmd === "--reset") { T.clearTalk(); console.log("reset"); }
else if (cmd === "--remember") {
  const j = T.getTalk().notes.jobs[Number(rest[0])];
  const r = await recallFor(j);
  fs.writeFileSync(path.join(dir, "recall.json"), JSON.stringify(r.items));
  console.log(`(${r.occupation})`); r.items.forEach((x, i) => console.log(` ${i}. ${x.q}`));
} else if (cmd === "--yes") {
  const items = JSON.parse(fs.readFileSync(path.join(dir, "recall.json"), "utf8"));
  const details = Object.fromEntries(rest.slice(2).map((x) => x.split("=")));
  const confirmed = rest[1].split(",").map(Number).map((i) => ({ q: items[i].q, task: items[i].task, detail: details[i] || "" }));
  show(await T.say("", "", { recall: { job: Number(rest[0]), confirmed } }));
} else if (cmd === "--write") {
  const r = await handle("/api/resume/talk/write", { merge: false });
  if (r.error) console.log("NOT WRITTEN:", r.error);
  else {
    for (const e of r.profile.experience) { console.log(` ${e.title}, ${e.org} (${e.dates})`); for (const b of e.bullets) console.log("   -", b.text, b.warning ? `\n     WARNING: ${b.warning}` : ""); }
    for (const h of r.profile.headers || []) console.log(" headline:", h.text);
    console.log(" summary:", (r.profile.summaries[0] || {}).text);
    console.log(" skills:", r.profile.skills.map((s) => `${s.label}: ${s.items}`).join(" | "));
    console.log(" education:", r.profile.education.map((e) => `${e.school} ${e.detail} ${e.dates}`).join(" | "));
    console.log(" left out:", r.rejected.map((x) => `${x.text} [${x.why.join("; ")}]`));
    console.log(" questions:", r.questions.map((q) => q.question));
  }
} else {
  const fresh = cmd === "--new";
  const text = fresh ? rest.join(" ") : [cmd, ...rest].join(" ");
  const q = last();
  show(await T.say(text, fresh || !q ? "" : q.question));
}
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
