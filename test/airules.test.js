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
  assert.deepStrictEqual(S.addedFacts("Wrote one refund guide for the two teams", ["a refund guide both teams use"]), [], "both teams is two teams");
  assert.deepStrictEqual(S.addedFacts("Trained two new hires", ["trained new hires"]), ["the number 2"]);
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

test("a line refused for its wording gets one more try with the reason, so the fact in it isn't lost", async () => {
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/Rewrite each resume line using only the person's facts/.test(sys)) return { lines: [{ n: 0, text: "Answer about 60 billing and refund tickets a day" }] };
    if (/write a one-page resume/.test(sys)) return { summary: "", jobs: [{ index: 0, bullets: [{ text: "Manage about 60 billing and refund tickets a day", source: "about 60 tickets a day" }] }] };
    return {};
  };
  const r = await S.createFromInterview({ jobs: [{ title: "Support Specialist", employer: "Globex", start: "2022", current: true, daily: "answer billing and refund tickets", numbers: "about 60 tickets a day" }] }, null, {});
  const lines = r.profile.experience[0].bullets.map((b) => b.text);
  assert.ok(lines.includes("Answer about 60 billing and refund tickets a day"), JSON.stringify(lines));
  assert.ok(!lines.some((t) => /^Manage/.test(t)));
});

test("a merge of several lines that fails its check keeps every line it was made from", async () => {
  const p = { schema: Profile.SCHEMA, name: "Jordan Lee", contact: {}, rules: Profile.EXAMPLE.rules, summaries: [], headers: [], projects: [], education: [], skills: [], bases: [],
    experience: [{ id: "shop", title: "Cashier", org: "Initech Market", dates: "Jun 2019 – Feb 2022", bullets: [
      { id: "a", text: "Ran the register for about 200 customers a shift" }, { id: "b", text: "Trained 4 new cashiers" }, { id: "c", text: "Closed the store on weekends" }] }] };
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/turning a person's resume lines/.test(sys)) return { jobs: [{ i: 0, lines: [{ text: "Closed the store on weekends", from: [0, 1, 2] }] }], headline: "", summary: "", skills: [] };
    if (/Rewrite each resume line/.test(sys)) return { lines: [{ n: 0, text: "Closed the store on weekends" }] };
    return {};
  };
  const r = await P.polishCreated(p, { ids: ["shop"], linesOnly: true });
  const lines = r.profile.experience[0].bullets.map((b) => b.text);
  for (const t of ["Ran the register for about 200 customers a shift", "Trained 4 new cashiers", "Closed the store on weekends"]) assert.ok(lines.includes(t), `kept: ${t} in ${JSON.stringify(lines)}`);
});

test("result, measure, method the same way every time: a reorder is used only when it passes every check", async () => {
  const p = example();
  reply = (sys) => /Rewrite each resume line so it reads as result, measure, method/.test(sys) ? { lines: [
    { n: 0, text: "Cut duplicate tickets 50% by writing a shared refund guide for sales and support" },
    { n: 1, text: "Cut complaints 31% by drafting an award-winning email sequence for 5,000 customers" }] } : {};
  const out = await P.xyzOrder([
    { text: "Wrote a shared refund guide for sales and support; duplicate tickets dropped 50%", sources: ["wrote a refund guide both teams use; duplicate tickets dropped by 50%"] },
    { text: "Drafted an onboarding email sequence; complaints dropped 31%", sources: ["drafted onboarding emails; complaints went down 31%"] },
    { text: "Answer about 60 tickets a day", sources: ["about 60 tickets a day"] },
    { text: "Cut weekly reporting from 2 hours to 30 minutes by using Claude to group issues", sources: ["2 hours to 30 minutes"] }], p, []);
  assert.strictEqual(out[0], "Cut duplicate tickets 50% by writing a shared refund guide for sales and support");
  assert.strictEqual(out[1], "Drafted an onboarding email sequence; complaints dropped 31%", "an added number and praise: the line stays as it was");
  assert.strictEqual(out[2], "Answer about 60 tickets a day", "no change stated: not touched");
  assert.strictEqual(out[3], "Cut weekly reporting from 2 hours to 30 minutes by using Claude to group issues", "already in order: not sent");
});

test("no AI summary passed: the same three-part shape from their title, their best checked line and their target", () => {
  const job = { title: "Customer Support Specialist", org: "Globex" };
  const lines = [{ text: "Answer about 60 tickets a day" }, { text: "Cut duplicate tickets 50% by writing a shared refund guide" }];
  assert.strictEqual(P.builtSummary(job, lines, "Customer Success Specialist"), "Customer Support Specialist at Globex. Cut duplicate tickets 50% by writing a shared refund guide. Moving into a Customer Success Specialist role");
  assert.strictEqual(P.builtSummary(job, lines, "customer support specialist"), "Customer Support Specialist at Globex. Cut duplicate tickets 50% by writing a shared refund guide", "same job: no 'moving into'");
});

test("a short resume fills the page with even spacing, never past one page", async () => {
  const { Tailor, loadProfile } = await import("../core/engine.js");
  const p = example();
  p.experience = p.experience.slice(0, 1); p.experience[0].bullets = p.experience[0].bullets.slice(0, 2);
  p.projects = []; for (const b of p.bases) b.sections = b.sections.filter((s) => s.kind !== "projects").map((s) => s.kind === "experience" ? { ...s, items: s.items.filter((it) => it.id === p.experience[0].id).map((it) => ({ ...it, bullets: it.bullets.slice(0, 2) })) } : s);
  const lp = loadProfile(p);
  const { spec } = Tailor.checkPlan(lp, { base: lp.bases[0].id });
  const r = await Tailor.fit(lp, spec, []);
  assert.ok(!r.overflow);
  assert.ok(r.spread && r.spread.head > 0 && r.spread.head <= 16 && r.spread.entry <= 7, JSON.stringify(r.spread));
  assert.ok(r.slack < r.startSlack, "less blank than before");
});

test("the same question gets the same answer: AI answers are remembered, so the same facts make the same resume", async () => {
  const C = await import("../core/aicache.js");
  delete process.env.JA_NO_AI_CACHE;
  try {
    let n = 0;
    reply = () => ({ text: `answer ${++n}` });
    const msgs = [{ role: "system", content: "Reword it. Return JSON only" }, { role: "user", content: "a line" }];
    const a = await S.ask(msgs), b = await S.ask(msgs);
    assert.deepStrictEqual(a, b, "asked twice, answered once");
    assert.strictEqual(n, 1);
    const c = await S.ask([msgs[0], { role: "user", content: "another line" }]);
    assert.notDeepStrictEqual(c, a, "a new question gets a fresh answer");
    assert.ok(C.prune() >= 2, "kept in the data folder");
  } finally { process.env.JA_NO_AI_CACHE = "1"; }
});

test("a line the fact check flags gets one more try without the flagged part; it replaces the line only if both checks pass", async () => {
  reply = (sys, user) => {
    if (/has a part the person never said/.test(sys)) return { lines: [{ n: 0, text: "Trained 4 new cashiers" }, { n: 1, text: "Trained 3 new support hires on Kubernetes" }] };
    if (/fact-check/.test(sys)) return { lines: [] };
    return {};
  };
  const a = { id: "a", text: "Trained 4 new cashiers on register and return procedures", warning: "x" }, b = { id: "b", text: "Trained 3 new support hires on company processes", warning: "y" };
  const items = [
    { b: a, text: a.text, source: "trained 4 new cashiers", flag: "on register and return procedures", check: (t) => S.vet(t, ["trained 4 new cashiers"], { rules: {} }, []) },
    { b, text: b.text, source: "trained 3 new support hires", flag: "on company processes", check: (t) => S.vet(t, ["trained 3 new support hires"], { rules: {} }, []) }];
  const n = await S.refixFlagged(items);
  assert.strictEqual(n, 1);
  assert.strictEqual(a.text, "Trained 4 new cashiers"); assert.strictEqual(a.warning, undefined);
  assert.strictEqual(b.text, "Trained 3 new support hires on company processes", "the retry added Kubernetes: refused, the note stays");
  assert.strictEqual(b.warning, "y");
});

test("house style: the same thing said the same way, without changing what it says", async () => {
  const { houseStyle } = await import("../core/style.js");
  const same = [
    ["Decreased duplicate tickets by 50% by creating a shared refund guide", "Cut duplicate tickets 50% by creating a shared refund guide"],
    ["Lowered new-customer complaints 31% by drafting onboarding emails", "Cut new-customer complaints 31% by drafting onboarding emails"],
    ["Edited every email, reducing new-customer complaints by 31%", "Edited every email, cutting new-customer complaints 31%"],
    ["Answer approximately 60 emails and chats daily regarding billing", "Answer about 60 emails and chats a day regarding billing"],
    ["Ran the register for about 200 customers per shift", "Ran the register for about 200 customers a shift"],
    ["Trained three new support hires", "Trained 3 new support hires"],
    ["Grew followers by 30% by testing video openings", "Increased followers 30% by testing video openings"],
    ["Utilized Excel in order to track inventory", "Used Excel to track inventory"]];
  for (const [a, b] of same) assert.strictEqual(houseStyle(a), b);
  const untouched = ["Prepared daily reports for the manager", "Inspect the truck every shift before driving", "Help with one-on-one technology support", "Reduced errors by double-checking orders"];
  for (const t of untouched) assert.strictEqual(houseStyle(t), t, "no number, no change");
});

test("skills sorted without the AI: software from O*NET's list, equipment by what it is, soft skills off the page", async () => {
  const { skillGroup } = await import("../core/skillsort.js");
  const want = { "Zendesk": "Software & Systems", "Microsoft Excel": "Software & Systems", "Excel": "Software & Systems", "Google Sheets": "Software & Systems", "ChatGPT": "Software & Systems", "Intuit QuickBooks": "Software & Systems",
    "Pallet jack": "Equipment & Tools", "Vinyl cutter": "Equipment & Tools", "Cash register": "Equipment & Tools", "Bucket truck": "Equipment & Tools",
    "Truck driving": "Skills", "Forklift operation": "Skills", "Payroll": "Skills", "Inventory management": "Skills", "HVAC": "Skills", "Customer onboarding": "Skills", "Teamwork": "soft" };
  for (const [k, v] of Object.entries(want)) assert.strictEqual(skillGroup(k), v, k);
});

test("dates one way: Mar 2022, 2022, Present; ranges with an en dash; anything else left as it was", async () => {
  const { fmtDate, fmtRange } = await import("../core/dates.js");
  assert.deepStrictEqual(["2022-03", "3/2022", "March 2022", "Sept. 2022", "2023", "now", "Summer 2021"].map(fmtDate), ["Mar 2022", "Mar 2022", "Mar 2022", "Sep 2022", "2023", "Present", "Summer 2021"]);
  assert.strictEqual(fmtRange("06/2021 - present"), "Jun 2021 – Present");
  assert.strictEqual(fmtRange("2019-2021"), "2019 – 2021");
  const p = example();
  p.experience[1].dates = "2022 – 2023";
  const c = S.checklist(p).find((x) => x.id === "dates");
  assert.ok(c && c.title === "Add the month to these dates" && c.items.map((x) => x.path).join() === `experience.${p.experience[1].id}`, JSON.stringify(c));
});

test("every number they gave reaches a line: the creator asks for a missing one, and the polish puts a dropped one back", async () => {
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/Write one resume line for each fact below/.test(sys)) return { lines: [{ n: 0, text: "Ran the register for about 200 customers a shift" }] };
    if (/write a one-page resume/.test(sys)) return { summary: "", jobs: [{ index: 0, bullets: [{ text: "Trained 4 new cashiers", source: "trained 4 new cashiers" }, { text: "Closed the store on weekends", source: "closed the store on weekends" }] }] };
    return {};
  };
  const c = await S.createFromInterview({ jobs: [{ title: "Cashier", employer: "Initech Market", start: "2019", end: "2022", daily: "ran the register, about 200 customers a shift, closed the store on weekends", proud: "trained 4 new cashiers" }] }, null, {});
  const lines = c.profile.experience[0].bullets.map((b) => b.text);
  assert.ok(lines.includes("Ran the register for about 200 customers a shift"), JSON.stringify(lines));
  // The polish chose two lines and left the one with "200" off: it goes back on, there's room for three.
  reply = (sys) => {
    if (/fact-check/.test(sys)) return { lines: [] };
    if (/turning a person's resume lines/.test(sys)) return { jobs: [{ i: 0, lines: [{ text: "Trained 4 new cashiers", from: [0] }, { text: "Closed the store on weekends", from: [1] }] }], headline: "", summary: "" };
    return {};
  };
  const pol = await P.polishCreated(c.profile, { ids: [c.profile.experience[0].id], linesOnly: true });
  const e = pol.profile.experience[0];
  assert.ok(e.bullets.slice(0, 3).some((b) => /200/.test(b.text)), JSON.stringify(e.bullets.map((b) => b.text)));
});

test("a rewording keeps the names in the line: dropping ChatGPT or Zendesk is refused", () => {
  const o = "Drafted an onboarding email sequence with ChatGPT, then edited every email; new-customer complaints dropped 31%";
  assert.match(P.vet("Cut new-customer complaints 31% by editing the onboarding email sequence", [o], { rules: {} }, [], o).why.join(), /leaves out chatgpt/);
  assert.ok(P.vet("Cut new-customer complaints 31% by drafting an onboarding email sequence with ChatGPT, then editing every email", [o], { rules: {} }, [], o).ok);
});
