# Builds vendor/onet/ladder.json.gz: which jobs lead to which (O*NET Related Occupations), how much
# preparation each needs (O*NET Job Zones), and typical pay by state (BLS OEWS, May 2025).
#   python3 scripts/build-ladder.py <dir with related_occupations.csv, job_zones.csv> <unzipped state_M2025_dl.xlsx dir>
# Sources:
#   O*NET 31.0 Database, USDOL/ETA, CC BY 4.0: https://www.onetcenter.org/database.html
#     db_31_0_csv/related_occupations.csv, db_31_0_csv/job_zones.csv
#   BLS Occupational Employment and Wage Statistics, May 2025, state file (public domain):
#     https://www.bls.gov/oes/special-requests/oesm25st.zip
import csv, gzip, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
onet_dir, xlsx_dir = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vendor", "onet", "ladder.json.gz")
zones = {r["O*NET-SOC Code"]: int(r["Job Zone"]) for r in csv.DictReader(open(os.path.join(onet_dir, "job_zones.csv"), encoding="utf-8"))}
TIER = {"Primary-Short": 1, "Primary-Long": 2, "Supplemental": 3}
related = {}
for r in csv.DictReader(open(os.path.join(onet_dir, "related_occupations.csv"), encoding="utf-8")):
    related.setdefault(r["O*NET-SOC Code"], []).append([r["Related O*NET-SOC Code"], TIER.get(r["Relatedness Tier"], 3)])
os.chdir(xlsx_dir)
from xlsx import rows
it = rows("xl/worksheets/sheet1.xml"); hdr = next(it); ix = {h: i for i, h in enumerate(hdr)}
wages, weights, jobs = {}, {}, {}
def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None
for r in it:
    if len(r) <= ix["H_MEDIAN"] or r[ix["O_GROUP"]] != "detailed": continue
    soc, st = r[ix["OCC_CODE"]], r[ix["PRIM_STATE"]]
    h = num(r[ix["H_MEDIAN"]])
    if h is None:  # annual-only occupations (teachers): an hourly figure from 2,080 hours a year
        a = num(r[ix["A_MEDIAN"]]); h = a / 2080 if a else None
    if h is None: continue
    wages.setdefault(soc, {})[st] = round(h, 2)
    emp = num(r[ix["TOT_EMP"]]) or 0
    jobs.setdefault(soc, {})[st] = int(round(emp / 100.0))  # people in this job in the state, in hundreds
    w = weights.setdefault(soc, [0, 0]); w[0] += h * emp; w[1] += emp
# "US": an employment-weighted average of the state medians (BLS's national file wasn't part of this build).
for soc, (s, n) in weights.items():
    if n: wages[soc]["US"] = round(s / n, 2)
out = {"source": "O*NET 31.0 (USDOL/ETA, CC BY 4.0) related occupations and job zones; BLS OEWS May 2025 state median hourly wages and employment (in hundreds)",
       "zones": zones, "related": related, "wages": wages, "jobs": jobs}
data = json.dumps(out, separators=(",", ":")).encode()
with gzip.open(dest, "wb", compresslevel=9) as f: f.write(data)
print("occupations with pay:", len(wages), "with zones:", len(zones), "with related:", len(related), "bytes:", os.path.getsize(dest))
