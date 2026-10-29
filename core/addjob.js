// "Add a job": the user pastes a link they found anywhere (Google, Simplify,
// HiringCafe, a company's site, a friend's message) and the app takes it from there.
import crypto from "node:crypto";
import { classify, KIND_TEXT } from "./ats.js";
import { getDb, log } from "./db.js";
import { cleanUrl, jobKey, roleKey, sameRoleAs } from "./dedupe.js";
import { applyUrl, manualReason } from "./discover.js";
import { employerLinkFor } from "./sources/simplify.js";

const strip = (h) => String(h || "").slice(0, 100000).replace(/<[^<>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

// A job page is read up to 2 MB; the rest isn't downloaded.
export const MAX_PAGE = 2 * 1024 * 1024;
export async function textUpTo(res, max = MAX_PAGE) {
  if (!res.body) return "";
  const reader = res.body.getReader(), dec = new TextDecoder();
  let out = "", bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    out += dec.decode(value, { stream: true });
    if (bytes >= max) { await reader.cancel().catch(() => {}); break; }
  }
  return out.slice(0, max);
}

// The JobPosting data most career pages carry for Google, if the page has it.
export function jobPostingFrom(html) {
  // Only up to the last </script>: past it no script block can close, and searching there again and again is slow.
  const h = String(html).slice(0, MAX_PAGE), end = h.toLowerCase().lastIndexOf("</script>");
  for (const m of h.slice(0, end + 9).matchAll(/<script[^<>]+application\/ld\+json[^<>]*>([\s\S]*?)<\/script>/gi)) {
    let d;
    try { d = JSON.parse(m[1].trim()); } catch { continue; }
    const all = [].concat(d, d && d["@graph"] ? d["@graph"] : []).flat();
    const jp = all.find((x) => x && [].concat(x["@type"]).includes("JobPosting"));
    if (!jp) continue;
    const org = [].concat(jp.hiringOrganization || [])[0] || {};
    const loc = [].concat(jp.jobLocation || [])[0] || {};
    const ad = loc.address || {};
    const remote = /TELECOMMUTE/i.test(jp.jobLocationType || "");
    return {
      title: strip(jp.title), company: strip(typeof org === "string" ? org : org.name),
      location: remote ? "Remote" : [ad.addressLocality, ad.addressRegion].filter(Boolean).join(", "),
      work_mode: remote ? "remote" : "", description: strip(jp.description).slice(0, 12000), posted_at: jp.datePosted || "",
    };
  }
  return null;
}

function fromTitleTag(html, host) {
  html = String(html).slice(0, MAX_PAGE);
  const og = (p) => (html.match(new RegExp(`<meta[^<>]+property=["']og:${p}["'][^<>]+content=["']([^"'<>]+)`, "i")) || [])[1];
  const t = strip(og("title") || (html.match(/<title[^<>]*>([^<]*)<\/title>/i) || [])[1] || "");
  // "Cashier - Dessau RD - Pollo Regio": the last part names the employer (or the site).
  const parts = t.split(/\s+(?:[-|–@]|at)\s+/).map((x) => x.trim()).filter(Boolean);
  const company = parts.length > 1 ? parts.pop() : "";
  const title = parts.join(" - ");
  return { title: title || "Job", company: company || og("site_name") || host.replace(/^(www|jobs|careers|boards|apply)\./, "").split(".")[0], location: "", description: "" };
}

// ".../job/Austin-TX/Cashier---Front-End_R123" -> "Cashier - Front End"
export function titleFromPath(url) {
  const segs = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const last = segs.reverse().find((x) => /[a-z]{3}/i.test(x) && !/^(job|jobs|apply|application|details|en-us|careers?|viewjob|apps|new)$/i.test(x));
  if (!last) return "";
  return last.replace(/[_-](R|JR|REQ)?\d{3,}.*$/i, "").split("---").map((x) => x.replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean).join(" - ");
}

export async function resolveLink(raw, { browserPage } = {}) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error("That doesn't look like a web address. Copy the job's address from your browser's address bar."); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Paste a web address that starts with https://");
  let c = classify(url.href);
  if (c.ats === "google") throw new Error("That's a Google search page. Open the job there, press its Apply button, and paste the address of the page that opens.");
  if (c.ats === "simplify") {
    const j = await employerLinkFor(url.href);
    if (!j) throw new Error("This Simplify job isn't in Simplify's public lists. Open it on Simplify, press Apply, and paste the address of the page that opens.");
    return { ...j, slug: "link-" + j.slug };
  }
  if (c.ats === "hiringcafe" && browserPage) {
    const page = await browserPage.page();
    try {
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 60000 });
      const raw = await page.evaluate(() => (document.getElementById("__NEXT_DATA__") || {}).textContent || "");
      const m = raw.match(/"apply_url":"([^"]+)"/);
      if (!m) throw new Error("no link");
      url = new URL(JSON.parse(`"${m[1]}"`));
      c = classify(url.href);
    } catch { throw new Error("Couldn't read that HiringCafe job. Open it, press Apply, and paste the address of the page that opens."); }
    finally { await browserPage.done(page); }
  }
  let info = null;
  // GovernmentJobs.com's terms forbid automated access: its page is never fetched, the link names the job.
  if (c.ats === "neogov") {
    const parts = url.pathname.split("/").filter(Boolean);
    const agency = parts[0] === "careers" && parts[1] ? parts[1].replace(/[-_]+/g, " ").replace(/\b\w/g, (x) => x.toUpperCase()) : "Government employer";
    const hash = crypto.createHash("sha1").update(cleanUrl(url.href)).digest("hex").slice(0, 12);
    return { title: titleFromPath(url) || "Government job", company: agency, location: "", description: "", slug: "link-" + hash, url: url.href, apply_url: url.href, ats: c.ats, kind: c.kind, board: "added by you" };
  }
  try {
    const res = await fetch(url.href, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36" }, signal: AbortSignal.timeout(20000) });
    const html = await textUpTo(res, MAX_PAGE);
    if (res.status === 404 || res.status === 410) throw new Error("That job page is gone (the posting is probably closed).");
    info = jobPostingFrom(html) || (res.ok ? fromTitleTag(html, url.hostname) : null);
  } catch (e) { if (/gone/.test(e.message)) throw e; }
  info = info || { title: "Job", company: url.hostname.replace(/^(www|jobs|careers|boards|apply)\./, "").split(".")[0], location: "", description: "" };
  // Pages built by JavaScript (Workday) have no title to read: the link itself usually names the job.
  if (!info.title || info.title === "Job" || /^(careers?|jobs?|workday)$/i.test(info.title)) info.title = titleFromPath(url) || "Job";
  const hash = crypto.createHash("sha1").update(cleanUrl(url.href)).digest("hex").slice(0, 12);
  return { ...info, slug: "link-" + hash, url: url.href, apply_url: url.href, ats: c.ats, kind: c.kind, board: "added by you" };
}

export async function addJob(raw, opts = {}) {
  const j = await resolveLink(raw, opts);
  const db = getDb();
  const same = db.prepare("SELECT slug, title, company, status, applied_at FROM jobs WHERE slug = ? OR url = ? OR apply_url = ?").get(j.slug, j.url, j.url);
  if (same) {
    if (same.status === "applied" || same.status === "submitting") throw new Error(`You already applied to this one (${same.title} at ${same.company}).`);
    db.prepare("UPDATE jobs SET status = 'queued', attempts = 0, reason = 'added again by you', updated_at = datetime('now') WHERE slug = ?").run(same.slug);
    return { ...same, status: "queued", again: true };
  }
  const twin = sameRoleAs({ slug: j.slug, company: j.company, title: j.title },
    db.prepare("SELECT slug, company, title, status FROM jobs WHERE status IN ('applied', 'submitting')").all());
  if (twin && j.title !== "Job") throw new Error(`You already applied to this role: ${twin.title} at ${twin.company}.`);
  const manual = !(j.kind === "auto" || j.kind === "unknown");
  const status = manual ? "manual" : "queued";
  const reason = manual ? manualReason(j) || `Apply yourself: ${new URL(j.url).hostname.replace(/^www\./, "")} ${KIND_TEXT[j.kind]}` : "added by you; next in line";
  const apply = manual ? j.url : await applyUrl(j.ats, j.url);
  db.prepare(`INSERT INTO jobs (slug, key, title, company, location, work_mode, source, url, apply_url, posted_at, status, reason, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(j.slug, jobKey(j.company, j.title), j.title, j.company, j.location || "", j.work_mode || "",
    j.ats || "", j.url, apply, j.posted_at || "", status, reason, JSON.stringify({ description: j.description || "", board: j.board, kind: j.kind, addedByUser: true }));
  log(j.slug, `added by you: ${j.title} at ${j.company} (${status === "queued" ? "the app will apply" : "for you to apply to"})`);
  return { slug: j.slug, title: j.title, company: j.company, status, reason };
}

export const roleOf = (j) => roleKey(j.company, j.title);
