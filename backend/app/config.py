"""Application settings, read from environment variables (.env supported)."""
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv():
    """Minimal .env loader so we don't need an extra dependency."""
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv()


def _bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


class Settings:
    # "development" | "production" — production refuses unsafe defaults
    ENV: str = os.environ.get("ENV", "development").strip().lower()
    IS_PRODUCTION: bool = ENV == "production"

    # --- security ---
    # A random key is generated when unset so dev still works, but it changes on
    # every restart (invalidating tokens). Required in production.
    SECRET_KEY: str = os.environ.get("SECRET_KEY") or secrets.token_urlsafe(48)
    SECRET_KEY_IS_EPHEMERAL: bool = not os.environ.get("SECRET_KEY")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = _int("ACCESS_TOKEN_EXPIRE_MINUTES", 60 * 24)

    # --- database ---
    DATABASE_URL: str = os.environ.get("DATABASE_URL", f"sqlite:///{BASE_DIR / 'hubbro.db'}")

    # --- CORS ---
    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.environ.get(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",") if o.strip()
    ]

    # --- data fetching ---
    CACHE_TTL_SECONDS: int = _int("CACHE_TTL_SECONDS", 15)
    CACHE_ENABLED: bool = _bool("CACHE_ENABLED", True)
    # Optional: share the cache across workers, e.g. redis://redis:6379/0.
    # Empty means an in-process cache (fine for a single worker).
    REDIS_URL: str = os.environ.get("REDIS_URL", "").strip()
    FETCH_TIMEOUT_SECONDS: int = _int("FETCH_TIMEOUT_SECONDS", 30)

    UPLOAD_DIR: Path = Path(os.environ.get("UPLOAD_DIR", BASE_DIR / "uploads"))

    # --- serving the built frontend ---
    # When this directory holds a build, the API also serves the UI on the same
    # port. Empty in development, where Vite serves it instead.
    STATIC_DIR: Path = Path(os.environ.get("STATIC_DIR", BASE_DIR / "static"))

    # Trust X-Forwarded-* headers. Enable when running behind nginx/IIS/a load
    # balancer so redirects and logged client IPs are correct.
    TRUST_PROXY: bool = _bool("TRUST_PROXY", False)


settings = Settings()
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def check_production_config() -> list[str]:
    """Return a list of fatal misconfigurations for a production start."""
    problems = []
    if not settings.IS_PRODUCTION:
        return problems

    if settings.SECRET_KEY_IS_EPHEMERAL:
        problems.append(
            "SECRET_KEY is not set. Every restart would invalidate all logins, and "
            "stored credentials would become unreadable. Generate one with:\n"
            '    python -c "import secrets; print(secrets.token_urlsafe(48))"'
        )
    if len(settings.SECRET_KEY) < 32 and not settings.SECRET_KEY_IS_EPHEMERAL:
        problems.append("SECRET_KEY is too short — use at least 32 characters.")
    if "*" in settings.CORS_ORIGINS:
        problems.append(
            "CORS_ORIGINS is '*', which lets any website call this API with a "
            "user's credentials. List your real origins instead."
        )
    return problems
