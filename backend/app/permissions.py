"""Roles and the permission matrix.

    capability             admin  editor  viewer
    ---------------------  -----  ------  ------
    view dashboards          x      x       x
    export data              x      x       x
    edit dashboards          x      x       -
    share dashboards         x      x       -
    view data sources        x      x       -
    edit data sources        x      -       -
    manage users             x      -       -

Data sources are hidden from viewers because their configs reveal internal
hostnames and which systems exist, even with credentials masked. Viewers still
see the data those sources produce, through dashboards.

Only admins edit data sources: a source is shared infrastructure, and a bad
edit breaks every dashboard using it.
"""
from fastapi import Depends, HTTPException, status

from .auth import get_current_user
from .models import User

ADMIN = "admin"
EDITOR = "editor"
VIEWER = "viewer"

ROLES = (ADMIN, EDITOR, VIEWER)

ROLE_LABELS = {
    ADMIN: "Admin",
    EDITOR: "Editor",
    VIEWER: "Viewer",
}

ROLE_DESCRIPTIONS = {
    ADMIN: "Full access, including managing users and data sources.",
    EDITOR: "Builds dashboards and widgets. Can view data sources but not change them.",
    VIEWER: "Reads dashboards and exports data. Cannot change anything.",
}

# capability -> roles that hold it
MATRIX = {
    "dashboard.view": {ADMIN, EDITOR, VIEWER},
    "dashboard.export": {ADMIN, EDITOR, VIEWER},
    "dashboard.edit": {ADMIN, EDITOR},
    "dashboard.share": {ADMIN, EDITOR},
    "datasource.view": {ADMIN, EDITOR},
    "datasource.edit": {ADMIN},
    # Everyone can see whether a source is reachable. It exposes no config —
    # just a name and a status — and "is this dashboard stale?" is exactly what
    # a viewer needs to know before quoting a number.
    "datasource.health": {ADMIN, EDITOR, VIEWER},
    "user.manage": {ADMIN},
}


def can(user: User, capability: str) -> bool:
    return user.role in MATRIX.get(capability, set())


def capabilities_for(role: str) -> list[str]:
    return sorted(cap for cap, roles in MATRIX.items() if role in roles)


def require(capability: str):
    """FastAPI dependency enforcing a single capability."""
    def dependency(user: User = Depends(get_current_user)) -> User:
        if not can(user, capability):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Your role ({ROLE_LABELS.get(user.role, user.role)}) "
                       f"cannot do this.",
            )
        return user
    return dependency


# convenience dependencies
require_admin = require("user.manage")
require_dashboard_edit = require("dashboard.edit")
require_datasource_view = require("datasource.view")
require_datasource_health = require("datasource.health")
require_datasource_edit = require("datasource.edit")
