"""Admin-only user management."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..auth import hash_password
from ..database import get_db
from ..models import User
from ..permissions import (
    ADMIN, MATRIX, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLES, require_admin,
)
from ..schemas import UserCreateByAdmin, UserOut, UserUpdate

router = APIRouter(prefix="/api/users", tags=["users"])

MIN_PASSWORD_LENGTH = 8


def _admin_count(db: Session, exclude_id: int | None = None) -> int:
    q = db.query(User).filter(User.role == ADMIN, User.is_active.is_(True))
    if exclude_id is not None:
        q = q.filter(User.id != exclude_id)
    return q.count()


def _validate_role(role: str):
    if role not in ROLES:
        raise HTTPException(status_code=400,
                            detail=f"Role must be one of: {', '.join(ROLES)}")


@router.get("/roles")
def list_roles(_: User = Depends(require_admin)):
    """The permission matrix, so the UI documents itself rather than hard-coding it."""
    return {
        "roles": [
            {
                "key": role,
                "label": ROLE_LABELS[role],
                "description": ROLE_DESCRIPTIONS[role],
            }
            for role in ROLES
        ],
        "capabilities": [
            {"key": cap, "roles": sorted(roles)}
            for cap, roles in sorted(MATRIX.items())
        ],
    }


@router.get("", response_model=list[UserOut])
def list_users(_: User = Depends(require_admin), db: Session = Depends(get_db)):
    return db.query(User).order_by(User.id).all()


@router.post("", response_model=UserOut)
def create_user(payload: UserCreateByAdmin, _: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    _validate_role(payload.role)
    if len(payload.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400,
                            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="That email is already registered")

    user = User(email=payload.email, hashed_password=hash_password(payload.password),
                role=payload.role, is_active=True)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.put("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, admin: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Guard rails so an admin can't lock everyone out of the workspace.
    losing_admin = (
        (payload.role is not None and payload.role != ADMIN and user.role == ADMIN)
        or (payload.is_active is False and user.role == ADMIN)
    )
    if losing_admin and _admin_count(db, exclude_id=user.id) == 0:
        raise HTTPException(
            status_code=400,
            detail="This is the last active admin. Promote another admin first.",
        )
    if payload.is_active is False and user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    if payload.role is not None:
        _validate_role(payload.role)
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        if len(payload.password) < MIN_PASSWORD_LENGTH:
            raise HTTPException(status_code=400,
                                detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
        user.hashed_password = hash_password(payload.password)

    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}")
def delete_user(user_id: int, admin: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    if user.role == ADMIN and _admin_count(db, exclude_id=user.id) == 0:
        raise HTTPException(status_code=400,
                            detail="This is the last active admin. Promote another admin first.")

    # Dashboards and data sources belong to the workspace, so they survive.
    # Reassign them to the admin doing the deletion to keep attribution valid.
    for item in list(user.dashboards):
        item.owner_id = admin.id
    for item in list(user.datasources):
        item.owner_id = admin.id

    db.delete(user)
    db.commit()
    return {"ok": True}
