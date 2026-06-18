#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

APP_DATA_DIR="${APP_DATA_DIR:-./runtime}"
BACKUP_ROOT="${BACKUP_ROOT:-$APP_DATA_DIR/backups}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_DIR="$BACKUP_ROOT/$TIMESTAMP"

mkdir -p "$TARGET_DIR"

if [[ -f .env ]]; then
  cp .env "$TARGET_DIR/.env"
fi

if [[ -n "${DATABASE_URL:-}" && "${DATABASE_URL}" == file:* ]]; then
  DB_PATH="${DATABASE_URL#file:}"
  [[ "$DB_PATH" != /* ]] && DB_PATH="$ROOT_DIR/${DB_PATH#./}"
  if [[ -f "$DB_PATH" ]]; then
    cp "$DB_PATH" "$TARGET_DIR/kurukuru-monitor.db"
  fi
fi

if [[ -n "${KURUKURU_LOG_DIR:-}" && -d "${KURUKURU_LOG_DIR}" ]]; then
  mkdir -p "$TARGET_DIR/logs"
  cp -R "${KURUKURU_LOG_DIR}/." "$TARGET_DIR/logs/" 2>/dev/null || true
fi

if command -v journalctl >/dev/null 2>&1; then
  sudo journalctl -u kurukuru-api.service -u kurukuru-desktop.service --since "7 days ago" > "$TARGET_DIR/journalctl.log" || true
fi

echo "Backup created at $TARGET_DIR"
