#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXIT_CODE=0

printf "╔══════════════════════════════════════════╗\n"
printf "║       dind service test suite            ║\n"
printf "╚══════════════════════════════════════════╝\n"

# --- Manager service tests (vitest) ---
printf "\n▶ Manager service tests (vitest)\n"
printf "────────────────────────────────\n"
(cd "$DIND_ROOT/manager" && npm test) || EXIT_CODE=1

# --- Dev setup tests ---
printf "\n▶ Dev setup tests (bash)\n"
printf "────────────────────────────────\n"
bash "$SCRIPT_DIR/setup/dev-setup.test.sh" || EXIT_CODE=1

# --- Prod setup tests ---
printf "\n▶ Prod setup tests (bash)\n"
printf "────────────────────────────────\n"
bash "$SCRIPT_DIR/setup/prod-setup.test.sh" || EXIT_CODE=1

printf "\n"
if [ "$EXIT_CODE" -eq 0 ]; then
  printf "All test suites passed.\n"
else
  printf "Some test suites failed.\n"
fi

exit "$EXIT_CODE"
