"""Mock GLPI API used by the test suite.

Mimics initSession, listSearchOptions, paginated search with Content-Range,
server-side criteria filtering, and session expiry.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs

VALID_USER_TOKEN = "test-user-token"
SESSIONS = set()
REQUEST_LOG = []

TOTAL_ITEMS = 954
STATUSES = ["Running", "Running", "Running", "Stopped", "Maintenance"]
SITES = ["Sentul Data Center", "Sentul Data Center", "Jakarta DC"]

# GLPI search-option ids for Computer
SEARCH_OPTIONS = {
    "1": {"uid": "Computer.name", "name": "Name", "field": "name"},
    "31": {"uid": "Computer.states_id", "name": "Status", "field": "states_id"},
    "23": {"uid": "Computer.manufacturers_id", "name": "Manufacturer", "field": "manufacturers_id"},
    "3": {"uid": "Computer.locations_id", "name": "Location", "field": "locations_id"},
    "99": {"uid": "Computer.cost", "name": "Cost", "field": "cost"},
}


def _item(i):
    return {
        "Computer.name": f"apgdev{i:03d}v2",
        "Computer.states_id": STATUSES[i % len(STATUSES)],
        "Computer.manufacturers_id": "VMWare",
        "Computer.locations_id": SITES[i % len(SITES)],
        "Computer.cost": (i % 5) * 100,
    }


ALL_ITEMS = [_item(i) for i in range(TOTAL_ITEMS)]

FIELD_BY_ID = {fid: meta["uid"] for fid, meta in SEARCH_OPTIONS.items()}


def _apply_criteria(items, query):
    """Server-side filtering, mirroring GLPI's criteria[n][field|searchtype|value]."""
    i = 0
    while f"criteria[{i}][field]" in query:
        field_id = query[f"criteria[{i}][field]"][0]
        searchtype = query.get(f"criteria[{i}][searchtype]", ["equals"])[0]
        value = query.get(f"criteria[{i}][value]", [""])[0]
        col = FIELD_BY_ID.get(field_id)
        if col:
            if searchtype == "equals":
                items = [it for it in items if str(it.get(col)) == value]
            elif searchtype == "notequals":
                items = [it for it in items if str(it.get(col)) != value]
            elif searchtype == "contains":
                items = [it for it in items if value.lower() in str(it.get(col)).lower()]
            elif searchtype == "morethan":
                items = [it for it in items if _num(it.get(col)) > _num(value)]
            elif searchtype == "lessthan":
                items = [it for it in items if _num(it.get(col)) < _num(value)]
        i += 1
    return items


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("-inf")


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload, headers=None):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        path, query = parsed.path, parse_qs(parsed.query)

        # --- test helpers ---
        if path == "/__count":
            return self._send(200, {
                "search": sum(1 for p in REQUEST_LOG if "/search/" in p),
                "init": sum(1 for p in REQUEST_LOG if p.endswith("/initSession")),
                "options": sum(1 for p in REQUEST_LOG if "/listSearchOptions/" in p),
            })
        if path == "/__reset":
            REQUEST_LOG.clear()
            return self._send(200, {"ok": True})
        if path == "/__expire":
            SESSIONS.clear()
            return self._send(200, {"ok": True})

        REQUEST_LOG.append(path)

        if path.endswith("/initSession"):
            auth = self.headers.get("Authorization", "")
            if not auth.startswith("user_token ") or auth.split()[1] != VALID_USER_TOKEN:
                return self._send(401, ["ERROR_LOGIN", "bad token"])
            token = f"sess-{len(SESSIONS)}-{len(REQUEST_LOG)}"
            SESSIONS.add(token)
            return self._send(200, {"session_token": token})

        if self.headers.get("Session-Token") not in SESSIONS:
            return self._send(401, ["ERROR_SESSION_TOKEN_INVALID", "no session"])

        if "/listSearchOptions/" in path:
            return self._send(200, SEARCH_OPTIONS)

        if "/search/" in path:
            items = _apply_criteria(ALL_ITEMS, query)
            total = len(items)

            rng = query.get("range", ["0-49"])[0]
            try:
                start, end = (int(x) for x in rng.split("-"))
            except ValueError:
                start, end = 0, 49
            if start >= total:
                return self._send(400, ["ERROR_RANGE_EXCEED_TOTAL", "range exceeds total"])

            page = items[start:end + 1]
            return self._send(206, {
                "totalcount": total, "count": len(page),
                "sort": [1], "order": ["ASC"], "data": page,
            }, {"Content-Range": f"{start}-{start + len(page) - 1}/{total}"})

        self._send(404, ["ERROR", "not found"])

    def log_message(self, *a):
        pass


def serve(port=9997):
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    serve()
