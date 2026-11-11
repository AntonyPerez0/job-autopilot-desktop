// Everything the app keeps lives in one folder: the OS app-data folder in the
// desktop app (set by main.js), or JA_DATA_DIR for tests and scripts.
// Small JSON files for what the user edits, SQLite (db.js) for jobs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let DIR = process.env.JA_DATA_DIR || path.join(os.tmpdir(), "job-autopilot-dev");

export function setDataDir(dir) { DIR = dir; fs.mkdirSync(DIR, { recursive: true }); }
export const dataDir = (...p) => {
  const d = path.join(DIR, ...p);
  fs.mkdirSync(p.length && path.extname(d) ? path.dirname(d) : d, { recursive: true });
  return d;
};

// The person's own files keep the copy from the save before (name.bak): if the computer loses power while one is
// being written and it can't be read afterwards, that copy is used, not a blank start (the setup all over again).
const KEPT = new Set(["settings.json", "prefs.json", "answers.json", "profile.json"]);
const parse = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

export function readJSON(name, fallback) {
  const file = path.join(DIR, name);
  try { return parse(file); } catch {
    if (KEPT.has(name)) { try { return parse(file + ".bak"); } catch { /* no earlier copy either */ } }
    return fallback;
  }
}

// Write to a temp file (all the way to the disk), then rename, so a crash never leaves half a file.
export function writeJSON(name, value) {
  const file = dataDir(name);
  const tmp = file + ".tmp";
  const fd = fs.openSync(tmp, "w");
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  if (KEPT.has(name)) { try { parse(file); fs.copyFileSync(file, file + ".bak"); } catch { /* nothing readable to keep */ } }
  fs.renameSync(tmp, file);
  return value;
}

export const SETTINGS_DEFAULTS = {
  onboarded: false,
  acceptedTerms: false,
  ai: { provider: "openrouter", apiBase: "https://openrouter.ai/api/v1", model: "z-ai/glm-5.3-flash", contextLength: 16384 },
  dryRun: true,              // new installs never submit until the user goes live
  reviewedDryRun: false,     // set when the user has checked a filled application
  wentLiveAt: null,
  paused: false,
  dailyCap: 10,
  textSize: 1,               // the window's zoom: 1, 1.15 or 1.3 (Settings > Appearance)
  uiMode: "simple",          // simple: only what most people need; advanced: everything
  dayStartsAtHour: 9,        // the daily limit resets at this local hour
  minutesBetweenApplies: 6,
  maxAttempts: 2,
  searchEveryMinutes: 120,
  headless: false,           // older setting; windowMode replaces it
  // windowMode: minimized | visible | headless (unset: minimized, or headless for the old switch)
  browser: "auto",           // auto | chrome | msedge | chromium
  mailbox: null,
  googleMonthlyCap: 200,     // SerpApi searches a month (its free plan has 250)
  historyBackup: true,       // keep applied-jobs.json.gz outside the app (survives reinstalls)
  historyFolder: null,       // null: Documents/Job Autopilot             // { preset, host, port, user } ; the password lives in secrets
  keepRunning: true,         // closing the window hides it to the menu bar / system tray; the autopilot keeps working
  openAtLogin: false,        // start (hidden) when the computer starts
  keepAwake: true,           // keep the computer awake while there are applications to send today
  notifications: true,       // a desktop notification when something needs the person
  setupStep: 0,              // where the first-run setup was left, to pick up there
  touredAt: null,            // when the short tour of the Overview was shown
  dismissed: [],             // to-do items the person said not to show again
};

export const PREFS_DEFAULTS = {
  titles: [],                // target job titles, searched one by one
  moveToward: "",            // Move up: work they'd like to move toward, in their words (a wish, not a fact)
  notForMe: [],              // Move up: [{code, title}] kinds of work they said aren't for them
  keywords: [],              // what the user wants the work to involve; given to the screening step
  titleExclude: [],          // extra words that rule a title out
  cities: [],                // [{ name, admin1, country, lat, lon }]
  radius: 25,
  radiusUnit: "mi",
  remote: true,
  remoteCountry: "US",
  seniority: ["junior", "middle"], // freehire levels the user accepts
  internships: false,
  maxYearsRequired: 3,
  yearsInField: null,        // years of the kind of work they look for (null: their resume's dates); with stretchYears, the most a job may ask
  stretchYears: 1,           // apply when a job asks for at most this many more years than they have (0: never)
  perCompanyMonth: 2,        // at most this many applications to one employer in 30 days (0: no limit)
  notForMeKinds: [],         // kinds of work (freehire categories) they said aren't for them
  keepKinds: [],             // kinds of work they want kept, even when the app would learn to leave them out
  watch: [],                 // companies they'd love to work for: [{ name, ats, token }], their job boards read directly
  referralHoldDays: 3,       // when they know someone there, wait this many days so they can ask for a referral (0: don't wait)
  excludeCompanies: [],
  excludeAgencies: true,
  postedWithinDays: 14,
  alreadyApplied: "",        // pasted list: URLs or "Company - Title" lines
  sources: ["greenhouse", "lever", "ashby"],
  jobKind: "both",           // office | hourly | both: what the setup suggests and screens for
  boards: { freehire: true, hiringcafe: true, simplify: false, google: false }, // where to look for jobs
};

export const ANSWERS_DEFAULTS = {
  firstName: "", lastName: "", preferredName: "", email: "", phone: "",
  linkedin: "", github: "", website: "", otherLinks: "",
  street: "", city: "", state: "", zip: "", county: "", country: "United States",
  workAuthorized: "", needsSponsorship: "", authCountry: "United States", // legal answers: never pre-filled
  education: [],             // [{ school, degree, field, start: "YYYY-MM", end: "YYYY-MM" }]
  years: [],                 // [{ type: "Software engineering", years: 2 }]
  totalYears: 0,             // all professional work, any field
  currentEmployer: "", currentTitle: "",
  noticePeriod: "2 weeks",
  startAvailability: "Two weeks after accepting an offer",
  relocation: "no",          // no | radius | anywhere
  arbitration: "never",      // never | plain | list
  arbitrationCompanies: [],
  screenings: "ask",
  // questions hourly-job forms ask a lot
  daysAvailable: [],         // ["Monday", ...]
  shifts: [],                // ["Mornings", "Afternoons", "Evenings", "Overnight"]
  hoursWanted: "either",     // full | part | either
  transportation: "",        // yes | no
  driversLicense: "",        // yes | no
  canLift: "",               // pounds the user can lift, e.g. "50"
  ownVehicle: "",            // yes | no: their own insured car (delivery jobs ask)
  drivingRecord: "",         // clean | no: a clean driving record
  over21: "",                // yes | no (driving and alcohol jobs ask)
  convictions: "ask",        // ask | none: criminal-history questions         // ask | yes: background checks and drug tests if offered a job
  heardAbout: "Job board",
  over18: "",
  citizen: "",               // U.S. citizen: yes | no | "" (federal jobs ask; never pre-filled)
  travel: "some",            // yes | some | no
  salary: "",
  demographics: { gender: "decline", race: "decline", hispanic: "decline", veteran: "decline", disability: "decline", lgbtq: "decline" },
  cannotClaim: [],
};

const merge = (defaults, saved) => {
  const out = { ...defaults, ...(saved || {}) };
  for (const k of Object.keys(defaults)) {
    const d = defaults[k];
    if (d && typeof d === "object" && !Array.isArray(d) && out[k] && typeof out[k] === "object") out[k] = { ...d, ...out[k] };
  }
  return out;
};

export const getSettings = () => merge(SETTINGS_DEFAULTS, readJSON("settings.json"));
export const getPrefs = () => merge(PREFS_DEFAULTS, readJSON("prefs.json"));
export const getAnswers = () => merge(ANSWERS_DEFAULTS, readJSON("answers.json"));
export const getProfile = () => readJSON("profile.json", null);

export const saveSettings = (patch) => writeJSON("settings.json", merge(getSettings(), patch));
// Preferences come from the window and reach the screening prompt and the job searches, so every list is
// bounded where it's saved: so many entries, so many characters, strings only.
const strs = (a, n, len) => (Array.isArray(a) ? a : []).filter((x) => typeof x === "string").map((x) => x.trim().slice(0, len)).filter(Boolean).slice(0, n);
const num = (x) => typeof x === "number" && Number.isFinite(x);
export function clampPrefs(patch = {}) {
  const p = { ...(patch && typeof patch === "object" && !Array.isArray(patch) ? patch : {}) };
  if ("titles" in p) p.titles = strs(p.titles, 25, 80);
  if ("keywords" in p) p.keywords = strs(p.keywords, 40, 60);
  if ("titleExclude" in p) p.titleExclude = strs(p.titleExclude, 100, 80);
  if ("excludeCompanies" in p) p.excludeCompanies = strs(p.excludeCompanies, 100, 80);
  if ("seniority" in p) p.seniority = strs(p.seniority, 10, 20);
  if ("sources" in p) p.sources = strs(p.sources, 20, 40);
  if ("notForMe" in p) p.notForMe = (Array.isArray(p.notForMe) ? p.notForMe : []).filter((x) => x && typeof x === "object" && typeof x.code === "string")
    .map((x) => ({ code: x.code.slice(0, 80), title: String(typeof x.title === "string" ? x.title : x.code).slice(0, 80) })).slice(0, 100);
  if ("cities" in p) p.cities = (Array.isArray(p.cities) ? p.cities : []).filter((c) => c && typeof c === "object" && num(c.lat) && num(c.lon))
    .map((c) => Object.fromEntries(Object.entries(c).filter(([, v]) => typeof v === "string" || num(v)).map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 100) : v]))).slice(0, 40);
  if ("jobKind" in p && !["office", "hourly", "both"].includes(p.jobKind)) delete p.jobKind;
  if ("moveToward" in p) p.moveToward = String(p.moveToward || "").slice(0, 300);
  if ("alreadyApplied" in p) p.alreadyApplied = String(p.alreadyApplied || "").slice(0, 50000);
  const pick = (k, ok, fallback) => { if (k in p && !ok.includes(Number(p[k]))) p[k] = fallback; else if (k in p) p[k] = Number(p[k]); };
  pick("stretchYears", [0, 1, 2], 1);
  if ("yearsInField" in p) p.yearsInField = p.yearsInField === null || p.yearsInField === "" || !Number.isFinite(Number(p.yearsInField)) ? null : Math.max(0, Math.min(50, Math.round(Number(p.yearsInField) * 2) / 2));
  pick("perCompanyMonth", [0, 1, 2, 3], 2);
  pick("referralHoldDays", [0, 2, 3, 5], 3);
  if ("notForMeKinds" in p) p.notForMeKinds = strs(p.notForMeKinds, 60, 40);
  if ("keepKinds" in p) p.keepKinds = strs(p.keepKinds, 60, 40);
  if ("watch" in p) p.watch = (Array.isArray(p.watch) ? p.watch : []).filter((w) => w && typeof w === "object" && ["greenhouse", "lever", "ashby"].includes(w.ats) && /^[A-Za-z0-9._-]{1,80}$/.test(String(w.token || "")))
    .map((w) => ({ name: String(w.name || w.token).slice(0, 80), ats: w.ats, token: String(w.token) })).slice(0, 30);
  return p;
}
export const savePrefs = (patch) => writeJSON("prefs.json", merge(getPrefs(), clampPrefs(patch)));
export const saveAnswers = (patch) => writeJSON("answers.json", merge(getAnswers(), patch));
export const saveProfile = (p) => writeJSON("profile.json", p);

// Secrets (API key, mailbox password). main.js plugs in safeStorage; tests and
// scripts read environment variables.
let secrets = {
  get: (k) => process.env[{ apiKey: "JA_API_KEY", mailPassword: "JA_MAIL_PASSWORD", sitePassword: "JA_SITE_PASSWORD" }[k] || ""] || "",
  set: () => { throw new Error("secret storage is not available here"); },
};
export const setSecretStore = (s) => { secrets = s; };
export const getSecret = (k) => secrets.get(k);
export const setSecret = (k, v) => secrets.set(k, v);
