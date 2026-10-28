// Every date on the resume written one way: "Mar 2022", "2022", "Present", and ranges as "Mar 2022 – Present".
// Whatever form a date arrives in ("2022-03", "3/2022", "March 2022", "Sept. 2022", "now"), it comes out the
// same; anything this doesn't recognize is left exactly as it was.
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const byName = (w) => {
  const k = String(w).toLowerCase().replace(/\.$/, "");
  if (k === "sept") return "Sep";
  const i = MON.findIndex((m) => k.length >= 3 && (m.toLowerCase() === k.slice(0, 3)) && "january february march april may june july august september october november december".split(" ")[MON.indexOf(m)].startsWith(k));
  return i >= 0 ? MON[i] : "";
};

export function fmtDate(s) {
  const t = String(s || "").trim();
  if (!t) return "";
  if (/^(present|now|current(ly)?|today|ongoing)$/i.test(t)) return "Present";
  let m;
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/)) && +m[2] >= 1 && +m[2] <= 12) return `${MON[+m[2] - 1]} ${m[1]}`;
  if ((m = t.match(/^(\d{1,2})[-/.](\d{4})$/)) && +m[1] >= 1 && +m[1] <= 12) return `${MON[+m[1] - 1]} ${m[2]}`;
  if ((m = t.match(/^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/)) && byName(m[1])) return `${byName(m[1])} ${m[2]}`;
  if (/^\d{4}$/.test(t)) return t;
  return t;
}

// "06/2021 - present", "2019 to 2021", "Jan 2020–Mar 2021" -> "Jun 2021 – Present", "2019 – 2021", "Jan 2020 – Mar 2021".
export function fmtRange(s) {
  const t = String(s || "").trim();
  const parts = t.split(/\s*(?:–|—|-(?!\d{1,2}\b)|\bto\b|\buntil\b)\s*/i).filter(Boolean);
  if (parts.length === 2) {
    const [a, b] = parts.map(fmtDate);
    return `${a} – ${b}`;
  }
  return parts.length === 1 ? fmtDate(t) : t;
}
