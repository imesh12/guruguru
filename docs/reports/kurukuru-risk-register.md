# Kurukuru Monitor Risk Register

| ID | Category | Risk Description | Severity | Mitigation Strategy |
|---|---|---|---|---|
| R01 | Network | **Public HTTP API Risk**: Fastify server runs on HTTP by default. | High | Deploy behind Nginx or Caddy with TLS. |
| R02 | Security | **Token Leakage**: Open CORS (`origin: true`) allows any domain to hit the API. | High | Restrict CORS to `localhost` and specific internal domains. |
| R03 | Security | **Missing DB Encryption**: Camera passwords stored in DB might be plaintext if `CREDENTIAL_ENCRYPTION_KEY` is missing. | Medium | Enforce `CREDENTIAL_ENCRYPTION_KEY` presence in production startup. |
| R04 | Database | **SQLite Production Limitations**: Route history might bloat the SQLite database, slowing down queries. | Medium | Ensure `runRetentionCleanup` correctly limits data to 30/90 days and schedules `VACUUM`. |
| R05 | Architecture| **Electron Config Resolution**: `main.ts` walks up tree to find `.env`. This breaks in packaged Windows apps. | High | Use `app.getPath('userData')` for production `.env` files or read directly from registry/env vars. |
| R06 | UX | **Map Camera Reset**: Toggling 3D/2D snaps the map back to the live vehicle, interrupting user panning. | Medium | Remove `keepVehicleInView()` from `togglePerspective()` unless the user hasn't panned manually. |
| R07 | Reliability | **Process Management**: Reliance on PowerShell scripts for startup (`start-api.ps1`). | Medium | Use NSSM to install API and MediaMTX as native Windows Services with auto-restart. |
| R08 | Security | **WebSocket Auth**: `/ws/vehicles` endpoint lacks token validation during handshake. | Medium | Add Bearer token check in WebSocket upgrade hook. |
| R09 | GPS Data | **Spoofing / Invalid Coordinates**: No "impossible jump" detection. | Low | Add Haversine distance/speed checks between sequential points. |
| R10 | Logs | **Log Growth**: Custom `FileLogger` might fill the disk over time. | Low | Implement log rotation (e.g., keep last 14 days, max 50MB per file). |
