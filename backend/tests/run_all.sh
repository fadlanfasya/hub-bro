#!/usr/bin/env bash
# Run the whole backend suite.  Usage:  bash tests/run_all.sh
#
# The Python suites are discovered rather than listed. An earlier version named
# them one by one and quietly fell behind: ten suites existed that this script
# never ran, so "all suites passed" was true and meaningless. CI globs them for
# the same reason — a test nobody runs is worse than no test, because it looks
# like coverage.
cd "$(dirname "$0")/.."
FAILED=0

for suite in tests/test_*.py; do
  case "$suite" in
    */mock_glpi.py) continue ;;
  esac
  echo "=== $suite ==="
  python3 "$suite" | tail -1
  [ "${PIPESTATUS[0]}" -eq 0 ] || FAILED=1
done

# The shell suites start a live server, so they stay explicit and ordered.
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
