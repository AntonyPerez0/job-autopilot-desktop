// Kinds of work (freehire's categories: QA, healthcare, hardware...). A posting of a kind that's left out is skipped
// before the AI reads it, which saves the AI's time and the person's money. Left out: the kinds the person said aren't
// for them ("Not this kind of work"), and the kinds the app learned: four or more postings of that kind that the AI
// found to be a different kind of work than theirs, and none that fit. The person can bring any of them back.
import { getDb } from "./db.js";

const NAMES = { qa: "QA and testing", sre: "Site reliability", hr: "HR", it_support: "IT support", ml_ai: "Machine learning and AI", ai_engineering: "AI engineering",
  devops: "DevOps", data_engineering: "Data engineering", data_science: "Data science", data_analytics: "Data analytics", fullstack: "Full-stack development",
  software_engineering: "Software engineering", technical_writing: "Technical writing", skilled_trades: "Skilled trades", personal_services: "Personal services",
  public_safety: "Public safety", social_services: "Social services", engineering_design: "Engineering design", industrial_engineering: "Industrial engineering",
  occupational_safety: "Occupational safety", solutions_engineering: "Solutions engineering", business_analysis: "Business analysis",
  customer_success: "Customer success", network_engineering: "Network engineering", developer_relations: "Developer relations", project_management: "Project management" };
export const kindName = (c) => NAMES[c] || String(c || "").replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase());

// A screening reason that says the posting is a different kind of work (rather than too senior, or a missing skill).
export const OTHER_KIND = /different (trade|field|line of work|kind of (work|job))|completely different|not (one of|among|close to) (any of )?(the |their |his |her )?(candidate's )?target|(isn't|is not) (among|one of|close to) (the |their |his |her )?(candidate's )?target|matches none of|none of (the|their) target|specialized (\w+ )?domain|despite the .{1,60}title|not (a )?software (qa|testing|engineering|role|work)|unrelated to (the candidate's|their|his|her)/i;

// Passed the screen: anything not skipped (queued, sent, practiced, stopped, or left for the person to apply to).
const fits = (s) => s.status !== "skipped";

// The kinds the app learned to leave out, from the postings of the last 90 days.
export function learnedKinds(db = getDb()) {
  const rows = db.prepare("SELECT status, reason, details FROM jobs WHERE details LIKE '%\"category\":\"%' AND found_at > datetime('now', '-90 days')").all();
  const per = new Map();
  for (const r of rows) {
    let cat = "";
    try { cat = (JSON.parse(r.details) || {}).category || ""; } catch { continue; }
    if (!cat) continue;
    const x = per.get(cat) || { other: 0, fit: 0 };
    if (fits(r)) x.fit++;
    else if (/^screen:/.test(r.reason || "") && OTHER_KIND.test(r.reason)) x.other++;
    per.set(cat, x);
  }
  return [...per].filter(([, x]) => x.other >= 4 && x.fit === 0).map(([cat, x]) => ({ code: cat, count: x.other }));
}

// Every kind left out: [{ code, name, by: "you" | "app", count }]
export function hiddenKinds(prefs, db = getDb()) {
  const kept = new Set(prefs.keepKinds || []);
  const mine = (prefs.notForMeKinds || []).map((code) => ({ code, name: kindName(code), by: "you" }));
  const learned = learnedKinds(db).filter((k) => !kept.has(k.code) && !mine.some((m) => m.code === k.code)).map((k) => ({ ...k, name: kindName(k.code), by: "app" }));
  return [...mine, ...learned];
}
