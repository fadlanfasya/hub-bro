"""Prometheus connector.

config: {base_url}  e.g. http://localhost:9090
options: {query, range?: {minutes, step}}
  - instant query by default (/api/v1/query)
  - if options.range is set, uses /api/v1/query_range over the last N minutes
"""
import time

import httpx

from ..config import settings


async def fetch(config: dict, options: dict) -> dict:
    base_url = (config.get("base_url") or "").rstrip("/")
    query = options.get("query")
    if not base_url:
        raise ValueError("Prometheus datasource is missing base_url")
    if not query:
        raise ValueError("Widget is missing a PromQL query")

    async with httpx.AsyncClient(timeout=settings.FETCH_TIMEOUT_SECONDS) as client:
        rng = options.get("range")
        if rng:
            end = time.time()
            start = end - int(rng.get("minutes", 60)) * 60
            resp = await client.get(f"{base_url}/api/v1/query_range", params={
                "query": query, "start": start, "end": end,
                "step": rng.get("step", "60s"),
            })
        else:
            resp = await client.get(f"{base_url}/api/v1/query", params={"query": query})
        resp.raise_for_status()
        payload = resp.json()

    if payload.get("status") != "success":
        raise ValueError(f"Prometheus error: {payload.get('error', 'unknown')}")

    result = payload["data"]["result"]
    rows = []
    for series in result:
        labels = series.get("metric", {})
        label_str = ",".join(f"{k}={v}" for k, v in labels.items() if k != "__name__") or \
            labels.get("__name__", "value")
        if "values" in series:  # range query
            for ts, val in series["values"]:
                rows.append({"time": ts, "series": label_str, "value": float(val)})
        elif "value" in series:  # instant query
            ts, val = series["value"]
            rows.append({"time": ts, "series": label_str, "value": float(val)})
    return {"columns": ["time", "series", "value"], "rows": rows}
