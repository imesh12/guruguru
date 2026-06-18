# Kurukuru Monitor Production Readiness Report

## 1. Executive Summary
- **Current System Status**: The Kurukuru Monitor is in a functional state for internal testing and field validation. Core pipelines such as Android GPS ingestion, realtime mapping, and database integration are working. However, the system is not yet hardened for public or municipal production deployment.
- **What is Working**:
  - Android GPS intake via `/api/vehicles/:vehicleId/location`.
  - LocationManager bridge to legacy GPS state.
  - Desktop map with realtime marker updates via WebSocket (`/ws/vehicles`).
  - Google Maps and Mapbox dual-provider support.
  - Fallback map mode (no provider).
  - Basic camera/video wall sessions via MediaMTX and MPV.
  - SQLite with Prisma schema and WAL mode enabled.
- **What is Not Production-Ready**:
  - Missing HTTPS/TLS on the API.
  - Open CORS policy on the backend.
  - Token handling and WebSocket security need hardening.
  - Map jumping behavior needs UX refinement (currently jumping when style changes without live vehicle).
  - Desktop `.env` resolution logic is risky for packaged apps.
  - Log rotation and database retention need strict bounds.
- **Production Readiness Score**: 60 / 100 (Needs hardening before municipal deployment)

## 2. Architecture Overview
- **API Backend**: Node.js + Fastify serving HTTP and WebSockets.
- **Electron Desktop**: React frontend + Vite + Electron main process managing MediaMTX/MPV processes and system tray.
- **GPS/Location Pipeline**: Android Phone POSTs to Fastify -> `LocationManager` -> `GpsStateService` -> `/ws/vehicles` -> MapPanel.tsx.
- **Map Pipeline**: Frontend map using `mapbox-gl` or Google Maps API, updating markers directly via DOM overlay or Mapbox Marker instances to minimize React render overhead.
- **Camera/Video Pipeline**: Support for AXIS/HIKVISION/CUSTOM. MediaMTX used for WebRTC routing. Fallback to MPV for raw RTSP rendering in floating windows over the desktop map.
- **Database**: SQLite using Better-SQLite3 and Prisma ORM.
- **Environment/Configuration**: Relies heavily on `.env` file and Windows PowerShell scripts (`scripts/start-*.ps1`).

## 3. Current Confirmed Working Features
- **Android GPS intake**: Works via HTTP POST, properly bridged to `LocationManager`.
- **LocationManager Bridge**: Confirmed in `server.ts` where `bridgeVehicleLocationToGpsState` accurately updates `gpsState`.
- **Desktop Map Realtime Marker**: WebSocket snapshot and broadcast events accurately render markers.
- **Google/Mapbox Dual Provider**: `MapPanel.tsx` properly falls back between Google, Mapbox, and Demo fallback modes based on `.env` configuration.
- **WebSocket Vehicle Updates**: `websocket.ts` maintains a client list and broadcasts 10s heartbeats and live GPS updates.
- **Camera/Video Features**: Main process `mpv-manager.ts` and `mediamtx-manager.ts` successfully manage camera focus windows and video wall layouts.

## 4. Critical Production Risks
*(Detailed in the Risk Register. Summary below)*
- **High**: Public HTTP API risk (no TLS). Token leakage if accessed over public Wi-Fi.
- **High**: Open CORS (`origin: true`) in Fastify.
- **Medium**: Map camera reset behavior on view toggle.
- **Medium**: `CREDENTIAL_ENCRYPTION_KEY` is optional, meaning camera RTSP passwords might be stored in plaintext.
- **Medium**: Missing process supervisor (e.g., NSSM/PM2). PowerShell startup scripts are fragile.

## 5. MapPanel.tsx Review
- **Providers**: Properly implemented conditional loading for Google and Mapbox.
- **Normal/3D Switching**: Implemented via `applyGooglePerspective` and `applyMapboxPerspective`. *Risk*: Currently, `togglePerspective` calls `keepVehicleInView({ preserveHeading: true })`, which forces the map back to the live vehicle. If no live vehicle exists, it gracefully ignores, but it disrupts user panning if a vehicle *is* active.
- **Camera/Center Behavior**: The UX requires that if a user pans, switching to 3D should NOT snap back to the vehicle unless they click "Locate". The current implementation forcefully centers the vehicle on toggle.
- **Recommended Final UI**: The current UI matches the requested `[3D/2D], [N], [+], [-], [Loc]` layout, floating on the right side.
- **Performance**: High performance. Markers bypass React state and update DOM directly.

## 6. GPS Tracking Review
- **Android Phone GPS Source**: Validated via HTTP POST.
- **Backend POST Validation**: `LocationManager` and `GpsStateService` filter stale nodes and ensure sequential `gnssTime` ingestion.
- **Route History Storage**: Stored in SQLite via `VehicleRoutePoint` (Partitioned by `dateKey` and `weekKey`).
- **Missing**: Impossible jump detection (speed limit filtering) is not strictly enforced in the current ingest layer shown.

## 7. API Backend Review
- **Fastify Route Safety**: Standard Fastify setup, but `origin: true` allows any website to hit the API if exposed.
- **Auth Design**: `requireAdminToken` exists but `/ws/vehicles` lacks strict connection handshake auth.
- **Rate Limiting**: Not confirmed in current code review.
- **Health Endpoints**: `/health` endpoint is available and used by Desktop wait logic.

## 8. Desktop/Electron Review
- **Renderer/Main Separation**: Good contextIsolation using `preload.ts`.
- **Runtime Config**: `main.ts` walks up directories to find `.env`. *Risk*: This will likely break in a standard Windows `.exe` installer (e.g., NSIS or Squirrel) if `.env` is not bundled in the same relative path.
- **Process Management**: Main process properly kills MPV and MediaMTX on exit.

## 9. Camera/Video Wall Review
- **MediaMTX/WHEP**: Fully integrated. Dynamic `mediamtx.yml` generation based on active cameras in the DB.
- **MPV Fallback**: `MpvManager` launches `mpv.exe` as a child process and syncs bounds over the Electron window. Highly effective for low-latency RTSP on Windows.

## 10. Database Review
- **SQLite Suitability**: Fine for current scope, WAL mode is active (`dev.db-wal` exists).
- **Retention**: `maintenance-prune-orphans.mjs` and `locationHistoryStore.runRetentionCleanup` manage route history size.
- **Backups**: Scripts like `backup-settings.sh` exist, but automated DB backups (e.g., Litestream) are missing.

## 11. Logging and Monitoring
- **Structured Logs**: Custom `FileLogger` writes to `data/api.log` and `data/desktop.log`.
- **Log Rotation**: Needs validation (not confirmed if Winston/Pino with daily rotate is used under the hood).
- **Monitoring**: `/system/heartbeat` logs GPU status and MPV process count. Missing external monitoring (Prometheus/Grafana).

## 12. Security Recommendations
- Deploy behind a Reverse Proxy (Nginx/Caddy) with TLS (HTTPS/WSS).
- Change CORS to only allow the specific desktop origins or specific domains.
- Enforce `CREDENTIAL_ENCRYPTION_KEY` in production.
- Add strict API Tokens per vehicle.

## 13. Production Deployment Recommendations
- **Windows Service Strategy**: Convert `start-api.ps1` to a reliable Windows Service using NSSM.
- **Environment Separation**: Ensure `.env` is stored in `%APPDATA%` or a secure system folder, not in the `Program Files` install directory.

## 14. Improvement Roadmap
- **Immediate (1-2 days)**: Fix MapPanel.tsx toggle to prevent auto-centering when a user has manually panned. Implement CORS restrictions.
- **Short term (1-2 weeks)**: Enforce token encryption for cameras. NSSM service wrapping.
- **Medium term (1 month)**: Setup automated DB backups and log rotation. Add GPS jump/speed filtering.
- **Long term**: Migrate to PostgreSQL if the fleet exceeds 100 vehicles.

## 15. Acceptance Checklist
- [x] GPS works
- [x] Map works
- [x] 3D/Normal stable
- [ ] Vehicle does not jump to default (Needs fix in `togglePerspective`)
- [ ] HTTPS enabled
- [ ] token rotation complete
- [ ] logs rotate
- [ ] DB backup tested
- [x] route history tested
- [x] camera reconnect tested
- [ ] production startup tested
- [x] typecheck passed
- [x] build passed

## 16. Final Recommendation
**Status: POC / Internal Testing Ready**
The system is beautifully architected for its use case but needs the security, networking, and deployment scripts tightened before it can be handed over to a municipality for critical operations.
