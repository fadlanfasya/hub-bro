import json
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    # admin | editor | viewer — see app/permissions.py for the matrix
    role = Column(String, nullable=False, default="viewer")
    # deactivated users keep their data but cannot log in
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login_at = Column(DateTime, nullable=True)

    # Dashboards and data sources belong to the workspace, not to a person —
    # `owner` records who created them. Deleting a user must not delete shared
    # content, so there is deliberately no delete cascade here.
    datasources = relationship("DataSource", back_populates="owner")
    dashboards = relationship("Dashboard", back_populates="owner")


class DataSource(Base):
    __tablename__ = "datasources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # rest | csv | prometheus | glpi | sql
    type = Column(String, nullable=False)
    # JSON blob. Secret fields (tokens, passwords, header values) are stored
    # encrypted — always go through config_dict / raw_config_dict rather than
    # parsing this column directly.
    config = Column(Text, nullable=False, default="{}")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="datasources")
    checks = relationship("DataSourceCheck", cascade="all, delete-orphan",
                          primaryjoin="DataSource.id == DataSourceCheck.datasource_id",
                          foreign_keys="DataSourceCheck.datasource_id")

    @property
    def raw_config_dict(self) -> dict:
        """Config exactly as stored (secrets still encrypted)."""
        return json.loads(self.config or "{}")

    @property
    def config_dict(self) -> dict:
        """Config with secrets decrypted — for connector use only."""
        from .secrets_store import decrypt_config
        return decrypt_config(self.raw_config_dict)

    @property
    def safe_config_dict(self) -> dict:
        """Config with secrets masked — safe to return over the API."""
        from .secrets_store import mask_config
        return mask_config(self.raw_config_dict)


class DataSourceCheck(Base):
    """One health check result for a data source.

    Written both by real widget fetches and by the optional background monitor,
    so the health page reflects what actually happened rather than a synthetic
    probe alone. Capped per source — see health.MAX_CHECKS_PER_SOURCE.
    """
    __tablename__ = "datasource_checks"

    id = Column(Integer, primary_key=True, index=True)
    datasource_id = Column(Integer, ForeignKey("datasources.id"), nullable=False, index=True)
    ok = Column(Boolean, nullable=False)
    error = Column(String, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    # "fetch" when a widget triggered it, "monitor" for the background timer,
    # "manual" when someone pressed Test
    source = Column(String, nullable=False, default="fetch")
    checked_at = Column(DateTime, default=datetime.utcnow, index=True)


class Dashboard(Base):
    __tablename__ = "dashboards"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # JSON blob: {widgets: [{id, type, title, datasource_id, options}], layout: [...react-grid-layout items]}
    definition = Column(Text, nullable=False, default='{"widgets": [], "layout": []}')
    # random token when the dashboard is shared read-only; NULL when private
    share_token = Column(String, unique=True, index=True, nullable=True)
    # bumped on every save; a client sending a stale number is rejected so two
    # editors can't silently overwrite each other
    version = Column(Integer, nullable=False, default=1)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    owner = relationship("User", back_populates="dashboards")
    snapshots = relationship("DashboardSnapshot", back_populates="dashboard",
                             cascade="all, delete-orphan",
                             order_by="DashboardSnapshot.id.desc()")


class DashboardSnapshot(Base):
    """A point-in-time copy of a dashboard, taken before each save.

    Lets you undo someone else's change (or your own) rather than losing work
    permanently. Retention is capped per dashboard — see routers/dashboards.py.
    """
    __tablename__ = "dashboard_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(Integer, ForeignKey("dashboards.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    definition = Column(Text, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    # who made the change this snapshot replaced, kept as text so deleting a
    # user doesn't erase the history trail
    author_email = Column(String, nullable=True)
    note = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    dashboard = relationship("Dashboard", back_populates="snapshots")
