"""Alert evaluation and webhook delivery.

The design goal is that an alert you receive is worth reading. Three rules
follow from that:

  * Notify on *change*, not on every evaluation. A metric sitting at critical
    for six hours is one message, not seventy-two.
  * Require N consecutive breaches before firing (`for_evaluations`), so a
    single slow query or a momentary spike stays quiet.
  * Say what recovered, not just what broke. An alert channel that only ever
    reports bad news trains people to ignore it.

Thresholds are evaluated with exactly the same comparisons the widgets use
(frontend/src/thresholds.js) — a stat showing red must alert, and one showing
green must not. test_alerting.py checks the two implementations agree.
"""
import asyncio
import json
import logging
from datetime import datetime, timedelta

import httpx

from .config import settings
from .connectors import fetch_data
from .models import AlertNotification, AlertRule

log = logging.getLogger("uvicorn.error")

LEVELS = ("ok", "warn", "critical")
WEBHOOK_TIMEOUT = 10


# --------------------------------------------------------------------------
# threshold evaluation — mirrors frontend/src/thresholds.js
# --------------------------------------------------------------------------

def number_or_none(value):
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n and abs(n) != float("inf") else None


def evaluate_threshold(value, thresholds: dict) -> str | None:
    """Returns 'ok' | 'warn' | 'critical', or None when not configured."""
    if not thresholds:
        return None
    warn = number_or_none(thresholds.get("warn"))
    critical = number_or_none(thresholds.get("critical"))
    if warn is None and critical is None:
        return None

    n = number_or_none(value)
    if n is None:
        return None

    below = thresholds.get("direction") == "below"

    def breached(limit):
        if limit is None:
            return False
        return n <= limit if below else n >= limit

    if breached(critical):
        return "critical"
    if breached(warn):
        return "warn"
    return "ok"


def describe(value, thresholds: dict, level: str) -> str:
    if not level or level == "ok":
        return ""
    limit = thresholds.get("critical") if level == "critical" else thresholds.get("warn")
    comparator = "at or below" if thresholds.get("direction") == "below" else "at or above"
    return f"{value} is {comparator} the {level} threshold of {limit}"


# --------------------------------------------------------------------------
# reducing a result set to one number
# --------------------------------------------------------------------------

def reduce_value(result: dict, field: str | None, aggregate: str = "first"):
    """Collapse fetched rows to the single number a rule compares.

    `count` is special: it counts rows and so works without a value field,
    which is what you want for "alert when any row comes back".
    """
    rows = (result or {}).get("rows") or []
    columns = (result or {}).get("columns") or []
    aggregate = (aggregate or "first").lower()

    if aggregate == "count":
        return len(rows)
    if not rows:
        return None

    key = field or next(
        (c for c in columns if isinstance(rows[0].get(c), (int, float))
         and not isinstance(rows[0].get(c), bool)),
        columns[0] if columns else None,
    )
    if not key:
        return None

    values = [number_or_none(r.get(key)) for r in rows]
    values = [v for v in values if v is not None]
    if not values:
        return None

    if aggregate == "sum":
        return sum(values)
    if aggregate == "avg":
        return sum(values) / len(values)
    if aggregate == "min":
        return min(values)
    if aggregate == "max":
        return max(values)
    return values[0]


# --------------------------------------------------------------------------
# webhook delivery
# --------------------------------------------------------------------------

EMOJI = {"critical": "🔴", "warn": "🟡", "ok": "🟢", "error": "⚠️"}


def build_payload(rule_name: str, level: str, value, message: str,
                  reason: str, fmt: str = "generic") -> dict:
    """Shape the message for the destination.

    Slack and Teams each ignore anything they don't recognise, so a generic
    JSON body would post an empty message to either. The format is chosen
    explicitly rather than guessed from the URL, because self-hosted
    Mattermost/Rocket.Chat use Slack's schema on unrelated hostnames.
    """
    icon = EMOJI.get(level, "")
    headline = {
        "fired": f"{icon} {rule_name} is {level.upper()}",
        "recovered": f"{icon} {rule_name} recovered",
        "reminder": f"{icon} {rule_name} is still {level.upper()}",
        "test": f"{icon} {rule_name} — test message",
    }.get(reason, f"{icon} {rule_name}")

    body = message or f"Current value: {value}"

    if fmt == "slack":
        return {"text": f"*{headline}*\n{body}"}
    if fmt == "teams":
        return {
            "@type": "MessageCard",
            "@context": "https://schema.org/extensions",
            "themeColor": {"critical": "D93F0B", "warn": "FBCA04",
                           "ok": "0E8A16"}.get(level, "888888"),
            "summary": headline,
            "title": headline,
            "text": body,
        }
    return {
        "rule": rule_name,
        "level": level,
        "reason": reason,
        "value": value,
        "message": body,
        "at": datetime.utcnow().isoformat() + "Z",
    }


async def send_webhook(webhook: dict, payload: dict) -> tuple[bool, str | None]:
    url = (webhook or {}).get("url") or ""
    if not url:
        return False, "No webhook URL is configured"
    if not url.lower().startswith(("http://", "https://")):
        return False, "Webhook URL must start with http:// or https://"
    try:
        async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT, follow_redirects=False) as client:
            resp = await client.post(url, json=payload)
        if resp.status_code >= 400:
            return False, f"Webhook returned {resp.status_code}: {resp.text[:150]}"
        return True, None
    except Exception as e:  # noqa: BLE001 — a delivery failure must not kill the loop
        return False, str(e)[:200]


def record(db, rule: AlertRule, level: str, value, message: str,
           reason: str, delivered: bool, error: str | None):
    db.add(AlertNotification(
        rule_id=rule.id, level=level,
        value=None if value is None else str(value),
        message=message, reason=reason, delivered=delivered, error=error,
    ))


async def notify(db, rule: AlertRule, level: str, value, message: str, reason: str):
    payload = build_payload(rule.name, level, value, message, reason,
                            (rule.webhook_dict.get("format") or "generic"))
    ok, error = await send_webhook(rule.webhook_dict, payload)
    record(db, rule, level, value, message, reason, ok, error)
    if ok:
        rule.last_notified_at = datetime.utcnow()
    else:
        log.warning("Alert '%s' could not be delivered: %s", rule.name, error)
    return ok


# --------------------------------------------------------------------------
# the state machine
# --------------------------------------------------------------------------

def decide(rule: AlertRule, level: str | None, now: datetime) -> str | None:
    """Return the reason to notify ('fired'|'recovered'|'reminder'), or None.

    Pure and side-effect free apart from the pending counters, so the
    flap-suppression logic can be tested without any I/O.
    """
    if level is None:
        return None

    # count consecutive evaluations at the same level
    if rule.pending_level == level:
        rule.pending_count += 1
    else:
        rule.pending_level = level
        rule.pending_count = 1

    required = max(1, rule.for_evaluations or 1)
    # recovery is believed immediately; only breaches must prove themselves,
    # otherwise a resolved incident keeps paging for another N intervals
    if level != "ok" and rule.pending_count < required:
        return None

    if level != rule.state:
        # "error" counts as bad: if we announced that a source was unreachable,
        # we owe the channel the news that it came back
        was_bad = rule.state in ("warn", "critical", "error")
        rule.state = level
        rule.state_since = now
        if level == "ok":
            # nothing to celebrate if we never told anyone it was broken
            if was_bad and rule.notify_on_recovery:
                return "recovered"
            return None
        return "fired"

    # unchanged and still bad — remind only if asked to
    if level != "ok" and rule.repeat_minutes:
        due = (rule.last_notified_at or datetime.min) + timedelta(minutes=rule.repeat_minutes)
        if now >= due:
            return "reminder"
    return None


async def evaluate(db, rule: AlertRule) -> dict:
    """Run one rule: fetch, evaluate, notify if warranted. Never raises."""
    now = datetime.utcnow()
    rule.last_checked_at = now

    try:
        result = await asyncio.wait_for(
            fetch_data(rule.datasource, rule.options_dict),
            timeout=settings.FETCH_TIMEOUT_SECONDS + 5,
        )
    except Exception as e:  # noqa: BLE001
        rule.last_error = str(e)[:300]
        # A source that cannot be reached is itself worth knowing about, but
        # only once — a broken VPN must not produce a message every interval.
        if rule.state != "error":
            rule.state = "error"
            rule.state_since = now
            rule.pending_level, rule.pending_count = None, 0
            await notify(db, rule, "error", None,
                         f"Could not evaluate: {rule.last_error}", "fired")
        return {"level": "error", "error": rule.last_error}

    rule.last_error = None
    value = reduce_value(result, rule.value_field, rule.aggregate)
    rule.last_value = None if value is None else str(value)

    thresholds = rule.thresholds_dict
    level = evaluate_threshold(value, thresholds)
    if level is None:
        return {"level": None, "value": value,
                "skipped": "no thresholds configured or value is not a number"}

    # a rule coming back from "error" is handled inside decide(), which treats
    # error as a bad state and so reports the recovery
    reason = decide(rule, level, now)
    if reason:
        message = (describe(value, thresholds, level)
                   if level != "ok" else f"Back to normal — current value: {value}")
        await notify(db, rule, level, value, message, reason)

    return {"level": level, "value": value, "notified": reason}


async def run_due_rules(db) -> int:
    """Evaluate every enabled rule whose interval has elapsed."""
    now = datetime.utcnow()
    rules = db.query(AlertRule).filter(AlertRule.enabled.is_(True)).all()
    ran = 0
    for rule in rules:
        due_at = (rule.last_checked_at or datetime.min) + \
            timedelta(seconds=max(30, rule.interval_seconds or 300))
        if now < due_at:
            continue
        try:
            await evaluate(db, rule)
            ran += 1
        except Exception as e:  # noqa: BLE001 — one bad rule must not stop the rest
            log.exception("Alert rule '%s' failed to evaluate: %s", rule.name, e)
    if ran:
        db.commit()
    return ran


async def alert_loop():
    """Background scheduler. Ticks often; each rule honours its own interval."""
    from .database import SessionLocal

    tick = max(15, settings.ALERT_TICK_SECONDS)
    while True:
        await asyncio.sleep(tick)
        db = SessionLocal()
        try:
            await run_due_rules(db)
        except Exception as e:  # noqa: BLE001
            log.exception("Alert loop error: %s", e)
            db.rollback()
        finally:
            db.close()


def prune_notifications(db, rule_id: int, keep: int = 100):
    """Cap history per rule so the table can't grow without bound."""
    ids = [n.id for n in db.query(AlertNotification.id)
           .filter(AlertNotification.rule_id == rule_id)
           .order_by(AlertNotification.id.desc()).offset(keep).all()]
    if ids:
        db.query(AlertNotification).filter(AlertNotification.id.in_(ids)) \
            .delete(synchronize_session=False)


def rule_to_dict(rule: AlertRule) -> dict:
    return {
        "id": rule.id,
        "name": rule.name,
        "enabled": rule.enabled,
        "datasource_id": rule.datasource_id,
        "datasource_name": rule.datasource.name if rule.datasource else None,
        "options": rule.options_dict,
        "value_field": rule.value_field,
        "aggregate": rule.aggregate,
        "thresholds": rule.thresholds_dict,
        "interval_seconds": rule.interval_seconds,
        "for_evaluations": rule.for_evaluations,
        "repeat_minutes": rule.repeat_minutes,
        "notify_on_recovery": rule.notify_on_recovery,
        "webhook": rule.safe_webhook_dict,
        "state": rule.state,
        "last_value": rule.last_value,
        "last_error": rule.last_error,
        "last_checked_at": rule.last_checked_at,
        "last_notified_at": rule.last_notified_at,
        "state_since": rule.state_since,
    }
