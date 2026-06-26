#!/usr/bin/env bash
# FotoFlip Test Kit
# Runs the full smoke suite + all E2E tests.
#
# Usage:
#   bash tests/run-kit.sh
#
# For E2E tests that require auth:
#   NODE_ENV=test node server.js &   # start server in test mode first
#   bash tests/run-kit.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3456}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo "FotoFlip Test Kit"
echo "================="
echo ""

# Verify server is reachable
if ! curl -sf "${BASE_URL}/health" > /dev/null 2>&1; then
  echo "ERROR: Server not reachable at ${BASE_URL}"
  echo "       Start with: NODE_ENV=test node server.js"
  exit 1
fi

HEALTH=$(curl -sf "${BASE_URL}/health")
echo "Server : ${BASE_URL}"
echo "Health : ${HEALTH}"

NODE_ENV=test node --test --test-concurrency=1 \
  "${SCRIPT_DIR}/qa.test.mjs" \
  "${SCRIPT_DIR}/e2e/beta001.test.mjs" \
  "${SCRIPT_DIR}/e2e/mu002.test.mjs" \
  "${SCRIPT_DIR}/e2e/mu003.test.mjs" \
  "${SCRIPT_DIR}/e2e/mu004.test.mjs" \
  "${SCRIPT_DIR}/e2e/admin.test.mjs"
