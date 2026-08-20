import json
import logging
import time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import access, cache, health
from ..auth import get_current_user
from ..connectors import fetch_data
from ..database import get_db
from ..models import Dashboard, DataSource, User
from ..permissions import require_dashboard_edit
from ..schemas import DataFetchRequest
from ..transforms import apply_transforms, join_results

router = APIRouter(prefix="/api/data", tags=["data"])

# Options consumed by the transform layer rather than by a connector. They must
# not vary the cache key, so one upstream fetch can serve widgets that show
# different views of the same data.
TRANSFORM_KEYS = {
    "unpivot", "filters", "cross_filters", "group_by", "aggregate", "value_column",
    "sort", "limit", "date_diff", "count_by",
}

# A widget holding these runs several queries and joins the answers into one
# table — see _run_joined.
MULTI_QUERY_KEYS = {"queries", "join"}

# Connectors that can filter server-side. For these, `filters` is sent to the
# connector (and so does affect the cache key, correctly — it's a different query).
PUSHDOWN_TYPES = {"glpi", "sql"}


def _split_options(ds_type: str, options: dict) -> tuple[dict, dict]:
    transform_keys = set(TRANSFORM_KEYS)
    if ds_type in PUSHDOWN_TYPES:
        transform_keys.discard("filters")
    fetch_options = {k: v for k, v in options.items() if k not in transform_keys}
    transform_options = {k: v for k, v in options.items() if k in transform_keys}
    return fetch_options, transform_options


async def _load(ds, fetch_options: dict, db: Session | None = None) -> dict:
    key = cache.make_key(ds.id, fetch_options)
    result = cache.get(key)
    if result is not None:
        return result   # a cache hit says nothing about the source's health

    lock = await cache.lock_for(key)
    async with lock:
        result = cache.get(key)  # another request may have filled it while we waited
        if result is None:
            started = time.perf_counter()
            try:
                result = await fetch_data(ds, fetch_options)
            except Exception as e:
                _record_health(db, ds.id, False, str(e), started)
                raise HTTPException(status_code=502, detail=f"Failed to fetch data: {e}")
            _record_health(db, ds.id, True, None, started)
            cache.set(key, result)
    return result


def _record_health(db, datasource_id: int, ok: bool, error: str | None, started: float):
    """Feed the outcome of a real fetch into the health page.

    Never let health bookkeeping break a working request — a failure to write
    the row is logged and ignored.
    """
    if db is None:
        return
    try:
        health.record(db, datasource_id, ok, error,
                      int((time.perf_counter() - started) * 1000), source="fetch")
    except Exception as e:
        logging.getLogger("uvicorn.error").debug("Could not record health: %s", e)


async def _run_joined(ds, options: dict, db: Session | None = None):
    """Run several queries against one source and join them into one table.

    Each sub-query is fetched and cached independently, so a CPU query shared
    by three widgets is fetched once. Only the join happens per widget.
    """
    queries = [q for q in (options.get("queries") or []) if q.get("query")]
    if not queries:
        raise HTTPException(status_code=400,
                            detail="This widget has no queries to run")

    # shaping (filters, sort, limit) belongs to the joined table, not to each
    # query — sorting the parts separately then joining them would be wasted
    # work at best and misleading at worst
    fetch_base, transform_options = _split_options(ds.type, options)
    fetch_base = {k: v for k, v in fetch_base.items() if k not in ("queries", "join")}

    parts = []
    for i, q in enumerate(queries):
        sub = dict(fetch_base)
        sub.update({k: v for k, v in q.items() if k not in ("as", "value_column")})
        parts.append({
            "as": q.get("as") or f"Query {i + 1}",
            "value_column": q.get("value_column"),
            "result": await _load(ds, sub, db),
        })

    joined = join_results(parts, options.get("join") or {})
    meta = dict(joined.pop("meta", {}) or {})
    meta["queries"] = len(parts)

    if transform_options:
        joined = apply_transforms(joined, transform_options)
    joined["meta"] = meta
    return joined


async def _run(ds, options: dict, db: Session | None = None):
    """Fetch, transform, and assemble the response for one query."""
    fetch_options, transform_options = _split_options(ds.type, options)
    result = await _load(ds, fetch_options, db)

    meta = dict(result.get("meta") or {})
    unpushed = result.get("_unpushed_filters")
    if unpushed:
        transform_options = dict(transform_options, filters=unpushed)
        meta["client_side_filters"] = len(unpushed)

    if transform_options:
        rows_before = len(result.get("rows") or [])
        result = apply_transforms(result, transform_options)
        if len(result["rows"]) != rows_before:
            meta["rows_after_transform"] = len(result["rows"])

    result = {k: v for k, v in result.items() if not k.startswith("_")}
    if meta:
        result["meta"] = meta
    return result


async def _dispatch(ds, options: dict, db: Session | None = None):
    """One query or several, decided by the widget's own options."""
    if options.get("queries"):
        return await _run_joined(ds, options, db)
    return await _run(ds, options, db)


@router.post("/dashboards/{dashboard_id}/widgets/{widget_id}")
async def fetch_for_widget(dashboard_id: int, widget_id: str,
                           user: User = Depends(get_current_user),
                           db: Session = Depends(get_db)):
    """Fetch the data for one saved widget.

    Query options come from the stored dashboard, never from the request, so a
    viewer can read what a dashboard shows without being able to run arbitrary
    queries (an important difference for SQL sources).

    Access is granted by the *dashboard*, not by the data source — someone
    invited here reads these numbers without gaining any access to the source
    behind them. That read-through is what makes sharing usable; see access.py.
    """
    dashboard = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    if not access.can_view_dashboard(db, user, dashboard):
        raise HTTPException(status_code=404, detail="Dashboard not found")

    definition = json.loads(dashboard.definition)
    widget = next((w for w in definition.get("widgets", [])
                   if str(w.get("id")) == str(widget_id)), None)
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found on this dashboard")

    ds = db.query(DataSource).filter(DataSource.id == widget.get("datasource_id")).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")

    return await _dispatch(ds, widget.get("options") or {}, db)


@router.post("/fetch")
async def fetch(payload: DataFetchRequest,
                user: User = Depends(require_dashboard_edit),
                db: Session = Depends(get_db)):
    """Run an ad-hoc query while building a widget.

    Restricted to editors and admins: the caller chooses the options, which for
    a SQL source means choosing the statement.

    Unlike the widget route above, this requires access to the *source itself*.
    Being shown a dashboard does not let you point its source at a different
    table — that is the line between reading a report and holding a database
    connection.
    """
    ds = db.query(DataSource).filter(DataSource.id == payload.datasource_id).first()
    if not ds or not access.can_use_datasource(db, user, ds):
        raise HTTPException(status_code=404, detail="Data source not found")

    return await _dispatch(ds, payload.options or {}, db)


@router.post("/invalidate/{datasource_id}")
def invalidate(datasource_id: int, _: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    """Drop cached responses for a source — used by the manual Refresh button.

    Any signed-in user may do this, deliberately: it only discards cached
    copies and returns nothing, so it reveals no data. A viewer watching a
    dashboard built on a private source still needs to force a refresh, and
    gating this on source access would break that for no security gain.
    """
    ds = db.query(DataSource).filter(DataSource.id == datasource_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")
    cache.invalidate_datasource(datasource_id)
    return {"ok": True}
