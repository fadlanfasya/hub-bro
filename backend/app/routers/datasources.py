import json
import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from pydantic import BaseModel

from .. import access
from .. import health as health_mod
from ..config import settings
from ..database import get_db
from ..models import (
    VISIBILITIES, VISIBILITY_PRIVATE, VISIBILITY_WORKSPACE, DataSource, DataSourceMember, User,
)
from ..permissions import (
    require_datasource_health, require_datasource_view,
)
from ..schemas import DataSourceCreate, DataSourceOut, DataSourceUpdate
from ..secrets_store import encrypt_config, merge_masked

# Any editor may add a source; only admins may make one workspace-wide.
require_datasource_create = require_datasource_view

router = APIRouter(prefix="/api/datasources", tags=["datasources"])

UPLOAD_DIR = str(settings.UPLOAD_DIR)

VALID_TYPES = {"rest", "csv", "prometheus", "glpi", "sql", "truewatch"}


def _to_out(ds: DataSource, user: User | None = None,
            db: Session | None = None) -> DataSourceOut:
    # never return real credentials to the client
    return DataSourceOut(
        id=ds.id, name=ds.name, type=ds.type, config=ds.safe_config_dict,
        visibility=ds.visibility or "workspace", owner_id=ds.owner_id,
        can_edit=bool(user and db and access.can_edit_datasource(db, user, ds)),
    )


def _check_glpi_url(config: dict):
    """Reject a GLPI URL with an endpoint already on the end.

    The connector appends the endpoint itself, so a URL like
    ".../apirest.php/SoftwareLicense" becomes ".../SoftwareLicense/initSession",
    which GLPI reads as an ordinary item request and answers with
    ERROR_SESSION_TOKEN_MISSING — an error that points nowhere near the cause.
    """
    url = (config.get("base_url") or "").strip().rstrip("/")
    if not url or "apirest.php" not in url.lower():
        return
    tail = url.lower().split("apirest.php", 1)[1].strip("/")
    if tail:
        raise HTTPException(
            status_code=400,
            detail=(f"Remove '/{tail}' from the API URL — it should end at "
                    f"apirest.php. Hub-Bro adds the endpoint itself, and the item "
                    f"type (SoftwareLicense, Ticket, Computer) belongs in the "
                    f"widget's Item type field, not the URL."),
        )


def _check_visibility(visibility: str | None, user: User) -> str:
    """Validate the requested visibility for this user.

    An editor may keep a private source of their own, but only an admin can
    publish one to the whole workspace — otherwise anyone could hand their
    database credentials to every account in one click.
    """
    visibility = visibility or VISIBILITY_PRIVATE
    if visibility not in VISIBILITIES:
        raise HTTPException(status_code=400,
                            detail=f"Visibility must be one of {list(VISIBILITIES)}")
    if visibility == VISIBILITY_WORKSPACE and not access.can_create_workspace_datasource(user):
        raise HTTPException(
            status_code=403,
            detail="Only an admin can make a data source available to the whole "
                   "workspace. Keep it private, then share it with specific people.",
        )
    return visibility


def _get_usable(ds_id: int, user: User, db: Session) -> DataSource:
    ds = db.query(DataSource).filter(DataSource.id == ds_id).first()
    if not ds or not access.can_use_datasource(db, user, ds):
        raise HTTPException(status_code=404, detail="Not found")
    return ds


def _get_editable(ds_id: int, user: User, db: Session) -> DataSource:
    ds = _get_usable(ds_id, user, db)
    if not access.can_edit_datasource(db, user, ds):
        raise HTTPException(
            status_code=403,
            detail="Only the owner or an admin can change this data source.",
        )
    return ds


@router.get("/health")
def health(user: User = Depends(require_datasource_health), db: Session = Depends(get_db)):
    """Reachability of every source you can reach.

    Exposes no configuration — name, type and status only — so viewers see it
    too. Viewers have no source access of their own, so for them this is the
    whole workspace-wide set, which is exactly the "is this dashboard stale?"
    context they need. Private sources stay hidden from everyone else.
    """
    deps = health_mod.dependents(db)
    out = []
    sources = (db.query(DataSource) if user.role == "viewer"
               else access.visible_datasources(db, user))
    for ds in sources.order_by(DataSource.id).all():
        if user.role == "viewer" and (ds.visibility or VISIBILITY_WORKSPACE) != VISIBILITY_WORKSPACE:
            continue
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
def list_datasources(user: User = Depends(require_datasource_view),
                     db: Session = Depends(get_db)):
    # workspace-wide sources plus your own and any shared with you
    items = access.visible_datasources(db, user).order_by(DataSource.id).all()
    return [_to_out(ds, user, db) for ds in items]


@router.post("", response_model=DataSourceOut)
def create_datasource(payload: DataSourceCreate, user: User = Depends(require_datasource_create),
                      db: Session = Depends(get_db)):
    if payload.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"type must be one of {VALID_TYPES}")
    visibility = _check_visibility(payload.visibility, user)
    if payload.type == "glpi":
        _check_glpi_url(payload.config or {})
    ds = DataSource(name=payload.name, type=payload.type, visibility=visibility,
                    config=json.dumps(encrypt_config(payload.config)), owner_id=user.id)
    db.add(ds)
    db.commit()
    db.refresh(ds)
    return _to_out(ds)


@router.post("/upload-csv", response_model=DataSourceOut)
async def upload_csv(name: str = Form(...), file: UploadFile = File(...),
                     visibility: str = Form(VISIBILITY_WORKSPACE),
                     user: User = Depends(require_datasource_create),
                     db: Session = Depends(get_db)):
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")
    visibility = _check_visibility(visibility, user)
    dest = os.path.join(UPLOAD_DIR, f"{uuid.uuid4().hex}.csv")
    with open(dest, "wb") as f:
        f.write(await file.read())
    ds = DataSource(name=name, type="csv", visibility=visibility,
                    config=json.dumps({"file_path": dest, "original_name": file.filename}),
                    owner_id=user.id)  # no secrets in a CSV config
    db.add(ds)
    db.commit()
    db.refresh(ds)
    return _to_out(ds)


@router.put("/{ds_id}", response_model=DataSourceOut)
def update_datasource(ds_id: int, payload: DataSourceUpdate,
                      user: User = Depends(require_datasource_view),
                      db: Session = Depends(get_db)):
    ds = _get_editable(ds_id, user, db)
    if ds.type == "glpi" and payload.config is not None:
        _check_glpi_url(payload.config)
    if payload.visibility is not None:
        ds.visibility = _check_visibility(payload.visibility, user)
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
    return _to_out(ds, user, db)


@router.delete("/{ds_id}")
def delete_datasource(ds_id: int, user: User = Depends(require_datasource_view),
                      db: Session = Depends(get_db)):
    ds = _get_editable(ds_id, user, db)
    if ds.type == "csv":
        path = ds.raw_config_dict.get("file_path")
        if path and os.path.exists(path):
            os.remove(path)
    db.delete(ds)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------------------
# sharing a private source with named people
# --------------------------------------------------------------------------

class SourceMemberIn(BaseModel):
    email: str


@router.get("/{ds_id}/members")
def list_source_members(ds_id: int, user: User = Depends(require_datasource_view),
                        db: Session = Depends(get_db)):
    _get_usable(ds_id, user, db)
    rows = (db.query(DataSourceMember, User)
            .join(User, User.id == DataSourceMember.user_id)
            .filter(DataSourceMember.datasource_id == ds_id).all())
    return [access.member_out(m, u) for m, u in rows]


@router.post("/{ds_id}/members")
def add_source_member(ds_id: int, body: SourceMemberIn,
                      user: User = Depends(require_datasource_view),
                      db: Session = Depends(get_db)):
    """Let someone build widgets on, and query through, this source.

    This is a real grant of data access, not just visibility — for a SQL
    source it means they can run their own statements against your database.
    """
    ds = _get_editable(ds_id, user, db)
    invitee = db.query(User).filter(User.email == body.email.strip().lower()).first()
    if not invitee:
        raise HTTPException(status_code=404, detail="No account with that email")
    if not invitee.is_active:
        raise HTTPException(status_code=400, detail="That account is deactivated")
    if invitee.id == ds.owner_id:
        raise HTTPException(status_code=400, detail="They already own this data source")
    if not access.can_use_datasource(db, invitee, ds) and \
            invitee.role not in ("admin", "editor"):
        raise HTTPException(
            status_code=400,
            detail="Viewers cannot use data sources directly. Share a dashboard "
                   "with them instead — they will see its data without gaining "
                   "access to the source.",
        )

    existing = (db.query(DataSourceMember)
                .filter(DataSourceMember.datasource_id == ds_id,
                        DataSourceMember.user_id == invitee.id).first())
    if existing:
        return access.member_out(existing, invitee)

    member = DataSourceMember(datasource_id=ds_id, user_id=invitee.id)
    db.add(member)
    db.commit()
    db.refresh(member)
    out = access.member_out(member, invitee)
    if (ds.visibility or VISIBILITY_WORKSPACE) == VISIBILITY_WORKSPACE:
        out["note"] = ("This source is already available to the whole workspace, "
                       "so this grant changes nothing yet.")
    return out


@router.delete("/{ds_id}/members/{user_id}")
def remove_source_member(ds_id: int, user_id: int,
                         user: User = Depends(require_datasource_view),
                         db: Session = Depends(get_db)):
    _get_editable(ds_id, user, db)
    member = (db.query(DataSourceMember)
              .filter(DataSourceMember.datasource_id == ds_id,
                      DataSourceMember.user_id == user_id).first())
    if not member:
        raise HTTPException(status_code=404, detail="Not shared with that person")
    db.delete(member)
    db.commit()
    return {"ok": True}
