#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ $EUID -eq 0 ]]; then
  echo "Run this script as the application user, not as root. It uses sudo internally." >&2
  exit 1
fi

APP_USER="${APP_USER:-$USER}"
APP_GROUP="${APP_GROUP:-$(id -gn "$APP_USER")}"
WORKDIR="${WORKDIR:-$ROOT_DIR}"
DISPLAY_VALUE="${DISPLAY_VALUE:-${DISPLAY:-:0}}"
XAUTHORITY_VALUE="${XAUTHORITY_VALUE:-$HOME/.Xauthority}"
SYSTEMD_DIR="/etc/systemd/system"

render_unit() {
  local template="$1"
  local target="$2"
  sed \
    -e "s|{{APP_USER}}|$APP_USER|g" \
    -e "s|{{APP_GROUP}}|$APP_GROUP|g" \
    -e "s|{{WORKDIR}}|$WORKDIR|g" \
    -e "s|{{DISPLAY}}|$DISPLAY_VALUE|g" \
    -e "s|{{XAUTHORITY}}|$XAUTHORITY_VALUE|g" \
    "$template" | sudo tee "$target" >/dev/null
}

render_unit "$ROOT_DIR/services/systemd/kurukuru-api.service" "$SYSTEMD_DIR/kurukuru-api.service"
render_unit "$ROOT_DIR/services/systemd/kurukuru-desktop.service" "$SYSTEMD_DIR/kurukuru-desktop.service"

sudo systemctl daemon-reload
sudo systemctl enable kurukuru-api.service kurukuru-desktop.service
sudo systemctl restart kurukuru-api.service
sudo systemctl restart kurukuru-desktop.service

echo "Installed and started kurukuru-api.service and kurukuru-desktop.service"
