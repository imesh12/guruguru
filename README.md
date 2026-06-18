# Kurukuru Monitor

Kurukuru Monitor is a real-time vehicle monitoring and operation support system for municipal and field operations. It combines GNSS/GPS ingestion, live map visualization, camera monitoring, and an Electron-based operator desktop in a single monorepo.

## Project Overview

Main functions:

- Live vehicle location monitoring
- GPS/GNSS data ingestion
- Android GPS tracker support
- SE220 router GNSS direct polling support
- WebSocket real-time updates
- Google Maps / Mapbox map display
- Vehicle follow mode
- 3D map mode
- Place markers
- Video wall / camera monitoring
- MediaMTX / WebRTC camera streaming support
- Desktop operator application using Electron

## Architecture

Main components:

- `apps/api`: Fastify backend API server for GPS, system status, camera status, diagnostics, and realtime updates
- `apps/desktop`: Electron desktop client with React UI, map views, settings, control dashboard, and video wall
- `apps/vehicle-agent`: vehicle-side/agent-side integration workspace
- `mediamtx`: MediaMTX configuration and runtime support for camera streaming
- `prisma`: Prisma schema and seed files for SQLite-backed application data
- `docs`: deployment notes, handover documents, operational reports, and investigations

Data flow:

```text
GPS device / Android tracker / SE220 router
  -> API server
  -> location manager / latest-state memory / SQLite persistence
  -> WebSocket + HTTP latest endpoints
  -> Electron desktop
  -> map UI / operator dashboard / video wall
```

## Services Used

- Node.js
- pnpm / Corepack
- Fastify
- Prisma
- SQLite
- Electron
- React
- Vite / electron-vite
- Tailwind CSS
- WebSocket
- Google Maps API
- Mapbox GL
- MediaMTX
- WebRTC / WHEP
- Android GPS tracker integration
- SE220 GNSS router polling

## Repository Layout

```text
apps/
  api/
  desktop/
  vehicle-agent/
docs/
mediamtx/
prisma/
scripts/
```

## Environment Variables

Common variables used in this project:

- `API_PORT`: API server port
- `API_HOST`: API server bind host
- `API_AUTH_TOKEN`: admin/API authentication token used by operators or integrations
- `VITE_API_BASE_URL`: desktop/frontend API base URL
- `VITE_MAP_PROVIDER`: `google` or `mapbox`
- `VITE_GOOGLE_MAPS_API_KEY`: Google Maps JavaScript API key
- `VITE_MAPBOX_ACCESS_TOKEN`: Mapbox access token
- `VITE_DEMO_MODE`: enables demo/mock behavior where configured

Important:

- Never commit `.env` files.
- Never commit real API keys, tokens, or secrets.
- Rotate secrets immediately if they were previously exposed in generated artifacts or logs.

## Installation

```bash
corepack enable
corepack pnpm install
```

On a fresh machine, this repository may also require package build approvals:

```bash
corepack pnpm approve-builds
```

## Development Run

Run the full workspace:

```bash
corepack pnpm dev
```

Run only the API:

```bash
corepack pnpm --filter @kurukuru-monitor/api dev
```

Run only the desktop app:

```bash
corepack pnpm --filter @kurukuru-monitor/desktop dev
```

Root-level convenience scripts also exist:

```bash
corepack pnpm dev:api
corepack pnpm dev:desktop
```

Notes:

- The API usually runs on port `4000` or `4001` depending on local configuration.
- The desktop expects `VITE_API_BASE_URL` to point to the local API instance.

## Build

Build the full workspace:

```bash
corepack pnpm build
```

Build only the desktop app:

```bash
corepack pnpm --filter @kurukuru-monitor/desktop build
```

Related desktop packaging commands:

```bash
corepack pnpm --filter @kurukuru-monitor/desktop pack
corepack pnpm --filter @kurukuru-monitor/desktop dist
```

Do not commit generated build output such as:

- `apps/desktop/dist-new/`
- `apps/desktop/out/`
- `apps/desktop/dist/`
- `apps/desktop/dist-electron/`

## Database

Kurukuru Monitor uses Prisma with SQLite for application data, GPS persistence, route history, and operational records.

Available workspace commands:

```bash
corepack pnpm prisma:generate
corepack pnpm prisma:push
corepack pnpm prisma:migrate:dev
corepack pnpm db:seed
```

If additional Prisma-related workflows are needed, check:

- [package.json](C:/Users/cs_in/projects/kurukuru-monitor/package.json)
- [apps/api/package.json](C:/Users/cs_in/projects/kurukuru-monitor/apps/api/package.json)

Runtime database files must not be committed.

## Running MediaMTX

MediaMTX is used for camera stream management and WebRTC/WHEP delivery support.

Configuration file:

- [mediamtx/mediamtx.yml](C:/Users/cs_in/projects/kurukuru-monitor/mediamtx/mediamtx.yml)

Notes:

- Do not commit MediaMTX binaries.
- Do not commit `mediamtx.exe`.
- Do not commit generated runtime files or logs from MediaMTX.

## Useful Commands

```bash
corepack pnpm typecheck
corepack pnpm gps:mock
corepack pnpm gps:nmea-test
corepack pnpm deploy:check
corepack pnpm deploy:start-api
corepack pnpm deploy:start-desktop
corepack pnpm maintenance:prune-orphans
```

## Git / Repository Notes

Configured remotes:

- `origin`: GitHub remote
- `office`: Office Git server remote

Remote URLs:

- GitHub: [https://github.com/imesh12/guruguru.git](https://github.com/imesh12/guruguru.git)
- Office Git: [http://192.168.1.40:3000/imesh/guruguru.git](http://192.168.1.40:3000/imesh/guruguru.git)

Do not commit:

- `.env` files
- build outputs
- packaged desktop apps
- database runtime files
- logs
- MediaMTX binaries
- secrets / API keys

## Troubleshooting

### API unavailable

- Confirm the API process is running.
- Verify `VITE_API_BASE_URL` points to the correct local API URL.
- Check whether the API is listening on port `4000` or `4001`.

### WebSocket reconnecting

- Confirm the API is reachable over HTTP first.
- Check whether `/ws/vehicles` is available from the desktop environment.
- Inspect API logs for connection resets or local firewall issues.

### Map not showing

- Confirm the selected provider in `VITE_MAP_PROVIDER`.
- For Google Maps, ensure `VITE_GOOGLE_MAPS_API_KEY` is set.
- For Mapbox, ensure `VITE_MAPBOX_ACCESS_TOKEN` is set.

### GPS vehicle count is 0

- Check Android tracker / SE220 input health.
- Verify `/gps/latest` returns vehicles.
- Confirm the desktop is connected to the same API base URL as the backend being tested.

### Media stream not loading

- Confirm camera RTSP settings are valid.
- Check MediaMTX configuration and runtime health.
- Verify WebRTC/WHEP endpoints are reachable from the desktop app.

### GitHub push blocked by secrets or large files

- Remove generated build outputs from Git before pushing.
- Remove or rewrite any committed files containing secrets.
- Rotate secrets if they were ever exposed.

## Current Status

- Repository cleanup completed
- GitHub push successful
- Office Git push successful
- Large generated build files removed from Git history
- Secret-containing generated outputs removed
- Build and runtime folders are ignored in `.gitignore`
- Secrets must be rotated if they were previously exposed
- README updated for handover, build, and run documentation

## Additional Documentation

- [docs/ubuntu-deployment.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/ubuntu-deployment.md:1)
- [docs/production-operations.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/production-operations.md:1)
- [docs/field-test-checklist.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/field-test-checklist.md:1)
- [docs/security-hardening.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/security-hardening.md:1)
- [docs/operation-manual.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/operation-manual.md:1)
- [docs/handover-checklist.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/handover-checklist.md:1)
- [docs/system-summary-for-client.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/system-summary-for-client.md:1)
- [.env.production.example](C:/Users/cs_in/projects/kurukuru-monitor/.env.production.example:1)
