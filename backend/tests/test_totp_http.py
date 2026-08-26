"""Enrolling in and using a second factor, through the real routes.

Run: python tests/test_totp_http.py
"""
import os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")
os.environ["DATABASE_URL"] = "sqlite:///./test_totp_http.db"
os.environ["ALERTS_ENABLED"] = "0"
os.environ["HEALTH_CHECK_INTERVAL"] = "0"
DB = Path(__file__).resolve().parent.parent / "test_totp_http.db"
if DB.exists():
    DB.unlink()

from fastapi.testclient import TestClient           # noqa: E402
from app import totp as totp_lib                    # noqa: E402
from app.auth import hash_password                  # noqa: E402
from app.database import Base, SessionLocal, engine # noqa: E402
from app.login_guard import guard                   # noqa: E402
from app.main import app                            # noqa: E402
from app.models import User                         # noqa: E402

Base.metadata.create_all(engine)
client = TestClient(app)
passed = failed = 0
PW = "correct-horse"


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}, got {actual!r}")


s = SessionLocal()
s.add(User(email="a@x.com", hashed_password=hash_password(PW), role="admin", is_active=True))
s.commit(); s.close()


def login(reset=True, **extra):
    # Most cases want a clean slate; the throttling case must NOT reset between
    # attempts, or it proves nothing.
    if reset:
        guard.forget()
    return client.post("/api/auth/login",
                       data={"username": "a@x.com", "password": PW, **extra})


tok = login().json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}

print("nobody is opted in by default")
check("off to begin with", client.get("/api/auth/totp", headers=H).json()["enabled"], False)
check("and login needs no code", login().status_code, 200)

print("enrolling")
check("the wrong password can't start it",
      client.post("/api/auth/totp/setup", headers=H, json={"password": "nope"}).status_code, 403)

setup = client.post("/api/auth/totp/setup", headers=H, json={"password": PW}).json()
secret = setup["secret"]
check("a secret comes back", len(secret) >= 32, True)
check("with a scannable URI", setup["uri"].startswith("otpauth://totp/"), True)
check("but it is not in force yet",
      client.get("/api/auth/totp", headers=H).json()["enabled"], False)
check("so login still works without a code", login().status_code, 200)

print("a mis-scanned QR cannot lock you out")
check("a wrong code refuses to enable",
      client.post("/api/auth/totp/enable", headers=H, json={"code": "000000"}).status_code, 400)
check("still off", client.get("/api/auth/totp", headers=H).json()["enabled"], False)

print("confirming with a real code")
enabled = client.post("/api/auth/totp/enable", headers=H,
                      json={"code": totp_lib.code_at(secret)}).json()
codes = enabled["recovery_codes"]
check("now on", client.get("/api/auth/totp", headers=H).json()["enabled"], True)
check("eight recovery codes, shown once", len(codes), 8)
check("and counted", client.get("/api/auth/totp", headers=H).json()["recovery_codes_left"], 8)

print("signing in now asks for the code")
r = login()
check("password alone is refused", r.status_code, 401)
check("and the client is told why", r.json()["detail"]["mfa_required"], True)
check("a wrong code is refused",
      login(totp_code="000000").status_code, 401)
check("the right code gets in",
      login(totp_code=totp_lib.code_at(secret)).status_code, 200)

print("a recovery code works once")
check("it signs you in", login(totp_code=codes[0]).status_code, 200)
check("it is used up",
      client.get("/api/auth/totp", headers=H).json()["recovery_codes_left"], 7)
check("and cannot be reused", login(totp_code=codes[0]).status_code, 401)

print("a wrong second factor still counts as a failed attempt")
guard.forget()
seen = [login(reset=False, totp_code="000000").status_code for _ in range(8)]
check("the first few are plain rejections", seen[0], 401)
check("brute-forcing the code is throttled too", 429 in seen, True)
check("and a correct code cannot slip through while locked",
      login(reset=False, totp_code=totp_lib.code_at(secret)).status_code, 429)

print("turning it off")
guard.forget()
check("needs the password",
      client.post("/api/auth/totp/disable", headers=H,
                  json={"password": "nope", "code": totp_lib.code_at(secret)}).status_code, 403)
check("and a valid code",
      client.post("/api/auth/totp/disable", headers=H,
                  json={"password": PW, "code": "000000"}).status_code, 403)
check("then it turns off",
      client.post("/api/auth/totp/disable", headers=H,
                  json={"password": PW, "code": totp_lib.code_at(secret)}).status_code, 200)
check("login is back to one step", login().status_code, 200)
check("and the secret is gone",
      client.get("/api/auth/totp", headers=H).json()["recovery_codes_left"], 0)

print("one person's choice is their own")
s = SessionLocal()
s.add(User(email="b@x.com", hashed_password=hash_password(PW), role="editor", is_active=True))
s.commit(); s.close()
guard.forget()
check("a colleague who didn't opt in is unaffected",
      client.post("/api/auth/login",
                  data={"username": "b@x.com", "password": PW}).status_code, 200)

guard.forget()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
