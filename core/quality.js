// Postings that aren't an employer hiring: recruiters and staffing companies hiring for someone else (the
// application never reaches the employer), offshore staffing that pays by the month, and the signs of a scam
// (fees, interviews over WhatsApp, the same opening posted in many cities by a company with almost no jobs).
// Checked without the AI, from the posting and what freehire knows about the company.
import fs from "node:fs";
import { dataDir } from "./store.js";

const text = (j) => `${j.title || ""}\n${j.description || ""}`.slice(0, 40000);

const FEE = /\b(training|placement|registration|certification|onboarding|application|processing|starter kit) fees?\b|\bpay (for|a fee for) (your )?(own )?(training|equipment|background check|certification|starter kit)|\bdeposit (a|the) (check|cheque) (we|that we|to buy|for)|\bupfront (payment|fee|cost)/gi;
const CHAT_INTERVIEW = /\b(whatsapp|telegram|signal app|wickr|google hangouts)\b[^.\n]{0,60}\b(interview|screening|contact|reach (out|us)|message|text|chat)|\b(interview|screening)[^.\n]{0,60}\b(whatsapp|telegram|signal app|wickr|hangouts)\b|\binterview(s|ed)? (will be )?(conducted )?(via|over|on|through) (text|chat|instant messag)/i;
// "There is no application fee" is the opposite of asking for one.
const asksFee = (t) => [...t.matchAll(FEE)].some((m) => !/\b(no|never|not|without|free of|won't|will not)\b[^.\n]{0,30}$/i.test(t.slice(Math.max(0, m.index - 40), m.index)));
const PERSONAL_MAIL = /(send|email|e-mail|forward) (your |a )?(resume|cv)[^\n]{0,80}@(gmail|yahoo|outlook|hotmail|aol|icloud)\.com/i;
const FOR_A_CLIENT = /\bon behalf of (our|a|one of our) clients?\b|\bour client,? (a|an|is|seeks|has)\b|\bis recruiting for (an?|the) [^.\n]{0,80}\bopportunit|\bwe (place|market) (candidates|consultants|our trainees)\b/i;
const STAFFING_CO = /\b(staffing|recruit(ing|ment) (firm|agency|company|partner|platform)|offshore (recruit|staff|talent|team)|talent (agency|marketplace)|placement (agency|firm|company)|outsourc(ing|ed) (talent|staff))/i;
const RECRUITING_INDUSTRY = /^(recruitment|staffing|staffing-and-recruiting|hr-staffing|outsourcing)$/i;

// What's wrong with a posting, in a few words, or "" when nothing is. company: freehire's get_company answer, if any.
export function schemeReason(j, company = null) {
  const t = text(j);
  if (asksFee(t)) return "it asks applicants to pay (a fee, equipment, a check to deposit): a common scam";
  if (CHAT_INTERVIEW.test(t)) return "it interviews over WhatsApp, Telegram or text chat: a common scam";
  if (PERSONAL_MAIL.test(t)) return "it asks for resumes at a personal email address, not the employer's: a common scam";
  const c = company || {};
  if ((c.industries || []).some((x) => RECRUITING_INDUSTRY.test(x)) || STAFFING_CO.test(c.tagline || "")) return `${j.company} is a recruiting or staffing company, not the employer`;
  if (FOR_A_CLIENT.test(t)) return "a recruiter posted it for an employer it doesn't name";
  if (/\/month\b/.test(j.salary || "") && /^USD /.test(j.salary || "") && (j.countries || ["us"]).map((x) => String(x).toLowerCase()).includes("us")) return "it pays by the month in dollars, which usually means overseas contract work";
  const places = String(j.location || "").split(/\s*;\s*/).filter(Boolean);
  if (places.length >= 4 && Number.isFinite(c.open_jobs) && c.open_jobs <= 10) return `the same opening is posted in ${places.length} places by a company with only ${c.open_jobs} jobs: often a training program or a scam, not a job`;
  return "";
}

// freehire's page on a company, kept for a week. ask: freehire's call(name, args).
const CACHE = () => dataDir("companies.json");
const WEEK = 7 * 86400000;
export async function companyInfo(slug, ask) {
  if (!slug) return null;
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(CACHE(), "utf8")) || {}; } catch { /* none yet */ }
  const hit = cache[slug];
  if (hit && Date.now() - hit.at < WEEK) return hit.info;
  try {
    const r = await ask("get_company", { slug });
    const info = { industries: (r.industries || []).slice(0, 10), tagline: String(r.tagline || "").slice(0, 400), open_jobs: Number.isFinite(r.open_jobs) ? r.open_jobs : null };
    cache[slug] = { at: Date.now(), info };
    const keep = Object.fromEntries(Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 2000));
    try { fs.writeFileSync(CACHE(), JSON.stringify(keep)); } catch { /* a cache only */ }
    return info;
  } catch { return null; }
}
