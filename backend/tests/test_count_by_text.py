"""Counting a text column into buckets.

Numeric buckets already worked. A status column — the most common thing worth
collapsing onto one tile — did not, because every value failed _num() and fell
straight into `unknown`.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.transforms import apply_count_by, apply_transforms  # noqa: E402

passed = failed = 0


def check(name, got, want):
    global passed, failed
    if got == want:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}\n  got  {got!r}\n  want {want!r}")


# The real distribution of the 278 agents, in miniature.
agents = (
    [{"operational_status": "PROTECTED"}] * 245
    + [{"operational_status": "PARTIALLY_PROTECTED"}] * 32
    + [{"operational_status": "UNPROTECTED"}] * 1
)
spec = {
    "column": "operational_status",
    "buckets": [
        {"as": "protected", "equals": "PROTECTED"},
        {"as": "partial", "equals": "PARTIALLY_PROTECTED"},
        {"as": "unprotected", "equals": "UNPROTECTED"},
    ],
    "total_as": "total",
}
rows, cols = apply_count_by(list(agents), ["operational_status"], spec)
check("one summary row", len(rows), 1)
check("columns in bucket order", cols, ["protected", "partial", "unprotected", "total"])
check("protected", rows[0]["protected"], 245)
check("partial", rows[0]["partial"], 32)
check("unprotected", rows[0]["unprotected"], 1)
check("total for the percentage", rows[0]["total"], 278)
check("buckets sum to total",
      rows[0]["protected"] + rows[0]["partial"] + rows[0]["unprotected"], 278)

# ---- matching details -------------------------------------------------------
mixed = [{"s": "protected"}, {"s": "  PROTECTED  "}, {"s": "Protected"}]
rows, _ = apply_count_by(mixed, ["s"], {
    "column": "s", "buckets": [{"as": "p", "equals": "PROTECTED"}]})
check("case and padding ignored", rows[0]["p"], 3)

rows, _ = apply_count_by(
    [{"s": "LOST"}, {"s": "DISCONNECTED"}, {"s": "CONNECTED"}], ["s"],
    {"column": "s", "buckets": [{"as": "offline", "equals": ["LOST", "DISCONNECTED"]},
                                {"as": "online", "equals": "CONNECTED"}]})
check("a bucket can take a list", rows[0]["offline"], 2)
check("and the other still counts", rows[0]["online"], 1)

# The form has one text box, so a set arrives comma separated.
rows, _ = apply_count_by(
    [{"s": "LOST"}, {"s": "DISCONNECTED"}, {"s": "CONNECTED"}], ["s"],
    {"column": "s", "buckets": [{"as": "offline", "equals": "LOST, DISCONNECTED"}]})
check("comma separated text", rows[0]["offline"], 2)

# An empty box must not silently match blank rows — that is unknown_as's job.
rows, _ = apply_count_by(
    [{"s": ""}, {"s": None}, {"s": "PROTECTED"}], ["s"],
    {"column": "s", "buckets": [{"as": "empty_box", "equals": ""},
                                {"as": "p", "equals": "PROTECTED"}]})
check("empty equals matches nothing", rows[0]["empty_box"], 0)
check("the real bucket still works", rows[0]["p"], 1)

rows, _ = apply_count_by(
    [{"s": "PROTECTED"}, {"s": "SOMETHING_NEW"}, {"s": None}], ["s"],
    {"column": "s", "buckets": [{"as": "p", "equals": "PROTECTED"}],
     "unknown_as": "other"})
check("unmatched falls to unknown", rows[0]["other"], 2)

rows, _ = apply_count_by(
    [{"s": "PROTECTED"}, {"s": "SOMETHING_NEW"}], ["s"],
    {"column": "s", "buckets": [{"as": "p", "equals": "PROTECTED"}]})
check("without unknown_as it is dropped, not miscounted", rows[0], {"p": 1})

# First match wins, so overlapping buckets cannot double count.
rows, _ = apply_count_by(
    [{"s": "LOST"}], ["s"],
    {"column": "s", "buckets": [{"as": "first", "equals": "LOST"},
                                {"as": "second", "equals": "LOST"}]})
check("first bucket wins", (rows[0]["first"], rows[0]["second"]), (1, 0))

# ---- numeric buckets are untouched -----------------------------------------
contracts = [{"days_left": -5}, {"days_left": 30}, {"days_left": 400},
             {"days_left": None}, {"days_left": "n/a"}]
rows, _ = apply_count_by(contracts, ["days_left"], {
    "column": "days_left",
    "buckets": [{"as": "expired", "max": -1},
                {"as": "soon", "min": 0, "max": 60},
                {"as": "healthy", "min": 61}],
    "unknown_as": "no_date"})
check("expired", rows[0]["expired"], 1)
check("soon", rows[0]["soon"], 1)
check("healthy", rows[0]["healthy"], 1)
check("non-numeric still unknown", rows[0]["no_date"], 2)

# ---- mixed specs in one list ------------------------------------------------
rows, _ = apply_count_by(
    [{"v": "OPEN"}, {"v": 5}, {"v": 500}], ["v"],
    {"column": "v", "buckets": [{"as": "open", "equals": "OPEN"},
                                {"as": "small", "max": 10},
                                {"as": "big", "min": 11}]})
check("text and numeric buckets coexist",
      (rows[0]["open"], rows[0]["small"], rows[0]["big"]), (1, 1, 1))

# ---- through the full pipeline ---------------------------------------------
result = apply_transforms(
    {"columns": ["host_name", "operational_status"],
     "rows": [{"host_name": "a", "operational_status": "PROTECTED"},
              {"host_name": "b", "operational_status": "UNPROTECTED"}]},
    {"count_by": {"column": "operational_status",
                  "buckets": [{"as": "protected", "equals": "PROTECTED"}],
                  "total_as": "total"}})
check("pipeline returns the summary row", result["rows"], [{"protected": 1, "total": 2}])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
