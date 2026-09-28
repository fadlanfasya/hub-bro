import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.connectors.elasticsearch import _add_time_range, _body, flatten_record, normalize  # noqa: E402


def test_nested_hits_become_table_rows():
    result = normalize({"hits": {"total": {"value": 2}, "hits": [{
        "_id": "a1", "_index": "logs-2026", "_score": 1.0,
        "_source": {"service": "api", "host": {"name": "node-1"},
                    "tags": ["prod", "edge"]},
    }]}})
    assert result["columns"][:3] == ["_id", "_index", "_score"]
    assert result["rows"][0]["host.name"] == "node-1"
    assert result["rows"][0]["tags"] == "prod, edge"
    assert result["meta"]["total"] == 2
    assert result["meta"]["fetched"] == 1


def test_terms_aggregation_becomes_chartable_rows():
    result = normalize({"aggregations": {"by_status": {
        "buckets": [{"key": "error", "doc_count": 4},
                    {"key": "ok", "doc_count": 9}],
    }}})
    assert result["columns"] == ["by_status", "doc_count"]
    assert result["rows"] == [
        {"by_status": "error", "doc_count": 4},
        {"by_status": "ok", "doc_count": 9},
    ]


def test_query_accepts_json_string_and_preserves_explicit_size():
    body = _body({"query": '{"query":{"match":{"message":"timeout"}},"size":25}'}, 5000)
    assert body["query"]["match"]["message"] == "timeout"
    assert body["size"] == 25
    assert body["sort"] == ["_shard_doc"]


def test_time_range_is_added_without_overwriting_query():
    body = _body({"query": {"term": {"service": "api"}},
                  "time_field": "@timestamp", "range": {"minutes": 60}}, 5000)
    assert body["query"]["bool"]["must"] == [{"term": {"service": "api"}}]
    assert body["query"]["bool"]["filter"] == [
        {"range": {"@timestamp": {"gte": "now-60m", "lte": "now"}}}
    ]


def test_time_range_preserves_existing_bool_filters():
    body = _add_time_range({"query": {"bool": {"filter": [{"term": {"env": "prod"}}]}}},
                           "event.time", {"minutes": 15})
    assert len(body["query"]["bool"]["filter"]) == 2


def test_nested_record_flattens_objects():
    assert flatten_record({"http": {"response": {"status_code": 500}}}) == {
        "http.response.status_code": 500,
    }
