#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "This script must be run as root or with sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

APP_ROOT="/opt/kurukuru-monitor"
APP_SCRIPTS_DIR="$APP_ROOT/scripts"
APP_BACKUPS_DIR="$APP_ROOT/backups"
APP_LOGS_DIR="$APP_ROOT/logs"
ETC_DIR="/etc/kurukuru-monitor"
SYSTEM_LOG_DIR="/var/log/kurukuru-monitor"

copy_if_exists() {
  local source_path="$1"
  local target_path="$2"

  if [[ -f "$source_path" ]]; then
    cp "$source_path" "$target_path"
    echo "Copied: $source_path -> $target_path"
  else
    echo "Skipped missing file: $source_path"
  fi
}

echo "Preparing production directories..."
mkdir -p \
  "$APP_ROOT" \
  "$APP_SCRIPTS_DIR" \
  "$APP_BACKUPS_DIR" \
  "$APP_LOGS_DIR" \
  "$ETC_DIR" \
  "$SYSTEM_LOG_DIR"

copy_if_exists "$DEPLOYMENT_DIR/systemd/kurukuru-api.service" "/etc/systemd/system/kurukuru-api.service"
copy_if_exists "$DEPLOYMENT_DIR/systemd/kurukuru-mediamtx.service" "/etc/systemd/system/kurukuru-mediamtx.service"

if [[ -d /etc/nginx/sites-available ]]; then
  copy_if_exists "$DEPLOYMENT_DIR/nginx/kurukuru-monitor.conf" "/etc/nginx/sites-available/kurukuru-monitor.conf"
else
  echo "Skipped nginx template copy because /etc/nginx/sites-available does not exist."
fi

copy_if_exists "$DEPLOYMENT_DIR/scripts/health-check.sh" "$APP_SCRIPTS_DIR/health-check.sh"
copy_if_exists "$DEPLOYMENT_DIR/scripts/failover-check.sh" "$APP_SCRIPTS_DIR/failover-check.sh"

if [[ -f "$APP_SCRIPTS_DIR/health-check.sh" ]]; then
  chmod +x "$APP_SCRIPTS_DIR/health-check.sh"
fi

if [[ -f "$APP_SCRIPTS_DIR/failover-check.sh" ]]; then
  chmod +x "$APP_SCRIPTS_DIR/failover-check.sh"
fi

if command -v nginx >/dev/null 2>&1; then
  if [[ -f /etc/nginx/sites-available/kurukuru-monitor.conf && -d /etc/nginx/sites-enabled ]]; then
    if [[ ! -L /etc/nginx/sites-enabled/kurukuru-monitor.conf ]]; then
      ln -s /etc/nginx/sites-available/kurukuru-monitor.conf /etc/nginx/sites-enabled/kurukuru-monitor.conf
      echo "Created nginx site symlink."
    else
      echo "nginx site symlink already exists."
    fi
  fi

  echo "Running nginx configuration test..."
  nginx -t
else
  echo "nginx not found. Skipping nginx validation."
fi

echo "Reloading systemd daemon..."
systemctl daemon-reload

cat <<'EOF'

Install template deployment completed.

Next manual steps:
1. Place the application build and runtime files under /opt/kurukuru-monitor
2. Create /etc/kurukuru-monitor/.env.production
3. Install production dependencies if they are not already installed
4. Review nginx, systemd, and MediaMTX paths for this server
5. Enable and start services manually:
   sudo systemctl enable kurukuru-api kurukuru-mediamtx nginx
   sudo systemctl start kurukuru-api kurukuru-mediamtx nginx

Important:
- This script does not create or overwrite /etc/kurukuru-monitor/.env.production
- This script does not start services automatically
- Inspect all templates before running in production

EOF
