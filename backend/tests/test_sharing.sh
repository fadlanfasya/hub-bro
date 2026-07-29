#!/usr/bin/env bash
# Sharing, duplication, credential masking and public-access isolation.
# Run from backend/:  bash tests/test_sharing.sh
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1";
  else FAIL=$((FAIL+1)); echo "  FAIL  $1 — expected '$3', got '$2'"; fi
}
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

export SECRET_KEY="test-secret-sharing"
export DATABASE_URL="sqlite:////tmp/hubbro-share-test.db"
rm -f /tmp/hubbro-share-test.db

python3 tests/mock_glpi.py & MOCK=$!
python3 -m uvicorn app.main:app --port 8013 > /tmp/uv-share.log 2>&1 & API=$!
trap 'kill $MOCK $API 2>/dev/null' EXIT
for _ in $(seq 1 25); do curl -s localhost:8013/api/health >/dev/null && break; sleep 1; done

JSON="Content-Type: application/json"
reg() { curl -s -X POST localhost:8013/api/auth/register -H "$JSON" -d "{\"email\":\"$1\",\"password\":\"secret123\"}" > /dev/null
        curl -s -X POST localhost:8013/api/auth/login -d "username=$1&password=secret123" | jq_ "d.get('access_token','')"; }

# the first account becomes admin; a second is created by that admin
OWNER="Authorization: Bearer $(reg owner@t.com)"
curl -s -X POST localhost:8013/api/users -H "$OWNER" -H "$JSON" \
  -d '{"email":"other@t.com","password":"secret123","role":"viewer"}' > /dev/null
OTHER="Authorization: Bearer $(curl -s -X POST localhost:8013/api/auth/login \
  -d 'username=other@t.com&password=secret123' | jq_ "d['access_token']")"

echo "credential masking"
curl -s -X POST localhost:8013/api/datasources -H "$OWNER" -H "$JSON" -d '{
  "name":"GLPI","type":"glpi",
  "config":{"base_url":"http://127.0.0.1:9997","app_token":"APP-SECRET","user_token":"test-user-token"}
}' > /dev/null
DS=$(curl -s localhost:8013/api/datasources -H "$OWNER")
check "user_token is masked in the API" "$(echo "$DS" | jq_ "d[0]['config']['user_token']")" "••••••••"
check "app_token is masked in the API" "$(echo "$DS" | jq_ "d[0]['config']['app_token']")" "••••••••"
check "base_url stays visible" "$(echo "$DS" | jq_ "d[0]['config']['base_url']")" "http://127.0.0.1:9997"
check "secret is not stored as plaintext" \
  "$(python3 -c "
import sqlite3;print('APP-SECRET' in sqlite3.connect('/tmp/hubbro-share-test.db').execute('select config from datasources').fetchone()[0])")" "False"

# saving back the masked value must not destroy the stored credential
curl -s -X PUT localhost:8013/api/datasources/1 -H "$OWNER" -H "$JSON" -d '{
  "name":"GLPI renamed",
  "config":{"base_url":"http://127.0.0.1:9997","app_token":"••••••••","user_token":"••••••••"}
}' > /dev/null
R=$(curl -s -X POST localhost:8013/api/data/fetch -H "$OWNER" -H "$JSON" \
  -d '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":10}}')
check "credentials survive an edit that sends the mask" "$(echo "$R" | jq_ "len(d['rows'])")" "10"

echo "dashboards"
curl -s -X POST localhost:8013/api/dashboards -H "$OWNER" -H "$JSON" -d '{"name":"Ops"}' > /dev/null
curl -s -X PUT localhost:8013/api/dashboards/1 -H "$OWNER" -H "$JSON" -d '{
  "definition":{"widgets":[{"id":"w1","type":"table","title":"VMs","datasource_id":1,
    "options":{"itemtype":"Computer","max_rows":10}}],
    "layout":[{"i":"w1","x":0,"y":0,"w":6,"h":4}]}}' > /dev/null

D=$(curl -s -X POST localhost:8013/api/dashboards/1/duplicate -H "$OWNER")
check "duplicate is named (copy)" "$(echo "$D" | jq_ "d['name']")" "Ops (copy)"
check "duplicate keeps the widgets" "$(echo "$D" | jq_ "len(d['definition']['widgets'])")" "1"
check "duplicate is a new dashboard" "$(echo "$D" | jq_ "d['id']")" "2"
check "duplicate is not shared" "$(echo "$D" | jq_ "d['share_token'] is None")" "True"

echo "sharing"
check "dashboard starts private" "$(curl -s localhost:8013/api/dashboards/1 -H "$OWNER" | jq_ "d['share_token'] is None")" "True"
TOKEN=$(curl -s -X POST localhost:8013/api/dashboards/1/share -H "$OWNER" | jq_ "d['share_token']")
check "share returns a token" "$([ ${#TOKEN} -gt 20 ] && echo yes)" "yes"
check "sharing twice keeps the same token" \
  "$(curl -s -X POST localhost:8013/api/dashboards/1/share -H "$OWNER" | jq_ "d['share_token']")" "$TOKEN"

P=$(curl -s localhost:8013/api/public/dashboards/$TOKEN)
check "public view works without auth" "$(echo "$P" | jq_ "d['name']")" "Ops"
check "public view is flagged read-only" "$(echo "$P" | jq_ "d['read_only']")" "True"
check "datasource ids are not exposed" "$(echo "$P" | jq_ "'datasource_id' in d['definition']['widgets'][0]")" "False"

PD=$(curl -s -X POST localhost:8013/api/public/dashboards/$TOKEN/data -H "$JSON" -d '{"widget_id":"w1"}')
check "public data fetch works" "$(echo "$PD" | jq_ "len(d['rows'])")" "10"

echo "public access is scoped to the shared dashboard"
check "unknown widget id is rejected" \
  "$(code -X POST localhost:8013/api/public/dashboards/$TOKEN/data -H "$JSON" -d '{"widget_id":"nope"}')" "404"
check "a bad token is rejected" "$(code localhost:8013/api/public/dashboards/not-a-real-token)" "404"
check "public endpoint cannot reach the private dashboard" \
  "$(code localhost:8013/api/public/dashboards/2)" "404"
check "authed endpoints still need a token" "$(code localhost:8013/api/dashboards)" "401"
# dashboards are workspace-wide, so a viewer can read them but change nothing
check "a viewer can open the dashboard" \
  "$(code localhost:8013/api/dashboards/1 -H "$OTHER")" "200"
check "a viewer cannot share it" \
  "$(code -X POST localhost:8013/api/dashboards/1/share -H "$OTHER")" "403"
check "a viewer cannot query the data source directly" \
  "$(code -X POST localhost:8013/api/data/fetch -H "$OTHER" -H "$JSON" -d '{"datasource_id":1,"options":{}}')" "403"
check "a viewer cannot even list data sources" \
  "$(code localhost:8013/api/datasources -H "$OTHER")" "403"

echo "revoking"
curl -s -X DELETE localhost:8013/api/dashboards/1/share -H "$OWNER" > /dev/null
check "revoked link stops working" "$(code localhost:8013/api/public/dashboards/$TOKEN)" "404"
check "revoked data endpoint stops working" \
  "$(code -X POST localhost:8013/api/public/dashboards/$TOKEN/data -H "$JSON" -d '{"widget_id":"w1"}')" "404"
NEW=$(curl -s -X POST localhost:8013/api/dashboards/1/share -H "$OWNER" | jq_ "d['share_token']")
check "re-sharing issues a different token" "$([ "$NEW" != "$TOKEN" ] && echo yes)" "yes"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
