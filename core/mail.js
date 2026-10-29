// Read-only IMAP: the security code an employer emails mid-application
// (Greenhouse), and the "thank you for applying" emails that show a role was
// already applied to. The mailbox is opened with EXAMINE and messages are
// fetched with BODY.PEEK, so nothing is marked read, moved or deleted.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const PRESETS = {
  gmail: { name: "Gmail", host: "imap.gmail.com", port: 993, appPasswordUrl: "https://myaccount.google.com/apppasswords",
    steps: ["Turn on 2-Step Verification for your Google account (myaccount.google.com/security).",
      "Open myaccount.google.com/apppasswords, type a name like \"Job Autopilot\" and press Create.",
      "Copy the 16-letter password Google shows and paste it here. IMAP is on by default for Gmail."] },
  yahoo: { name: "Yahoo Mail", host: "imap.mail.yahoo.com", port: 993, appPasswordUrl: "https://login.yahoo.com/account/security",
    steps: ["Open login.yahoo.com/account/security and sign in.",
      "Choose \"Generate app password\" (or \"Manage app passwords\"), name it \"Job Autopilot\" and press Generate.",
      "Copy the password Yahoo shows and paste it here."] },
  icloud: { name: "iCloud Mail", host: "imap.mail.me.com", port: 993, appPasswordUrl: "https://account.apple.com",
    steps: ["Two-factor authentication must be on for your Apple Account (it is on for most accounts).",
      "Open account.apple.com, sign in, go to Sign-In and Security > App-Specific Passwords, and press +.",
      "Name it \"Job Autopilot\", copy the password and paste it here. Use your full @icloud.com (or @me.com) address as the email."] },
  outlook: { name: "Outlook / Hotmail", host: "outlook.office365.com", port: 993, unsupported: true, appPasswordUrl: "https://outlook.live.com/mail/0/options/mail/forwarding",
    steps: ["Microsoft turned off password sign-in for mail apps in September 2024 (it now requires a Microsoft sign-in this app does not have yet), so Outlook.com and Hotmail mailboxes cannot be read directly.",
      "Workaround: in Outlook on the web, Settings > Mail > Forwarding, forward your mail to a Gmail, Yahoo or iCloud mailbox, and connect that mailbox here instead.",
      "Or skip this step: Greenhouse jobs that email a code will wait for you in Needs a look."] },
  other: { name: "Other (IMAP)", host: "", port: 993, steps: ["Ask your email provider for its IMAP server name and whether it needs an app password."] },
};

// ---------- pure parts (unit tested) ----------

// An email's HTML is read up to 200,000 characters, with patterns that stop at the next tag.
const MAX_HTML = 200000;
// Script and style blocks out, in one pass: once a block has no end, nothing after it can end either.
function dropBlocks(h) {
  const low = h.toLowerCase(), rx = /<(script|style)\b[^<>]*>/gi;
  let out = "", at = 0, m;
  while ((m = rx.exec(h))) {
    const close = low.indexOf("</" + m[1].toLowerCase() + ">", rx.lastIndex);
    if (close < 0) break;
    out += h.slice(at, m.index) + " ";
    at = rx.lastIndex = close + m[1].length + 3;
  }
  return out + h.slice(at);
}
export function htmlToText(html) {
  return dropBlocks(String(html || "").slice(0, MAX_HTML))
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/td>|<\/h\d>/gi, "\n").replace(/<[^<>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
}

export const CODE_SUBJECT = /security code|verification code|verify your (email|application)|confirm your email/i;
const GREENHOUSE = /security code field on your application:\s*([A-Za-z0-9]{6,12})\b/i;
const CODE = [
  /(?:security|verification|confirmation)? ?code[^A-Za-z0-9]{0,40}?:?\s*\n?\s*([A-Za-z0-9]{6,10})\b/gi,
  /\b([A-Za-z0-9]{8})\b\s*(?:\n|$)/g,
];

export function findCode(text) {
  const m = String(text || "").match(GREENHOUSE);
  if (m) return m[1];
  for (const rx of CODE) {
    for (const x of String(text || "").matchAll(rx)) {
      const c = x[1];
      // a code has a digit or mixes upper and lower case; skip plain words and years
      const mixed = /[a-z]/.test(c) && /[A-Z]/.test(c);
      if ((/\d/.test(c) || mixed) && !/^(19|20)\d\d$/.test(c)) return c;
    }
  }
  return null;
}

// An account-confirmation link in an email: the first link on the site that asked (hostHint), or one
// whose address or text says verify/activate/confirm.
export const LINK_SUBJECT = /verify|activate|confirm|validate|complete your (account|registration)|welcome/i;
export function findLink(html, text, hostHint = "") {
  const links = [];
  const h = String(html || "").slice(0, MAX_HTML), end = h.toLowerCase().lastIndexOf("</a>");
  for (const m of h.slice(0, end + 4).matchAll(/<a\b[^<>]*href=["']([^"'<>]+)["'][^<>]*>([\s\S]*?)<\/a>/gi)) links.push({ url: m[1].replace(/&amp;/g, "&"), label: htmlToText(m[2]).trim() });
  for (const m of String(text || "").matchAll(/https?:\/\/[^\s<>"')]+/g)) links.push({ url: m[0], label: "" });
  const host = (u) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
  const hint = String(hostHint || "").toLowerCase();
  const ok = links.filter((l) => /^https:\/\//i.test(l.url) && !/unsubscribe|privacy|terms|help|support|mailto:/i.test(l.url + " " + l.label));
  const wanted = (l) => /verif|activat|confirm|validat/i.test(l.url + " " + l.label);
  return (ok.find((l) => hint && host(l.url).endsWith(hint) && wanted(l)) || ok.find((l) => hint && host(l.url).endsWith(hint)) || ok.find(wanted) || {}).url || null;
}

export const CONFIRM = /thank(s| you)[^.]{0,40}(appl|interest)|application (has been |was )?(received|submitted|complete)|we('ve| have)? received your application|your application (to|for)/i;
const NOISE = new Set(["the", "a", "an", "and", "of", "for", "to", "at", "in", "inc", "llc", "corp", "co", "remote", "hybrid", "onsite", "us", "usa", "new"]);
const words = (s) => (String(s || "").toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !NOISE.has(w));
export const companyKey = (company) => words(company)[0] || String(company || "").toLowerCase();

export function roleCore(title, company) {
  const ck = companyKey(company);
  let t = String(title || "").replace(/\([^)]*\)/g, " ");
  const tail = t.split(" - ").slice(-1)[0].toLowerCase();
  if (t.includes(" - ") && tail.includes(ck)) t = t.replace(/\s[-|–]\s.*$/, " ");
  return words(t).filter((w) => w !== ck);
}

// hits: [{ date, subject, text }] confirmation emails from this employer. Returns a description, or null.
export function matchConfirmation(hits, company, title) {
  const core = roleCore(title, company);
  for (const h of hits) {
    const text = (h.subject + " " + h.text).replace(/\s+/g, " ").toLowerCase();
    const present = core.filter((w) => new RegExp(`\\b${w}\\b`).test(text)).length;
    if (core.length && present >= Math.max(2, Math.round(core.length * 0.8))) return `${String(h.date).slice(0, 22)} | ${h.subject}`;
  }
  // one confirmation from the employer and it names no role we could check
  if (hits.length === 1) {
    const text = (hits[0].subject + " " + hits[0].text).toLowerCase();
    if (!core.some((w) => w.length > 3 && text.includes(w))) return `${String(hits[0].date).slice(0, 22)} | ${hits[0].subject} (names no role)`;
  }
  return null;
}

// ---------- who an email is really from ----------
// Employers' application systems, and the domains they send mail from.
export const ATS_SITES = ["greenhouse.io", "greenhouse-mail.io", "myworkdayjobs.com", "myworkday.com", "workday.com", "lever.co", "ashbyhq.com", "smartrecruiters.com", "workable.com"];
export const GREENHOUSE_MAIL = ["greenhouse.io", "greenhouse-mail.io"];
const canon = (h) => String(h || "").trim().toLowerCase().replace(/\.+$/, "");
const under = (h, d) => { h = canon(h); d = canon(d); return !!h && !!d && (h === d || h.endsWith("." + d)); };
export const senderDomain = (from) => canon((String(from || "").match(/@([A-Za-z0-9.-]+)\s*>?\s*$/) || String(from || "").match(/@([A-Za-z0-9.-]+)/) || [])[1]);
// The site a host belongs to: "globex.wd5.myworkdayjobs.com" -> "myworkdayjobs.com", "jobs.acme.co.uk" -> "acme.co.uk".
export function siteOf(host) {
  const parts = canon(host).split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const two = parts.slice(-2);
  return (two[1].length === 2 && /^(co|com|org|net|gov|ac|edu)$/.test(two[0]) ? parts.slice(-3) : two).join(".");
}
// The mailbox provider's own verdict, which it adds at the top of the message: a DKIM signature that passed,
// from one of these domains. Headers lower down could have been written by anyone, so only the first counts.
export function dkimPassFor(headers, domains) {
  const unfolded = String(headers || "").replace(/\r?\n[ \t]+/g, " ");
  const first = (unfolded.match(/^Authentication-Results:.*$/im) || [""])[0];
  return [...first.matchAll(/\bdkim=pass\b[^;]*?header\.(?:d|i)=@?([A-Za-z0-9.-]+)/gi)].some((m) => domains.some((d) => under(m[1], d)));
}
const headersOf = (source) => String(source || "").split(/\r?\n\r?\n/)[0];

// Of the emails that arrived after `since` (seconds, by the server's own clock), the code the form's own system
// sent: from one of `domains` (mailDomainsFor the form's page; Greenhouse by default), DKIM-signed by it;
// Greenhouse's own wording first. A code from anyone else is never used.
// mails: [{ from, headers, internalDate (Date or seconds), subject, text }], newest first.
export function pickCode(mails, since, domains = GREENHOUSE_MAIL) {
  const fromThem = (m) => domains.some((d) => under(senderDomain(m.from), d)) && dkimPassFor(m.headers, domains);
  const ok = mails.filter((m) => {
    const at = m.internalDate instanceof Date ? m.internalDate.getTime() / 1000 : Number(m.internalDate) || 0;
    return at >= since - 60 && CODE_SUBJECT.test(m.subject || "") && fromThem(m);
  });
  for (const m of ok) { const x = String(m.text || "").match(GREENHOUSE); if (x) return x[1]; }
  for (const m of ok) { const c = findCode(m.text); if (c) return c; }
  return null;
}

// The confirmation link for the site that asked (hostHint): sent from that site or a known ATS, and pointing
// to that host or a known ATS. A link from anyone else, or to anywhere else, is never opened.
export function pickLink(mails, since, hostHint) {
  const site = siteOf(hostHint);
  const senderOk = (m) => { const d = senderDomain(m.from); return (!!site && siteOf(d) === site) || ATS_SITES.some((x) => under(d, x)); };
  for (const m of mails) {
    const at = m.internalDate instanceof Date ? m.internalDate.getTime() / 1000 : Number(m.internalDate) || 0;
    if (at < since - 60 || !LINK_SUBJECT.test(m.subject || "") || !senderOk(m)) continue;
    const link = findLink(m.html, m.plain, hostHint);
    if (!link) continue;
    const h = (() => { try { return new URL(link).hostname; } catch { return ""; } })();
    if (under(h, hostHint) || ATS_SITES.some((x) => under(h, x))) return link;
  }
  return null;
}

// ---------- IMAP ----------

async function connect(cfg) {
  if (!cfg || !cfg.host || !cfg.user || !cfg.pass) return null;
  const client = new ImapFlow({ host: cfg.host, port: cfg.port || 993, secure: true, auth: { user: cfg.user, pass: cfg.pass }, logger: false,
    socketTimeout: 60000, connectionTimeout: 30000 });
  client.on("error", () => {});
  await client.connect();
  return client;
}

async function folders(client) {
  const out = ["INBOX"];
  try {
    for (const b of await client.list()) if (b.specialUse === "\\Junk" || /^(bulk|spam|junk)( mail| email)?$/i.test(b.name)) out.push(b.path);
  } catch { /* INBOX only */ }
  return out;
}

const textOf = async (source) => {
  const m = await simpleParser(source);
  return { subject: m.subject || "", date: m.date ? m.date.toISOString() : "", from: (m.from && m.from.text) || "", text: (m.text || "") + "\n" + htmlToText(m.html || ""), html: m.html || "", plain: m.text || "" };
};

export async function testMailbox(cfg) {
  const c = await connect(cfg);
  if (!c) throw new Error("Fill in the server, email and app password.");
  try { await c.mailboxOpen("INBOX", { readOnly: true }); return true; } finally { await c.logout().catch(() => {}); }
}

// The newest emails in INBOX (never Spam) since a day before `since`, with what pickCode and pickLink need.
async function recentMail(c, since) {
  await c.mailboxOpen("INBOX", { readOnly: true });
  const uids = (await c.search({ since: new Date((since - 86400) * 1000) }, { uid: true })) || [];
  const out = [];
  for (const uid of uids.slice(-30).reverse()) {
    const msg = await c.fetchOne(String(uid), { source: true, envelope: true, internalDate: true }, { uid: true });
    if (!msg) continue;
    const t = await textOf(msg.source);
    const from = ((msg.envelope && msg.envelope.from) || []).map((x) => x.address || "").join(" ") || t.from;
    out.push({ from, headers: headersOf(msg.source), internalDate: msg.internalDate, subject: (msg.envelope && msg.envelope.subject) || t.subject, text: t.text, html: t.html, plain: t.plain });
  }
  return out;
}

// Wait for the code Greenhouse emailed after `since` (seconds). Returns the code or null.
export async function waitForCode(cfg, since, timeoutSec = 180, domains = GREENHOUSE_MAIL) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    let c;
    try {
      c = await connect(cfg);
      if (!c) return null;
      const code = pickCode(await recentMail(c, since), since, domains);
      if (code) return code;
    } catch { /* try again until the deadline */ } finally { if (c) await c.logout().catch(() => {}); }
    await new Promise((r) => setTimeout(r, 8000));
  }
  return null;
}

// Wait for an account-confirmation email that arrived after `since` (seconds); returns its link or null.
export async function waitForLink(cfg, since, hostHint = "", timeoutSec = 180) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    let c;
    try {
      c = await connect(cfg);
      if (!c) return null;
      const link = pickLink(await recentMail(c, since), since, hostHint);
      if (link) return link;
    } catch { /* try again until the deadline */ } finally { if (c) await c.logout().catch(() => {}); }
    await new Promise((r) => setTimeout(r, 8000));
  }
  return null;
}

// Has the employer already confirmed an application for this role? A description, null for no, undefined if unreadable.
// Where an application system sends its mail from.
const ATS_MAIL = [
  [/(^|\.)greenhouse\.io$/, ["greenhouse.io", "greenhouse-mail.io"]], [/(^|\.)lever\.co$/, ["lever.co"]], [/(^|\.)ashbyhq\.com$/, ["ashbyhq.com"]],
  [/(^|\.)(myworkdayjobs|myworkday|workday)\.com$/, ["myworkday.com", "workday.com", "myworkdayjobs.com"]],
  [/(^|\.)smartrecruiters\.com$/, ["smartrecruiters.com"]], [/(^|\.)workable\.com$/, ["workable.com", "workablemail.com"]],
  [/(^|\.)icims\.com$/, ["icims.com"]], [/(^|\.)jobvite\.com$/, ["jobvite.com"]], [/(^|\.)bamboohr\.com$/, ["bamboohr.com"]],
  [/(^|\.)taleo\.net$/, ["taleo.net"]], [/(^|\.)oraclecloud\.com$/, ["oraclecloud.com", "oracle.com"]],
  [/(^|\.)(successfactors|sapsf)\.(com|eu)$/, ["successfactors.com", "successfactors.eu", "sapsf.com", "sapsf.eu"]],
  [/(^|\.)paylocity\.com$/, ["paylocity.com"]], [/(^|\.)paycomonline\.(net|com)$/, ["paycomonline.net", "paycom.com"]], [/(^|\.)(recruitingbypaycor|paycor)\.com$/, ["paycor.com"]],
  [/(^|\.)teamtailor\.com$/, ["teamtailor.com"]], [/(^|\.)recruitee\.com$/, ["recruitee.com"]], [/(^|\.)breezy\.hr$/, ["breezy.hr"]],
  [/(^|\.)applytojob\.com$/, ["applytojob.com", "jazzhr.com"]], [/(^|\.)(ats\.rippling\.com|rippling-ats\.com)$/, ["rippling.com"]],
  [/(^|\.)jobs\.personio\.(de|com)$/, ["personio.de", "personio.com"]], [/(^|\.)comeet\.(co|com)$/, ["comeet.co", "comeet.com"]],
];
// Where the system a page is on sends its mail from; for a form on the employer's own site, that site.
export function mailDomainsFor(url) {
  const host = canon((() => { try { return new URL(String(url || "")).hostname; } catch { return ""; } })());
  if (!host) return [];
  const ats = ATS_MAIL.find(([rx]) => rx.test(host));
  return ats ? ats[1] : [siteOf(host)];
}
const ALL_ATS_MAIL = [...new Set(ATS_MAIL.flatMap(([, d]) => d))];
// A "thank you for applying" email counts only when it's from an application system the app knows, the job's
// own site, or a domain named after the employer (acme.com or acmehealth.com for "Acme Health", not
// acme-careers.test); signed by that domain (DKIM pass, the provider's topmost verdict); and naming the employer
// in full, not just the first word, in its subject or its sender's name. A forged one could at most skip a job.
// mail: { from ("Name <address>"), headers, subject }; job: { company, url }.
export function confirmationOk(mail, job) {
  const d = senderDomain(mail.from), name = words(job.company);
  if (!d || !name.length) return false;
  const site = siteOf(d), label = site.split(".")[0].replace(/[^a-z0-9]/g, "");
  const signer = [...mailDomainsFor(job.url), ...ALL_ATS_MAIL].find((x) => under(d, x)) || (label === name.join("") || label === name[0] ? site : null);
  if (!signer || !dkimPassFor(mail.headers, [signer])) return false;
  const display = String(mail.from || "").replace(/<[^>]*>|\S+@\S+/g, " ");
  return [mail.subject, display].some((t) => { const w = words(t); return name.every((x) => w.includes(x)); });
}

export async function findConfirmation(cfg, company, title, days = 60, url = "") {
  let c;
  try {
    c = await connect(cfg);
    if (!c) return undefined;
    const ck = companyKey(company);
    const hits = [];
    for (const box of await folders(c)) {
      try { await c.mailboxOpen(box, { readOnly: true }); } catch { continue; }
      const uids = (await c.search({ since: new Date(Date.now() - days * 86400000), or: [{ subject: ck }, { from: ck }] }, { uid: true })) || [];
      for (const uid of uids.slice(-40)) {
        const msg = await c.fetchOne(String(uid), { envelope: true, source: true }, { uid: true });
        if (!msg) continue;
        const subject = (msg.envelope && msg.envelope.subject) || "";
        const from = ((msg.envelope && msg.envelope.from) || []).map((x) => `${x.name || ""} <${x.address || ""}>`).join(", ");
        if (!CONFIRM.test(subject) || CODE_SUBJECT.test(subject) || !confirmationOk({ from, headers: headersOf(msg.source), subject }, { company, url })) continue;
        const t = await textOf(msg.source);
        hits.push({ date: t.date, subject, text: t.text });
      }
    }
    return matchConfirmation(hits, company, title);
  } catch { return undefined; } finally { if (c) await c.logout().catch(() => {}); }
}
