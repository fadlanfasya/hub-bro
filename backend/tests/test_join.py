"""The F5 Summary Status table, built from separate PromQL queries."""
import asyncio, json, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, '.')

from app.transforms import join_results
from app.connectors.prometheus import flatten

DEVICES = [
    ("10.1.6.20", "STL-L02-R10-ELTM01", 4.8, 2.4, 4, 3, 48, 71, 204),
    ("10.1.6.21", "STL-L02-R10-ELTM02", 3.5, 2.3, 3, 3, 48, 71, 204),
    ("10.1.6.22", "STLL02R06-NLTM01", 17.1, 4.0, 3, 3, 227, 305, 623),
    ("10.1.6.23", "STL-L02-R10-NGTM01", 6.1, 2.3, 3, 3, 159, 229, 261),
    ("10.1.6.24", "STL-L02-R05-ADC-03", 25.9, 4.0, 3, 3, 38, 38, 173),
    ("10.1.6.25", "STL-L02-R10-NGTM02", 9.5, 12.3, 4, 3, 159, 229, 261),
    ("10.1.6.26", "STL-L02-R05-ADC-04", 9.3, 4.8, 4, 3, 38, 38, 174),
    ("10.1.6.27", "STLL02R06-NLTM02", 10.8, 5.0, 4, 3, 227, 305, 623),
]
IDX = {"cpu": 2, "mem": 3, "failover": 4, "sync": 5, "vs": 6, "pools": 7, "nodes": 8}
TS = 1755200000

def series_for(which, skip=()):
    out = []
    for d in DEVICES:
        if d[1] in skip:
            continue
        out.append({"metric": {"__name__": which, "instance": d[0] + ":9116", "sysName": d[1]},
                    "value": [TS, str(d[IDX[which]])]})
    return out

passed = failed = 0
def check(label, got, want):
    global passed, failed
    ok = got == want
    passed, failed = passed + ok, failed + (not ok)
    print(("  PASS  " if ok else "  FAIL  ") + label)
    if not ok:
        print("        got  ", got)
        print("        want ", want)

def part(label, which, skip=()):
    return {"as": label, "result": flatten(series_for(which, skip), {})}

print("labels become columns")
one = flatten(series_for("cpu"), {})
check("instance and sysName are real columns",
      one["columns"], ["time", "series", "metric", "instance", "sysName", "value"])
check("eight devices, one row each", len(one["rows"]), 8)

print("\njoining seven queries on sysName")
parts = [part("CPU", "cpu"), part("Memory", "mem"), part("Failover", "failover"),
         part("Sync", "sync"), part("VS", "vs"), part("Pools", "pools"),
         part("Nodes", "nodes")]
joined = join_results(parts, {"on": "sysName"})

check("one column per query, plus the key",
      joined["columns"], ["sysName", "CPU", "Memory", "Failover", "Sync", "VS", "Pools", "Nodes"])
check("still eight rows, not fifty-six", len(joined["rows"]), 8)
check("ADC-03 reads across correctly",
      joined["rows"][4],
      {"sysName": "STL-L02-R05-ADC-03", "CPU": 25.9, "Memory": 4.0, "Failover": 3.0,
       "Sync": 3.0, "VS": 38.0, "Pools": 38.0, "Nodes": 173.0})
check("active count matches the stat tile",
      sum(1 for r in joined["rows"] if r["Failover"] == 4), 4)
check("standby count matches too",
      sum(1 for r in joined["rows"] if r["Failover"] == 3), 4)

print("\ncarrying an extra column through")
carried = join_results([part("CPU", "cpu"), part("Memory", "mem")],
                       {"on": "sysName", "carry": ["instance"]})
check("instance rides along", carried["columns"], ["sysName", "instance", "CPU", "Memory"])
check("and holds the right value", carried["rows"][0]["instance"], "10.1.6.20:9116")

print("\na device that stops answering one query")
gappy = join_results(
    [part("CPU", "cpu"), part("Memory", "mem", skip=("STLL02R06-NLTM01",))],
    {"on": "sysName"})
check("it keeps its row", len(gappy["rows"]), 8)
check("with a blank, not a dropped row",
      gappy["rows"][2], {"sysName": "STLL02R06-NLTM01", "CPU": 17.1, "Memory": None})

print("\nawkward inputs")
dupes = join_results([{"as": "CPU", "result": flatten([
    {"metric": {"instance": "a"}, "value": [TS, "1"]},
    {"metric": {"instance": "a"}, "value": [TS, "9"]}], {})}], {"on": "instance"})
check("duplicate keys collapse to the first", dupes["rows"], [{"instance": "a", "CPU": 1.0}])
check("and are reported", dupes.get("meta", {}).get("duplicate_keys"), 1)

nokey = join_results([{"as": "CPU", "result": flatten(
    [{"metric": {"job": "f5"}, "value": [TS, "1"]}], {})}], {"on": "sysName"})
check("a series without the key is skipped", nokey["rows"], [])
check("and counted", nokey.get("meta", {}).get("rows_without_key"), 1)

same = join_results([part("CPU", "cpu"), part("CPU", "mem")], {"on": "sysName"})
check("two queries named the same are disambiguated",
      same["columns"], ["sysName", "CPU", "CPU (2)"])

try:
    join_results([part("CPU", "cpu")], {})
    check("a join with no key raises", "no error", "ValueError")
except ValueError as e:
    check("a join with no key raises", "ValueError" in type(e).__name__, True)

nan = flatten([{"metric": {"instance": "a"}, "value": [TS, "NaN"]}], {})
check("NaN becomes None, not 0", nan["rows"][0]["value"], None)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
