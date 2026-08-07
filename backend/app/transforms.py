"""Post-fetch data shaping, applied to every connector's {columns, rows} result.

Widget options understood here:
  unpivot:  {"columns": ["sukses", "gagal"], "name": "status", "value": "total"}
            turns one wide row into one row per column — see apply_unpivot
  date_diff: [{"column": "expire", "as": "days_left", "unit": "days",
               "direction": "until"}]
            adds a numeric column for how far a date is from now, so expiry and
            age can be thresholded, coloured and alerted on
  filters:  [{"column": "Status", "op": "eq", "value": "Running"}]
            ops: eq, ne, contains, gt, gte, lt, lte, in, not_empty
  cross_filters: same shape, but a column this widget doesn't have is skipped
            instead of excluding every row (see apply_transforms)
  group_by: "Status"                     -> one row per distinct value
  aggregate: "count" | "sum" | "avg" | "min" | "max"
  value_column: column to aggregate when aggregate != count
  sort:     {"column": "count", "dir": "desc"}
  limit:    50

Order matters: unpivot runs first (it reshapes the table), then filters,
then grouping, then sorting and the limit.
"""
from datetime import datetime, timezone
from typing import Any

# Formats seen in the wild: GLPI sends "2025-10-16" and "2024-10-23 02:31:42",
# Postgres and Doris drivers send datetimes, JSON APIs send ISO with T and Z.
_DATE_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d/%m/%Y",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%dT%H:%M",
)


def parse_date(value) -> datetime | None:
    """Best-effort date parsing. Returns naive UTC, or None when unusable.

    GLPI writes "0000-00-00" and empty strings for "no date", which strptime
    rejects — those must read as missing rather than raising, or one bad row
    would blank an entire widget.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None) if value.tzinfo is None else \
            value.astimezone(timezone.utc).replace(tzinfo=None)

    text = str(value).strip()
    if not text or text.startswith("0000-00-00"):
        return None

    # tolerate a trailing Z and fractional seconds
    text = text.replace("Z", "").split(".")[0].strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(text)
        return parsed.replace(tzinfo=None) if parsed.tzinfo is None else \
            parsed.astimezone(timezone.utc).replace(tzinfo=None)
    except ValueError:
        return None


_UNIT_SECONDS = {"days": 86400.0, "hours": 3600.0, "minutes": 60.0}


def _is_date_only(value) -> bool:
    """True for "2025-10-16" but not "2024-10-23 02:31:42"."""
    if isinstance(value, datetime):
        return False
    text = str(value or "").strip()
    return bool(text) and " " not in text and "T" not in text


def apply_date_diff(rows: list, columns: list, specs, now: datetime | None = None):
    """Add columns holding the distance between a date column and now.

    Turns a date into a number, which is the only form thresholds, colour rules
    and alert rules can act on. "Expires 2025-10-16" tells you nothing at a
    glance; "-294 days" is unmissable.

      {"column": "expire", "as": "days_left", "unit": "days", "direction": "until"}

    direction "until" is future-positive (expiry, renewal); "since" is
    past-positive (backup age, last login). A row whose date cannot be parsed
    gets None rather than 0 — a licence with no expiry date is not expiring
    today.
    """
    if isinstance(specs, dict):
        specs = [specs]
    if not specs:
        return rows, columns

    now = now or datetime.utcnow()
    rows = [dict(r) for r in rows]
    columns = list(columns)

    for spec in specs:
        source = spec.get("column")
        if not source:
            continue
        target = spec.get("as") or f"{source}_days"
        unit = (spec.get("unit") or "days").lower()
        seconds = _UNIT_SECONDS.get(unit, 86400.0)
        future_positive = (spec.get("direction") or "until").lower() != "since"
        decimals = spec.get("decimals")

        for row in rows:
            raw = row.get(source)
            parsed = parse_date(raw)
            if parsed is None:
                row[target] = None
                continue

            if unit == "days" and not decimals and _is_date_only(raw):
                # A date with no time means calendar days, which is how people
                # read expiry: "2026-09-05" is 30 days away, not 29 and a half.
                delta_days = (parsed.date() - now.date()).days
                row[target] = delta_days if future_positive else -delta_days
                continue

            delta = (parsed - now) if future_positive else (now - parsed)
            value = delta.total_seconds() / seconds
            # round rather than truncate: 29.98 hours old is 30, not 29
            row[target] = round(value, int(decimals)) if decimals else round(value)

        if target not in columns:
            columns.append(target)

    return rows, columns


def _num(value) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def _matches(row: dict, f: dict) -> bool:
    col, op = f.get("column"), (f.get("op") or "eq").lower()
    target = f.get("value")
    actual = row.get(col)

    if op == "not_empty":
        return actual not in (None, "")
    if op == "in":
        wanted = target if isinstance(target, list) else \
            [v.strip() for v in str(target).split(",")]
        return str(actual) in [str(v) for v in wanted]
    if op == "contains":
        return str(target).lower() in str(actual if actual is not None else "").lower()
    if op in ("gt", "gte", "lt", "lte"):
        a, b = _num(actual), _num(target)
        if a is None or b is None:
            return False
        return {"gt": a > b, "gte": a >= b, "lt": a < b, "lte": a <= b}[op]
    # eq / ne — compare as strings so "1" and 1 behave the same
    equal = str(actual) == str(target)
    return equal if op == "eq" else not equal


def _aggregate(values: list, how: str) -> Any:
    if how == "count":
        return len(values)
    nums = [n for n in (_num(v) for v in values) if n is not None]
    if not nums:
        return 0
    if how == "sum":
        result = sum(nums)
    elif how == "avg":
        result = sum(nums) / len(nums)
    elif how == "min":
        result = min(nums)
    elif how == "max":
        result = max(nums)
    else:
        return len(values)
    return round(result, 4)


def apply_unpivot(rows: list, columns: list, spec: dict) -> tuple[list, list]:
    """Reshape wide columns into rows.

        sukses | gagal          status | total
        -------+------    ->    -------+------
         23159 |  3217          sukses | 23159
                               gagal   |  3217

    Handy for SQL that counts with FILTER/CASE, or any API that returns one
    object of totals, since charts need one row per slice.

    `columns` in the spec lists which of the source columns become rows; any
    remaining columns are carried through, so a per-day query keeps its date.
    """
    targets = [c for c in (spec.get("columns") or []) if c in columns]
    if not targets:
        return rows, columns

    name_col = spec.get("name") or "name"
    value_col = spec.get("value") or "value"
    labels = spec.get("labels") or {}
    keep = [c for c in columns if c not in targets]

    out = []
    for row in rows:
        for target in targets:
            new_row = {c: row.get(c) for c in keep}
            new_row[name_col] = labels.get(target, target)
            new_row[value_col] = row.get(target)
            out.append(new_row)

    return out, keep + [name_col, value_col]


def apply_transforms(result: dict, options: dict) -> dict:
    """Return a new {columns, rows} with the widget's shaping applied."""
    rows = list(result.get("rows") or [])
    columns = list(result.get("columns") or [])

    # 0. unpivot — reshape before anything else looks at column names
    unpivot = options.get("unpivot")
    if unpivot and unpivot.get("columns"):
        rows, columns = apply_unpivot(rows, columns, unpivot)

    # 0b. computed date distances — before filters, so "expiring in 60 days"
    # can filter on the number this produces
    date_diff = options.get("date_diff")
    if date_diff:
        rows, columns = apply_date_diff(rows, columns, date_diff)

    # 1. filter
    filters = [f for f in (options.get("filters") or []) if f.get("column")]
    for f in filters:
        rows = [r for r in rows if _matches(r, f)]

    # 1b. cross-filters, from clicking a slice or row on the dashboard.
    # Unlike a configured filter, one whose column this widget doesn't have is
    # ignored rather than matching nothing — a selection on `status` shouldn't
    # blank out a widget that has no status column.
    for f in (options.get("cross_filters") or []):
        column = f.get("column")
        if not column or column not in columns:
            continue
        rows = [r for r in rows if _matches(r, f)]

    # 2. group + aggregate
    group_by = options.get("group_by")
    if group_by:
        how = (options.get("aggregate") or "count").lower()
        value_column = options.get("value_column")
        label = how if how == "count" else f"{how}_{value_column or 'value'}"

        buckets: dict[str, list] = {}
        order: list[str] = []
        for r in rows:
            key = "(empty)" if r.get(group_by) in (None, "") else str(r.get(group_by))
            if key not in buckets:
                buckets[key] = []
                order.append(key)
            buckets[key].append(r.get(value_column) if value_column else r)

        rows = [{group_by: key, label: _aggregate(buckets[key], how)} for key in order]
        columns = [group_by, label]

    # 3. sort
    sort = options.get("sort") or {}
    sort_col = sort.get("column")
    if sort_col:
        reverse = str(sort.get("dir", "asc")).lower() == "desc"

        def _missing(value) -> bool:
            return value is None or (isinstance(value, str) and not value.strip())

        # Rows with no value are set aside and appended, never sorted among the
        # rest. Otherwise "most urgent first" leads with the rows that have no
        # date at all — the least urgent things crowding out the real ones.
        present = [r for r in rows if not _missing(r.get(sort_col))]
        missing = [r for r in rows if _missing(r.get(sort_col))]

        # Numeric when every *present* value is numeric. Judging on all values
        # meant a single gap made numbers sort as text, where "10" < "9".
        numeric = bool(present) and all(_num(r.get(sort_col)) is not None for r in present)
        present.sort(
            key=lambda r: _num(r.get(sort_col)) if numeric
            else str(r.get(sort_col)).lower(),
            reverse=reverse,
        )
        rows = present + missing

    # 4. limit
    limit = options.get("limit")
    if limit:
        try:
            rows = rows[: int(limit)]
        except (TypeError, ValueError):
            pass

    return {"columns": columns, "rows": rows}
