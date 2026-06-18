# GNSS SE220 Implementation Report

## 1. Current Situation Summary

### Confirmed field status

- The Rooster SE220 web UI is reachable at `https://192.168.62.1`.
- The GNSS antenna is installed and working.
- The GNSS page shows valid coordinates.
- A working HTTPS API endpoint has been confirmed:

```http
GET https://192.168.62.1/api/get_gnss_info.cgi?token=<TOKEN>
```

- Example response:

```json
{
  "result": true,
  "message": "",
  "processState": "",
  "data": {
    "time": " 2026-05-26T00:56:27Z",
    "latitude": " 35.863239",
    "longitude": " 139.658787"
  }
}
```

### Important parsing notes

- `data.time`, `data.latitude`, and `data.longitude` include leading spaces.
- The implementation must call `trim()` before parsing and validation.
- `latitude` and `longitude` should then be converted to numbers.
- `time` should be preserved as the GNSS timestamp after trimming and ISO validation.

### Security notes

- The router uses a self-signed HTTPS certificate.
- The token must never be hardcoded in source code.
- The token must not be exposed in Electron renderer code.
- The token should be stored in environment or runtime configuration on the trusted backend side only.
- Logs must redact the token and avoid printing raw request URLs with sensitive query strings.

## 2. Repository Context and Fit

The current Kurukuru Monitor repository already has a strong GPS pipeline on the API side:

- `apps/api/src/services/gps-state.ts` maintains latest vehicle location state in memory and persists GPS history to SQLite.
- `apps/api/src/routes/gps.ts` exposes `GET /gps/latest`.
- `apps/api/src/websocket.ts` broadcasts vehicle updates over `GET /ws/vehicles`.
- `apps/api/src/services/system-health.ts` already computes `ONLINE`, `DELAYED`, and `OFFLINE` vehicle freshness states.
- `apps/desktop/src/hooks/useVehicleGpsFeed.ts` consumes `/gps/latest` plus `/ws/vehicles`.
- `apps/desktop/src/pages/MapPage.tsx` and `apps/desktop/src/components/MapPanel.tsx` render the existing map UI.

The repository also already includes `apps/api/src/services/se220-receiver.ts`, but that path is designed for SE220 NMEA0183 UDP/TCP receiver mode. The new requirement is different: poll the SE220 HTTPS GNSS API and normalize its response into the existing GPS pipeline without changing the current map UX or camera/video wall behavior.

## 3. Recommended Architecture

### Option A. Electron desktop polls SE220 directly

**Description**

- Electron or renderer code calls `https://192.168.62.1/api/get_gnss_info.cgi?token=<TOKEN>` every second.

**Pros**

- Simple initial wiring.
- No API-side polling code required.

**Cons**

- Exposes router token to desktop-side code and increases credential handling risk.
- Renderer should not own direct network access to infrastructure devices.
- Self-signed certificate handling becomes a desktop concern.
- Harder to centralize retry logic, stale detection, audit logging, and future multi-vehicle expansion.
- Duplicates location normalization logic outside the existing Fastify GPS pipeline.
- Makes later Firebase sync or remote aggregation more awkward.

**Assessment**

- Not recommended for this project.

### Option B. Fastify API server polls SE220 and exposes normalized vehicle location API

**Description**

- A backend poller in `apps/api` calls the SE220 HTTPS API every second.
- The response is trimmed, validated, normalized, and ingested into the existing `GpsStateService`.
- Electron continues to read only the local API and WebSocket feed.

**Pros**

- Keeps the token and self-signed TLS handling in a trusted backend boundary.
- Reuses existing GPS state, SQLite history, health monitoring, `/gps/latest`, and `/ws/vehicles`.
- Minimizes UI changes because the desktop map already consumes normalized vehicle positions.
- Centralizes stale detection, error reporting, retry behavior, and future provider abstraction.
- Fits the current project architecture best.

**Cons**

- Requires backend polling logic and TLS exception handling.
- Assumes the API host can reach `192.168.62.1`.

**Assessment**

- Best option for the current Kurukuru Monitor architecture.

### Option C. Separate edge-agent service polls SE220 and sends data to API/Firebase

**Description**

- A separate agent process near the router polls the SE220 and forwards normalized location to the API or Firebase.

**Pros**

- Useful when the API host cannot directly reach the router.
- Good future pattern for many vehicles, isolated networks, or unstable field connectivity.
- Can decouple polling from the core API runtime.

**Cons**

- More moving parts, deployment complexity, monitoring, and failure modes.
- Overkill for the current confirmed single-router integration.
- Requires an internal update API or queue contract.

**Assessment**

- Reasonable later if network topology demands it, but not the first implementation choice here.

### Best recommendation

**Recommend Option B: Fastify API polls the SE220 directly and exposes normalized vehicle location to Electron.**

This matches the existing project structure, preserves current UI/UX, avoids leaking the token into renderer code, and reuses the repository's current GPS/WebSocket/health/database pipeline.

## 4. Final Recommended Structure

### Responsibility split

**Rooster SE220**

- Owns GNSS hardware access.
- Exposes raw GNSS values through the router HTTPS API.
- Remains the system of record for current raw coordinates.

**GNSS reader module**

- Lives in `apps/api`.
- Polls the SE220 every 1 second.
- Handles HTTPS requests, optional self-signed certificate allowance, timeout, retries, token usage, trimming, validation, and normalization.
- Converts raw router payloads into the app's normalized vehicle location shape.

**Fastify API**

- Owns the polling lifecycle.
- Owns provider selection from config.
- Ingests normalized location into the existing `GpsStateService`.
- Exposes normalized read APIs and WebSocket updates to the desktop app.
- Reports errors and freshness to health/status views.

**Database or current location store**

- Phase 1-2: existing in-memory latest-state via `GpsStateService`.
- Phase 3+: persist latest/history in SQLite using existing GPS history patterns.
- Optional later: add a lightweight latest-location table if current read patterns need it.

**Electron map UI**

- Does not talk to the router.
- Continues to consume only normalized local API/WebSocket data.
- Reuses current map rendering and status display patterns.

**Optional Firebase sync later**

- Should subscribe to normalized API-side location updates.
- Must not poll the router directly.
- Should be an outbound sync concern, not the source-of-truth polling layer.

### Recommended data flow

```text
Rooster SE220 HTTPS GNSS API
  -> API GNSS poller
  -> normalization + trim() + validation
  -> GpsStateService
  -> /gps/latest and /ws/vehicles
  -> Electron map UI
  -> optional Firebase sync later
```

## 5. Proposed Data Model

Use a normalized location record that preserves both operational fields and raw payload context.

```ts
type VehicleLocationRecord = {
  vehicleId: string;
  latitude: number | null;
  longitude: number | null;
  gnssTime: string | null;
  receivedAt: string;
  source: 'rooster-se220-api';
  status: 'ONLINE' | 'STALE' | 'NO_FIX' | 'ERROR' | 'OFFLINE';
  error: string | null;
  raw: unknown;
};
```

### Field guidance

- `vehicleId`: internal Kurukuru Monitor vehicle identifier from config.
- `latitude`: trimmed and parsed decimal latitude.
- `longitude`: trimmed and parsed decimal longitude.
- `gnssTime`: trimmed GNSS timestamp from the router payload.
- `receivedAt`: API server receipt time in ISO format.
- `source`: provider identifier such as `rooster-se220-api`.
- `status`: normalized runtime state for operators and API consumers.
- `error`: latest polling or parsing error when state is degraded.
- `raw`: minimally stored raw provider payload for diagnostics, ideally sanitized.

### Mapping into current app structures

The current app already uses:

```ts
type VehicleGpsUpdate = {
  vehicleId: string;
  vehicleName: string;
  lat: number;
  lng: number;
  speed?: number;
  heading?: number;
  receivedAt: string;
};
```

For initial implementation, the SE220 poller can normalize into this existing shape for compatibility while separately keeping richer provider metadata in memory or logs. That is the lowest-risk path because it plugs directly into the existing map and WebSocket flow.

## 6. Proposed API Endpoints

The current API already exposes `GET /gps/latest` and `GET /ws/vehicles`. Those can continue to serve the map immediately. For clearer long-term semantics, the following location-oriented endpoints are recommended.

### Public normalized read endpoints

```http
GET /api/vehicles/:vehicleId/location
GET /api/vehicles/locations
```

### Suggested response examples

```json
{
  "vehicleId": "vehicle-1",
  "latitude": 35.863239,
  "longitude": 139.658787,
  "gnssTime": "2026-05-26T00:56:27Z",
  "receivedAt": "2026-05-26T00:56:28.112Z",
  "source": "rooster-se220-api",
  "status": "ONLINE",
  "error": null
}
```

```json
{
  "vehicles": [
    {
      "vehicleId": "vehicle-1",
      "latitude": 35.863239,
      "longitude": 139.658787,
      "gnssTime": "2026-05-26T00:56:27Z",
      "receivedAt": "2026-05-26T00:56:28.112Z",
      "source": "rooster-se220-api",
      "status": "ONLINE",
      "error": null
    }
  ]
}
```

### Internal update endpoint if needed later

Only needed if Option C or external sync is introduced:

```http
POST /internal/vehicles/:vehicleId/location
```

This endpoint should stay internal-only, protected by service authentication, and should not be required for the first API-side polling implementation.

### Compatibility recommendation

- Keep current `/gps/latest` and `/ws/vehicles` for the existing desktop map.
- Add newer `/api/vehicles/...` endpoints only when the team wants cleaner domain naming.
- Avoid a broad API rename during the first GNSS integration phase.

## 7. Configuration Plan

Add backend-owned environment/config values like the following:

```env
GNSS_ENABLED=true
GNSS_PROVIDER=rooster-se220
GNSS_BASE_URL=https://192.168.62.1
GNSS_TOKEN=<TOKEN>
GNSS_POLL_INTERVAL_MS=1000
GNSS_ALLOW_SELF_SIGNED=true
GNSS_VEHICLE_ID=vehicle-1
```

### Configuration meanings

- `GNSS_ENABLED`: master enable switch for API-side GNSS polling.
- `GNSS_PROVIDER=rooster-se220`: selects the provider implementation.
- `GNSS_BASE_URL=https://192.168.62.1`: base router URL.
- `GNSS_TOKEN`: runtime credential, never committed.
- `GNSS_POLL_INTERVAL_MS=1000`: target 1 second polling.
- `GNSS_ALLOW_SELF_SIGNED=true`: allows trusted local deployment with the router's self-signed cert.
- `GNSS_VEHICLE_ID`: binds the polled GNSS feed to a vehicle in the current single-router flow.

### Additional recommended config values

These are optional but useful in production:

```env
GNSS_REQUEST_TIMEOUT_MS=3000
GNSS_STALE_AFTER_MS=5000
GNSS_OFFLINE_AFTER_MS=15000
GNSS_LOG_RAW=false
```

### Coexistence with current config

- Keep existing `SE220_RECEIVER_*` settings for the current NMEA receiver path.
- Introduce `GNSS_*` settings as a separate provider path.
- Do not overload the current `SE220_RECEIVER_*` variables because the transport model is different.

## 8. Implementation Phases

### Phase 1. Report only

- Inspect the repository.
- Confirm the best integration point.
- Produce this implementation report.

### Phase 2. Read SE220 GNSS and log normalized location

- Add an API-side Rooster SE220 HTTPS client.
- Poll every second.
- Trim all string fields from the response.
- Validate `result`, `data.time`, `data.latitude`, and `data.longitude`.
- Convert into normalized location data.
- Log success and failure safely without exposing token values.

### Phase 3. Store latest location in API memory or SQLite

- Feed normalized updates into the existing `GpsStateService`.
- Reuse current in-memory latest state and SQLite GPS history flow first.
- Optionally retain richer GNSS metadata separately if needed.

### Phase 4. Show marker on existing map

- Reuse current `/gps/latest` and `/ws/vehicles` consumption in the desktop app.
- Keep current map page and operator UX intact.
- Avoid any camera/video wall changes.

### Phase 5. Smooth movement and offline/stale detection

- Tune age thresholds, stale handling, and polling failure behavior.
- Prevent map marker jumpiness from noisy or intermittent points.
- Distinguish `NO_FIX`, `STALE`, and `OFFLINE` conditions in API state.

### Phase 6. Optional Firebase sync

- Publish normalized location from the API side to Firebase.
- Do not make Firebase the polling source.
- Keep router access centralized in the trusted backend boundary.

## 9. Risk Analysis

### Token expiry

- Risk: router tokens may expire or rotate.
- Impact: polling begins failing with auth errors.
- Mitigation: treat the token as runtime config, surface clear API-side errors, and keep renewal procedures outside renderer code.

### Router unavailable

- Risk: router reboot, power loss, or local network failure.
- Impact: location feed stops updating.
- Mitigation: timeout requests, preserve last known point, mark vehicle `STALE` then `OFFLINE`, and emit operational logs.

### HTTPS self-signed certificate

- Risk: TLS validation fails by default.
- Impact: polling fails even though the router is reachable.
- Mitigation: use an explicitly controlled backend-only `GNSS_ALLOW_SELF_SIGNED` option and never relax TLS in renderer code.

### Stale GNSS data

- Risk: router returns old coordinates or old GNSS time.
- Impact: operators see apparently valid but outdated position.
- Mitigation: compare `gnssTime` and `receivedAt`, flag stale state, and expose freshness clearly.

### GPS no fix

- Risk: antenna obstruction or temporary satellite loss.
- Impact: missing or invalid coordinates.
- Mitigation: recognize empty/invalid coordinates or provider error states and set `NO_FIX` rather than overwriting with bad data.

### Network isolation

- Risk: the API host may not be on the same reachable network as `192.168.62.1`.
- Impact: direct API polling is impossible.
- Mitigation: if this is confirmed later, shift to Option C with an edge agent near the router.

### Map marker jumping

- Risk: 1-second samples can contain jitter.
- Impact: map marker movement looks unstable.
- Mitigation: keep the current UI animation approach, add smoothing thresholds later, and avoid over-filtering in the first functional phase.

### Many vehicles later

- Risk: a single hardcoded single-router flow does not scale.
- Impact: configuration and polling logic become awkward for fleet growth.
- Mitigation: define a provider abstraction now, even if Phase 2 only supports one `GNSS_VEHICLE_ID`.

## 10. Exact Implementation Recommendation

The implementation should follow these rules:

- Do not put the SE220 token in renderer code.
- Do not let the Electron renderer directly call the SE220.
- Fastify API or a future edge-agent should own GNSS polling.
- Electron should only call the local API for normalized location.

### Project-specific recommendation

For Kurukuru Monitor, the immediate implementation should be:

1. Add a backend GNSS provider client in `apps/api`.
2. Poll `GET https://192.168.62.1/api/get_gnss_info.cgi?token=<TOKEN>` every 1 second.
3. Trim `time`, `latitude`, and `longitude`.
4. Normalize the result into the current `GpsStateService` shape.
5. Reuse existing `/gps/latest`, `/ws/vehicles`, map rendering, and health logic.
6. Keep camera playback and video wall logic untouched.

This is the lowest-risk, production-oriented path.

## 11. Files Likely to Be Added Later

These files are good candidates for the implementation phase, but should not be created yet except for this report:

- `apps/api/src/services/gnss/rooster-se220-client.ts`
- `apps/api/src/services/gnss/gnss-poller.ts`
- `apps/api/src/routes/locations.ts`
- `apps/desktop/src/hooks/useVehicleLocations.ts`
- `apps/desktop/src/pages/MapPage.tsx` or existing map page update
- `.env.example` update

### Likely role of each file

- `rooster-se220-client.ts`: HTTPS request, TLS handling, trimming, parsing, and raw response validation.
- `gnss-poller.ts`: polling lifecycle, interval scheduling, retry behavior, and ingestion into `GpsStateService`.
- `locations.ts`: normalized read endpoints for location-focused API access.
- `useVehicleLocations.ts`: optional future desktop hook if the team wants a cleaner domain-specific hook name.
- `MapPage.tsx` update: only if the team later wants richer stale/no-fix badges or metadata.
- `.env.example` update: document the new `GNSS_*` settings without exposing a real token.

## 12. Suggested Implementation Notes

### Parsing contract

The Rooster SE220 response should be treated as untrusted external input:

- Verify `result === true`.
- Verify `data` exists.
- Apply `trim()` to `data.time`, `data.latitude`, and `data.longitude`.
- Reject empty strings after trimming.
- Parse `latitude` and `longitude` as finite numbers.
- Preserve the raw payload for diagnostics when safe to do so.

### TLS handling

Because the router certificate is self-signed:

- certificate bypass must be explicit and backend-only
- the setting must be config-driven
- production logs should clearly show whether self-signed allowance is enabled
- this should never be implemented by disabling security globally in renderer code

### Logging guidance

- Never log the real token.
- Prefer logging the base URL and vehicle ID only.
- Log concise failure reasons such as timeout, auth failure, invalid payload, or stale GNSS time.

## 13. Conclusion

Kurukuru Monitor already has most of the downstream location pipeline needed for this feature. The missing piece is not a new map system, but a secure API-side GNSS polling module for the Rooster SE220 HTTPS endpoint.

The best implementation is to add a Fastify-side GNSS poller, normalize the SE220 response with required `trim()` handling, ingest it into the existing `GpsStateService`, and keep Electron limited to consuming the local normalized API and WebSocket feed.
