#!/usr/bin/env bash
# Version history and concurrent-edit protection.
# Run from backend/:  bash tests/test_history.sh
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1";
  else FAIL=$((FAIL+1)); echo "  FAIL  $1 — expected '$3', got '$2'"; fi
}
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

export SECRET_KEY="test-secret-history"
export DATABASE_URL="sqlite:////tmp/hubbro-history-test.db"
rm -f /tmp/hubbro-history-test.db

python3 -m uvicorn app.main:app --port 8015 > /tmp/uv-history.log 2>&1 & API=$!
trap 'kill $API 2>/dev/null' EXIT
for _ in $(seq 1 25); do curl -s localhost:8015/api/health >/dev/null && break; sleep 1; done

B=localhost:8015
JSON="Content-Type: application/json"
curl -s -X POST $B/api/auth/register -H "$JSON" -d '{"email":"a@t.com","password":"secret1234"}' > /dev/null
A="Authorization: Bearer $(curl -s -X POST $B/api/auth/login -d 'username=a@t.com&password=secret1234' | jq_ "d['access_token']")"
curl -s -X POST $B/api/users -H "$A" -H "$JSON" -d '{"email":"b@t.com","password":"secret1234","role":"editor"}' > /dev/null
BTOK="Authorization: Bearer $(curl -s -X POST $B/api/auth/login -d 'username=b@t.com&password=secret1234' | jq_ "d['access_token']")"

echo "versioning"
D=$(curl -s -X POST $B/api/dashboards -H "$A" -H "$JSON" -d '{"name":"Ops"}')
check "new dashboard starts at version 1" "$(echo "$D" | jq_ "d['version']")" "1"

R=$(curl -s -X PUT $B/api/dashboards/1 -H "$A" -H "$JSON" -d '{"name":"Ops v2","version":1}')
check "a save bumps the version" "$(echo "$R" | jq_ "d['version']")" "2"
check "the change applied" "$(echo "$R" | jq_ "d['name']")" "Ops v2"

echo "concurrent edits"
check "a stale version is rejected" \
  "$(code -X PUT $B/api/dashboards/1 -H "$BTOK" -H "$JSON" -d '{"name":"clobbered","version":1}')" "409"
check "the rejected write did not apply" \
  "$(curl -s $B/api/dashboards/1 -H "$A" | jq_ "d['name']")" "Ops v2"
check "saving with the current version succeeds" \
  "$(code -X PUT $B/api/dashboards/1 -H "$BTOK" -H "$JSON" -d '{"name":"Ops v3","version":2}')" "200"
check "omitting the version still works (older clients)" \
  "$(code -X PUT $B/api/dashboards/1 -H "$A" -H "$JSON" -d '{"name":"Ops v4"}')" "200"

echo "history"
H=$(curl -s $B/api/dashboards/1/history -H "$A")
check "snapshots were recorded" "$(echo "$H" | jq_ "len(d) >= 3")" "True"
check "newest first" "$(echo "$H" | jq_ "d[0]['version'] > d[-1]['version']")" "True"
check "author recorded" "$(echo "$H" | jq_ "d[0]['author_email'] in ('a@t.com','b@t.com')")" "True"
check "the oldest snapshot holds the original name" \
  "$(echo "$H" | jq_ "d[-1]['name']")" "Ops"

echo "restore"
OLDEST=$(echo "$H" | jq_ "d[-1]['id']")
R=$(curl -s -X POST $B/api/dashboards/1/history/$OLDEST/restore -H "$A")
check "restore brings back the old name" "$(echo "$R" | jq_ "d['name']")" "Ops"
check "restore bumps the version rather than rewinding it" \
  "$(echo "$R" | jq_ "d['version'] > 4")" "True"
check "restoring is itself undoable" \
  "$(curl -s $B/api/dashboards/1/history -H "$A" | jq_ "any('before restoring' in (s['note'] or '') for s in d)")" "True"
check "an unknown snapshot is rejected" \
  "$(code -X POST $B/api/dashboards/1/history/9999/restore -H "$A")" "404"
check "a snapshot from another dashboard is rejected" \
  "$(curl -s -X POST $B/api/dashboards -H "$A" -H "$JSON" -d '{"name":"Other"}' > /dev/null; \
     code -X POST $B/api/dashboards/2/history/$OLDEST/restore -H "$A")" "404"

echo "debounce and widget counts"
BEFORE=$(curl -s $B/api/dashboards/1/history -H "$A" | jq_ "len(d)")
curl -s -X PUT $B/api/dashboards/1 -H "$A" -H "$JSON" -d '{
  "definition":{"widgets":[{"id":"w1","type":"text","title":"A","options":{}},
                           {"id":"w2","type":"text","title":"B","options":{}}],"layout":[]}}' > /dev/null
curl -s -X PUT $B/api/dashboards/1 -H "$A" -H "$JSON" -d '{"name":"After widgets"}' > /dev/null
curl -s -X PUT $B/api/dashboards/1 -H "$A" -H "$JSON" -d '{"name":"Again"}' > /dev/null
AFTER=$(curl -s $B/api/dashboards/1/history -H "$A" | jq_ "len(d)")
# layout auto-save fires every ~600ms while dragging; without debouncing, the
# history would fill with near-identical entries and bury the useful ones
check "three rapid saves by one author add at most one snapshot" \
  "$([ $((AFTER - BEFORE)) -le 1 ] && echo yes)" "yes"
check "the dashboard still saved despite the debounce" \
  "$(curl -s $B/api/dashboards/1 -H "$A" | jq_ "d['name']")" "Again"

# a restore always snapshots, bypassing the debounce, so it captures the
# current state including the widgets added above
NEWEST=$(curl -s $B/api/dashboards/1/history -H "$A" | jq_ "d[0]['id']")
curl -s -X POST $B/api/dashboards/1/history/$NEWEST/restore -H "$A" > /dev/null
check "a snapshot records how many widgets it held" \
  "$(curl -s $B/api/dashboards/1/history -H "$A" | jq_ "max(s['widget_count'] for s in d)")" "2"

echo "permissions"
curl -s -X POST $B/api/users -H "$A" -H "$JSON" -d '{"email":"v@t.com","password":"secret1234","role":"viewer"}' > /dev/null
V="Authorization: Bearer $(curl -s -X POST $B/api/auth/login -d 'username=v@t.com&password=secret1234' | jq_ "d['access_token']")"
check "viewers cannot see history" "$(code $B/api/dashboards/1/history -H "$V")" "403"
check "viewers cannot restore" "$(code -X POST $B/api/dashboards/1/history/$OLDEST/restore -H "$V")" "403"
check "history needs a token" "$(code $B/api/dashboards/1/history)" "401"

echo "cleanup"
curl -s -X DELETE $B/api/dashboards/1 -H "$A" > /dev/null
check "deleting a dashboard removes its history" \
  "$(python3 -c "
import sqlite3
c = sqlite3.connect('/tmp/hubbro-history-test.db')
print(c.execute('select count(*) from dashboard_snapshots where dashboard_id=1').fetchone()[0])")" "0"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
