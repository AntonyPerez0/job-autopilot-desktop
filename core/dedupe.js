// Never apply twice: the same posting, the same role on another board or under
// a variant title, or a role the user already applied to outside the app.
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const jobKey = (company, title) => norm(company).split(" ").slice(0, 2).join(" ") + "|" + norm(title);

// The same role at the same employer, whatever the board or the suffix on the title
// ("... New Grad" and "... New Grad (Remote)"; "Engineer - Acme" and "Engineer").
const STOP = new Set(["the", "a", "an", "and", "of", "for", "to", "at", "in", "remote", "hybrid", "onsite", "us", "usa"]);
export function roleKey(company, title) {
  const co = String(company || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/)[0] || "";
  const t = String(title || "").toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/).filter((w) => w && !STOP.has(w) && w !== co);
  return co + "|" + t.join(" ");
}

export const cleanUrl = (u) => String(u || "").trim().replace(/[?#].*$/, "").replace(/\/(apply|application)\/?$/, "").replace(/\/+$/, "").toLowerCase();

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
  return rows.find((j) => j.slug !== job.slug && (j.status === "applied" || j.status === "submitting") && roleKey(j.company, j.title) === key) || null;
}
