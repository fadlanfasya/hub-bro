"""Data source health: is each source reachable, and how fast?

Two sources of truth, combined:

  * passive — every real widget fetch records its outcome. Free, but a source
    nobody queried today stays "unknown".
  * active  — sources with `monitor: true` in their config get probed on a
    timer. Costs one cheap query per interval, so it's opt-in per source.

A probe is deliberately the cheapest thing that proves the connection works:
`SELECT 1` for SQL (Postgres, Doris, MySQL, SQLite alike), initSession for
GLPI, a trivial query for Prometheus. It should never pull real data.
"""
import asyncio
import logging
import os
import time
from datetime import datetime, timedelta

import httpx
from sqlalchemy.orm import Session

from .config import settings
from .models import DataSource, DataSourceCheck

log = logging.getLogger("uvicorn.error")

# keep the most recent checks per source, enough for a response-time trend
MAX_CHECKS_PER_SOURCE = 50

# don't write a row for every fetch; a busy dashboard would insert hundreds a
# minute. Record when the status changes, or once per this interval.
RECORD_INTERVAL_SECONDS = 60

# a source with no successful check for this long is "stale" rather than "ok"
STALE_AFTER_SECONDS = 15 * 60


async def _probe_sql(config: dict) -> None:
    from .connectors.sql_db import build_url, _run
    url = build_url(config)
    # one row, no table access — works on Postgres, Doris, MySQL and SQLite
    await asyncio.to_thread(_run, url, "SELECT 1", {}, 1)


async def _probe_rest(config: dict) -> None:
    url = config.get("url")
    if not url:
        raise ValueError("No URL configured")
    async with httpx.AsyncClient(timeout=min(settings.FETCH_TIMEOUT_SECONDS, 15),
                                 verify=config.get("verify_ssl", True),
                                 follow_redirects=True) as client:
        resp = await client.get(url, headers=config.get("headers") or {})
        resp.raise_for_status()


async def _probe_prometheus(config: dict) -> None:
    base = (config.get("base_url") or "").rstrip("/")
    if not base:
        raise ValueError("No base_url configured")
    async with httpx.AsyncClient(timeout=min(settings.FETCH_TIMEOUT_SECONDS, 15)) as client:
        resp = await client.get(f"{base}/api/v1/query", params={"query": "1"})
        resp.raise_for_status()
        if resp.json().get("status") != "success":
            raise ValueError("Prometheus rejected the probe query")


async def _probe_glpi(config: dict) -> None:
    from .connectors.glpi import _init_session
    # opening a session proves the URL, App-Token and user token are all valid,
    # which is what actually breaks in practice
    await _init_session(config)


async def _probe_csv(config: dict) -> None:
    path = config.get("file_path")
    if not path or not os.path.exists(path):
        raise ValueError("Uploaded file is missing from disk")


PROBES = {
    "sql": _probe_sql,
    "rest": _probe_rest,
    "prometheus": _probe_prometheus,
    "glpi": _probe_glpi,
    "csv": _probe_csv,
}


async def probe(ds: DataSource) -> tuple[bool, str | None, int]:
    """Check one source. Returns (ok, error message, duration in ms)."""
    fn = PROBES.get(ds.type)
    if not fn:
        return False, f"No health check for source type '{ds.type}'", 0

    started = time.perf_counter()
    try:
        await fn(ds.config_dict)
        return True, None, int((time.perf_counter() - started) * 1000)
    except Exception as e:
        message = str(e).strip() or e.__class__.__name__
        return False, message[:500], int((time.perf_counter() - started) * 1000)


def record(db: Session, datasource_id: int, ok: bool, error: str | None,
           duration_ms: int, source: str = "fetch", force: bool = False) -> None:
    """Store a check result, skipping repeats so the table stays small."""
    latest = (db.query(DataSourceCheck)
              .filter(DataSourceCheck.datasource_id == datasource_id)
              .order_by(DataSourceCheck.id.desc()).first())

    if latest and not force:
        unchanged = latest.ok == ok
        recent = latest.checked_at and \
            (datetime.utcnow() - latest.checked_at).total_seconds() < RECORD_INTERVAL_SECONDS
        if unchanged and recent:
            return   # nothing new to say

    db.add(DataSourceCheck(
        datasource_id=datasource_id, ok=ok, error=error,
        duration_ms=duration_ms, source=source,
    ))

    stale = (db.query(DataSourceCheck)
             .filter(DataSourceCheck.datasource_id == datasource_id)
             .order_by(DataSourceCheck.id.desc())
             .offset(MAX_CHECKS_PER_SOURCE).all())
    for old in stale:
        db.delete(old)
    db.commit()


def status_for(db: Session, datasource_id: int) -> dict:
    """Current health of one source, derived from its recent checks."""
    checks = (db.query(DataSourceCheck)
              .filter(DataSourceCheck.datasource_id == datasource_id)
              .order_by(DataSourceCheck.id.desc())
              .limit(MAX_CHECKS_PER_SOURCE).all())

    if not checks:
        return {"status": "unknown", "last_ok_at": None, "last_error": None,
                "last_error_at": None, "duration_ms": None, "avg_duration_ms": None,
                "checked_at": None, "recent": []}

    latest = checks[0]
    last_ok = next((c for c in checks if c.ok), None)
    last_fail = next((c for c in checks if not c.ok), None)

    if not latest.ok:
        status = "failing"
    elif last_ok.checked_at and \
            (datetime.utcnow() - last_ok.checked_at).total_seconds() > STALE_AFTER_SECONDS:
        # succeeded, but long enough ago that we can't claim it's healthy now
        status = "stale"
    else:
        status = "ok"

    ok_durations = [c.duration_ms for c in checks if c.ok and c.duration_ms is not None]

    return {
        "status": status,
        "checked_at": latest.checked_at,
        "duration_ms": latest.duration_ms,
        "avg_duration_ms": round(sum(ok_durations) / len(ok_durations)) if ok_durations else None,
        "last_ok_at": last_ok.checked_at if last_ok else None,
        "last_error": last_fail.error if last_fail else None,
        "last_error_at": last_fail.checked_at if last_fail else None,
        # oldest first, for a sparkline
        "recent": [{"ok": c.ok, "duration_ms": c.duration_ms, "at": c.checked_at}
                   for c in reversed(checks[:20])],
    }


async def monitor_loop(session_factory, interval: int):
    """Probe sources that opted into monitoring, forever.

    Only sources with `monitor: true` in their config are checked, so enabling
    this doesn't start hammering every database you've ever connected.
    """
    log.info("Data source monitoring every %ss (sources with monitor enabled)", interval)
    while True:
        try:
            await asyncio.sleep(interval)
            db = session_factory()
            try:
                sources = db.query(DataSource).all()
                watched = [s for s in sources if s.raw_config_dict.get("monitor")]
                for ds in watched:
                    ok, error, duration = await probe(ds)
                    record(db, ds.id, ok, error, duration, source="monitor")
                    if not ok:
                        log.warning("Data source '%s' is failing: %s", ds.name, error)
            finally:
                db.close()
        except asyncio.CancelledError:
            raise
        except Exception as e:      # a monitor crash must not take the app down
            log.warning("Health monitor iteration failed: %s", e)


def dependents(db: Session) -> dict[int, list[dict]]:
    """Which dashboards use which source, so you can see the blast radius."""
    import json
    from .models import Dashboard

    out: dict[int, list[dict]] = {}
    for d in db.query(Dashboard).all():
        try:
            widgets = json.loads(d.definition).get("widgets", [])
        except (ValueError, AttributeError):
            continue
        counts: dict[int, int] = {}
        for w in widgets:
            ds_id = w.get("datasource_id")
            if ds_id:
                counts[ds_id] = counts.get(ds_id, 0) + 1
        for ds_id, count in counts.items():
            out.setdefault(ds_id, []).append(
                {"dashboard_id": d.id, "name": d.name, "widget_count": count})
    return out
