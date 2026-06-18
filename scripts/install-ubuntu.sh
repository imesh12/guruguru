#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

NODE_MIN_MAJOR=22

log() {
  printf '[install-ubuntu] %s\n' "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node.js ${NODE_MIN_MAJOR}+ before running this script." >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "$NODE_MAJOR" -lt "$NODE_MIN_MAJOR" ]]; then
  echo "Node.js ${NODE_MIN_MAJOR}+ is required. Found $(node -v)." >&2
  exit 1
fi

log "Enabling corepack and preparing pnpm"
corepack enable
corepack prepare pnpm@11.1.1 --activate

require_cmd sudo
log "Installing Ubuntu runtime packages"
sudo apt-get update
sudo apt-get install -y mpv ffmpeg sqlite3 wireguard-tools zip

if [[ ! -f .env ]]; then
  log "No .env file found. Copying from .env.example"
  cp .env.example .env
fi

set -a
source .env
set +a

APP_DATA_DIR="${APP_DATA_DIR:-./runtime}"
KURUKURU_LOG_DIR="${KURUKURU_LOG_DIR:-./runtime/logs}"
REPORT_DIR="$APP_DATA_DIR/reports"
DIAGNOSTICS_DIR="$APP_DATA_DIR/diagnostics"

mkdir -p "$APP_DATA_DIR" "$KURUKURU_LOG_DIR" "$APP_DATA_DIR/backups" "$REPORT_DIR" "$DIAGNOSTICS_DIR"

log "Installing project dependencies"
corepack pnpm install --frozen-lockfile

log "Generating Prisma client"
corepack pnpm prisma:generate

log "Applying Prisma schema"
corepack pnpm prisma:push

if [[ "${SEED_INITIAL_DATA:-false}" == "true" ]]; then
  log "Seeding initial data"
  corepack pnpm db:seed
else
  log "Skipping seed step. Set SEED_INITIAL_DATA=true to seed initial data."
fi

log "Ubuntu install preparation complete"
