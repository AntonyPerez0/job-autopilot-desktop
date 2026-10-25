// HiringCafe (hiringcafe.com): jobs of every kind, read straight from employers'
// own career sites. It blocks plain requests, so the app reads it the way a
// person would, in its own browser: one results page per search, a few searches
// every couple of hours, nothing more (its terms allow personal use).
import { classifyNamed } from "../ats.js";
import { countryName, toKm } from "../geo.js";

const BASE = "https://hiringcafe.com";
const MAX_SEARCHES = 8;
const PAUSE_MS = 4000;

// HiringCafe's level names -> the app's (freehire's) level names.
export function levelOf(s) {
  const t = String(s || "").toLowerCase();
  if (/intern/.test(t)) return "intern";
  if (/no prior|entry|junior|associate/.test(t)) return "junior";
  if (/mid/.test(t)) return "middle";
  if (/senior/.test(t)) return "senior";
  if (/lead|manager|director|head|executive|vp|chief|principal/.test(t)) return "lead";
  return "";
}

function salaryOf(v) {
  const cur = v.listed_compensation_currency || "USD";
  const money = (n) => (cur === "USD" ? "$" : cur + " ") + Math.round(n).toLocaleString("en-US");
  if (v.listed_compensation_frequency === "Hourly" && v.hourly_min_compensation) {
    return `${money(v.hourly_min_compensation)}${v.hourly_max_compensation && v.hourly_max_compensation !== v.hourly_min_compensation ? "-" + money(v.hourly_max_compensation) : ""}/hour`;
  }
  if (v.yearly_min_compensation) return `${money(v.yearly_min_compensation)}${v.yearly_max_compensation ? "-" + money(v.yearly_max_compensation) : ""}/year`;
  return null;
}

// One hit from a results page -> the app's job shape.
export function normalize(hit) {
  const v = hit.v5_processed_job_data || {}, ji = hit.job_information || {}, org = hit.enriched_company_data || hit.attributed_org_card || {};
  const { ats, kind } = classifyNamed(hit.source, hit.apply_url);
  const yoe = v.min_industry_and_role_yoe;
  return {
    slug: "hc-" + String(hit.requisition_id || hit.id || hit.objectID).replace(/[^A-Za-z0-9_-]+/g, "-").slice(0, 80),
    title: ji.title || ji.job_title_raw || v.core_job_title || "",
    company: v.company_name || org.name || "",
    location: v.formatted_workplace_location || (v.workplace_cities || []).join("; ") || "",
    work_mode: String(v.workplace_type || "").toLowerCase(),
    countries: v.workplace_countries || [],
    geo: (hit._geoloc || []).filter((g) => g && typeof g.lat === "number" && (g.lat || g.lon)),
    url: hit.apply_url, apply_url: hit.apply_url, ats, kind, board: "HiringCafe",
    posted_at: v.estimated_publish_date_millis ? new Date(v.estimated_publish_date_millis).toISOString() : "",
    salary: salaryOf(v),
    level: levelOf(v.seniority_level), minYears: typeof yoe === "number" ? yoe : null,
    sponsorship: v.visa_sponsorship,
    expired: !!hit.is_expired,
    description: [v.company_tagline || org.tagline, v.requirements_summary, (v.role_activities || []).length ? "Activities: " + v.role_activities.join(", ") : "",
      v.commitment ? "Commitment: " + [].concat(v.commitment).join(", ") : "", v.seniority_level ? "Level: " + v.seniority_level : "",
      typeof yoe === "number" ? `Minimum experience: ${yoe} years` : ""].filter(Boolean).join("\n"),
  };
}

export function searchUrl(query, location, prefs) {
  const state = { searchQuery: query, dateFetchedPastNDays: Number(prefs.postedWithinDays) || 14, sortBy: "date" };
  if (location) state.locations = [location];
  return `${BASE}/classic?searchState=${encodeURIComponent(JSON.stringify(state))}`;
}

// HiringCafe's own place record for a city (it needs its id), with the user's radius.
async function placeFor(page, city, prefs) {
  const q = new URLSearchParams({ query: city.name, country: city.country || "US" });
  const list = await page.evaluate((u) => fetch(u).then((r) => r.json()).catch(() => []), `${BASE}/api/searchLocation?${q}`);
  const region = String(city.admin1 || city.region || "").toLowerCase();
  const pick = (list || []).find((x) => x.placeDetail && /locality/.test((x.placeDetail.types || []).join()) &&
    (x.placeDetail.address_components || []).some((c) => [c.short_name, c.long_name].map((s) => String(s).toLowerCase()).includes(region))) ||
    (list || []).find((x) => x.placeDetail && x.label.toLowerCase().startsWith(city.name.toLowerCase()));
  if (!pick) return null;
  const miles = Math.max(1, Math.round(toKm(prefs.radius, prefs.radiusUnit) / 1.609344));
  return { ...pick.placeDetail, geometry: pick.placeDetail.geometry || { location: { lat: city.lat, lon: city.lon } }, workplace_types: [],
    options: { radius: miles, radius_unit: "miles", ignore_radius: false } };
}

// A whole country, the way HiringCafe writes its default "your country" location; remote jobs only.
export function countryPlace(cc, name) {
  return { formatted_address: name, types: ["country"], geometry: { location: { lat: 0, lon: 0 } }, id: "user_country",
    address_components: [{ long_name: name, short_name: cc, types: ["country"] }], workplace_types: ["Remote"], options: { flexible_regions: [] } };
}

async function readResults(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#__NEXT_DATA__", { state: "attached", timeout: 30000 });
  const raw = await page.evaluate(() => document.getElementById("__NEXT_DATA__").textContent);
  const pp = (JSON.parse(raw).props || {}).pageProps || {};
  if (pp.ssrError) throw new Error("HiringCafe: " + String(pp.ssrError).slice(0, 120));
  return pp.ssrHits || [];
}

// browser: { page() -> a Playwright page, done(page) }
export async function search(prefs, { browser, progress = () => {}, log = () => {} }) {
  const page = await browser.page();
  const out = [];
  try {
    await page.goto(BASE + "/classic", { waitUntil: "domcontentloaded", timeout: 60000 });
    const places = [];
    for (const c of prefs.cities || []) { const p = await placeFor(page, c, prefs).catch(() => null); if (p) places.push(p); else log(`HiringCafe does not know ${c.name}; skipped`); }
    if (prefs.remote) places.push(countryPlace(prefs.remoteCountry || "US", countryName(prefs.remoteCountry || "US")));
    const runs = [];
    for (const title of prefs.titles || []) for (const p of places) runs.push([title, p]);
    for (const [i, [title, place]] of runs.slice(0, MAX_SEARCHES).entries()) {
      progress({ label: `HiringCafe: "${title}" ${place.workplace_types && place.workplace_types.length ? "remote" : "near " + (place.formatted_address || "").split(",")[0]}`, i, n: Math.min(runs.length, MAX_SEARCHES) });
      if (i) await page.waitForTimeout(PAUSE_MS);
      try {
        const remote = place.workplace_types && place.workplace_types.length;
        for (const h of await readResults(page, searchUrl(title, place, prefs))) {
          const j = normalize(h);
          if (j.expired || !j.apply_url || !j.title) continue;
          if (remote && j.work_mode !== "remote") continue;
          out.push(j);
        }
      } catch (e) { log(`HiringCafe search "${title}" failed: ${e.message}`); }
    }
    if (runs.length > MAX_SEARCHES) log(`HiringCafe: only the first ${MAX_SEARCHES} of ${runs.length} searches run each round, to stay gentle`);
  } finally { await browser.done(page); }
  return out;
}
