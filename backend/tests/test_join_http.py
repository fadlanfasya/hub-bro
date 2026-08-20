"""The whole path: widget options -> several Prometheus calls -> one table."""
import asyncio, json, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
sys.path.insert(0, '.')

DEVICES = [
    ("10.1.6.20", "STL-L02-R10-ELTM01", 4.8, 2.4, 4, 48),
    ("10.1.6.22", "STLL02R06-NLTM01", 17.1, 4.0, 3, 227),
    ("10.1.6.24", "STL-L02-R05-ADC-03", 25.9, 4.0, 3, 38),
]
COL = {"cpu": 2, "mem": 3, "failover": 4, "vs": 5}
hits = []

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        q = parse_qs(urlparse(self.path).query).get("query", [""])[0]
        hits.append(q)
        which = q if q in COL else "cpu"
        data = [{"metric": {"__name__": which, "instance": d[0], "sysName": d[1]},
                 "value": [1755200000, str(d[COL[which]])]} for d in DEVICES]
        body = json.dumps({"status": "success",
                           "data": {"resultType": "vector", "result": data}}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a): pass

srv = HTTPServer(("127.0.0.1", 0), H)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

from app import cache
from app.routers.data import _dispatch

class FakeDS:
    id = 77
    type = "prometheus"
    config_dict = {"base_url": f"http://127.0.0.1:{port}"}

passed = failed = 0
def check(label, got, want):
    global passed, failed
    ok = got == want
    passed, failed = passed + ok, failed + (not ok)
    print(("  PASS  " if ok else "  FAIL  ") + label)
    if not ok:
        print("        got  ", got); print("        want ", want)

OPTIONS = {
    "queries": [
        {"query": "cpu", "as": "CPU"},
        {"query": "mem", "as": "Memory"},
        {"query": "failover", "as": "Failover"},
        {"query": "vs", "as": "Virtual Servers"},
    ],
    "join": {"on": "sysName"},
    "sort": {"column": "CPU", "dir": "desc"},
}

async def main():
    cache.clear() if hasattr(cache, "clear") else None
    out = await _dispatch(FakeDS(), OPTIONS)
    print("columns:", out["columns"])
    for r in out["rows"]:
        print("   ", r)
    check("four queries, four HTTP calls", len(hits), 4)
    check("one table, four value columns",
          out["columns"], ["sysName", "CPU", "Memory", "Failover", "Virtual Servers"])
    check("three rows", len(out["rows"]), 3)
    check("sorted by CPU descending",
          [r["sysName"] for r in out["rows"]],
          ["STL-L02-R05-ADC-03", "STLL02R06-NLTM01", "STL-L02-R10-ELTM01"])
    check("meta reports the query count", out["meta"]["queries"], 4)

    before = len(hits)
    await _dispatch(FakeDS(), OPTIONS)
    check("a second widget reuses the cache", len(hits), before)

    single = await _dispatch(FakeDS(), {"query": "cpu"})
    check("a plain single-query widget still works",
          single["columns"], ["time", "series", "metric", "instance", "sysName", "value"])

    try:
        await _dispatch(FakeDS(), {"queries": [], "join": {"on": "sysName"}})
        check("an empty query list is rejected", "no error", "HTTPException")
    except Exception as e:
        check("an empty query list is rejected", e.__class__.__name__, "HTTPException")

asyncio.run(main())
srv.shutdown()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
