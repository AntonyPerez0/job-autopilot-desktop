// "Not sure what to look for?": job titles to search for, from the person's own approved resume,
// favouring work they qualify for now that tends to pay more than what they do today.
import { Tailor, aiSettings, approvedOnly } from "./engine.js";
import { getAnswers, getPrefs, getProfile } from "./store.js";

const arr = (x) => (Array.isArray(x) ? x : []);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The AI's sense of pay only orders the list; it is never shown as a fact. Posted pay and the user's own
// "lowest pay you'd take" decide what pays better.
const PAY = { more: "", similar: "", less: "", unsure: "" };

// Pay as an hourly figure, from the pay text a posting shows ("$28-$30/hour", "$72,800-$78,000/year",
// "USD 120k-140k/year"): { min, max } per hour, or null when there is no figure.
export function payPerHour(s) {
  const t = String(s || "").toLowerCase();
  const nums = [...t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/g)].map((m) => parseFloat(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1)).filter((n) => n > 0);
  if (!nums.length) return null;
  const per = /hour|\bhr\b/.test(t) ? 1 : /2 weeks|bi-?weekly/.test(t) ? 80 : /week/.test(t) ? 40 : /month/.test(t) ? 173 : /\bday\b|daily/.test(t) ? 8
    : /year|annual|\byr\b/.test(t) ? 2080 : Math.max(...nums) > 1000 ? 2080 : 1;
  return { min: Math.min(...nums) / per, max: Math.max(...nums) / per };
}

export async function suggestTitles({ profile = getProfile(), answers = getAnswers(), prefs = getPrefs() } = {}) {
  const p = approvedOnly(profile || {});
  if (!arr(p.experience).length && !arr(p.skills).length) throw new Error("Make or upload your resume first, then the app can suggest jobs from it.");
  const facts = {
    jobs: arr(p.experience).map((e) => ({ title: e.title, employer: e.org, dates: e.dates, did: arr(e.bullets).slice(0, 6).map((b) => b.text) })),
    skills: arr(p.skills).map((s) => `${s.label}: ${s.items}`),
    education: arr(p.education).map((e) => [e.school, e.detail].filter(Boolean).join(", ")),
    kindOfWork: prefs.jobKind || "both",
    alreadySearching: arr(prefs.titles),
    driversLicense: answers.driversLicense || "", cannotClaim: arr(answers.cannotClaim),
  };
  const sys = `You help a person who isn't sure what jobs to apply for. From their own resume facts, suggest 8 job titles to search for.
- Each title is what the app types into job search sites, so it must be the short, common wording most job ads use, two or three words ("CDL Driver", "Tow Truck Driver", "Sign Installer", "Traffic Control"): rare or long titles find nothing. Never vague ones ("Commercial Vehicle Operator", "Transportation Professional").
- First, jobs they already qualify for that commonly pay more than their current or most recent job: the same work at a higher level or a better-paying kind of employer, and jobs their licenses, certifications and hands-on skills open up.
- Then close matches to what they do now.
- Only jobs whose usual must-haves their facts already show. Never one that needs a license, certification, degree or kind of experience they don't have (running heavy construction equipment is not driving a tow truck).
- Not titles they already search for: ${JSON.stringify(facts.alreadySearching)}.
For each: "why" is one short sentence to them ("You hold a Class B CDL and..."), naming only facts listed above, in their words: a tool they used is not a certification, and nothing is added.
"pay" compares typical pay with their current job from your general knowledge: "more", "similar", "less", or "unsure" when you don't know.
Return JSON only: {"titles": [{"title": "...", "why": "...", "pay": "more|similar|less|unsure"}]}`;
  const r = await Tailor.chat(aiSettings(), [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(facts) }]);
  // A second, separate pass: every "why" must be backed by the resume, or the suggestion is dropped.
  const { factCheck } = await import("./studio.js");
  const source = JSON.stringify(facts);
  const verdict = await factCheck(arr(r.titles).map((x) => ({ text: `${x.title}: ${x.why}`, source })));
  r.titles = arr(r.titles).filter((x, i) => verdict === null || !verdict[i]);
  const have = new Set(arr(prefs.titles).map(norm));
  const cannot = arr(answers.cannotClaim).map(norm).filter(Boolean);
  const out = [], seen = new Set();
  for (const x of arr(r.titles)) {
    const title = String(x.title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    const k = norm(title);
    if (!title || seen.has(k) || have.has(k) || cannot.some((c) => k.includes(c))) continue;
    seen.add(k);
    out.push({ title, why: String(x.why || "").trim().slice(0, 200), pay: PAY[x.pay] !== undefined ? x.pay : "unsure", payText: PAY[x.pay] || "" });
  }
  // The ones that tend to pay more first, as the person asked.
  const rank = { more: 0, similar: 1, unsure: 2, less: 3 };
  return out.sort((a, b) => rank[a.pay] - rank[b.pay]).slice(0, 10);
}
