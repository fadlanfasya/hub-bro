"""Epoch timestamps in parse_date / date_diff.

Cortex XDR reports every time as epoch milliseconds and Prometheus as seconds.
Before this, both parsed as None and date_diff produced an empty column with no
error — the widget just looked broken.
"""
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.transforms import apply_date_diff, apply_transforms, parse_date  # noqa: E402

passed = failed = 0


def check(name, got, want):
    global passed, failed
    if got == want:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}\n  got  {got!r}\n  want {want!r}")


# ---- milliseconds -----------------------------------------------------------
# 1788747814000 is the creation_time of incident 672 in the real sample.
check("ms int", parse_date(1788747814000), datetime(2026, 9, 7, 2, 23, 34))
check("ms as string", parse_date("1788747814000"), datetime(2026, 9, 7, 2, 23, 34))
check("ms float", parse_date(1788747814000.0), datetime(2026, 9, 7, 2, 23, 34))

# ---- seconds ----------------------------------------------------------------
check("seconds", parse_date(1788747814), datetime(2026, 9, 7, 2, 23, 34))
check("seconds float (Prometheus)", parse_date(1755200000.0),
      datetime(2025, 8, 14, 19, 33, 20))

# ---- things that must NOT be read as epoch ---------------------------------
# A bare year and a packed date are both under 1e9 and stay non-epoch, so the
# existing string formats get their turn.
check("year is not a timestamp", parse_date(2026), None)
check("packed date is not a timestamp", parse_date(20260909), None)
check("zero", parse_date(0), None)
check("small int", parse_date(42), None)
check("bool", parse_date(True), None)
check("none", parse_date(None), None)
check("empty", parse_date(""), None)

# ---- existing behaviour is untouched ---------------------------------------
check("iso date still works", parse_date("2026-09-06"), datetime(2026, 9, 6))
check("iso datetime still works", parse_date("2026-09-06 12:03:34"),
      datetime(2026, 9, 6, 12, 3, 34))
check("glpi zero date still None", parse_date("0000-00-00"), None)
check("datetime passthrough", parse_date(datetime(2026, 9, 6)), datetime(2026, 9, 6))

# ---- date_diff over epoch ---------------------------------------------------
# These are the real last_seen values of two agents in the sample pull.
now = datetime(2026, 9, 9)
rows = [
    {"host_name": "iZk1a9mgjikqle8paf8xayZ", "last_seen": 1774615286272},
    {"host_name": "STLRCRCOM26", "last_seen": 1788920397531},
]
out_rows, out_cols = apply_date_diff(
    list(rows), ["host_name", "last_seen"],
    [{"column": "last_seen", "as": "days_unseen", "direction": "since"}],
    now=now,
)
check("date_diff adds the column", "days_unseen" in out_cols, True)
check("stale agent measured", out_rows[0]["days_unseen"], 165)
check("fresh agent measured", out_rows[1]["days_unseen"], 0)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
