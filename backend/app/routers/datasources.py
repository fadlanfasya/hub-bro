import json
import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from .. import health as health_mod
from ..config import settings
from ..database import get_db
from ..models import DataSource, User
from ..permissions import (
    require_datasource_edit, require_datasource_health, require_datasource_view,
)
from ..schemas import DataSourceCreate, DataSourceOut, DataSourceUpdate
from ..secrets_store import encrypt_config, merge_masked

router = APIRouter(prefix="/api/datasources", tags=["datasources"])

UPLOAD_DIR = str(settings.UPLOAD_DIR)

VALID_TYPES = {"rest", "csv", "prometheus", "glpi", "sql"}


def _to_out(ds: DataSource) -> DataSourceOut:
    # never return real credentials to the client
    return DataSourceOut(id=ds.id, name=ds.name, type=ds.type, config=ds.safe_config_dict)


@router.get("/health")
def health(_: User = Depends(require_datasource_health), db: Session = Depends(get_db)):
    """Reachability of every source. Deliberately exposes no configuration —
    name, type and status only — so viewers can see it too."""
    deps = health_mod.dependents(db)
    out = []
    for ds in db.query(DataSource).order_by(DataSource.id).all():
        state = health_mod.status_for(db, ds.id)
        out.append({
            "id": ds.id, "name": ds.name, "type": ds.type,
            "monitored": bool(ds.raw_config_dict.get("monitor")),
            "dashboards": deps.get(ds.id, []),
            **state,
        })
    return out


@router.post("/{ds_id}/check")
async def check_now(ds_id: int, _: User = Depends(require_datasource_health),
                    db: Session = Depends(get_db)):
    """Probe one source on demand."""
    ds = db.query(DataSource).filter(DataSource.id == ds_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Not found")

    ok, error, duration = await health_mod.probe(ds)
    health_mod.record(db, ds.id, ok, error, duration, source="manual", force=True)
    return {"ok": ok, "error": error, "duration_ms": duration,
            **health_mod.status_for(db, ds.id)}


@router.get("", response_model=list[DataSourceOut])
def list_datasources(_: User = Depends(require_datasource_view),
                     db: Session = Depends(get_db)):
    # sources are workspace-wide; editors need to see them to build widgets
    items = db.query(DataSource).order_by(DataSource.id).all()
    return [_to_out(ds) for ds in items]


@router.post("", response_model=DataSourceOut)
def create_datasource(payload: DataSourceCreate, user: User = Depends(require_datasource_edit),
                      db: Session = Depends(get_db)):
    if payload.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of {VALID_TYPES}")
    ds = DataSource(name=payload.name, type=payload.type,
                    config=json.dumps(encrypt_config(payload.config)), owner_id=user.id)
    db.add(ds)
    db.commit()
    db.refresh(ds)
    return _to_out(ds)


@router.post("/upload-csv", response_model=DataSourceOut)
async def upload_csv(name: str = Form(...), file: UploadFile = File(...),
                     user: User = Depends(require_datasource_edit),
                     db: Session = Depends(get_db)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")
    dest = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.csv")
    with open(dest, "wb") as f:
        f.write(await file.read())
    ds = DataSource(name=name, type="csv",
                    config=json.dumps({"file_path": dest, "original_name": file.filename}),
                    owner_id=user.id)  # no secrets in a CSV config
    db.add(ds)
    db.commit()
    db.refresh(ds)
    return _to_out(ds)


@router.put("/{ds_id}", response_model=DataSourceOut)
def update_datasource(ds_id: int, payload: DataSourceUpdate,
                      _: User = Depends(require_datasource_edit),
                      db: Session = Depends(get_db)):
    ds = db.query(DataSource).filter(DataSource.id == ds_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Not found")
    if payload.name is not None:
        ds.name = payload.name
    if payload.config is not None:
        stored = ds.raw_config_dict
        # the client sends back a mask for unchanged secrets — keep the stored value
        incoming = merge_masked(stored, payload.config)
        if ds.type == "csv":
            # preserve the uploaded file; only merge other settings
            merged = dict(stored)
            merged.update({k: v for k, v in incoming.items()
                           if k not in ("file_path", "original_name")})
            incoming = merged
        ds.config = json.dumps(encrypt_config(incoming))
    db.commit()
    db.refresh(ds)
    return _to_out(ds)


@router.delete("/{ds_id}")
def delete_datasource(ds_id: int, _: User = Depends(require_datasource_edit),
                      db: Session = Depends(get_db)):
    ds = db.query(DataSource).filter(DataSource.id == ds_id).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Not found")
    if ds.type == "csv":
        path = ds.raw_config_dict.get("file_path")
        if path and os.path.exists(path):
            os.remove(path)
    db.delete(ds)
    db.commit()
    return {"ok": True}
