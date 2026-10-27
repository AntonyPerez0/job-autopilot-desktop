# Minimal .xlsx reader (shared strings + one sheet), streaming: rows as lists of strings.
import xml.etree.ElementTree as ET, re, sys, json
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
ss = [ "".join(t.text or "" for t in si.iter(NS + "t")) for si in ET.parse("xl/sharedStrings.xml").getroot().iter(NS + "si") ]
def col(ref):
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0): n = n * 26 + ord(ch) - 64
    return n - 1
def rows(path):
    for ev, el in ET.iterparse(path, events=("end",)):
        if el.tag == NS + "row":
            out = []
            for c in el.iter(NS + "c"):
                i = col(c.get("r")); v = c.find(NS + "v"); t = c.get("t")
                val = "" if v is None else (ss[int(v.text)] if t == "s" else v.text)
                if t == "inlineStr": val = "".join(x.text or "" for x in c.iter(NS + "t"))
                while len(out) < i: out.append("")
                out.append(val)
            yield out
            el.clear()
