from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..auth import create_access_token, get_current_user, hash_password, verify_password
from ..database import get_db
from ..models import User
from ..permissions import ADMIN, VIEWER, capabilities_for
from ..schemas import (
    MeOut, PasswordChange, RegistrationStatus, Token, UserCreate, UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

MIN_PASSWORD_LENGTH = 8


def _no_users_yet(db: Session) -> bool:
    return db.query(User.id).first() is None


@router.get("/registration", response_model=RegistrationStatus)
def registration_status(db: Session = Depends(get_db)):
    """The sign-up screen uses this to decide whether to offer registration."""
    return RegistrationStatus(open=_no_users_yet(db))


@router.post("/register", response_model=UserOut)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    """Create the very first account, which becomes the admin.

    Self-registration then closes permanently: further accounts are created by
    an admin. This keeps a publicly reachable deployment from accumulating
    accounts created by anyone who finds the URL.
    """
    if not _no_users_yet(db):
        raise HTTPException(
            status_code=403,
            detail="Registration is closed. Ask an administrator for an account.",
        )
    if len(payload.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400,
                            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters")

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=ADMIN,          # first account owns the workspace
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/login", response_model=Token)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        # same message either way, so this can't be used to discover valid emails
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="This account has been deactivated")

    user.last_login_at = datetime.utcnow()
    db.commit()
    return Token(access_token=create_access_token(user.id))


@router.get("/me", response_model=MeOut)
def me(user: User = Depends(get_current_user)):
    return MeOut(
        id=user.id, email=user.email, role=user.role or VIEWER,
        is_active=user.is_active, created_at=user.created_at,
        last_login_at=user.last_login_at,
        capabilities=capabilities_for(user.role or VIEWER),
    )


@router.post("/change-password")
def change_password(payload: PasswordChange, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(payload.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400,
                            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters")
    if payload.new_password == payload.current_password:
        raise HTTPException(status_code=400, detail="New password must be different")

    user.hashed_password = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}
