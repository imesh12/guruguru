#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "This script must be run as root or with sudo." >&2
  exit 1
fi

if [[ $# -lt 1 ]]; then
  echo "Usage: sudo bash restore.sh <backup-archive.tar.gz> [--apply]" >&2
  exit 1
fi

ARCHIVE_PATH="$1"
APPLY_MODE="${2:-}"

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  echo "Backup archive not found: $ARCHIVE_PATH" >&2
  exit 1
fi

TIMESTAMP="$(date '+%Y%m%d-%H%M%S')"
RESTORE_ROOT="/tmp/kurukuru-restore-$TIMESTAMP"

echo "Backup archive: $ARCHIVE_PATH"
echo "Restore workspace: $RESTORE_ROOT"
echo
read -r -p "Type YES to continue: " CONFIRMATION

if [[ "$CONFIRMATION" != "YES" ]]; then
  echo "Aborted."
  exit 1
fi

mkdir -p "$RESTORE_ROOT"
tar -xzf "$ARCHIVE_PATH" -C "$RESTORE_ROOT"

HAS_DATA="no"
HAS_MEDIAMTX="no"
HAS_ENV="no"
HAS_LOGS="no"

if find "$RESTORE_ROOT" -type d -path '*/opt/kurukuru-monitor/data' | grep -q .; then
  HAS_DATA="yes"
fi

if find "$RESTORE_ROOT" -type f -path '*/opt/kurukuru-monitor/mediamtx/mediamtx.yml' | grep -q .; then
  HAS_MEDIAMTX="yes"
fi

if find "$RESTORE_ROOT" -type f -path '*/etc/kurukuru-monitor/.env.production' | grep -q .; then
  HAS_ENV="yes"
fi

if find "$RESTORE_ROOT" -type d -path '*/var/log/kurukuru-monitor' | grep -q .; then
  HAS_LOGS="yes"
fi

echo
echo "Archive content check:"
echo "  data/: $HAS_DATA"
echo "  mediamtx.yml: $HAS_MEDIAMTX"
echo "  .env.production: $HAS_ENV"
echo "  logs/: $HAS_LOGS"

if [[ "$HAS_DATA" != "yes" ]]; then
  echo "Warning: data/ not found in archive."
fi
if [[ "$HAS_MEDIAMTX" != "yes" ]]; then
  echo "Warning: mediamtx.yml not found in archive."
fi
if [[ "$HAS_ENV" != "yes" ]]; then
  echo "Warning: .env.production not found in archive."
fi
if [[ "$HAS_LOGS" != "yes" ]]; then
  echo "Warning: logs/ not found in archive."
fi

echo
echo "Restoration plan:"
echo "Data:"
echo "  copy extracted data/ -> /opt/kurukuru-monitor/data"
echo
echo "MediaMTX:"
echo "  copy mediamtx.yml -> /opt/kurukuru-monitor/mediamtx/"
echo
echo "Environment:"
echo "  review manually before replacing /etc/kurukuru-monitor/.env.production"
echo
echo "Logs:"
echo "  optional restore to /var/log/kurukuru-monitor"
echo
echo "Preview extracted files under: $RESTORE_ROOT"

prompt_yes_no() {
  local prompt_text="$1"
  local response
  read -r -p "$prompt_text (y/N) " response
  [[ "$response" == "y" || "$response" == "Y" ]]
}

copy_directory_if_present() {
  local source_dir="$1"
  local target_dir="$2"

  if [[ -d "$source_dir" ]]; then
    mkdir -p "$target_dir"
    cp -a "$source_dir"/. "$target_dir"/
    echo "Copied directory: $source_dir -> $target_dir"
  else
    echo "Skipped missing directory: $source_dir"
  fi
}

copy_file_if_present() {
  local source_file="$1"
  local target_file="$2"

  if [[ -f "$source_file" ]]; then
    mkdir -p "$(dirname "$target_file")"
    cp -a "$source_file" "$target_file"
    echo "Copied file: $source_file -> $target_file"
  else
    echo "Skipped missing file: $source_file"
  fi
}

if [[ "$APPLY_MODE" == "--apply" ]]; then
  EXTRACTED_DATA_DIR="$(find "$RESTORE_ROOT" -type d -path '*/opt/kurukuru-monitor/data' | head -n 1 || true)"
  EXTRACTED_MEDIAMTX_FILE="$(find "$RESTORE_ROOT" -type f -path '*/opt/kurukuru-monitor/mediamtx/mediamtx.yml' | head -n 1 || true)"
  EXTRACTED_ENV_FILE="$(find "$RESTORE_ROOT" -type f -path '*/etc/kurukuru-monitor/.env.production' | head -n 1 || true)"
  EXTRACTED_LOGS_DIR="$(find "$RESTORE_ROOT" -type d -path '*/var/log/kurukuru-monitor' | head -n 1 || true)"

  echo
  echo "Apply mode enabled."

  if prompt_yes_no "Restore application data?"; then
    copy_directory_if_present "$EXTRACTED_DATA_DIR" "/opt/kurukuru-monitor/data"
  fi

  if prompt_yes_no "Restore MediaMTX config?"; then
    copy_file_if_present "$EXTRACTED_MEDIAMTX_FILE" "/opt/kurukuru-monitor/mediamtx/mediamtx.yml"
  fi

  if prompt_yes_no "Restore environment file?"; then
    copy_file_if_present "$EXTRACTED_ENV_FILE" "/etc/kurukuru-monitor/.env.production"
  fi

  if prompt_yes_no "Restore logs?"; then
    copy_directory_if_present "$EXTRACTED_LOGS_DIR" "/var/log/kurukuru-monitor"
  fi
fi

echo
echo "Recommended:"
echo "  systemctl restart kurukuru-api"
echo "  systemctl restart kurukuru-mediamtx"
echo "  systemctl restart nginx"
