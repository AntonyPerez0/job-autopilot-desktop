// People the person knows, from the connections file LinkedIn lets anyone download (Connections.csv): who works
// where, so a job at a company where they know someone can wait a few days while they ask for a referral, which
// gets far more replies than applying cold. Kept on this computer only.
import fs from "node:fs";
import { dataDir } from "./store.js";
import { companyKey } from "./dedupe.js";

const FILE = () => dataDir("connections.json");

// CSV with quoted fields ("Acme, Inc."), doubled quotes inside them, and CRLF lines.
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// LinkedIn's export starts with a few lines of notes before its header row.
export function parseConnections(text) {
  const rows = parseCsv(text);
  const h = rows.findIndex((r) => r.some((x) => /^first name$/i.test(x.trim())) && r.some((x) => /^company$/i.test(x.trim())));
  if (h < 0) throw new Error("This isn't LinkedIn's Connections.csv: its first row should have First Name, Last Name, Company and Position.");
  const col = (name) => rows[h].findIndex((x) => x.trim().toLowerCase() === name);
  const [fn, ln, url, co, pos] = ["first name", "last name", "url", "company", "position"].map(col);
  return rows.slice(h + 1).map((r) => ({ first: (r[fn] || "").trim(), last: (r[ln] || "").trim(), url: /^https:\/\/(www\.)?linkedin\.com\//.test((r[url] || "").trim()) ? r[url].trim() : "",
    company: (r[co] || "").trim(), position: (r[pos] || "").trim() })).filter((p) => p.first && p.company).slice(0, 30000)
    .map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.slice(0, 200)])));
}

export const saveConnections = (list) => { fs.writeFileSync(FILE(), JSON.stringify({ at: new Date().toISOString(), people: list })); return list.length; };
export function loadConnections() { try { return JSON.parse(fs.readFileSync(FILE(), "utf8")) || { people: [] }; } catch { return { people: [] }; } }
export const clearConnections = () => { try { fs.unlinkSync(FILE()); } catch { /* none */ } };

// The same employer: the same name without its legal form ("Google LLC" is "Google"), or one name the start of the
// other ("Meta" and "Meta Platforms", but never "Meta" and "Metal").
export function sameEmployer(a, b) {
  const x = companyKey(a).split(" ").filter(Boolean), y = companyKey(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.join(" ").length < 3) return short.join(" ") === long.join(" ");
  return short.every((w, i) => long[i] === w);
}

export function peopleAt(company, list = loadConnections().people) {
  return (list || []).filter((p) => sameEmployer(p.company, company)).slice(0, 20);
}

// One of a few wordings, always the same for the same words: the same message sent to many people, word for word, is
// what spam filters (LinkedIn's among them) look for.
export function wording(variants, ...key) {
  let h = 0;
  for (const c of key.join("|").toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return variants[h % variants.length];
}

// A short note asking for a referral, in the person's name, for them to change and send themselves.
const ASKS = [
  (p, j, link) => `Hi ${p.first}, I hope you're doing well! I'm applying for the ${j.title} role at ${j.company}${link}. Would you be open to referring me, or pointing me to the right person on the team? I'd be glad to send my resume. Thank you!`,
  (p, j, link) => `Hi ${p.first}, I saw the ${j.title} opening at ${j.company}${link}, and I'd like to apply. Since you work there, would you be comfortable referring me, or telling me a little about the team? Happy to share my resume. Thanks so much!`,
  (p, j, link) => `Hello ${p.first}! I'm interested in the ${j.title} opening at ${j.company}${link}. If you think I'd be a good fit, would you be willing to refer me? I can send my resume and a short summary of my experience. Thank you for considering it!`,
];
export function referralNote(person, job, me = {}) {
  const link = job.url ? ` (${job.url})` : "";
  const ask = wording(ASKS, person.first, person.last, job.company, job.title);
  return `${ask(person, job, link)}\n${[me.firstName, me.lastName].filter(Boolean).join(" ")}`.trim();
}
