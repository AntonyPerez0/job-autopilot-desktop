// The recruiter's pass on a resume, with a mock AI that sometimes tries to add facts:
// the strongest lines first, headline and summary, grouped skills, a version per kind of job, the review.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile, approvedOnly } = await import("../core/engine.js");
const P = await import("../core/polish.js");

let reply = () => ({});
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const m = JSON.parse(b);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(m.messages[0].content, m.messages[1].content)) } }] }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" } });
test.after(() => ai.close());

const created = () => ({ schema: Profile.SCHEMA, name: "Sam Rivera", contact: {}, rules: Profile.EXAMPLE.rules, summaries: [{ id: "summary", text: "Tow Truck Driver.", approved: false }], headers: [], projects: [], education: [],
  experience: [
    { id: "tow", title: "Tow Truck Driver", org: "Initech Towing", dates: "Mar 2021 – Present", bullets: [
      { id: "a", text: "Answer dispatch calls, about 8 to 12 calls a shift", source: "about 8 to 12 calls a shift" },
      { id: "b", text: "Kept the truck clean and checked", source: "keep my truck clean and checked" },
      { id: "c", text: "Never damaged a customer's car", source: "never damaged a customer's car" },
      { id: "d", text: "Set out cones and flares at accident scenes", source: "set out cones and flares" },
      { id: "e", text: "Set out cones, flares and lights at scenes", source: "set out cones and flares" }] },
    { id: "sign", title: "Sign Shop Worker", org: "City of Springfield", dates: "Jun 2016 – Feb 2021", bullets: [
      { id: "a", text: "Trained two new guys on the vinyl cutter", source: "trained two new guys on the vinyl cutter" },
      { id: "b", text: "Made road closure signs fast in emergencies", source: "made the road closure signs fast when there was an emergency" }] }],
  skills: [{ id: "skills", label: "Skills", items: "Driving, Vinyl cutting, Vinyl cutter, Winch" }, { id: "certifications", label: "Certifications", items: "Class B CDL" }, { id: "languages", label: "Languages", items: "English, Spanish" }],
  bases: [{ id: "created", description: "Made with the resume creator", approved: false, header: null, summary: "summary", skills: ["skills", "certifications", "languages"],
    sections: [{ kind: "experience", items: [{ id: "tow", bullets: ["a", "b", "c", "d"] }, { id: "sign", bullets: ["a", "b"] }] }] }] });

test("after the creator: strongest lines first, merged repeats, guesses kept, nothing invented", async () => {
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    return { jobs: [
      { i: 0, lines: [{ text: "Handle about 8 to 12 dispatch calls a shift", from: [0] }, { text: "Never damaged a customer's vehicle", from: [2] },
        { text: "Secure accident scenes with cones, flares and lights", from: [3, 4] }, { text: "Handle 15 calls a shift", from: [1] }] },
      { i: 1, lines: [{ text: "Produced road closure signs on short notice during emergencies", from: [1] }, { text: "Trained two new hires on the vinyl cutter", from: [0] }] }],
      headline: "Class B CDL tow truck driver", summary: "Tow truck driver handling about 8 to 12 calls a shift. Trained new hires at the City of Springfield sign shop",
      skills: [{ label: "Licenses & Certifications", items: ["Class B CDL"] }, { label: "Equipment & Tools", items: ["Vinyl cutter", "Winch", "Laser engraver"] }, { label: "Languages", items: ["English", "Spanish"] }] };
  };
  const r = await P.polishCreated(created(), { target: "CDL driving", ids: ["tow", "sign"], skillIds: ["skills", "certifications", "languages"] });
  const tow = r.profile.experience[0];
  const base = r.profile.bases[0];
  const shown = base.sections[0].items[0].bullets.map((id) => tow.bullets.find((b) => b.id === id).text);
  assert.deepStrictEqual(shown, ["Handle about 8 to 12 dispatch calls a shift", "Never damaged a customer's vehicle", "Secure accident scenes with cones, flares and lights", "Kept the truck clean and checked"],
    "best first; the two cone lines merged; the line that invented '15 calls' falls back to its own words");
  assert.ok(r.rejected.some((x) => /15/.test(x.text)));
  assert.ok(tow.bullets.every((b) => b.approved === false), "nothing used before approval");
  assert.strictEqual(tow.bullets.filter((b) => /cones/.test(b.text)).length, 1, "no duplicate left behind for tailoring");
  assert.deepStrictEqual(r.profile.experience[1].bullets.map((b) => b.text).slice(0, 2), ["Produced road closure signs on short notice during emergencies", "Trained two new hires on the vinyl cutter"]);
  assert.strictEqual((r.profile.headers.find((h) => h.id === base.header) || {}).text, "Class B CDL tow truck driver");
  assert.match(r.profile.summaries.find((s) => s.id === base.summary).text, /^Tow truck driver handling about 8 to 12 calls a shift/);
  const skills = Object.fromEntries(r.profile.skills.map((s) => [s.label, s.items]));
  assert.deepStrictEqual(skills, { "Licenses & Certifications": "Class B CDL", "Equipment & Tools": "Vinyl cutter, Winch", Languages: "English, Spanish", "Other skills": "Driving" },
    "only items they typed ('Laser engraver' dropped), 'Vinyl cutting' folded into 'Vinyl cutter', and 'Driving' kept but off the page");
  assert.deepStrictEqual(base.skills, r.profile.skills.filter((s) => s.label !== "Other skills").map((s) => s.id));
});

test("a version for a kind of job: their lines chosen and worded for it, gaps as advice, nothing invented", async () => {
  const p = created();
  for (const e of p.experience) for (const b of e.bullets) b.approved = true;
  for (const s of p.skills) s.approved = true;
  p.summaries[0].approved = true;
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    assert.match(sys, /IT support/);
    return { jobs: [{ id: "tow", lines: [{ id: "a", text: "" }, { id: "d", text: "Secured accident scenes and coordinated with police using a ticketing system" }, { id: "c", text: "Never damaged a customer's vehicle" }] },
      { id: "sign", lines: [{ id: "b", text: "Produced road closure signs on short notice for city emergencies" }] }],
      headline: "Customer-focused field worker moving into IT support", summary: "Handle about 8 to 12 calls a shift with customers and dispatch. Trained new hires on shop equipment",
      skills: ["languages", "certifications"], gaps: [{ need: "CompTIA A+", how: "A common entry certification; people study online and take two exams." }] };
  };
  const r = await P.makeVersion(p, "IT support");
  const base = r.profile.bases.find((b) => b.id === r.base);
  assert.strictEqual(base.description, "IT support jobs");
  assert.strictEqual(base.approved, false);
  const tow = r.profile.experience[0];
  const lines = base.sections[0].items[0].bullets.map((id) => tow.bullets.find((b) => b.id === id));
  assert.deepStrictEqual(lines.map((b) => b.text), ["Answer dispatch calls, about 8 to 12 calls a shift", "Set out cones and flares at accident scenes", "Never damaged a customer's car"],
    "'ticketing system' and 'police' were added, so that rewording is left out; 'car' -> 'vehicle' is too small a change to approve again");
  const sign = r.profile.experience[1];
  const signLine = sign.bullets.find((b) => b.id === base.sections[0].items[1].bullets[0]);
  assert.strictEqual(signLine.text, "Produced road closure signs on short notice for city emergencies");
  assert.strictEqual(signLine.approved, false, "new wording waits for approval");
  assert.strictEqual(signLine.variantOf, "b");
  assert.ok(r.rejected.some((x) => /ticketing/.test(x.text)));
  assert.deepStrictEqual(r.gaps.map((g) => g.need), ["CompTIA A+"]);
  assert.ok(!JSON.stringify(r.profile.skills).includes("CompTIA"), "a gap never goes on the resume");
  assert.deepStrictEqual(base.skills, ["languages", "certifications"]);
  assert.ok(!approvedOnly(r.profile).bases.some((b) => b.id === r.base), "not used until approved");
});

test("the recruiter's read: a score and line-by-line notes, with real line paths only", async () => {
  const p = created();
  for (const e of p.experience) for (const b of e.bullets) b.approved = true;
  for (const s of p.skills) s.approved = true;
  p.summaries[0].approved = true; p.bases[0].approved = true;
  let doc = "";
  reply = (sys, user) => { doc = user; return { score: 6, verdict: "Solid driver, but the top third undersells him", strengths: ["Clear safety record"],
    items: [{ path: "experience.tow.b", problem: "A chore, not an accomplishment", fix: "Drop it or say how often" }, { path: "made.up.path", problem: "x", fix: "y" }, { path: "summary", problem: "Restates titles", fix: "Say what he brings" }] }; };
  const r = await P.recruiterReview(p);
  assert.strictEqual(r.score, 6);
  assert.deepStrictEqual(r.items.map((x) => x.path), ["experience.tow.b", "layout", "summary"]);
  assert.match(doc, /Kept the truck clean/, "the AI reads the resume as laid out");
});

test("a rewording may not lose their number; a summary says what they are; a plain headline when none passes", async () => {
  let tries = 0;
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/Your last try was rejected/.test(sys)) { tries++; return { headline: "Expert recovery specialist", summary: "Tow truck driver handling about 8 to 12 calls a shift" }; }
    return { jobs: [{ i: 0, lines: [{ text: "Answer dispatch calls for breakdowns", from: [0] }] }], headline: "World-class towing expert",
      summary: "Operate flatbed and wheel lift equipment on every call", skills: [{ label: "Equipment & Tools", items: ["Winch", "Vinyl cutter", "Vinyl cutting"] }] };
  };
  const r = await P.polishCreated(created(), { ids: ["tow"], skillIds: ["skills", "certifications", "languages"] });
  const tow = r.profile.experience[0];
  assert.strictEqual(tow.bullets[0].text, "Answer dispatch calls, about 8 to 12 calls a shift", "the rewording lost 'about 8 to 12', so their own line stays");
  assert.ok(r.rejected.some((x) => /leaves out your number/.test(x.why.join())));
  assert.strictEqual(tries, 1, "one more try for the headline and summary");
  const base = r.profile.bases[0];
  assert.strictEqual(r.profile.summaries.find((s) => s.id === base.summary).text, "Tow truck driver handling about 8 to 12 calls a shift.");
  assert.strictEqual(r.profile.headers.find((h) => h.id === base.header).text, "Tow Truck Driver with Class B CDL", "no AI headline passed: their title and license");
  const skills = Object.fromEntries(r.profile.skills.map((s) => [s.label, s.items]));
  assert.strictEqual(skills.Languages, "English, Spanish", "languages stay languages");
  assert.strictEqual(skills["Licenses & Certifications"], "Class B CDL");
  assert.strictEqual(skills["Equipment & Tools"], "Winch, Vinyl cutter");
});

test("a casual or failed line gets one more try with the reason; still casual means a note for them", async () => {
  let asked = "";
  reply = (sys, user) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/Rewrite each resume line in professional/.test(sys)) { asked = user; return { lines: [{ n: 0, text: "Trained two new hires on the vinyl cutter" }, { n: 1, text: "Made road closure signs real quick in emergencies" }] }; }
    return { jobs: [{ i: 0, lines: [{ text: "Trained two new guys on the vinyl cutter", from: [0] }, { text: "Made road closure signs real quick", from: [1] }] }], headline: "Class B CDL tow truck driver", summary: "Tow truck driver with a Class B CDL" };
  };
  const r = await P.polishCreated(created(), { ids: ["sign"], skillIds: [] });
  assert.match(asked, /reads casually/, "the retry is told why");
  const sign = r.profile.experience.find((e) => e.id === "sign");
  assert.strictEqual(sign.bullets[0].text, "Trained two new hires on the vinyl cutter");
  assert.ok(!sign.bullets.some((b) => /real quick/.test(b.text)), "a still-casual rewording is never used");
});

test("a rewording that repeats itself is sent back, and their own line stays if the retry repeats too", async () => {
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/Rewrite each resume line in professional/.test(sys)) return { lines: [{ n: 0, text: "Set out cones and flares at accident scenes, and cones and flares at night" }] };
    return { jobs: [{ i: 0, lines: [{ text: "Set out cones and flares at accident scenes and at other accident scenes", from: [3] }] }], headline: "Class B CDL tow truck driver", summary: "Tow truck driver with a Class B CDL" };
  };
  const r = await P.polishCreated(created(), { ids: ["tow"], skillIds: [] });
  assert.ok(r.rejected.some((x) => /twice/.test(x.why.join())));
  assert.strictEqual(r.profile.experience[0].bullets[0].text, "Set out cones and flares at accident scenes");
});
