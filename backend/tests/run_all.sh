#!/usr/bin/env bash
# Run the whole backend suite.  Usage:  bash tests/run_all.sh
cd "$(dirname "$0")/.."
FAILED=0

for suite in tests/test_transforms.py tests/test_security.py tests/test_cache.py; do
  echo "=== $suite ==="
  python3 "$suite" | tail -1
  [ "${PIPESTATUS[0]}" -eq 0 ] || FAILED=1
done

for suite in tests/test_integration.sh tests/test_glpi.sh tests/test_sharing.sh \
             tests/test_permissions.sh tests/test_history.sh tests/test_health.sh \
             tests/test_production.sh; do
  echo "=== $suite ==="
  bash "$suite" | tail -1
  [ "${PIPESTATUS[0]}" -eq 0 ] || FAILED=1
done

echo ""
[ "$FAILED" -eq 0 ] && echo "ALL SUITES PASSED" || echo "SOME SUITES FAILED"
exit $FAILED
