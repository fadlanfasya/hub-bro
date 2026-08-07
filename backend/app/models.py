import json
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint,
)
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


# Visibility values shared by dashboards and data sources.
#   workspace — everyone whose role allows it (the historical behaviour)
#   private   — the owner, anyone explicitly invited, and admins
VISIBILITY_WORKSPACE = "workspace"
VISIBILITY_PRIVATE = "private"
VISIBILITIES = (VISIBILITY_WORKSPACE, VISIBILITY_PRIVATE)


class DataSource(Base):
    __tablename__ = "datasources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # rest | csv | prometheus | glpi | sql | truewatch
    type = Column(String, nullable=False)
    # workspace | private — see VISIBILITIES above
    visibility = Column(String, nullable=False, default=VISIBILITY_WORKSPACE)
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
    members = relationship("DataSourceMember", cascade="all, delete-orphan",
                           back_populates="datasource")

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


class AlertRule(Base):
    """A saved query plus a threshold, evaluated on a timer.

    Alerting is deliberately independent of dashboards. A rule that only fired
    while someone had the right tab open would be worthless, and tying rules to
    widgets would mean deleting a widget silently disables the alarm.
    """
    __tablename__ = "alert_rules"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)

    datasource_id = Column(Integer, ForeignKey("datasources.id"), nullable=False, index=True)
    # JSON: the same options a widget uses (query, itemtype, range_minutes, …)
    options = Column(Text, nullable=False, default="{}")
    # which column to read, and how to reduce multiple rows to one number
    value_field = Column(String, nullable=True)
    aggregate = Column(String, nullable=False, default="first")  # first|sum|avg|min|max|count

    # JSON: {direction: above|below, warn: n, critical: n}
    thresholds = Column(Text, nullable=False, default="{}")

    interval_seconds = Column(Integer, nullable=False, default=300)
    # how many consecutive breaching evaluations before firing — the flap guard
    for_evaluations = Column(Integer, nullable=False, default=1)
    # re-send a reminder while still breaching; 0 disables reminders
    repeat_minutes = Column(Integer, nullable=False, default=0)
    notify_on_recovery = Column(Boolean, nullable=False, default=True)

    # JSON: {url, format} — url is encrypted, it is a bearer credential
    webhook = Column(Text, nullable=False, default="{}")

    # --- evaluation state ---
    # the level we last *notified* about, so we only speak up on change
    state = Column(String, nullable=False, default="unknown")
    pending_level = Column(String, nullable=True)
    pending_count = Column(Integer, nullable=False, default=0)
    last_value = Column(String, nullable=True)
    last_error = Column(String, nullable=True)
    last_checked_at = Column(DateTime, nullable=True)
    last_notified_at = Column(DateTime, nullable=True)
    state_since = Column(DateTime, nullable=True)

    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    datasource = relationship("DataSource")
    notifications = relationship("AlertNotification", back_populates="rule",
                                 cascade="all, delete-orphan",
                                 order_by="AlertNotification.id.desc()")

    @property
    def options_dict(self) -> dict:
        return json.loads(self.options or "{}")

    @property
    def thresholds_dict(self) -> dict:
        return json.loads(self.thresholds or "{}")

    @property
    def webhook_dict(self) -> dict:
        """Webhook config with the URL decrypted — for delivery only."""
        from .secrets_store import decrypt
        raw = json.loads(self.webhook or "{}")
        return {**raw, "url": decrypt(raw.get("url") or "")}

    @property
    def safe_webhook_dict(self) -> dict:
        """Webhook config safe to return over the API.

        A Slack webhook URL *is* the credential — anyone holding it can post to
        the channel — so it is masked like a password rather than shown.
        """
        from .secrets_store import MASK
        raw = json.loads(self.webhook or "{}")
        return {**raw, "url": MASK if raw.get("url") else ""}


class AlertNotification(Base):
    """One delivery attempt, kept so you can prove an alert was (or wasn't) sent."""
    __tablename__ = "alert_notifications"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("alert_rules.id"), nullable=False, index=True)
    level = Column(String, nullable=False)          # ok | warn | critical | error
    value = Column(String, nullable=True)
    message = Column(String, nullable=True)
    # fired | recovered | reminder | test
    reason = Column(String, nullable=False, default="fired")
    delivered = Column(Boolean, nullable=False, default=False)
    error = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    rule = relationship("AlertRule", back_populates="notifications")


class Dashboard(Base):
    __tablename__ = "dashboards"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    # JSON blob: {widgets: [{id, type, title, datasource_id, options}], layout: [...react-grid-layout items]}
    definition = Column(Text, nullable=False, default='{"widgets": [], "layout": []}')
    # workspace | private — controls who can find it when signed in. Separate
    # from share_token, which is anonymous access for anyone holding the URL.
    visibility = Column(String, nullable=False, default=VISIBILITY_WORKSPACE)
    # random token when the dashboard has a public link; NULL when it has none
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
    members = relationship("DashboardMember", cascade="all, delete-orphan",
                           back_populates="dashboard")


class DashboardMember(Base):
    """Someone invited to a specific dashboard.

    A membership grants access to *this dashboard* regardless of visibility,
    and to the data its widgets show — but never to the data sources
    themselves. See access.py for why that distinction matters.
    """
    __tablename__ = "dashboard_members"

    id = Column(Integer, primary_key=True, index=True)
    dashboard_id = Column(Integer, ForeignKey("dashboards.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    # viewer | editor — capped by the user's global role, never above it
    role = Column(String, nullable=False, default="viewer")
    created_at = Column(DateTime, default=datetime.utcnow)

    dashboard = relationship("Dashboard", back_populates="members")
    user = relationship("User")

    __table_args__ = (UniqueConstraint("dashboard_id", "user_id", name="uq_dashboard_member"),)


class DataSourceMember(Base):
    """Someone granted use of a private data source.

    Grants building widgets on it and running ad-hoc queries through it.
    Editing the connection itself stays with the owner and admins.
    """
    __tablename__ = "datasource_members"

    id = Column(Integer, primary_key=True, index=True)
    datasource_id = Column(Integer, ForeignKey("datasources.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    datasource = relationship("DataSource", back_populates="members")
    user = relationship("User")

    __table_args__ = (UniqueConstraint("datasource_id", "user_id", name="uq_datasource_member"),)


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
