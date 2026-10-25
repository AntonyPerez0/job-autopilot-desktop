// Places, from the bundled GeoNames list (cities of 5,000+ people, CC BY 4.0):
// city search for onboarding, the cities inside the user's radius for the job
// search, and "is this posting's location inside the radius?".
import fs from "node:fs";

let DATA;
function data() {
  if (DATA) return DATA;
  const raw = JSON.parse(fs.readFileSync(new URL("../vendor/geo/cities.json", import.meta.url), "utf8"));
  const cities = raw.cities.map(([name, ascii, admin1, country, lat, lon, population]) => ({
    name, ascii: ascii || name, admin1, country, lat, lon, population,
    region: raw.admin1[`${country}.${admin1}`] || "",
  }));
  const byName = new Map();
  for (const c of cities) {
    for (const n of new Set([norm(c.name), norm(c.ascii)])) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(c);
    }
  }
  const countryNames = raw.countries;
  const countryByName = new Map(Object.entries(countryNames).map(([cc, n]) => [norm(n), cc]));
  for (const [alias, cc] of Object.entries({ usa: "US", "united states of america": "US", us: "US", uk: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB" })) countryByName.set(alias, cc);
  DATA = { cities, byName, countryNames, countryByName };
  return DATA;
}

export const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const US_STATES = { al: "Alabama", ak: "Alaska", az: "Arizona", ar: "Arkansas", ca: "California", co: "Colorado", ct: "Connecticut",
  de: "Delaware", fl: "Florida", ga: "Georgia", hi: "Hawaii", id: "Idaho", il: "Illinois", in: "Indiana", ia: "Iowa", ks: "Kansas",
  ky: "Kentucky", la: "Louisiana", me: "Maine", md: "Maryland", ma: "Massachusetts", mi: "Michigan", mn: "Minnesota", ms: "Mississippi",
  mo: "Missouri", mt: "Montana", ne: "Nebraska", nv: "Nevada", nh: "New Hampshire", nj: "New Jersey", nm: "New Mexico", ny: "New York",
  nc: "North Carolina", nd: "North Dakota", oh: "Ohio", ok: "Oklahoma", or: "Oregon", pa: "Pennsylvania", ri: "Rhode Island",
  sc: "South Carolina", sd: "South Dakota", tn: "Tennessee", tx: "Texas", ut: "Utah", vt: "Vermont", va: "Virginia", wa: "Washington",
  wv: "West Virginia", wi: "Wisconsin", wy: "Wyoming", dc: "District of Columbia" };
const CA_PROVINCES = { on: "Ontario", qc: "Quebec", bc: "British Columbia", ab: "Alberta", mb: "Manitoba", sk: "Saskatchewan",
  ns: "Nova Scotia", nb: "New Brunswick", nl: "Newfoundland and Labrador", pe: "Prince Edward Island" };

// Area names postings use that are not city names.
const AREAS = { "bay area": "San Francisco|CA|US", "sf bay area": "San Francisco|CA|US", "silicon valley": "San Jose|CA|US",
  sf: "San Francisco|CA|US", nyc: "New York City|NY|US", "new york city": "New York City|NY|US", "new york": "New York City|NY|US",
  la: "Los Angeles|CA|US", dfw: "Dallas|TX|US", "twin cities": "Minneapolis|MN|US", dmv: "Washington|DC|US" };

export function km(a, b) {
  const R = 6371, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export const toKm = (radius, unit) => Number(radius || 0) * (unit === "km" ? 1 : 1.609344);

const pub = (c) => c && { name: c.name, region: c.region, admin1: c.admin1, country: c.country, lat: c.lat, lon: c.lon, population: c.population,
  label: `${c.name}${c.region ? ", " + c.region : ""}, ${data().countryNames[c.country] || c.country}` };

// Onboarding search box: "aus" -> Austin, Texas, United States first.
export function searchCities(q, limit = 8) {
  const n = norm(q);
  if (n.length < 2) return [];
  const { cities } = data();
  const [cityPart, ...rest] = String(q).split(",");
  const cn = norm(cityPart), hint = norm(rest.join(" "));
  return cities.filter((c) => norm(c.ascii).startsWith(cn) || norm(c.name).startsWith(cn))
    .filter((c) => !hint || regionMatches(c, hint))
    .sort((a, b) => b.population - a.population).slice(0, limit).map(pub);
}

function regionMatches(c, hint) {
  const h = norm(hint);
  if (!h) return true;
  const words = h.split(" ");
  const region = norm(c.region), country = norm(data().countryNames[c.country]);
  const abbr = (c.country === "US" ? US_STATES : c.country === "CA" ? CA_PROVINCES : {})[h];
  if (abbr && norm(abbr) === region) return true;
  if (region && (region === h || (h.length >= 3 && region.startsWith(h)) || h.includes(region))) return true;
  if (country && (country === h || h.includes(country))) return true;
  if (words.includes(c.country.toLowerCase())) return true;
  const cc = data().countryByName.get(h);
  return cc === c.country;
}

// One part of a posting's location ("Dublin, CA", "Austin, Texas, United States", "Remote - US") to a place.
export function resolvePlace(text) {
  const raw = String(text || "").replace(/\([^)]*\)/g, " ").trim();
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return null;
  const { byName } = data();
  let name = norm(parts[0]).replace(/^(greater|metro|downtown)\s+/, "");
  if (!AREAS[name]) name = name.replace(/\s+(area|metro|metropolitan area)$/, "");
  let hint = parts.slice(1).join(" ");
  if (AREAS[name] && !hint) { const [n, st, cc] = AREAS[name].split("|"); name = norm(n); hint = `${st} ${cc}`; }
  else if (AREAS[name]) { name = norm(AREAS[name].split("|")[0]); }
  const cands = byName.get(name) || [];
  if (!cands.length) return null;
  if (hint) {
    const hits = cands.filter((c) => regionMatches(c, hint) || hint.split(/\s+/).some((w) => regionMatches(c, w)));
    return hits.length ? pub(hits.sort((a, b) => b.population - a.population)[0]) : null;
  }
  // No state or country given: the best-known place by that name ("Dublin" is Dublin, Ireland).
  return pub([...cands].sort((a, b) => b.population - a.population)[0]);
}

// Every place named in a location string ("San Francisco, CA; New York, NY | Remote").
export function placesIn(location) {
  return String(location || "").split(/;|\||\/|\bor\b|\band\b|\n/i).map((p) => resolvePlace(p)).filter(Boolean);
}

export function withinRadius(location, prefs) {
  const centers = (prefs.cities || []).filter((c) => c && typeof c.lat === "number");
  if (!centers.length) return false;
  const lim = toKm(prefs.radius, prefs.radiusUnit);
  return placesIn(location).some((p) => centers.some((c) => km(c, p) <= lim + 0.5));
}

// Cities inside the radius, biggest first, to hand to the job search as its city filter.
export function citiesNear(prefs, limit = 40) {
  const { cities } = data();
  const centers = (prefs.cities || []).filter((c) => c && typeof c.lat === "number");
  const lim = toKm(prefs.radius, prefs.radiusUnit);
  const out = new Map();
  for (const c of centers) out.set(c.name, 1e12);
  for (const c of cities) {
    if (centers.some((x) => x.country === c.country && km(x, c) <= lim)) out.set(c.name, Math.max(out.get(c.name) || 0, c.population));
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([n]) => n);
}

export const countryName = (cc) => data().countryNames[cc] || cc;
export const countryCode = (name) => (/^[A-Z]{2}$/.test(String(name)) ? name : data().countryByName.get(norm(name)) || null);
export const countries = () => Object.entries(data().countryNames).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));

// A remote posting open to the user's country, and not one that names only somewhere else.
export function remoteOk(job, cc) {
  if (job.work_mode !== "remote" && !/\bremote\b|anywhere/i.test(job.location || "")) return false;
  const list = (job.countries || []).map((x) => String(x).toUpperCase());
  if (list.length && !list.includes(cc)) return false;
  const loc = norm(job.location);
  const { countryByName } = data();
  for (const [n, code] of countryByName) {
    if (code !== cc && n.length > 3 && new RegExp(`\\b${n}\\b`).test(loc)) return false;
  }
  if (/\b(emea|apac|latam|europe|eu)\b/.test(loc)) return false;
  return true;
}
