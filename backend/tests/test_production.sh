#!/usr/bin/env bash
# Production-mode checks: config guards, SPA serving, persistence.
# Mirrors what the Docker image does, without needing Docker.
#
# Run from backend/:  bash tests/test_production.sh [path-to-frontend-dist]
set -u
cd "$(dirname "$0")/.."

DIST="${1:-../frontend/dist}"
PASS=0; FAIL=0
check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1";
  else FAIL=$((FAIL+1)); echo "  FAIL  $1 — expected '$3', got '$2'"; fi
}
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

DATA_DIR=/tmp/hubbro-prod-test
rm -rf "$DATA_DIR"; mkdir -p "$DATA_DIR/uploads"

echo "config guards"
OUT=$(ENV=production SECRET_KEY= DATABASE_URL="sqlite:///$DATA_DIR/x.db" \
      python3 -c "import app.main" 2>&1)
check "production refuses to start without SECRET_KEY" \
  "$(echo "$OUT" | grep -c 'SECRET_KEY is not set')" "1"

OUT=$(ENV=production SECRET_KEY=short DATABASE_URL="sqlite:///$DATA_DIR/x.db" \
      python3 -c "import app.main" 2>&1)
check "production rejects a short SECRET_KEY" "$(echo "$OUT" | grep -c 'too short')" "1"

OUT=$(ENV=production SECRET_KEY="$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')" \
      CORS_ORIGINS="*" DATABASE_URL="sqlite:///$DATA_DIR/x.db" \
      python3 -c "import app.main" 2>&1)
check "production rejects wildcard CORS" "$(echo "$OUT" | grep -c 'CORS_ORIGINS')" "1"

OUT=$(ENV=development SECRET_KEY= DATABASE_URL="sqlite:///$DATA_DIR/x.db" \
      python3 -c "import app.main; print('started')" 2>&1)
check "development still starts without a key" "$(echo "$OUT" | grep -c 'started')" "1"

echo "serving the app"
export ENV=production
export SECRET_KEY="production-test-key-that-is-long-enough-1234567890"
export DATABASE_URL="sqlite:///$DATA_DIR/hubbro.db"
export UPLOAD_DIR="$DATA_DIR/uploads"
export STATIC_DIR="$(cd "$DIST" 2>/dev/null && pwd)"
export CORS_ORIGINS="http://localhost:8020"

if [ -z "$STATIC_DIR" ]; then
  echo "  SKIP  no frontend build at $DIST — run 'npm run build' in frontend/ first"
  echo ""
  echo "$PASS passed, $FAIL failed"
  [ "$FAIL" -eq 0 ]; exit $?
fi

python3 -m uvicorn app.main:app --port 8020 > /tmp/uv-prod.log 2>&1 & API=$!
trap 'kill $API 2>/dev/null' EXIT
for _ in $(seq 1 25); do curl -s localhost:8020/api/health >/dev/null && break; sleep 1; done

check "health reports production" "$(curl -s localhost:8020/api/health | jq_ "d['env']")" "production"
check "api docs are disabled in production" "$(code localhost:8020/docs)" "404"

check "index is served at /" "$(curl -s localhost:8020/ | grep -c '<div id="root">')" "1"
ASSET=$(curl -s localhost:8020/ | grep -o '/assets/[^"]*\.js' | head -1)
check "hashed assets are served" "$(code "localhost:8020$ASSET")" "200"
check "favicon is served" "$(code localhost:8020/logo.svg)" "200"

echo "SPA routing"
for route in /datasources /dashboards/1 /shared/some-token; do
  check "deep link $route returns the app" "$(curl -s "localhost:8020$route" | grep -c '<div id="root">')" "1"
done
check "unknown API path still returns JSON 404" \
  "$(curl -s localhost:8020/api/nope | jq_ "'detail' in d")" "True"
check "unknown API path is not the SPA" "$(curl -s localhost:8020/api/nope | grep -c '<div id="root">')" "0"

echo "app works end to end"
JSON="Content-Type: application/json"
curl -s -X POST localhost:8020/api/auth/register -H "$JSON" \
  -d '{"email":"prod@t.com","password":"secret123"}' > /dev/null
TOKEN=$(curl -s -X POST localhost:8020/api/auth/login -d "username=prod@t.com&password=secret123" | jq_ "d['access_token']")
check "register + login work" "$([ ${#TOKEN} -gt 20 ] && echo yes)" "yes"
curl -s -X POST localhost:8020/api/dashboards -H "Authorization: Bearer $TOKEN" -H "$JSON" \
  -d '{"name":"Prod check"}' > /dev/null
check "dashboard created" \
  "$(curl -s localhost:8020/api/dashboards -H "Authorization: Bearer $TOKEN" | jq_ "len(d)")" "1"
check "database written to the data dir" "$([ -f "$DATA_DIR/hubbro.db" ] && echo yes)" "yes"

echo "persistence across restart"
kill $API 2>/dev/null; wait $API 2>/dev/null
python3 -m uvicorn app.main:app --port 8020 > /tmp/uv-prod2.log 2>&1 & API=$!
for _ in $(seq 1 25); do curl -s localhost:8020/api/health >/dev/null && break; sleep 1; done
NEW=$(curl -s -X POST localhost:8020/api/auth/login -d "username=prod@t.com&password=secret123" | jq_ "d['access_token']")
check "account survives a restart" "$([ ${#NEW} -gt 20 ] && echo yes)" "yes"
check "old token still valid (stable SECRET_KEY)" \
  "$(code localhost:8020/api/dashboards -H "Authorization: Bearer $TOKEN")" "200"
check "dashboard survives a restart" \
  "$(curl -s localhost:8020/api/dashboards -H "Authorization: Bearer $NEW" | jq_ "d[0]['name']")" "Prod check"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
