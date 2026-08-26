"""Login throttling through the real route.

Run: python tests/test_login_guard_http.py
"""
import os, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")
os.environ["DATABASE_URL"] = "sqlite:///./test_login_guard.db"
os.environ["ALERTS_ENABLED"] = "0"
os.environ["HEALTH_CHECK_INTERVAL"] = "0"
DB = Path(__file__).resolve().parent.parent / "test_login_guard.db"
if DB.exists():
    DB.unlink()

from fastapi.testclient import TestClient          # noqa: E402
from app.auth import hash_password                 # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
from app.login_guard import MAX_ATTEMPTS, guard    # noqa: E402
from app.main import app                           # noqa: E402
from app.models import User                        # noqa: E402

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


s = SessionLocal()
s.add(User(email="a@x.com", hashed_password=hash_password("correct-horse"),
           role="admin", is_active=True))
s.add(User(email="off@x.com", hashed_password=hash_password("correct-horse"),
           role="viewer", is_active=False))
s.commit(); s.close()


def login(email, password):
    return client.post("/api/auth/login", data={"username": email, "password": password})


print("the right password works")
guard.forget()
check("200 and a token", login("a@x.com", "correct-horse").status_code, 200)

print("guessing gets throttled")
guard.forget()
codes = [login("a@x.com", "wrong").status_code for _ in range(MAX_ATTEMPTS + 2)]
check("the first attempts are plain rejections", codes[:MAX_ATTEMPTS], [401] * MAX_ATTEMPTS)
check("then it turns into 429", codes[-1], 429)

r = login("a@x.com", "wrong")
check("with a Retry-After header", "retry-after" in {k.lower() for k in r.headers}, True)
check("and a header a client can act on", int(r.headers["retry-after"]) > 0, True)

print("the throttle applies before the password is checked")
check("even the right password waits its turn",
      login("a@x.com", "correct-horse").status_code, 429)

print("it says nothing about who exists")
guard.forget()
unknown = [login("nobody@x.com", "wrong").status_code for _ in range(MAX_ATTEMPTS + 1)]
check("an unknown address is throttled the same way", unknown[-1], 429)
guard.forget()
check("and the wording never differs",
      login("nobody@x.com", "wrong").json()["detail"],
      login("a@x.com", "wrong").json()["detail"])

print("one account's lockout doesn't spread")
guard.forget()
for _ in range(MAX_ATTEMPTS + 1):
    login("locked@x.com", "wrong")
# same client address, so only the account counter should be in force here
check("a different account still gets in",
      login("a@x.com", "correct-horse").status_code, 200)

print("a deactivated account")
guard.forget()
check("is refused with 403, not 401", login("off@x.com", "correct-horse").status_code, 403)
codes = [login("off@x.com", "correct-horse").status_code for _ in range(MAX_ATTEMPTS + 2)]
check("and a correct password never counts as a guess", set(codes), {403})

print("a success clears the count")
guard.forget()
for _ in range(MAX_ATTEMPTS - 1):
    login("a@x.com", "wrong")
check("signing in works", login("a@x.com", "correct-horse").status_code, 200)
codes = [login("a@x.com", "wrong").status_code for _ in range(MAX_ATTEMPTS - 1)]
check("and the slate is clean afterwards", set(codes), {401})

guard.forget()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
