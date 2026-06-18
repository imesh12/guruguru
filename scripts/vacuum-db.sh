#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DATA_DIR="${APP_DATA_DIR:-$ROOT_DIR/runtime}"
DATABASE_URL_VALUE="${DATABASE_URL:-file:$APP_DATA_DIR/kurukuru-monitor.db}"

if systemctl is-active --quiet kurukuru-api.service 2>/dev/null; then
  echo "kurukuru-api.service is still running. Stop the API before VACUUM."
  exit 1
fi

DB_PATH="${DATABASE_URL_VALUE#file:}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "SQLite database not found at: $DB_PATH"
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is not installed. Install it first."
  exit 1
fi

echo "Running offline VACUUM on $DB_PATH"
sqlite3 "$DB_PATH" "PRAGMA journal_mode=WAL; VACUUM;"
echo "VACUUM completed."
