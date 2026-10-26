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

export function htmlToText(html) {
  return String(html || "").replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/td>|<\/h\d>/gi, "\n").replace(/<[^>]+>/g, " ")
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
  for (const m of String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) links.push({ url: m[1].replace(/&amp;/g, "&"), label: htmlToText(m[2]).trim() });
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

// Wait for an emailed code that arrived after `since` (seconds). Returns the code or null.
export async function waitForCode(cfg, since, timeoutSec = 180) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    let c;
    try {
      c = await connect(cfg);
      if (!c) return null;
      for (const box of await folders(c)) {
        try { await c.mailboxOpen(box, { readOnly: true }); } catch { continue; }
        const uids = (await c.search({ since: new Date((since - 86400) * 1000) }, { uid: true })) || [];
        for (const uid of uids.slice(-30).reverse()) {
          const msg = await c.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          if (!msg) continue;
          const when = msg.envelope && msg.envelope.date ? msg.envelope.date.getTime() / 1000 : 0;
          if (when < since - 60 || !CODE_SUBJECT.test((msg.envelope && msg.envelope.subject) || "")) continue;
          const code = findCode((await textOf(msg.source)).text);
          if (code) return code;
        }
      }
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
      for (const box of await folders(c)) {
        try { await c.mailboxOpen(box, { readOnly: true }); } catch { continue; }
        const uids = (await c.search({ since: new Date((since - 86400) * 1000) }, { uid: true })) || [];
        for (const uid of uids.slice(-30).reverse()) {
          const msg = await c.fetchOne(String(uid), { source: true, envelope: true }, { uid: true });
          if (!msg) continue;
          const when = msg.envelope && msg.envelope.date ? msg.envelope.date.getTime() / 1000 : 0;
          if (when < since - 60 || !LINK_SUBJECT.test((msg.envelope && msg.envelope.subject) || "")) continue;
          const t = await textOf(msg.source);
          const link = findLink(t.html, t.plain, hostHint);
          if (link) return link;
        }
      }
    } catch { /* try again until the deadline */ } finally { if (c) await c.logout().catch(() => {}); }
    await new Promise((r) => setTimeout(r, 8000));
  }
  return null;
}

// Has the employer already confirmed an application for this role? A description, null for no, undefined if unreadable.
export async function findConfirmation(cfg, company, title, days = 60) {
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
        const from = ((msg.envelope && msg.envelope.from) || []).map((x) => `${x.name || ""} ${x.address || ""}`).join(" ");
        if (!CONFIRM.test(subject) || CODE_SUBJECT.test(subject) || !(subject + " " + from).toLowerCase().includes(ck)) continue;
        const t = await textOf(msg.source);
        hits.push({ date: t.date, subject, text: t.text });
      }
    }
    return matchConfirmation(hits, company, title);
  } catch { return undefined; } finally { if (c) await c.logout().catch(() => {}); }
}
