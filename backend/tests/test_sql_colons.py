"""Literal colons in a user's SQL.

SQLAlchemy's text() reads :name as a bind parameter, so a query containing the
string '08:00' asked for a parameter called "00" and died with "A value is
required for bind parameter '00'". Nothing in that message points at the colon,
and the line it comes from looks like an ordinary string literal.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.connectors.sql_db import (  # noqa: E402
    _wrap_with_filters, escape_colons, validate_query,
)

passed = failed = 0


def check(name, got, want):
    global passed, failed
    if got == want:
        passed += 1
    else:
        failed += 1
        print(f"FAIL {name}\n  got  {got!r}\n  want {want!r}")


# ---- the case that broke -----------------------------------------------------
check("time literal", escape_colons("SELECT '08:00' AS jam"),
      "SELECT '08\\:00' AS jam")
# A colon followed by '/' is never read as a bind parameter by SQLAlchemy's
# text() — its BIND_PARAMS regex requires `:` + at least one word character —
# so 'http://x' parses fine unescaped and needs no protection.
check("colon then slash", escape_colons("SELECT 'http://x' AS u"),
      "SELECT 'http://x' AS u")

# ---- PostgreSQL casts must survive untouched --------------------------------
# The first colon of :: is followed by a colon, not a word character; the second
# is preceded by one. Neither half matches, which is why ts::date always worked.
check("cast to date", escape_colons("SELECT ts::date FROM t"), "SELECT ts::date FROM t")
check("cast to text", escape_colons("LPAD(n::text, 2, '0')"), "LPAD(n::text, 2, '0')")
check("cast to int", escape_colons("EXTRACT(HOUR FROM ts)::int"), "EXTRACT(HOUR FROM ts)::int")
check("chained casts", escape_colons("a::numeric::text"), "a::numeric::text")

# ---- nothing to do ----------------------------------------------------------
check("plain query", escape_colons("SELECT 1"), "SELECT 1")
check("colon at end", escape_colons("SELECT 'a:'"), "SELECT 'a:'")
check("colon before space", escape_colons("SELECT 'a: b'"), "SELECT 'a: b'")

# ---- through validate_query --------------------------------------------------
q = validate_query("SELECT LPAD(h::text, 2, '0') || ':00' AS jam FROM t")
check("validate escapes", "'\\:00'" in q, True)
check("validate keeps the cast", "h::text" in q, True)

# A forbidden word is still caught, and on the query as written — escaping runs
# last so it can never hide one.
for bad in ("DELETE FROM t", "SELECT 1; DROP TABLE t", "UPDATE t SET a = 1"):
    try:
        validate_query(bad)
        check(f"rejects {bad[:12]}", "accepted", "rejected")
    except ValueError:
        passed += 1

# Column names that merely start with a forbidden word stay allowed — this is
# what lets createdAt, updatedAt and created_on through.
for good in ('SELECT "createdAt" FROM t', 'SELECT "updatedAt" FROM t',
             "SELECT created_on FROM t"):
    try:
        validate_query(good)
        passed += 1
    except ValueError as e:
        failed += 1
        print(f"FAIL wrongly rejected {good}: {e}")

# ---- the filter wrapper's own placeholders are added outside the escape ------
wrapped, params, leftover = _wrap_with_filters(
    validate_query("SELECT '08:00' AS jam, n FROM t"),
    [{"column": "n", "op": "gt", "value": 5}], "postgresql")
check("wrapper still binds its own parameter", params, {"p0": 5})
check("user colon stays escaped inside the subquery", "'08\\:00'" in wrapped, True)
check("wrapper placeholder is not escaped", ":p0" in wrapped, True)
check("nothing left over", leftover, [])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
