"""TrueWatch (Guance) connector — runs DQL/PromQL and flattens the result.

TrueWatch's Open API takes a batch of queries and answers with a nested
series structure rather than flat rows:

    content.data[0].series[0] = {
        "name":    "cpu",
        "columns": ["time", "usage_idle"],
        "values":  [[1743391592000, 97.4], [1743391652000, 96.8]],
        "tags":    {"host": "web-01"},
    }

Widgets want flat rows, so each value array is zipped against `columns` and
the series tags are merged in as extra columns. That turns a BY-grouped query
into exactly the shape line/bar charts and tables already expect.

Endpoint and auth confirmed against Guance's own Grafana data source plugin
(GuanceCloud/grafana-guance-datasource, src/plugin.json):

    POST {endpoint}/api/v1/df/query_data     header: DF-API-KEY
    GET  {endpoint}/api/v1/const/check_ping  health probe

config:
  endpoint         https://openapi.truewatch.com (default)
  api_key          workspace API key, stored encrypted
  workspace_uuids  optional, for cross-workspace queries
  verify_ssl       false for a private deployment with a self-signed cert

options:
  query            the DQL (or PromQL) statement
  qtype            "dql" (default) or "promql"
  range_minutes    look-back window, default 60
  interval         bucket size in seconds; omit to let TrueWatch choose
  max_points       cap on points per series, default 360
  limit            row cap for non-timeseries queries, default 1000
  time_field       name for the timestamp column, default "time"
"""
import json
import time

import httpx

from ..config import settings

DEFAULT_ENDPOINT = "https://openapi.truewatch.com"
QUERY_PATH = "/api/v1/df/query_data"
PING_PATH = "/api/v1/const/check_ping"

DEFAULT_RANGE_MINUTES = 60
DEFAULT_MAX_POINTS = 360
DEFAULT_LIMIT = 1000


def endpoint_of(config: dict) -> str:
    return (config.get("endpoint") or DEFAULT_ENDPOINT).rstrip("/")


def client(config: dict) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=settings.FETCH_TIMEOUT_SECONDS,
        verify=config.get("verify_ssl", True),
        follow_redirects=True,
    )


def headers_for(config: dict) -> dict:
    api_key = config.get("api_key") or ""
    if not api_key:
        raise ValueError(
            "No API key is set for this TrueWatch data source. Edit it and paste "
            "the workspace API key from Management -> API Key."
        )
    return {"DF-API-KEY": api_key, "Content-Type": "application/json"}


def build_body(options: dict, config: dict) -> dict:
    """Assemble the queries_body payload TrueWatch expects.

    The whole query set is sent as a JSON *string* under `queries_body` — that
    is what the API wants, not a nested JSON object.
    """
    query = (options.get("query") or "").strip()
    if not query:
        raise ValueError("Widget is missing a DQL query")

    end_ms = int(time.time() * 1000)
    minutes = int(options.get("range_minutes") or DEFAULT_RANGE_MINUTES)
    start_ms = end_ms - minutes * 60 * 1000

    inner: dict = {
        "q": query,
        "timeRange": [start_ms, end_ms],
        "maxPointCount": int(options.get("max_points") or DEFAULT_MAX_POINTS),
        "limit": int(options.get("limit") or DEFAULT_LIMIT),
    }
    if options.get("interval"):
        inner["interval"] = int(options["interval"])

    uuids = config.get("workspace_uuids")
    if uuids:
        inner["workspaceUUIDs"] = (
            uuids if isinstance(uuids, list) else
            [u.strip() for u in str(uuids).split(",") if u.strip()]
        )

    return {
        "queries_body": json.dumps({
            "queries": [{
                "qtype": (options.get("qtype") or "dql").lower(),
                "query": inner,
            }],
        })
    }


def flatten(payload: dict, time_field: str = "time") -> dict:
    """Turn TrueWatch's nested series into flat rows.

    Column order is preserved from the first series and later series may
    contribute extra tag columns, so a BY-grouped query lands as one tidy
    table rather than one table per group.
    """
    content = (payload or {}).get("content") or {}
    results = content.get("data") or []
    if isinstance(results, dict):
        results = [results]

    columns: list[str] = []
    rows: list[dict] = []

    def add_column(name: str):
        if name not in columns:
            columns.append(name)

    for result in results:
        for series in (result or {}).get("series") or []:
            names = list(series.get("columns") or [])
            # tags carry the BY-grouping (host, service, …)
            tags = dict(series.get("tags") or series.get("labels") or {})
            for tag in tags:
                add_column(tag)
            for name in names:
                add_column(time_field if name == "time" else name)

            for value_row in series.get("values") or []:
                row = dict(tags)
                for i, name in enumerate(names):
                    if i >= len(value_row):
                        break
                    key = time_field if name == "time" else name
                    row[key] = value_row[i]
                rows.append(row)

    return {"columns": columns, "rows": rows}


def raise_for_payload(payload: dict):
    """TrueWatch reports query errors in the body with HTTP 200."""
    if not isinstance(payload, dict):
        raise ValueError("TrueWatch returned an unexpected response")
    code = payload.get("errorCode") or payload.get("error_code")
    if code:
        message = payload.get("message") or payload.get("errorMessage") or code
        raise ValueError(f"TrueWatch query failed ({code}): {message}")


async def fetch(config: dict, options: dict) -> dict:
    url = endpoint_of(config) + QUERY_PATH
    body = build_body(options, config)

    async with client(config) as http:
        resp = await http.post(url, json=body, headers=headers_for(config))

    if resp.status_code >= 400:
        raise ValueError(
            f"TrueWatch request failed ({resp.status_code}): {resp.text[:200]}"
        )

    payload = resp.json()
    raise_for_payload(payload)

    result = flatten(payload, options.get("time_field") or "time")

    content = payload.get("content") or {}
    data = content.get("data") or []
    first = data[0] if isinstance(data, list) and data else {}
    total = first.get("total_hits") if isinstance(first, dict) else None
    fetched = len(result["rows"])
    result["meta"] = {
        "fetched": fetched,
        "total": total if isinstance(total, int) and total > 0 else fetched,
        "partial": bool(isinstance(total, int) and total > fetched),
        "cost": first.get("cost") if isinstance(first, dict) else None,
    }
    return result
