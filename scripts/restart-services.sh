#!/usr/bin/env bash
set -euo pipefail

sudo systemctl restart kurukuru-api.service
sudo systemctl restart kurukuru-desktop.service
sudo systemctl --no-pager --full status kurukuru-api.service kurukuru-desktop.service
