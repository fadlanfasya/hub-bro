"""Access control tests, written as attempted break-ins.

Run: python tests/test_access.py

Each case asks "can this person get at something they shouldn't?" and expects
no. Positive cases are included too, because an access model that denies
everything passes a security test and fails the users.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")
os.environ["DATABASE_URL"] = "sqlite://"      # in-memory, nothing touches disk

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import access  # noqa: E402
from app.database import Base  # noqa: E402
from app.models import (  # noqa: E402
    Dashboard, DashboardMember, DataSource, DataSourceMember, User,
)

engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
Base.metadata.create_all(engine)
db = sessionmaker(bind=engine)()

passed = failed = 0


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}, got {actual!r}")


def denied(label, actual):
    check(label, actual, False)


def allowed(label, actual):
    check(label, actual, True)


# --- cast ---------------------------------------------------------------
admin = User(email="admin@x.com", hashed_password="x", role="admin", is_active=True)
alice = User(email="alice@x.com", hashed_password="x", role="editor", is_active=True)
bob = User(email="bob@x.com", hashed_password="x", role="editor", is_active=True)
vera = User(email="vera@x.com", hashed_password="x", role="viewer", is_active=True)
db.add_all([admin, alice, bob, vera])
db.commit()

# Alice's private things, Bob is the outsider
alice_private_db = DataSource(name="Alice payroll DB", type="sql", visibility="private",
                              config="{}", owner_id=alice.id)
shared_db = DataSource(name="Ops Doris", type="sql", visibility="workspace",
                       config="{}", owner_id=admin.id)
legacy_db = DataSource(name="Legacy source", type="rest", visibility=None,
                       config="{}", owner_id=admin.id)
db.add_all([alice_private_db, shared_db, legacy_db])

alice_private_dash = Dashboard(name="Alice salary review", visibility="private",
                               definition="{}", owner_id=alice.id)
team_dash = Dashboard(name="Ops wall", visibility="workspace",
                      definition="{}", owner_id=admin.id)
legacy_dash = Dashboard(name="Pre-upgrade dashboard", visibility=None,
                        definition="{}", owner_id=admin.id)
db.add_all([alice_private_dash, team_dash, legacy_dash])
db.commit()

print("a private dashboard is invisible to a colleague")
denied("Bob cannot view it", access.can_view_dashboard(db, bob, alice_private_dash))
denied("Bob cannot edit it", access.can_edit_dashboard(db, bob, alice_private_dash))
denied("Bob cannot re-share or delete it", access.can_manage_dashboard(db, bob, alice_private_dash))
denied("it is absent from Bob's list",
       alice_private_dash.id in [d.id for d in access.visible_dashboards(db, bob).all()])
allowed("Alice still sees her own", access.can_view_dashboard(db, alice, alice_private_dash))
allowed("and it is in her list",
        alice_private_dash.id in [d.id for d in access.visible_dashboards(db, alice).all()])

print("inviting someone grants exactly what was granted")
db.add(DashboardMember(dashboard_id=alice_private_dash.id, user_id=bob.id, role="viewer"))
db.commit()
allowed("Bob can now view it", access.can_view_dashboard(db, bob, alice_private_dash))
allowed("and it appears in his list",
        alice_private_dash.id in [d.id for d in access.visible_dashboards(db, bob).all()])
denied("but a viewer-member still cannot edit", access.can_edit_dashboard(db, bob, alice_private_dash))
denied("and cannot re-share it to others",
       access.can_manage_dashboard(db, bob, alice_private_dash))

print("the read-through rule: the dashboard, not the source")
# Bob can now read Alice's dashboard, which is built on her private database
denied("Bob still cannot use the source behind it",
       access.can_use_datasource(db, bob, alice_private_db))
denied("Bob cannot edit that source", access.can_edit_datasource(db, bob, alice_private_db))
denied("and the source is not in his list",
       alice_private_db.id in [s.id for s in access.visible_datasources(db, bob).all()])

print("promoting a member to editor")
m = db.query(DashboardMember).filter(DashboardMember.user_id == bob.id).first()
m.role = "editor"
db.commit()
allowed("an editor-member can edit", access.can_edit_dashboard(db, bob, alice_private_dash))
denied("but still cannot manage sharing", access.can_manage_dashboard(db, bob, alice_private_dash))

print("a membership can never outrank the account role")
db.add(DashboardMember(dashboard_id=alice_private_dash.id, user_id=vera.id, role="editor"))
db.commit()
allowed("Vera the viewer can see it", access.can_view_dashboard(db, vera, alice_private_dash))
denied("but 'editor' on the membership does not make her one",
       access.can_edit_dashboard(db, vera, alice_private_dash))
denied("and she cannot edit the workspace dashboard either",
       access.can_edit_dashboard(db, vera, team_dash))

print("private data sources")
denied("Bob cannot use Alice's private source",
       access.can_use_datasource(db, bob, alice_private_db))
allowed("Alice can use her own", access.can_use_datasource(db, alice, alice_private_db))
allowed("Alice can edit her own", access.can_edit_datasource(db, alice, alice_private_db))
allowed("everyone with source access sees the workspace one",
        access.can_use_datasource(db, bob, shared_db))
denied("but Bob cannot edit a source he does not own",
       access.can_edit_datasource(db, bob, shared_db))
denied("a viewer never reaches sources at all",
       access.can_use_datasource(db, vera, shared_db))

print("granting source access")
db.add(DataSourceMember(datasource_id=alice_private_db.id, user_id=bob.id))
db.commit()
allowed("Bob can now query through it", access.can_use_datasource(db, bob, alice_private_db))
allowed("and it appears in his list",
        alice_private_db.id in [s.id for s in access.visible_datasources(db, bob).all()])
denied("but he still cannot change its credentials",
       access.can_edit_datasource(db, bob, alice_private_db))

print("admins")
allowed("an admin sees a private dashboard",
        access.can_view_dashboard(db, admin, alice_private_dash))
allowed("an admin can manage it", access.can_manage_dashboard(db, admin, alice_private_dash))
allowed("an admin can use a private source",
        access.can_use_datasource(db, admin, alice_private_db))
allowed("an admin's list includes everything",
        len(access.visible_dashboards(db, admin).all()) == db.query(Dashboard).count())

print("rows created before the upgrade stay visible")
# The migration backfills a default, but a NULL must not lock people out of
# their existing dashboards.
allowed("a NULL-visibility dashboard is still readable",
        access.can_view_dashboard(db, bob, legacy_dash))
allowed("and still listed",
        legacy_dash.id in [d.id for d in access.visible_dashboards(db, bob).all()])
allowed("a NULL-visibility source is still usable",
        access.can_use_datasource(db, bob, legacy_db))

print("only admins can publish a source to everyone")
denied("an editor cannot create a workspace-wide source",
       access.can_create_workspace_datasource(alice))
allowed("an admin can", access.can_create_workspace_datasource(admin))
allowed("an editor can still create their own", access.can_create_datasource(alice))
denied("a viewer cannot create sources at all", access.can_create_datasource(vera))

print("revoking access takes effect immediately")
db.delete(db.query(DashboardMember)
          .filter(DashboardMember.user_id == bob.id,
                  DashboardMember.dashboard_id == alice_private_dash.id).first())
db.commit()
denied("Bob loses sight of the dashboard",
       access.can_view_dashboard(db, bob, alice_private_dash))
denied("and it leaves his list",
       alice_private_dash.id in [d.id for d in access.visible_dashboards(db, bob).all()])

print("workspace content is unaffected by all of this")
allowed("Bob sees the team dashboard", access.can_view_dashboard(db, bob, team_dash))
allowed("Bob can edit the team dashboard", access.can_edit_dashboard(db, bob, team_dash))
allowed("Vera can view it", access.can_view_dashboard(db, vera, team_dash))
denied("Vera cannot edit it", access.can_edit_dashboard(db, vera, team_dash))
denied("Bob cannot delete a dashboard he does not own",
       access.can_manage_dashboard(db, bob, team_dash))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
