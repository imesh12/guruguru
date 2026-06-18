#!/usr/bin/env bash
set -euo pipefail

sudo systemctl --no-pager --full status kurukuru-api.service kurukuru-desktop.service
