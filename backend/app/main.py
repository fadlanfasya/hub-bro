import logging
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import migrations, static_files
from .config import check_production_config, settings
from .database import Base, engine
from .routers import auth_routes, dashboards, data, datasources, public, users

log = logging.getLogger("uvicorn.error")

# Fail fast rather than run a production deployment with unsafe defaults.
problems = check_production_config()
if problems:
    for p in problems:
        log.error("Refusing to start: %s", p)
    sys.exit(1)

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
app.include_router(public.router)


@app.get("/api/health")
def health():
    from . import cache
    return {"status": "ok", "env": settings.ENV, "cache": cache.backend_name()}


# Must come last: the SPA fallback claims every unmatched non-/api route.
static_files.mount(app, settings.STATIC_DIR)
