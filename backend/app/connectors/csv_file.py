"""CSV file connector.

config: {file_path}
options: {} (whole file is returned; widgets pick fields client-side)
"""
import csv


def _coerce(value: str):
    if value == "":
        return None
    try:
        return int(value)
    except ValueError:
        pass
    try:
        return float(value)
    except ValueError:
        return value


async def fetch(config: dict, options: dict) -> dict:
    file_path = config.get("file_path")
    if not file_path:
        raise ValueError("CSV datasource is missing a file")

    with open(file_path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        columns = reader.fieldnames or []
        rows = [{k: _coerce(v) for k, v in row.items()} for row in reader]

    limit = options.get("limit")
    if limit:
        rows = rows[: int(limit)]
    return {"columns": list(columns), "rows": rows}
