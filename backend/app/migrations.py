"""Tiny additive migrations.

SQLAlchemy's create_all() creates missing tables but never alters existing ones,
so columns added after a database was first created need a nudge. Each entry is
idempotent: we check the live schema and only add what's missing.

For anything beyond additive columns, switch to Alembic.
"""
import logging

from sqlalchemy import inspect, text

log = logging.getLogger("uvicorn.error")

# table -> column -> DDL type
ADDED_COLUMNS = {
    "dashboards": {
        "share_token": "VARCHAR",
    },
    "users": {
        "role": "VARCHAR DEFAULT 'viewer'",
        "is_active": "BOOLEAN DEFAULT 1",
        "last_login_at": "DATETIME",
    },
}


def run(engine):
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, columns in ADDED_COLUMNS.items():
            if table not in existing_tables:
                continue  # create_all() will build it with every column
            present = {c["name"] for c in inspector.get_columns(table)}
            for column, ddl_type in columns.items():
                if column in present:
                    continue
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
                log.info("Migrated: added %s.%s", table, column)

        # Databases created before roles existed have users with no role. The
        # earliest account was whoever set the system up, so promote it to admin
        # and leave the rest as editors — matching what they could already do.
        if "users" in existing_tables:
            missing = conn.execute(
                text("SELECT COUNT(*) FROM users WHERE role IS NULL OR role = ''")
            ).scalar()
            if missing:
                first_id = conn.execute(
                    text("SELECT id FROM users ORDER BY id LIMIT 1")
                ).scalar()
                conn.execute(text("UPDATE users SET role = 'editor' "
                                  "WHERE role IS NULL OR role = ''"))
                conn.execute(text("UPDATE users SET role = 'admin' WHERE id = :id"),
                             {"id": first_id})
                conn.execute(text("UPDATE users SET is_active = 1 WHERE is_active IS NULL"))
                log.info("Migrated: assigned roles to %s existing user(s); "
                         "user %s is now admin", missing, first_id)
