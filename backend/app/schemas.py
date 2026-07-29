from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, EmailStr


# ---- Auth ----
class UserCreate(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    is_active: bool
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MeOut(UserOut):
    """The current user plus what their role allows, so the UI can hide actions."""
    capabilities: list[str] = []


class UserCreateByAdmin(BaseModel):
    email: EmailStr
    password: str
    role: str = "viewer"


class UserUpdate(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


class RegistrationStatus(BaseModel):
    """Whether the very first account still needs creating."""
    open: bool


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---- Data sources ----
class DataSourceCreate(BaseModel):
    name: str
    type: str  # rest | csv | prometheus
    config: dict[str, Any] = {}


class DataSourceUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict[str, Any]] = None


class DataSourceOut(BaseModel):
    id: int
    name: str
    type: str
    config: dict[str, Any]


# ---- Dashboards ----
class DashboardCreate(BaseModel):
    name: str


class DashboardUpdate(BaseModel):
    name: Optional[str] = None
    definition: Optional[dict[str, Any]] = None


class DashboardOut(BaseModel):
    id: int
    name: str
    definition: dict[str, Any]
    share_token: Optional[str] = None


# ---- Data fetch ----
class DataFetchRequest(BaseModel):
    datasource_id: int
    # rest: {data_path}; prometheus: {query, start?, end?, step?}
    options: dict[str, Any] = {}
