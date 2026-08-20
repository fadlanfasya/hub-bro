"""Roles and the permission matrix.

    capability             admin  editor  viewer
    ---------------------  -----  ------  ------
    view dashboards          x      x       x
    export data              x      x       x
    edit dashboards          x      x       -
    share dashboards         x      x       -
    list data sources        x      x       -
    manage data sources      x      -       -
    edit data sources        x      -       -
    view source health       x      -       -
    manage users             x      -       -

Data sources are hidden from viewers because their configs reveal internal
hostnames and which systems exist, even with credentials masked. Viewers still
see the data those sources produce, through dashboards.

Listing and managing are deliberately different capabilities. An editor has to
pick a source to build a widget, so they can read the list of names; the Data
sources page shows every connection detail, so it stays with admins. Splitting
them is what lets the menu be admin-only without disarming every editor.

Only admins edit data sources: a source is shared infrastructure, and a bad
edit breaks every dashboard using it.

Health is admin-only too. That is a real trade: someone reading a dashboard can
no longer check whether a source is failing, so a stale number looks like a
current one. Widgets still show their own fetch errors, which is the part that
matters at the point of reading.
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
    # Listing sources, which is what the widget builder's picker needs. An
    # editor cannot build a widget without choosing a source, so this stays
    # wider than the page below.
    "datasource.view": {ADMIN, EDITOR},
    # The Data sources page itself. Separate from the list because the page
    # shows every field of every config — hostnames, ports, database names,
    # which systems exist — while the picker shows names only.
    "datasource.manage": {ADMIN},
    "datasource.edit": {ADMIN},
    "datasource.health": {ADMIN},
    # Anyone can see which alarms exist and what state they are in — that is
    # operational context, and hiding it just means people ask in chat.
    "alert.view": {ADMIN, EDITOR, VIEWER},
    # Editing is restricted because a rule holds a webhook URL, which is a
    # credential for posting into a team channel.
    "alert.edit": {ADMIN, EDITOR},
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
require_datasource_manage = require("datasource.manage")
require_datasource_health = require("datasource.health")
require_datasource_edit = require("datasource.edit")
require_alert_view = require("alert.view")
require_alert_edit = require("alert.edit")
