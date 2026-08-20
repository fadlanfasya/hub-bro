"""A report from schedule to gateway, through the real loop.

Run: python tests/test_reports_e2e.py
"""
import asyncio, json, os, sys, threading
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "unit-test-secret-key")
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ALERTS_ENABLED"] = "0"

from sqlalchemy import create_engine                      # noqa: E402
from sqlalchemy.orm import sessionmaker                   # noqa: E402
from app import alerting, reports                         # noqa: E402
from app.database import Base                             # noqa: E402
from app.models import AlertNotification, AlertRule, DataSource, User  # noqa: E402
from app.secrets_store import encrypt                     # noqa: E402

engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
Base.metadata.create_all(engine)
db = sessionmaker(bind=engine)()

passed = failed = 0
def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1; print(f"  PASS  {label}")
    else:
        failed += 1
        print(f"  FAIL  {label}\n        expected {expected!r}, got {actual!r}")

# --- a stand-in WhatsApp gateway -----------------------------------------
received = []
class Gateway(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        received.append({
            "body": json.loads(self.rfile.read(length) or b"{}"),
            "auth": self.headers.get("Authorization"),
        })
        self.send_response(200); self.send_header("Content-Length", "2")
        self.end_headers(); self.wfile.write(b"ok")
    def log_message(self, *a): pass

srv = HTTPServer(("127.0.0.1", 0), Gateway)
port = srv.server_address[1]
threading.Thread(target=srv.serve_forever, daemon=True).start()

# --- the rule -------------------------------------------------------------
user = User(email="a@x.com", hashed_password="x", role="admin", is_active=True)
db.add(user); db.commit()
ds = DataSource(name="GLPI", type="rest", config="{}", owner_id=user.id)
db.add(ds); db.commit()

rule = AlertRule(
    name="Laporan Tiket", enabled=True, datasource_id=ds.id, owner_id=user.id,
    mode="report",
    options=json.dumps({"url": "http://example.invalid"}),
    schedule=json.dumps({"at": "08:00", "timezone": "Asia/Jakarta"}),
    template="Breach {breach} | Warning {warning} | On track {on_track}",
    webhook=json.dumps({
        "url": encrypt(f"http://127.0.0.1:{port}/send"),
        "format": "custom",
        "headers": {"Authorization": encrypt("secret-token")},
        "body": '{"target": "6281234567890", "message": "{message}"}',
    }),
)
db.add(rule); db.commit()

# count_by has already collapsed the result to one row of named counts
FAKE = {"columns": ["breach", "warning", "on_track"],
        "rows": [{"breach": 2, "warning": 0, "on_track": 13}]}
async def fake_fetch(datasource, options):
    return FAKE
alerting.fetch_data = fake_fetch

print("a new report waits for its next slot")
asyncio.run(alerting.run_due_rules(db))
check("nothing sent on the first tick", len(received), 0)
check("but the clock is anchored", rule.last_report_at is not None, True)

print("when the time comes")
# pretend the last send was yesterday morning
rule.last_report_at = datetime.utcnow() - timedelta(days=1)
db.commit()
# force "now" past this morning's slot by claiming the schedule is 00:00
rule.schedule = json.dumps({"at": "00:00", "timezone": "Asia/Jakarta"})
db.commit()
asyncio.run(alerting.run_due_rules(db))
check("one message went out", len(received), 1)
check("to the gateway's own field name", received[0]["body"]["target"], "6281234567890")
check("with the numbers filled in",
      received[0]["body"]["message"].endswith("Breach 2 | Warning 0 | On track 13"), True)
check("the rule name leads it", "Laporan Tiket" in received[0]["body"]["message"], True)
check("the token travelled in a header, not the URL",
      received[0]["auth"], "secret-token")

print("it does not repeat")
asyncio.run(alerting.run_due_rules(db))
asyncio.run(alerting.run_due_rules(db))
check("three ticks, still one message", len(received), 1)

print("the delivery is recorded")
notes = db.query(AlertNotification).filter(AlertNotification.rule_id == rule.id).all()
check("history has the send", len(notes), 1)
check("marked delivered", notes[0].delivered, True)

print("a source that fails still produces a message")
async def broken_fetch(datasource, options):
    raise RuntimeError("GLPI refused the connection")
alerting.fetch_data = broken_fetch
rule.last_report_at = datetime.utcnow() - timedelta(days=1)
db.commit()
asyncio.run(alerting.run_due_rules(db))
check("silence is not the answer", len(received), 2)
check("and it says what went wrong",
      "GLPI refused the connection" in received[1]["body"]["message"], True)

print("a malformed body is reported, not swallowed")
alerting.fetch_data = fake_fetch
rule.webhook = json.dumps({
    "url": encrypt(f"http://127.0.0.1:{port}/send"), "format": "custom",
    "headers": {}, "body": '{"target": "628", "message": {message}}'})
rule.last_report_at = datetime.utcnow() - timedelta(days=1)
db.commit()
asyncio.run(alerting.run_due_rules(db))
check("nothing was posted", len(received), 2)
failures = [n for n in db.query(AlertNotification)
            .filter(AlertNotification.rule_id == rule.id).all() if not n.delivered]
check("but a failure is in the history", len(failures) >= 1, True)
check("naming the cause", "not valid JSON" in (failures[0].error or ""), True)

print("threshold rules are untouched")
plain = AlertRule(name="Old alarm", enabled=True, datasource_id=ds.id, owner_id=user.id,
                  mode="threshold", options="{}",
                  thresholds=json.dumps({"direction": "above", "critical": 1}),
                  interval_seconds=30,
                  webhook=json.dumps({"url": encrypt(f"http://127.0.0.1:{port}/send"),
                                      "format": "slack"}))
db.add(plain); db.commit()
before = len(received)
alerting.fetch_data = fake_fetch
asyncio.run(alerting.run_due_rules(db))
check("the threshold rule still evaluates and fires", len(received) > before, True)
check("using its own format, not the report one", "text" in received[-1]["body"], True)


print("the Test button uses the rule's own format")
# This is the bug that shipped: the test route built its own payload and so
# posted a generic body to a gateway that needs session + chatId.
waha = AlertRule(
    name="WA test", enabled=True, datasource_id=ds.id, owner_id=user.id,
    mode="threshold", options="{}",
    thresholds=json.dumps({"direction": "above", "critical": 1}),
    webhook=json.dumps({
        "url": encrypt(f"http://127.0.0.1:{port}/api/sendText"),
        "format": "custom",
        "headers": {"X-Api-Key": encrypt("waha-key")},
        "body": '{"session": "test", "chatId": "628@c.us", "text": "{message}"}',
    }),
)
db.add(waha); db.commit()

before = len(received)
payload = alerting.payload_for(waha, "ok", None, "hello", "test")
check("the test payload carries the session", payload.get("session"), "test")
check("and the recipient", payload.get("chatId"), "628@c.us")
check("and uses text, not message", "text" in payload and "message" not in payload, True)

import asyncio as _asyncio  # noqa: E402
ok, err = _asyncio.run(alerting.send_webhook(waha.webhook_dict, payload))
check("it delivers", ok, True)
check("with the api key header", received[-1]["auth"] is None, True)
check("sent to the gateway", len(received), before + 1)

bad = AlertRule(name="broken", enabled=True, datasource_id=ds.id, owner_id=user.id,
                mode="threshold", options="{}", thresholds="{}",
                webhook=json.dumps({"url": encrypt("http://x"), "format": "custom",
                                    "body": "not json"}))
try:
    alerting.payload_for(bad, "ok", None, "hi", "test")
    check("a broken body is refused before sending", "no error", "ValueError")
except ValueError:
    check("a broken body is refused before sending", True, True)

srv.shutdown()
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
