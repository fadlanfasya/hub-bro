import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.dashboard_templates import built_in_list, get_built_in  # noqa: E402


def test_builtin_templates_are_portable():
    templates = built_in_list()
    assert {item["key"] for item in templates} == {
        "elasticsearch-logs", "prometheus-node",
    }
    template = get_built_in("elasticsearch-logs")
    assert template["required_sources"][0]["type"] == "elasticsearch"
    assert "datasource_id" not in template["definition"]["widgets"][0]


def test_builtin_template_is_returned_as_a_copy():
    first = get_built_in("prometheus-node")
    first["definition"]["widgets"].clear()
    assert get_built_in("prometheus-node")["definition"]["widgets"]
