// The user's own facts, from onboarding: turned into the profile's standard
// form answers, the facts the screening and fact-check steps see, and the
// autopilot rules added to the tailoring prompt. Nothing here is about one
// particular person; every value comes from answers.json, prefs.json and the
// approved profile.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthYear = (ym) => {
  const m = String(ym || "").match(/^(\d{4})-(\d{1,2})/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(ym || "");
};
const ymValue = (ym) => { const m = String(ym || "").match(/^(\d{4})-(\d{1,2})/); return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null; };
const nowYm = (d = new Date()) => d.getFullYear() * 12 + d.getMonth();

export const DECLINE = "Decline to self-identify";
// Years worked from job dates ("Jun 2023 – Present"), overlapping jobs counted once, rounded down to half years.
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function monthNum(s, now) {
  const t = String(s || "").toLowerCase();
  if (/present|now|current/.test(t)) return now.getFullYear() * 12 + now.getMonth();
  const y = t.match(/\b(19|20)\d\d\b/);
  if (!y) return null;
  const m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  return Number(y[0]) * 12 + (m ? MON[m[1]] : 6);
}
export function yearsFromDates(experience, now = new Date()) {
  const months = new Set();
  for (const e of experience || []) {
    const [a, b = ""] = String(e.dates || "").split(/\s*(?:–|—|-|\bto\b)\s*/i);
    const s = monthNum(a, now), f = monthNum(b || a, now);
    if (s === null || f === null || f < s) continue;
    for (let m = s; m <= f; m++) months.add(m);
  }
  return Math.floor((months.size / 12) * 2) / 2;
}

const yn = (v) => (v === "yes" ? "Yes" : v === "no" ? "No" : "");

// "B.S." -> "Bachelor of Science (B.S.)", so a list that says "Bachelor's Degree" still matches.
const DEGREES = [[/^(b\.?\s?s\.?c?|bsc)$/i, "Bachelor of Science"], [/^(b\.?\s?a\.?)$/i, "Bachelor of Arts"], [/^(b\.?\s?eng\.?|b\.?e\.?)$/i, "Bachelor of Engineering"],
  [/^(m\.?\s?s\.?c?|msc)$/i, "Master of Science"], [/^(m\.?\s?a\.?)$/i, "Master of Arts"], [/^m\.?b\.?a\.?$/i, "Master of Business Administration"],
  [/^ph\.?\s?d\.?$/i, "Doctor of Philosophy"], [/^(a\.?\s?s\.?)$/i, "Associate of Science"], [/^(a\.?\s?a\.?)$/i, "Associate of Arts"]];
export function degreeText(d) {
  const t = String(d || "").trim();
  const hit = DEGREES.find(([rx]) => rx.test(t));
  return hit ? `${hit[1]} (${t})` : t;
}

export const fullName = (a) => [a.firstName, a.lastName].filter(Boolean).join(" ").trim();

const US_ABBR = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA",
  washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC" };

export function homeLocation(a) {
  if (!a.city) return "";
  const st = US_ABBR[String(a.state || "").toLowerCase()] || a.state;
  if (/^(united states|usa|us)$/i.test(a.country || "")) return [a.city, st].filter(Boolean).join(", ");
  return [a.city, a.state, a.country].filter(Boolean).join(", ");
}

// The education entry that counts as "graduation": the latest end date.
export function latestEducation(a) {
  return [...(a.education || [])].filter((e) => e && e.school).sort((x, y) => (ymValue(y.end) ?? -1) - (ymValue(x.end) ?? -1))[0] || null;
}

export function stillStudying(a, d = new Date()) {
  const e = latestEducation(a);
  return !!(e && ymValue(e.end) !== null && ymValue(e.end) > nowYm(d));
}

// The form answers every application can use, by the labels the add-on matches on.
export function standardAnswers(a) {
  const out = [];
  const add = (label, value) => { if (value !== undefined && value !== null && String(value).trim() !== "") out.push({ label, value: String(value) }); };
  add("Full name", fullName(a));
  add("First name", a.firstName);
  add("Last name", a.lastName);
  add("Preferred name", a.preferredName || a.firstName);
  add("Email", a.email);
  add("Phone", a.phone);
  add("LinkedIn", a.linkedin);
  add("GitHub", a.github);
  add("Website", a.website || a.github || a.linkedin);
  for (const l of String(a.otherLinks || "").split(/\s+/).filter((x) => /^https?:\/\//.test(x))) add("Other link", l);
  add("Location", homeLocation(a));
  add("Street address", a.street);
  add("Address line 1", a.street);
  add("City", a.city);
  add("State", a.state);
  add("ZIP code", a.zip);
  add("Postal code", a.zip);
  add("Country", a.country);
  add(`Legally authorized to work in ${a.authCountry === "United States" ? "the US" : a.authCountry || "the country of the job"}`, yn(a.workAuthorized));
  add("Requires employer sponsorship now or in the future", yn(a.needsSponsorship));
  add("Current or most recent employer", a.currentEmployer);
  add("Current or most recent job title", a.currentTitle);
  for (const [i, e] of (a.education || []).entries()) {
    const tag = i === 0 ? "" : ` (${e.school})`;
    add("School" + tag, e.school);
    add("Degree" + tag, degreeText(e.degree));
    add("Field of study" + tag, e.field);
    add("Education start date" + tag, monthYear(e.start));
    add("Education end date" + tag, monthYear(e.end));
  }
  const g = latestEducation(a);
  if (g) add(stillStudying(a) ? "Expected graduation date" : "Graduation date", monthYear(g.end));
  for (const y of a.years || []) if (y && y.type) add(`Years of ${y.type} experience`, y.years);
  add("Total years of professional work experience", a.totalYears);
  add("Notice period", a.noticePeriod);
  add("Earliest start date", a.startAvailability);
  add("Willing to relocate", { no: "No", anywhere: "Yes", radius: "Only within commuting distance" }[a.relocation]);
  add("How did you hear about us", a.heardAbout || "Job board");
  add("Are you 18 years of age or older?", yn(a.over18));
  add("Are you a U.S. citizen?", yn(a.citizen));
  add("Are you 21 years of age or older?", yn(a.over21));
  add("Willing to travel for work", { yes: "Yes", no: "No", some: "Yes, occasionally" }[a.travel]);
  add("Desired salary", a.salary);
  const days = a.daysAvailable || [];
  if (days.length) {
    add("Days available", days.length === 7 ? "Any day of the week" : days.join(", "));
    add("Available to work weekends", days.includes("Saturday") || days.includes("Sunday") ? "Yes" : "No");
  }
  if ((a.shifts || []).length) add("Shifts available", a.shifts.join(", "));
  add("Desired hours", { full: "Full-time", part: "Part-time", either: "Full-time or part-time" }[a.hoursWanted]);
  add("Do you have reliable transportation", yn(a.transportation));
  add("Do you have a valid driver's license", yn(a.driversLicense));
  if (Number(a.canLift) > 0) add("How much weight can you lift", `${Number(a.canLift)} pounds`);
  add("Do you have your own insured vehicle", yn(a.ownVehicle));
  add("Do you have a clean driving record", { clean: "Yes", no: "No" }[a.drivingRecord]);
  const d = a.demographics || {};
  const dem = (v) => (!v || v === "decline" ? DECLINE : v);
  add("Gender", dem(d.gender));
  add("Race", dem(d.race));
  add("Ethnicity", dem(d.race));
  add("Are you Hispanic or Latino?", dem(d.hispanic));
  add("Veteran status", dem(d.veteran));
  add("Disability status", dem(d.disability));
  add("Sexual orientation", dem(d.lgbtq));
  return out;
}

// Facts the screening and fact-check prompts see.
export function candidateFacts(a, profile, prefs) {
  const g = latestEducation(a);
  return {
    name: fullName(a) || (profile && profile.name) || "",
    home: homeLocation(a),
    education: (a.education || []).map((e) => `${[degreeText(e.degree), e.field].filter(Boolean).join(", ")} at ${e.school} (${monthYear(e.start) || "?"} to ${monthYear(e.end) || "?"})`),
    graduation: g ? monthYear(g.end) : null,
    stillStudying: stillStudying(a),
    workHistory: ((profile && profile.experience) || []).map((e) => `${e.title}, ${e.org} (${e.dates})`),
    yearsByType: Object.fromEntries((a.years || []).filter((y) => y && y.type).map((y) => [y.type, Number(y.years) || 0])),
    // Not given: worked out from the resume's job dates, never assumed to be zero.
    totalYears: Number(a.totalYears) || yearsFromDates((profile && profile.experience) || []),
    // Legal facts are true, false, or null when the person hasn't answered (then forms ask them).
    authorizedToWork: a.workAuthorized === "yes" ? true : a.workAuthorized === "no" ? false : null,
    authCountry: a.authCountry || "United States",
    needsSponsorship: a.needsSponsorship === "yes" ? true : a.needsSponsorship === "no" ? false : null,
    citizen: a.citizen === "yes" ? true : a.citizen === "no" ? false : null,
    cannotClaim: [...((profile && profile.cannotClaim) || []), ...(a.cannotClaim || [])].slice(0, 200),
    maxYearsRequired: prefs ? Number(prefs.maxYearsRequired) : null,
    wantsInternships: !!(prefs && prefs.internships),
    interests: prefs ? prefs.keywords || [] : [],
    // What hourly postings ask about. Missing means "not stated", never "no".
    practical: Object.fromEntries(Object.entries({
      over18: yn(a.over18), over21: yn(a.over21), driversLicense: yn(a.driversLicense), ownInsuredVehicle: yn(a.ownVehicle),
      cleanDrivingRecord: { clean: "Yes", no: "No" }[a.drivingRecord], reliableTransportation: yn(a.transportation),
      canLiftPounds: Number(a.canLift) > 0 ? Number(a.canLift) : "", daysAvailable: (a.daysAvailable || []).join(", "), shifts: (a.shifts || []).join(", "),
      hours: { full: "Full-time", part: "Part-time", either: "Full-time or part-time" }[a.hoursWanted],
    }).filter(([, v]) => v !== undefined && v !== "")),
  };
}

// Added to the add-on's tailoring prompt: nobody reviews an application before it goes out.
export function autopilotRules(a, profile, prefs) {
  const f = candidateFacts(a, profile, prefs);
  const years = Object.entries(f.yearsByType);
  const lines = [
    "AUTOPILOT CONTEXT: nobody reviews this application before it is submitted.",
  ];
  if (f.graduation && !f.stillStudying) {
    lines.push(`- The candidate finished school in ${f.graduation}. Roles only for current students, or for a graduating class after ${f.graduation}, are hard fails.`);
  } else if (f.graduation) {
    lines.push(`- The candidate is still in school and expects to graduate in ${f.graduation}. Roles for graduates of an earlier class who have already finished are fine only if the posting accepts ${f.graduation} graduates.`);
  }
  if (!f.wantsInternships) lines.push("- Internships and co-ops are hard fails.");
  if (Number.isFinite(f.maxYearsRequired)) lines.push(`- Roles that require more than ${f.maxYearsRequired} years of experience as a must-have are hard fails.`);
  lines.push(
    "- A security clearance the candidate does not hold, a license or degree the facts do not show, when the posting makes it a must-have: hard fail.",
    "- TRUTH RULES (no exceptions):",
    `  * Work history, in full: ${f.workHistory.length ? f.workHistory.join("; ") : "(none listed)"}. Never imply any other job.`,
    `  * Years of experience, by type (the candidate's own numbers): ${years.length ? years.map(([t, n]) => `${t}: ${n}`).join("; ") : "(none listed)"}; all professional work: ${f.totalYears}.`,
    "    A question asking how many years of a type gets that number, never more; with options, the option whose range contains it.",
    "    A question about a type not listed here is \"decide\", never a guess.",
    `  * Work authorization in ${f.authCountry}: ${f.authorizedToWork === null ? "NOT ANSWERED (any question about it is \"decide\")" : f.authorizedToWork ? "Yes" : "No"}. Needs visa sponsorship now or in the future: ${f.needsSponsorship === null ? "NOT ANSWERED (any question about it is \"decide\")" : f.needsSponsorship ? "Yes" : "No"}. U.S. citizen: ${f.citizen === null ? "NOT ANSWERED (any question about it is \"decide\")" : f.citizen ? "Yes" : "No"}.`,
    `  * How they heard about the job: "${a.heardAbout || "Job board"}" (found through a job board). With options pick that one, or "Job board", "Job site", "Online", "Internet" or "Other", in that order. Never a referral, an employee, a recruiter, an event or a search engine.`,
    `  * Where they live: ${f.home || "(not given)"}. ${relocationRule(a, prefs)}`,
    `  * Start date / availability: "${a.startAvailability || "decide"}". Notice period: "${a.noticePeriod || "decide"}". Never a different date or number of weeks.`,
    "  * Demographic, veteran, disability and orientation questions: the candidate's standard answer; when it is to decline, the option that declines to answer.",
    "  * Arbitration agreements, jury or class-action waivers, non-competes, releases of claims, background check or drug test consents: always \"decide\".",
    "  * Written answers: a fact from a project marked builtWithAiAgents must say AI coding agents built it IN THE SAME SENTENCE, and must never be phrased as \"I built\", \"I wrote\" or \"I shipped\" that project. No numbers, tools or claims that are not in the catalog.",
    "- A field listed with options (dropdowns, radios, checkbox groups) gets the EXACT text of one listed option, never a paraphrase.",
    "- Only answer \"fill\" when the facts settle it. Use \"decide\" for anything you would otherwise guess.",
    "- Drafted free-text answers must be specific to this employer and posting and stay strictly within the facts.",
  );
  return lines.join("\n");
}

function relocationRule(a, prefs) {
  if (a.relocation === "anywhere") return "They are willing to relocate: Yes.";
  if (a.relocation === "radius") {
    const r = prefs ? `${prefs.radius} ${prefs.radiusUnit === "km" ? "km" : "miles"}` : "commuting distance";
    return `Relocation: not needed for roles within ${r} of where they live (answer Yes to "open to relocating to" such a place); for anywhere farther: No.`;
  }
  return "They are not willing to relocate: No.";
}
