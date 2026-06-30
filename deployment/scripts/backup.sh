#!/usr/bin/env bash

set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/kurukuru-monitor/.env.production}"
BACKUP_ROOT="/opt/kurukuru-monitor/backups"
TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
ARCHIVE_PATH="$BACKUP_ROOT/kurukuru-backup-$TIMESTAMP.tar.gz"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

mkdir -p "$BACKUP_ROOT"

declare -a INCLUDE_PATHS=()

if [[ -d /opt/kurukuru-monitor/data ]]; then
  INCLUDE_PATHS+=("/opt/kurukuru-monitor/data")
fi

if [[ -f /opt/kurukuru-monitor/mediamtx/mediamtx.yml ]]; then
  INCLUDE_PATHS+=("/opt/kurukuru-monitor/mediamtx/mediamtx.yml")
fi

if [[ -f /etc/kurukuru-monitor/.env.production ]]; then
  INCLUDE_PATHS+=("/etc/kurukuru-monitor/.env.production")
fi

if [[ -d /var/log/kurukuru-monitor ]]; then
  INCLUDE_PATHS+=("/var/log/kurukuru-monitor")
fi

if [[ "${#INCLUDE_PATHS[@]}" -eq 0 ]]; then
  echo "No backup sources found. Nothing to archive." >&2
  exit 1
fi

tar \
  --exclude='node_modules' \
  --exclude='dist' \
  --exclude='cache' \
  --exclude='.cache' \
  -czf "$ARCHIVE_PATH" \
  "${INCLUDE_PATHS[@]}"

echo "Backup created: $ARCHIVE_PATH"
echo "Warning: this backup may contain secrets because /etc/kurukuru-monitor/.env.production is included."
echo "Store the archive securely."
