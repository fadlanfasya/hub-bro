# ---- stage 1: build the frontend ----
FROM node:20-alpine AS frontend

WORKDIR /build
# copy manifests first so npm ci is cached until dependencies actually change
COPY frontend/package.json frontend/package-lock.json* ./
# npm ci for a reproducible build; fall back when the lockfile is out of sync
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY frontend/ ./
RUN npm run build


# ---- stage 2: runtime ----
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    ENV=production \
    STATIC_DIR=/app/static \
    DATABASE_URL=sqlite:////data/hubbro.db \
    UPLOAD_DIR=/data/uploads

WORKDIR /app

# curl is used by the container healthcheck
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

COPY backend/app ./app
COPY --from=frontend /build/dist ./static

# run as a non-root user; /data is a volume so it must be writable by that user
RUN useradd --create-home --uid 10001 hubbro \
    && mkdir -p /data/uploads \
    && chown -R hubbro:hubbro /app /data
USER hubbro

VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health || exit 1

# --proxy-headers so client IPs and scheme are correct behind a reverse proxy.
# One worker on purpose: the response cache is per-process (see README).
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--proxy-headers", "--forwarded-allow-ips", "*"]
