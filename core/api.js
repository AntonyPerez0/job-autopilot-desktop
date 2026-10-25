// Everything the app window can ask for, as (route, body) -> JSON. main.js
// wires it to IPC; nothing listens on the network.
import fs from "node:fs";
import path from "node:path";
import { getDb, getJob, setJob, appliedToday, log } from "./db.js";
import { state, kick, forceSearch } from "./worker.js";
import {
  dataDir, getAnswers, getPrefs, getProfile, getSecret, getSettings, saveAnswers, savePrefs, saveProfile, saveSettings, setSecret,
} from "./store.js";
import { PROVIDERS, Profile, Tailor, aiSettings, approvedOnly, isLocal, listModels, loadProfile, providerOf, testAI } from "./engine.js";
import { importResumes } from "./importer.js";
import { PRESETS, testMailbox } from "./mail.js";
import { countries, searchCities } from "./geo.js";
import { browserOpen, detectBrowsers, installChromium, chromiumPath, showBrowser } from "./browser.js";
import { windowModeOf } from "./apply.js";
import { AGENCIES } from "./discover.js";

const EDITABLE = ["paused", "acceptedTerms", "windowMode", "dailyCap", "dayStartsAtHour", "minutesBetweenApplies", "postedWithinDays", "searchEveryMinutes", "headless", "browser", "maxAttempts"];
const bad = (msg, code = 400) => ({ error: msg, code });
// main.js plugs in the updater (it needs Electron); without it (tests, scripts) updates are off.
let updater = null;
export const setUpdater = (u) => { updater = u; };

export const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function status() {
  const db = getDb();
  const counts = Object.fromEntries(db.prepare("SELECT status, COUNT(*) n FROM jobs GROUP BY status").all().map((r) => [r.status, r.n]));
  const s = getSettings();
  const next = db.prepare(`SELECT slug, title, company FROM jobs WHERE status = 'queued' AND attempts < ?
    ORDER BY (work_mode = 'remote') ASC, posted_at DESC LIMIT 1`).get(s.maxAttempts) || null;
  const firstFilled = db.prepare("SELECT slug, title, company FROM jobs WHERE status = 'filled' ORDER BY updated_at ASC LIMIT 1").get() || null;
  const { wake, ...st } = state;
  return { state: st, counts, appliedToday: appliedToday(), settings: s, model: s.ai.model, serverNow: Date.now(), next, firstFilled, version: VERSION,
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
    hasKey: !!getSecret("apiKey"), hasMailPassword: !!getSecret("mailPassword"),
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
      profile = mergeProfiles(getProfile(), profile);
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
    return { url: `ap-file://resumes/${file}`, slack: r.slack, overflow: r.overflow, warnings: Array.from(r.warnings) };
  },
  "POST /api/answers/save": (b) => saveAnswers(b.answers || {}),
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
  "POST /api/browser/show": async (b) => ({ ok: await showBrowser(!!b.show) }),
  "POST /api/browser/install": async () => {
    try { return { ok: true, path: chromiumPath() || await installChromium() }; } catch (e) { return bad(e.message); }
  },
  "GET /api/update": async () => (updater ? updater.state() : { phase: "idle" }),
  "POST /api/update/check": async () => (updater ? updater.check() : bad("Updates are off here.")),
  "POST /api/update/install": async () => {
    if (!updater) return bad("Updates are off here.");
    try { return await updater.install(); } catch (e) { return bad(e.message, 409); }
  },

};

// body undefined means a read (GET), anything else a change (POST).
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

function jobRoute(slug, b) {
  const j = getJob(slug);
  if (!j) return bad("not found", 404);
  if (b && b.action) {
    if (b.action === "retry") {
      if (j.status === "applied" || j.status === "submitting") return bad("Already applied; it will not be sent twice.", 409);
      setJob(slug, { status: "queued", attempts: 0, reason: "queued again from the dashboard" });
    }
    if (b.action === "skip") {
      if (j.status === "applied" || j.status === "submitting") return bad("Already applied.", 409);
      setJob(slug, { status: "skipped", reason: "skipped from the dashboard" });
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
  delete d.fields;
  return { ...out, details: d };
}
