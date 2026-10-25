// Live check of "Projects from GitHub" with the real GitHub API and AI.
//   JA_API_KEY=sk-or-... node scripts/live-github.mjs <username> <repo> [me|ai|team]
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const R = new URL("../core/", import.meta.url).href;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ja-gh-")); process.env.JA_DATA_DIR = dir;
const store = await import(R + "store.js"); store.setDataDir(dir);
const G = await import(R + "github.js");
const l = await G.listRepos(process.argv[2]);
console.log(l.count, "repos; suggested:", l.suggested.join(", "));
const picks = [{ name: process.argv[3], role: process.argv[4] || "ai" }];
const r = await G.importProjects(null, l.user, picks);
for (const p of r.profile.projects) { console.log("\n" + p.title, p.link, p.aiBuilt ? "(AI-built)" : ""); for (const b of p.bullets) console.log("  - " + b.text + (b.warning ? "\n      " + b.warning : "")); }
console.log("left out:", r.rejected.map((x) => `${x.text} [${x.why.join("; ")}]`));
console.log("questions:", r.questions.map((q) => q.question));
fs.rmSync(dir, { recursive: true, force: true });
