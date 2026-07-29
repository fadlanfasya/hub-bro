"""REST API connector.

config: {url, method?, headers?, body?, verify_ssl?}
options: {data_path?, rename?}
  - data_path: dot-path to the array of records, e.g. "data.items". Empty = root.
  - rename: {"old_key": "New label"} applied to columns after normalization.
"""
import httpx

from ..config import settings


def _resolve_path(data, path: str):
    if not path:
        return data
    for key in path.split("."):
        if isinstance(data, dict):
            data = data.get(key)
        elif isinstance(data, list) and key.isdigit():
            data = data[int(key)]
        else:
            return None
    return data


def normalize(records) -> dict:
    """Turn arbitrary JSON into {columns, rows}."""
    if records is None:
        return {"columns": [], "rows": []}
    if isinstance(records, dict):
        # single object -> one row
        records = [records]
    if not isinstance(records, list):
        return {"columns": ["value"], "rows": [{"value": records}]}

    rows = []
    columns: list[str] = []
    for item in records:
        if isinstance(item, dict):
            flat = {k: (v if isinstance(v, (str, int, float, bool)) or v is None else str(v))
                    for k, v in item.items()}
        else:
            flat = {"value": item}
        for k in flat:
            if k not in columns:
                columns.append(k)
        rows.append(flat)
    return {"columns": columns, "rows": rows}


async def fetch(config: dict, options: dict) -> dict:
    url = config.get("url")
    if not url:
        raise ValueError("REST datasource is missing a URL")
    method = (config.get("method") or "GET").upper()
    headers = config.get("headers") or {}

    verify = config.get("verify_ssl", True)

    async with httpx.AsyncClient(timeout=settings.FETCH_TIMEOUT_SECONDS,
                                 follow_redirects=True, verify=verify) as client:
        resp = await client.request(method, url, headers=headers, json=config.get("body"))
        resp.raise_for_status()
        data = resp.json()

    records = _resolve_path(data, options.get("data_path", ""))
    result = normalize(records)

    rename = options.get("rename") or {}
    if rename:
        result["columns"] = [rename.get(c, c) for c in result["columns"]]
        result["rows"] = [{rename.get(k, k): v for k, v in row.items()} for row in result["rows"]]
    return result
