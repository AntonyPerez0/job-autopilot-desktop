// Contrast of the colour tokens the app pairs, light and dark, against WCAG 2.2 AA:
// 4.5:1 for text, 3:1 for what you need to see to use a control (field edges, the focus ring, the switch).
//   node scripts/contrast.mjs        exits 1 when a pair falls short
import fs from "node:fs";
import path from "node:path";

const UI = path.resolve(import.meta.dirname, "..", "ui");
const css = fs.readFileSync(path.join(UI, "tokens.css"), "utf8") + fs.readFileSync(path.join(UI, "style.css"), "utf8");
const dark = css.indexOf("@media (prefers-color-scheme: dark)");
function tokens(text) {
  const out = {};
  for (const m of text.matchAll(/--(color-[\w-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)) out[m[1]] = [Number(m[2]) / 100, Number(m[3]), Number(m[4])];
  for (const m of text.matchAll(/--(color-[\w-]+):\s*var\(--(color-[\w-]+)\)/g)) out[m[1]] = { ref: m[2] };
  return out;
}
const light = tokens(css.slice(0, dark) + css.slice(css.indexOf("}", css.indexOf("}", dark) + 1)));
const darkT = { ...light, ...tokens(css.slice(dark)) };
for (const T of [light, darkT]) for (const k of Object.keys(T)) if (T[k].ref) T[k] = T[T[k].ref];

// OKLCH -> linear sRGB -> relative luminance (WCAG).
function lum([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const c = (x) => Math.min(1, Math.max(0, x));
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(bl);
}
const ratio = (x, y) => { const [a, b] = [lum(x), lum(y)].sort((p, q) => q - p); return (a + 0.05) / (b + 0.05); };
export function hex([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return "#" + lin.map((x) => { const v = Math.min(1, Math.max(0, x)); return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)).toString(16).padStart(2, "0"); }).join("");
}

const surfaces = ["paper", "paper-2", "paper-3", "cotton"];
const PAIRS = [
  ...["ink", "ink-2", "muted"].flatMap((t) => surfaces.map((s) => [t, s, 4.5])),
  ...["done", "work", "attn", "error"].flatMap((t) => [[t, t + "-bg", 4.5], [t, "cotton", 4.5], [t, "paper", 4.5]]),
  ["muted", "attn-bg", 4.5], ["ink-2", "attn-bg", 4.5], ["ink-2", "done-bg", 4.5], ["ink-2", "work-bg", 4.5], ["ink-2", "error-bg", 4.5],
  ["board-type", "board", 4.5], ["print", "cotton", 4.5], ["accent-ink", "accent", 4.5], ["accent-2", "cotton", 3], ["accent-2", "paper-2", 3],
  ["field-edge", "cotton", 3], ["field-edge", "paper", 3], ["focus", "paper", 3], ["focus", "cotton", 3], ["focus", "paper-2", 3],
  ["board", "paper-3", 3], ["attn-strong", "cotton", 3], ["attn-strong", "paper", 3],
];
let bad = 0;
for (const [name, T] of [["light", light], ["dark", darkT]]) {
  for (const [fg, bg, min] of PAIRS) {
    const a = T["color-" + fg], b = T["color-" + bg];
    if (!a || !b) { console.log(`? ${name}: ${fg} on ${bg}: token missing`); bad++; continue; }
    const r = ratio(a, b);
    if (r < min || process.env.VERBOSE) console.log(`${r < min ? "✖" : "✔"} ${name}: ${fg} on ${bg}: ${r.toFixed(2)}:1 (needs ${min}:1)`);
    if (r < min) bad++;
  }
}
if (process.argv.includes("--hex")) for (const [name, T] of [["light", light], ["dark", darkT]]) console.log(name, "paper", hex(T["color-paper"]), "paper-2", hex(T["color-paper-2"]), "ink", hex(T["color-ink"]));
console.log(bad ? `CONTRAST FAIL: ${bad} pair(s)` : `CONTRAST PASS: ${PAIRS.length} pairs, light and dark`);
process.exit(bad ? 1 : 0);
