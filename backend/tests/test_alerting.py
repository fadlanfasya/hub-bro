"""Unit tests for alert evaluation, flap suppression and webhook payloads.

Run: python tests/test_alerting.py
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")

from app import alerting  # noqa: E402
from app.models import AlertRule  # noqa: E402
from app.secrets_store import MASK, decrypt, encrypt  # noqa: E402

passed = failed = 0


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}\n        got      {actual!r}")


class FakeDB:
    """Just enough of a Session to capture what would be written."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        pass


def rule(**kw):
    r = AlertRule(
        name=kw.pop("name", "Test rule"),
        datasource_id=1, owner_id=1,
        options="{}",
        thresholds=json.dumps(kw.pop("thresholds", {"direction": "above", "warn": 1, "critical": 5})),
        webhook=json.dumps({"url": encrypt("https://example.invalid/hook"), "format": "generic"}),
        interval_seconds=300,
        for_evaluations=kw.pop("for_evaluations", 1),
        repeat_minutes=kw.pop("repeat_minutes", 0),
        notify_on_recovery=kw.pop("notify_on_recovery", True),
        state=kw.pop("state", "unknown"),
        pending_level=None, pending_count=0,
        enabled=True, aggregate="first",
    )
    for k, v in kw.items():
        setattr(r, k, v)
    return r


print("threshold evaluation (must match frontend/src/thresholds.js)")
T_ABOVE = {"direction": "above", "warn": 70, "critical": 90}
T_BELOW = {"direction": "below", "warn": 30, "critical": 10}

check("below warn is ok", alerting.evaluate_threshold(50, T_ABOVE), "ok")
check("at warn is warn", alerting.evaluate_threshold(70, T_ABOVE), "warn")
check("above warn is warn", alerting.evaluate_threshold(80, T_ABOVE), "warn")
check("at critical is critical", alerting.evaluate_threshold(90, T_ABOVE), "critical")
check("above critical is critical", alerting.evaluate_threshold(99, T_ABOVE), "critical")
check("below direction: high value is ok", alerting.evaluate_threshold(50, T_BELOW), "ok")
check("below direction: at warn", alerting.evaluate_threshold(30, T_BELOW), "warn")
check("below direction: at critical", alerting.evaluate_threshold(10, T_BELOW), "critical")
check("no thresholds means no level", alerting.evaluate_threshold(5, {}), None)
check("empty thresholds means no level",
      alerting.evaluate_threshold(5, {"direction": "above"}), None)
check("a non-numeric value cannot be judged",
      alerting.evaluate_threshold("n/a", T_ABOVE), None)
check("None value cannot be judged", alerting.evaluate_threshold(None, T_ABOVE), None)
check("only a critical threshold still works",
      alerting.evaluate_threshold(95, {"direction": "above", "critical": 90}), "critical")
check("zero is a real value, not missing",
      alerting.evaluate_threshold(0, {"direction": "below", "warn": 1}), "warn")

print("reducing rows to one number")
RESULT = {"columns": ["host", "value"], "rows": [
    {"host": "a", "value": 10}, {"host": "b", "value": 30}, {"host": "c", "value": 20}]}
check("first row by default", alerting.reduce_value(RESULT, "value", "first"), 10)
check("sum", alerting.reduce_value(RESULT, "value", "sum"), 60)
check("avg", alerting.reduce_value(RESULT, "value", "avg"), 20)
check("min", alerting.reduce_value(RESULT, "value", "min"), 10)
check("max", alerting.reduce_value(RESULT, "value", "max"), 30)
check("count ignores the value field", alerting.reduce_value(RESULT, "value", "count"), 3)
check("count of nothing is zero, which is alertable",
      alerting.reduce_value({"columns": [], "rows": []}, None, "count"), 0)
check("no rows gives no value", alerting.reduce_value({"rows": []}, "value", "sum"), None)
check("picks the first numeric column when no field is named",
      alerting.reduce_value(RESULT, None, "first"), 10)
check("non-numeric rows are skipped",
      alerting.reduce_value({"columns": ["v"], "rows": [{"v": "x"}, {"v": 7}]}, "v", "sum"), 7)
check("a missing column gives no value",
      alerting.reduce_value(RESULT, "nope", "sum"), None)

print("flap suppression and de-duplication")
now = datetime(2026, 8, 5, 12, 0, 0)

r = rule(for_evaluations=2)
check("one bad reading stays quiet", alerting.decide(r, "critical", now), None)
check("state is not changed while pending", r.state, "unknown")
check("a second consecutive breach fires", alerting.decide(r, "critical", now), "fired")
check("state advances once fired", r.state, "critical")
check("staying critical does not fire again", alerting.decide(r, "critical", now), None)
check("still no repeat on the next check", alerting.decide(r, "critical", now), None)

r = rule(for_evaluations=3)
alerting.decide(r, "critical", now)
alerting.decide(r, "warn", now)
check("a different level restarts the count", r.pending_count, 1)

r = rule(for_evaluations=1, state="critical")
check("recovery is reported", alerting.decide(r, "ok", now), "recovered")
check("recovery is not repeated", alerting.decide(r, "ok", now), None)

r = rule(for_evaluations=5, state="critical")
check("recovery is believed immediately, ignoring for_evaluations",
      alerting.decide(r, "ok", now), "recovered")

r = rule(state="unknown")
check("a rule that starts healthy says nothing", alerting.decide(r, "ok", now), None)
check("and does not claim to have recovered", r.state, "ok")

r = rule(state="critical", notify_on_recovery=False)
check("recovery can be switched off", alerting.decide(r, "ok", now), None)

r = rule(state="warn", for_evaluations=1)
check("escalation warn -> critical is reported", alerting.decide(r, "critical", now), "fired")

r = rule(state="critical", repeat_minutes=30, last_notified_at=now - timedelta(minutes=10))
check("a reminder is not due yet", alerting.decide(r, "critical", now), None)
r.last_notified_at = now - timedelta(minutes=31)
check("a reminder fires once due", alerting.decide(r, "critical", now), "reminder")

r = rule(state="ok", repeat_minutes=30, last_notified_at=now - timedelta(days=1))
check("healthy rules never send reminders", alerting.decide(r, "ok", now), None)

check("an unjudgeable value changes nothing", alerting.decide(rule(), None, now), None)

# Regression: an unreachable source was announced but its recovery was not, so
# the channel was left believing the system was still down.
r = rule(state="error", for_evaluations=1)
check("recovery from an unreachable source is announced",
      alerting.decide(r, "ok", now), "recovered")
r = rule(state="error", for_evaluations=1)
check("error straight to breaching still fires",
      alerting.decide(r, "critical", now), "fired")

print("webhook payloads")
slack = alerting.build_payload("Disk", "critical", 95, "95 is at or above 90", "fired", "slack")
check("slack uses a text field", "text" in slack, True)
check("slack mentions the rule", "Disk" in slack["text"], True)
check("slack has no stray keys", set(slack), {"text"})

teams = alerting.build_payload("Disk", "warn", 80, "msg", "fired", "teams")
check("teams uses a MessageCard", teams["@type"], "MessageCard")
check("teams colours by level", teams["themeColor"], "FBCA04")
check("teams sets a summary so the card renders", bool(teams["summary"]), True)

generic = alerting.build_payload("Disk", "ok", 10, "recovered", "recovered", "generic")
check("generic carries structured fields", generic["level"], "ok")
check("generic states the reason", generic["reason"], "recovered")
check("generic includes a timestamp", generic["at"].endswith("Z"), True)
check("an unknown format falls back to generic",
      "rule" in alerting.build_payload("D", "ok", 1, "m", "fired", "nonsense"), True)
check("recovery wording differs from firing",
      alerting.build_payload("D", "ok", 1, "m", "recovered", "slack")["text"] !=
      alerting.build_payload("D", "ok", 1, "m", "fired", "slack")["text"], True)

print("webhook delivery guards")
ok, err = asyncio.run(alerting.send_webhook({"url": ""}, {}))
check("a missing URL is refused, not attempted", (ok, "No webhook URL" in err), (False, True))
ok, err = asyncio.run(alerting.send_webhook({"url": "file:///etc/passwd"}, {}))
check("a non-http scheme is refused", (ok, "http://" in err), (False, True))
ok, err = asyncio.run(alerting.send_webhook({"url": "javascript:alert(1)"}, {}))
check("a javascript URL is refused", ok, False)

print("the webhook URL is treated as a credential")
r = rule()
stored = json.loads(r.webhook)["url"]
check("stored encrypted", stored.startswith("enc:v1:"), True)
check("decrypts for delivery", r.webhook_dict["url"], "https://example.invalid/hook")
check("masked in API responses", r.safe_webhook_dict["url"], MASK)
check("the format is not masked", r.safe_webhook_dict["format"], "generic")
check("an unset URL masks to empty, not to dots",
      AlertRule(webhook=json.dumps({"url": "", "format": "slack"})).safe_webhook_dict["url"], "")

print("describe")
check("describes an above breach",
      alerting.describe(95, T_ABOVE, "critical"), "95 is at or above the critical threshold of 90")
check("describes a below breach",
      alerting.describe(5, T_BELOW, "critical"), "5 is at or below the critical threshold of 10")
check("says nothing when healthy", alerting.describe(1, T_ABOVE, "ok"), "")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
