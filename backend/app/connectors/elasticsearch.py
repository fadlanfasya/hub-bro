"""Elasticsearch connector using the native HTTP API.

config: {base_url, index, username?, password?, api_key?, token?, headers?}
  - base_url: cluster URL, without ``/_search``
  - index: index, alias, data stream, or wildcard pattern
  - username/password: HTTP Basic authentication
  - api_key: value for ``Authorization: ApiKey ...``
  - token: value for ``Authorization: Bearer ...``

options: {query, max_rows?, time_field?, range?}
  - query: Elasticsearch search body as a dict or JSON string
  - max_rows: maximum hits to return, capped at 10,000; fetched in 1,000-row pages

Search hits expose ``_source`` fields plus ``_id``, ``_index`` and ``_score``.
When the response contains aggregations, bucket aggregations are flattened into
rows so they can feed a chart or table directly.
"""
import json
import math
import re
from urllib.parse import quote

import httpx

from ..config import settings
from .tls import verify_for

DEFAULT_LIMIT = 5000
MAX_LIMIT = 10000
PAGE_SIZE = 1000
MAX_RANGE_MINUTES = 525600
FIELD_NAME = re.compile(r"^[A-Za-z0-9_@.-]+$")


def flatten_value(value):
    """Make a JSON value suitable for one table cell."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, list):
        if not value:
            return None
        if all(isinstance(item, (str, int, float)) and not isinstance(item, bool)
               for item in value):
            return ", ".join(str(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def flatten_record(record: dict) -> dict:
    """Flatten nested objects using dotted field names."""
    output = {}

    def visit(prefix, value):
        if isinstance(value, dict):
            for key, child in value.items():
                visit(f"{prefix}.{key}" if prefix else str(key), child)
        else:
            output[prefix] = flatten_value(value)

    visit("", record)
    return output


def normalize_hits(hits: list) -> dict:
    columns = []
    rows = []
    for hit in hits or []:
        source = flatten_record(hit.get("_source") or {})
        row = {
            "_id": hit.get("_id"),
            "_index": hit.get("_index"),
            "_score": hit.get("_score"),
            **source,
        }
        for column in row:
            if column not in columns:
                columns.append(column)
        rows.append(row)
    return {"columns": columns, "rows": rows}


def _bucket_rows(value, prefix="") -> list[dict]:
    """Flatten common terms/date histogram aggregations into rows."""
    if not isinstance(value, dict):
        return []
    buckets = value.get("buckets")
    if isinstance(buckets, dict):
        buckets = [{"key": key, **bucket} for key, bucket in buckets.items()]
    if not isinstance(buckets, list):
        return []

    rows = []
    for bucket in buckets:
        if not isinstance(bucket, dict):
            continue
        row = {}
        key = bucket.get("key_as_string", bucket.get("key"))
        if prefix:
            row[prefix] = key
        elif key is not None:
            row["key"] = key
        for name, child in bucket.items():
            if name in {"key", "key_as_string", "doc_count"}:
                continue
            if isinstance(child, dict) and "value" in child:
                row[name] = child.get("value")
            elif isinstance(child, dict) and "buckets" in child:
                nested = _bucket_rows(child, name)
                if nested:
                    for nested_row in nested:
                        rows.append({**row, **nested_row, "doc_count": bucket.get("doc_count")})
            elif not isinstance(child, dict):
                row[name] = flatten_value(child)
        if bucket.get("doc_count") is not None:
            row.setdefault("doc_count", bucket["doc_count"])
        rows.append(row)
    return rows


def normalize(payload: dict) -> dict:
    aggregations = payload.get("aggregations") or {}
    for name, value in aggregations.items():
        rows = _bucket_rows(value, name)
        if rows:
            columns = []
            for row in rows:
                for column in row:
                    if column not in columns:
                        columns.append(column)
            return {"columns": columns, "rows": rows,
                    "meta": {"total": payload.get("hits", {}).get("total")}}

    hits = payload.get("hits") or {}
    result = normalize_hits(hits.get("hits") or [])
    total = hits.get("total")
    if isinstance(total, dict):
        total = total.get("value")
    result["meta"] = {"total": total} if total is not None else {}
    return result


def _auth(config: dict):
    username = (config.get("username") or "").strip()
    password = config.get("password") or ""
    if username or password:
        return (username, password)
    return None


def _headers(config: dict) -> dict:
    headers = dict(config.get("headers") or {})
    if config.get("api_key"):
        headers["Authorization"] = f"ApiKey {config['api_key']}"
    elif config.get("token"):
        headers["Authorization"] = f"Bearer {config['token']}"
    headers.setdefault("Content-Type", "application/json")
    return headers


def _add_time_range(body: dict, time_field: str | None, window: dict | None) -> dict:
    if not time_field or not window:
        return body
    if not FIELD_NAME.fullmatch(time_field):
        raise ValueError("Elasticsearch time field contains invalid characters")
    try:
        minutes = float(window.get("minutes"))
    except (AttributeError, TypeError, ValueError):
        raise ValueError("Elasticsearch time range must contain numeric minutes")
    if not math.isfinite(minutes) or minutes <= 0:
        raise ValueError("Elasticsearch time range minutes must be greater than zero")
    minutes = min(minutes, MAX_RANGE_MINUTES)
    value = str(int(minutes)) if minutes.is_integer() else str(minutes)
    time_filter = {"range": {time_field: {"gte": f"now-{value}m", "lte": "now"}}}
    existing = body.get("query") or {"match_all": {}}
    if isinstance(existing, dict) and isinstance(existing.get("bool"), dict):
        query = dict(existing)
        boolean = dict(existing["bool"])
        filters = boolean.get("filter") or []
        boolean["filter"] = [*filters] if isinstance(filters, list) else [filters]
        boolean["filter"].append(time_filter)
        query["bool"] = boolean
        body["query"] = query
    else:
        body["query"] = {"bool": {"must": [existing], "filter": [time_filter]}}
    return body


def _body(options: dict, limit: int) -> dict:
    raw = options.get("query")
    if raw in (None, ""):
        body = {"query": {"match_all": {}}}
    elif isinstance(raw, dict):
        body = dict(raw)
        if not any(key in body for key in ("query", "aggs", "aggregations", "size", "sort")):
            body = {"query": body}
    elif isinstance(raw, str):
        try:
            body = json.loads(raw)
        except ValueError as exc:
            raise ValueError(f"Elasticsearch query is not valid JSON: {exc}")
    else:
        raise ValueError("Elasticsearch query must be a JSON object")
    if not isinstance(body, dict):
        raise ValueError("Elasticsearch query must be a JSON object")
    body = _add_time_range(body, options.get("time_field"), options.get("range"))
    if "aggregations" in body or "aggs" in body:
        try:
            body["size"] = min(max(0, int(body.get("size", 0))), limit)
        except (TypeError, ValueError):
            body["size"] = 0
    else:
        try:
            page_size = int(body.get("size", limit))
        except (TypeError, ValueError):
            page_size = limit
        body["size"] = min(max(1, page_size), limit, PAGE_SIZE)
        # Gives search_after a deterministic sort even when the user only
        # supplied a query. An explicit sort from the DSL still wins.
        body.setdefault("sort", ["_shard_doc"])
    return body


async def fetch(config: dict, options: dict) -> dict:
    base_url = (config.get("base_url") or "").rstrip("/")
    index = (config.get("index") or "").strip()
    if not base_url:
        raise ValueError("Elasticsearch datasource is missing base_url")
    if not index:
        raise ValueError("Elasticsearch datasource is missing index")

    try:
        requested = int(options.get("max_rows") or DEFAULT_LIMIT)
    except (TypeError, ValueError):
        requested = DEFAULT_LIMIT
    limit = min(max(1, requested), MAX_LIMIT)
    body = _body(options, limit)
    encoded_index = quote(index, safe="*,-_.")
    url = f"{base_url}/{encoded_index}/_search"

    async with httpx.AsyncClient(timeout=settings.FETCH_TIMEOUT_SECONDS,
                                 follow_redirects=True,
                                 verify=verify_for(base_url, config),
                                 auth=_auth(config)) as client:
        all_hits = []
        payload = None
        pages = 0
        while len(all_hits) < limit:
            response = await client.post(url, headers=_headers(config), json=body)
            if response.status_code in (401, 403):
                raise ValueError("Elasticsearch rejected the credentials or permissions")
            response.raise_for_status()
            page = response.json()
            if not isinstance(page, dict):
                raise ValueError("Elasticsearch returned an invalid response")
            payload = page
            pages += 1
            hits = (page.get("hits") or {}).get("hits") or []
            all_hits.extend(hits)
            if page.get("aggregations") or len(hits) < body["size"] or not hits:
                break
            sort_values = hits[-1].get("sort")
            if not sort_values:
                break
            body["search_after"] = sort_values
    if payload is None:
        return {"columns": [], "rows": []}
    if not payload.get("aggregations"):
        payload["hits"] = {**(payload.get("hits") or {}), "hits": all_hits[:limit]}
    result = normalize(payload)
    hits_total = (payload.get("hits") or {}).get("total")
    if isinstance(hits_total, dict):
        hits_total = hits_total.get("value")
    fetched = len(result.get("rows") or [])
    result.setdefault("meta", {}).update({
        "fetched": fetched,
        "pages": pages,
        "limit": limit,
    })
    if payload.get("aggregations"):
        result["meta"]["partial"] = False
    elif hits_total is not None:
        result["meta"].update({
            "total": hits_total,
            "partial": hits_total > fetched,
        })
    return result
