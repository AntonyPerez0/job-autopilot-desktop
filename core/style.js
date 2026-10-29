// The app's house style for what the AI writes: AI models pick a different word for the same thing on
// each run ("Decreased", "Lowered", "Reduced"; "approximately", "around"; "daily", "per day"). These swaps
// put the same thing the same way every time. Each swap keeps the meaning; none adds a fact, and the
// honesty checks run on the result. Only AI wording goes through here, never what the person typed.
const WORD_NUM = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const PCT = String.raw`(?:about |around |roughly |approximately )?\d[\d,.]*\s?%`;
const keepCase = (from, to) => (from[0] === from[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);

export function houseStyle(text) {
  // One resume line or summary; the looks-ahead below stay within 200 characters of their verb.
  let s = String(text || "").slice(0, 5000);
  // Estimates: one word for "about" before a number.
  s = s.replace(/\b(approximately|roughly|around)(?=\s+\$?\d)/gi, (m) => keepCase(m, "about"));
  s = s.replace(/(\d)\s?percent\b/gi, "$1%");
  // A decrease with its measure is "Cut", an increase "Increased"; "by 50%" after the verb is just "50%".
  s = s.replace(new RegExp(String.raw`\b(decreased|lowered|reduced|decrease|lower|reduce|decreasing|lowering|reducing)\b(?=[^,.;]{0,200}?\d[\d,.]*\s?%|[^,.;]{0,200}?\bfrom [^,.;]{0,200}?\d[^,.;]{0,200}? to [^,.;]{0,200}?\d)`, "gi"), (m) => keepCase(m, /ing$/i.test(m) ? "cutting" : "cut"));
  s = s.replace(new RegExp(String.raw`\b(raised|boosted|grew|raise|boost|grow|raising|boosting|growing)\b(?=[^,.;]{0,200}?\d[\d,.]*\s?%)`, "gi"), (m) => keepCase(m, /ing$/i.test(m) ? "increasing" : /^(raise|boost|grow)$/i.test(m) ? "increase" : "increased"));
  s = s.replace(new RegExp(String.raw`\b((?:cut|cutting|increased|increase|increasing) [^,.;]{1,200}?) by (${PCT})`, "gi"), "$1 $2");
  // How often, after a count: "60 tickets daily", "per day", "each day" -> "a day".
  // Only right after a count in the same part of the sentence ("about 10 people monthly"), never a "monthly"
  // that says how often something happens ("sort donations monthly, about 300 pounds").
  const countBefore = (str, at) => /\d/.test(str.slice(0, at).split(/[,;.:]/).pop());
  s = s.replace(/\b(per|each|every) (day|shift|week|month|year|hour)\b/gi, (m, w, unit, at, str) => (countBefore(str, at) ? `a ${unit}` : m));
  const UNIT = { daily: "a day", weekly: "a week", monthly: "a month", nightly: "a night" };
  s = s.replace(/ (daily|weekly|monthly|nightly)(?=$|[,;.)]| (on|in|using|via|across|for|through|with|regarding|about|by|at|from|to|and|during|while)\b)/gi, (m, w, _p, at, str) => (countBefore(str, at) ? " " + UNIT[w.toLowerCase()] : m));
  // Counts in digits ("3 new hires"); "one" stays a word ("one-on-one", "one of").
  s = s.replace(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b(?=\s+[a-z])/gi, (m) => String(WORD_NUM[m.toLowerCase()]));
  // Plain words.
  s = s.replace(/\butiliz(e|es|ed|ing)\b/gi, (m, e) => keepCase(m, { e: "use", es: "uses", ed: "used", ing: "using" }[e.toLowerCase()]));
  s = s.replace(/\bin order to\b/gi, "to").replace(/\be-mail(s?)\b/gi, "email$1");
  return s.replace(/\s{2,}/g, " ").trim();
}
