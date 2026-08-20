"""Scheduled reports — a message sent because it is time, not because something broke.

This is deliberately separate from alerting, which exists to stay quiet. An
alert that fired every interval would train people to ignore the channel, so
`decide()` only speaks on a change of state. A report is the opposite promise:
it arrives at 08:00 whether the news is good or bad, and its value comes partly
from arriving even when everything is fine — silence from an alert is
ambiguous (all well? or is the checker dead?), while a report that stops
arriving is itself a signal.

The message is a template filled from the query's own columns:

    "Tiket hari ini — Open {open} | Warning {warning} | Breach {breach}"

which pairs with the count_by transform: one query produces one row holding a
count per bucket, and those bucket names become the placeholders. One fetch, so
the numbers in a single message can never disagree with each other.
"""
import re
from datetime import datetime, timedelta, time as dtime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Weekday numbers as Python uses them: Monday is 0.
WEEKDAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}

DEFAULT_TIMEZONE = "Asia/Jakarta"

_TIME = re.compile(r"^([01]?\d|2[0-3]):([0-5]\d)$")


def parse_time(value) -> dtime | None:
    """"08:00" -> time(8, 0). Anything else is None rather than a guess."""
    match = _TIME.match(str(value or "").strip())
    if not match:
        return None
    return dtime(int(match.group(1)), int(match.group(2)))


def parse_days(value) -> set[int]:
    """"mon,tue,wed" -> {0,1,2}. Empty or "*" means every day."""
    text = str(value or "").strip().lower()
    if not text or text == "*":
        return set(WEEKDAYS.values())
    days = set()
    for part in text.replace(" ", "").split(","):
        if part in WEEKDAYS:
            days.add(WEEKDAYS[part])
    # an unparseable list must not silently mean "never send"
    return days or set(WEEKDAYS.values())


def zone_for(name) -> ZoneInfo:
    """The report's timezone, falling back rather than failing.

    A report at "08:00" is meaningless without one, and the server clock is UTC
    — which in Jakarta is 3pm the day before. Getting this wrong sends the
    morning report in the afternoon, so it is worth being explicit about.
    """
    try:
        return ZoneInfo(str(name or DEFAULT_TIMEZONE))
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TIMEZONE)


def is_due(schedule: dict, now_utc: datetime, last_sent_utc: datetime | None) -> bool:
    """Should this report go out now?

    True when the local clock has passed today's send time, today is one of the
    chosen days, and we have not already sent for that moment. The last-sent
    check is what stops a restart — or a loop that ticks every 60 seconds —
    from sending the same report over and over.

    A missed window is not made up. If the server was down at 08:00 and comes
    back at 11:00, the report still goes out; if it comes back the next day, it
    sends that day's, not yesterday's. Yesterday's numbers arriving today would
    be worse than nothing.
    """
    at = parse_time(schedule.get("at"))
    if at is None:
        return False

    tz = zone_for(schedule.get("timezone"))
    local_now = now_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)

    if local_now.weekday() not in parse_days(schedule.get("days")):
        return False

    scheduled_local = local_now.replace(hour=at.hour, minute=at.minute,
                                        second=0, microsecond=0)
    if local_now < scheduled_local:
        return False       # not time yet today

    if last_sent_utc is None:
        # A brand-new report must not fire for a time that already passed
        # today — you would save it at 4pm and be startled by the 8am report.
        return False

    last_local = last_sent_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
    return last_local < scheduled_local


def first_due_marker(schedule: dict, now_utc: datetime) -> datetime:
    """Where the clock starts for a rule that has never sent.

    Set to the most recent scheduled moment, so the next send is tomorrow's
    rather than one a few minutes after saving.
    """
    at = parse_time(schedule.get("at")) or dtime(0, 0)
    tz = zone_for(schedule.get("timezone"))
    local_now = now_utc.replace(tzinfo=ZoneInfo("UTC")).astimezone(tz)
    marker = local_now.replace(hour=at.hour, minute=at.minute, second=0, microsecond=0)
    if marker > local_now:
        marker -= timedelta(days=1)
    return marker.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)


PLACEHOLDER = re.compile(r"\{([^}]+)\}")


def render_message(template: str, row: dict, columns: list | None = None) -> str:
    """Fill {column} placeholders from one row.

    A placeholder with no matching column renders as "—" rather than the raw
    "{breach}". Sending a message with visible template syntax looks broken and
    invites people to distrust the numbers that did work.
    """
    if not template:
        return ""
    row = row or {}

    def replace(match):
        key = match.group(1).strip()
        if key not in row:
            return "—"
        value = row[key]
        if value is None or value == "":
            return "—"
        if isinstance(value, float) and value.is_integer():
            return str(int(value))
        return str(value)

    return PLACEHOLDER.sub(replace, template)


def placeholders(template: str) -> list[str]:
    """Which columns a template asks for, so the form can warn about typos."""
    return [m.group(1).strip() for m in PLACEHOLDER.finditer(template or "")]


def summarise(result: dict) -> dict:
    """The row a report reads from.

    count_by already collapses a result to a single row of named counts, which
    is the shape a report wants. When a query returns many rows we take the
    first and let the template decide — silently summing columns whose meaning
    we don't know would invent numbers.
    """
    rows = (result or {}).get("rows") or []
    return dict(rows[0]) if rows else {}
