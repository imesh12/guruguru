#!/usr/bin/env bash
set -euo pipefail

sudo systemctl disable --now kurukuru-desktop.service || true
sudo systemctl disable --now kurukuru-api.service || true
sudo rm -f /etc/systemd/system/kurukuru-api.service /etc/systemd/system/kurukuru-desktop.service
sudo systemctl daemon-reload

echo "Removed kurukuru-monitor systemd services"
