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

export function readJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, name), "utf8")); } catch { return fallback; }
}

// Write to a temp file, then rename, so a crash never leaves half a file.
export function writeJSON(name, value) {
  const file = dataDir(name);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
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
  dayStartsAtHour: 9,        // the daily limit resets at this local hour
  minutesBetweenApplies: 6,
  maxAttempts: 2,
  searchEveryMinutes: 120,
  headless: false,           // older setting; windowMode replaces it
  // windowMode: minimized | visible | headless (unset: minimized, or headless for the old switch)
  browser: "auto",           // auto | chrome | msedge | chromium
  mailbox: null,             // { preset, host, port, user } ; the password lives in secrets
};

export const PREFS_DEFAULTS = {
  titles: [],                // target job titles, searched one by one
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
  excludeCompanies: [],
  excludeAgencies: true,
  postedWithinDays: 14,
  alreadyApplied: "",        // pasted list: URLs or "Company - Title" lines
  sources: ["greenhouse", "lever", "ashby"],
};

export const ANSWERS_DEFAULTS = {
  firstName: "", lastName: "", preferredName: "", email: "", phone: "",
  linkedin: "", github: "", website: "", otherLinks: "",
  street: "", city: "", state: "", zip: "", country: "United States",
  workAuthorized: "yes", needsSponsorship: "no", authCountry: "United States",
  education: [],             // [{ school, degree, field, start: "YYYY-MM", end: "YYYY-MM" }]
  years: [],                 // [{ type: "Software engineering", years: 2 }]
  totalYears: 0,             // all professional work, any field
  currentEmployer: "", currentTitle: "",
  noticePeriod: "2 weeks",
  startAvailability: "Two weeks after accepting an offer",
  relocation: "no",          // no | radius | anywhere
  arbitration: "never",      // never | plain | list
  arbitrationCompanies: [],
  screenings: "ask",         // ask | yes: background checks and drug tests if offered a job
  heardAbout: "Job board",
  over18: "yes",
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
export const savePrefs = (patch) => writeJSON("prefs.json", merge(getPrefs(), patch));
export const saveAnswers = (patch) => writeJSON("answers.json", merge(getAnswers(), patch));
export const saveProfile = (p) => writeJSON("profile.json", p);

// Secrets (API key, mailbox password). main.js plugs in safeStorage; tests and
// scripts read environment variables.
let secrets = {
  get: (k) => process.env[{ apiKey: "JA_API_KEY", mailPassword: "JA_MAIL_PASSWORD" }[k] || ""] || "",
  set: () => { throw new Error("secret storage is not available here"); },
};
export const setSecretStore = (s) => { secrets = s; };
export const getSecret = (k) => secrets.get(k);
export const setSecret = (k, v) => secrets.set(k, v);
