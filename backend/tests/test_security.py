"""Unit tests for credential encryption and SQL query validation.

Run: python tests/test_security.py
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")

from app.connectors.sql_db import (  # noqa: E402
    build_url, quote_identifier, validate_query, _wrap_with_filters,
)
from app.secrets_store import (  # noqa: E402
    CLEAR, MASK, decrypt_config, encrypt_config, mask_config, merge_masked,
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


print("credential encryption")
CONFIG = {
    "base_url": "http://glpi.local/apirest.php",
    "app_token": "app-secret-123",
    "user_token": "user-secret-456",
    "headers": {"Authorization": "Bearer xyz", "Accept": "application/json"},
    "verify_ssl": False,
}

enc = encrypt_config(CONFIG)
check("non-secret fields stay readable", enc["base_url"], CONFIG["base_url"])
check("booleans survive", enc["verify_ssl"], False)
check("app_token is encrypted", enc["app_token"].startswith("enc:v1:"), True)
check("user_token is encrypted", enc["user_token"].startswith("enc:v1:"), True)
check("ciphertext differs from plaintext", enc["app_token"] == CONFIG["app_token"], False)
check("header values are encrypted", enc["headers"]["Authorization"].startswith("enc:v1:"), True)

dec = decrypt_config(enc)
check("round-trips app_token", dec["app_token"], CONFIG["app_token"])
check("round-trips user_token", dec["user_token"], CONFIG["user_token"])
check("round-trips header values", dec["headers"], CONFIG["headers"])

check("encrypting twice is a no-op", encrypt_config(enc)["app_token"], enc["app_token"])
check("plaintext legacy config still decrypts", decrypt_config(CONFIG)["app_token"], "app-secret-123")

masked = mask_config(enc)
check("mask hides the token", masked["app_token"], MASK)
check("mask hides header values", masked["headers"]["Authorization"], MASK)
check("mask keeps non-secrets", masked["base_url"], CONFIG["base_url"])
check("empty secrets are not masked", mask_config({"app_token": ""})["app_token"], "")

print("secrets are never wiped by accident")
# Losing a stored credential silently is the worst outcome here: the source
# keeps working until the next cache miss, then every widget on it fails.
for label, sent in [
    ("a blank field leaves it alone", ""),
    ("a missing key leaves it alone", None),
    ("the mask leaves it alone", MASK),
]:
    incoming = dict(CONFIG)
    if sent is None:
        incoming.pop("app_token")
    else:
        incoming["app_token"] = sent
    kept = decrypt_config(encrypt_config(merge_masked(enc, incoming)))["app_token"]
    check(label, kept, "app-secret-123")

check("an explicit clear does remove it",
      decrypt_config(encrypt_config(merge_masked(enc, {**CONFIG, "app_token": CLEAR})))["app_token"],
      "")
check("a new value replaces it",
      decrypt_config(encrypt_config(merge_masked(enc, {**CONFIG, "app_token": "rotated"})))["app_token"],
      "rotated")
check("a first save with no stored secret still stores it",
      decrypt_config(encrypt_config(merge_masked({}, {"password": "brand-new"})))["password"],
      "brand-new")
check("header values survive a blank edit",
      decrypt_config(encrypt_config(merge_masked(
          enc, {**CONFIG, "headers": {"Authorization": "", "Accept": "application/json"}}
      )))["headers"]["Authorization"],
      "Bearer xyz")

merged = merge_masked(enc, {"base_url": "http://new/", "app_token": MASK, "user_token": "rotated"})
check("masked value keeps the stored secret", merged["app_token"], enc["app_token"])
check("a real value replaces the secret", merged["user_token"], "rotated")
check("non-secret updates apply", merged["base_url"], "http://new/")
check("merged config decrypts correctly",
      decrypt_config(encrypt_config(merged))["app_token"], "app-secret-123")

print("sql query validation")
check("plain select allowed", validate_query("SELECT 1"), "SELECT 1")
check("trailing semicolon stripped", validate_query("SELECT 1;"), "SELECT 1")
check("CTE allowed", validate_query("WITH x AS (SELECT 1) SELECT * FROM x").startswith("WITH"), True)
raises("insert rejected", lambda: validate_query("INSERT INTO t VALUES (1)"), "only select")
raises("update rejected", lambda: validate_query("UPDATE t SET a=1"), "only select")
raises("drop rejected", lambda: validate_query("DROP TABLE t"), "only select")
raises("stacked statement rejected", lambda: validate_query("SELECT 1; DROP TABLE t"), "single statement")
raises("hidden write in a comment-stripped query rejected",
       lambda: validate_query("SELECT 1 /* x */ ; DELETE FROM t"), "single statement")
raises("select-then-delete via union rejected",
       lambda: validate_query("SELECT * FROM t WHERE 1=1 AND (DELETE FROM u)"), "read-only")
raises("empty query rejected", lambda: validate_query("  "), "missing")

print("sql filter binding")
q, params, leftover = _wrap_with_filters("SELECT * FROM vms",
                                         [{"column": "status", "op": "eq", "value": "Running"}])
check("filter becomes a bound parameter", params, {"p0": "Running"})
check("value never appears in the SQL", "Running" in q, False)
check("query is wrapped, not rewritten", "FROM (SELECT * FROM vms)" in q, True)

q, params, leftover = _wrap_with_filters(
    "SELECT * FROM vms", [{"column": "status; DROP TABLE users--", "op": "eq", "value": "x"}])
check("injected column name is not used", q, "SELECT * FROM vms")
check("bad column falls back to client-side filtering", len(leftover), 1)

q, params, _ = _wrap_with_filters("SELECT * FROM vms",
                                  [{"column": "site", "op": "in", "value": "a,b,c"}])
check("IN binds each value", sorted(params.values()), ["a", "b", "c"])

print("dialect-aware sql")
q, params, _ = _wrap_with_filters("SELECT * FROM t",
                                  [{"column": "status", "op": "eq", "value": "Failed"}],
                                  "postgresql")
check("postgres quotes identifiers with double quotes", '"status" =' in q, True)

q, _, _ = _wrap_with_filters("SELECT * FROM t",
                             [{"column": "status", "op": "eq", "value": "Failed"}], "mysql")
check("mysql quotes identifiers with backticks", "`status` =" in q, True)
check("mysql does not use double quotes (they mean a literal there)", '"status"' in q, False)

for engine in ("doris", "starrocks", "mariadb"):
    q, _, _ = _wrap_with_filters("SELECT * FROM t",
                                 [{"column": "c", "op": "eq", "value": 1}], engine)
    check(f"{engine} uses backticks", "`c` =" in q, True)

q, _, _ = _wrap_with_filters("SELECT * FROM t",
                             [{"column": "name", "op": "contains", "value": "x"}], "postgresql")
check("postgres casts to TEXT, not CHAR(1)", "AS TEXT)" in q, True)
q, _, _ = _wrap_with_filters("SELECT * FROM t",
                             [{"column": "name", "op": "contains", "value": "x"}], "doris")
check("doris casts to CHAR", "AS CHAR)" in q, True)

check("backticks in a column name are escaped",
      quote_identifier("we`ird", "mysql"), "`we``ird`")
check("double quotes in a column name are escaped",
      quote_identifier('we"ird', "postgresql"), '"we""ird"')

print("sql url building")
check("postgres url", build_url({"driver": "postgresql", "host": "db", "database": "app",
                                 "user": "u", "password": "p", "port": 5432}),
      "postgresql+psycopg://u:p@db:5432/app")
check("mysql url", build_url({"driver": "mysql", "host": "db", "database": "app", "user": "u"}),
      "mysql+pymysql://u@db:3306/app")
check("doris uses the mysql driver on port 9030",
      build_url({"driver": "doris", "host": "fe", "database": "logs", "user": "u"}),
      "mysql+pymysql://u@fe:9030/logs")
check("an explicit port still wins",
      build_url({"driver": "doris", "host": "fe", "database": "logs", "user": "u", "port": 9031}),
      "mysql+pymysql://u@fe:9031/logs")
check("sqlite url", build_url({"driver": "sqlite", "sqlite_path": "/tmp/x.db"}), "sqlite:////tmp/x.db")
check("explicit dsn wins", build_url({"dsn": "postgresql://custom/db", "host": "ignored"}),
      "postgresql://custom/db")
raises("unknown driver rejected", lambda: build_url({"driver": "oracle", "host": "h"}), "unsupported")
raises("missing host rejected", lambda: build_url({"driver": "postgresql", "database": "d"}), "host")

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
