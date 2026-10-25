// Where an application link leads, and whether the app can apply there.
//   auto:    an employer form that needs no account; the app fills and submits it
//   account: the site makes you create an account or sign in first; the user applies
//   chat:    a chat bot instead of a form (Paradox's "Olivia"); the user applies
//   board:   a job board's copy of the posting, not the employer's form; the user applies
//   unknown: anything else; the app opens it and decides from what the page shows
const RULES = [
  // forms that need no account
  ["greenhouse", "auto", /(^|\.)greenhouse\.io$/],
  ["lever", "auto", /(^|\.)lever\.co$/],
  ["ashby", "auto", /(^|\.)ashbyhq\.com$/],
  ["smartrecruiters", "auto", /(^|\.)smartrecruiters\.com$/],
  ["workable", "auto", /(^|\.)workable\.com$/],
  ["careerplug", "auto", /(^|\.)careerplug\.com$/],
  ["jazzhr", "auto", /(^|\.)applytojob\.com$/],
  ["bamboohr", "auto", /(^|\.)bamboohr\.com$/],
  ["recruitee", "auto", /(^|\.)recruitee\.com$/],
  ["breezy", "auto", /(^|\.)breezy\.hr$/],
  ["jobvite", "auto", /(^|\.)jobvite\.com$/],
  ["hireology", "auto", /(^|\.)hireology\.com$/],
  ["paycom", "auto", /(^|\.)paycomonline\.(net|com)$/],
  ["paycor", "auto", /(^|\.)(recruitingbypaycor|paycor)\.com$/],
  ["rippling", "auto", /(^|\.)(ats\.rippling\.com|rippling-ats\.com)$/],
  ["teamtailor", "auto", /(^|\.)teamtailor\.com$/],
  ["pinpoint", "auto", /(^|\.)pinpointhq\.com$/],
  ["gem", "auto", /^jobs\.gem\.com$/],
  ["applicantpro", "auto", /(^|\.)applicantpro\.com$/],
  ["hrmdirect", "auto", /(^|\.)hrmdirect\.com$/],
  ["isolved", "auto", /(^|\.)isolvedhire\.com$/],
  ["applicantpool", "auto", /(^|\.)applicantpool\.com$/],
  ["jobscore", "auto", /(^|\.)jobscore\.com$/],
  ["personio", "auto", /(^|\.)jobs\.personio\.(de|com)$/],
  ["paylocity", "auto", /(^|\.)recruiting\.paylocity\.com$/],
  ["gusto", "auto", /^jobs\.gusto\.com$/],
  ["hirebridge", "auto", /(^|\.)hirebridge\.com$/],
  // accounts first
  ["workday", "account", /(^|\.)(myworkdayjobs|myworkday|workday)\.com$/],
  ["icims", "account", /(^|\.)icims\.com$/],
  ["taleo", "account", /(^|\.)taleo\.net$/],
  ["oracle", "account", /(^|\.)oraclecloud\.com$/],
  ["successfactors", "account", /(^|\.)(successfactors\.(com|eu)|sapsf\.com)$/],
  ["brassring", "account", /(^|\.)brassring\.com$/],
  ["adp", "account", /(^|\.)(adp\.com|workforcenow\.adp\.com)$/],
  ["ukg", "account", /(^|\.)(ultipro\.com|ukg\.net|kronos\.net|kronos\.com)$/],
  ["dayforce", "account", /(^|\.)dayforcehcm\.com$/],
  ["eightfold", "account", /(^|\.)eightfold\.ai$/],
  ["avature", "account", /(^|\.)avature\.net$/],
  ["phenom", "account", /(^|\.)phenompeople\.com$/],
  ["harri", "account", /(^|\.)harri\.com$/],
  ["peoplematter", "account", /(^|\.)peoplematter\.(jobs|com)$/],
  // chat bots
  ["paradox", "chat", /(^|\.)paradox\.ai$/],
  ["fountain", "chat", /(^|\.)fountain\.com$/],
  ["workstream", "chat", /(^|\.)workstream\.(us|is)$/],
  // job boards (their own copy of the posting; applying there needs their account)
  ["indeed", "board", /(^|\.)indeed\.com$/],
  ["linkedin", "board", /(^|\.)linkedin\.com$/],
  ["ziprecruiter", "board", /(^|\.)ziprecruiter\.com$/],
  ["glassdoor", "board", /(^|\.)glassdoor\.(com|ca|co\.uk)$/],
  ["simplyhired", "board", /(^|\.)simplyhired\.com$/],
  ["monster", "board", /(^|\.)monster\.com$/],
  ["careerbuilder", "board", /(^|\.)careerbuilder\.com$/],
  ["snagajob", "board", /(^|\.)snagajob\.com$/],
  ["talent", "board", /(^|\.)talent\.com$/],
  ["jooble", "board", /(^|\.)jooble\.org$/],
  ["dice", "board", /(^|\.)dice\.com$/],
  ["wellfound", "board", /(^|\.)wellfound\.com$/],
  ["handshake", "board", /(^|\.)joinhandshake\.com$/],
  ["builtin", "board", /(^|\.)builtin(nyc|sf|la|chicago|boston|austin|colorado|seattle)?\.com$/],
  ["simplify", "board", /(^|\.)simplify\.jobs$/],
  ["hiringcafe", "board", /(^|\.)hiringcafe\.com$/],
  ["google", "board", /(^|\.)google\.[a-z.]+$/],
];

export const KIND_TEXT = {
  account: "makes you create an account first",
  chat: "applies through a chat bot",
  board: "is a job board's copy of the posting, not the employer's form",
};

export function classify(url) {
  let host = "";
  try { host = new URL(String(url)).hostname.toLowerCase(); } catch { return { ats: "unknown", kind: "unknown" }; }
  for (const [ats, kind, rx] of RULES) if (rx.test(host)) return { ats, kind, host };
  return { ats: "unknown", kind: "unknown", host };
}

// Names HiringCafe uses for application systems, mapped to the same kinds.
const HC = { workday: "account", icims: "account", icims2: "account", taleo: "account", oraclecloud: "account", successfactors: "account",
  brassring: "account", adp: "account", adprecruiting: "account", kronos: "account", ultipro: "account", dayforce: "account", eightfold: "account",
  paradox: "chat", fountain: "chat", workstream: "chat", phenompeople: "account", peoplematter: "account", harri: "account",
  paylocity: "auto", gusto: "auto", teamtailor: "auto", hirebridge: "auto", careerplug: "auto", paycom: "auto", paycor: "auto", workable: "auto",
  bamboohr: "auto", jobvite: "auto", jazzhr: "auto", smartrecruiters: "auto", greenhouse: "auto", lever: "auto", ashby: "auto", recruitee: "auto",
  breezy: "auto", rippling: "auto", hireology: "auto", applicantpro: "auto", isolved: "auto" };
export function classifyNamed(name, url) {
  const byUrl = classify(url);
  if (byUrl.kind !== "unknown") return byUrl;
  const k = HC[String(name || "").toLowerCase()];
  return k ? { ats: String(name).toLowerCase(), kind: k, host: byUrl.host } : { ...byUrl, ats: name || byUrl.ats };
}

// Whether the page in front of the app is a sign-in wall rather than an application form.
export const LOGIN_WALL_JS = `(() => {
  const vis = (e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
  const pw = [...document.querySelectorAll('input[type=password]')].filter(vis).length;
  const fields = [...document.querySelectorAll('input:not([type=hidden]):not([type=password]), select, textarea')].filter(vis).length;
  const t = (document.body ? document.body.innerText : '').slice(0, 5000);
  const signIn = /\\b(sign in|log in|login|create (an )?account|create your account|register to apply|returning (user|candidate)|new user)\\b/i.test(t);
  return { pw, fields, signIn };
})()`;
