"""Unit tests for the transform layer. Run: python -m tests.test_transforms"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.transforms import apply_transforms  # noqa: E402

SAMPLE = {
    "columns": ["name", "status", "site", "cost"],
    "rows": [
        {"name": "vm1", "status": "Running", "site": "Sentul", "cost": 100},
        {"name": "vm2", "status": "Running", "site": "Sentul", "cost": 200},
        {"name": "vm3", "status": "Stopped", "site": "Jakarta", "cost": 50},
        {"name": "vm4", "status": "Running", "site": "Jakarta", "cost": 300},
        {"name": "vm5", "status": "Maintenance", "site": "Sentul", "cost": 0},
    ],
}

passed = failed = 0


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected}\n        got      {actual}")


print("filters")
r = apply_transforms(SAMPLE, {"filters": [{"column": "status", "op": "eq", "value": "Running"}]})
check("eq keeps 3 rows", len(r["rows"]), 3)
r = apply_transforms(SAMPLE, {"filters": [{"column": "status", "op": "ne", "value": "Running"}]})
check("ne keeps 2 rows", len(r["rows"]), 2)
r = apply_transforms(SAMPLE, {"filters": [{"column": "cost", "op": "gte", "value": 200}]})
check("gte numeric", sorted(x["name"] for x in r["rows"]), ["vm2", "vm4"])
r = apply_transforms(SAMPLE, {"filters": [{"column": "site", "op": "contains", "value": "sen"}]})
check("contains is case-insensitive", len(r["rows"]), 3)
r = apply_transforms(SAMPLE, {"filters": [{"column": "status", "op": "in", "value": "Stopped,Maintenance"}]})
check("in with csv string", len(r["rows"]), 2)
r = apply_transforms(SAMPLE, {"filters": [
    {"column": "status", "op": "eq", "value": "Running"},
    {"column": "site", "op": "eq", "value": "Sentul"},
]})
check("two filters are ANDed", len(r["rows"]), 2)

print("group + aggregate")
r = apply_transforms(SAMPLE, {"group_by": "status"})
check("count columns", r["columns"], ["status", "count"])
check("count rows", r["rows"],
      [{"status": "Running", "count": 3}, {"status": "Stopped", "count": 1},
       {"status": "Maintenance", "count": 1}])
r = apply_transforms(SAMPLE, {"group_by": "site", "aggregate": "sum", "value_column": "cost"})
check("sum by site", r["rows"],
      [{"site": "Sentul", "sum_cost": 300.0}, {"site": "Jakarta", "sum_cost": 350.0}])
r = apply_transforms(SAMPLE, {"group_by": "site", "aggregate": "avg", "value_column": "cost"})
check("avg by site", r["rows"],
      [{"site": "Sentul", "avg_cost": 100.0}, {"site": "Jakarta", "avg_cost": 175.0}])
r = apply_transforms(SAMPLE, {"group_by": "site", "aggregate": "max", "value_column": "cost"})
check("max by site", [x["max_cost"] for x in r["rows"]], [200.0, 300.0])

print("filter + group together")
r = apply_transforms(SAMPLE, {
    "filters": [{"column": "status", "op": "eq", "value": "Running"}],
    "group_by": "site",
})
check("running VMs per site", r["rows"],
      [{"site": "Sentul", "count": 2}, {"site": "Jakarta", "count": 1}])

print("sort + limit")
r = apply_transforms(SAMPLE, {"sort": {"column": "cost", "dir": "desc"}})
check("numeric desc", [x["cost"] for x in r["rows"]], [300, 200, 100, 50, 0])
r = apply_transforms(SAMPLE, {"sort": {"column": "name", "dir": "asc"}})
check("string asc", [x["name"] for x in r["rows"]], ["vm1", "vm2", "vm3", "vm4", "vm5"])
r = apply_transforms(SAMPLE, {"sort": {"column": "cost", "dir": "desc"}, "limit": 2})
check("limit after sort", [x["name"] for x in r["rows"]], ["vm4", "vm2"])
r = apply_transforms(SAMPLE, {"group_by": "status", "sort": {"column": "count", "dir": "desc"}, "limit": 2})
check("top 2 statuses", r["rows"], [{"status": "Running", "count": 3}, {"status": "Stopped", "count": 1}])

print("unpivot")
WIDE = {"columns": ["sukses", "gagal"], "rows": [{"sukses": 23159, "gagal": 3217}]}
r = apply_transforms(WIDE, {"unpivot": {"columns": ["sukses", "gagal"]}})
check("wide row becomes one row per column", r["rows"],
      [{"name": "sukses", "value": 23159}, {"name": "gagal", "value": 3217}])
check("columns are renamed to name/value", r["columns"], ["name", "value"])

r = apply_transforms(WIDE, {"unpivot": {"columns": ["sukses", "gagal"],
                                        "name": "status", "value": "total"}})
check("custom column names", r["columns"], ["status", "total"])

r = apply_transforms(WIDE, {"unpivot": {"columns": ["sukses", "gagal"],
                                        "labels": {"sukses": "Success", "gagal": "Failed"}}})
check("labels rename the categories", [x["name"] for x in r["rows"]], ["Success", "Failed"])

PER_DAY = {"columns": ["day", "sukses", "gagal"], "rows": [
    {"day": "2026-07-28", "sukses": 100, "gagal": 5},
    {"day": "2026-07-29", "sukses": 120, "gagal": 8},
]}
r = apply_transforms(PER_DAY, {"unpivot": {"columns": ["sukses", "gagal"]}})
check("other columns are carried through", r["columns"], ["day", "name", "value"])
check("each source row expands", len(r["rows"]), 4)
check("the kept column keeps its value", r["rows"][0],
      {"day": "2026-07-28", "name": "sukses", "value": 100})

r = apply_transforms(WIDE, {"unpivot": {"columns": ["sukses", "nonexistent"]}})
check("unknown columns are ignored", len(r["rows"]), 1)
r = apply_transforms(WIDE, {"unpivot": {"columns": ["nope"]}})
check("all-unknown leaves the data untouched", r["rows"], WIDE["rows"])
r = apply_transforms(WIDE, {"unpivot": {"columns": []}})
check("empty column list is a no-op", r["columns"], ["sukses", "gagal"])

r = apply_transforms(WIDE, {
    "unpivot": {"columns": ["sukses", "gagal"]},
    "sort": {"column": "value", "dir": "desc"},
})
check("unpivot runs before sorting", [x["value"] for x in r["rows"]], [23159, 3217])

r = apply_transforms(PER_DAY, {
    "unpivot": {"columns": ["sukses", "gagal"]},
    "group_by": "name", "aggregate": "sum", "value_column": "value",
})
check("unpivot then group works together", r["rows"],
      [{"name": "sukses", "sum_value": 220.0}, {"name": "gagal", "sum_value": 13.0}])

print("cross-filters")
r = apply_transforms(SAMPLE, {"cross_filters": [
    {"column": "status", "op": "eq", "value": "Running"}]})
check("cross-filter narrows to matching rows", len(r["rows"]), 3)

# the important difference from a configured filter: a column this widget
# doesn't have is ignored, not treated as "nothing matches"
r = apply_transforms(SAMPLE, {"cross_filters": [
    {"column": "not_a_column", "op": "eq", "value": "x"}]})
check("unknown column is skipped, not filtered to nothing", len(r["rows"]), 5)
r = apply_transforms(SAMPLE, {"filters": [
    {"column": "not_a_column", "op": "eq", "value": "x"}]})
check("a configured filter on an unknown column still excludes everything",
      len(r["rows"]), 0)

r = apply_transforms(SAMPLE, {
    "filters": [{"column": "site", "op": "eq", "value": "Sentul"}],
    "cross_filters": [{"column": "status", "op": "eq", "value": "Running"}],
})
check("configured and cross filters combine", len(r["rows"]), 2)

r = apply_transforms(SAMPLE, {
    "cross_filters": [{"column": "status", "op": "eq", "value": "Running"}],
    "group_by": "site",
})
check("cross-filter applies before grouping", r["rows"],
      [{"site": "Sentul", "count": 2}, {"site": "Jakarta", "count": 1}])

r = apply_transforms(SAMPLE, {"cross_filters": []})
check("empty cross-filter list is a no-op", len(r["rows"]), 5)
r = apply_transforms(SAMPLE, {"cross_filters": [{"op": "eq", "value": "x"}]})
check("cross-filter with no column is skipped", len(r["rows"]), 5)

# after an unpivot the columns are renamed, so a cross-filter must be checked
# against the reshaped column list
r = apply_transforms(
    {"columns": ["sukses", "gagal"], "rows": [{"sukses": 10, "gagal": 2}]},
    {"unpivot": {"columns": ["sukses", "gagal"]},
     "cross_filters": [{"column": "name", "op": "eq", "value": "gagal"}]})
check("cross-filter sees post-unpivot columns", r["rows"], [{"name": "gagal", "value": 2}])

print("edge cases")
r = apply_transforms({"columns": [], "rows": []}, {"group_by": "status"})
check("empty input", r["rows"], [])
r = apply_transforms(SAMPLE, {})
check("no options is a passthrough", len(r["rows"]), 5)
r = apply_transforms(
    {"columns": ["a", "b"], "rows": [{"a": None, "b": 1}, {"a": "x", "b": 2}]},
    {"group_by": "a"})
check("null group key becomes (empty)", r["rows"],
      [{"a": "(empty)", "count": 1}, {"a": "x", "count": 1}])
r = apply_transforms(SAMPLE, {"filters": [{"column": "missing", "op": "eq", "value": "x"}]})
check("unknown column filters everything out", len(r["rows"]), 0)
r = apply_transforms(SAMPLE, {"group_by": "site", "aggregate": "sum", "value_column": "name"})
check("summing non-numeric yields 0", [x["sum_name"] for x in r["rows"]], [0, 0])


print("count_by then unpivot, for a pie of buckets")
# A stat reads count_by's wide row directly. A pie needs one row per bucket,
# and unpivot used to run first — before the buckets existed — so it was
# silently discarded and the chart had nothing to draw.
contracts = {"columns": ["days_left"],
             "rows": [{"days_left": v} for v in (-294, -41, 6, 23, 100)]}
buckets = {"column": "days_left", "total_as": "total", "buckets": [
    {"as": "expired", "max": -1},
    {"as": "soon", "min": 0, "max": 60},
    {"as": "healthy", "min": 61}]}

wide = apply_transforms(contracts, {"count_by": buckets})
check("without unpivot a stat still gets one wide row",
      wide["rows"], [{"expired": 2, "soon": 2, "healthy": 1, "total": 5}])

tall = apply_transforms(contracts, {
    "count_by": buckets,
    "unpivot": {"columns": ["expired", "soon", "healthy"],
                "name": "name", "value": "value"}})
check("with unpivot a pie gets one row per bucket", len(tall["rows"]), 3)
check("named", [r["name"] for r in tall["rows"]], ["expired", "soon", "healthy"])
check("and counted", [r["value"] for r in tall["rows"]], [2, 2, 1])
check("the total rides along for a label", tall["rows"][0]["total"], 5)

check("unpivot on its own is unchanged",
      apply_transforms({"columns": ["sukses", "gagal"], "rows": [{"sukses": 10, "gagal": 2}]},
                       {"unpivot": {"columns": ["sukses", "gagal"],
                                    "name": "name", "value": "value"}})["rows"],
      [{"name": "sukses", "value": 10}, {"name": "gagal", "value": 2}])

check("a bucket that catches nothing still gets a slice",
      [r["value"] for r in apply_transforms(
          {"columns": ["days_left"], "rows": [{"days_left": 100}]},
          {"count_by": buckets,
           "unpivot": {"columns": ["expired", "soon", "healthy"],
                       "name": "name", "value": "value"}})["rows"]],
      [0, 0, 1])

print("a leftover spec must not change what a widget does")
# A widget duplicated from another carries its count_by and unpivot. Empty ones
# are truthy dicts, and the browser filtered them out before sending while the
# saved dashboard kept them — so the editor and the shared view of the same
# widget disagreed. This is that case.
LEFTOVER = {
    "group_by": "type", "aggregate": "count",
    "count_by": {"column": "", "unknown_as": "", "total_as": "", "buckets": []},
    "unpivot": {"columns": ["expired", "soon", "healthy"],
                "name": "name", "value": "value"},
}
kinds = ['Peningkatan'] * 75 + ['Perubahan'] * 38 + ['Perbaikan'] * 17 \
    + ['Pembaruan'] * 15 + ['Penambahan'] * 14
crs = {"columns": ["ticket_number", "type", "title"],
       "rows": [{"ticket_number": f"CR-{i}", "type": t, "title": "x"}
                for i, t in enumerate(kinds)]}
filtered = {k: v for k, v in LEFTOVER.items() if k != "count_by"}

check("an empty count_by no longer swallows group_by",
      len(apply_transforms(crs, LEFTOVER)["rows"]), 5)
check("both paths now agree",
      apply_transforms(crs, LEFTOVER), apply_transforms(crs, filtered))
check("and the grouping is right",
      apply_transforms(crs, LEFTOVER)["rows"][0], {"type": "Peningkatan", "count": 75})

check("an unpivot naming columns the data lacks is ignored",
      apply_transforms(crs, {"unpivot": {"columns": ["expired", "soon"],
                                         "name": "name", "value": "value"}})["columns"],
      ["ticket_number", "type", "title"])
check("sort and limit survive an empty count_by too",
      [r["type"] for r in apply_transforms(crs, {**LEFTOVER,
       "sort": {"column": "count", "dir": "desc"}, "limit": 2})["rows"]],
      ["Peningkatan", "Perubahan"])
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
