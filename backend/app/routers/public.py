"""Unauthenticated read-only access to shared dashboards.

Anyone holding the share token can view the dashboard and the data its widgets
display. Guard rails:
  - the token grants access to exactly one dashboard, nothing else
  - only widgets that belong to that dashboard can be fetched, so the token
    can't be used to read the owner's other data sources
  - data source configs (URLs, credentials) are never exposed
  - nothing here can write
"""
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Dashboard, DataSource
from .data import _run

router = APIRouter(prefix="/api/public", tags=["public"])


class PublicFetchRequest(BaseModel):
    widget_id: str


def _get_shared(token: str, db: Session) -> Dashboard:
    if not token:
        raise HTTPException(status_code=404, detail="Not found")
    d = db.query(Dashboard).filter(Dashboard.share_token == token).first()
    if not d:
        raise HTTPException(status_code=404, detail="This dashboard is not shared")
    return d


@router.get("/dashboards/{token}")
def get_public_dashboard(token: str, db: Session = Depends(get_db)):
    d = _get_shared(token, db)
    definition = json.loads(d.definition)
    # strip datasource ids — the viewer fetches by widget id instead
    widgets = [{k: v for k, v in w.items() if k != "datasource_id"}
               for w in definition.get("widgets", [])]
    return {
        "name": d.name,
        "definition": {"widgets": widgets, "layout": definition.get("layout", [])},
        "read_only": True,
    }


@router.post("/dashboards/{token}/data")
async def fetch_public_data(token: str, payload: PublicFetchRequest,
                            db: Session = Depends(get_db)):
    d = _get_shared(token, db)
    definition = json.loads(d.definition)

    widget = next((w for w in definition.get("widgets", [])
                   if str(w.get("id")) == str(payload.widget_id)), None)
    if not widget:
        raise HTTPException(status_code=404, detail="Widget not found on this dashboard")

    # options come from the stored widget, never from the request — a viewer
    # cannot craft their own query against the owner's data source
    ds = db.query(DataSource).filter(
        DataSource.id == widget.get("datasource_id"),
        DataSource.owner_id == d.owner_id,
    ).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")

    return await _run(ds, widget.get("options") or {})
