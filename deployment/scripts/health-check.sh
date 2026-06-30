#!/usr/bin/env bash

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/kurukuru-monitor/.env.production}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

API_BASE_URL="${API_BASE_URL:-${VITE_API_BASE_URL:-http://127.0.0.1:4000}}"
API_TOKEN_VALUE="${API_TOKEN:-}"
HEALTH_URL="${HEALTH_URL:-$API_BASE_URL/health}"
LOCATIONS_URL="${LOCATIONS_URL:-$API_BASE_URL/api/vehicles/locations}"
WHEP_HOST="${WHEP_HOST:-127.0.0.1}"
WHEP_PORT="${WHEP_PORT:-8889}"

pass() {
  printf 'PASS: %s\n' "$1"
}

fail() {
  printf 'FAIL: %s\n' "$1"
}

check_http() {
  local description="$1"
  local url="$2"

  if curl --silent --show-error --fail --max-time 5 "$url" >/dev/null; then
    pass "$description"
    return 0
  fi

  fail "$description"
  return 1
}

check_http_auth() {
  local description="$1"
  local url="$2"

  if [[ -n "$API_TOKEN_VALUE" ]]; then
    if curl --silent --show-error --fail --max-time 5 \
      -H "Authorization: Bearer $API_TOKEN_VALUE" \
      "$url" >/dev/null; then
      pass "$description"
      return 0
    fi
  else
    if curl --silent --show-error --fail --max-time 5 "$url" >/dev/null; then
      pass "$description (without API token)"
      return 0
    fi
  fi

  fail "$description"
  return 1
}

check_tcp() {
  local description="$1"
  local host="$2"
  local port="$3"

  if timeout 3 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then
    pass "$description"
    return 0
  fi

  fail "$description"
  return 1
}

overall_status=0

check_http "API health endpoint reachable: $HEALTH_URL" "$HEALTH_URL" || overall_status=1
check_http_auth "Vehicle locations endpoint reachable" "$LOCATIONS_URL" || overall_status=1
check_tcp "MediaMTX WHEP port reachable: $WHEP_HOST:$WHEP_PORT" "$WHEP_HOST" "$WHEP_PORT" || overall_status=1

if [[ "$overall_status" -eq 0 ]]; then
  printf 'PASS: overall health check\n'
else
  printf 'FAIL: overall health check\n'
fi

exit "$overall_status"
