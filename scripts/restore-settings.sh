#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/backup-directory" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SOURCE_DIR="$1"
if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Backup directory not found: $SOURCE_DIR" >&2
  exit 1
fi

if [[ -f "$SOURCE_DIR/.env" ]]; then
  cp "$SOURCE_DIR/.env" .env
fi

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

if [[ -f "$SOURCE_DIR/kurukuru-monitor.db" ]]; then
  if [[ -z "${DATABASE_URL:-}" || "${DATABASE_URL}" != file:* ]]; then
    echo "DATABASE_URL must point to a SQLite file before restoring the database." >&2
    exit 1
  fi

  DB_PATH="${DATABASE_URL#file:}"
  [[ "$DB_PATH" != /* ]] && DB_PATH="$ROOT_DIR/${DB_PATH#./}"
  mkdir -p "$(dirname "$DB_PATH")"
  cp "$SOURCE_DIR/kurukuru-monitor.db" "$DB_PATH"
fi

if [[ -d "$SOURCE_DIR/logs" && -n "${KURUKURU_LOG_DIR:-}" ]]; then
  mkdir -p "$KURUKURU_LOG_DIR"
  cp -R "$SOURCE_DIR/logs/." "$KURUKURU_LOG_DIR/" 2>/dev/null || true
fi

echo "Restore complete. Restart the services to pick up restored settings."
