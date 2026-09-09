"""How the REST connector reduces nested JSON to table cells.

Shaped by the real Cortex XDR payloads: mitre_tactics_ids_and_names, hosts, ip,
users and tags all arrive as JSON arrays, and str() on a list yields Python's
repr — "['TA0002 - Execution']" — quotes, brackets and all.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.connectors.rest_api import flatten_value, normalize  # noqa: E402

passed = failed = 0


def check(name, got, want):
    global passed, failed
    if got == want:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}\n  got  {got!r}\n  want {want!r}")


# ---- scalars pass through untouched ----------------------------------------
check("string", flatten_value("PROTECTED"), "PROTECTED")
check("int", flatten_value(1788747814000), 1788747814000)
check("float", flatten_value(1.5), 1.5)
check("bool stays bool", flatten_value(False), False)
check("none", flatten_value(None), None)

# ---- scalar lists join ------------------------------------------------------
check("mitre tactics", flatten_value(["TA0002 - Execution", "TA0007 - Discovery"]),
      "TA0002 - Execution, TA0007 - Discovery")
check("single tactic", flatten_value(["TA0002 - Execution"]), "TA0002 - Execution")
check("ip list", flatten_value(["10.1.58.29", "10.42.38.0"]), "10.1.58.29, 10.42.38.0")
check("numeric list", flatten_value([1, 2, 3]), "1, 2, 3")
check("empty list is missing, not ''", flatten_value([]), None)

# A list of bools would join as "True, False", which reads like data rather than
# a flag, so it takes the str() fallback instead.
check("bool list falls back", flatten_value([True, False]), "[True, False]")

# ---- anything deeper keeps the old behaviour --------------------------------
check("list of objects", flatten_value([{"a": 1}]), "[{'a': 1}]")
check("dict", flatten_value({"server_tags": []}), "{'server_tags': []}")

# ---- end to end over a real-shaped incident row -----------------------------
result = normalize([{
    "incident_id": "672",
    "severity": "low",
    "creation_time": 1788747814000,
    "hosts": ["digital-037:5ca93952026342919b7eba9bea62ef22"],
    "users": ["digital-037\\digital"],
    "mitre_tactics_ids_and_names": ["TA0002 - Execution"],
    "tags": ["DS:PANW/XDR Agent", "DOM:Security"],
    "assigned_user_mail": None,
    "notes": None,
}])
row = result["rows"][0]
check("columns preserved in order", result["columns"][:3],
      ["incident_id", "severity", "creation_time"])
check("epoch untouched for date_diff", row["creation_time"], 1788747814000)
check("hosts readable", row["hosts"], "digital-037:5ca93952026342919b7eba9bea62ef22")
check("tags readable", row["tags"], "DS:PANW/XDR Agent, DOM:Security")
check("no repr brackets anywhere",
      any("['" in str(v) for v in row.values()), False)
check("null stays null", row["assigned_user_mail"], None)

# An endpoints row, where tags is a dict of empty lists — must not become "".
ep = normalize([{"host_name": "STLRCRCOM26", "ip": ["10.1.58.29", "10.42.38.0"],
                 "users": [], "tags": {"server_tags": [], "endpoint_tags": []}}])[
    "rows"][0]
check("endpoint ip joined", ep["ip"], "10.1.58.29, 10.42.38.0")
check("empty users is None", ep["users"], None)
check("dict tags still stringified", ep["tags"].startswith("{"), True)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
