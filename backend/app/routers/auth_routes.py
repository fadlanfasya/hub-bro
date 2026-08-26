from datetime import datetime

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import create_access_token, get_current_user, hash_password, verify_password
from ..database import get_db
from ..login_guard import IP_MULTIPLIER, client_ip, guard
from ..models import User
from .. import totp as totp_lib
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
def login(request: Request, response: Response,
          form: OAuth2PasswordRequestForm = Depends(),
          totp_code: str | None = Form(None),
          db: Session = Depends(get_db)):
    """Check a password, slowly enough that guessing is not worth it.

    The throttle is applied before the password is checked, so a locked-out
    caller learns nothing from how long the response takes or what it says.
    """
    account_key = ("user", (form.username or "").strip().lower())
    ip_key = ("ip", client_ip(request))

    wait = guard.retry_after([account_key, ip_key])
    if wait:
        # 429 rather than 401: this is about the rate, not the credentials, and
        # the message deliberately says nothing about whether the account exists.
        response.headers["Retry-After"] = str(wait)
        raise HTTPException(
            status_code=429,
            detail=f"Too many sign-in attempts. Try again in {wait} seconds.",
            headers={"Retry-After": str(wait)},
        )

    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.hashed_password):
        guard.record_failure(account_key)
        guard.record_failure(ip_key, IP_MULTIPLIER)
        # same message either way, so this can't be used to discover valid emails
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.is_active:
        # A deactivated account is still a correct password, so it does not
        # count as a failed guess — but it must not hand out a token either.
        raise HTTPException(status_code=403, detail="This account has been deactivated")

    if user.totp_enabled:
        if not totp_code:
            # The password was right, so this is not a failed attempt — but the
            # client has to be told to ask for the second factor. A flag rather
            # than a message the UI would have to pattern-match on.
            raise HTTPException(
                status_code=401,
                detail={"mfa_required": True,
                        "message": "Enter the code from your authenticator app."},
            )
        if not _accept_second_factor(user, totp_code, db):
            guard.record_failure(account_key)
            guard.record_failure(ip_key, IP_MULTIPLIER)
            raise HTTPException(
                status_code=401,
                detail={"mfa_required": True,
                        "message": "That code is not valid. Try the next one, "
                                   "or use a recovery code."},
            )

    guard.record_success([account_key, ip_key])
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


# --------------------------------------------------------------------------
# second factor (TOTP), opted into per person
# --------------------------------------------------------------------------

class TotpStart(BaseModel):
    password: str


class TotpConfirm(BaseModel):
    code: str


class TotpDisable(BaseModel):
    password: str
    code: str | None = None


def _accept_second_factor(user: User, code: str, db: Session) -> bool:
    """A TOTP code, or one recovery code which is then burnt."""
    secret = user.totp_secret_plain
    if secret and totp_lib.verify(secret, code):
        return True
    accepted, remaining = totp_lib.consume_recovery_code(user.totp_recovery or "[]", code)
    if accepted:
        user.totp_recovery = remaining
        db.commit()
    return accepted


@router.get("/totp")
def totp_status(user: User = Depends(get_current_user)):
    return {
        "enabled": bool(user.totp_enabled),
        "enabled_at": user.totp_enabled_at,
        "recovery_codes_left": totp_lib.recovery_codes_left(user.totp_recovery or "[]"),
    }


@router.post("/totp/setup")
def totp_setup(payload: TotpStart, user: User = Depends(get_current_user),
               db: Session = Depends(get_db)):
    """Begin enrolment: make a secret and hand back the QR payload.

    The password is asked for again even though the caller holds a valid token.
    Otherwise a stolen session could bind an attacker's own authenticator, and
    the second factor would be protecting them rather than you.
    """
    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=403, detail="That password is not correct")
    if user.totp_enabled:
        raise HTTPException(status_code=400,
                            detail="Two-factor is already on. Turn it off first to re-enrol.")

    secret = totp_lib.generate_secret()
    user.set_totp_secret(secret)      # stored but not yet in force
    db.commit()
    return {
        "secret": secret,
        "uri": totp_lib.provisioning_uri(secret, user.email),
    }


@router.post("/totp/enable")
def totp_enable(payload: TotpConfirm, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    """Turn it on, but only after a code proves the app is really set up.

    Enabling without this check is how people lock themselves out: a QR that
    was mis-scanned looks identical to one that worked until the next sign-in.
    """
    secret = user.totp_secret_plain
    if not secret:
        raise HTTPException(status_code=400, detail="Start the setup first")
    if user.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-factor is already on")
    if not totp_lib.verify(secret, payload.code):
        raise HTTPException(status_code=400,
                            detail="That code is not valid. Check the app and try the next one.")

    codes = totp_lib.generate_recovery_codes()
    user.totp_recovery = totp_lib.hash_recovery_codes(codes)
    user.totp_enabled = True
    user.totp_enabled_at = datetime.utcnow()
    db.commit()
    # The only time these are ever readable. They are stored hashed, so nobody
    # — including an admin with database access — can produce them again.
    return {"enabled": True, "recovery_codes": codes}


@router.post("/totp/disable")
def totp_disable(payload: TotpDisable, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    """Turn it off. Password required, plus a code if it is currently on."""
    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=403, detail="That password is not correct")
    if user.totp_enabled and not _accept_second_factor(user, payload.code or "", db):
        raise HTTPException(status_code=403,
                            detail="Enter a current code, or one of your recovery codes.")

    user.totp_enabled = False
    user.totp_enabled_at = None
    user.set_totp_secret("")
    user.totp_recovery = None
    db.commit()
    return {"enabled": False}
