"""Tests for the date_diff transform, using the real GLPI SoftwareLicense shape.

Run: python tests/test_date_diff.py
"""
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")

from app.connectors.rest_api import normalize  # noqa: E402
from app.transforms import apply_date_diff, apply_transforms, parse_date  # noqa: E402

passed = failed = 0
NOW = datetime(2026, 8, 6, 12, 0, 0)


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}, got {actual!r}")


print("date parsing")
check("GLPI date", parse_date("2025-10-16"), datetime(2025, 10, 16))
check("GLPI datetime", parse_date("2024-10-23 02:31:42"), datetime(2024, 10, 23, 2, 31, 42))
check("ISO with T", parse_date("2025-10-16T08:30:00"), datetime(2025, 10, 16, 8, 30))
check("ISO with Z", parse_date("2025-10-16T08:30:00Z"), datetime(2025, 10, 16, 8, 30))
check("fractional seconds are dropped",
      parse_date("2025-10-16T08:30:00.123456"), datetime(2025, 10, 16, 8, 30))
check("a datetime passes through", parse_date(datetime(2025, 1, 1)), datetime(2025, 1, 1))
check("slashes", parse_date("2025/10/16"), datetime(2025, 10, 16))

# GLPI writes these for "no date". strptime raises on them, and one bad row
# must not blank a whole widget.
check("GLPI zero date is missing, not an error", parse_date("0000-00-00"), None)
check("zero datetime is missing", parse_date("0000-00-00 00:00:00"), None)
check("empty string is missing", parse_date(""), None)
check("whitespace is missing", parse_date("   "), None)
check("None is missing", parse_date(None), None)
check("nonsense is missing", parse_date("not a date"), None)
check("a bare number is missing", parse_date(12345), None)
check("booleans are not dates", parse_date(True), None)

print("days until / since")
ROWS = [
    {"name": "VMware SRM 8", "expire": "2025-10-16"},        # long expired
    {"name": "Windows Server", "expire": "2026-09-05"},      # 30 days away
    {"name": "Antivirus", "expire": "2026-08-06"},           # today
    {"name": "Perpetual", "expire": ""},                     # no expiry
    {"name": "Broken", "expire": "0000-00-00"},              # GLPI empty
]
rows, columns = apply_date_diff(
    ROWS, ["name", "expire"],
    [{"column": "expire", "as": "days_left", "unit": "days", "direction": "until"}],
    now=NOW,
)
by_name = {r["name"]: r["days_left"] for r in rows}
check("the new column is added once", columns.count("days_left"), 1)
check("an expired licence is negative", by_name["VMware SRM 8"], -294)
check("a future licence is positive", by_name["Windows Server"], 30)
check("expiring today is exactly zero", by_name["Antivirus"], 0)
check("no expiry date gives None, not 0", by_name["Perpetual"], None)
check("a GLPI zero date gives None", by_name["Broken"], None)

rows, _ = apply_date_diff(
    [{"backup": "2026-08-05 06:00:00"}], ["backup"],
    [{"column": "backup", "as": "age_hours", "unit": "hours", "direction": "since"}],
    now=NOW,
)
check("hours since, for backup age", rows[0]["age_hours"], 30)

rows, _ = apply_date_diff(
    [{"d": "2026-08-06 11:30:00"}], ["d"],
    [{"column": "d", "as": "mins", "unit": "minutes", "direction": "since"}], now=NOW)
check("minutes since", rows[0]["mins"], 30)

rows, _ = apply_date_diff(
    [{"d": "2026-08-08 00:00:00"}], ["d"],
    [{"column": "d", "as": "frac", "decimals": 1}], now=NOW)
check("decimals are honoured", rows[0]["frac"], 1.5)

rows, columns = apply_date_diff(
    [{"a": "2026-08-07", "b": "2026-08-01"}], ["a", "b"],
    [{"column": "a", "as": "in_days"}, {"column": "b", "as": "ago", "direction": "since"}],
    now=NOW)
# tomorrow is 1 day away even at midday — calendar days, not elapsed hours
check("several specs at once", (rows[0]["in_days"], rows[0]["ago"]), (1, 5))
check("both columns registered", columns, ["a", "b", "in_days", "ago"])

check("a missing column spec is ignored",
      apply_date_diff([{"a": 1}], ["a"], [{"as": "x"}], now=NOW)[1], ["a"])
check("no specs is a no-op", apply_date_diff([{"a": 1}], ["a"], [], now=NOW)[1], ["a"])
check("a single dict spec works like a list",
      "z" in apply_date_diff([{"d": "2026-09-01"}], ["d"],
                             {"column": "d", "as": "z"}, now=NOW)[1], True)
check("the source rows are not mutated", ROWS[0].get("days_left"), None)

print("the real GLPI SoftwareLicense payload")
GLPI_LICENSE = {
    "id": 2, "softwares_id": 1, "softwarelicenses_id": 0,
    "completename": "VMware Site Recovery Manager 8 Enterprise",
    "level": 1, "ancestors_cache": None, "sons_cache": '{"2":"2"}',
    "entities_id": 0, "is_recursive": 0, "number": 100,
    "softwarelicensetypes_id": 0,
    "name": "VMware Site Recovery Manager 8 Enterprise", "serial": "",
    "otherserial": "WJ403-ND1EM-98HNH-LK4A6-CWJM8",
    "softwareversions_id_buy": 0, "softwareversions_id_use": 0,
    "expire": "2025-10-16", "comment": "100 VM, kurang 100 lagi",
    "date_mod": "2024-10-23 02:31:42", "is_valid": 1,
    "date_creation": "2024-10-22 09:25:05", "is_deleted": 0,
    "locations_id": 0, "users_id_tech": 0, "users_id": 0,
    "groups_id_tech": 2, "groups_id": 2, "is_helpdesk_visible": 0,
    "is_template": 0, "template_name": None, "states_id": 0,
    "manufacturers_id": 1, "contact": None, "contact_num": None,
    "allow_overquota": 0, "pictures": None,
    "links": [
        {"rel": "Software", "href": "http://10.1.6.51/apirest.php/Software/1"},
        {"rel": "Entity", "href": "http://10.1.6.51/apirest.php/Entity/0"},
    ],
}

result = normalize([GLPI_LICENSE])
check("normalizes to one row", len(result["rows"]), 1)
# a nested array would be an object in a table cell, which React refuses to
# render — the connector stringifies it instead of crashing the widget
check("the nested links array becomes a string",
      isinstance(result["rows"][0]["links"], str), True)
check("None values survive as None", result["rows"][0]["template_name"], None)
check("the numeric seat count is kept as a number", result["rows"][0]["number"], 100)

shaped = apply_transforms(result, {
    "date_diff": [{"column": "expire", "as": "days_left"}],
    "columns": ["name", "number", "days_left"],
})
row = shaped["rows"][0]
check("days_left is computed through apply_transforms", isinstance(row["days_left"], int), True)
check("and it is negative for this expired licence", row["days_left"] < 0, True)

# the whole point: a date you cannot threshold becomes a number you can
expiring = apply_transforms(result, {
    "date_diff": [{"column": "expire", "as": "days_left"}],
    "filters": [{"column": "days_left", "op": "lte", "value": 60}],
})
check("filtering 'expiring within 60 days' now matches", len(expiring["rows"]), 1)

not_expiring = apply_transforms(result, {
    "date_diff": [{"column": "expire", "as": "days_left"}],
    "filters": [{"column": "days_left", "op": "gt", "value": 60}],
})
check("and excludes it when asking for healthy ones", len(not_expiring["rows"]), 0)

print("calendar days, not elapsed hours")
# A date column has no time, so "tomorrow" must read as 1 day even when now is
# midday. Elapsed-seconds maths truncated 0.5 days to 0 and said "today".
for date, expected in [("2026-08-06", 0), ("2026-08-07", 1), ("2026-08-05", -1),
                       ("2026-09-05", 30), ("2025-10-16", -294)]:
    got = apply_date_diff([{"d": date}], ["d"], [{"column": "d", "as": "n"}],
                          now=NOW)[0][0]["n"]
    check(f"{date} is {expected} days away", got, expected)

# a timestamp keeps real elapsed time, which backup age needs
check("a datetime still uses elapsed hours",
      apply_date_diff([{"d": "2026-08-05 06:00:00"}], ["d"],
                      [{"column": "d", "as": "h", "unit": "hours", "direction": "since"}],
                      now=NOW)[0][0]["h"], 30)
check("elapsed values round rather than truncate",
      apply_date_diff([{"d": "2026-08-05 06:29:00"}], ["d"],
                      [{"column": "d", "as": "h", "unit": "hours", "direction": "since"}],
                      now=NOW)[0][0]["h"], 30)

print("rows with no value sort last, never first")
NULL_SORT = {"columns": ["name", "n"], "rows": [
    {"name": "urgent", "n": 2}, {"name": "none", "n": None},
    {"name": "later", "n": 90}, {"name": "blank", "n": ""},
]}
asc = apply_transforms(NULL_SORT, {"sort": {"column": "n", "dir": "asc"}})
check("ascending leads with the smallest real value", asc["rows"][0]["name"], "urgent")
check("and parks the empties at the end",
      [r["name"] for r in asc["rows"][2:]], ["none", "blank"])
desc = apply_transforms(NULL_SORT, {"sort": {"column": "n", "dir": "desc"}})
check("descending leads with the largest real value", desc["rows"][0]["name"], "later")
check("empties stay at the end when reversed too",
      [r["name"] for r in desc["rows"][2:]], ["none", "blank"])

# regression: one gap used to force a string sort, where "10" sorts below "9"
GAPPY = {"columns": ["n"], "rows": [{"n": 9}, {"n": 10}, {"n": None}, {"n": 100}]}
check("a gap does not turn a numeric sort into a text sort",
      [r["n"] for r in apply_transforms(GAPPY, {"sort": {"column": "n", "dir": "asc"}})["rows"]],
      [9, 10, 100, None])

print("counting for a stat widget")
MANY = normalize([
    dict(GLPI_LICENSE, id=1, name="A", expire="2025-10-16"),   # expired
    dict(GLPI_LICENSE, id=2, name="B", expire="2026-08-20"),   # 14 days
    dict(GLPI_LICENSE, id=3, name="C", expire="2026-12-01"),   # far off
    dict(GLPI_LICENSE, id=4, name="D", expire=""),             # perpetual
])
soon = apply_transforms(MANY, {
    "date_diff": [{"column": "expire", "as": "days_left"}],
    "filters": [{"column": "days_left", "op": "lte", "value": 30}],
})
check("two licences need attention within 30 days", len(soon["rows"]), 2)
check("the perpetual one is not counted as expiring",
      all(r["name"] != "D" for r in soon["rows"]), True)

sorted_out = apply_transforms(MANY, {
    "date_diff": [{"column": "expire", "as": "days_left"}],
    "sort": {"column": "days_left", "dir": "asc"},
})
check("sorting puts the most urgent first", sorted_out["rows"][0]["name"], "A")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
