"""Post-fetch data shaping, applied to every connector's {columns, rows} result.

Widget options understood here:
  unpivot:  {"columns": ["sukses", "gagal"], "name": "status", "value": "total"}
            turns one wide row into one row per column — see apply_unpivot
  filters:  [{"column": "Status", "op": "eq", "value": "Running"}]
            ops: eq, ne, contains, gt, gte, lt, lte, in, not_empty
  group_by: "Status"                     -> one row per distinct value
  aggregate: "count" | "sum" | "avg" | "min" | "max"
  value_column: column to aggregate when aggregate != count
  sort:     {"column": "count", "dir": "desc"}
  limit:    50

Order matters: unpivot runs first (it reshapes the table), then filters,
then grouping, then sorting and the limit.
"""
from typing import Any


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

    # 1. filter
    filters = [f for f in (options.get("filters") or []) if f.get("column")]
    for f in filters:
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
        # numeric sort when the whole column is numeric, else string sort
        numeric = all(_num(r.get(sort_col)) is not None for r in rows) if rows else False
        rows.sort(
            key=lambda r: _num(r.get(sort_col)) if numeric else str(r.get(sort_col) or "").lower(),
            reverse=reverse,
        )

    # 4. limit
    limit = options.get("limit")
    if limit:
        try:
            rows = rows[: int(limit)]
        except (TypeError, ValueError):
            pass

    return {"columns": columns, "rows": rows}
