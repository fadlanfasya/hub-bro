"""SQL connector — run a read-only query against PostgreSQL, MySQL or SQLite.

config:
  driver    "postgresql" | "mysql" | "sqlite"
  host, port, database, user, password   (not needed for sqlite)
  sqlite_path                            (sqlite only)
  dsn       full SQLAlchemy URL, overrides the pieces above if given

options:
  query     the SELECT to run
  filters   widget filters, applied as a WHERE wrapper around the query so the
            database does the filtering (parameterised — values never interpolated)
  limit     hard row cap (default 5000)

Only read statements are allowed. Anything else is rejected before it reaches
the database, and the connection is opened in a read-only transaction where the
driver supports it.
"""
import asyncio
import re

from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

from ..config import settings

DEFAULT_LIMIT = 5000
MAX_LIMIT = 50000

DRIVERS = {
    "postgresql": "postgresql+psycopg",
    "postgres": "postgresql+psycopg",
    "mysql": "mysql+pymysql",
    "mariadb": "mysql+pymysql",
    # Doris and StarRocks speak the MySQL wire protocol on the FE query port
    "doris": "mysql+pymysql",
    "starrocks": "mysql+pymysql",
    "sqlite": "sqlite",
}

# engines that quote identifiers with backticks rather than double quotes
MYSQL_FAMILY = {"mysql", "mariadb", "doris", "starrocks"}

# sensible default port per engine, so the form can prefill it
DEFAULT_PORTS = {
    "postgresql": 5432, "postgres": 5432,
    "mysql": 3306, "mariadb": 3306,
    "doris": 9030, "starrocks": 9030,
}

# statements that may modify data or schema — rejected outright
FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|"
    r"attach|copy|merge|replace|call|do|vacuum|reindex)\b",
    re.IGNORECASE,
)

# widget filter op -> SQL operator
SQL_OPS = {
    "eq": "=", "ne": "<>", "gt": ">", "gte": ">=", "lt": "<", "lte": "<=",
}

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _strip_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    sql = re.sub(r"--[^\n]*", " ", sql)
    return sql.strip()


def validate_query(query: str) -> str:
    """Return the query if it's a single read-only statement, else raise."""
    if not query or not query.strip():
        raise ValueError("Widget is missing a SQL query")

    cleaned = _strip_comments(query)
    without_trailing = cleaned.rstrip().rstrip(";")
    if ";" in without_trailing:
        raise ValueError("Only a single statement is allowed (remove the ';')")

    first = without_trailing.lstrip().split(None, 1)[0].lower() if without_trailing.strip() else ""
    if first not in ("select", "with"):
        raise ValueError("Only SELECT (or WITH ... SELECT) queries are allowed")
    if FORBIDDEN.search(without_trailing):
        raise ValueError("Only read-only queries are allowed")
    return without_trailing


def build_url(config: dict) -> str:
    if config.get("dsn"):
        return config["dsn"]

    driver_key = (config.get("driver") or "postgresql").lower()
    driver = DRIVERS.get(driver_key)
    if not driver:
        raise ValueError(f"Unsupported driver: {driver_key}")

    if driver == "sqlite":
        path = config.get("sqlite_path") or config.get("database")
        if not path:
            raise ValueError("SQLite source needs sqlite_path")
        return f"sqlite:///{path}"

    if not config.get("host"):
        raise ValueError("SQL data source is missing host")
    if not config.get("database"):
        raise ValueError("SQL data source is missing database")

    port = config.get("port") or DEFAULT_PORTS.get(driver_key)
    return URL.create(
        driver,
        username=config.get("user") or None,
        password=config.get("password") or None,
        host=config["host"],
        port=int(port) if port else None,
        database=config["database"],
    ).render_as_string(hide_password=False)


def quote_identifier(name: str, dialect: str) -> str:
    """Quote a column name for the target engine.

    MySQL (and therefore Doris and MariaDB) treat "x" as a string literal, not
    an identifier, so quoting with double quotes there produces a filter that
    compares the literal text and silently matches nothing. Backticks are the
    MySQL-family identifier quote; everyone else uses double quotes.
    """
    if dialect in MYSQL_FAMILY:
        return f"`{name.replace('`', '``')}`"
    return f'"{name.replace(chr(34), chr(34) * 2)}"'


def _text_cast(dialect: str) -> str:
    """The type name meaning 'arbitrary length text' for this engine.

    CHAR is right for MySQL, but in PostgreSQL an unqualified CHAR is char(1),
    which truncates the value and breaks a `contains` match.
    """
    if dialect in MYSQL_FAMILY:
        return "CHAR"
    return "TEXT"


def _wrap_with_filters(query: str, filters: list, dialect: str = "postgresql"):
    """Wrap the user query in a subselect and apply filters as bound parameters.

    Column names are validated against a strict identifier pattern (they come
    from the widget config, not from user input at view time), and every value
    is bound — so nothing from the widget is ever interpolated into SQL.
    """
    clauses, params = [], {}
    leftover = []
    for i, f in enumerate(filters or []):
        column, op = f.get("column"), (f.get("op") or "eq").lower()
        if not column or not IDENTIFIER.match(str(column)):
            leftover.append(f)
            continue
        col = quote_identifier(str(column), dialect)
        param = f"p{i}"
        if op in SQL_OPS:
            clauses.append(f"{col} {SQL_OPS[op]} :{param}")
            params[param] = f.get("value")
        elif op == "contains":
            clauses.append(f"CAST({col} AS {_text_cast(dialect)}) LIKE :{param}")
            params[param] = f"%{f.get('value')}%"
        elif op == "not_empty":
            clauses.append(f"{col} IS NOT NULL")
        elif op == "in":
            raw = f.get("value")
            values = raw if isinstance(raw, list) else [v.strip() for v in str(raw).split(",")]
            names = []
            for j, v in enumerate(values):
                names.append(f":{param}_{j}")
                params[f"{param}_{j}"] = v
            clauses.append(f"{col} IN ({', '.join(names)})")
        else:
            leftover.append(f)

    if not clauses:
        return query, {}, leftover
    return f"SELECT * FROM ({query}) AS hb_sub WHERE {' AND '.join(clauses)}", params, leftover


def _run(url: str, query: str, params: dict, limit: int) -> dict:
    engine = create_engine(
        url,
        pool_pre_ping=True,
        connect_args={"connect_timeout": settings.FETCH_TIMEOUT_SECONDS}
        if not url.startswith("sqlite") else {},
    )
    try:
        with engine.connect() as conn:
            result = conn.execute(text(query), params)
            columns = list(result.keys())
            rows = []
            for row in result.yield_per(1000):
                item = {}
                for col, value in zip(columns, row):
                    # keep JSON-serialisable types; stringify dates/decimals/etc.
                    item[col] = value if value is None or isinstance(
                        value, (str, int, float, bool)) else str(value)
                rows.append(item)
                if len(rows) >= limit:
                    break
        return {"columns": columns, "rows": rows}
    finally:
        engine.dispose()


async def fetch(config: dict, options: dict) -> dict:
    query = validate_query(options.get("query", ""))
    url = build_url(config)

    # A blank password is almost always an oversight rather than a server that
    # allows passwordless login, and the driver's own error is cryptic.
    driver_key = (config.get("driver") or "postgresql").lower()
    if driver_key != "sqlite" and not config.get("dsn") \
            and config.get("user") and not config.get("password"):
        raise ValueError(
            "No password is set for this data source. Edit it and enter the "
            "database password, or use a DSN if the server allows passwordless login."
        )

    dialect = (config.get("driver") or "postgresql").lower()
    limit = min(int(options.get("limit") or DEFAULT_LIMIT), MAX_LIMIT)
    query, params, leftover = _wrap_with_filters(query, options.get("filters"), dialect)

    # SQLAlchemy is blocking, so keep the event loop free
    result = await asyncio.to_thread(_run, url, query, params, limit)

    result["meta"] = {
        "fetched": len(result["rows"]),
        "total": len(result["rows"]),
        "partial": len(result["rows"]) >= limit,
    }
    result["_unpushed_filters"] = leftover
    return result
