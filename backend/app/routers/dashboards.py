"""Dashboards are workspace-wide: every signed-in user can see them, and
editors/admins can change them. `owner_id` records who created one.
"""
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..models import Dashboard, User
from ..permissions import require_dashboard_edit
from ..schemas import DashboardCreate, DashboardOut, DashboardUpdate

router = APIRouter(prefix="/api/dashboards", tags=["dashboards"])


def _to_out(d: Dashboard) -> DashboardOut:
    return DashboardOut(id=d.id, name=d.name, definition=json.loads(d.definition),
                        share_token=d.share_token)


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
                     _: User = Depends(require_dashboard_edit), db: Session = Depends(get_db)):
    d = _get(dashboard_id, db)
    if payload.name is not None:
        d.name = payload.name
    if payload.definition is not None:
        d.definition = json.dumps(payload.definition)
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
    db.delete(d)
    db.commit()
    return {"ok": True}
