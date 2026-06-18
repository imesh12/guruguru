#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo ".env file not found. Copy .env.example to .env first." >&2
  exit 1
fi

set -a
source .env
set +a

API_BASE_URL="${VITE_API_BASE_URL:-http://127.0.0.1:${API_PORT:-4000}}"
APP_DATA_DIR="${APP_DATA_DIR:-./runtime}"
DATABASE_URL="${DATABASE_URL:-file:./runtime/kurukuru-monitor.db}"

require_env() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Missing required env value: $name" >&2
    exit 1
  fi
}

echo "[field-test-smoke] Checking required env values"
require_env APP_DATA_DIR
require_env DATABASE_URL
require_env API_PORT

echo "[field-test-smoke] Checking mpv"
command -v mpv >/dev/null 2>&1 || { echo "mpv not found on PATH" >&2; exit 1; }

echo "[field-test-smoke] Checking API health"
curl -fsS "${API_BASE_URL}/health" >/dev/null

echo "[field-test-smoke] Checking system status"
curl -fsS "${API_BASE_URL}/system/status" >/dev/null

echo "[field-test-smoke] Checking SQLite database"
DB_PATH="${DATABASE_URL#file:}"
[[ "$DB_PATH" != /* ]] && DB_PATH="$ROOT_DIR/${DB_PATH#./}"
if [[ ! -f "$DB_PATH" ]]; then
  echo "SQLite database not found at $DB_PATH" >&2
  exit 1
fi

echo "[field-test-smoke] Checking runtime directories"
[[ -d "$APP_DATA_DIR" ]] || { echo "APP_DATA_DIR not found: $APP_DATA_DIR" >&2; exit 1; }
[[ -d "$APP_DATA_DIR/reports" ]] || { echo "Reports directory not found: $APP_DATA_DIR/reports" >&2; exit 1; }

echo "[field-test-smoke] Smoke checks passed"
