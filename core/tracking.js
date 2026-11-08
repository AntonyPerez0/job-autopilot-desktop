// After applying: where each application stands (from the employer's replies, or what the person says), which ones
// are worth a follow-up, and what's working: which places, job titles and resume versions get answers.
import { getDb } from "./db.js";
import { titleOk } from "./discover.js";
import { loadConnections, peopleAt, wording } from "./referrals.js";

export const STAGES = { waiting: "Waiting to hear", interviewing: "Interviewing", offer: "Offer", rejected: "Not selected", withdrew: "You withdrew" };
const parse = (s) => { try { return JSON.parse(s || "{}") || {}; } catch { return {}; } };
const SENT = "status IN ('applied', 'submitting') AND applied_at IS NOT NULL";

// What the replies say, newest decisive one first; what the person set wins.
export function stageOf(job, replies = []) {
  if (job.stage && STAGES[job.stage]) return job.stage;
  const kinds = [...replies].sort((a, b) => String(b.at).localeCompare(String(a.at))).map((r) => r.kind);
  const k = kinds.find((x) => ["offer", "interview", "assessment", "rejection"].includes(x));
  return k === "offer" ? "offer" : k === "rejection" ? "rejected" : k ? "interviewing" : "waiting";
}

// Sent 10 to 60 days ago, no answer from the employer, no follow-up yet.
export function followUps(db = getDb()) {
  return db.prepare(`SELECT slug, title, company, url, applied_at FROM jobs j WHERE ${SENT} AND applied_at < datetime('now', '-10 days') AND applied_at > datetime('now', '-60 days')
    AND followed_up_at IS NULL AND (stage IS NULL OR stage = 'waiting') AND NOT EXISTS (SELECT 1 FROM replies r WHERE r.slug = j.slug AND r.kind != 'received')
    ORDER BY applied_at ASC LIMIT 50`).all();
}

const day = (t) => { const d = new Date(String(t).replace(" ", "T") + (/Z|[+-]\d\d:?\d\d$/.test(t) ? "" : "Z")); return Number.isNaN(+d) ? "" : d.toLocaleDateString("en-US", { month: "long", day: "numeric" }); };
// A short follow-up, in the person's name, for them to change and send themselves.
// One of a few wordings for each application (see wording in referrals.js).
const NOTES = [
  (j, on) => `Hello, I applied for the ${j.title} role at ${j.company}${on} and wanted to say I'm still very interested. I'd be glad to answer any questions or share more about my experience. Thank you for your time!`,
  (j, on) => `Hello, I'm following up on my application for the ${j.title} position at ${j.company}${on ? `, sent${on}` : ""}. I'm still very interested in the role and happy to provide anything else you need. Thank you!`,
  (j, on) => `Hi, I wanted to check in on my application for the ${j.title} role at ${j.company}${on}. I remain excited about the opportunity and would welcome the chance to talk. Thanks for your consideration!`,
];
export function followUpNote(job, me = {}) {
  const name = [me.firstName, me.lastName].filter(Boolean).join(" ");
  const on = job.applied_at && day(job.applied_at) ? ` on ${day(job.applied_at)}` : "";
  return `${wording(NOTES, job.company, job.title)(job, on)}${name ? `\n${name}` : ""}`;
}

// What's working: for each way of slicing the applications sent in the last 180 days, how many were sent, how many
// got an answer, and how many led to an interview or an offer. Shown once there are at least 5.
export function insights(prefs, profile, { db = getDb(), people = undefined } = {}) {
  const jobs = db.prepare(`SELECT slug, title, company, stage, details, applied_at FROM jobs WHERE ${SENT} AND applied_at > datetime('now', '-180 days')`).all();
  if (jobs.length < 5) return { sent: jobs.length, groups: [] };
  const replies = db.prepare("SELECT slug, kind, at FROM replies WHERE kind != 'received'").all();
  const by = new Map();
  for (const r of replies) by.set(r.slug, [...(by.get(r.slug) || []), r]);
  const BOARD = { freehire: "freehire", watchlist: "Companies you chose", hiringcafe: "HiringCafe", simplify: "Simplify lists", google: "Google Jobs", usajobs: "USAJOBS" };
  const layouts = new Map(((profile && profile.bases) || []).map((b, i) => [b.id, String(b.description || `Layout ${i + 1}`).slice(0, 60)]));
  const titles = prefs.titles || [];
  const ppl = people === undefined ? loadConnections().people || [] : people || [];
  const slices = {
    "Where it was found": (j, d) => (d.addedByUser ? "Added by you" : BOARD[d.board] || "Other"),
    "Job title": (j) => titles.find((t) => titleOk(j.title, { ...prefs, titles: [t] })) || "Other titles",
    "Resume version": (j, d) => (d.plan && layouts.get(d.plan.base)) || "Other",
    "Fit with your resume": (j, d) => { const c = d.check; if (!c || !c.checked) return "Not checked"; const x = c.met / c.checked; return x >= 0.8 ? "Strong (80%+ of the requirements)" : x >= 0.5 ? "Good (50-79%)" : "Partial (under half)"; },
    ...(ppl.length ? { "Knew someone there": (j) => (peopleAt(j.company, ppl).length ? "Yes" : "No") } : {}),
  };
  const groups = Object.entries(slices).map(([name, key]) => {
    const rows = new Map();
    for (const j of jobs) {
      const d = parse(j.details), rs = by.get(j.slug) || [], stage = stageOf(j, rs);
      const k = key(j, d);
      const x = rows.get(k) || { label: k, sent: 0, heard: 0, interviews: 0 };
      x.sent++;
      if (rs.length || stage !== "waiting") x.heard++;
      if (["interviewing", "offer"].includes(stage)) x.interviews++;
      rows.set(k, x);
    }
    return { name, rows: [...rows.values()].sort((a, b) => b.sent - a.sent).slice(0, 6) };
  }).filter((g) => g.rows.length > 1);
  return { sent: jobs.length, groups };
}
