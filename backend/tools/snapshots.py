"""Inspect and restore dashboard snapshots straight from the database.

Useful when the in-app history list isn't enough — it shows each snapshot's
actual widget layout so you can identify the right one before restoring.

    python tools/snapshots.py list 3
    python tools/snapshots.py show 3 42
    python tools/snapshots.py restore 3 42

The DATABASE_URL environment variable is honoured, so this works against the
Docker volume too:

    docker compose exec hubbro python tools/snapshots.py list 3
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.models import Dashboard, DashboardSnapshot  # noqa: E402


def _summary(definition_json: str) -> str:
    """One line per widget: title, position and size."""
    try:
        d = json.loads(definition_json)
    except ValueError:
        return "  (unreadable definition)"
    widgets = {str(w.get("id")): w for w in d.get("widgets", [])}
    layout = {str(l.get("i")): l for l in d.get("layout", [])}
    if not widgets:
        return "  (no widgets)"

    lines = []
    for wid, w in widgets.items():
        pos = layout.get(wid, {})
        lines.append(
            f"    {w.get('title', '(untitled)')[:32]:<34}"
            f" {w.get('type', '?'):<6}"
            f" x={pos.get('x', '?'):<3} y={pos.get('y', '?'):<3}"
            f" w={pos.get('w', '?'):<3} h={pos.get('h', '?')}"
        )
    return "\n".join(sorted(lines))


def cmd_list(db, dashboard_id: int):
    dash = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not dash:
        print(f"No dashboard with id {dashboard_id}")
        return 1

    print(f"Dashboard {dash.id}: {dash.name}  (current version {dash.version})")
    print("\n=== CURRENT ===")
    print(_summary(dash.definition))

    snapshots = (db.query(DashboardSnapshot)
                 .filter(DashboardSnapshot.dashboard_id == dashboard_id)
                 .order_by(DashboardSnapshot.id.desc()).all())
    if not snapshots:
        print("\nNo snapshots stored for this dashboard.")
        return 0

    print(f"\n=== {len(snapshots)} SNAPSHOT(S), newest first ===")
    for s in snapshots:
        note = f"  [{s.note}]" if s.note else ""
        print(f"\n  id={s.id}  v{s.version}  {s.created_at}  by {s.author_email}{note}")
        print(_summary(s.definition))
    return 0


def cmd_show(db, dashboard_id: int, snapshot_id: int):
    s = (db.query(DashboardSnapshot)
         .filter(DashboardSnapshot.id == snapshot_id,
                 DashboardSnapshot.dashboard_id == dashboard_id).first())
    if not s:
        print(f"No snapshot {snapshot_id} on dashboard {dashboard_id}")
        return 1
    print(json.dumps(json.loads(s.definition), indent=2))
    return 0


def cmd_restore(db, dashboard_id: int, snapshot_id: int):
    dash = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    snap = (db.query(DashboardSnapshot)
            .filter(DashboardSnapshot.id == snapshot_id,
                    DashboardSnapshot.dashboard_id == dashboard_id).first())
    if not dash or not snap:
        print("Dashboard or snapshot not found")
        return 1

    # keep the current state so this is undoable, same as the in-app restore
    db.add(DashboardSnapshot(
        dashboard_id=dash.id, name=dash.name, definition=dash.definition,
        version=dash.version or 1, author_email="tools/snapshots.py",
        note=f"before restoring snapshot {snapshot_id}",
    ))
    dash.name = snap.name
    dash.definition = snap.definition
    dash.version = (dash.version or 1) + 1
    db.commit()

    print(f"Restored snapshot {snapshot_id} onto dashboard {dashboard_id}.")
    print("The share and kiosk links serve the same definition, so they update too.")
    return 0


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__)
        return 2

    command, dashboard_id = args[0], int(args[1])
    db = SessionLocal()
    try:
        if command == "list":
            return cmd_list(db, dashboard_id)
        if command == "show" and len(args) >= 3:
            return cmd_show(db, dashboard_id, int(args[2]))
        if command == "restore" and len(args) >= 3:
            return cmd_restore(db, dashboard_id, int(args[2]))
        print(__doc__)
        return 2
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
