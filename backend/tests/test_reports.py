"""Scheduled reports: the clock, the message, and the gateway body.

Run: python tests/test_reports.py

The clock cases matter more than they look. The server runs in UTC, the people
reading the report are in Jakarta, and getting that wrong sends the morning
report in the afternoon — which is exactly the kind of bug that survives a
demo and is discovered by a colleague at 3am.
"""
import os
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")
os.environ["DATABASE_URL"] = "sqlite://"

from app import reports  # noqa: E402
from app.alerting import build_custom_body  # noqa: E402

passed = failed = 0


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}, got {actual!r}")


# Jakarta is UTC+7 with no daylight saving, so 08:00 WIB is 01:00 UTC.
WIB = {"at": "08:00", "timezone": "Asia/Jakarta"}


def utc(y, m, d, hh, mm):
    return datetime(y, m, d, hh, mm)


print("reading a schedule")
check("a time parses", reports.parse_time("08:00").hour, 8)
check("a single-digit hour parses", reports.parse_time("8:05").minute, 5)
check("midnight parses", reports.parse_time("00:00").hour, 0)
check("nonsense is None, not a guess", reports.parse_time("8am"), None)
check("an impossible hour is refused", reports.parse_time("25:00"), None)
check("an impossible minute is refused", reports.parse_time("08:60"), None)
check("blank is None", reports.parse_time(""), None)

check("weekdays parse", reports.parse_days("mon,tue,wed"), {0, 1, 2})
check("blank means every day", len(reports.parse_days("")), 7)
check("a star means every day", len(reports.parse_days("*")), 7)
check("an unrecognised list falls back to every day rather than never",
      len(reports.parse_days("someday")), 7)

print("timezone")
check("a bad zone falls back instead of crashing the loop",
      str(reports.zone_for("Mars/Olympus")), "Asia/Jakarta")
check("a real zone is used", str(reports.zone_for("Europe/London")), "Europe/London")

print("08:00 in Jakarta is 01:00 UTC")
# sent yesterday, now just past this morning's slot
yesterday = utc(2026, 8, 19, 1, 0)
check("not due at 00:59 UTC (07:59 WIB)",
      reports.is_due(WIB, utc(2026, 8, 20, 0, 59), yesterday), False)
check("due at 01:00 UTC (08:00 WIB)",
      reports.is_due(WIB, utc(2026, 8, 20, 1, 0), yesterday), True)
check("still due at 01:05 — a late tick does not skip the day",
      reports.is_due(WIB, utc(2026, 8, 20, 1, 5), yesterday), True)

print("sending only once")
this_morning = utc(2026, 8, 20, 1, 0)
check("not sent again a minute later",
      reports.is_due(WIB, utc(2026, 8, 20, 1, 1), this_morning), False)
check("nor at the end of the day",
      reports.is_due(WIB, utc(2026, 8, 20, 16, 0), this_morning), False)
check("but due again tomorrow",
      reports.is_due(WIB, utc(2026, 8, 21, 1, 0), this_morning), True)

print("a server that was down")
# down all of the 20th, back at 11:00 WIB on the 21st
check("sends today's report on return",
      reports.is_due(WIB, utc(2026, 8, 21, 4, 0), utc(2026, 8, 19, 1, 0)), True)
# and after that one send, the missed day is not replayed
check("yesterday's is not replayed afterwards",
      reports.is_due(WIB, utc(2026, 8, 21, 5, 0), utc(2026, 8, 21, 4, 0)), False)

print("weekdays only")
WEEKDAYS_ONLY = {**WIB, "days": "mon,tue,wed,thu,fri"}
# 2026-08-22 is a Saturday, 2026-08-24 a Monday
check("silent on Saturday",
      reports.is_due(WEEKDAYS_ONLY, utc(2026, 8, 22, 1, 0), utc(2026, 8, 21, 1, 0)), False)
check("speaks on Monday",
      reports.is_due(WEEKDAYS_ONLY, utc(2026, 8, 24, 1, 0), utc(2026, 8, 21, 1, 0)), True)

print("a newly saved report")
check("never sends for a slot that already passed today",
      reports.is_due(WIB, utc(2026, 8, 20, 9, 0), None), False)
marker = reports.first_due_marker(WIB, utc(2026, 8, 20, 9, 0))  # 16:00 WIB
check("its marker is this morning, so the next send is tomorrow",
      reports.is_due(WIB, utc(2026, 8, 20, 23, 59), marker), False)
check("and tomorrow it does send",
      reports.is_due(WIB, utc(2026, 8, 21, 1, 0), marker), True)
# saved before today's slot: the marker is yesterday, so today still fires
early_marker = reports.first_due_marker(WIB, utc(2026, 8, 20, 0, 30))  # 07:30 WIB
check("saved at 07:30, this morning's 08:00 still goes out",
      reports.is_due(WIB, utc(2026, 8, 20, 1, 0), early_marker), True)

check("no time configured means it never fires",
      reports.is_due({"timezone": "Asia/Jakarta"}, utc(2026, 8, 20, 1, 0), yesterday), False)

print("writing the message")
row = {"breach": 2, "warning": 0, "on_track": 13, "resolved": 24.0}
check("placeholders are filled",
      reports.render_message("Breach {breach} | Warning {warning} | On track {on_track}", row),
      "Breach 2 | Warning 0 | On track 13")
check("a whole number does not arrive as 24.0",
      reports.render_message("Resolved {resolved}", row), "Resolved 24")
check("a missing column reads as a dash, not as broken syntax",
      reports.render_message("Open {open}", row), "Open —")
check("an empty value reads as a dash too",
      reports.render_message("X {x}", {"x": ""}), "X —")
check("zero is a real number, not a blank",
      reports.render_message("W {warning}", row), "W 0")
check("text with no placeholders is left alone",
      reports.render_message("Laporan harian", row), "Laporan harian")
check("an empty template gives an empty message",
      reports.render_message("", row), "")
check("placeholders are listed for the form to check",
      reports.placeholders("A {breach} B {warning}"), ["breach", "warning"])

print("choosing the row")
check("count_by's single row is used",
      reports.summarise({"rows": [{"breach": 2}]}), {"breach": 2})
check("the first row is used when a query returns many",
      reports.summarise({"rows": [{"a": 1}, {"a": 2}]}), {"a": 1})
check("no rows gives an empty row rather than an error",
      reports.summarise({"rows": []}), {})
check("a missing result is handled too", reports.summarise(None), {})

print("the WhatsApp gateway body")
body = build_custom_body('{"target": "6281234567890", "message": "{message}"}',
                         "Breach 2 | Warning 0", "🟢 Laporan Tiket")
check("the target survives", body["target"], "6281234567890")
check("the headline leads the message",
      body["message"], "🟢 Laporan Tiket\nBreach 2 | Warning 0")

multiline = build_custom_body('{"phone": "628", "message": "{message}"}',
                              'Line one\nLine "two"', "")
check("newlines survive as newlines", multiline["message"], 'Line one\nLine "two"')
check("a quote in the message does not break the JSON",
      '"two"' in multiline["message"], True)

for bad, why in [('{"target": "628", "message": {message}}', "unquoted placeholder"),
                 ('not json at all', "not JSON"),
                 ('["a", "b"]', "an array, not an object")]:
    try:
        build_custom_body(bad, "hi", "")
        check(f"{why} is refused", "no error", "ValueError")
    except ValueError:
        check(f"{why} is refused", True, True)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
