import asyncio
from collections import defaultdict

from fastapi import WebSocket
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from .auth import ALGORITHM, SECRET_KEY
from .database import SessionLocal
from .models import User


class Presence:
    def __init__(self):
        # One account may have several dashboard tabs open. Keep every socket
        # so closing one tab does not remove the account from the room.
        self.rooms = defaultdict(lambda: defaultdict(set))
        self.cursors = defaultdict(dict)
        self.lock = asyncio.Lock()

    async def connect(self, dashboard_id: str, user_id: int, websocket: WebSocket):
        async with self.lock:
            self.rooms[dashboard_id][user_id].add(websocket)
            self.cursors[dashboard_id][websocket] = {"user_id": user_id}
            return list(self.rooms[dashboard_id])

    async def update_cursor(self, dashboard_id: str, user_id: int, websocket: WebSocket,
                            cursor: dict | None):
        async with self.lock:
            if websocket not in self.rooms.get(dashboard_id, {}).get(user_id, set()):
                return []
            if cursor is None:
                self.cursors[dashboard_id].pop(websocket, None)
            else:
                self.cursors[dashboard_id][websocket] = {"user_id": user_id, **cursor}
            latest = {}
            for state in self.cursors[dashboard_id].values():
                if "x" in state and "y" in state:
                    latest[state["user_id"]] = state
            return list(latest.values())

    async def disconnect_socket(self, dashboard_id: str, user_id: int, websocket: WebSocket):
        async with self.lock:
            sockets = self.rooms.get(dashboard_id, {}).get(user_id)
            if sockets:
                sockets.discard(websocket)
                if not sockets:
                    self.rooms[dashboard_id].pop(user_id, None)
            self.cursors.get(dashboard_id, {}).pop(websocket, None)
            users = list(self.rooms.get(dashboard_id, {}))
            if not users:
                self.rooms.pop(dashboard_id, None)
                self.cursors.pop(dashboard_id, None)
            return users

    async def broadcast(self, dashboard_id: str, payload: dict):
        async with self.lock:
            peers = [socket for sockets in self.rooms.get(dashboard_id, {}).values()
                     for socket in sockets]
        await asyncio.gather(*(peer.send_json(payload) for peer in peers), return_exceptions=True)


presence = Presence()


def user_from_token(token: str) -> User | None:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError):
        return None
    with SessionLocal() as db:  # Validate deactivation at handshake time.
        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_active:
            return None
        db.expunge(user)
        return user
