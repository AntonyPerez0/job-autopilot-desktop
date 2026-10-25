// Truth rules: questions the model may not get wrong, checked against the
// user's own answers after the model plans the form. A wrong answer is
// corrected to the true one (the exact option text when the field has
// options), or turned into a question for the user when no option is true.
// "decide" answers are never touched: those already wait for the user.
import { DECLINE, monthYear, latestEducation } from "./facts.js";

const yes = (v) => /^\s*(yes|y|true)\b/i.test(String(v || ""));
const no = (v) => /^\s*(no|n|false|none)\b/i.test(String(v || ""));
const pick = (options, test) => (options || []).find(test);
const nk = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
export const DECLINE_RX = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose|self.?identify)|choose not|rather not|not specified|no answer/i;

// "0-1 years", "Less than 1 year", "3+", "5 or more", "1 to 3 years", "None", "2" -> { lo, hi } (hi inclusive).
export function parseRange(text) {
  const t = String(text || "").toLowerCase().replace(/[–—]/g, "-");
  if (/^\s*(none|no experience|zero|n\/a)\b/.test(t)) return { lo: 0, hi: 0 };
  let m;
  if ((m = t.match(/(less than|under|fewer than|<)\s*(\d+(\.\d+)?|one)/))) return { lo: 0, hi: (m[2] === "one" ? 1 : Number(m[2])) - 0.01 };
  if ((m = t.match(/(\d+(\.\d+)?)\s*(\+|or more|plus|and (above|up|over)|or (above|over))/)) || (m = t.match(/(more than|over|at least|>)\s*(\d+(\.\d+)?)/))) {
    const n = Number(m[1] && /\d/.test(m[1]) ? m[1] : m[2]);
    return { lo: /more than|over|>/.test(m[0]) && !/or more|and over|or over/.test(m[0]) ? n + 0.01 : n, hi: Infinity };
  }
  if ((m = t.match(/(\d+(\.\d+)?)\s*(-|to)\s*(\d+(\.\d+)?)/))) return { lo: Number(m[1]), hi: Number(m[4]) };
  if ((m = t.match(/^\s*(\d+(\.\d+)?)\b/)) || (m = t.match(/\b(\d+(\.\d+)?)\s*(years?|yrs?)\b/))) return { lo: Number(m[1]), hi: Number(m[1]) };
  if (/^\s*(one)\b/.test(t)) return { lo: 1, hi: 1 };
  return null;
}
const contains = (r, n) => r && n >= r.lo - 1e-9 && n <= r.hi + 1e-9;

// The option whose range holds n; when ranges overlap ("0-2", "2-4"), the one that starts at or below n, narrowest first.
export function yearsOption(options, n) {
  const hits = (options || []).map((o) => [o, parseRange(o)]).filter(([, r]) => contains(r, n));
  if (!hits.length) return null;
  hits.sort((a, b) => (a[1].hi - a[1].lo) - (b[1].hi - b[1].lo) || b[1].lo - a[1].lo);
  return hits[0][0];
}

// Which of the user's experience types a question is about, or "total", or null for a type they never gave.
export function yearsType(label, facts) {
  const L = nk(label);
  const types = Object.keys(facts.yearsByType || {});
  let best = null, score = 0;
  for (const t of types) {
    const words = nk(t).split(" ").filter((w) => w.length > 2 && !/^(experience|years|work|and|the|professional)$/.test(w));
    const s = words.filter((w) => new RegExp(`\\b${w.replace(/[+]/g, "\\+")}`).test(L)).length / (words.length || 1);
    if (s > score) { score = s; best = t; }
  }
  if (best && score >= 0.5) return best;
  // "How many years of professional experience do you have?" with no subject: total work.
  const subject = L.replace(/\b(how|many|years?|yrs?|of|experience|do|you|have|in|with|total|professional|relevant|work|working|industry|full|time|overall|paid|post|graduate|grad|the|a|an|please|select|indicate|your|level|what|is|are|s|or|more|at|least|\d+(\s\d+)?)\b|\+/g, " ").trim();
  if (!subject) return "total";
  return null;
}

const decline = (o) => pick(o, (x) => DECLINE_RX.test(x));
export const LEGAL_RX = /arbitration|waive|waiver|jury|non-?compete|non-?solicit|class action|release of (claims|liability)|background (check|screen)|drug (test|screen)|criminal (record|history|conviction|offen[cs]e)|convicted|felony|misdemeanor/i;
const SCREENING_RX = /^(?!.*(waive|waiver|jury|class action|release of|arbitration|non-?compete|criminal|convicted|felony|misdemeanor)).*(background (check|screen)|drug (test|screen))/i;
const screeningOk = (a) => a.screenings === "yes";

// Each rule: which questions it covers, whether an answer is wrong, and the true answer.
export function rules(facts, a, ctx = {}) {
  const heard = a.heardAbout || "Job board";
  const out = [
    // Legal agreements and legal-history questions are never answered by the AI. The only
    // exceptions are the user's own choices: background checks and drug tests (Settings), and
    // plain arbitration agreements (handled when the form is filled).
    {
      name: "legal agreement", label: LEGAL_RX,
      bad: (v) => !(screeningOk(a) && SCREENING_RX.test(String(ctx.label || "")) && yes(v)),
      fix: (o) => (screeningOk(a) && SCREENING_RX.test(String(ctx.label || "")) ? pick(o, (x) => yes(x)) || (o && o.length ? null : "Yes") : null),
      why: "legal agreements and legal history always wait for you",
    },
    {
      name: "work authorization", label: /(legally )?authori[sz]ed to work|eligible to work|right to work|work authori[sz]ation(?! sponsor)|legally (able|permitted) to work/i,
      // "authorized to work (with or without sponsorship)?" is about authorization; one that also asks
      // whether you will need sponsorship mixes two facts, and is left to the model and the user's answers.
      skip: /(require|need)\w*.{0,60}sponsor|sponsor\w*.{0,30}(require|need)/i,
      bad: (v) => (facts.authorizedToWork ? !yes(v) : !no(v)),
      fix: (o) => (facts.authorizedToWork ? pick(o, (x) => yes(x)) || (o && o.length ? null : "Yes") : pick(o, (x) => no(x)) || (o && o.length ? null : "No")),
    },
    {
      name: "sponsorship", label: /sponsor|visa (status|support)|immigration (case|support)|h-?1b|work permit/i,
      skip: /authori[sz]ed to work|eligible to work|right to work|legally (able|permitted) to work/i,
      bad: (v) => (facts.needsSponsorship ? !yes(v) : !no(v) && !/^n\/?a$/i.test(String(v).trim())),
      fix: (o) => (facts.needsSponsorship
        ? pick(o, (x) => yes(x) || /will require|do require|need/i.test(x) && !/not|don.?t/i.test(x)) || (o && o.length ? null : "Yes")
        : pick(o, (x) => no(x) || /not? (require|need)|do not/i.test(x)) || (o && o.length ? null : "No")),
    },
    {
      name: "years of experience", label: /how many years|years of (professional |relevant |work |industry |[a-z+#. -]{1,40})?experience|experience level|years (have you|of)|years.{0,20}experience/i,
      skip: /\b18\b|age|old enough|graduat/i,
      years: true,
    },
    {
      name: "how you heard", label: /how did you (hear|find|learn|come across)|where did you (hear|find|see)|referral source|^source\b|how were you referred/i,
      bad: (v) => !new RegExp(`job ?board|job ?site|online|internet|other|${heard.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(String(v)),
      fix: (o) => pick(o, (x) => nk(x) === nk(heard)) || pick(o, (x) => /job ?board/i.test(x)) || pick(o, (x) => /job ?site|online job|job search/i.test(x)) ||
        pick(o, (x) => /^internet|online/i.test(x)) || pick(o, (x) => /^other/i.test(x)) || (o && o.length ? null : heard),
    },
    {
      name: "notice period", label: /notice period|how much notice|notice (do you|to your)/i,
      bad: (v) => nk(v) !== nk(a.noticePeriod) && !sameWeeks(v, a.noticePeriod),
      fix: (o) => (o && o.length ? pick(o, (x) => nk(x) === nk(a.noticePeriod) || sameWeeks(x, a.noticePeriod)) || null : a.noticePeriod || null),
    },
    {
      name: "start date", label: /when (can|could|would|will|are|do) .{0,30}(start|begin)|earliest .{0,35}(start|begin|available)|start date|available to start|availability to start/i,
      skip: /education|school|degree|employment (start|end)|job (start|end)|month|year/i,
      bad: (v) => nk(v) !== nk(a.startAvailability) && !(sameWeeks(v, a.startAvailability)) && !/negotiable|flexible/i.test(String(v)),
      fix: (o) => (o && o.length
        ? pick(o, (x) => nk(x) === nk(a.startAvailability) || sameWeeks(x, a.startAvailability)) || pick(o, (x) => /negotiable|flexible/i.test(x)) || null
        : a.startAvailability || null),
    },
    {
      name: "graduation date", label: /graduat(ion|e) (date|year|month)|when (did|do|will) you graduate|expected graduation|degree (completion|conferred)/i,
      skip: /high school/i,
      bad: (v) => { const g = latestEducation(a); return !!g && !String(v).includes(String(g.end).slice(0, 4)); },
      fix: (o) => {
        const g = latestEducation(a);
        if (!g) return null;
        const yr = String(g.end).slice(0, 4), my = monthYear(g.end);
        return o && o.length ? pick(o, (x) => nk(x) === nk(my)) || pick(o, (x) => x.includes(yr) && nk(x).includes(nk(my.split(" ")[0]))) || pick(o, (x) => nk(x) === yr) || null : my;
      },
    },
    {
      name: "relocation", label: /relocat/i,
      bad: (v) => (relocates(a, ctx) ? !yes(v) : !no(v)),
      fix: (o) => (relocates(a, ctx) ? pick(o, (x) => yes(x)) || (o && o.length ? null : "Yes") : pick(o, (x) => no(x)) || (o && o.length ? null : "No")),
    },
  ];
  for (const [key, rx] of [
    ["gender", /\bgender\b|\bsex\b(?! offender)/i], ["hispanic", /hispanic|latin[oax]/i], ["race", /\brace\b|ethnicity|racial/i],
    ["veteran", /veteran/i], ["disability", /disabilit/i], ["lgbtq", /sexual orientation|lgbt|transgender/i],
  ]) {
    const want = ((a.demographics || {})[key]) || "decline";
    out.push({
      name: key === "lgbtq" ? "orientation" : key, label: rx,
      skip: key === "race" ? /hispanic|latin/i : key === "gender" ? /identity.*transgender/i : null,
      bad: (v) => (want === "decline" ? !DECLINE_RX.test(String(v)) : !matchesWant(v, want)),
      fix: (o) => (want === "decline"
        ? decline(o) || (o && o.length ? null : DECLINE)
        : (o && o.length ? pick(o, (x) => matchesWant(x, want)) || null : want)),
    });
  }
  return out;
}

const matchesWant = (v, want) => { const V = nk(v), W = nk(want); return !!W && (V === W || V.startsWith(W + " ") || (W.length > 3 && V.includes(W))); };
const weeksOf = (s) => {
  const t = String(s || "").toLowerCase();
  if (/immediate|right away|asap|now\b|no notice|none/.test(t)) return 0;
  const m = t.match(/(\d+|one|two|three|four|six)\s*(weeks?|wks?)/) || t.match(/(\d+|one|two|three)\s*months?/);
  if (!m) return null;
  const n = { one: 1, two: 2, three: 3, four: 4, six: 6 }[m[1]] ?? Number(m[1]);
  return /month/.test(m[0]) ? n * 4 : n;
};
const sameWeeks = (a, b) => { const x = weeksOf(a), y = weeksOf(b); return x !== null && x === y; };

function relocates(a, ctx) {
  if (a.relocation === "anywhere") return true;
  if (a.relocation === "radius") return !!ctx.jobLocal;
  return false;
}

function yearsFix(k, f, facts) {
  const type = yearsType(k.label, facts);
  const n = type === "total" ? facts.totalYears : type ? facts.yearsByType[type] : null;
  if (n === null || n === undefined) {
    return { fixed: null, why: `no number for this kind of experience in your answers (add it under Years of experience)` };
  }
  const o = f.options;
  // "Do you have 3+ years of experience with X?" answered Yes or No.
  const thr = String(k.label).match(/(\d+(\.\d+)?)\s*\+?\s*(or more\s*)?(years?|yrs?)/i);
  const yesNo = (o && o.length && o.every((x) => yes(x) || no(x))) || (!(o && o.length) && (yes(k.value) || no(k.value)));
  if (thr && yesNo) {
    const want = n >= Number(thr[1]);
    if (want ? yes(k.value) : no(k.value)) return { ok: true };
    return { fixed: (o && o.length ? pick(o, want ? yes : no) : want ? "Yes" : "No") || null, why: `you have ${n} years (${type})` };
  }
  if (o && o.length) {
    const r = parseRange(k.value);
    if (contains(r, n) && o.includes(k.value)) return { ok: true };
    return { fixed: yearsOption(o, n), why: `you have ${n} years (${type})` };
  }
  const r = parseRange(k.value);
  if (r && r.lo === n && r.hi === n) return { ok: true };
  return { fixed: String(n), why: `you have ${n} years (${type})` };
}

export function truthGuard(kit, fields, facts, answers, ctx = {}) {
  const notes = [];
  const R = rules(facts, answers, ctx);
  for (const k of kit) {
    // Standard answers (no field index) are the user's own words; only the model's answers are checked.
    if (!k || k.kind === "file" || k.kind === "blank" || k.fieldIndex === undefined) continue;
    const f = (fields || []).find((x) => x.label === k.label) || {};
    ctx.label = k.label;
    for (const rule of R) {
      if (!rule.label.test(k.label) || (rule.skip && rule.skip.test(k.label))) continue;
      if (k.kind === "decide") break;
      let fixed, why = "";
      if (rule.years) {
        const y = yearsFix(k, f, facts);
        if (y.ok) break;
        fixed = y.fixed; why = y.why;
        if (fixed !== null && String(fixed) === String(k.value)) break;
      } else {
        if (!rule.bad(k.value)) break;
        fixed = rule.fix(f.options);
      }
      why = why || rule.why || "";
      notes.push(`${rule.name}: "${k.value}" corrected to ${fixed ? `"${fixed}"` : "a question for you"} on "${k.label.slice(0, 80)}"${why ? ` (${why})` : ""}`);
      if (fixed) { k.value = fixed; k.kind = "text"; k.note = `corrected by the truth rules (${rule.name})`; }
      else { k.value = ""; k.kind = "decide"; k.note = `no truthful answer for ${rule.name}${why ? ": " + why : ""}`; }
      break;
    }
  }
  return notes;
}
