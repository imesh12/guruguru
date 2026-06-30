#!/usr/bin/env bash

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/kurukuru-monitor/.env.production}"
FRONTEND_DIR="${FRONTEND_DIR:-/opt/kurukuru-monitor/frontend}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:4000}"

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1"
}

check_service() {
  local service_name="$1"

  if systemctl is-enabled "$service_name" >/dev/null 2>&1; then
    pass "$service_name is enabled"
  else
    fail "$service_name is not enabled"
    overall_status=1
  fi

  if systemctl is-active "$service_name" >/dev/null 2>&1; then
    pass "$service_name is active"
  else
    fail "$service_name is not active"
    overall_status=1
  fi
}

overall_status=0

check_service "kurukuru-api"
check_service "kurukuru-mediamtx"
check_service "nginx"

if [[ -f "$ENV_FILE" ]]; then
  pass "Environment file exists: $ENV_FILE"
else
  fail "Environment file missing: $ENV_FILE"
  overall_status=1
fi

if [[ -d "$FRONTEND_DIR" ]]; then
  pass "Frontend directory exists: $FRONTEND_DIR"
else
  fail "Frontend directory missing: $FRONTEND_DIR"
  overall_status=1
fi

if curl --silent --show-error --fail --max-time 5 "$API_BASE_URL/health" >/dev/null; then
  pass "Local API health responded"
else
  fail "Local API health did not respond"
  overall_status=1
fi

printf '\nStandby readiness summary: '
if [[ "$overall_status" -eq 0 ]]; then
  printf 'READY\n'
else
  printf 'NOT READY\n'
fi

exit "$overall_status"
