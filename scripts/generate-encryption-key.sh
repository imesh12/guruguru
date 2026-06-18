#!/usr/bin/env bash
set -euo pipefail

if command -v openssl >/dev/null 2>&1; then
  openssl rand -base64 32
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY'
import base64, secrets
print(base64.b64encode(secrets.token_bytes(32)).decode())
PY
  exit 0
fi

echo "Unable to generate key automatically. Install openssl or python3." >&2
exit 1
