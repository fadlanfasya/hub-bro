"""Who can see and change which dashboard or data source.

Two layers decide every question:

  1. `permissions.py` — what your *role* lets you do at all (a viewer never
     edits, whatever they own).
  2. this module — whether a *particular object* is in scope for you.

Both must say yes. A membership can never lift you above your role: inviting a
viewer to a dashboard as "editor" still leaves them read-only, because the role
check runs first. That keeps one obvious place to answer "how did they get in?"

The read-through rule
---------------------
Access to a dashboard grants access to the *data its widgets show*, never to
the *data sources behind them*. Someone invited to a dashboard can read its
numbers, but cannot see the source's hostname, cannot select it when building
a widget, and cannot run an ad-hoc query through it.

This mirrors how public share links already work, and it is the whole reason
sharing is usable: otherwise every invite would need a second grant on each
source, and people would work around that by making everything workspace-wide.

Admins
------
Admins can reach everything. They manage users and credentials and can read the
database directly, so hiding rows from them in the API would be theatre rather
than security — better to be honest about it than to imply a boundary that
isn't real.
"""
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .models import (
    VISIBILITY_PRIVATE, VISIBILITY_WORKSPACE, Dashboard, DashboardMember, DataSource,
    DataSourceMember, User,
)
from .permissions import ADMIN, can

EDITOR_ROLE = "editor"
VIEWER_ROLE = "viewer"
MEMBER_ROLES = (VIEWER_ROLE, EDITOR_ROLE)


def is_admin(user: User) -> bool:
    return user.role == ADMIN


# --------------------------------------------------------------------------
# dashboards
# --------------------------------------------------------------------------

def dashboard_member_role(db: Session, dashboard_id: int, user_id: int) -> str | None:
    m = (db.query(DashboardMember)
         .filter(DashboardMember.dashboard_id == dashboard_id,
                 DashboardMember.user_id == user_id).first())
    return m.role if m else None


def can_view_dashboard(db: Session, user: User, d: Dashboard) -> bool:
    if not can(user, "dashboard.view"):
        return False
    if is_admin(user) or d.owner_id == user.id:
        return True
    if (d.visibility or VISIBILITY_WORKSPACE) == VISIBILITY_WORKSPACE:
        return True
    return dashboard_member_role(db, d.id, user.id) is not None


def can_edit_dashboard(db: Session, user: User, d: Dashboard) -> bool:
    # the role gate comes first: a viewer invited as "editor" is still a viewer
    if not can(user, "dashboard.edit"):
        return False
    if is_admin(user) or d.owner_id == user.id:
        return True
    if (d.visibility or VISIBILITY_WORKSPACE) == VISIBILITY_WORKSPACE:
        return True
    return dashboard_member_role(db, d.id, user.id) == EDITOR_ROLE


def can_manage_dashboard(db: Session, user: User, d: Dashboard) -> bool:
    """Change who it is shared with, its visibility, or delete it.

    Deliberately narrower than editing: a colleague invited to help build a
    dashboard should not be able to re-share it with people you excluded, or
    delete it out from under you.
    """
    return is_admin(user) or d.owner_id == user.id


def visible_dashboards(db: Session, user: User):
    """Query for the dashboards this user may list.

    Filtered in SQL rather than in Python so a private dashboard never reaches
    the process, and so paging stays correct if it is added later.
    """
    q = db.query(Dashboard)
    if is_admin(user):
        return q
    member_ids = (db.query(DashboardMember.dashboard_id)
                  .filter(DashboardMember.user_id == user.id))
    return q.filter(or_(
        Dashboard.visibility == VISIBILITY_WORKSPACE,
        Dashboard.visibility.is_(None),        # rows predating the column
        Dashboard.owner_id == user.id,
        Dashboard.id.in_(member_ids),
    ))


# --------------------------------------------------------------------------
# data sources
# --------------------------------------------------------------------------

def is_datasource_member(db: Session, datasource_id: int, user_id: int) -> bool:
    return (db.query(DataSourceMember)
            .filter(DataSourceMember.datasource_id == datasource_id,
                    DataSourceMember.user_id == user_id).first()) is not None


def can_use_datasource(db: Session, user: User, ds: DataSource) -> bool:
    """May build widgets on it and run ad-hoc queries through it.

    This is the gate that actually matters: for a SQL source, "use" means
    choosing the statement that runs against your database.
    """
    if not can(user, "datasource.view"):
        return False
    if is_admin(user) or ds.owner_id == user.id:
        return True
    if (ds.visibility or VISIBILITY_WORKSPACE) == VISIBILITY_WORKSPACE:
        return True
    return is_datasource_member(db, ds.id, user.id)


def can_edit_datasource(db: Session, user: User, ds: DataSource) -> bool:
    """Change the connection itself, including credentials.

    Ownership is the boundary. A workspace-wide source is shared
    infrastructure — a bad edit breaks every dashboard using it — so it stays
    with whoever set it up, and with admins.
    """
    return is_admin(user) or ds.owner_id == user.id


def can_manage_datasource(db: Session, user: User, ds: DataSource) -> bool:
    return can_edit_datasource(db, user, ds)


def visible_datasources(db: Session, user: User):
    q = db.query(DataSource)
    if is_admin(user):
        return q
    member_ids = (db.query(DataSourceMember.datasource_id)
                  .filter(DataSourceMember.user_id == user.id))
    return q.filter(or_(
        DataSource.visibility == VISIBILITY_WORKSPACE,
        DataSource.visibility.is_(None),
        DataSource.owner_id == user.id,
        DataSource.id.in_(member_ids),
    ))


def can_create_datasource(user: User) -> bool:
    """Editors may add their own sources; only admins may add shared ones.

    Enforced together with `visibility` in the router — an editor creating a
    workspace-wide source would be handing their credentials to everyone.
    """
    return can(user, "datasource.view")


def can_create_workspace_datasource(user: User) -> bool:
    return can(user, "datasource.edit")


# --------------------------------------------------------------------------
# helpers shared by the routers
# --------------------------------------------------------------------------

def normalize_member_role(role: str | None) -> str:
    role = (role or VIEWER_ROLE).lower()
    return role if role in MEMBER_ROLES else VIEWER_ROLE


def describe_dashboard_access(db: Session, user: User, d: Dashboard) -> dict:
    """What the UI needs to render the right controls for this user."""
    return {
        "is_owner": d.owner_id == user.id,
        "can_edit": can_edit_dashboard(db, user, d),
        "can_manage": can_manage_dashboard(db, user, d),
        "member_role": dashboard_member_role(db, d.id, user.id),
    }


def member_out(m, user: User | None) -> dict:
    return {
        "id": m.id,
        "user_id": m.user_id,
        "email": user.email if user else None,
        "role": getattr(m, "role", None),
        "created_at": m.created_at,
    }
