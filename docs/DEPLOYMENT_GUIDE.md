# Deployment Guide

## Recommendation

Recommended order for client rollout:

1. Windows portable deployment
2. Windows installer deployment

Windows portable should be the first production path because the repository already includes Windows startup scripts, scheduled-task auto-start helpers, local SQLite storage, and a practical `.env` pattern. A full Windows installer can be added later, but it is not the most mature deployment path in the current repo state.

## Current Deployment Reality

### What is already supported well

- Windows source-based portable deployment
- Windows scheduled-task auto-start
- Local Fastify API on the same PC
- Electron desktop on the same PC
- Prisma with SQLite local database
- MediaMTX managed locally by the desktop process
- mpv installed separately on the client PC
- Rooster SE220 direct polling from the API
- Ubuntu source deployment with systemd services

### What is only partially prepared

- Windows packaged installer deployment
- Windows packaged EXE distribution
- Electron packaging metadata exists in `apps/desktop/package.json`
- Windows icon assets are now in place
- But there is no complete installer pipeline yet:
  - no `electron-builder` dependency
  - no installer build script
  - no NSIS / MSI / Squirrel configuration
  - no bundled API packaging flow

### Practical conclusion

Today, the most realistic deployment target is:

- Windows portable deployment from a prepared application folder

Secondary target:

- Ubuntu source deployment using the existing service scripts

Future target:

- Windows installer packaging after build tooling is added

## Repository Inspection Summary

### Root scripts

From [package.json](/C:/Users/cs_in/projects/kurukuru-monitor/package.json):

- `pnpm dev`
- `pnpm build`
- `pnpm build:release`
- `pnpm start:api`
- `pnpm start:desktop`
- `pnpm deploy:check`
- `pnpm deploy:start-api`
- `pnpm deploy:start-desktop`
- `pnpm deploy:install-tasks`
- `pnpm deploy:uninstall-tasks`

These show that the project already expects a two-process local deployment:

- API process
- Desktop process

### Desktop build status

From [apps/desktop/package.json](/C:/Users/cs_in/projects/kurukuru-monitor/apps/desktop/package.json):

- Electron main entry exists
- icon configuration exists for Windows and Linux
- build output exists through `electron-vite build`

But packaging is not complete yet because:

- there is no installer tool dependency
- there is no script such as `dist:win`, `pack`, or `make`
- there is no published portable archive process

### API build status

From [apps/api/package.json](/C:/Users/cs_in/projects/kurukuru-monitor/apps/api/package.json):

- `dev`: `tsx watch src/server.ts`
- `start`: `node dist/server.js`
- `build`: `tsc -p tsconfig.json`

This is production-usable in a local Node runtime on Windows or Ubuntu.

## Windows Portable Deployment

## Target Layout

Recommended client folder layout on the PC:

```text
C:\KurukuruMonitor\
  .env
  package.json
  pnpm-lock.yaml
  apps\
  prisma\
  scripts\
  mediamtx\
  data\
    kurukuru.db
    logs\
    diagnostics\
    electron-user-data\
    electron-cache\
```

Use a dedicated local folder such as `C:\KurukuruMonitor` instead of `Downloads` or the Desktop.

## Windows Prerequisites

Install on the client PC:

- Node.js 22 or newer
- Corepack enabled
- pnpm through Corepack
- mpv installed locally
- MediaMTX binary available to the desktop app

Recommended checks:

```powershell
node --version
corepack pnpm --version
mpv --version
```

MediaMTX can be placed in one of these expected locations:

- `C:\KurukuruMonitor\mediamtx\mediamtx.exe`
- `C:\KurukuruMonitor\tools\mediamtx\mediamtx.exe`
- or on `PATH`

## Windows Portable Installation Procedure

1. Copy the repository contents to `C:\KurukuruMonitor`.
2. Copy `.env.production.example` or `.env.example` to `.env`.
3. Edit `.env` for the site.
4. Install dependencies:

```powershell
cd C:\KurukuruMonitor
corepack pnpm install --frozen-lockfile
```

5. Generate Prisma client and initialize schema:

```powershell
corepack pnpm prisma:generate
corepack pnpm prisma:push
```

6. Build the API and desktop:

```powershell
corepack pnpm build
```

7. Run deployment validation:

```powershell
corepack pnpm deploy:check
```

8. Start the API:

```powershell
corepack pnpm deploy:start-api
```

9. Start the desktop:

```powershell
corepack pnpm deploy:start-desktop
```

## Auto-Start On Boot

Recommended Windows auto-start method:

- Scheduled Tasks

The repository already includes:

- [scripts/install-windows-tasks.ps1](/C:/Users/cs_in/projects/kurukuru-monitor/scripts/install-windows-tasks.ps1)
- [scripts/uninstall-windows-tasks.ps1](/C:/Users/cs_in/projects/kurukuru-monitor/scripts/uninstall-windows-tasks.ps1)
- [scripts/start-api.ps1](/C:/Users/cs_in/projects/kurukuru-monitor/scripts/start-api.ps1)
- [scripts/start-desktop.ps1](/C:/Users/cs_in/projects/kurukuru-monitor/scripts/start-desktop.ps1)

Install the tasks:

```powershell
corepack pnpm deploy:install-tasks
```

What this does:

- creates `Kurukuru Monitor API` at logon
- creates `Kurukuru Monitor Desktop` at logon
- delays desktop launch by about 25 seconds
- waits for API health before launching the desktop

Recommended client behavior:

- use automatic logon only if the PC is dedicated and physically controlled
- otherwise require the operator to log in after boot

## `.env` Setup

Use `.env.production.example` as the main baseline for client deployment.

Important settings:

```env
APP_DATA_DIR="./data"
ELECTRON_USER_DATA_DIR="./data/electron-user-data"
ELECTRON_CACHE_DIR="./data/electron-cache"
DATABASE_URL="file:./data/kurukuru.db"
API_HOST="127.0.0.1"
API_PORT="4000"
VITE_API_BASE_URL="http://127.0.0.1:4000"
API_TOKEN="<set-admin-token>"
MPV_PATH="C:\\Program Files\\mpv\\mpv.exe"
MEDIAMTX_WEBRTC_BASE="http://127.0.0.1:8889"
SE220_DIRECT_POLLING_ENABLED=true
SE220_DIRECT_POLLERS=vehicle-id|route-id|https://router-public-ip|admin|password
```

Recommended Windows values:

- keep API bound to `127.0.0.1`
- keep desktop pointing to `http://127.0.0.1:4000`
- keep data and Electron cache inside the app folder
- set `MPV_PATH` explicitly on client machines

## SQLite Data Folder

Current database model:

- SQLite file in `APP_DATA_DIR`
- default path: `./data/kurukuru.db`

Operational notes:

- keep the `data` folder on local SSD storage
- exclude the live database from cloud-sync folders
- do not run SQLite vacuum while the API is active
- back up the whole `data` folder regularly

Important subfolders:

- `data\kurukuru.db`
- `data\logs`
- `data\diagnostics`
- `data\electron-user-data`
- `data\electron-cache`

## MediaMTX Setup

Current behavior:

- the Electron desktop manages MediaMTX locally
- the desktop rewrites `mediamtx\mediamtx.yml`
- the desktop starts and restarts MediaMTX as needed

Client setup steps:

1. Download MediaMTX for Windows.
2. Place `mediamtx.exe` in:
   - `C:\KurukuruMonitor\mediamtx\mediamtx.exe`
3. Keep `mediamtx.yml` under:
   - `C:\KurukuruMonitor\mediamtx\mediamtx.yml`

Useful references:

- [docs/mediamtx-local-setup.md](/C:/Users/cs_in/projects/kurukuru-monitor/docs/mediamtx-local-setup.md)
- [scripts/start-mediamtx.ps1](/C:/Users/cs_in/projects/kurukuru-monitor/scripts/start-mediamtx.ps1)

Expected local ports:

- RTSP `8554`
- HLS `8888`
- WebRTC/WHEP `8889`
- MediaMTX API `9997`

Firewall note:

- these ports are mainly local-sidecar ports on the client PC
- keep them local-only unless remote support requires otherwise

## mpv Setup

Current behavior:

- mpv is not bundled by the app
- Electron launches mpv as an external helper for playback

Recommended client setup:

1. Install mpv on the Windows PC.
2. Set `MPV_PATH` in `.env`.
3. Confirm:

```powershell
& "C:\Program Files\mpv\mpv.exe" --version
```

Why explicit `MPV_PATH` is preferred:

- avoids PATH-related surprises on client machines
- keeps the deployment checklist predictable

## Rooster SE220 Router Configuration

This project currently supports two GNSS input styles:

1. NMEA receiver mode
2. direct polling mode

For the stated client setup, direct polling is the intended path.

### Direct polling settings

Use:

```env
SE220_DIRECT_POLLING_ENABLED=true
SE220_DIRECT_POLLERS=vehicle-1|route-1|https://<router1-public-ip>|admin|password,vehicle-2|route-2|https://<router2-public-ip>|admin|password
SE220_DIRECT_POLL_INTERVAL_MS=1000
SE220_DIRECT_REQUEST_TIMEOUT_MS=3000
SE220_DIRECT_ALLOW_SELF_SIGNED=true
```

Client/router requirements:

- each vehicle router must be reachable from the client PC
- stable public IP, VPN, or equivalent reachability is required
- HTTPS access to the Rooster SE220 GNSS endpoint must work
- if self-signed certificates are used, keep `SE220_DIRECT_ALLOW_SELF_SIGNED=true`

### NMEA receiver mode

If direct polling is not used, configure:

```env
SE220_RECEIVER_ENABLED=true
SE220_RECEIVER_MODE=udp
SE220_RECEIVER_PORT=5010
SE220_VEHICLE_MAP='{"192.168.10.21":"vehicle-1","192.168.10.22":"vehicle-2"}'
```

Then configure each router to send NMEA0183 to the API host and port.

## Backup And Restore

Recommended backup scope:

- `.env`
- `data\kurukuru.db`
- `data\logs`
- `data\diagnostics`
- `mediamtx\mediamtx.yml`

### Simple backup procedure

1. Stop the API and desktop tasks or close the app.
2. Copy the whole `data` folder.
3. Copy `.env`.
4. Store backups outside the runtime folder.

Recommended retention:

- latest daily backup
- latest weekly backup
- pre-update backup

### Restore procedure

1. Stop desktop and API processes.
2. Restore `data\kurukuru.db`.
3. Restore `.env`.
4. Restore any known-good MediaMTX config if needed.
5. Start API.
6. Start desktop.
7. Run `corepack pnpm deploy:check`.

## Update Procedure

Recommended portable update flow:

1. Export diagnostics if there is a live issue.
2. Back up `data` and `.env`.
3. Copy updated source files into the deployment folder.
4. Run:

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm prisma:generate
corepack pnpm prisma:push
```

5. Restart:
   - `Kurukuru Monitor API`
   - `Kurukuru Monitor Desktop`
6. Verify:
   - `/health`
   - desktop opens
   - camera states recover
   - GPS updates recover

## Windows Installer Deployment

## Recommendation

Treat Windows installer deployment as phase 2, not phase 1.

Reason:

- the repo has partial Electron build metadata
- but does not yet have a complete installer toolchain
- API + desktop + MediaMTX + mpv still need a coordinated installer strategy

## What an installer would need

A real installer should eventually handle:

- app files
- Node runtime strategy
- API build output
- desktop build output
- `.env` bootstrap
- MediaMTX binary placement
- mpv installation or documented prerequisite
- scheduled-task registration
- upgrade-safe `data` preservation

## Practical interim plan

If an installer is required later, build it after these decisions are made:

1. Should Node be bundled or preinstalled?
2. Should MediaMTX be bundled?
3. Should mpv be bundled or remain external?
4. Should the app run from Scheduled Tasks or a Windows service helper?
5. How should `.env` be created on first run?

Until then, use portable deployment.

## Ubuntu Deployment Requirements

Ubuntu deployment already has a documented path and should be treated as a separate installation model.

Primary reference:

- [docs/ubuntu-deployment.md](/C:/Users/cs_in/projects/kurukuru-monitor/docs/ubuntu-deployment.md)

Ubuntu requires:

- Node.js 22+
- pnpm via Corepack
- Linux desktop session for Electron
- systemd services
- `mpv`, `ffmpeg`, `sqlite3`
- display/Xauthority configuration for desktop auto-start

Ubuntu is currently better documented for:

- auto-start through systemd
- service restart
- journal-based logging
- field deployment on a dedicated receiving PC

But for this client request, Windows portable is still the better first recommendation because:

- development is already on Windows
- the client PC is assumed to be Windows-first
- the repo already includes Windows launch and task scripts
- support and troubleshooting will be simpler during early rollout

## Supported Deployment Target Summary

### First choice

- Windows portable deployment from a prepared app folder

### Second choice

- Ubuntu source deployment with systemd services

### Not yet first-class

- Windows packaged installer / single-click EXE deployment

## Operational Checklist For Client PC

Before handoff, verify:

- Node 22+ installed
- `corepack pnpm --version` works
- `mpv --version` works
- MediaMTX binary exists
- `.env` is present and reviewed
- `corepack pnpm build` completed
- `corepack pnpm deploy:check` passes
- scheduled tasks installed
- reboot/logon recovery tested
- both vehicle GNSS feeds update
- both camera streams recover
- backup copy taken

