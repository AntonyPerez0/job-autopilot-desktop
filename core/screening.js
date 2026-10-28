// "Pass the software first": what job sites' screening software (an ATS) needs from a resume file, checked
// on the real PDF the app makes rather than assumed:
//   - small enough to upload (Greenhouse, for one, fails to read files over 2.5 MB);
//   - text a program can read and copy (no picture of text, nothing that needs OCR);
//   - standard headings (Summary, Skills, Experience, Projects, Education) in one column, in reading order.
// -> { ok, bytes, items: [{ ok, title, detail }] }
import { Tailor } from "./engine.js";

export const MAX_BYTES = 2.5 * 1024 * 1024;
const STANDARD = ["Summary", "Skills", "Experience", "Projects", "Education"];

export async function screening(profile, baseId) {
  const { spec } = Tailor.checkPlan(profile, { base: baseId });
  const r = await Tailor.fit(profile, spec, []);
  const bytes = r.pdf.byteLength || r.pdf.length;
  const items = [];
  items.push(bytes <= MAX_BYTES
    ? { ok: true, title: `Small file (${Math.max(1, Math.round(bytes / 1024))} KB)`, detail: "Job sites reject or fail to read files over about 2.5 MB." }
    : { ok: false, title: `The file is too big (${(bytes / 1048576).toFixed(1)} MB)`, detail: "Job sites fail to read files over about 2.5 MB." });
  let text = "";
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(new Uint8Array(r.pdf));
    text = (await extractText(doc, { mergePages: true })).text || "";
  } catch { /* reported below */ }
  const flat = text.replace(/\s+/g, " ");
  const name = String(profile.name || "").trim();
  const readable = flat.length > 200 && (!name || flat.toLowerCase().includes(name.toLowerCase()));
  items.push(readable
    ? { ok: true, title: "Text the software can read", detail: "Every word is real text, so it can be copied and searched; no picture of text, nothing that needs OCR." }
    : { ok: false, title: "The software may not read the text", detail: "The words couldn't be read back out of the file." });
  // The headings, upper case on the page, in the order the PDF draws them: one column means the text comes
  // back in that same order, top to bottom.
  const TITLE = { experience: "Experience", projects: "Projects", education: "Education" };
  const want = [...(spec.summary ? ["Summary"] : []), ...((spec.skills || []).length ? ["Skills"] : []),
    ...(spec.sections || []).filter((x) => TITLE[x.kind] && (x.kind === "education" ? (profile.education || []).length : (x.items || []).length)).map((x) => TITLE[x.kind])];
  const at = want.map((h) => flat.indexOf(h.toUpperCase()));
  const missing = want.filter((h, k) => at[k] < 0);
  const inOrder = !missing.length && at.every((n, k) => k === 0 || n > at[k - 1]);
  items.push(inOrder && want.every((h) => STANDARD.includes(h))
    ? { ok: true, title: "Standard headings, one column", detail: `${want.join(", ")}: the headings screening software looks for, read top to bottom in one column. No tables, text boxes, icons, skill bars or photo.` }
    : { ok: false, title: "Headings the software may not find", detail: missing.length ? `Missing from the file's text: ${missing.join(", ")}.` : "The headings come back out of order." });
  return { ok: items.every((x) => x.ok), bytes, items };
}
