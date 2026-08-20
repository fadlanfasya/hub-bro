"""Prometheus connector.

config: {base_url, username?, password?, verify_ssl?}
  - base_url: e.g. http://localhost:9090, or https://10.1.6.62/prometheus when
    it sits behind a reverse proxy on a path prefix.
  - username/password: HTTP Basic auth. Prometheus has none of its own, so this
    is almost always an nginx/Apache front door answering 401. The password is
    stored encrypted.
  - verify_ssl: optional override; by default private hosts skip certificate
    verification and public ones do not (see tls.py).
options: {query, range?: {minutes, step}}
  - instant query by default (/api/v1/query)
  - if options.range is set, uses /api/v1/query_range over the last N minutes
"""
import time

import httpx

from ..config import settings
from .tls import verify_for


def auth_for(config: dict):
    """Basic-auth credentials, or None when the endpoint is open.

    A username on its own is still sent: some proxies accept an empty password,
    and a silent drop would look like the credentials were ignored.
    """
    username = (config.get("username") or "").strip()
    password = config.get("password") or ""
    if not username and not password:
        return None
    return (username, password)


def raise_for_auth(resp, config: dict) -> None:
    """Turn a proxy's 401/403 into an instruction instead of a status code.

    The reply usually comes from nginx, not Prometheus, so it is an HTML error
    page — raise_for_status would report "401 Unauthorized" and nothing else.
    """
    if resp.status_code not in (401, 403):
        return
    who = resp.headers.get("WWW-Authenticate", "")
    realm = f' (realm: {who.split("realm=", 1)[1].strip(chr(34))})' if "realm=" in who else ""
    if auth_for(config):
        raise ValueError(
            f"Prometheus rejected the username and password{realm}. "
            "Check them against the proxy's htpasswd file."
        )
    raise ValueError(
        f"Prometheus is behind a login{realm}. Edit this data source and fill in "
        "the username and password."
    )


async def fetch(config: dict, options: dict) -> dict:
    base_url = (config.get("base_url") or "").rstrip("/")
    query = options.get("query")
    if not base_url:
        raise ValueError("Prometheus datasource is missing base_url")
    if not query:
        # A multi-query widget should never reach this function — the router
        # splits it into one call per query first. If it does, the widget was
        # saved by a newer build than the one running, and saying so beats
        # sending someone hunting for a query they can see on their screen.
        if options.get("queries"):
            raise ValueError(
                f"This widget has {len(options['queries'])} queries to join, but this "
                "server doesn't know how to join them. Its build is older than the one "
                "that saved the widget — redeploy and it will work."
            )
        raise ValueError("Widget is missing a PromQL query")

    async with httpx.AsyncClient(timeout=settings.FETCH_TIMEOUT_SECONDS,
                                 verify=verify_for(base_url, config),
                                 auth=auth_for(config)) as client:
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
        raise_for_auth(resp, config)
        resp.raise_for_status()
        payload = resp.json()

    if payload.get("status") != "success":
        raise ValueError(f"Prometheus error: {payload.get('error', 'unknown')}")

    return flatten(payload["data"]["result"], options)


def label_string(labels: dict) -> str:
    """The old single-column rendering of a series' labels."""
    return ",".join(f"{k}={v}" for k, v in labels.items() if k != "__name__") or \
        labels.get("__name__", "value")


def flatten(result: list, options: dict | None = None) -> dict:
    """Prometheus series -> flat rows, with each label as its own column.

    A series carries its identity in labels — instance, job, sysName. Collapsing
    them into one "instance=10.1.6.20,job=f5" string made a chart legend read
    tidily and made everything else impossible: you cannot filter on a label,
    group by one, or join two queries on one. So labels become real columns and
    `series` stays alongside them, because existing widgets sort and colour by it.

    `__name__` becomes `metric`, which matters once several queries share a table.
    """
    options = options or {}
    value_field = options.get("value_field") or "value"

    rows: list[dict] = []
    label_names: list[str] = []

    for series in result:
        labels = dict(series.get("metric") or {})
        name = labels.pop("__name__", None)

        base = {"series": label_string({**labels, **({"__name__": name} if name else {})})}
        if name:
            base["metric"] = name
            if "metric" not in label_names:
                label_names.append("metric")
        for key, val in labels.items():
            base[key] = val
            if key not in label_names:
                label_names.append(key)

        points = series.get("values") or ([series["value"]] if "value" in series else [])
        for ts, val in points:
            # a stale or absent sample arrives as "NaN"; None keeps it out of
            # averages instead of being counted as a real zero
            try:
                number = float(val)
            except (TypeError, ValueError):
                number = None
            if number is not None and number != number:
                number = None
            rows.append({**base, "time": ts, value_field: number})

    columns = ["time", "series", *label_names, value_field]
    return {"columns": columns, "rows": rows}
