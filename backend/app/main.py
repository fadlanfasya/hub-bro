import asyncio
import json
import logging
import sys

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import migrations, static_files
from .config import check_production_config, settings
from .database import Base, engine, SessionLocal
from .models import Dashboard, User
from . import access
from .routers import alerts, auth_routes, dashboards, data, datasources, public, users
from .presence import presence, user_from_token

log = logging.getLogger("uvicorn.error")

# Fail fast rather than run a production deployment with unsafe defaults.
problems = check_production_config()
if problems:
    for p in problems:
        log.error("Refusing to start: %s", p)
    sys.exit(1)

# Development only: an unset SECRET_KEY is regenerated on every start, which
# silently makes credentials saved in a previous run undecryptable. They read
# back as empty, so a data source that worked before the restart now fails to
# authenticate — with no obvious connection to the restart.
if settings.SECRET_KEY_IS_EPHEMERAL:
    log.warning(
        "SECRET_KEY is not set, so a new one was generated for this run. "
        "Any data source credentials saved earlier can no longer be decrypted "
        "and will need re-entering. Set SECRET_KEY to keep them across restarts."
    )

migrations.run(engine)          # add columns missing from an older database
Base.metadata.create_all(bind=engine)

if settings.SECRET_KEY_IS_EPHEMERAL:
    log.warning(
        "SECRET_KEY is not set — using a random key that changes on every restart, "
        "so logins won't survive a reload. Copy backend/.env.example to backend/.env "
        "and set SECRET_KEY."
    )

app = FastAPI(
    title="Hub-Bro",
    description="Unified dashboard platform",
    docs_url=None if settings.IS_PRODUCTION else "/docs",
    redoc_url=None if settings.IS_PRODUCTION else "/redoc",
)

if settings.TRUST_PROXY:
    from starlette.middleware.trustedhost import TrustedHostMiddleware  # noqa: F401
    # uvicorn handles X-Forwarded-* when started with --proxy-headers;
    # this flag exists so the compose file and docs stay in one place.
    log.info("Trusting X-Forwarded-* headers from the reverse proxy")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(users.router)
app.include_router(datasources.router)
app.include_router(dashboards.router)
app.include_router(data.router)
app.include_router(alerts.router)
app.include_router(public.router)


@app.websocket("/api/presence/{dashboard_id}")
async def dashboard_presence(websocket: WebSocket, dashboard_id: str, token: str = ""):
    user = user_from_token(token)
    try:
        dashboard_key = int(dashboard_id)
    except ValueError:
        dashboard_key = 0

    with SessionLocal() as db:
        dashboard = db.query(Dashboard).filter(Dashboard.id == dashboard_key).first()
        allowed = user is not None and dashboard is not None \
            and access.can_view_dashboard(db, user, dashboard)

    if not allowed:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    users = await presence.connect(dashboard_id, user.id, websocket)

    def room_payload(current_users):
        with SessionLocal() as db:
            rows = db.query(User).filter(User.id.in_(current_users)).all()
            collaborators = [{"id": row.id, "email": row.email, "role": row.role}
                             for row in rows]
        return {"type": "presence", "dashboard_id": dashboard_id,
                "users": current_users, "collaborators": collaborators}

    await presence.broadcast(dashboard_id, room_payload(users))
    try:
        while True:
            message = await websocket.receive_text()
            try:
                event = json.loads(message)
            except (TypeError, ValueError):
                continue
            if event.get("type") != "cursor":
                continue

            cursor = event.get("cursor")
            if cursor is not None:
                try:
                    x, y = float(cursor["x"]), float(cursor["y"])
                    if not (0 <= x <= 10000 and 0 <= y <= 10000):
                        continue
                    cursor = {
                        "x": round(x, 1), "y": round(y, 1),
                        "widget_id": str(cursor.get("widget_id")) if cursor.get("widget_id") else None,
                    }
                except (KeyError, TypeError, ValueError):
                    continue
            cursors = await presence.update_cursor(dashboard_id, user.id, websocket, cursor)
            await presence.broadcast(dashboard_id, {
                "type": "cursors", "dashboard_id": dashboard_id, "cursors": cursors,
            })
    except WebSocketDisconnect:
        users = await presence.disconnect_socket(dashboard_id, user.id, websocket)
        await presence.broadcast(dashboard_id, room_payload(users))


@app.get("/api/health")
def health():
    from . import cache
    return {"status": "ok", "env": settings.ENV, "cache": cache.backend_name()}


@app.on_event("startup")
async def start_health_monitor():
    """Probe monitored data sources on a timer.

    Only sources with `monitor: true` are checked, so this stays idle until you
    opt one in — enabling it never starts hammering every connected database.
    """
    if settings.HEALTH_CHECK_INTERVAL <= 0:
        return
    from . import health as health_mod
    from .database import SessionLocal
    app.state.health_task = asyncio.create_task(
        health_mod.monitor_loop(SessionLocal, settings.HEALTH_CHECK_INTERVAL)
    )


@app.on_event("startup")
async def start_alert_scheduler():
    """Evaluate alert rules on a timer.

    Runs independently of anyone having a browser open — an alarm that only
    fires while a dashboard is being watched is not an alarm.
    """
    if not settings.ALERTS_ENABLED or settings.ALERT_TICK_SECONDS <= 0:
        return
    from . import alerting
    app.state.alert_task = asyncio.create_task(alerting.alert_loop())


@app.on_event("shutdown")
async def stop_background_tasks():
    for name in ("health_task", "alert_task"):
        task = getattr(app.state, name, None)
        if task:
            task.cancel()


# Must come last: the SPA fallback claims every unmatched non-/api route.
static_files.mount(app, settings.STATIC_DIR)
