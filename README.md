# kurukuru-monitor

Production-ready pnpm workspace for a desktop monitoring system with Electron, React, Fastify, Prisma, SQLite, Mapbox, and future-ready hooks for mpv video playback plus realtime GPS over WebSocket.

## Stack

- `apps/desktop`: Electron + React + TypeScript + Vite + Tailwind CSS
- `apps/api`: Fastify + TypeScript
- Database: SQLite + Prisma
- Map: Mapbox GL JS
- Prepared integrations: `mpv` player service, realtime GPS WebSocket broadcast, and SE220 GNSS receiver support

## Workspace Layout

```text
apps/
  api/
  desktop/
prisma/
```

## Setup

```bash
pnpm install
pnpm approve-builds
copy .env.example .env
pnpm prisma:generate
pnpm prisma:push
pnpm db:seed
pnpm dev
```

## Useful Commands

```bash
pnpm dev
pnpm dev:desktop
pnpm dev:api
pnpm build
pnpm typecheck
pnpm prisma:generate
pnpm prisma:push
pnpm db:seed
pnpm gps:mock
pnpm gps:nmea-test
```

## Deployment

Ubuntu installation, auto-start, backup, restore, and service operations are documented in [docs/ubuntu-deployment.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/ubuntu-deployment.md:1).

## Production Operations

Long-running operations, diagnostics export, retention policy, and recovery guidance are documented in [docs/production-operations.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/production-operations.md:1).
Offline SQLite compaction is available through [scripts/vacuum-db.sh](C:/Users/cs_in/projects/kurukuru-monitor/scripts/vacuum-db.sh:1), and it should only be run while the API service is stopped.

## Field Test

On-site acceptance workflow, smoke checks, and handover guidance are documented in [docs/field-test-checklist.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/field-test-checklist.md:1).

## Security

Local deployment security hardening, credential encryption, and admin API protection are documented in [docs/security-hardening.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/security-hardening.md:1).

## Demo and Handover

- Operator manual: [docs/operation-manual.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/operation-manual.md:1)
- Handover checklist: [docs/handover-checklist.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/handover-checklist.md:1)
- Client-facing Japanese system summary: [docs/system-summary-for-client.md](C:/Users/cs_in/projects/kurukuru-monitor/docs/system-summary-for-client.md:1)
- Production env template: [.env.production.example](C:/Users/cs_in/projects/kurukuru-monitor/.env.production.example:1)

## Initial Features

- Electron control window with buttons to open the video wall, map, and settings pages
- Electron control window with a System Status summary card and full reliability page
- 4-camera video wall with mpv-backed RTSP session management:
  - Vehicle 1 Front
  - Vehicle 1 Internal
  - Vehicle 2 Front
  - Vehicle 2 Internal
- Realtime GPS map feed with WebSocket updates, marker aging, and local mock simulator
- SE220-ready UDP/TCP NMEA0183 receiver seam with vehicle mapping by source IP
- System health endpoint at `GET /system/status`
- Camera status intake endpoint at `POST /system/camera-status`
- Operator reliability status for API uptime, GPS freshness, camera playback, SE220 receiver, and database writes
- Fastify health endpoint at `GET /health`
- Prisma schema for `vehicles`, `cameras`, `gps_points`, `system_events`, and `app_settings`
- Clean architecture seams for future `mpv` and realtime GPS integrations

## Notes

- Install `mpv` on the monitoring machine and keep it on `PATH` so Electron can spawn it for RTSP playback.
- The desktop app manages `mpv` as external borderless windows positioned near the wall tiles and popup player view.
- The API app exposes a WebSocket-backed realtime GPS flow with latest-state memory, `/gps/latest`, `/gps/mock`, and SQLite history persistence.
- Camera playback status changes are posted back into the API so the operator System Status page can show LIVE, RECONNECTING, and OFFLINE fleet state.
- Important health transitions are persisted into `system_events` only when statuses change, which avoids operator alert spam.
- Vehicles and cameras can now be managed from the desktop Settings page instead of editing seed files for routine changes.
- Set `SE220_RECEIVER_ENABLED=true` to accept real NMEA0183 lines from an SE220 GNSS router over UDP or TCP.
- Runtime watchdog heartbeats, diagnostics export, GPS retention cleanup, and rolling log files are built in for production stabilization.
- On a fresh machine, run `pnpm approve-builds` once so `electron`, `esbuild`, and `prisma` can execute their package build scripts.
- Camera passwords are encrypted at rest when `CREDENTIAL_ENCRYPTION_KEY` is configured. Future work can move this to stronger OS-backed secret storage.

## Camera Setup

- Open the desktop Settings page from the control window.
- Create or edit vehicles with a display color and enabled state.
- Add cameras by choosing the vehicle, camera type, vendor, RTSP URL, credentials, optional bitrate limit, and enabled state.
- Use the built-in `Test Camera` action before saving when you want to confirm that `mpv` can launch the stream.
- If a test fails, the UI asks for explicit confirmation before saving the camera anyway.
- Disabled cameras stay in SQLite but show `Camera disabled` on the video wall and stop active mpv playback when turned off.

### RTSP examples

- Axis: `rtsp://192.168.1.50/axis-media/media.amp`
- Hikvision: `rtsp://192.168.1.60:554/Streaming/Channels/101`
- Custom: `rtsp://username:password@example.local:554/live/main`

## SE220 Setup

### UDP mode

Set these values in `.env`:

```bash
SE220_RECEIVER_ENABLED=true
SE220_RECEIVER_MODE=udp
SE220_RECEIVER_PORT=5010
SE220_VEHICLE_MAP='{"192.168.10.21":"vehicle-1","192.168.10.22":"vehicle-2"}'
```

Configure the SE220/router to send NMEA0183 UDP packets to the API host on the chosen port.

### TCP mode

```bash
SE220_RECEIVER_ENABLED=true
SE220_RECEIVER_MODE=tcp
SE220_RECEIVER_PORT=5010
SE220_VEHICLE_MAP='{"192.168.10.21":"vehicle-1","192.168.10.22":"vehicle-2"}'
```

Configure the SE220/router to connect to the API host as a TCP client and stream newline-delimited NMEA0183 sentences.

### Sample NMEA lines

```text
$GPRMC,092751.000,A,3540.8240,N,13946.1400,E,005.5,084.4,230394,,,A*6C
$GPGGA,092751.000,3540.8240,N,13946.1400,E,1,08,1.0,12.0,M,0.0,M,,*47
$GNRMC,092752.000,A,3540.8960,N,13946.2720,E,004.2,142.1,230394,,,A*68
$GNGGA,092752.000,3540.8960,N,13946.2720,E,1,10,0.8,11.0,M,0.0,M,,*43
```

For local or gateway-based testing, the receiver also accepts an optional prefix form:

```text
receiver=test-vehicle-1;$GPRMC,...
```

This is matched against `SE220_VEHICLE_MAP` keys like `"receiver:test-vehicle-1":"vehicle-1"` and is useful when multiple test senders originate from the same host IP.

### Troubleshooting

- If the API starts but no live fixes appear, check that `SE220_RECEIVER_ENABLED=true` and the port is reachable from the router.
- If you see unknown source warnings, update `SE220_VEHICLE_MAP` so the sender IP maps to `vehicle-1` or `vehicle-2`.
- If `SE220_VEHICLE_MAP` is malformed JSON, the API now fails fast with a clear startup error instead of silently misrouting fixes.
- Use `pnpm gps:nmea-test` to send local sample sentences into the configured receiver mode and then inspect `GET /gps/latest`.

## Operator Troubleshooting

### Camera offline

- Open the System Status page and confirm whether the camera is `RECONNECTING` or `OFFLINE`.
- If the camera stays `OFFLINE`, confirm `mpv` is installed and available on `PATH`.
- Verify the RTSP URL and credentials in the desktop Settings page.
- If only the focus popup is down but the wall tile is still LIVE, the aggregated camera status should remain healthy.

### GPS offline

- Check whether the vehicle is `DELAYED` or `OFFLINE` on the map and System Status page.
- For local development, run `pnpm gps:mock` to confirm the API, WebSocket, and map pipeline are healthy.
- For live GNSS, verify that the SE220 source IP matches an entry in `SE220_VEHICLE_MAP`.

### SE220 receiver not receiving

- Confirm `SE220_RECEIVER_ENABLED=true`, the correct `SE220_RECEIVER_MODE`, and the expected `SE220_RECEIVER_PORT`.
- In TCP mode, make sure the router is configured to connect into the API host instead of waiting for the API to dial out.
- In UDP mode, confirm the API host firewall allows the configured port.
- Use `pnpm gps:nmea-test` to inject sample NMEA lines locally and verify `GET /gps/latest` updates.

### Mapbox token missing

- If `VITE_MAPBOX_ACCESS_TOKEN` is unset, the desktop falls back to the simplified mock map panel instead of crashing.
- Add a valid token in `.env` when you want the full Mapbox basemap.

### mpv not installed

- Install `mpv` on the monitoring machine and keep it on the system `PATH`.
- When `mpv` is unavailable, camera tiles stay `OFFLINE` and the System Status page reflects that state without crashing the desktop.
