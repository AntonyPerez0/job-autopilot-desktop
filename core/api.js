// Everything the app window can ask for, as (route, body) -> JSON. main.js
// wires it to IPC; nothing listens on the network.
import fs from "node:fs";
import path from "node:path";
import { getDb, getJob, setJob, appliedToday, log } from "./db.js";
import { state, kick, forceSearch, searchBrowser } from "./worker.js";
import {
  dataDir, getAnswers, getPrefs, getProfile, getSecret, getSettings, saveAnswers, savePrefs, saveProfile, saveSettings, setSecret,
} from "./store.js";
import { PROVIDERS, Profile, Tailor, aiSettings, approvedOnly, isLocal, listModels, loadProfile, plan as planFor, providerOf, testAI } from "./engine.js";
import { importResumes } from "./importer.js";
import { PRESETS, testMailbox } from "./mail.js";
import { countries, searchCities } from "./geo.js";
import { browserOpen, detectBrowsers, installChromium, chromiumPath, showBrowser } from "./browser.js";
import { windowModeOf } from "./apply.js";
import { AGENCIES, lastSearch } from "./discover.js";
import { suggestTitles } from "./suggest.js";
import { makeVersion, polishCreated, recruiterReview } from "./polish.js";
import { plainAiError } from "./llm.js";
import { applyFill, fillQuestions } from "./fill.js";
import { listAccounts, passwordProblems } from "./accounts.js";
import { addJob } from "./addjob.js";
import { addRecalled, applySuggestion, checklist, createFromInterview, progress as writing, recallFor, rewriteWithAnswer, setProgress, suggestImprovements } from "./studio.js";
import { importProjects, listRepos, placeProjects, usernameOf } from "./github.js";
import { asksFor, removeYourAnswer, saveYourAnswers } from "./asked.js";
import { monthUse, testKey as testSerpKey } from "./sources/google.js";
import { testKey as testUsajobsKey } from "./sources/usajobs.js";
import { backupFile, collect, exportHistory, importHistory, peekBackup, writeBackup } from "./history.js";

const EDITABLE = ["paused", "acceptedTerms", "windowMode", "historyBackup", "historyFolder", "dailyCap", "dayStartsAtHour", "minutesBetweenApplies", "postedWithinDays", "searchEveryMinutes", "headless", "browser", "maxAttempts"];
const bad = (msg, code = 400) => ({ error: plainAiError(msg), code });
// main.js plugs in the updater (it needs Electron); without it (tests, scripts) updates are off.
let updater = null;
export const setUpdater = (u) => { updater = u; };

export const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Why jobs were skipped, in a few plain groups, for "nothing to apply to right now" on the Overview.
const SKIP_GROUPS = [
  [/class a\b|cdl-a\b/i, "need a Class A CDL"],
  [/endorsement|hazmat|tanker/i, "need a license endorsement you don't list"],
  [/licen[cs]e|certif|clearance|degree/i, "need a license, certificate or degree you don't list"],
  [/pays at most/i, "pay less than your lowest pay"],
  [/years|experience|senior|level/i, "ask for more or different experience"],
  [/miles|too far|location|relocat|remote|on-?site|outside/i, "are too far away or in the wrong place"],
  [/title|does not match|doesn't match|different (kind|role)|not a .* role|unrelated/i, "are a different kind of job than your titles"],
  [/already applied/i, "you already applied to"],
  [/closed/i, "had closed"],
  [/agency|staffing/i, "are from staffing agencies"],
];
function skipSummary(db) {
  const rows = db.prepare("SELECT reason FROM jobs WHERE status = 'skipped' AND updated_at > datetime('now', '-1 day')").all();
  const n = new Map();
  for (const { reason } of rows) { const g = (SKIP_GROUPS.find(([rx]) => rx.test(reason || "")) || [null, "other reasons"])[1]; n.set(g, (n.get(g) || 0) + 1); }
  return { total: rows.length, top: [...n].filter(([g]) => g !== "other reasons").sort((a, b) => b[1] - a[1]).slice(0, 3).map(([why, count]) => ({ why, count })) };
}

function status() {
  const db = getDb();
  const counts = Object.fromEntries(db.prepare("SELECT status, COUNT(*) n FROM jobs GROUP BY status").all().map((r) => [r.status, r.n]));
  const s = getSettings();
  const next = db.prepare(`SELECT slug, title, company FROM jobs WHERE status = 'queued' AND attempts < ?
    ORDER BY (reason LIKE 'you answered %') DESC, (work_mode = 'remote') ASC, posted_at DESC LIMIT 1`).get(s.maxAttempts) || null;
  const firstFilled = db.prepare("SELECT slug, title, company FROM jobs WHERE status = 'filled' ORDER BY updated_at ASC LIMIT 1").get() || null;
  const toAnswer = db.prepare("SELECT slug, title, company FROM jobs WHERE status = 'failed' AND reason LIKE 'could not fill every required field%' ORDER BY updated_at DESC").all();
  const { wake, ...st } = state;
  return { state: st, counts, appliedToday: appliedToday(), settings: s, model: s.ai.model, serverNow: Date.now(), next, firstFilled, toAnswer: { count: toAnswer.length, first: toAnswer[0] || null }, search: lastSearch.at ? { ...lastSearch, nextAt: state.nextSearch || null, skipped: lastSearch.done && !counts.queued ? skipSummary(db) : null } : null, version: VERSION,
    browser: { open: browserOpen(), mode: windowModeOf(s) }, update: updater ? updater.state() : null };
}

// First and last name, links, city and school found in an imported resume, to start the common questions with.
export function prefillAnswers(p, a = getAnswers()) {
  const out = { ...a };
  const set = (k, v) => { if (v && !out[k]) out[k] = v; };
  const [first, ...rest] = String(p.name || "").trim().split(/\s+/);
  set("firstName", first); set("lastName", rest.join(" "));
  const c = p.contact || {};
  set("email", c.email); set("phone", c.phone); set("linkedin", c.linkedin); set("github", c.github); set("website", c.website);
  const loc = String(c.location || "").split(",").map((x) => x.trim());
  if (loc[0]) set("city", loc[0]);
  if (loc[1]) set("state", loc[1]);
  const cur = (p.experience || []).find((e) => /present|current|now/i.test(e.dates || ""));
  if (cur) { set("currentEmployer", cur.org); set("currentTitle", cur.title); }
  // Years of experience from the resume's own job dates, when the person hasn't given them (forms ask a lot).
  if (!Number(out.totalYears) && (p.experience || []).some((e) => e.dates)) Object.assign(out, yearsFromInterview({ jobs: jobsFromDates(p.experience) }, out));
  if (!(out.education || []).length && (p.education || []).length) {
    out.education = p.education.map((e) => {
      const years = String(e.dates || "").match(/\b(19|20)\d\d\b/g) || [];
      const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const mm = (String(e.dates || "").toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:19|20)\d\d\b(?![\s\S]*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/) || [])[1];
      const end = years.length ? `${years[years.length - 1]}-${mm ? months[mm] : "05"}` : "";
      const start = years.length > 1 ? `${years[0]}-09` : "";
      const [degree, ...field] = String(e.detail || "").split(/,\s*/);
      return { school: e.school || "", degree: degree || "", field: field.join(", "), start, end };
    });
  }
  return out;
}

const ROUTES = {
  "GET /api/status": () => status(),
  "GET /api/jobs": (_, q) => {
    const st = q.get("status");
    const sql = `SELECT slug, title, company, location, work_mode, source, url, apply_url, salary, posted_at, found_at, status, reason,
      attempts, updated_at, applied_at, reviewed, resume_file, screenshot FROM jobs ${st ? "WHERE status = ?" : ""}
      ORDER BY CASE status WHEN 'working' THEN 0 WHEN 'applied' THEN 1 WHEN 'filled' THEN 2 WHEN 'queued' THEN 3 WHEN 'failed' THEN 4 ELSE 5 END,
      COALESCE(applied_at, updated_at) DESC LIMIT 1000`;
    return st ? getDb().prepare(sql).all(st) : getDb().prepare(sql).all();
  },
  "GET /api/events": () => getDb().prepare("SELECT * FROM events ORDER BY id DESC LIMIT 300").all(),
  "POST /api/search": () => { forceSearch(); return { ok: true }; },
  "POST /api/settings": (b) => {
    const cur = getSettings(), patch = {};
    for (const k of EDITABLE) if (k in b) patch[k] = typeof cur[k] === "number" ? Math.max(0, Number(b[k]) || 0) : typeof cur[k] === "boolean" ? !!b[k] : b[k];
    if ("dailyCap" in patch) patch.dailyCap = Math.min(100, patch.dailyCap);
    if ("dayStartsAtHour" in patch) patch.dayStartsAtHour = Math.min(23, patch.dayStartsAtHour);
    if ("minutesBetweenApplies" in patch) patch.minutesBetweenApplies = Math.max(1, patch.minutesBetweenApplies);
    if (b.dryRun === true) patch.dryRun = true;
    const s = saveSettings(patch);
    if ("historyFolder" in patch || patch.historyBackup) { try { writeBackup(VERSION); } catch { /* shown on the Settings card */ } }
    kick();
    return s;
  },
  // Going live: only after the user has checked a filled application, and only with an explicit confirmation.
  "POST /api/golive": (b) => {
    const s = getSettings();
    if (!s.reviewedDryRun) return bad("Review a filled application first: open it from the Overview and press \"I checked these answers\".", 409);
    if (b.confirm !== true) return bad("Going live needs your confirmation.", 409);
    log(null, `went live (daily limit ${s.dailyCap})`);
    const out = saveSettings({ dryRun: false, wentLiveAt: new Date().toISOString(), paused: false });
    kick();
    return out;
  },

  // ---------- configuration (onboarding and Settings) ----------
  "GET /api/config": () => ({
    settings: getSettings(), prefs: getPrefs(), answers: getAnswers(), profile: getProfile(),
    hasKey: !!getSecret("apiKey"), hasMailPassword: !!getSecret("mailPassword"), hasSerpKey: !!getSecret("serpApiKey"), hasUsajobsKey: !!(getSecret("usajobsKey") && getSettings().usajobsEmail), usajobsEmail: getSettings().usajobsEmail || "", googleUse: monthUse(),
    presets: PRESETS, agencies: AGENCIES, providers: PROVIDERS, version: VERSION, dataDir: dataDir(),
  }),
  "POST /api/ai/test": async (b) => {
    const s = getSettings().ai;
    const cfg = { provider: b.provider || s.provider, apiBase: b.apiBase || s.apiBase, apiKey: b.apiKey || getSecret("apiKey"), model: b.model || s.model, contextLength: b.contextLength || s.contextLength };
    if (!cfg.apiKey && !isLocal(cfg)) return bad("Paste your API key first.");
    try { return await testAI(cfg); }
    catch (e) {
      if (isLocal(cfg) && /fetch failed|ECONNREFUSED/i.test(e.message)) return bad(`Nothing is answering at ${cfg.apiBase}. Start ${PROVIDERS[providerOf(cfg)].name.replace(/ \(.*/, "")} and try again.`);
      return bad(e.message);
    }
  },
  "POST /api/ai/models": async (b) => {
    try { return await listModels({ apiBase: b.apiBase || getSettings().ai.apiBase, apiKey: b.apiKey || getSecret("apiKey") }); } catch (e) { return bad(e.message); }
  },
  "POST /api/ai/save": async (b) => {
    if (b.apiKey) await setSecret("apiKey", String(b.apiKey).trim());
    const ai = { ...getSettings().ai };
    if (b.apiBase) ai.apiBase = String(b.apiBase).trim();
    if (b.model) ai.model = String(b.model).trim();
    if (b.provider && PROVIDERS[b.provider]) ai.provider = b.provider;
    if (b.contextLength) ai.contextLength = Math.max(4096, Number(b.contextLength) || 16384);
    saveSettings({ ai });
    return { ok: true, hasKey: !!getSecret("apiKey") };
  },
  "POST /api/resumes/import": async (b) => {
    const files = (b.files || []).map((f) => ({ name: f.name, bytes: Buffer.from(f.b64, "base64") }));
    if (!files.length && !b.text) return bad("Add at least one resume.");
    if (!aiSettings().apiKey) return bad("Add your AI key first (step 1).");
    let profile;
    try {
      if (b.text) profile = (await importResumes([{ name: "pasted.txt", bytes: Buffer.from(String(b.text)) }])).profile;
      else profile = (await importResumes(files)).profile;
    } catch (e) { return bad(e.message); }
    if (b.merge && getProfile()) {
      const { mergeProfiles } = await import("./importer.js");
      profile = placeProjects(mergeProfiles(getProfile(), profile));
    }
    saveProfile(profile);
    saveAnswers(prefillAnswers(profile));
    return { profile, answers: getAnswers() };
  },
  "POST /api/profile/save": (b) => {
    if (!b.profile || typeof b.profile !== "object") return bad("No profile.");
    saveProfile(b.profile);
    const errs = Profile.validate(approvedOnly(b.profile));
    return { ok: true, problems: Array.from(errs) };
  },
  "POST /api/profile/example": () => {
    const p = JSON.parse(JSON.stringify(Profile.EXAMPLE));
    for (const k of ["summaries", "headers", "skills", "education", "bases"]) for (const x of p[k] || []) x.approved = false;
    for (const k of ["experience", "projects"]) for (const e of p[k]) for (const x of e.bullets) x.approved = false;
    saveProfile(p);
    return { profile: p };
  },
  "POST /api/profile/preview": async (b) => {
    let p;
    try { p = loadProfile(b.profile || getProfile()); } catch (e) { return bad(e.message); }
    const base = p.bases.find((x) => x.id === b.base) || p.bases[0];
    const { spec } = Tailor.checkPlan(p, { base: base.id });
    const r = await Tailor.fit(p, spec, []);
    const file = `preview-${base.id.replace(/[^A-Za-z0-9-]/g, "_")}-${Date.now()}.pdf`;
    fs.writeFileSync(path.join(dataDir("resumes"), file), Buffer.from(r.pdf));
    return { url: `ap-file://resumes/${file}`, file, fileName: Tailor.fileName(p, { employer: "", jobTitle: "" }), slack: r.slack, overflow: r.overflow, warnings: Array.from(r.warnings) };
  },
  "POST /api/answers/save": (b) => saveAnswers(b.answers || {}),
  // Job site accounts: the email and one password the app signs up with (Workday), only if the user turns it on.
  "GET /api/accounts": () => {
    const a = getSettings().siteAccounts || {};
    return { enabled: !!a.enabled, consent: !!a.consent, email: a.email || getAnswers().email || "", hasPassword: !!getSecret("sitePassword"),
      mailbox: !!(getSettings().mailbox && getSecret("mailPassword")), sites: listAccounts() };
  },
  "POST /api/accounts/save": async (b) => {
    const before = getSettings().siteAccounts || {};
    const email = String(b.email || "").trim();
    const password = String(b.password || "");
    if (b.enabled) {
      if (!b.consent) return bad("Tick the box to let the app accept each site's terms of use when it makes an account.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Type the email the accounts should use.");
      if (!password && !getSecret("sitePassword")) return bad("Type the password the accounts should use.");
      const problems = password ? passwordProblems(password) : [];
      if (problems.length) return bad(`Job sites will refuse this password. It needs ${problems.join(", ")}.`);
    }
    if (password) await setSecret("sitePassword", password);
    saveSettings({ siteAccounts: { enabled: !!b.enabled, consent: !!b.consent, email } });
    // Turned on: the Workday jobs waiting in "Apply yourself" are the app's to apply to now.
    let requeued = 0;
    if (b.enabled && !before.enabled) {
      requeued = getDb().prepare("UPDATE jobs SET status = 'queued', attempts = 0, reason = 'the app can make the account now' WHERE status = 'manual' AND (source = 'workday' OR apply_url LIKE '%myworkdayjobs.com%' OR apply_url LIKE '%.myworkday.com%')").run().changes;
      if (requeued) log(null, `${requeued} Workday job${requeued === 1 ? "" : "s"} moved from Apply yourself to the queue: the app can make the accounts now`);
      kick();
    }
    return { ok: true, requeued };
  },
  // "Not sure what to look for?": titles from the approved resume, the ones that tend to pay more first.
  "POST /api/prefs/suggest": async () => {
    if (!aiSettings().apiKey) return bad("Connect an AI first (Settings > AI).");
    try { return { titles: await suggestTitles() }; } catch (e) { return bad(e.message); }
  },
  // Answers the user gave to questions the app stopped on.
  "GET /api/your-answers": () => (getAnswers().yourAnswers || []),
  "POST /api/your-answers/remove": (b) => { removeYourAnswer(String(b.key || ""), b.scope); return getAnswers().yourAnswers || []; },
  // ---------- resume studio: create, check, improve ----------
  "GET /api/resume/progress": () => ({ ...writing }),
  "POST /api/resume/create": async (b) => {
    if (!aiSettings().apiKey) return bad("Connect an AI first (Settings > AI).");
    const iv = b.interview || {};
    if (!(iv.jobs || []).some((j) => j.title || j.employer) && !(iv.education || []).some((e) => e.school)) return bad("Add at least one job or school.");
    try {
      setProgress(0, 4, "Starting");
      const r = await createFromInterview(iv, b.merge ? getProfile() : null, getAnswers());
      // Then the recruiter's pass: the strongest lines first, a headline and summary, skills in groups.
      try {
        const pol = await polishCreated(r.profile, { target: iv.target, ids: r.created.experience, skillIds: r.created.skills, answers: getAnswers() });
        r.profile = pol.profile;
        r.rejected.push(...pol.rejected);
      } catch (e) { log(null, "resume polish skipped: " + e.message, "warn"); }
      placeProjects(r.profile);
      saveProfile(r.profile);
      const cur = (iv.jobs || []).find((j) => j.current) || (iv.jobs || [])[0];
      if (cur) saveAnswers(prefillAnswers({ ...r.profile, experience: [{ title: cur.title, org: cur.employer, dates: cur.current ? "Present" : "" }] }));
      saveAnswers(yearsFromInterview(iv, getAnswers()));
      return { profile: r.profile, answers: getAnswers(), rejected: r.rejected, questions: r.questions };
    } catch (e) { return bad(e.message); }
  },
  // Projects from the user's public GitHub repositories.
  "GET /api/github/repos": async (_, q) => {
    try { return await listRepos(q.get("user")); } catch (e) { return bad(e.message); }
  },
  "POST /api/github/import": async (b) => {
    if (!aiSettings().apiKey) return bad("Connect an AI first (Settings > AI).");
    const u = usernameOf(b.user);
    if (!u) return bad("Type your GitHub username first.");
    if (!(b.repos || []).length) return bad("Tick at least one project.");
    try {
      const r = await importProjects(getProfile(), u, b.repos, getAnswers());
      saveProfile(r.profile);
      if (!getAnswers().github) saveAnswers({ github: `https://github.com/${u}` });
      return { ...r, answers: getAnswers() };
    } catch (e) { return bad(e.message); }
  },
  // Jog the memory: "Did you also ...?" from the official task list for that kind of job.
  "POST /api/resume/recall": async (b) => {
    const job = b.job || {};
    if (!job.entryId && !String(job.title || "").trim()) return bad("Type the job title first.");
    if (job.entryId) {
      const e = [...(getProfile().experience || []), ...(getProfile().projects || [])].find((x) => x.id === job.entryId);
      if (!e) return bad("That job is gone.");
      Object.assign(job, { title: e.title, employer: e.org, existing: (e.bullets || []).map((x) => x.text) });
    }
    try { return await recallFor(job); } catch (e) { return bad(e.message); }
  },
  "POST /api/resume/recall/add": async (b) => {
    if (!(b.confirmed || []).length) return bad("Say yes to at least one thing first.");
    try { const r = await addRecalled(getProfile(), b.entryId, b.confirmed, getAnswers()); saveProfile(r.profile); return r; } catch (e) { return bad(e.message); }
  },
  // A version of the resume for one kind of job, and a recruiter's read of a version.
  "POST /api/resume/version": async (b) => {
    const target = String(b.target || "").trim();
    if (!target) return bad("Type the kind of job, e.g. CDL driving or IT support.");
    if (!aiSettings().apiKey) return bad("Connect an AI first (Settings > AI).");
    try { const r = await makeVersion(getProfile(), target, getAnswers()); saveProfile(r.profile); return r; } catch (e) { return bad(e.message); }
  },
  "POST /api/resume/review": async (b) => {
    if (!aiSettings().apiKey) return bad("Connect an AI first (Settings > AI).");
    try { return await recruiterReview(getProfile(), { base: b.base, target: b.target }); } catch (e) { return bad(e.message); }
  },
  // "Fill out my page": questions about what people usually leave out, and the answers turned into pieces.
  "POST /api/resume/fill/questions": async () => {
    if (!getProfile()) return bad("Make your resume first.");
    if (!aiSettings().apiKey) return { ...(await fillQuestions({ ...getProfile(), bases: [] })), numbers: [] };
    try { return await fillQuestions(getProfile()); } catch (e) { return bad(e.message); }
  },
  "POST /api/resume/fill/apply": async (b) => {
    if (!getProfile()) return bad("Make your resume first.");
    if (!aiSettings().apiKey) return bad("Connect an AI first (Settings > AI).");
    try { const r = await applyFill(getProfile(), b.input || {}, getAnswers()); placeProjects(r.profile); saveProfile(r.profile); return r; } catch (e) { return bad(e.message); }
  },
  "POST /api/resume/check": async () => {
    const raw = getProfile();
    if (!raw) return bad("No resume yet.");
    let fit = null;
    try {
      const p = loadProfile(raw);
      const { spec } = Tailor.checkPlan(p, { base: p.bases[0].id });
      const r = await Tailor.fit(p, spec, []);
      fit = { overflow: r.overflow, slack: r.slack };
    } catch { /* not enough approved yet: the list says what is missing */ }
    return { checks: checklist(raw, getAnswers(), fit) };
  },
  "POST /api/resume/improve": async (b) => {
    if (!getProfile()) return bad("No resume yet.");
    try { return { suggestions: await suggestImprovements(getProfile(), getAnswers(), { paths: b.paths || null }) }; } catch (e) { return bad(e.message); }
  },
  "POST /api/resume/answer": async (b) => {
    if (!String(b.answer || "").trim()) return bad("Type your answer first.");
    try { return await rewriteWithAnswer(getProfile(), getAnswers(), b); } catch (e) { return bad(e.message); }
  },
  "POST /api/resume/apply": (b) => {
    if (!String(b.text || "").trim()) return bad("The line is empty.");
    try { const p = applySuggestion(getProfile(), b); saveProfile(p); return { ok: true, profile: p }; } catch (e) { return bad(e.message); }
  },
  "POST /api/prefs/save": (b) => savePrefs(b.prefs || {}),
  "GET /api/cities": (_, q) => searchCities(q.get("q") || ""),
  "GET /api/countries": () => countries(),
  "POST /api/mail/test": async (b) => {
    const pass = b.pass || getSecret("mailPassword");
    try { await testMailbox({ host: b.host, port: Number(b.port) || 993, user: b.user, pass }); return { ok: true }; }
    catch (e) { return bad(/auth|login|credentials|invalid/i.test(e.message) ? "The mailbox refused the email or app password. Check both, and that it is an app password, not your normal password." : e.message); }
  },
  "POST /api/mail/save": async (b) => {
    if (b.pass) await setSecret("mailPassword", String(b.pass).replace(/\s+/g, ""));
    saveSettings({ mailbox: { preset: b.preset, host: b.host, port: Number(b.port) || 993, user: b.user } });
    return { ok: true };
  },
  "POST /api/mail/remove": async () => { await setSecret("mailPassword", ""); saveSettings({ mailbox: null }); return { ok: true }; },
  "POST /api/onboarding/finish": () => {
    try { loadProfile(); } catch (e) { return bad(e.message); }
    const p = getPrefs();
    if (!(p.titles || []).length) return bad("Add at least one job title in Job preferences.");
    if (!(p.cities || []).length && !p.remote) return bad("Add a city or allow remote jobs in Job preferences.");
    const s = saveSettings({ onboarded: true, dryRun: true, paused: false });
    return { ok: true, settings: s };
  },
  "POST /api/browser/detect": async () => detectBrowsers(),
  // ---------- a job from anywhere: the user pastes its link ----------
  "POST /api/jobs/add": async (b) => {
    try { const r = await addJob(b.url, { browserPage: searchBrowser }); kick(); return r; } catch (e) { return bad(e.message); }
  },
  // ---------- Google Jobs through the user's own SerpApi key ----------
  "POST /api/google/save": async (b) => {
    const key = String(b.key || "").trim() || getSecret("serpApiKey");
    if (!key) return bad("Paste your SerpApi key.");
    try { const t = await testSerpKey(key); await setSecret("serpApiKey", key); savePrefs({ boards: { ...getPrefs().boards, google: true } }); return { ok: true, ...t }; }
    catch (e) { return bad("SerpApi refused that key: " + e.message); }
  },
  // ---------- USAJOBS (federal jobs) through the user's own free key ----------
  "POST /api/usajobs/save": async (b) => {
    const key = String(b.key || "").trim() || getSecret("usajobsKey"), email = String(b.email || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("Type the email address you put on the USAJOBS request form.");
    if (!key) return bad("Paste the key USAJOBS emailed you.");
    try { await testUsajobsKey(key, email); } catch (e) { return bad(e.message); }
    await setSecret("usajobsKey", key);
    saveSettings({ usajobsEmail: email });
    savePrefs({ boards: { ...getPrefs().boards, usajobs: true } });
    return { ok: true };
  },
  "POST /api/usajobs/remove": async () => { await setSecret("usajobsKey", ""); saveSettings({ usajobsEmail: "" }); savePrefs({ boards: { ...getPrefs().boards, usajobs: false } }); return { ok: true }; },
  "POST /api/google/remove": async () => { await setSecret("serpApiKey", ""); savePrefs({ boards: { ...getPrefs().boards, google: false } }); return { ok: true }; },
  "POST /api/browser/show": async (b) => ({ ok: await showBrowser(!!b.show) }),
  "POST /api/browser/install": async () => {
    try { return { ok: true, path: chromiumPath() || await installChromium() }; } catch (e) { return bad(e.message); }
  },
  // ---------- application history (never apply twice, across reinstalls and computers) ----------
  "GET /api/history": () => ({ file: backupFile(), enabled: getSettings().historyBackup !== false, local: collect().length, backup: peekBackup() }),
  "POST /api/history/import": (b) => {
    try {
      const buf = b.b64 ? Buffer.from(b.b64, "base64") : b.fromBackup && backupFile() ? fs.readFileSync(backupFile()) : null;
      if (!buf) return bad("Choose a history file.");
      const r = importHistory(buf);
      try { writeBackup(VERSION); } catch { /* the import itself worked */ }
      return r;
    } catch (e) { return bad(e.message); }
  },
  "POST /api/history/backup": () => { try { return { file: writeBackup(VERSION) }; } catch (e) { return bad(e.message); } },
  "POST /api/history/export": () => ({ b64: exportHistory(VERSION).toString("base64"), count: collect().length }),
  "GET /api/update": async () => (updater ? updater.state() : { phase: "idle" }),
  "POST /api/update/check": async () => (updater ? updater.check() : bad("Updates are off here.")),
  "POST /api/update/install": async () => {
    if (!updater) return bad("Updates are off here.");
    try { return await updater.install(); } catch (e) { return bad(e.message, 409); }
  },

};

// body undefined means a read (GET), anything else a change (POST).
// Forms ask "how many years of X": the creator's own start and end dates answer it for each kind of
// work, and in total. Only months the person gave count; anything already filled in stays.
const MONTH = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function monthOf(s, now = new Date()) {
  const t = String(s || "").toLowerCase();
  if (/present|now|current/.test(t)) return now.getFullYear() * 12 + now.getMonth();
  const y = t.match(/\b(19|20)\d\d\b/);
  if (!y) return null;
  const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  return Number(y[0]) * 12 + (m ? MONTH[m[1]] : 6);
}
// "Jun 2023 – Present" -> { start: "Jun 2023", end: "", current: true }, for the years count above.
export function jobsFromDates(experience) {
  return (experience || []).map((e) => {
    const [start, end = ""] = String(e.dates || "").split(/\s*(?:–|—|-|\bto\b)\s*/i);
    return { title: e.title, start, end, current: /present|now|current/i.test(end) };
  });
}
export function yearsFromInterview(iv, a, now = new Date()) {
  const years = [...(a.years || [])];
  const spans = [];
  for (const j of iv.jobs || []) {
    const s = monthOf(j.start, now), e = j.current ? monthOf("present", now) : monthOf(j.end, now);
    if (s === null || e === null || e < s || !j.title) continue;
    spans.push([s, e]);
    const n = Math.floor(((e - s + 1) / 12) * 2) / 2; // rounded down: never more than they worked
    if (n > 0 && !years.some((y) => String(y.type).toLowerCase() === String(j.title).toLowerCase())) years.push({ type: j.title, years: n });
  }
  const out = { years };
  if (!Number(a.totalYears) && spans.length) {
    // Months worked, overlapping jobs counted once.
    const months = new Set();
    for (const [s, e] of spans) for (let m = s; m <= e; m++) months.add(m);
    out.totalYears = Math.floor((months.size / 12) * 2) / 2;
  }
  return out;
}

export async function handle(route, body) {
  const u = new URL(String(route), "http://app");
  const method = body === undefined || body === null ? "GET" : "POST";
  try {
    if (u.pathname.startsWith("/api/job/")) return jobRoute(decodeURIComponent(u.pathname.slice(9)), method === "POST" ? body : null);
    const fn = ROUTES[`${method} ${u.pathname}`];
    if (!fn) return bad("not found", 404);
    return await fn(body || {}, u.searchParams);
  } catch (e) { return bad(e.message, 500); }
}

// A resume for a job the person applies to themselves (a federal job on USAJOBS, a Workday site): the same
// one-page tailoring the autopilot does, from approved pieces only, without filling any form.
async function resumeFor(j) {
  if (!aiSettings().apiKey) return bad("Connect an AI first (Settings > AI).");
  const profile = loadProfile();
  const d = JSON.parse(j.details || "{}");
  const text = `${j.title} at ${j.company}${j.location ? " (" + j.location + ")" : ""}\n\nFROM THE JOB LISTING:\n${String(d.description || "").slice(0, 30000)}`;
  const p = await planFor(profile, { url: j.url, text, fields: [] });
  const { spec } = Tailor.checkPlan(profile, p);
  const r = await Tailor.fit(profile, spec, []);
  if (r.overflow) return bad("The resume runs past one page with what's approved. Shorten a line on the Resume page and try again.");
  const file = `${String(j.slug).replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
  fs.writeFileSync(path.join(dataDir("resumes"), file), Buffer.from(r.pdf));
  setJob(j.slug, { resume_file: file });
  log(j.slug, "made a resume for this job, for you to upload yourself");
  return null;
}

async function jobRoute(slug, b) {
  const j = getJob(slug);
  if (!j) return bad("not found", 404);
  if (b && b.action === "resume") { try { const e = await resumeFor(j); if (e) return e; } catch (e) { return bad(e.message); } }
  else if (b && b.action) {
    if (b.action === "retry") {
      if (j.status === "applied" || j.status === "submitting") return bad("Already applied; it will not be sent twice.", 409);
      setJob(slug, { status: "queued", attempts: 0, reason: "queued again from the dashboard" });
    }
    if (b.action === "skip") {
      if (j.status === "applied" || j.status === "submitting") return bad("Already applied.", 409);
      setJob(slug, { status: "skipped", reason: "skipped from the dashboard" });
    }
    // From "Apply yourself": the user applied on the site themselves.
    if (b.action === "applied-myself") {
      if (j.status === "applied") return bad("Already marked as applied.", 409);
      setJob(slug, { status: "applied", applied_at: new Date().toISOString(), reason: "applied by you" });
      log(slug, "you applied to this one yourself");
    }
    // The user answered the questions the app stopped on: keep the answers, and try the job again.
    if (b.action === "answer") {
      if (j.status === "applied" || j.status === "submitting") return bad("Already applied; it will not be sent twice.", 409);
      const n = saveYourAnswers(j, b.answers);
      if (!n) return bad("Type an answer first.");
      setJob(slug, { status: "queued", attempts: 0, reason: `you answered ${n} question${n === 1 ? "" : "s"}; trying again with your answer${n === 1 ? "" : "s"}` });
      log(slug, `you answered ${n} question${n === 1 ? "" : "s"}; queued again`);
    }
    if (b.action === "reviewed") {
      if (j.status !== "filled") return bad("Only a filled (dry run) application can be reviewed.", 409);
      setJob(slug, { reviewed: 1 });
      saveSettings({ reviewedDryRun: true });
      log(slug, "you checked this filled application");
    }
    kick();
  }
  const out = getJob(slug);
  const d = JSON.parse(out.details || "{}");
  const asks = asksFor(out, d);
  delete d.fields;
  return { ...out, details: d, asks };
}
