// USAJOBS: federal government jobs, through the official USAJOBS Search API with the user's own free key
// (developer.usajobs.gov; the terms don't allow sharing one key). Its data is public and openly licensed.
// Applying on USAJOBS needs a Login.gov account and the agency's own questions, so every federal job goes
// to "Apply yourself" with its link, its closing date and a tailored resume; the app never applies there.
import { countryName } from "../geo.js";
import { getSecret, getSettings } from "../store.js";
import { thisCycle } from "./budget.js";

const ENDPOINT = "https://data.usajobs.gov/api/Search";
const strip = (h) => String(h || "").slice(0, 100000).replace(/<[^<>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const money = (n) => "$" + Math.round(Number(n)).toLocaleString("en-US");
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function headers(key, email) {
  return { "Authorization-Key": key, "User-Agent": email, Host: "data.usajobs.gov" };
}

export function normalize(item) {
  const d = item.MatchedObjectDescriptor || {};
  const det = (d.UserArea && d.UserArea.Details) || {};
  const pay = (d.PositionRemuneration || [])[0];
  const per = pay && /^PH$/i.test(pay.RateIntervalCode) ? "hour" : "year";
  const salary = pay && Number(pay.MinimumRange) ? `${money(pay.MinimumRange)}${Number(pay.MaximumRange) ? "-" + money(pay.MaximumRange) : ""}/${per}` : null;
  const where = d.PositionLocationDisplay || ((d.PositionLocation || [])[0] || {}).LocationName || "";
  const remote = /anywhere in the u\.?s|remote|telework/i.test(`${where} ${det.RemoteIndicator ? "remote" : ""}`) || det.RemoteIndicator === true;
  const closes = day(d.ApplicationCloseDate);
  const agency = [d.OrganizationName, d.DepartmentName && d.DepartmentName !== d.OrganizationName ? d.DepartmentName : ""].filter(Boolean).join(", ");
  const parts = [
    det.JobSummary && `Summary: ${strip(det.JobSummary)}`,
    det.WhoMayApply && det.WhoMayApply.Name && `Who may apply: ${det.WhoMayApply.Name}`,
    d.QualificationSummary && `Qualifications: ${strip(d.QualificationSummary)}`,
    det.MajorDuties && `Duties: ${strip([].concat(det.MajorDuties).join(" "))}`,
    (det.KeyRequirements || []).length && `Key requirements: ${det.KeyRequirements.map(strip).join("; ")}`,
    det.Requirements && `Requirements: ${strip(det.Requirements)}`,
    det.Education && `Education: ${strip(det.Education)}`,
    det.SecurityClearance && `Security clearance: ${strip(det.SecurityClearance)}`,
    det.LowGrade && `Grade: ${[...new Set([det.LowGrade, det.HighGrade].filter(Boolean))].join(" to ")}`,
    closes && `Applications close ${closes}.`,
  ].filter(Boolean);
  return {
    slug: "usaj-" + (item.MatchedObjectId || d.PositionID),
    title: d.PositionTitle || "", company: agency, location: remote ? "Remote (United States)" : where, work_mode: remote ? "remote" : "",
    countries: ["US"], url: d.PositionURI || "", apply_url: (d.ApplyURI || [])[0] || d.PositionURI || "",
    ats: "usajobs", kind: "account", board: "USAJOBS", posted_at: d.PublicationStartDate || "", salary, level: "", minYears: null,
    closes: d.ApplicationCloseDate || "", description: parts.join("\n").slice(0, 12000),
  };
}

// Checks a key with the smallest possible search. -> { ok } or throws with a plain reason.
export async function testKey(key, email) {
  const res = await fetch(`${ENDPOINT}?Keyword=clerk&ResultsPerPage=1`, { headers: headers(key, email), signal: AbortSignal.timeout(20000) });
  if (res.status === 401 || res.status === 403) throw new Error("USAJOBS didn't accept that key and email. Use the exact email you put on the request form, and the key from their email.");
  if (!res.ok) throw new Error(`USAJOBS answered ${res.status}. Try again in a minute.`);
  return { ok: true };
}

export async function search(prefs, { progress = () => {}, log = () => {} }) {
  const key = getSecret("usajobsKey"), email = getSettings().usajobsEmail;
  if (!key || !email) { log("USAJOBS is on, but there is no USAJOBS key in Settings"); return []; }
  const days = Math.max(1, Math.min(60, Number(prefs.postedWithinDays) || 14));
  const radius = Math.round((Number(prefs.radius) || 25) * (prefs.radiusUnit === "km" ? 0.621 : 1));
  // USAJOBS is U.S. only: cities elsewhere are left out, remote counts only for U.S. remote searches.
  const places = (prefs.cities || []).filter((c) => c.country === "US").map((c) => ({ LocationName: [c.name, c.region ? regionName(c) : ""].filter(Boolean).join(", "), Radius: String(radius) }));
  if (prefs.remote && (prefs.remoteCountry || "US") === "US") places.push({ RemoteIndicator: "True" });
  const runs = [];
  for (const title of prefs.titles || []) for (const p of places) runs.push({ title, ...p });
  const out = [];
  const now = thisCycle(runs, "usajobs");
  for (const [i, r] of now.entries()) {
    progress({ label: `USAJOBS: "${r.title}"${r.RemoteIndicator ? " remote" : ""}`, i, n: now.length });
    const { title, ...where } = r;
    // Jobs open to the public only: the others are for current federal employees and special groups.
    const q = new URLSearchParams({ Keyword: title, WhoMayApply: "public", DatePosted: String(days), ResultsPerPage: "50", Fields: "Full", ...where });
    try {
      const res = await fetch(`${ENDPOINT}?${q}`, { headers: headers(key, email), signal: AbortSignal.timeout(30000) });
      if (res.status === 401 || res.status === 403) throw new Error("the USAJOBS key was refused (Settings > Jobs to look for)");
      if (!res.ok) throw new Error(`USAJOBS answered ${res.status}`);
      const j = await res.json();
      for (const it of (j.SearchResult && j.SearchResult.SearchResultItems) || []) out.push(normalize(it));
    } catch (e) { log(`USAJOBS search "${title}" failed: ${e.message}`); if (/refused/.test(e.message)) break; }
  }
  return out;
}

// "CA" -> "California": USAJOBS place names read "Sacramento, California".
const US_STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico" };
function regionName(c) {
  const r = String(c.region || "");
  return US_STATES[r.toUpperCase()] || (c.label && c.label.split(",")[1] ? c.label.split(",")[1].trim() : r) || countryName(c.country);
}
