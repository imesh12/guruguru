#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo ".env file not found. Copy .env.example to .env first." >&2
  exit 1
fi

set -a
source .env
set +a

echo "[security-check] Checking .env presence"

if [[ -z "${CREDENTIAL_ENCRYPTION_KEY:-}" ]]; then
  echo "[security-check] WARNING: CREDENTIAL_ENCRYPTION_KEY is not set"
else
  echo "[security-check] Encryption key is set"
fi

if [[ "${API_HOST:-127.0.0.1}" != "127.0.0.1" ]]; then
  echo "[security-check] WARNING: API_HOST is ${API_HOST}; verify external access is intentional"
else
  echo "[security-check] API_HOST is locked to 127.0.0.1"
fi

if [[ "${NODE_ENV:-development}" == "production" && -z "${API_TOKEN:-}" ]]; then
  echo "[security-check] WARNING: API_TOKEN is not set in production mode"
else
  echo "[security-check] API token check complete"
fi

if grep -Eq 'CAMERA_.*PASSWORD="[^"]+"' .env.example; then
  echo "[security-check] WARNING: .env.example still contains non-empty sample RTSP passwords"
else
  echo "[security-check] Sample RTSP password fields are blank"
fi
