#!/usr/bin/env bash
set -euo pipefail

SERVICE="${1:-all}"

case "$SERVICE" in
  api)
    sudo journalctl -u kurukuru-api.service -n 200 -f
    ;;
  desktop)
    sudo journalctl -u kurukuru-desktop.service -n 200 -f
    ;;
  all)
    sudo journalctl -u kurukuru-api.service -u kurukuru-desktop.service -n 200 -f
    ;;
  *)
    echo "Usage: $0 [api|desktop|all]" >&2
    exit 1
    ;;
esac
