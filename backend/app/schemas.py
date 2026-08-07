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
    type: str  # rest | csv | prometheus | glpi | sql | truewatch
    config: dict[str, Any] = {}
    # workspace | private. Defaults to private so an editor adding their own
    # source never publishes credentials to everyone by accident.
    visibility: Optional[str] = None


class DataSourceUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[dict[str, Any]] = None
    visibility: Optional[str] = None


class DataSourceOut(BaseModel):
    id: int
    name: str
    type: str
    config: dict[str, Any]
    visibility: str = "workspace"
    owner_id: Optional[int] = None
    # whether the caller may change this source, so the UI can hide the controls
    can_edit: bool = False


# ---- Dashboards ----
class DashboardCreate(BaseModel):
    name: str
    # workspace | private. Chosen when the dashboard is created, so a private
    # one is never briefly visible to everyone before it gets locked down.
    visibility: Optional[str] = None


class DashboardUpdate(BaseModel):
    name: Optional[str] = None
    definition: Optional[dict[str, Any]] = None
    # the version the client last saw; a mismatch means someone else saved
    # in the meantime and this write is rejected rather than clobbering theirs
    version: Optional[int] = None


class DashboardOut(BaseModel):
    id: int
    name: str
    definition: dict[str, Any]
    share_token: Optional[str] = None
    version: int = 1
    visibility: str = "workspace"
    owner_id: Optional[int] = None


class SnapshotOut(BaseModel):
    id: int
    name: str
    version: int
    author_email: Optional[str] = None
    note: Optional[str] = None
    created_at: Optional[datetime] = None
    widget_count: int = 0


# ---- Data fetch ----
class DataFetchRequest(BaseModel):
    datasource_id: int
    # rest: {data_path}; prometheus: {query, start?, end?, step?}
    options: dict[str, Any] = {}
