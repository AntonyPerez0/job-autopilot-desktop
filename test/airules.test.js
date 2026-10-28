// The rules for resumes now that software and AI read them first (docs/resume-research.md, section 9):
// readable by screening software, keywords in context not stuffed, AI only rewords, result-measure-method,
// and proof of AI use rather than a tool's name. The plain checks here need no AI; the rest use a mock.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile, approvedOnly } = await import("../core/engine.js");
const S = await import("../core/studio.js");
const P = await import("../core/polish.js");
const F = await import("../core/fill.js");
const { screening, MAX_BYTES } = await import("../core/screening.js");

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

const example = () => {
  const p = JSON.parse(JSON.stringify(Profile.EXAMPLE));
  for (const k of ["experience", "projects"]) for (const e of p[k]) for (const b of e.bullets) b.approved = true;
  for (const k of ["summaries", "skills", "bases", "headers", "education"]) for (const x of p[k] || []) x.approved = true;
  return p;
};

test("the phrasing every AI writes is caught; the person's own words stay theirs", () => {
  const generic = "Spearheaded cross-functional initiatives to drive operational excellence as a results-driven professional";
  assert.deepStrictEqual(S.aiTells(generic).slice(0, 2), ["spearheaded", "cross-functional initiatives"]);
  assert.deepStrictEqual(S.aiTells("Decreased duplicate tickets by 50% by creating a shared refund guide for sales and support"), []);
  assert.match(S.vet("Built a robust scheduling service in Python", ["built a scheduling service in python"], { rules: {} }, []).why.join(), /sounds AI-written \("robust"\)/);
  assert.ok(S.vet("Built a robust scheduling service in Python", ["I built a robust scheduling service in python"], { rules: {} }, []).ok, "they said robust themselves");
});

test("keyword stuffing: one word three times in a line is sent back, and the checklist says so", () => {
  const stuffed = "Delivered customer support, customer service, and customer-focused communication to improve the customer experience";
  assert.strictEqual(S.stuffedWord(stuffed), "customer");
  assert.strictEqual(S.stuffedWord("Served about 200 customers a day at the register and answered phones"), "");
  assert.match(S.vet(stuffed, ["customer support"], { rules: {} }, []).why.join(), /says "customer" three times/);
  const p = example();
  p.experience[0].bullets[0].text = stuffed;
  const c = S.checklist(p).find((x) => x.id === "twice");
  assert.ok(c && /three times/.test(c.items[0].why), "Say it once, with the reason");
});

test("checklist: a result without how, an AI tool without a result, a project without a link", () => {
  const p = example();
  p.experience[0].bullets.push({ id: "cut", text: "Cut failed deploys by 40%", approved: true });
  p.experience[0].bullets.push({ id: "gpt", text: "Used ChatGPT in day-to-day reporting", approved: true });
  p.experience[0].bullets.push({ id: "xyz", text: "Cut weekly reporting from 2 hours to 30 minutes by using Claude to group recurring issues", approved: true });
  p.projects[0].link = ""; p.projects[0].url = "";
  const c = S.checklist(p);
  const ids = (id) => ((c.find((x) => x.id === id) || {}).items || []).map((x) => x.path);
  assert.deepStrictEqual(ids("how"), ["experience.acme.cut"], "the X-Y-Z line already says how");
  assert.deepStrictEqual(ids("ai-proof"), ["experience.acme.gpt"], "the tool with a result is proof already");
  assert.deepStrictEqual(ids("links"), [`projects.${p.projects[0].id}`]);
  assert.ok(!c.some((x) => x.id === "ai-words"), "nothing AI-sounding in the example");
  p.summaries[0].text = "Results-driven engineer who leverages robust tools.";
  assert.ok(S.checklist(p).some((x) => x.id === "ai-words"));
});

test("result, measure, method: a change they stated with its size may take the plain verb for it; one they didn't, never", () => {
  assert.ok(S.vet("Cut duplicate tickets 50% by writing a refund guide both teams use", ["wrote a refund guide both teams use; duplicate tickets dropped by 50%"], { rules: {} }, []).ok);
  assert.ok(!S.vet("Increased sales by 50%", ["I like the product"], { rules: {} }, []).ok);
  assert.ok(!S.vet("Reduced complaints by building a guide", ["built a guide"], { rules: {} }, []).ok, "no change stated: no result verb");
  assert.deepStrictEqual(S.addedFacts("Cut complaints 31% with a ChatGPT-drafted email sequence", ["used ChatGPT to draft an email sequence; complaints went down 31%"]), [], "a compound of their own words");
  assert.deepStrictEqual(S.addedFacts("A Kubernetes-based pipeline", ["built a pipeline"]), ['"kubernetes-based"'], "a compound with a new tool in it");
  const c = S.checklist(Object.assign(example(), {})).find((x) => x.id === "how");
  assert.ok(!c, "lines that open with what was done already say how");
});

test("the file screening software reads: small, real text, standard headings in one column", async () => {
  const p = approvedOnly(example());
  const r = await screening(p, p.bases[0].id);
  assert.ok(r.ok, JSON.stringify(r.items));
  assert.ok(r.bytes > 1000 && r.bytes < MAX_BYTES, `${r.bytes} bytes`);
  assert.match(r.items[2].detail, /^Summary, Skills, Experience/);
});

test("a pasted posting: what the employer needs, and each of its terms shown or missing, checked in the resume's own words", async () => {
  const p = example();
  for (const k of ["summaries", "skills", "bases", "headers", "education"]) for (const x of p[k] || []) x.approved = true;
  let user = "";
  reply = (sys, u) => { user = u; return { score: 7, verdict: "Strong backend lines", strengths: ["Numbers"], items: [], needs: ["Keep the booking system reliable"], keywords: ["PostgreSQL", "Kubernetes", "REST APIs", "CI"] }; };
  const r = await P.recruiterReview(p, { posting: "We need a backend engineer: PostgreSQL, Kubernetes, REST APIs, CI." });
  assert.match(user, /JOB POSTING\nWe need a backend engineer/);
  assert.deepStrictEqual(r.job.needs, ["Keep the booking system reliable"]);
  const by = Object.fromEntries(r.job.keywords.map((k) => [k.term, k]));
  assert.ok(by.PostgreSQL.shown.length, "on the resume");
  assert.deepStrictEqual(by.Kubernetes.shown, [], "not on the resume: a gap, never added");
  assert.ok(by["REST APIs"].shown.length, "REST API matches REST APIs");
  // A term the resume shows in other words: the AI may point to the line; only a real line counts.
  reply = () => ({ score: 7, verdict: "ok", strengths: [], items: [], needs: [], keywords: [{ term: "automated testing", path: "experience.acme.ci" }, { term: "Kubernetes", path: "made.up" }] });
  const m = await P.recruiterReview(p, { posting: "automated testing, Kubernetes" });
  assert.strictEqual(m.job.keywords[0].mapped, "experience.acme.ci");
  assert.strictEqual(m.job.keywords[1].mapped, undefined);
  const none = await P.recruiterReview(p);
  assert.strictEqual(none.job, null, "no posting, no job part");
  const many = P.keywordMap({ sections: [{ items: [{ lines: [1, 2, 3, 4, 5].map((n) => ({ path: `x.${n}`, text: "Python scripts in Python" })) }] }] }, ["Python"]);
  assert.ok(many[0].stuffed, "ten mentions is stuffing");
});

test("AI use from Fill out my page: at work it's the job's first line, on their own a linked project; nothing beyond what they said", async () => {
  const p = example();
  for (const k of ["summaries", "skills", "bases", "headers", "education"]) for (const x of p[k] || []) x.approved = true;
  const job = p.experience[0].id;
  reply = (sys, user) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/using an AI tool/.test(sys)) return { lines: [
      { n: 0, text: "Cut weekly feedback reporting from 2 hours to about 30 minutes by using Claude to group recurring issues" },
      { n: 1, text: "Built a review-insights report from 100 public product reviews by using ChatGPT, saving the company $50,000" }] };
    return {};
  };
  const input = { ai: [
    { where: job, tool: "Claude", problem: "the weekly feedback report took 2 hours", did: "had it group recurring issues, then checked every group", result: "about 30 minutes now" },
    { where: "own", tool: "ChatGPT", name: "Review insights", link: "github.com/jordanlee-example/review-insights", did: "had it find recurring complaints in 100 public product reviews and checked the themes" }] };
  const r = await F.applyFill(p, input, {});
  const e = r.profile.experience.find((x) => x.id === job);
  assert.match(e.bullets[0].text, /^Cut weekly feedback reporting .* by using Claude/);
  assert.strictEqual(e.bullets[0].approved, false);
  const base = r.profile.bases[0], sec = base.sections.find((s) => s.kind === "experience").items.find((it) => it.id === job);
  assert.strictEqual(sec.bullets[0], e.bullets[0].id, "first under the job on the layout");
  assert.ok(!r.profile.projects.some((x) => x.title === "Review Insights"), "the $50,000 was never said: no project line");
  assert.match(r.rejected.map((x) => x.why.join()).join(), /50,?000/);
  // Without the invented saving, the project is added with its link, first among the projects.
  reply = (sys) => (/fact-check/.test(sys) ? { lines: [] } : /using an AI tool/.test(sys) ? { lines: [{ n: 0, text: "Found the recurring complaints in 100 public product reviews by using ChatGPT, then checked each theme" }] } : {});
  const r2 = await F.applyFill(p, { ai: [input.ai[1]] }, {});
  const proj = r2.profile.projects.find((x) => x.title === "Review Insights");
  assert.ok(proj && proj.link === "github.com/jordanlee-example/review-insights" && proj.url.startsWith("https://"));
  assert.strictEqual(r2.profile.bases[0].sections.find((s) => s.kind === "projects").items[0].id, proj.id);
  // A line that leaves out the tool isn't proof of anything.
  reply = (sys) => (/fact-check/.test(sys) ? { lines: [] } : /using an AI tool/.test(sys) ? { lines: [{ n: 0, text: "Grouped recurring issues in weekly feedback reports" }] } : {});
  const r3 = await F.applyFill(p, { ai: [input.ai[0]] }, {});
  assert.match(r3.rejected[0].why.join(), /leaves out Claude/);
});
