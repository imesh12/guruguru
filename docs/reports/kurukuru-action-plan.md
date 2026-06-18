# Kurukuru Monitor Action Plan

## Phase 1: Immediate Fixes (1-2 Days)

### 1. Map Panel UX Fix
**Problem**: Toggling between 2D and 3D maps snaps the camera back to the live vehicle, which is frustrating if the user was investigating a specific area.
**Action**: Modify `MapPanel.tsx`. 
- In `applyGooglePerspective` and `applyMapboxPerspective`, conditionally call `keepVehicleInView()` only if `userHasInteractedRef.current` is `false`.

### 2. Fastify CORS & Security
**Problem**: `origin: true` is unsafe.
**Action**: Update `apps/api/src/server.ts` to restrict CORS to `electron://*`, `http://localhost:*`, and the specific production UI domain.

### 3. Require Encryption Key
**Problem**: System starts with a warning if `CREDENTIAL_ENCRYPTION_KEY` is missing.
**Action**: In production mode (`NODE_ENV=production`), make the API crash/exit if the key is not set to prevent saving plaintext camera passwords.

---

## Phase 2: Short Term Hardening (1-2 Weeks)

### 1. Windows Service Installation
**Action**: Replace the `.ps1` auto-start scripts with NSSM (Non-Sucking Service Manager).
- Create `install-nssm.ps1` to register `kurukuru-api.exe` and `mediamtx.exe` as Windows Services.
- Configure recovery options (Restart Service after 1 minute on failure).

### 2. Desktop Packaged Env Fix
**Action**: Update `electron/main.ts` `resolveRepoRoot()` and `.env` loading logic. In a packaged app (`app.isPackaged`), the app should look for config files in `%APPDATA%/Kurukuru Monitor/config.env` rather than traversing the installation directory up to the root.

### 3. WebSocket Authentication
**Action**: Update `apps/api/src/websocket.ts`. Reject WebSocket connections if a valid token is not provided in the connection request (via query string or subprotocol).

---

## Phase 3: Medium Term (1 Month)

### 1. TLS/HTTPS Termination
**Action**: Set up Caddy server as a reverse proxy on the deployment machine. 
- Route `443` to `127.0.0.1:4000`.
- Automatically provision self-signed or Let's Encrypt certificates for the API.

### 2. Log Rotation
**Action**: Upgrade `FileLogger` in `apps/api/src/services/file-logger.ts` to use a stream with rotation (e.g., `pino-roll` or `winston-daily-rotate-file`) to prevent disk exhaustion.

### 3. DB Backup Strategy
**Action**: Create a scheduled task that copies `dev.db` using SQLite online backup API (`.backup`) to a safe storage location daily. Do not copy the file directly while WAL mode is active to avoid corruption.

---

## Phase 4: Long Term

### 1. Advanced GPS Filtering
**Action**: Add a kalman filter or simple speed-gate in `LocationManager` to drop points that require the vehicle to travel >150km/h.

### 2. Monitoring Dashboard
**Action**: Expose a Prometheus metrics endpoint from Fastify. Monitor WebSocket active connections, GPS point ingest rate, and SQLite disk size.
