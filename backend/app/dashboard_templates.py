"""Portable dashboard templates.

Templates deliberately contain no data-source IDs or credentials. Widgets refer
to a required source through ``datasource_key``; import maps that key to an
existing source the current user is allowed to use.
"""
from copy import deepcopy


BUILT_IN_TEMPLATES = {
    "elasticsearch-logs": {
        "name": "Elasticsearch Logs Overview",
        "description": "Recent log documents and common log levels.",
        "category": "observability",
        "required_sources": [{"key": "logs", "type": "elasticsearch", "label": "Log source"}],
        "definition": {
            "time_range": "1h",
            "widgets": [
                {
                    "id": "recent-logs", "type": "table", "title": "Recent logs",
                    "datasource_key": "logs",
                    "options": {
                        "query": '{"query":{"match_all":{}},"sort":[{"@timestamp":"desc"}]}',
                        "time_field": "@timestamp", "follow_dashboard_range": True,
                        "max_rows": 200,
                    },
                },
                {
                    "id": "log-levels", "type": "bar", "title": "Log levels",
                    "datasource_key": "logs",
                    "options": {
                        "query": '{"size":0,"aggs":{"by_level":{"terms":{"field":"level.keyword","size":10}}}}',
                        "time_field": "@timestamp", "follow_dashboard_range": True,
                        "x_field": "by_level", "y_field": "doc_count",
                    },
                },
            ],
            "layout": [
                {"i": "recent-logs", "x": 0, "y": 0, "w": 8, "h": 5},
                {"i": "log-levels", "x": 8, "y": 0, "w": 4, "h": 5},
            ],
        },
    },
    "prometheus-node": {
        "name": "Prometheus Node Overview",
        "description": "CPU and memory overview for Prometheus node-exporter data.",
        "category": "observability",
        "required_sources": [{"key": "metrics", "type": "prometheus", "label": "Metrics source"}],
        "definition": {
            "time_range": "1h",
            "widgets": [
                {
                    "id": "cpu-usage", "type": "line", "title": "CPU usage",
                    "datasource_key": "metrics",
                    "options": {"query": "100 - (avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)",
                                "series_field": "instance", "follow_dashboard_range": True},
                },
                {
                    "id": "memory-available", "type": "line", "title": "Memory available",
                    "datasource_key": "metrics",
                    "options": {"query": "100 * node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes",
                                "series_field": "instance", "follow_dashboard_range": True},
                },
            ],
            "layout": [
                {"i": "cpu-usage", "x": 0, "y": 0, "w": 6, "h": 4},
                {"i": "memory-available", "x": 6, "y": 0, "w": 6, "h": 4},
            ],
        },
    },
}


def built_in_list() -> list[dict]:
    return [
        {"key": key, "name": value["name"], "description": value["description"],
         "category": value["category"], "required_sources": value["required_sources"]}
        for key, value in BUILT_IN_TEMPLATES.items()
    ]


def get_built_in(key: str) -> dict | None:
    template = BUILT_IN_TEMPLATES.get(key)
    return deepcopy(template) if template else None
