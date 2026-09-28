from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from jose import jwt

from app.auth import ALGORITHM, SECRET_KEY
from app.main import app


def test_presence_rejects_missing_token():
    with TestClient(app) as client:
        with client.websocket_connect("/api/presence/1") as websocket:
            assert False, "invalid websocket handshake should fail"


def test_presence_broadcasts_authenticated_user():
    token = jwt.encode({"sub": "1", "exp": datetime.utcnow() + timedelta(minutes=5)}, SECRET_KEY, algorithm=ALGORITHM)
    with TestClient(app) as client:
        with client.websocket_connect(f"/api/presence/1?token={token}") as websocket:
            message = websocket.receive_json()
            assert message["type"] == "presence"
            assert message["users"] == [1]
