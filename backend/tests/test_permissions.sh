#!/usr/bin/env bash
# Every role against every endpoint, plus privilege-escalation attempts.
# Run from backend/:  bash tests/test_permissions.sh
set -u
cd "$(dirname "$0")/.."

PASS=0; FAIL=0
check() {
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  PASS  $1";
  else FAIL=$((FAIL+1)); echo "  FAIL  $1 — expected '$3', got '$2'"; fi
}
jq_() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

export SECRET_KEY="test-secret-permissions"
export DATABASE_URL="sqlite:////tmp/hubbro-perm-test.db"
rm -f /tmp/hubbro-perm-test.db

python3 tests/mock_glpi.py & MOCK=$!
python3 -m uvicorn app.main:app --port 8014 > /tmp/uv-perm.log 2>&1 & API=$!
trap 'kill $MOCK $API 2>/dev/null' EXIT
for _ in $(seq 1 25); do curl -s localhost:8014/api/health >/dev/null && break; sleep 1; done

JSON="Content-Type: application/json"
B=localhost:8014
login() { curl -s -X POST $B/api/auth/login -d "username=$1&password=$2" | jq_ "d.get('access_token','')"; }

echo "bootstrap"
check "registration is open before the first account" \
  "$(curl -s $B/api/auth/registration | jq_ "d['open']")" "True"
FIRST=$(curl -s -X POST $B/api/auth/register -H "$JSON" -d '{"email":"admin@t.com","password":"secret1234"}')
check "first account becomes admin" "$(echo "$FIRST" | jq_ "d['role']")" "admin"
check "registration closes afterwards" \
  "$(curl -s $B/api/auth/registration | jq_ "d['open']")" "False"
check "a second self-registration is refused" \
  "$(code -X POST $B/api/auth/register -H "$JSON" -d '{"email":"sneaky@t.com","password":"secret1234"}')" "403"
check "short passwords are rejected" \
  "$(curl -s -X POST $B/api/users -H "$JSON" -d '{"email":"x@t.com","password":"abc","role":"viewer"}' -H "Authorization: Bearer $(login admin@t.com secret1234)" | jq_ "'at least' in d['detail']")" "True"

ADMIN="Authorization: Bearer $(login admin@t.com secret1234)"

echo "admin creates the team"
curl -s -X POST $B/api/users -H "$ADMIN" -H "$JSON" -d '{"email":"editor@t.com","password":"secret1234","role":"editor"}' > /dev/null
curl -s -X POST $B/api/users -H "$ADMIN" -H "$JSON" -d '{"email":"viewer@t.com","password":"secret1234","role":"viewer"}' > /dev/null
check "three accounts exist" "$(curl -s $B/api/users -H "$ADMIN" | jq_ "len(d)")" "3"
check "duplicate email is refused" \
  "$(code -X POST $B/api/users -H "$ADMIN" -H "$JSON" -d '{"email":"editor@t.com","password":"secret1234","role":"editor"}')" "400"
check "invalid role is refused" \
  "$(code -X POST $B/api/users -H "$ADMIN" -H "$JSON" -d '{"email":"z@t.com","password":"secret1234","role":"superuser"}')" "400"

EDITOR="Authorization: Bearer $(login editor@t.com secret1234)"
VIEWER="Authorization: Bearer $(login viewer@t.com secret1234)"

check "capabilities are reported for the UI" \
  "$(curl -s $B/api/auth/me -H "$VIEWER" | jq_ "'dashboard.edit' in d['capabilities']")" "False"
check "editor gets edit capability" \
  "$(curl -s $B/api/auth/me -H "$EDITOR" | jq_ "'dashboard.edit' in d['capabilities']")" "True"

echo "user management is admin-only"
check "editor cannot list users" "$(code $B/api/users -H "$EDITOR")" "403"
check "viewer cannot list users" "$(code $B/api/users -H "$VIEWER")" "403"
check "editor cannot create users" \
  "$(code -X POST $B/api/users -H "$EDITOR" -H "$JSON" -d '{"email":"n@t.com","password":"secret1234","role":"admin"}')" "403"
check "viewer cannot promote themselves" \
  "$(code -X PUT $B/api/users/3 -H "$VIEWER" -H "$JSON" -d '{"role":"admin"}')" "403"

echo "data sources"
curl -s -X POST $B/api/datasources -H "$ADMIN" -H "$JSON" -d '{
  "name":"GLPI","type":"glpi",
  "config":{"base_url":"http://127.0.0.1:9997","app_token":"app","user_token":"test-user-token"}}' > /dev/null
check "admin can create a source" "$(curl -s $B/api/datasources -H "$ADMIN" | jq_ "len(d)")" "1"
check "editor can see sources (needed to build widgets)" \
  "$(curl -s $B/api/datasources -H "$EDITOR" | jq_ "len(d)")" "1"
check "viewer cannot see sources" "$(code $B/api/datasources -H "$VIEWER")" "403"
check "editor cannot create a source" \
  "$(code -X POST $B/api/datasources -H "$EDITOR" -H "$JSON" -d '{"name":"x","type":"rest","config":{"url":"http://x"}}')" "403"
check "editor cannot edit a source" \
  "$(code -X PUT $B/api/datasources/1 -H "$EDITOR" -H "$JSON" -d '{"name":"hacked"}')" "403"
check "editor cannot delete a source" "$(code -X DELETE $B/api/datasources/1 -H "$EDITOR")" "403"

echo "dashboards are shared"
curl -s -X POST $B/api/dashboards -H "$ADMIN" -H "$JSON" -d '{"name":"Ops"}' > /dev/null
curl -s -X PUT $B/api/dashboards/1 -H "$ADMIN" -H "$JSON" -d '{
  "definition":{"widgets":[{"id":"w1","type":"table","title":"VMs","datasource_id":1,
    "options":{"itemtype":"Computer","max_rows":10}}],"layout":[{"i":"w1","x":0,"y":0,"w":6,"h":4}]}}' > /dev/null
check "editor sees the admin's dashboard" "$(curl -s $B/api/dashboards -H "$EDITOR" | jq_ "len(d)")" "1"
check "viewer sees it too" "$(curl -s $B/api/dashboards -H "$VIEWER" | jq_ "len(d)")" "1"
check "editor can open it" "$(code $B/api/dashboards/1 -H "$EDITOR")" "200"
check "editor can edit it" \
  "$(code -X PUT $B/api/dashboards/1 -H "$EDITOR" -H "$JSON" -d '{"name":"Ops v2"}')" "200"
check "viewer cannot edit it" \
  "$(code -X PUT $B/api/dashboards/1 -H "$VIEWER" -H "$JSON" -d '{"name":"vandalised"}')" "403"
check "viewer cannot create one" \
  "$(code -X POST $B/api/dashboards -H "$VIEWER" -H "$JSON" -d '{"name":"nope"}')" "403"
check "viewer cannot delete one" "$(code -X DELETE $B/api/dashboards/1 -H "$VIEWER")" "403"
check "viewer cannot share one" "$(code -X POST $B/api/dashboards/1/share -H "$VIEWER")" "403"

echo "viewers read data without running queries"
check "viewer can read a widget's data" \
  "$(curl -s -X POST $B/api/data/dashboards/1/widgets/w1 -H "$VIEWER" | jq_ "len(d['rows'])")" "10"
check "viewer cannot run an ad-hoc query" \
  "$(code -X POST $B/api/data/fetch -H "$VIEWER" -H "$JSON" -d '{"datasource_id":1,"options":{"itemtype":"Computer"}}')" "403"
check "editor can run an ad-hoc query" \
  "$(code -X POST $B/api/data/fetch -H "$EDITOR" -H "$JSON" -d '{"datasource_id":1,"options":{"itemtype":"Computer","max_rows":5}}')" "200"
check "widget endpoint rejects an unknown widget" \
  "$(code -X POST $B/api/data/dashboards/1/widgets/ghost -H "$VIEWER")" "404"

echo "password self-service"
check "wrong current password is rejected" \
  "$(code -X POST $B/api/auth/change-password -H "$VIEWER" -H "$JSON" -d '{"current_password":"wrong","new_password":"newsecret123"}')" "400"
check "user changes their own password" \
  "$(code -X POST $B/api/auth/change-password -H "$VIEWER" -H "$JSON" -d '{"current_password":"secret1234","new_password":"newsecret123"}')" "200"
check "the new password works" "$([ -n "$(login viewer@t.com newsecret123)" ] && echo yes)" "yes"
check "the old password no longer works" "$(login viewer@t.com secret1234)" ""

echo "admin reset and deactivation"
curl -s -X PUT $B/api/users/3 -H "$ADMIN" -H "$JSON" -d '{"password":"resetpass123"}' > /dev/null
check "admin resets a password" "$([ -n "$(login viewer@t.com resetpass123)" ] && echo yes)" "yes"
VTOKEN="Authorization: Bearer $(login viewer@t.com resetpass123)"
curl -s -X PUT $B/api/users/3 -H "$ADMIN" -H "$JSON" -d '{"is_active":false}' > /dev/null
check "deactivated user cannot log in" \
  "$(code -X POST $B/api/auth/login -d 'username=viewer@t.com&password=resetpass123')" "403"
check "an existing token stops working immediately" "$(code $B/api/dashboards -H "$VTOKEN")" "403"
curl -s -X PUT $B/api/users/3 -H "$ADMIN" -H "$JSON" -d '{"is_active":true}' > /dev/null
check "reactivating restores access" \
  "$(code -X POST $B/api/auth/login -d 'username=viewer@t.com&password=resetpass123')" "200"

echo "last-admin guard rails"
check "admin cannot demote the only admin" \
  "$(code -X PUT $B/api/users/1 -H "$ADMIN" -H "$JSON" -d '{"role":"viewer"}')" "400"
check "admin cannot deactivate themselves" \
  "$(code -X PUT $B/api/users/1 -H "$ADMIN" -H "$JSON" -d '{"is_active":false}')" "400"
check "admin cannot delete themselves" "$(code -X DELETE $B/api/users/1 -H "$ADMIN")" "400"
curl -s -X PUT $B/api/users/2 -H "$ADMIN" -H "$JSON" -d '{"role":"admin"}' > /dev/null
check "demotion is allowed once a second admin exists" \
  "$(code -X PUT $B/api/users/1 -H "$ADMIN" -H "$JSON" -d '{"role":"editor"}')" "200"

echo "deleting a user keeps shared content"
ADMIN2="Authorization: Bearer $(login editor@t.com secret1234)"
check "dashboards survive deleting their creator" \
  "$(curl -s -X DELETE $B/api/users/1 -H "$ADMIN2" > /dev/null; curl -s $B/api/dashboards -H "$ADMIN2" | jq_ "len(d)")" "1"
check "data sources survive too" "$(curl -s $B/api/datasources -H "$ADMIN2" | jq_ "len(d)")" "1"

echo "unauthenticated access"
check "dashboards need a token" "$(code $B/api/dashboards)" "401"
check "users need a token" "$(code $B/api/users)" "401"
check "widget data needs a token" "$(code -X POST $B/api/data/dashboards/1/widgets/w1)" "401"

echo ""
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
