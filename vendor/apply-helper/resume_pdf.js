"use strict";
// One-page resume PDF, drawn with pdf-lib and the standard Times fonts, so
// ATS parsers read real text. render() also reports whether the page
// overflowed and how much blank space is left at the bottom (slack, in pt),
// which the tailoring loop uses to fill the page without spilling over.

(function (root) {
  const W = 612, H = 792;
  const M = { left: 36, right: 36, top: 30, bottom: 30 };
  const BASE = { name: 18, contact: 9.5, head: 10.5, body: 9.8, lead: 11.6, gap: 5 };
  let S = BASE;
  const TEXT_W = W - M.left - M.right;

  function lib() {
    const L = root.PDFLib;
    if (!L) throw new Error("pdf-lib is not loaded");
    return L;
  }

  // Characters WinAnsi cannot encode would throw inside pdf-lib.
  function safe(font, s) {
    let out = "";
    for (const ch of String(s || "")) {
      try { font.encodeText(ch); out += ch; } catch (e) {
        out += { "\u2192": "->", "\u2190": "<-", "\u2264": "<=", "\u2265": ">=", "\u2212": "-" }[ch] || "";
      }
    }
    return out;
  }

  // runs: [{text, font}] -> lines of runs fitting width (first line may be narrower).
  function wrap(runs, size, width, firstWidth) {
    const words = [];
    for (const r of runs) {
      const parts = r.text.split(/(\s+)/);
      for (const p of parts) if (p) words.push({ text: p, font: r.font, space: /^\s+$/.test(p) });
    }
    const lines = [];
    let line = [], w = 0;
    const max = () => (lines.length === 0 && firstWidth ? firstWidth : width);
    for (const wd of words) {
      const ww = wd.font.widthOfTextAtSize(wd.space ? " " : wd.text, size);
      if (wd.space) { if (line.length) { line.push({ text: " ", font: wd.font, w: ww }); w += ww; } continue; }
      if (w + ww > max() && line.length) {
        while (line.length && line[line.length - 1].text === " ") w -= line.pop().w;
        lines.push(line); line = []; w = 0;
      }
      line.push({ text: wd.text, font: wd.font, w: ww }); w += ww;
    }
    while (line.length && line[line.length - 1].text === " ") line.pop();
    if (line.length) lines.push(line);
    return lines;
  }

  async function render(doc) {
    // doc.scale > 1: a short resume set a little larger and more open, so it fills the page.
    const k = Math.min(1.25, Math.max(1, Number(doc.scale) || 1));
    S = Object.fromEntries(Object.entries(BASE).map(([key, v]) => [key, key === "gap" ? v * k * k : v * k]));
    const L = lib();
    const pdf = await L.PDFDocument.create();
    pdf.setTitle(`${doc.name} Resume`);
    pdf.setAuthor(doc.name);
    pdf.setCreator("Apply Helper");
    pdf.setProducer("Apply Helper");
    const F = {
      r: await pdf.embedFont(L.StandardFonts.TimesRoman),
      b: await pdf.embedFont(L.StandardFonts.TimesRomanBold),
      i: await pdf.embedFont(L.StandardFonts.TimesRomanItalic),
    };
    const page = pdf.addPage([W, H]);
    const black = L.rgb(0, 0, 0);
    let y = H - M.top;
    let lowest = y;

    const draw = (text, x, yy, font, size) => {
      const t = safe(font, text);
      if (!t) return 0;
      page.drawText(t, { x, y: yy, size, font, color: black });
      lowest = Math.min(lowest, yy - size * 0.22);
      return font.widthOfTextAtSize(t, size);
    };
    const drawLine = (runs, x, yy, size) => { let cx = x; for (const r of runs) cx += draw(r.text, cx, yy, r.font, size); return cx - x; };
    const centered = (runs, size) => {
      for (const ln of wrap(runs, size, TEXT_W)) {
        const w = ln.reduce((a, r) => a + r.w, 0);
        y -= size + 2;
        drawLine(ln, M.left + (TEXT_W - w) / 2, y, size);
      }
    };
    const para = (runs, indent = 0, hang = 0) => {
      const lines = wrap(runs, S.body, TEXT_W - indent - hang, TEXT_W - indent);
      lines.forEach((ln, k) => {
        y -= S.lead;
        drawLine(ln, M.left + indent + (k ? hang : 0), y, S.body);
      });
    };
    const leftRight = (leftRuns, right, size = S.body) => {
      const rw = right ? F.r.widthOfTextAtSize(safe(F.r, right), size) : 0;
      const lines = wrap(leftRuns, size, TEXT_W - rw - 12);
      lines.forEach((ln, k) => {
        y -= S.lead;
        drawLine(ln, M.left, y, size);
        if (k === 0 && right) draw(right, W - M.right - rw, y, F.r, size);
      });
    };
    const heading = (title) => {
      y -= S.gap + S.head;
      draw(title.toUpperCase(), M.left, y, F.b, S.head);
      y -= 3;
      page.drawLine({ start: { x: M.left, y }, end: { x: W - M.right, y }, thickness: 0.6, color: black });
      y -= 1;
    };
    const bullets = (list) => {
      for (const b of list) {
        const ind = 8, hang = 8;
        const lines = wrap([{ text: b, font: F.r }], S.body, TEXT_W - ind - hang, TEXT_W - ind - hang);
        lines.forEach((ln, k) => {
          y -= S.lead;
          if (k === 0) draw("\u2022", M.left + ind - 1, y, F.r, S.body);
          drawLine(ln, M.left + ind + hang, y, S.body);
        });
      }
    };

    // Header
    y -= S.name;
    const nw = F.b.widthOfTextAtSize(safe(F.b, doc.name), S.name);
    draw(doc.name, M.left + (TEXT_W - nw) / 2, y, F.b, S.name);
    y -= 2;
    for (const line of doc.contactLines || []) centered([{ text: line, font: F.r }], S.contact);
    if (doc.header) centered([{ text: doc.header, font: F.i }], S.contact);

    if (doc.summary) {
      heading("Summary");
      para([{ text: doc.summary, font: F.r }]);
    }
    if (doc.skills && doc.skills.length) {
      heading("Skills");
      for (const s of doc.skills) para([{ text: s.label + ": ", font: F.b }, { text: s.items, font: F.r }], 0, 8);
    }
    for (const sec of doc.sections || []) {
      if (!sec.entries || !sec.entries.length) continue;
      heading(sec.title);
      for (const e of sec.entries) {
        if (sec.kind === "experience") {
          leftRight(e.org ? [{ text: e.title + ", ", font: F.b }, { text: e.org + (e.location ? " \u2013 " + e.location : ""), font: F.r }] : [{ text: e.title, font: F.b }, { text: e.location ? " \u2013 " + e.location : "", font: F.r }], e.dates);
        } else if (sec.kind === "projects") {
          leftRight([{ text: e.title, font: F.b }], e.link || e.dates || "");
        } else {
          leftRight([{ text: e.school, font: F.b }, { text: e.detail ? (/:$/.test(e.school) ? " " : " \u2013 ") + e.detail : "", font: F.r }], e.dates);
        }
        bullets(e.bullets || []);
        y -= 1.5;
      }
    }

    const overflow = lowest < M.bottom;
    const slack = Math.round((lowest - M.bottom) * 10) / 10;
    const bytes = await pdf.save({ useObjectStreams: false });
    return { bytes, overflow, slack };
  }

  root.ResumePDF = { render };
})(typeof globalThis !== "undefined" ? globalThis : this);
