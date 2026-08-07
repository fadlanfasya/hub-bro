"""GLPI connector — handles the session-token dance, pagination and filter pushdown.

GLPI's REST API requires:
  1. GET {base_url}/initSession  with  App-Token + Authorization: user_token <token>
     -> returns {"session_token": "..."}
  2. every data request carries  App-Token + Session-Token
  3. sessions idle out, so we cache and transparently re-open them

config:
  base_url    e.g. http://10.1.6.51/glpi/apirest.php
  app_token   the API client's App-Token
  user_token  a user's API token (Preferences -> Remote access keys)
  verify_ssl  false for self-signed certificates

options:
  itemtype    e.g. "Computer" (default), "Ticket", "Monitor"
  mode        "search" (default) or "list"
  max_rows    stop after this many rows (default 1000). GLPI caps a single
              response at ~1000 anyway, so we page until we have everything.
  page_size   rows per request (default 200)
  criteria    raw GLPI criteria, passed through untouched
  filters     widget filters; simple ones are translated into GLPI criteria so
              the server does the filtering (see FILTER_PUSHDOWN below)
"""
import asyncio
import time

import httpx

from ..config import settings
from .rest_api import normalize

# session_token cache: {(base_url, app_token, user_token): (token, created_at)}
_sessions: dict[tuple, tuple[str, float]] = {}
_session_lock = asyncio.Lock()
SESSION_TTL = 60 * 20

# search-option maps: {(base_url, itemtype): {column_name: field_id}}
_search_options: dict[tuple, dict[str, str]] = {}

DEFAULT_PAGE_SIZE = 200
DEFAULT_MAX_ROWS = 1000

# widget filter op -> GLPI searchtype. Ops missing here can't be pushed down
# and are left to the transform layer to apply client-side.
FILTER_PUSHDOWN = {
    "eq": "equals",
    "ne": "notequals",
    "contains": "contains",
    "gt": "morethan",
    "lt": "lessthan",
}


def _client(config: dict) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        timeout=settings.FETCH_TIMEOUT_SECONDS,
        verify=config.get("verify_ssl", True),
        follow_redirects=True,
    )


def _use_query_tokens(config: dict) -> bool:
    """Send credentials in the query string instead of headers.

    Some GLPI deployments sit behind a web server that does not pass custom or
    Authorization headers through to PHP, so GLPI never sees the credentials and
    reports the session as missing. Query parameters always arrive.

    Off by default: a token in a URL ends up in the web server's access log,
    which is a real cost. Only worth paying when headers demonstrably don't work.
    """
    return bool(config.get("tokens_in_query"))


async def _init_session(config: dict) -> str:
    # Trim: a token pasted with a trailing newline is otherwise rejected by the
    # HTTP layer as an illegal header value, long before GLPI ever sees it.
    base_url = (config.get("base_url") or "").strip().rstrip("/")
    app_token = (config.get("app_token") or "").strip()
    user_token = (config.get("user_token") or "").strip()
    if not base_url:
        raise ValueError("GLPI data source is missing base_url")
    if not user_token:
        raise ValueError("GLPI data source is missing user_token")

    # No Content-Type: these requests carry no body. Declaring JSON on an empty
    # body invites the server to look for parameters there and find none.
    if _use_query_tokens(config):
        params = {"app_token": app_token, "user_token": user_token}
        headers = {}
    else:
        params = None
        headers = {
            "App-Token": app_token,
            "Authorization": f"user_token {user_token}",
        }

    # POST first, GET as a fallback.
    #
    # GLPI documents initSession as a GET, but on some instances a GET is routed
    # to the generic "get items of type X" handler, which demands a session
    # token — producing ERROR_SESSION_TOKEN_MISSING on the one endpoint that
    # needs no session. POST hits the login route reliably; older instances that
    # only accept GET still work through the fallback.
    async with _client(config) as client:
        resp = await client.post(f"{base_url}/initSession", params=params, headers=headers)
        if resp.status_code >= 400:
            fallback = await client.get(f"{base_url}/initSession",
                                        params=params, headers=headers)
            if fallback.status_code < 400:
                resp = fallback
        if resp.status_code >= 400:
            detail = resp.text[:200]
            # initSession is the one endpoint that needs no session token, so
            # being asked for one means GLPI never routed the request there.
            # Almost always the URL or the web server, not the credentials.
            if "SESSION_TOKEN" in detail.upper():
                raise ValueError(
                    f"GLPI did not recognise the login request ({resp.status_code}). "
                    f"initSession needs no session token, so this usually means the "
                    f"API URL is wrong or the web server is not passing the path "
                    f"through. Check that the URL is exactly the apirest.php endpoint "
                    f"with nothing after it, and that GLPI's API is enabled. "
                    f"GLPI said: {detail}"
                )
            raise ValueError(f"GLPI initSession failed ({resp.status_code}): {detail}")
        token = resp.json().get("session_token")
        if not token:
            raise ValueError("GLPI initSession returned no session_token")
        return token


def _session_key(config: dict) -> tuple:
    return (config.get("base_url"), config.get("app_token"), config.get("user_token"))


def _forget_session(config: dict):
    """Drop a session we know the server has rejected."""
    _sessions.pop(_session_key(config), None)


async def _get_session(config: dict, force_new: bool = False) -> str:
    key = _session_key(config)
    async with _session_lock:
        cached = _sessions.get(key)
        if cached and not force_new and (time.time() - cached[1]) < SESSION_TTL:
            return cached[0]
        token = await _init_session(config)
        _sessions[key] = (token, time.time())
        return token


def _is_session_error(resp: httpx.Response) -> bool:
    """Whether GLPI is complaining about the session rather than the request.

    GLPI answers 400 for an expired or unknown session, not 401 — so keying the
    retry on the status code alone meant a dead session surfaced as a hard
    error. Some instances expire sessions within seconds, which looked like
    "it works once, then breaks".
    """
    if resp is None or resp.status_code not in (400, 401, 403):
        return False
    body = (resp.text or "")[:400].upper()
    return any(marker in body for marker in (
        "ERROR_SESSION_TOKEN_MISSING",
        "ERROR_SESSION_TOKEN_INVALID",
        "ERROR_NOT_AUTHENTICATED",
        "SESSION_TOKEN",
    ))


async def _request(config: dict, path: str, params: dict) -> httpx.Response:
    """GET with a cached session, re-authenticating once if the session died."""
    base_url = (config.get("base_url") or "").strip().rstrip("/")
    resp = None
    for attempt in (0, 1):
        session_token = await _get_session(config, force_new=(attempt == 1))
        if _use_query_tokens(config):
            call_params = dict(params or {})
            call_params["session_token"] = session_token
            call_params["app_token"] = (config.get("app_token") or "").strip()
            headers = {}
        else:
            call_params = params
            headers = {
                "App-Token": (config.get("app_token") or "").strip(),
                "Session-Token": session_token,
            }
        async with _client(config) as client:
            resp = await client.get(
                f"{base_url}/{path.lstrip('/')}", params=call_params, headers=headers,
            )
        # 401 is the documented answer; 400 with a session error is what real
        # instances actually send. Treat both as "get a new session and retry".
        if attempt == 0 and _is_session_error(resp):
            _forget_session(config)
            continue
        return resp
    return resp


async def _get_search_options(config: dict, itemtype: str) -> dict[str, str]:
    """Map column names to GLPI search-option ids, so filters can be pushed down.

    Returns e.g. {"name": "1", "states_id": "31", "computer.name": "1"}.
    Failures are non-fatal: an empty map just means no pushdown.
    """
    key = (config.get("base_url"), itemtype)
    if key in _search_options:
        return _search_options[key]

    mapping: dict[str, str] = {}
    try:
        resp = await _request(config, f"/listSearchOptions/{itemtype}", {})
        if resp.status_code < 400:
            for field_id, meta in (resp.json() or {}).items():
                if not str(field_id).isdigit() or not isinstance(meta, dict):
                    continue
                for label in (meta.get("uid"), meta.get("name"), meta.get("field")):
                    if label:
                        mapping[str(label).lower()] = str(field_id)
                        # also register the short form: "Computer.name" -> "name"
                        if "." in str(label):
                            mapping[str(label).split(".", 1)[1].lower()] = str(field_id)
    except Exception:
        mapping = {}

    _search_options[key] = mapping
    return mapping


def _criteria_params(criteria: list) -> dict:
    """GLPI wants criteria as criteria[0][field]=31&criteria[0][value]=x."""
    params = {}
    for i, c in enumerate(criteria or []):
        for k, v in c.items():
            params[f"criteria[{i}][{k}]"] = v
    return params


async def _build_criteria(config: dict, itemtype: str, options: dict) -> tuple[list, list]:
    """Split widget filters into (glpi_criteria, filters_left_for_client)."""
    criteria = list(options.get("criteria") or [])
    filters = options.get("filters") or []
    if not filters:
        return criteria, []

    search_options = await _get_search_options(config, itemtype)
    leftover = []
    for f in filters:
        column = str(f.get("column") or "").lower()
        searchtype = FILTER_PUSHDOWN.get((f.get("op") or "eq").lower())
        field_id = search_options.get(column)
        if not searchtype or not field_id:
            leftover.append(f)  # transform layer will handle it
            continue
        entry = {"field": field_id, "searchtype": searchtype, "value": f.get("value")}
        if criteria:
            entry["link"] = "AND"
        criteria.append(entry)
    return criteria, leftover


def _parse_content_range(header: str | None) -> int | None:
    """'0-99/954' -> 954"""
    if not header or "/" not in header:
        return None
    try:
        return int(header.rsplit("/", 1)[1])
    except ValueError:
        return None


async def fetch(config: dict, options: dict) -> dict:
    itemtype = options.get("itemtype") or "Computer"
    mode = (options.get("mode") or "search").lower()
    page_size = max(1, int(options.get("page_size") or DEFAULT_PAGE_SIZE))
    max_rows = max(1, int(options.get("max_rows") or DEFAULT_MAX_ROWS))
    strip_prefix = options.get("strip_prefix", True)

    criteria, unpushed_filters = await _build_criteria(config, itemtype, options)

    base_params: dict = {"expand_dropdowns": "true"}
    if mode != "list":
        if options.get("uid_cols", True):
            base_params["uid_cols"] = "true"
        forced = options.get("forcedisplay")
        if forced:
            ids = forced if isinstance(forced, list) else str(forced).split(",")
            for i, fid in enumerate(ids):
                base_params[f"forcedisplay[{i}]"] = str(fid).strip()
        base_params.update(_criteria_params(criteria))

    path = f"/{itemtype}" if mode == "list" else f"/search/{itemtype}"

    records: list = []
    total = None
    start = 0
    # page until we have everything GLPI reports, or we hit max_rows
    while start < max_rows:
        end = min(start + page_size, max_rows) - 1
        params = dict(base_params, range=f"{start}-{end}")
        resp = await _request(config, path, params)
        # 200 = full result, 206 = partial content (normal when paginating)
        if resp.status_code >= 400:
            # a range past the end returns 400 once we've already got rows
            if records and resp.status_code in (400, 416):
                break
            raise ValueError(f"GLPI request failed ({resp.status_code}): {resp.text[:200]}")

        payload = resp.json()
        page = payload.get("data", []) if isinstance(payload, dict) else (payload or [])
        if isinstance(payload, dict):
            total = payload.get("totalcount", total)
        if total is None:
            total = _parse_content_range(resp.headers.get("Content-Range"))

        if not page:
            break
        records.extend(page)

        if total is not None and len(records) >= total:
            break
        if len(page) < (end - start + 1):
            break  # short page means we reached the end
        start = end + 1

    result = normalize(records)

    if mode != "list" and strip_prefix:
        prefix = f"{itemtype}."

        def short(c):
            return c[len(prefix):] if c.startswith(prefix) else c

        result["columns"] = [short(c) for c in result["columns"]]
        result["rows"] = [{short(k): v for k, v in row.items()} for row in result["rows"]]

    rename = options.get("rename") or {}
    if rename:
        result["columns"] = [rename.get(c, c) for c in result["columns"]]
        result["rows"] = [{rename.get(k, k): v for k, v in row.items()} for row in result["rows"]]

    fetched = len(result["rows"])
    matched = total if total is not None else fetched
    result["meta"] = {
        "fetched": fetched,
        # rows matching the query on the server (after any pushed-down filters)
        "total": matched,
        # true when we did not retrieve everything, so counts are of a subset
        "partial": matched > fetched,
        "pushed_down_filters": len(criteria) - len(options.get("criteria") or []),
    }
    # filters we couldn't translate still need client-side evaluation
    result["_unpushed_filters"] = unpushed_filters
    return result
