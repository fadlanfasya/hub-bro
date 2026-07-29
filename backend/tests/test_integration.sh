#!/usr/bin/env bash
# End-to-end check: GLPI session handling, caching, and transforms through the API.
# Run from backend/:  bash tests/test_integration.sh
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
check() { # check <label> <actual> <expected>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1";
  else FAIL=$((FAIL+1)); echo "  FAIL  $1 — expected '$3', got '$2'"; fi
}

export SECRET_KEY="test-secret-key-for-integration"
export DATABASE_URL="sqlite:////tmp/hubbro-test.db"
export CACHE_TTL_SECONDS=30
rm -f /tmp/hubbro-test.db

python3 tests/mock_glpi.py & MOCK=$!
python3 -m uvicorn app.main:app --port 8011 > /tmp/uv-test.log 2>&1 & API=$!
trap 'kill $MOCK $API 2>/dev/null' EXIT

for _ in $(seq 1 25); do curl -s localhost:8011/api/health >/dev/null && break; sleep 1; done

echo "auth"
curl -s -X POST localhost:8011/api/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"t@t.com","password":"secret123"}' > /dev/null
TOKEN=$(curl -s -X POST localhost:8011/api/auth/login -d "username=t@t.com&password=secret123" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
check "login returns a token" "$([ -n "$TOKEN" ] && echo yes)" "yes"
AUTH="Authorization: Bearer $TOKEN"
JSON="Content-Type: application/json"

echo "glpi connector"
curl -s -X POST localhost:8011/api/datasources -H "$AUTH" -H "$JSON" -d '{
  "name":"GLPI","type":"glpi",
  "config":{"base_url":"http://127.0.0.1:9997","app_token":"app","user_token":"test-user-token"}
}' > /dev/null
R=$(curl -s -X POST localhost:8011/api/data/fetch -H "$AUTH" -H "$JSON" \
  -d '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":50}}')
check "fetch respects max_rows" "$(echo "$R" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['rows']))")" "50"
check "uid_cols prefix stripped" "$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['columns'][0])")" "name"
check "total exposed" "$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['meta']['total'])")" "954"

echo "caching"
count_searches() { curl -s localhost:9997/__count | python3 -c "import sys,json;print(json.load(sys.stdin)['search'])"; }
# start from a cold cache so the counts below are deterministic
curl -s -X POST localhost:8011/api/data/invalidate/1 -H "$AUTH" > /dev/null
curl -s localhost:9997/__reset > /dev/null
for _ in 1 2 3 4 5; do
  curl -s -X POST localhost:8011/api/data/fetch -H "$AUTH" -H "$JSON" \
    -d '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":50}}' > /dev/null
done
check "5 identical fetches hit GLPI once" "$(count_searches)" "1"

# different fetch options must not share a cache entry
curl -s -X POST localhost:8011/api/data/fetch -H "$AUTH" -H "$JSON" \
  -d '{"datasource_id":1,"options":{"itemtype":"Monitor","max_rows":50}}' > /dev/null
check "different itemtype fetches separately" "$(count_searches)" "2"

# transform-only differences must reuse the same upstream fetch
curl -s -X POST localhost:8011/api/data/fetch -H "$AUTH" -H "$JSON" \
  -d '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":50,"group_by":"states_id"}}' > /dev/null
curl -s -X POST localhost:8011/api/data/fetch -H "$AUTH" -H "$JSON" \
  -d '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":50,"limit":3}}' > /dev/null
check "widgets with different transforms share one fetch" "$(count_searches)" "2"

# the GLPI session should be opened once and reused across all of the above
check "session opened once and reused" \
  "$(curl -s localhost:9997/__count | python3 -c "import sys,json;print(json.load(sys.stdin)['init'])")" "0"

curl -s -X POST localhost:8011/api/data/invalidate/1 -H "$AUTH" > /dev/null
curl -s -X POST localhost:8011/api/data/fetch -H "$AUTH" -H "$JSON" \
  -d '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":50}}' > /dev/null
check "invalidate forces a fresh fetch" "$(count_searches)" "3"

echo "transforms via API"
G=$(curl -s -X POST localhost:8011/api/data/fetch -H "$AUTH" -H "$JSON" -d '{
  "datasource_id":1,
  "options":{"itemtype":"Computer","max_rows":50,"group_by":"states_id","sort":{"column":"count","dir":"desc"}}
}')
check "group by status" "$(echo "$G" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d['columns'])")" "['states_id', 'count']"
check "top status is Running" "$(echo "$G" | python3 -c "import sys,json;print(json.load(sys.stdin)['rows'][0]['states_id'])")" "Running"
check "running counted across the 50 fetched rows" "$(echo "$G" | python3 -c "import sys,json;print(json.load(sys.stdin)['rows'][0]['count'])")" "30"

F=$(curl -s -X POST localhost:8011/api/data/fetch -H "$AUTH" -H "$JSON" -d '{
  "datasource_id":1,
  "options":{"itemtype":"Computer","max_rows":50,"filters":[{"column":"states_id","op":"eq","value":"Stopped"}]}
}')
check "filter to Stopped" "$(echo "$F" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['rows']))")" "50"

S=$(curl -s -X POST localhost:8011/api/data/fetch -H "$AUTH" -H "$JSON" -d '{
  "datasource_id":1,
  "options":{"itemtype":"Computer","max_rows":50,"group_by":"locations_id","aggregate":"sum","value_column":"cost"}
}')
check "sum cost per location" "$(echo "$S" | python3 -c "import sys,json;print(json.load(sys.stdin)['columns'][1])")" "sum_cost"

echo "cache invalidation"
check "invalidate endpoint ok" \
  "$(curl -s -X POST localhost:8011/api/data/invalidate/1 -H "$AUTH" | python3 -c "import sys,json;print(json.load(sys.stdin)['ok'])")" "True"

echo "auth isolation"
check "fetch without a token is rejected" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:8011/api/data/fetch -H "$JSON" -d '{"datasource_id":1,"options":{}}')" "401"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
