from . import csv_file, glpi, prometheus, rest_api, sql_db

CONNECTORS = {
    "rest": rest_api.fetch,
    "csv": csv_file.fetch,
    "prometheus": prometheus.fetch,
    "glpi": glpi.fetch,
    "sql": sql_db.fetch,
}


async def fetch_data(datasource, options: dict) -> dict:
    """Fetch and normalize data. Returns {"columns": [...], "rows": [{...}]}"""
    fetch_fn = CONNECTORS.get(datasource.type)
    if not fetch_fn:
        raise ValueError(f"Unknown datasource type: {datasource.type}")
    return await fetch_fn(datasource.config_dict, options or {})
