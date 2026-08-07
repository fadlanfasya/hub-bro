"""End-to-end access control through the real HTTP routes.

Run: python tests/test_access_http.py

The unit tests in test_access.py prove the *rules* are right. These prove the
*routes actually call them* — a distinction that is the difference between a
correct access model and a data breach, because a single route that forgets to
check is the whole story.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")
os.environ["DATABASE_URL"] = "sqlite:///./test_access_http.db"
os.environ["ALERTS_ENABLED"] = "0"
os.environ["HEALTH_CHECK_INTERVAL"] = "0"

DB_FILE = Path(__file__).resolve().parent.parent / "test_access_http.db"
if DB_FILE.exists():
    DB_FILE.unlink()

from fastapi.testclient import TestClient  # noqa: E402

from app.auth import hash_password  # noqa: E402
from app.database import SessionLocal, engine  # noqa: E402
from app.database import Base  # noqa: E402
from app.main import app  # noqa: E402
from app.models import User  # noqa: E402

Base.metadata.create_all(engine)
client = TestClient(app)

passed = failed = 0


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}, got {actual!r}")


def seed_user(email, role):
    db = SessionLocal()
    try:
        if not db.query(User).filter(User.email == email).first():
            db.add(User(email=email, hashed_password=hash_password("pw12345678"),
                        role=role, is_active=True))
            db.commit()
    finally:
        db.close()


def token(email):
    r = client.post("/api/auth/login", data={"username": email, "password": "pw12345678"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


for email, role in [("admin@x.com", "admin"), ("alice@x.com", "editor"),
                    ("bob@x.com", "editor"), ("vera@x.com", "viewer")]:
    seed_user(email, role)

ADMIN, ALICE, BOB, VERA = (token("admin@x.com"), token("alice@x.com"),
                           token("bob@x.com"), token("vera@x.com"))

print("setting the scene")
ds = client.post("/api/datasources", headers=ALICE, json={
    "name": "Alice private DB", "type": "rest",
    "config": {"url": "http://payroll.internal/api"}, "visibility": "private"}).json()
check("an editor can create a private source", "id" in ds, True)

pub = client.post("/api/datasources", headers=ADMIN, json={
    "name": "Shared Doris", "type": "rest", "config": {"url": "http://doris/api"},
    "visibility": "workspace"}).json()
check("an admin can create a workspace source", "id" in pub, True)

r = client.post("/api/datasources", headers=ALICE, json={
    "name": "Sneaky public", "type": "rest", "config": {}, "visibility": "workspace"})
check("an editor cannot publish a source to everyone", r.status_code, 403)

# private from the moment it is created — never briefly visible to everyone
dash = client.post("/api/dashboards", headers=ALICE,
                   json={"name": "Salary review", "visibility": "private"}).json()
check("a dashboard can be created private", dash["visibility"], "private")
check("and is immediately hidden from a colleague",
      dash["id"] in [d["id"] for d in client.get("/api/dashboards", headers=BOB).json()], False)
check("omitting visibility still defaults to workspace",
      client.post("/api/dashboards", headers=ALICE,
                  json={"name": "Default vis"}).json()["visibility"], "workspace")
check("a bogus visibility is rejected",
      client.post("/api/dashboards", headers=ALICE,
                  json={"name": "Bad", "visibility": "everyone"}).status_code, 400)
client.put(f"/api/dashboards/{dash['id']}", headers=ALICE, json={"definition": {
    "widgets": [{"id": "w1", "type": "table", "datasource_id": ds["id"],
                 "options": {"url": "http://payroll.internal/api"}}], "layout": []}})

team = client.post("/api/dashboards", headers=ADMIN, json={"name": "Ops wall"}).json()

print("a colleague cannot reach a private dashboard through any route")
check("GET by id is a 404, not a 403",
      client.get(f"/api/dashboards/{dash['id']}", headers=BOB).status_code, 404)
check("it is absent from the list",
      dash["id"] in [d["id"] for d in client.get("/api/dashboards", headers=BOB).json()], False)
check("PUT is refused",
      client.put(f"/api/dashboards/{dash['id']}", headers=BOB,
                 json={"name": "hijacked"}).status_code, 404)
check("DELETE is refused",
      client.delete(f"/api/dashboards/{dash['id']}", headers=BOB).status_code, 404)
check("creating a public share link is refused",
      client.post(f"/api/dashboards/{dash['id']}/share", headers=BOB).status_code, 404)
check("history is refused",
      client.get(f"/api/dashboards/{dash['id']}/history", headers=BOB).status_code, 404)
check("duplicating it is refused",
      client.post(f"/api/dashboards/{dash['id']}/duplicate", headers=BOB).status_code, 404)
check("reading its widget data is refused",
      client.post(f"/api/data/dashboards/{dash['id']}/widgets/w1", headers=BOB).status_code, 404)
check("adding themselves as a member is refused",
      client.post(f"/api/dashboards/{dash['id']}/members", headers=BOB,
                  json={"email": "bob@x.com", "role": "editor"}).status_code, 404)

print("a private source is unreachable too")
check("it is absent from Bob's source list",
      ds["id"] in [s["id"] for s in client.get("/api/datasources", headers=BOB).json()], False)
check("an ad-hoc query through it is refused",
      client.post("/api/data/fetch", headers=BOB,
                  json={"datasource_id": ds["id"], "options": {}}).status_code, 404)
check("editing it is refused",
      client.put(f"/api/datasources/{ds['id']}", headers=BOB,
                 json={"name": "mine now"}).status_code, 404)
check("deleting it is refused",
      client.delete(f"/api/datasources/{ds['id']}", headers=BOB).status_code, 404)
check("building an alert rule on it is refused",
      client.post("/api/alerts", headers=BOB, json={
          "name": "leak", "datasource_id": ds["id"],
          "thresholds": {"direction": "above", "warn": 1},
          "webhook": {"url": "https://example.invalid/h", "format": "generic"},
      }).status_code, 400)

print("after an invite, the dashboard opens but the source does not")
client.post(f"/api/dashboards/{dash['id']}/members", headers=ALICE,
            json={"email": "bob@x.com", "role": "viewer"})
check("Bob can now open the dashboard",
      client.get(f"/api/dashboards/{dash['id']}", headers=BOB).status_code, 200)
check("and it is in his list",
      dash["id"] in [d["id"] for d in client.get("/api/dashboards", headers=BOB).json()], True)
check("a viewer-member still cannot save changes",
      client.put(f"/api/dashboards/{dash['id']}", headers=BOB,
                 json={"name": "renamed"}).status_code, 403)
check("the source stays invisible",
      ds["id"] in [s["id"] for s in client.get("/api/datasources", headers=BOB).json()], False)
check("and ad-hoc queries through it are still refused",
      client.post("/api/data/fetch", headers=BOB,
                  json={"datasource_id": ds["id"], "options": {}}).status_code, 404)

print("owner and admin keep full control")
check("Alice can still edit her dashboard",
      client.put(f"/api/dashboards/{dash['id']}", headers=ALICE,
                 json={"name": "Salary review 2026"}).status_code, 200)
check("an admin can open it",
      client.get(f"/api/dashboards/{dash['id']}", headers=ADMIN).status_code, 200)
check("an admin can query the private source",
      client.post("/api/data/fetch", headers=ADMIN,
                  json={"datasource_id": ds["id"], "options": {}}).status_code in (200, 502), True)

print("the workspace still works as it always did")
check("Bob sees the team dashboard",
      team["id"] in [d["id"] for d in client.get("/api/dashboards", headers=BOB).json()], True)
check("Bob can edit it",
      client.put(f"/api/dashboards/{team['id']}", headers=BOB,
                 json={"name": "Ops wall v2"}).status_code, 200)
check("Bob sees the shared source",
      pub["id"] in [s["id"] for s in client.get("/api/datasources", headers=BOB).json()], True)
check("a viewer can read the team dashboard",
      client.get(f"/api/dashboards/{team['id']}", headers=VERA).status_code, 200)
check("a viewer cannot edit it",
      client.put(f"/api/dashboards/{team['id']}", headers=VERA,
                 json={"name": "nope"}).status_code, 403)
check("a viewer cannot list data sources at all",
      client.get("/api/datasources", headers=VERA).status_code, 403)

print("credentials never travel to the client")
body = client.get("/api/datasources", headers=ADMIN).text
check("no plaintext ciphertext prefix leaks", "enc:v1:" in body, False)

print("revoking removes access at once")
members = client.get(f"/api/dashboards/{dash['id']}/members", headers=ALICE).json()
bob_id = next(m["user_id"] for m in members if m["email"] == "bob@x.com")
check("revoking succeeds",
      client.delete(f"/api/dashboards/{dash['id']}/members/{bob_id}",
                    headers=ALICE).status_code, 200)
check("Bob is locked out again",
      client.get(f"/api/dashboards/{dash['id']}", headers=BOB).status_code, 404)
check("and its data is unreachable again",
      client.post(f"/api/data/dashboards/{dash['id']}/widgets/w1",
                  headers=BOB).status_code, 404)

if DB_FILE.exists():
    DB_FILE.unlink()

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
