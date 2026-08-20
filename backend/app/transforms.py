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


def add_months(when: datetime, months) -> datetime | None:
    """Shift a date by N whole months, clamping the day to the target month.

    31 January + 1 month is 28 February, not 3 March. Contracts renew on a
    month boundary, so calendar months are the honest unit — adding 30-day
    blocks would drift a day or two every year.
    """
    n = _num(months)
    if n is None:
        return None
    n = int(n)
    total = when.month - 1 + n
    year = when.year + total // 12
    month = total % 12 + 1
    # last day of the target month
    if month == 12:
        last = 31
    else:
        last = (datetime(year, month + 1, 1) - datetime(year, month, 1)).days
    return when.replace(year=year, month=month, day=min(when.day, last))


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

        # GLPI contracts have no end date: they store a start plus a duration in
        # months. `plus_months` names the column (or a fixed number) holding
        # that duration, so the end date can be derived instead of stored.
        plus_months = spec.get("plus_months")
        label_target = spec.get("label_as")
        label_format = spec.get("label_format") or "%Y-%m"

        for row in rows:
            raw = row.get(source)
            parsed = parse_date(raw)
            if parsed is None:
                row[target] = None
                if label_target:
                    row[label_target] = None
                continue

            if plus_months not in (None, ""):
                months = row.get(plus_months, plus_months)
                shifted = add_months(parsed, months)
                if shifted is None:
                    # a contract with no duration has no end date; leaving it
                    # blank is right, guessing zero months is not
                    row[target] = None
                    if label_target:
                        row[label_target] = None
                    continue
                parsed = shifted

            # Optional: emit the resolved date as a label too, so the same spec
            # can feed both a threshold (the number) and a grouped chart (the
            # month). Deriving both from one computed date keeps them agreeing.
            if label_target:
                row[label_target] = parsed.strftime(label_format)

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
        if label_target and label_target not in columns:
            columns.append(label_target)

    return rows, columns


def apply_count_by(rows: list, columns: list, spec: dict):
    """Collapse rows into ONE row holding a count per bucket.

        {"column": "days_left", "buckets": [
            {"as": "expired",  "max": -1},
            {"as": "soon",     "min": 0, "max": 60},
            {"as": "healthy",  "min": 61}]}

      -> columns ["expired", "soon", "healthy"], one row {85, 25, 82}

    A stat widget shows one number and can only apply one filter, so "85
    expired, 25 expiring, 82 healthy" is impossible as three filtered widgets
    in one tile. Turning the buckets into columns of a single row lets the
    headline read one of them and the supporting line read the rest — all from
    a single fetch, so the numbers cannot disagree.

    Bounds are inclusive. Rows whose value is missing or non-numeric are
    counted in `unknown` when a bucket asks for it, and otherwise ignored —
    a contract with no dates is not "expired".
    """
    if not spec or not spec.get("column"):
        return rows, columns
    source = spec["column"]
    buckets = spec.get("buckets") or []
    if not buckets:
        return rows, columns

    out: dict = {}
    names = []
    for b in buckets:
        name = b.get("as") or "bucket"
        out[name] = 0
        names.append(name)

    unknown_name = spec.get("unknown_as")
    if unknown_name:
        out[unknown_name] = 0
        names.append(unknown_name)

    for row in rows:
        value = _num(row.get(source))
        if value is None:
            if unknown_name:
                out[unknown_name] += 1
            continue
        for b in buckets:
            lo, hi = _num(b.get("min")), _num(b.get("max"))
            if lo is not None and value < lo:
                continue
            if hi is not None and value > hi:
                continue
            out[b.get("as") or "bucket"] += 1
            break          # first matching bucket wins, so totals never double count

    if spec.get("total_as"):
        out[spec["total_as"]] = len(rows)
        names.append(spec["total_as"])

    return [out], names


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


def join_results(parts: list, spec: dict) -> dict:
    """Merge several result sets into one table on a shared key column.

    Prometheus cannot return a table. One query gives one number per series, so
    a row like "device | cpu | memory | failover" is several queries stitched
    together on a key both of them carry — usually `instance` or `sysName`.

    `parts` is [{"as": "CPU", "result": {columns, rows}}, ...]. The join is a
    full outer join keyed on `spec["on"]`: a device that answers one query but
    not another still gets a row, with a blank in the column it missed. An
    inner join would silently hide exactly the device you need to look at —
    the one that stopped reporting.
    """
    on = spec.get("on")
    if not on:
        raise ValueError("A join needs a column to join on")

    carry = [c for c in (spec.get("carry") or []) if c]
    rows_by_key: dict = {}
    order: list = []
    skipped = 0
    collisions = 0
    labels: list[str] = []

    for part in parts:
        label = part.get("as") or "value"
        result = part.get("result") or {}
        columns = list(result.get("columns") or [])

        # the value is whichever column the query produced last — `value` for
        # Prometheus, but a SQL query may call it anything
        value_column = part.get("value_column") or spec.get("value_column")
        if not value_column:
            value_column = next(
                (c for c in reversed(columns) if c not in (on, "time", "series")), None)

        if label in labels:
            label = f"{label} ({len(labels) + 1})"
        labels.append(label)

        seen_this_part = set()
        for row in result.get("rows") or []:
            key = row.get(on)
            if key in (None, ""):
                skipped += 1
                continue
            key = str(key)
            if key not in rows_by_key:
                rows_by_key[key] = {on: row.get(on)}
                order.append(key)
                for c in carry:
                    if c in row:
                        rows_by_key[key][c] = row.get(c)
            elif key in seen_this_part:
                # two series with the same key in one query — the first wins,
                # because overwriting would make the table depend on scrape order
                collisions += 1
                continue
            seen_this_part.add(key)
            for c in carry:
                rows_by_key[key].setdefault(c, row.get(c))
            rows_by_key[key][label] = row.get(value_column) if value_column else None

    rows = [rows_by_key[k] for k in order]
    for row in rows:                       # keep every row the same shape
        for label in labels:
            row.setdefault(label, None)

    out = {"columns": [on, *carry, *labels], "rows": rows}
    meta = {}
    if skipped:
        meta["rows_without_key"] = skipped
    if collisions:
        meta["duplicate_keys"] = collisions
    if meta:
        out["meta"] = meta
    return out


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

    # 1c. bucket counts — after filtering, before grouping, because it replaces
    # the rows entirely with a single summary row
    count_by = options.get("count_by")
    if count_by:
        rows, columns = apply_count_by(rows, columns, count_by)
        return {"columns": columns, "rows": rows}

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
