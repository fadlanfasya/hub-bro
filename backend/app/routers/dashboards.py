"""Dashboards are workspace-wide: every signed-in user can see them, and
editors/admins can change them. `owner_id` records who created one.
"""
import json
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Dashboard, DashboardSnapshot, User
from ..permissions import require_dashboard_edit
from ..schemas import DashboardCreate, DashboardOut, DashboardUpdate, SnapshotOut

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

# How many snapshots to keep per dashboard. Enough to undo a bad afternoon
# without the table growing without bound.
MAX_SNAPSHOTS = 30

# Saves closer together than this replace the previous snapshot instead of
# adding one. Layout auto-saves fire every ~600ms while dragging, which would
# otherwise bury the useful history under dozens of near-identical entries.
SNAPSHOT_DEBOUNCE_SECONDS = 120


def _to_out(d: Dashboard) -> DashboardOut:
    return DashboardOut(id=d.id, name=d.name, definition=json.loads(d.definition),
                        share_token=d.share_token, version=d.version or 1)


def _snapshot(d: Dashboard, user: User, db: Session, note: str | None = None):
    """Store the dashboard's current state before it gets overwritten."""
    latest = (db.query(DashboardSnapshot)
              .filter(DashboardSnapshot.dashboard_id == d.id)
              .order_by(DashboardSnapshot.id.desc()).first())

    recent = (latest and latest.author_email == user.email and latest.created_at
              and (datetime.utcnow() - latest.created_at).total_seconds()
              < SNAPSHOT_DEBOUNCE_SECONDS)

    if recent and not note:
        return   # keep the older state; it's the more useful thing to restore

    db.add(DashboardSnapshot(
        dashboard_id=d.id, name=d.name, definition=d.definition,
        version=d.version or 1, author_email=user.email, note=note,
    ))

    stale = (db.query(DashboardSnapshot)
             .filter(DashboardSnapshot.dashboard_id == d.id)
             .order_by(DashboardSnapshot.id.desc())
             .offset(MAX_SNAPSHOTS).all())
    for old in stale:
        db.delete(old)


def _get(dashboard_id: int, db: Session) -> Dashboard:
    d = db.query(Dashboard).filter(Dashboard.id == dashboard_id).first()
    if not d:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return d


@router.get("", response_model=list[DashboardOut])
def list_dashboards(_: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return [_to_out(d) for d in db.query(Dashboard).order_by(Dashboard.id).all()]


@router.get("/{dashboard_id}", response_model=DashboardOut)
def get_dashboard(dashboard_id: int, _: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    return _to_out(_get(dashboard_id, db))


@router.post("", response_model=DashboardOut)
def create_dashboard(payload: DashboardCreate, user: User = Depends(require_dashboard_edit),
                     db: Session = Depends(get_db)):
    d = Dashboard(name=payload.name, owner_id=user.id)
    db.add(d)
    db.commit()
    db.refresh(d)
    return _to_out(d)


@router.put("/{dashboard_id}", response_model=DashboardOut)
def update_dashboard(dashboard_id: int, payload: DashboardUpdate,
                     user: User = Depends(require_dashboard_edit),
                     db: Session = Depends(get_db)):
    d = _get(dashboard_id, db)
    current = d.version or 1

    # Reject a save based on a stale copy. Without this the later write simply
    # wins and the other editor's work disappears with no warning.
    if payload.version is not None and payload.version != current:
        raise HTTPException(
            status_code=409,
            detail=(f"This dashboard was changed by someone else "
                    f"(you have version {payload.version}, current is {current}). "
                    f"Reload to get their changes before saving."),
        )

    if payload.name is not None or payload.definition is not None:
        _snapshot(d, user, db)

    if payload.name is not None:
        d.name = payload.name
    if payload.definition is not None:
        d.definition = json.dumps(payload.definition)
    d.version = current + 1

    db.commit()
    db.refresh(d)
    return _to_out(d)


@router.get("/{dashboard_id}/history", response_model=list[SnapshotOut])
def list_history(dashboard_id: int, _: User = Depends(require_dashboard_edit),
                 db: Session = Depends(get_db)):
    _get(dashboard_id, db)
    snapshots = (db.query(DashboardSnapshot)
                 .filter(DashboardSnapshot.dashboard_id == dashboard_id)
                 .order_by(DashboardSnapshot.id.desc()).all())
    out = []
    for s in snapshots:
        try:
            widgets = len(json.loads(s.definition).get("widgets", []))
        except (ValueError, AttributeError):
            widgets = 0
        out.append(SnapshotOut(
            id=s.id, name=s.name, version=s.version, author_email=s.author_email,
            note=s.note, created_at=s.created_at, widget_count=widgets,
        ))
    return out


@router.post("/{dashboard_id}/history/{snapshot_id}/restore", response_model=DashboardOut)
def restore_snapshot(dashboard_id: int, snapshot_id: int,
                     user: User = Depends(require_dashboard_edit),
                     db: Session = Depends(get_db)):
    d = _get(dashboard_id, db)
    snapshot = (db.query(DashboardSnapshot)
                .filter(DashboardSnapshot.id == snapshot_id,
                        DashboardSnapshot.dashboard_id == dashboard_id).first())
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")

    # snapshot the current state first, so a restore is itself undoable
    _snapshot(d, user, db, note=f"before restoring v{snapshot.version}")

    d.name = snapshot.name
    d.definition = snapshot.definition
    d.version = (d.version or 1) + 1
    db.commit()
    db.refresh(d)
    return _to_out(d)


@router.post("/{dashboard_id}/duplicate", response_model=DashboardOut)
def duplicate_dashboard(dashboard_id: int, user: User = Depends(require_dashboard_edit),
                        db: Session = Depends(get_db)):
    original = _get(dashboard_id, db)
    # a copy is private even if the original is shared
    copy = Dashboard(name=f"{original.name} (copy)", definition=original.definition,
                     owner_id=user.id)
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _to_out(copy)


@router.post("/{dashboard_id}/share", response_model=DashboardOut)
def share_dashboard(dashboard_id: int, _: User = Depends(require_dashboard_edit),
                    db: Session = Depends(get_db)):
    """Create (or return) a read-only public link for this dashboard."""
    d = _get(dashboard_id, db)
    if not d.share_token:
        d.share_token = secrets.token_urlsafe(24)
        db.commit()
        db.refresh(d)
    return _to_out(d)


@router.delete("/{dashboard_id}/share", response_model=DashboardOut)
def unshare_dashboard(dashboard_id: int, _: User = Depends(require_dashboard_edit),
                      db: Session = Depends(get_db)):
    """Revoke the public link. Any existing URL stops working immediately."""
    d = _get(dashboard_id, db)
    d.share_token = None
    db.commit()
    db.refresh(d)
    return _to_out(d)


@router.delete("/{dashboard_id}")
def delete_dashboard(dashboard_id: int, _: User = Depends(require_dashboard_edit),
                     db: Session = Depends(get_db)):
    d = _get(dashboard_id, db)
    db.delete(d)   # snapshots cascade with it
    db.commit()
    return {"ok": True}
