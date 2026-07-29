#!/usr/bin/env bash
# GLPI connector: pagination, filter pushdown, session recovery.
# Run from backend/:  bash tests/test_glpi.sh
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1";
  else FAIL=$((FAIL+1)); echo "  FAIL  $1 — expected '$3', got '$2'"; fi
}
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }

export SECRET_KEY="test-secret-glpi"
export DATABASE_URL="sqlite:////tmp/hubbro-glpi-test.db"
rm -f /tmp/hubbro-glpi-test.db

python3 tests/mock_glpi.py & MOCK=$!
python3 -m uvicorn app.main:app --port 8012 > /tmp/uv-glpi.log 2>&1 & API=$!
trap 'kill $MOCK $API 2>/dev/null' EXIT
for _ in $(seq 1 25); do curl -s localhost:8012/api/health >/dev/null && break; sleep 1; done

curl -s -X POST localhost:8012/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"g@g.com","password":"secret123"}' > /dev/null
TOKEN=$(curl -s -X POST localhost:8012/api/auth/login -d "username=g@g.com&password=secret123" | jq_ "d['access_token']")
AUTH="Authorization: Bearer $TOKEN"; JSON="Content-Type: application/json"

curl -s -X POST localhost:8012/api/datasources -H "$AUTH" -H "$JSON" -d '{
  "name":"GLPI","type":"glpi",
  "config":{"base_url":"http://127.0.0.1:9997","app_token":"app","user_token":"test-user-token"}
}' > /dev/null

fetch() { curl -s -X POST localhost:8012/api/data/fetch -H "$AUTH" -H "$JSON" -d "$1"; }
fresh() { curl -s -X POST localhost:8012/api/data/invalidate/1 -H "$AUTH" > /dev/null; curl -s localhost:9997/__reset > /dev/null; }

echo "pagination"
fresh
R=$(fetch '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":1000,"page_size":200}}')
check "fetches all 954 rows, not just one page" "$(echo "$R" | jq_ "len(d['rows'])")" "954"
check "meta.total reports the real total" "$(echo "$R" | jq_ "d['meta']['total']")" "954"
check "meta.partial is false when complete" "$(echo "$R" | jq_ "d['meta']['partial']")" "False"
check "paged in 5 requests of 200" "$(curl -s localhost:9997/__count | jq_ "d['search']")" "5"

fresh
R=$(fetch '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":100}}')
check "max_rows caps the fetch" "$(echo "$R" | jq_ "len(d['rows'])")" "100"
check "meta.partial flags truncation" "$(echo "$R" | jq_ "d['meta']['partial']")" "True"
check "meta.total still reports 954" "$(echo "$R" | jq_ "d['meta']['total']")" "954"

echo "grouping over the full dataset"
fresh
R=$(fetch '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":1000,"group_by":"states_id","sort":{"column":"count","dir":"desc"}}}')
# 954 items cycling through 5 statuses: Running appears at i%5 in {0,1,2}
check "Running counted across all 954" "$(echo "$R" | jq_ "d['rows'][0]['count']")" "573"
check "counts sum to 954" "$(echo "$R" | jq_ "sum(r['count'] for r in d['rows'])")" "954"

echo "filter pushdown"
fresh
R=$(fetch '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":1000,"filters":[{"column":"states_id","op":"eq","value":"Stopped"}]}}')
check "server-side filter returns 191 rows" "$(echo "$R" | jq_ "len(d['rows'])")" "191"
check "one filter was pushed down" "$(echo "$R" | jq_ "d['meta']['pushed_down_filters']")" "1"
check "no client-side filtering needed" "$(echo "$R" | jq_ "'client_side_filters' in d['meta']")" "False"
check "search options fetched to build the mapping" "$(curl -s localhost:9997/__count | jq_ "d['options']")" "1"

fresh
fetch '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":50,"filters":[{"column":"states_id","op":"eq","value":"Running"}]}}' > /dev/null
check "search-option map is cached after the first lookup" "$(curl -s localhost:9997/__count | jq_ "d['options']")" "0"

fresh
R=$(fetch '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":1000,"filters":[{"column":"cost","op":"gte","value":200}]}}')
check "gte falls back to client-side" "$(echo "$R" | jq_ "d['meta'].get('client_side_filters')")" "1"
check "client-side filter still correct" "$(echo "$R" | jq_ "all(float(r['cost'])>=200 for r in d['rows'])")" "True"

echo "session recovery"
fresh
fetch '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":50}}' > /dev/null
curl -s localhost:9997/__expire > /dev/null   # server drops all sessions
curl -s -X POST localhost:8012/api/data/invalidate/1 -H "$AUTH" > /dev/null
R=$(fetch '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":50}}')
check "recovers from an expired session" "$(echo "$R" | jq_ "len(d['rows'])")" "50"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
