"""Dashboards default to workspace-wide, and can be made private and shared
with named people. `owner_id` records who created one; see access.py for the
rules on who may see, edit and re-share it.
"""
import json
import secrets
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import access
from ..auth import get_current_user
from ..database import get_db
from ..models import (
    VISIBILITIES, VISIBILITY_WORKSPACE, Dashboard, DashboardMember, DashboardSnapshot, User,
)
from ..permissions import require_dashboard_edit
from ..schemas import DashboardCreate, DashboardOut, DashboardUpdate, SnapshotOut

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])

# How many snapshots to keep per dashboard. Enough to undo a bad afternoon
# without the table growing without bound.
MAX_SNAPSHOTS = 50


def _to_out(d: Dashboard) -> DashboardOut:
    return DashboardOut(id=d.id, name=d.name, definition=json.loads(d.definition),
                        share_token=d.share_token, version=d.version or 1,
                        visibility=d.visibility or "workspace", owner_id=d.owner_id)


def _snapshot(d: Dashboard, user: User, db: Session, note: str | None = None):
    """Store the dashboard's current state before it gets overwritten.

    Deduplicated by content, not by time. An earlier version debounced on a
    timer, which meant two saves close together kept only the first — so a
    layout you'd just built could be discarded before the save that broke it.
    Skipping only byte-identical states means every distinct layout you have
    ever had stays recoverable.
    """
    latest = (db.query(DashboardSnapshot)
              .filter(DashboardSnapshot.dashboard_id == d.id)
              .order_by(DashboardSnapshot.id.desc()).first())

    if latest and not note \
            and latest.definition == d.definition and latest.name == d.name:
        return   # nothing changed since the last snapshot

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


def _readable(dashboard_id: int, user: User, db: Session) -> Dashboard:
    d = _get(dashboard_id, db)
    if not access.can_view_dashboard(db, user, d):
        # 404 rather than 403: telling someone a dashboard exists but is closed
        # to them leaks its existence and its id
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return d


def _writable(dashboard_id: int, user: User, db: Session) -> Dashboard:
    d = _readable(dashboard_id, user, db)
    if not access.can_edit_dashboard(db, user, d):
        raise HTTPException(status_code=403, detail="You have read-only access to this dashboard")
    return d


def _manageable(dashboard_id: int, user: User, db: Session) -> Dashboard:
    d = _readable(dashboard_id, user, db)
    if not access.can_manage_dashboard(db, user, d):
        raise HTTPException(
            status_code=403,
            detail="Only the owner or an admin can change sharing for this dashboard",
        )
    return d


@router.get("", response_model=list[DashboardOut])
def list_dashboards(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = access.visible_dashboards(db, user).order_by(Dashboard.id).all()
    return [_to_out(d) for d in rows]


@router.get("/{dashboard_id}", response_model=DashboardOut)
def get_dashboard(dashboard_id: int, user: User = Depends(get_current_user),
                  db: Session = Depends(get_db)):
    return _to_out(_readable(dashboard_id, user, db))


@router.get("/{dashboard_id}/access")
def dashboard_access(dashboard_id: int, user: User = Depends(get_current_user),
                     db: Session = Depends(get_db)):
    """What this user may do here — so the UI hides controls it would reject."""
    d = _readable(dashboard_id, user, db)
    return access.describe_dashboard_access(db, user, d)


@router.post("", response_model=DashboardOut)
def create_dashboard(payload: DashboardCreate, user: User = Depends(require_dashboard_edit),
                     db: Session = Depends(get_db)):
    visibility = payload.visibility or VISIBILITY_WORKSPACE
    if visibility not in VISIBILITIES:
        raise HTTPException(status_code=400,
                            detail=f"Visibility must be one of {list(VISIBILITIES)}")
    d = Dashboard(name=payload.name, owner_id=user.id, visibility=visibility)
    db.add(d)
    db.commit()
    db.refresh(d)
    return _to_out(d)


@router.put("/{dashboard_id}", response_model=DashboardOut)
def update_dashboard(dashboard_id: int, payload: DashboardUpdate,
                     user: User = Depends(require_dashboard_edit),
                     db: Session = Depends(get_db)):
    d = _writable(dashboard_id, user, db)
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
def list_history(dashboard_id: int, user: User = Depends(require_dashboard_edit),
                 db: Session = Depends(get_db)):
    _writable(dashboard_id, user, db)
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
    d = _writable(dashboard_id, user, db)
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
    original = _readable(dashboard_id, user, db)
    # The copy inherits the original's visibility but none of its memberships:
    # you become the owner, and the people it was shared with are not carried
    # over silently. A private original stays private in the copy.
    copy = Dashboard(name=f"{original.name} (copy)", definition=original.definition,
                     owner_id=user.id, visibility=original.visibility or "workspace")
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return _to_out(copy)


@router.post("/{dashboard_id}/share", response_model=DashboardOut)
def share_dashboard(dashboard_id: int, user: User = Depends(require_dashboard_edit),
                    db: Session = Depends(get_db)):
    """Create (or return) a read-only public link for this dashboard."""
    d = _manageable(dashboard_id, user, db)
    if not d.share_token:
        d.share_token = secrets.token_urlsafe(24)
        db.commit()
        db.refresh(d)
    return _to_out(d)


@router.delete("/{dashboard_id}/share", response_model=DashboardOut)
def unshare_dashboard(dashboard_id: int, user: User = Depends(require_dashboard_edit),
                      db: Session = Depends(get_db)):
    """Revoke the public link. Any existing URL stops working immediately."""
    d = _manageable(dashboard_id, user, db)
    d.share_token = None
    db.commit()
    db.refresh(d)
    return _to_out(d)


@router.delete("/{dashboard_id}")
def delete_dashboard(dashboard_id: int, user: User = Depends(require_dashboard_edit),
                     db: Session = Depends(get_db)):
    d = _manageable(dashboard_id, user, db)
    db.delete(d)   # snapshots and memberships cascade with it
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------
# sharing with named people
# --------------------------------------------------------------------------

class VisibilityIn(BaseModel):
    visibility: str


class MemberIn(BaseModel):
    email: str
    role: str = "viewer"


@router.put("/{dashboard_id}/visibility", response_model=DashboardOut)
def set_visibility(dashboard_id: int, body: VisibilityIn,
                   user: User = Depends(require_dashboard_edit),
                   db: Session = Depends(get_db)):
    d = _manageable(dashboard_id, user, db)
    if body.visibility not in VISIBILITIES:
        raise HTTPException(status_code=400,
                            detail=f"Visibility must be one of {list(VISIBILITIES)}")
    d.visibility = body.visibility
    db.commit()
    db.refresh(d)
    return _to_out(d)


@router.get("/{dashboard_id}/members")
def list_members(dashboard_id: int, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    _readable(dashboard_id, user, db)
    rows = (db.query(DashboardMember, User)
            .join(User, User.id == DashboardMember.user_id)
            .filter(DashboardMember.dashboard_id == dashboard_id).all())
    return [access.member_out(m, u) for m, u in rows]


@router.post("/{dashboard_id}/members")
def add_member(dashboard_id: int, body: MemberIn,
               user: User = Depends(require_dashboard_edit),
               db: Session = Depends(get_db)):
    d = _manageable(dashboard_id, user, db)

    invitee = db.query(User).filter(User.email == body.email.strip().lower()).first()
    if not invitee:
        raise HTTPException(
            status_code=404,
            detail="No account with that email. An admin creates accounts under Users.",
        )
    if not invitee.is_active:
        raise HTTPException(status_code=400, detail="That account is deactivated")
    if invitee.id == d.owner_id:
        raise HTTPException(status_code=400, detail="They already own this dashboard")

    role = access.normalize_member_role(body.role)
    existing = (db.query(DashboardMember)
                .filter(DashboardMember.dashboard_id == dashboard_id,
                        DashboardMember.user_id == invitee.id).first())
    if existing:
        existing.role = role
        member = existing
    else:
        member = DashboardMember(dashboard_id=dashboard_id, user_id=invitee.id, role=role)
        db.add(member)
    db.commit()
    db.refresh(member)

    out = access.member_out(member, invitee)
    # An invite is meaningless while the dashboard is workspace-wide, and a
    # silent no-op is worse than saying so.
    if (d.visibility or "workspace") == "workspace":
        out["note"] = ("This dashboard is visible to the whole workspace, so this "
                       "invite has no effect yet. Set it to private to limit access.")
    if invitee.role == "viewer" and role == "editor":
        out["note"] = ("Their account role is Viewer, so they will still have "
                       "read-only access. An admin can change their role under Users.")
    return out


@router.delete("/{dashboard_id}/members/{user_id}")
def remove_member(dashboard_id: int, user_id: int,
                  user: User = Depends(require_dashboard_edit),
                  db: Session = Depends(get_db)):
    _manageable(dashboard_id, user, db)
    member = (db.query(DashboardMember)
              .filter(DashboardMember.dashboard_id == dashboard_id,
                      DashboardMember.user_id == user_id).first())
    if not member:
        raise HTTPException(status_code=404, detail="Not shared with that person")
    db.delete(member)
    db.commit()
    return {"ok": True}
