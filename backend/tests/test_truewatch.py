"""Unit tests for the TrueWatch connector.

Run: python tests/test_truewatch.py

The response fixtures mirror the shape documented in Guance's DQL Go SDK
(GuanceCloud/dql-go, DQLResult/Row) and consumed by their Grafana plugin.
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")

from app.connectors.truewatch import (  # noqa: E402
    build_body, endpoint_of, flatten, headers_for, raise_for_payload,
)

passed = failed = 0


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}\n        got      {actual!r}")


def raises(label, fn, fragment=""):
    global passed, failed
    try:
        fn()
    except Exception as e:
        if fragment.lower() in str(e).lower():
            passed += 1
            print(f"  PASS  {label}")
        else:
            failed += 1
            print(f"  FAIL  {label} — wrong error: {e}")
        return
    failed += 1
    print(f"  FAIL  {label} — no error raised")


print("endpoint and auth")
check("defaults to the public SaaS endpoint", endpoint_of({}), "https://openapi.truewatch.com")
check("a private endpoint is used as given",
      endpoint_of({"endpoint": "https://tw.internal.corp/"}), "https://tw.internal.corp")
check("the key goes in DF-API-KEY", headers_for({"api_key": "k123"})["DF-API-KEY"], "k123")
check("json content type", headers_for({"api_key": "k"})["Content-Type"], "application/json")
raises("a missing API key is a clear error", lambda: headers_for({}), "no api key is set")

print("request body")
body = build_body({"query": "M::`cpu`:(avg(`usage_idle`)) BY `host`", "range_minutes": 30}, {})
check("queries_body is a JSON string, not an object", isinstance(body["queries_body"], str), True)
parsed = json.loads(body["queries_body"])
q = parsed["queries"][0]
check("defaults to dql", q["qtype"], "dql")
check("query is passed through", q["query"]["q"], "M::`cpu`:(avg(`usage_idle`)) BY `host`")
start, end = q["query"]["timeRange"]
check("time range is 30 minutes wide", round((end - start) / 60000), 30)
check("time range is in milliseconds", end > 1_000_000_000_000, True)
check("interval is omitted when not set", "interval" in q["query"], False)
check("promql is passed through as a query type",
      json.loads(build_body({"query": "up", "qtype": "promql"}, {})["queries_body"])["queries"][0]["qtype"],
      "promql")
check("interval is included when set",
      json.loads(build_body({"query": "x", "interval": 60}, {})["queries_body"])["queries"][0]["query"]["interval"],
      60)
check("comma separated workspace uuids become a list",
      json.loads(build_body({"query": "x"}, {"workspace_uuids": "wksp_a, wksp_b"})["queries_body"])
      ["queries"][0]["query"]["workspaceUUIDs"],
      ["wksp_a", "wksp_b"])
check("a uuid list is kept as a list",
      json.loads(build_body({"query": "x"}, {"workspace_uuids": ["wksp_a"]})["queries_body"])
      ["queries"][0]["query"]["workspaceUUIDs"],
      ["wksp_a"])
raises("an empty query is rejected before we call out", lambda: build_body({}, {}), "missing a dql query")

print("flattening the series response")
GROUPED = {"content": {"data": [{"series": [
    {"name": "cpu", "columns": ["time", "usage_idle"],
     "values": [[1743391592000, 97.4], [1743391652000, 96.8]],
     "tags": {"host": "web-01"}},
    {"name": "cpu", "columns": ["time", "usage_idle"],
     "values": [[1743391592000, 55.1]],
     "tags": {"host": "web-02"}},
]}]}}

result = flatten(GROUPED)
check("every point becomes a row", len(result["rows"]), 3)
check("BY tags become columns", "host" in result["columns"], True)
check("tags are attached to each row", result["rows"][0]["host"], "web-01")
check("metric values are kept", result["rows"][0]["usage_idle"], 97.4)
check("the time column is present", result["rows"][0]["time"], 1743391592000)
check("columns are not duplicated across series", result["columns"].count("usage_idle"), 1)
check("rows from the second group are included", result["rows"][2]["host"], "web-02")

check("the time column can be renamed",
      "ts" in flatten(GROUPED, "ts")["columns"], True)

LOGS = {"content": {"data": [{"series": [
    {"columns": ["time", "status", "count"],
     "values": [[1743391592000, "error", 12], [1743391592000, "warning", 3]]},
]}]}}
res = flatten(LOGS)
check("a query with no tags still flattens", len(res["rows"]), 2)
check("string columns survive", res["rows"][0]["status"], "error")
check("column order follows the query", res["columns"], ["time", "status", "count"])

print("shapes that would otherwise crash a widget")
check("an empty result is empty, not an error", flatten({"content": {"data": []}}),
      {"columns": [], "rows": []})
check("a missing content key is handled", flatten({}), {"columns": [], "rows": []})
check("a series with no values contributes columns only",
      flatten({"content": {"data": [{"series": [{"columns": ["time", "v"], "values": []}]}]}}),
      {"columns": ["time", "v"], "rows": []})
check("data given as a single object rather than a list",
      len(flatten({"content": {"data": {"series": [
          {"columns": ["a"], "values": [[1]]}]}}})["rows"]),
      1)
# a short value array must not raise IndexError — it truncates the row instead
check("a value array shorter than columns does not crash",
      flatten({"content": {"data": [{"series": [
          {"columns": ["time", "a", "b"], "values": [[1, 2]]}]}]}})["rows"][0],
      {"time": 1, "a": 2})
check("labels are accepted as an alias for tags",
      flatten({"content": {"data": [{"series": [
          {"columns": ["v"], "values": [[1]], "labels": {"svc": "api"}}]}]}})["rows"][0]["svc"],
      "api")

print("errors reported in the body")
raises("an errorCode in a 200 response is raised",
       lambda: raise_for_payload({"errorCode": "DQL.Syntax", "message": "bad query"}),
       "bad query")
raises("snake_case error_code is raised too",
       lambda: raise_for_payload({"error_code": "Auth.Forbidden"}), "auth.forbidden")
raise_for_payload({"content": {"data": []}})
passed += 1
print("  PASS  a clean response does not raise")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
