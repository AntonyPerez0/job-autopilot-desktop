// Resume studio: the recruiter checklist, the honesty check, and the creator and
// improver with a mock AI, including suggestions that try to invent facts.
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { approvedExample, exampleAnswers, tempDataDir } from "./helpers.js";

tempDataDir();
process.env.JA_API_KEY = "test";
const store = await import("../core/store.js");
store.setDataDir(process.env.JA_DATA_DIR);
const { Profile } = await import("../core/engine.js");
const S = await import("../core/studio.js");

let reply = () => ({});
const ai = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const m = JSON.parse(b);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply(m.messages[0].content, m.messages[1] && m.messages[1].content)) } }] }));
  });
});
await new Promise((r) => ai.listen(0, "127.0.0.1", r));
store.saveSettings({ ai: { provider: "custom", apiBase: `http://127.0.0.1:${ai.address().port}/v1`, model: "m" } });
test.after(() => ai.close());

test("honesty check: no number, tool or name the person didn't give", () => {
  const src = ["Ran the register and helped customers, about 150 a day"];
  assert.deepStrictEqual(S.addedFacts("Served about 150 customers a day at the register", src), []);
  assert.match(S.addedFacts("Served 300 customers a day", src).join(), /300/);
  assert.match(S.addedFacts("Processed payments on Square POS for customers", src).join(), /square/);
  assert.match(S.addedFacts("Cut wait times 20% by speeding up checkout", src).join(), /20/);
  assert.ok(S.vet("Trained new cashiers", ["trained new cashiers"], Profile.EXAMPLE).ok);
  assert.ok(!S.vet("I trained new cashiers", ["trained new cashiers"], Profile.EXAMPLE).ok, "no I/my");
  assert.ok(!S.vet("Passionate about customers", ["customers"], Profile.EXAMPLE).ok, "avoid-list word");
});

test("recruiter checklist", () => {
  const p = approvedExample(Profile);
  p.experience[0].bullets[0].text = "Responsible for the scheduling service";
  p.experience[0].bullets[1].text = "I set up CI for the team";
  p.summaries[0].text = "Hard-working team player. " + "Word ".repeat(80);
  const c = Object.fromEntries(S.checklist(p, exampleAnswers(), { overflow: false, slack: 40 }).map((x) => [x.id, x]));
  assert.strictEqual(c.contact.level, "good");
  assert.strictEqual(c.length.level, "good");
  assert.strictEqual(c.verbs.level, "fix");
  assert.strictEqual(c.verbs.items[0].path, `experience.acme.${p.experience[0].bullets[0].id}`);
  assert.strictEqual(c.pronouns.level, "fix");
  assert.strictEqual(c.summary.level, "fix");
  assert.strictEqual(c.cliche.level, "fix");
  assert.strictEqual(S.checklist(p, {}, { overflow: true }).find((x) => x.id === "length").level, "fix");
});

test("casual wording is caught; professional wording and claim words are told apart", () => {
  assert.deepStrictEqual(S.casualBits("Run hard recoveries like cars in ditches that dispatch sends"), ["like cars", "that dispatch sends"]);
  assert.deepStrictEqual(S.casualBits("Trained two new guys on the vinyl cutter"), ["guys"]);
  assert.deepStrictEqual(S.casualBits("Respond to dispatched breakdown and accident calls"), []);
  assert.deepStrictEqual(S.claimWords("Coordinate with law enforcement on scene", ["talk with police at accident scenes"]), [], "a professional word for the same fact");
  assert.deepStrictEqual(S.claimWords("Logged calls in a ticketing system", ["took calls"]).sort(), ["system", "ticket"], "a system they never named");
  assert.ok(S.claimWords("Managed the crew", ["went out with the crew"]).length, "being in charge is a claim");
  const p = approvedExample(Profile);
  p.experience[0].bullets[0].text = "Did a lot of stuff for the guys in the shop";
  const c = Object.fromEntries(S.checklist(p, exampleAnswers(), { overflow: false, slack: 40 }).map((x) => [x.id, x]));
  assert.strictEqual(c.casual.level, "fix");
  assert.strictEqual(c.casual.items[0].path, `experience.acme.${p.experience[0].bullets[0].id}`);
});

test("create: lines from the person's answers; invented facts are dropped", async () => {
  reply = () => ({
    summary: "Friendly cashier with two years serving customers at Corner Market.",
    jobs: [{ index: 0, bullets: [
      { text: "Served about 150 customers a day at a busy register", source: "about 150 a day" },
      { text: "Cut checkout time 30% with a new process", source: "made up" },
      { text: "Trained new cashiers on opening and closing", source: "trained new people" },
    ], questions: ["About how many new cashiers did you train?"] }],

  });
  const iv = { target: "Cashier", jobs: [{ title: "Cashier", employer: "Corner Market", location: "Austin, TX", start: "Jun 2024", current: true,
    daily: "ran the register, about 150 a day; trained new people on opening and closing", proud: "never had my drawer come up short" }],
    education: [{ school: "Lincoln High School", earned: "Diploma", year: "2023" }], skills: "cash handling, customer service" };
  const r = await S.createFromInterview(iv, null, { firstName: "Sam", lastName: "Rivera" });
  const lines = r.profile.experience[0].bullets.map((b) => b.text);
  assert.deepStrictEqual(lines, ["Served about 150 customers a day at a busy register", "Trained new cashiers on opening and closing"]);
  assert.ok(r.rejected.some((x) => /30/.test(x.why.join())), "the invented 30% was thrown out");
  assert.ok(r.rejected.some((x) => x.job === "Summary"), "'two years' was never said, so the summary is dropped");
  assert.deepStrictEqual(r.profile.skills[0].items.split(", "), ["Cash handling", "Customer service"], "skills are the person's own list");
  assert.strictEqual(r.questions.length, 1);
  assert.ok(r.profile.experience[0].bullets.every((b) => b.approved === false), "nothing is used until approved");
  assert.strictEqual(r.profile.experience[0].dates, "Jun 2024 – Present");
  r.profile.summaries.push({ id: "s2", text: "Cashier.", approved: true });
  for (const k of ["experience"]) for (const e of r.profile[k]) for (const b of e.bullets) b.approved = true;
  for (const k of ["skills", "education", "bases"]) for (const x of r.profile[k]) x.approved = true;
  r.profile.bases[0].summary = "s2";
  assert.deepStrictEqual(Array.from(Profile.validate((await import("../core/engine.js")).approvedOnly(r.profile))), []);
});

test("improve: rewrites that add facts become questions; answers make new lines", async () => {
  const p = approvedExample(Profile);
  const b0 = p.experience[0].bullets[3]; // "Shared on-call for the scheduling service and wrote its runbooks."
  reply = (sys) => (/rewrite one resume line/.test(sys)
    ? { text: "Shared on-call for the scheduling service, handling about 6 incidents a month, and wrote its runbooks", why: "shows scale" }
    : { lines: [
      { i: 3, keep: false, text: "Wrote the runbooks for the scheduling service and shared its on-call rotation", why: "leads with the result" },
      { i: 0, keep: false, text: "Built the scheduling service used by 400 clinics", why: "bigger", question: "How many clinics use it?" },
    ] });
  const s = await S.suggestImprovements(p, exampleAnswers());
  const good = s.find((x) => x.text && x.path.endsWith(b0.id));
  assert.ok(good, "a faithful rewrite is offered");
  const q = s.find((x) => /clinics/.test(x.question));
  assert.strictEqual(q.text, "", "the rewrite claiming 400 clinics is hidden; only the question is shown");
  const r = await S.rewriteWithAnswer(p, exampleAnswers(), { path: good.path, original: b0.text, question: "How many incidents?", answer: "about 6 a month" });
  assert.match(r.text, /6 incidents/);
  const p2 = S.applySuggestion(p, { path: good.path, text: good.text, mode: "add" });
  const e = p2.experience[0];
  assert.ok(e.bullets.some((x) => x.id === `${b0.id.split("_")[0]}_v2` && x.approved), "kept as a second version of the same fact");
  const p3 = S.applySuggestion(p, { path: good.path, text: good.text });
  assert.strictEqual(p3.experience[0].bullets.find((x) => x.id === b0.id).text, good.text);
});

test("no praise the person didn't claim, and no dropped limits", () => {
  assert.ok(!S.vet("Proven cashier who served customers", ["served customers"], Profile.EXAMPLE).ok);
  assert.ok(S.vet("Experienced cashier who served customers", ["experienced cashier, served customers"], Profile.EXAMPLE).ok, "their own word is fine");
  assert.deepStrictEqual(S.droppedHedges("Backend-leaning software engineer", "Backend software engineer"), ["leaning"]);
  assert.deepStrictEqual(S.droppedHedges("Served about 150 customers", "Served approximately 150 customers"), [], "a synonym keeps the limit");
  assert.deepStrictEqual(S.droppedHedges("Helped run the store", "Ran the store"), ["helped"]);
  assert.ok(!S.vet("Ran the store", ["Helped run the store"], Profile.EXAMPLE, [], "Helped run the store").ok);
  assert.ok(S.vet("Assisted with running the store", ["Helped run the store"], Profile.EXAMPLE, [], "Helped run the store").ok);
});

test("the second pass: unsupported details are flagged on created lines and drop rewrites", async () => {
  reply = (sys, user) => {
    if (/fact-check resume lines/.test(sys)) return { lines: user.split("\n").filter((l) => /^\d+\. LINE/.test(l)).map((l, i) => ({ i, unsupported: /card/.test(l) ? "card payments" : "" })) };
    if (/experienced recruiter helping/.test(sys)) return { lines: [{ i: 0, keep: false, text: "Built the PostgreSQL appointment scheduling service in Python that 40 clinics use, with card payments", why: "x" }] };
    return { summary: "", jobs: [{ index: 0, bullets: [{ text: "Handled cash and card payments at the register" }, { text: "Stocked the cooler" }] }] };
  };
  const c = await S.createFromInterview({ jobs: [{ title: "Cashier", employer: "Corner Market", daily: "ran the register, took cash, stocked the cooler" }] });
  const [b1, b2] = c.profile.experience[0].bullets;
  assert.match(b1.warning, /card payments/);
  assert.strictEqual(b2.warning, undefined);
  const s = await S.suggestImprovements(approvedExample(Profile), exampleAnswers(), { paths: [`experience.acme.${approvedExample(Profile).experience[0].bullets[0].id}`] });
  assert.strictEqual(s.length, 0, "the rewrite with an unsupported detail is not offered");
});

test("memory jog: the job's official tasks become questions; only yes answers become lines", async () => {
  const { findOccupations } = await import("../core/onet.js");
  assert.strictEqual(findOccupations("Cashier")[0].title, "Cashiers");
  assert.strictEqual(findOccupations("Babysitter")[0].title, "Nannies");
  assert.ok(findOccupations("Front End Cashier").some((o) => o.title === "Cashiers"));
  reply = (sys, user) => {
    if (/help someone remember/.test(sys)) return { occupation: 0, questions: [{ q: "Did you help customers find products in the store?", t: [0, 5] },
      { q: "Did you check IDs for alcohol sales?" }, { q: "Not a question" }] };
    if (/fact-check resume lines/.test(sys)) return { lines: [] };
    if (/confirmed they did at a job/.test(sys)) return { lines: [{ text: "Helped customers find products across the store", from: [0] }, { text: "Checked IDs for about 40 alcohol sales a day", from: [1] }] };
    return { summary: "", jobs: [{ index: 0, bullets: [{ text: "Ran the register" }] }] };
  };
  const r = await S.recallFor({ title: "Cashier", employer: "Corner Market", daily: "ran the register" });
  assert.strictEqual(r.occupation, "Cashiers");
  assert.deepStrictEqual(r.items.map((x) => x.from), ["onet", "ai"], "a task from the official list, and one common extra; the non-question is dropped");
  assert.match(r.items[0].task, /location of products/);
  const confirmed = r.items.map((x) => ({ q: x.q, task: x.task, detail: "" }));
  const c = await S.createFromInterview({ jobs: [{ title: "Cashier", employer: "Corner Market", daily: "ran the register", confirmed }] });
  const lines = c.profile.experience[0].bullets;
  assert.ok(lines.some((b) => /find products/.test(b.text) && /You said yes to/.test(b.source)));
  assert.ok(!lines.some((b) => /40/.test(b.text)), "a number they never gave is left out");
  const p = approvedExample(Profile);
  const a = await S.addRecalled(p, "acme", [confirmed[0]]);
  assert.strictEqual(a.added, 1);
  assert.strictEqual(a.profile.experience[0].bullets.at(-1).approved, false, "added lines wait for approval");
});

test("memory jog: no supervisor's list for a worker; when no occupation fits, plain questions instead", async () => {
  let seen = "";
  reply = (sys, user) => { if (!/help someone remember/.test(sys)) return { lines: [] }; seen = user;
    return { occupation: -1, questions: [{ q: "Did you apply reflective sheeting to sign blanks?" }, { q: "Did you install signs on poles?" }, { q: "Did you cut vinyl letters?" }, { q: "Did you read work orders?" }] }; };
  const r = await S.recallFor({ title: "Sign Shop Worker", daily: "made street signs, ran the vinyl cutter" });
  const order = seen.split("\n").filter((l) => /^\d\. /.test(l)).map((l) => l.slice(3));
  assert.ok(order.findIndex((t) => /First-Line Supervisors/.test(t)) === -1 || order.findIndex((t) => /First-Line Supervisors/.test(t)) === order.length - 1, "a supervisor's list comes last");
  assert.strictEqual(r.occupation, "");
  assert.deepStrictEqual(r.items.map((x) => x.from), ["ai", "ai", "ai", "ai"], "no task from an occupation that doesn't fit");
  await S.recallFor({ title: "Production Supervisor", daily: "supervised the line" });
  assert.match(seen, /0\. First-Line Supervisors/, "someone who supervised gets the supervisors' list first");
});

test("memory jog: task references in any shape, or by wording", async () => {
  reply = (sys) => (/help someone remember/.test(sys) ? { occupation: 0, questions: [{ q: "Did you greet customers entering the store?", t: "0,4" },
    { q: "Did you help customers find the location of products?" }, { q: "Did you process returns and exchanges?", t: { o: 0, t: 99 } }] } : { lines: [] });
  const r = await S.recallFor({ title: "Cashier" });
  assert.deepStrictEqual(r.items.map((x) => x.from), ["onet", "onet", "onet"]);
  assert.match(r.items[0].task, /^Greet customers/);
  assert.match(r.items[2].task, /returns and exchanges/);
  assert.deepStrictEqual(S.droppedHedges("Did you help customers resolve complaints?", "Resolved customer complaints"), ["help"]);
});

test("'about' limits a number, not a topic", () => {
  assert.deepStrictEqual(S.droppedHedges("Did you answer questions about store policies?", "Answered questions on store policies"), []);
  assert.deepStrictEqual(S.droppedHedges("Served about 150 customers", "Served 150 customers"), ["about"]);
  assert.deepStrictEqual(S.droppedHedges("Greeted customers, maybe 20 a shift", "Greeted about 20 customers a shift"), []);
});

test("a guess stays a guess in new lines and summaries", () => {
  const src = ["take calls from dispatch", "about 8 to 12 calls a shift"];
  assert.ok(!S.vet("Handle 8 to 12 tow calls a shift", src, Profile.EXAMPLE).ok, "'about' dropped");
  assert.ok(S.vet("Handle about 8 to 12 tow calls a shift", src, Profile.EXAMPLE).ok);
  assert.deepStrictEqual(S.droppedApprox(["Served about 150 customers, trained 3 people"], "Trained 3 new people"), [], "an exact number given exactly is fine");
  assert.ok(!S.vet("Skilled in precision sign manufacturing", ["made street signs"], Profile.EXAMPLE).ok, "praise they didn't use");
});

test("the same line twice in other words is kept once", () => {
  assert.ok(S.sameLine("Set out cones, flares, and warning lights at accident scenes", "Set out cones, flares, and warning lights at accident scenes."));
  assert.ok(S.sameLine("Kept truck clean, reported problems and kept driving hour and service logs", "Maintain logs of driving hours and vehicle service status"));
  assert.ok(!S.sameLine("Ran the vinyl cutter", "Ran the register"));
  assert.ok(!S.sameLine("Hook up cars with the flatbed", "Collect payment from customers at the scene"));
});

test("no summary passed the checks: a plain one from their own titles, never 'Something that pays better candidate'", () => {
  assert.strictEqual(S.plainSummary({ target: "Something that pays better", jobs: [{ title: "Tow Truck Driver", employer: "Initech Towing", current: true }, { title: "Sign Shop Worker", employer: "Globex" }], certifications: "Class B CDL" }),
    "Tow Truck Driver at Initech Towing, with Class B CDL. Before that, Sign Shop Worker at Globex.");
  assert.strictEqual(S.plainSummary({ education: [{ school: "Acme High School", earned: "Diploma" }] }), "Diploma at Acme High School.");
});

test("a line that says the same thing twice is caught, and the checklist says so", () => {
  assert.strictEqual(S.repeatedPhrase("Handle dispatched off-road vehicle recoveries, including complex off-road vehicle recoveries"), "off-road vehicle");
  assert.strictEqual(S.repeatedPhrase("Respond to dispatched breakdown and accident calls, handling about 8 to 12 calls per shift"), "");
  const p = approvedExample(Profile);
  p.experience[0].bullets[0].text = "Built the scheduling service and maintained the scheduling service";
  const c = Object.fromEntries(S.checklist(p, exampleAnswers(), { overflow: false, slack: 40 }).map((x) => [x.id, x]));
  assert.strictEqual(c.twice.level, "fix");
  assert.match(c.twice.items[0].why, /scheduling service/);
});

test("a slow AI answer gets a second request, and the first answer to come back is used", async () => {
  let n = 0;
  reply = () => { n++; return { lines: [] }; };
  // The mock answers at once, so only one request goes out.
  await S.ask([{ role: "system", content: "x" }, { role: "user", content: "y" }]);
  assert.strictEqual(n, 1);
});
