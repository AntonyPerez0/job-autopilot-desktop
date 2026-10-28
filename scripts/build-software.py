# Builds vendor/onet/software.json.gz: the names of software people use at work, from O*NET's Software
# Skills ("Workplace Example"), so a skill like "Zendesk" or "Microsoft Excel" is sorted under Software &
# Systems the same way every time, without asking the AI.
#   python3 scripts/build-software.py <software_skills.csv> [/usr/share/dict/american-english]
# The word list tells everyday words ("payroll", "training") from product names: a name made only of
# everyday words ("Scheduling", what's left of "SAP Payroll") would sort a job skill as software, so it's left out,
# except for well-known products that happen to be words (Excel, Word, Outlook, Teams, Square).
# Source: O*NET 31.0 Database, USDOL/ETA, CC BY 4.0: https://www.onetcenter.org/database.html
#   https://www.onetcenter.org/dl_files/database/db_31_0_csv/software_skills.csv
import csv, gzip, json, os, re, sys

src = sys.argv[1]
words = {w.strip() for w in open(sys.argv[2] if len(sys.argv) > 2 else "/usr/share/dict/american-english", encoding="utf-8", errors="ignore") if w.strip() and w.strip().islower()}
everyday = lambda n: all(p.rstrip("s") in words or p in words for p in n.split(" "))
KNOWN = {"excel", "word", "outlook", "teams", "square", "office", "access", "project", "windows", "acrobat", "photoshop", "illustrator", "premiere", "publisher", "visio", "onenote", "sharepoint", "powerpoint", "slack", "zoom", "toast", "clover", "shopify", "canva", "figma", "notion", "trello", "asana", "monday", "airtable", "gmail", "docs", "drive", "sheets", "slides", "calendar"}
# Common at work, missing from O*NET's examples.
EXTRA = ["python", "java", "ruby", "swift", "rust", "sql", "mysql", "oracle", "tableau", "power bi", "aws", "amazon web services", "azure", "gcp", "google cloud", "linux", "zendesk", "freshdesk", "intercom", "hubspot", "servicenow", "gorgias", "help scout", "react", "react native", "next.js", "vue", "angular", "typescript", "tailwind", "github actions", "gitlab", "bitbucket", "vs code", "visual studio code", "postman", "figma", "canva", "notion", "trello", "asana", "monday.com", "airtable", "slack", "zoom", "microsoft teams", "google workspace", "microsoft 365", "office 365", "google docs", "google drive", "google slides", "toast pos", "clover pos", "square pos", "shopify", "doordash", "uber eats", "grubhub", "instacart", "ubereats", "adp", "paychex", "gusto", "ukg", "kronos", "when i work", "homebase", "deputy", "sap", "netsuite", "workday", "copilot", "github copilot", "claude", "claude code", "gemini", "perplexity", "midjourney", "cursor", "chatgpt"]
dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vendor", "onet", "software.json.gz")
norm = lambda s: re.sub(r"\s+", " ", re.sub(r"[^a-z0-9+#.]+", " ", s.lower())).strip()
names = set()
for r in csv.DictReader(open(src, encoding="utf-8")):
    n = norm(r["Workplace Example"])
    if len(n) < 2:
        continue
    # A product's full name is kept unless it's one everyday word, or a generic kind ("Email software").
    if n in KNOWN or not (everyday(n) and (" " not in n or n.endswith(" software"))):
        names.add(n)
    # "Microsoft Excel", "Intuit QuickBooks", "OpenAI ChatGPT": people write the product without the maker.
    parts = n.split(" ")
    # The maker alone ("Cerner" for "Cerner Millennium"), when it isn't an everyday word.
    if len(parts) >= 2 and len(parts[0]) >= 4 and not everyday(parts[0]):
        names.add(parts[0])
    rest = " ".join(parts[1:])
    if len(parts) >= 2 and len(rest) >= 4 and (not everyday(rest) or rest in KNOWN):
        names.add(rest)
    # "Salesforce software", "Point of sale POS software": and without the word "software".
    bare = n[: -len(" software")] if n.endswith(" software") else ""
    if len(bare) >= 3 and not everyday(bare):
        names.add(bare)
names.update(EXTRA)
# Trades and credentials that share a name with some product: in a skills list they mean the trade.
for n in ["hvac", "cnc", "cdl", "osha", "hazmat", "cpr", "plc", "gps", "eld", "dot", "forklift", "welding", "rigging", "notary"]:
    names.discard(n)
with gzip.open(dest, "wt", encoding="utf-8") as f:
    json.dump({"source": "O*NET 31.0 Software Skills, USDOL/ETA, CC BY 4.0", "names": sorted(names)}, f, separators=(",", ":"))
print(len(names), "names ->", dest, os.path.getsize(dest), "bytes")
