#!/usr/bin/env bash
# Data source health: probes per type, passive recording, permissions.
# Run from backend/:  bash tests/test_health.sh
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1";
  else FAIL=$((FAIL+1)); echo "  FAIL  $1 — expected '$3', got '$2'"; fi
}
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

export SECRET_KEY="test-secret-health"
export DATABASE_URL="sqlite:////tmp/hubbro-health-test.db"
export HEALTH_CHECK_INTERVAL=0     # background monitor off; we probe explicitly
rm -f /tmp/hubbro-health-test.db /tmp/health-probe.csv
printf 'a,b\n1,2\n' > /tmp/health-probe.csv

python3 tests/mock_glpi.py & MOCK=$!
python3 -m uvicorn app.main:app --port 8016 > /tmp/uv-health.log 2>&1 & API=$!
trap 'kill $MOCK $API 2>/dev/null' EXIT
for _ in $(seq 1 25); do curl -s localhost:8016/api/health >/dev/null && break; sleep 1; done

B=localhost:8016
JSON="Content-Type: application/json"
curl -s -X POST $B/api/auth/register -H "$JSON" -d '{"email":"a@t.com","password":"secret1234"}' > /dev/null
A="Authorization: Bearer $(curl -s -X POST $B/api/auth/login -d 'username=a@t.com&password=secret1234' | jq_ "d['access_token']")"

echo "probes per source type"
# 1 sqlite — stands in for Postgres/Doris/MySQL, all of which use SELECT 1
curl -s -X POST $B/api/datasources -H "$A" -H "$JSON" -d '{
  "name":"SQLite","type":"sql","config":{"driver":"sqlite","database":"/tmp/hubbro-health-test.db"}}' > /dev/null
# 2 glpi, reachable
curl -s -X POST $B/api/datasources -H "$A" -H "$JSON" -d '{
  "name":"GLPI","type":"glpi",
  "config":{"base_url":"http://127.0.0.1:9997","app_token":"app","user_token":"test-user-token"}}' > /dev/null
# 3 glpi with a bad token
curl -s -X POST $B/api/datasources -H "$A" -H "$JSON" -d '{
  "name":"GLPI bad","type":"glpi",
  "config":{"base_url":"http://127.0.0.1:9997","app_token":"app","user_token":"wrong"}}' > /dev/null
# 4 sql pointing nowhere
curl -s -X POST $B/api/datasources -H "$A" -H "$JSON" -d '{
  "name":"Dead DB","type":"sql",
  "config":{"driver":"postgresql","host":"127.0.0.1","port":1,"database":"x","user":"u","password":"p"}}' > /dev/null

check "sql source probes ok" \
  "$(curl -s -X POST $B/api/datasources/1/check -H "$A" | jq_ "d['ok']")" "True"
check "glpi source probes ok" \
  "$(curl -s -X POST $B/api/datasources/2/check -H "$A" | jq_ "d['ok']")" "True"
check "bad glpi credentials are reported as failing" \
  "$(curl -s -X POST $B/api/datasources/3/check -H "$A" | jq_ "d['ok']")" "False"
check "the failure carries a message" \
  "$(curl -s -X POST $B/api/datasources/3/check -H "$A" | jq_ "len(d['error'] or '') > 0")" "True"
check "an unreachable database is reported as failing" \
  "$(curl -s -X POST $B/api/datasources/4/check -H "$A" | jq_ "d['ok']")" "False"
check "a probe records how long it took" \
  "$(curl -s -X POST $B/api/datasources/1/check -H "$A" | jq_ "d['duration_ms'] >= 0")" "True"
check "checking an unknown source 404s" "$(code -X POST $B/api/datasources/99/check -H "$A")" "404"

echo "health summary"
H=$(curl -s $B/api/datasources/health -H "$A")
check "lists every source" "$(echo "$H" | jq_ "len(d)")" "4"
check "healthy sources read as ok" "$(echo "$H" | jq_ "d[0]['status']")" "ok"
check "broken sources read as failing" "$(echo "$H" | jq_ "d[2]['status']")" "failing"
check "keeps recent checks for a trend" "$(echo "$H" | jq_ "len(d[0]['recent']) > 0")" "True"
check "reports whether timed monitoring is on" "$(echo "$H" | jq_ "d[0]['monitored']")" "False"
check "never exposes configuration" \
  "$(echo "$H" | jq_ "any('config' in s or 'password' in s or 'user_token' in s for s in d)")" "False"

echo "passive recording from real fetches"
curl -s -X POST $B/api/datasources -H "$A" -H "$JSON" -d '{
  "name":"Unused","type":"sql","config":{"driver":"sqlite","database":"/tmp/hubbro-health-test.db"}}' > /dev/null
check "a source nobody has used is unknown" \
  "$(curl -s $B/api/datasources/health -H "$A" | jq_ "d[4]['status']")" "unknown"
curl -s -X POST $B/api/data/fetch -H "$A" -H "$JSON" \
  -d '{"datasource_id":5,"options":{"query":"SELECT 1 AS n"}}' > /dev/null
check "a real fetch marks it reachable" \
  "$(curl -s $B/api/datasources/health -H "$A" | jq_ "d[4]['status']")" "ok"
check "the fetch is attributed correctly" \
  "$(python3 -c "
import sqlite3
c=sqlite3.connect('/tmp/hubbro-health-test.db')
print(c.execute(\"select source from datasource_checks where datasource_id=5 order by id desc limit 1\").fetchone()[0])")" "fetch"

curl -s -X POST $B/api/data/fetch -H "$A" -H "$JSON" \
  -d '{"datasource_id":5,"options":{"query":"SELECT * FROM no_such_table"}}' > /dev/null
check "a failed fetch flips it to failing" \
  "$(curl -s $B/api/datasources/health -H "$A" | jq_ "d[4]['status']")" "failing"
check "the last successful time is still remembered" \
  "$(curl -s $B/api/datasources/health -H "$A" | jq_ "d[4]['last_ok_at'] is not None")" "True"

echo "dependent dashboards"
curl -s -X POST $B/api/dashboards -H "$A" -H "$JSON" -d '{"name":"Ops"}' > /dev/null
curl -s -X PUT $B/api/dashboards/1 -H "$A" -H "$JSON" -d '{
  "definition":{"widgets":[{"id":"w1","type":"table","title":"A","datasource_id":1,"options":{}},
                           {"id":"w2","type":"stat","title":"B","datasource_id":1,"options":{}}],
                "layout":[]}}' > /dev/null
H=$(curl -s $B/api/datasources/health -H "$A")
check "shows which dashboards use a source" "$(echo "$H" | jq_ "d[0]['dashboards'][0]['name']")" "Ops"
check "counts the widgets involved" "$(echo "$H" | jq_ "d[0]['dashboards'][0]['widget_count']")" "2"
check "unused sources list no dashboards" "$(echo "$H" | jq_ "len(d[3]['dashboards'])")" "0"

echo "permissions"
curl -s -X POST $B/api/users -H "$A" -H "$JSON" -d '{"email":"v@t.com","password":"secret1234","role":"viewer"}' > /dev/null
V="Authorization: Bearer $(curl -s -X POST $B/api/auth/login -d 'username=v@t.com&password=secret1234' | jq_ "d['access_token']")"
check "viewers can see health" "$(code $B/api/datasources/health -H "$V")" "200"
check "viewers still cannot list sources" "$(code $B/api/datasources -H "$V")" "403"
check "viewers can trigger a check" "$(code -X POST $B/api/datasources/1/check -H "$V")" "200"
check "health needs a token" "$(code $B/api/datasources/health)" "401"

echo "retention"
for _ in $(seq 1 8); do curl -s -X POST $B/api/datasources/1/check -H "$A" > /dev/null; done
check "check history is capped per source" \
  "$(python3 -c "
import sqlite3
c=sqlite3.connect('/tmp/hubbro-health-test.db')
n=c.execute('select count(*) from datasource_checks where datasource_id=1').fetchone()[0]
print(n <= 50)")" "True"

curl -s -X DELETE $B/api/datasources/4 -H "$A" > /dev/null
check "deleting a source removes its checks" \
  "$(python3 -c "
import sqlite3
c=sqlite3.connect('/tmp/hubbro-health-test.db')
print(c.execute('select count(*) from datasource_checks where datasource_id=4').fetchone()[0])")" "0"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
