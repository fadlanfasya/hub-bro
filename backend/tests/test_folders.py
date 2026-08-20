"""Filing dashboards: folders, pins, and what they must not disturb."""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")
os.environ["DATABASE_URL"] = "sqlite:///./test_folders.db"
os.environ["ALERTS_ENABLED"] = "0"
os.environ["HEALTH_CHECK_INTERVAL"] = "0"
DB = Path(__file__).resolve().parent.parent / "test_folders.db"
if DB.exists(): DB.unlink()

from fastapi.testclient import TestClient
from app.auth import hash_password
from app.database import Base, SessionLocal, engine
from app.main import app
from app.models import User

Base.metadata.create_all(engine)
client = TestClient(app)
passed = failed = 0
def check(label, got, want):
    global passed, failed
    ok = got == want
    passed, failed = passed + ok, failed + (not ok)
    print(("  PASS  " if ok else "  FAIL  ") + label)
    if not ok: print("        got ", repr(got), "\n        want", repr(want))

s = SessionLocal()
s.add(User(email="a@x.com", hashed_password=hash_password("pw12345678"), role="admin", is_active=True))
s.commit(); s.close()
tok = client.post("/api/auth/login", data={"username":"a@x.com","password":"pw12345678"}).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}

print("a new dashboard starts unfiled")
d = client.post("/api/dashboards", headers=H, json={"name": "Network Management"}).json()
check("no folder", d["folder"], None)
check("not pinned", d["pinned"], False)

print("filing it")
r = client.put(f"/api/dashboards/{d['id']}", headers=H, json={"folder": "Network"}).json()
check("folder is set", r["folder"], "Network")
check("stray spacing is collapsed",
      client.put(f"/api/dashboards/{d['id']}", headers=H,
                 json={"folder": "  Net   Ops  "}).json()["folder"], "Net Ops")
check("an empty string takes it out again",
      client.put(f"/api/dashboards/{d['id']}", headers=H, json={"folder": ""}).json()["folder"], None)

print("filing is not editing")
before = client.get(f"/api/dashboards/{d['id']}", headers=H).json()["version"]
client.put(f"/api/dashboards/{d['id']}", headers=H, json={"folder": "Network"})
client.put(f"/api/dashboards/{d['id']}", headers=H, json={"pinned": True})
after = client.get(f"/api/dashboards/{d['id']}", headers=H).json()
check("the version does not move", after["version"], before)
check("so a colleague's open editor is not told it is stale", after["version"], before)
check("but the pin stuck", after["pinned"], True)
hist = client.get(f"/api/dashboards/{d['id']}/history", headers=H).json()
check("and no snapshot was burned on it", len(hist), 0)

print("renaming still bumps the version")
v = client.put(f"/api/dashboards/{d['id']}", headers=H, json={"name": "Renamed"}).json()
check("version moved", v["version"] > before, True)

print("a copy is filed alongside the original")
copy = client.post(f"/api/dashboards/{d['id']}/duplicate", headers=H).json()
check("same folder", copy["folder"], "Network")
check("but not pinned", copy["pinned"], False)

print("guarding the name")
check("too long is refused",
      client.put(f"/api/dashboards/{d['id']}", headers=H,
                 json={"folder": "x" * 61}).status_code, 400)
check("60 is fine",
      client.put(f"/api/dashboards/{d['id']}", headers=H,
                 json={"folder": "x" * 60}).status_code, 200)

print("omitting the field leaves it alone")
client.put(f"/api/dashboards/{d['id']}", headers=H, json={"folder": "Network"})
kept = client.put(f"/api/dashboards/{d['id']}", headers=H, json={"name": "Still here"}).json()
check("folder survives an unrelated save", kept["folder"], "Network")
check("pin survives too", kept["pinned"], True)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
