"""Serve the built frontend from the API process.

In development the frontend runs on Vite's dev server (port 5173) and proxies
/api to here. In production there is no Vite: the built bundle is copied into
STATIC_DIR and served from this same process, so the whole app lives on one port.

Client-side routes like /dashboards/3 or /shared/<token> don't exist on disk, so
anything that isn't a real file falls back to index.html and React Router takes
over. /api paths are excluded so a wrong URL there still returns a JSON 404
rather than a page of HTML.
"""
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("uvicorn.error")

API_PREFIXES = ("/api", "/docs", "/redoc", "/openapi.json")


def mount(app: FastAPI, static_dir: Path) -> bool:
    """Mount the SPA if a build is present. Returns True when mounted."""
    index = static_dir / "index.html"
    if not index.exists():
        log.info("No frontend build at %s — running API only "
                 "(use the Vite dev server for the UI).", static_dir)
        return False

    # hashed assets can be cached hard; index.html must not be
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.exception_handler(StarletteHTTPException)
    async def spa_fallback(request, exc):
        if exc.status_code == 404 and not request.url.path.startswith(API_PREFIXES):
            return FileResponse(index, headers={"Cache-Control": "no-cache"})
        return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)

    @app.get("/", include_in_schema=False)
    async def spa_root():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})

    # files that sit at the root of the build (favicon, logo, manifest…)
    for item in static_dir.iterdir():
        if item.is_file() and item.name != "index.html":
            app.add_api_route(
                f"/{item.name}",
                _file_route(item),
                methods=["GET"],
                include_in_schema=False,
            )

    log.info("Serving frontend from %s", static_dir)
    return True


def _file_route(path: Path):
    async def route():
        return FileResponse(path)
    return route
