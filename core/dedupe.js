// Never apply twice: the same posting, the same role on another board or under
// a variant title, or a role the user already applied to outside the app.
// Names and titles are read up to 300 characters, links up to 2048, before any pattern runs on them.
const name = (s) => String(s || "").slice(0, 300);
const norm = (s) => name(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const jobKey = (company, title) => norm(company).split(" ").slice(0, 2).join(" ") + "|" + norm(title);

// The same role at the same employer, whatever the board or the suffix on the title
// ("... New Grad" and "... New Grad (Remote)"; "Engineer - Acme" and "Engineer").
const STOP = new Set(["the", "a", "an", "and", "of", "for", "to", "at", "in", "remote", "hybrid", "onsite", "us", "usa"]);
// The employer's whole name ("Acme Staffing Partners" is not "Acme"), without the legal form ("Globex, Inc." is "Globex").
const LEGAL = new Set(["inc", "incorporated", "llc", "llp", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "gmbh", "ag", "sa", "pbc"]);
export function companyKey(company) {
  const w = name(company).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (w[0] === "the" && w.length > 1) w.shift();
  while (w.length > 1 && LEGAL.has(w[w.length - 1])) w.pop();
  return w.join(" ");
}
export function roleKey(company, title) {
  const co = companyKey(company), cw = new Set(co.split(" "));
  const t = name(title).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter((w) => w && !STOP.has(w) && !cw.has(w));
  return co + "|" + t.join(" ");
}

// The employer's site a posting is on: the host, and on an application system shared by many employers the
// employer's own part of it (boards.greenhouse.io/acme, apply.workable.com/acme). One posting only stands in for
// another (as already applied, or for its screening) on the same site: a look-alike elsewhere can't push it out.
const TENANT_IN_PATH = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|bamboohr\.com|jobvite\.com|recruitee\.com|breezy\.hr|teamtailor\.com|applytojob\.com|icims\.com)$/;
export function siteKey(url) {
  let u;
  try { u = new URL(String(url || "").slice(0, 2048)); } catch { return ""; }
  const host = u.hostname.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  const seg = (u.pathname.split("/").filter(Boolean).find((x) => !/^(embed|job_app|jobs?|j|o|en(-[a-z]{2})?)$/i.test(x)) || "").toLowerCase();
  return TENANT_IN_PATH.test(host) && seg ? `${host}/${seg}` : host;
}
// The same employer on its own site and on an application system: the system's name for the employer (its
// tenant: boards.greenhouse.io/acme, acme.wd5.myworkdayjobs.com) equals the name of the employer's own domain
// (acme.com). A tenant is only ever matched to an own domain, never one own domain to another, so acme.io
// can't stand in for acme.com.
const PATH_TENANT = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|jobvite\.com)$/;
const SUB_TENANT = /\.(myworkdayjobs\.com|myworkdaysite\.com|icims\.com|bamboohr\.com|recruitee\.com|breezy\.hr|teamtailor\.com|applytojob\.com|jobs\.personio\.(de|com)|taleo\.net)$/;
const SYSTEM = /(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|smartrecruiters\.com|jobvite\.com|myworkdayjobs\.com|myworkdaysite\.com|myworkday\.com|icims\.com|bamboohr\.com|recruitee\.com|breezy\.hr|teamtailor\.com|applytojob\.com|personio\.(de|com)|taleo\.net|oraclecloud\.com|paylocity\.com|paycomonline\.(net|com)|paycor\.com|rippling\.com|careerplug\.com|hireology\.com)$/;
const tname = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "").replace(/^(careers?|jobs?)(?=.{3})/, "").replace(/(careers?|jobs?)$/, "");
export function siteInfo(url) {
  const site = siteKey(url);
  if (!site) return { site: "", tenant: "", own: "" };
  const u = new URL(String(url).slice(0, 2048)), host = u.hostname.toLowerCase().replace(/\.+$/, "").replace(/^www\./, "");
  let tenant = "";
  if (PATH_TENANT.test(host)) tenant = tname(u.searchParams.get("for") || (site.includes("/") ? site.split("/")[1] : ""));
  else if (SUB_TENANT.test(host)) tenant = tname(host.split(".")[0]);
  if (tenant || SYSTEM.test(host)) return { site, tenant, own: "" };
  const p = host.split(".");
  const two = p.length > 2 && p[p.length - 1].length === 2 && /^(co|com|org|net|gov|ac|edu)$/.test(p[p.length - 2]);
  return { site, tenant: "", own: tname(p[p.length - (two ? 3 : 2)] || "") };
}
// Keys a posting is stored under, and the keys that find a posting already stored, for a dedupe key `key`.
// A posting without a link is stored under "any", which every lookup also checks (nothing tells it apart).
export const storeKeys = (url, key) => { const s = siteInfo(url); return s.site ? [s.site + "#" + key, s.tenant && `tenant:${s.tenant}#${key}`, s.own && `own:${s.own}#${key}`].filter(Boolean) : ["any#" + key]; };
export const lookupKeys = (url, key) => { const s = siteInfo(url); return [`any#${key}`, ...(s.site ? [s.site + "#" + key, s.tenant && `own:${s.tenant}#${key}`, s.own && `tenant:${s.own}#${key}`] : [])].filter(Boolean); };

const siteOfJob = (j) => siteInfo(j.url || j.apply_url || j.official_job_url);
// Two postings on the same employer site (or the employer's own site and its system's), or one of them without
// a link at all (nothing to tell them apart by).
export const sameSite = (a, b) => {
  const x = siteOfJob(a), y = siteOfJob(b);
  return !x.site || !y.site || x.site === y.site || (!!x.tenant && x.tenant === y.own) || (!!y.tenant && y.tenant === x.own);
};

// One job posted for many locations ("Delivery Driver(07800) - 5051 Auburn Blvd", "Delivery Driver(07906) - 6306 Fair
// Oaks Blvd"): the same employer and the same title once store numbers and addresses are taken off.
export function familyKey(company, title) {
  const t = name(title).replace(/\s+[-–|:]\s+(?=.*\d).*$/, " ").replace(/\d+/g, " ");
  return roleKey(company, t);
}

export const cleanUrl = (u) => String(u || "").slice(0, 2048).trim().replace(/[?#].*$/, "").replace(/\/(apply|application)\/?$/, "").replace(/\/+$/, "").toLowerCase();

// The user's own list: one per line, a posting URL or "Company - Title" / "Title at Company" / "Company, Title".
export function parseAppliedList(text) {
  const urls = new Set(), roles = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^https?:\/\//i.test(line)) { urls.add(cleanUrl(line)); continue; }
    let m = line.match(/^(.+?)\s+(?:-|–|—|\|)\s+(.+)$/) || line.match(/^(.+?),\s*(.+)$/);
    if (m) { roles.add(roleKey(m[1], m[2])); continue; }
    m = line.match(/^(.+)\s+at\s+(.+)$/i);
    if (m) roles.add(roleKey(m[2], m[1]));
  }
  return { urls, roles };
}

export function inAppliedList(list, job) {
  return [job.url, job.apply_url, job.official_job_url].some((u) => u && list.urls.has(cleanUrl(u))) ||
    list.roles.has(roleKey(job.company, job.title));
}

// An applied job at the same address, from rows of { slug, url, apply_url }.
export function sameUrlAs(job, rows) {
  const mine = [job.url, job.apply_url, job.official_job_url].filter(Boolean).map(cleanUrl);
  if (!mine.length) return null;
  return rows.find((r) => r.slug !== job.slug && [r.url, r.apply_url].filter(Boolean).map(cleanUrl).some((u) => mine.includes(u))) || null;
}

// An applied (or mid-submit) job for the same role, from rows of { slug, company, title, status }.
export function sameRoleAs(job, rows) {
  const key = roleKey(job.company, job.title);
  return rows.find((j) => j.slug !== job.slug && (j.status === "applied" || j.status === "submitting") && roleKey(j.company, j.title) === key && sameSite(job, j)) || null;
}
