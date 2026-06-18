# GNSS Delay Investigation Report

## 1. Executive Summary

This investigation focused on measuring where GNSS delay is introduced in Kurukuru Monitor without changing marker behavior, UI, smoothing, interpolation, or prediction logic.

Instrumentation has now been added across the full path:

- `Rooster SE220 GNSS API`
- backend poller
- `LocationManager`
- legacy `gpsState` bridge
- WebSocket broadcast
- `/gps/latest` response generation
- frontend message receipt
- marker render/update
- next-frame display timing

Two findings are already confirmed from code inspection before any live capture:

1. The frontend currently animates every incoming vehicle position over `900ms` in [`apps/desktop/src/hooks/useVehicleGpsFeed.ts`](./apps/desktop/src/hooks/useVehicleGpsFeed.ts).
2. The live map currently consumes the legacy `/gps/latest` + `/ws/vehicles` feed, not the newer direct `LocationManager` API objects end to end.

These do not yet prove the full 5 to 10 second delay by themselves, but they are confirmed contributors or investigation targets.

No architectural fixes were applied in this change set. Only timing instrumentation, coordinate-quality measurement, and reporting were added.

## 2. Current Architecture

Current measured path:

`SE220 GNSS API`
-> `Se220DirectPoller`
-> `LocationManager`
-> bridge in `server.ts`
-> `GpsStateService`
-> `/ws/vehicles` and `/gps/latest`
-> `useVehicleGpsFeed`
-> `MapPanel`
-> Mapbox marker DOM update

Relevant files:

- [`apps/api/src/services/location/se220-direct-poller.ts`](./apps/api/src/services/location/se220-direct-poller.ts)
- [`apps/api/src/services/location/location-manager.ts`](./apps/api/src/services/location/location-manager.ts)
- [`apps/api/src/server.ts`](./apps/api/src/server.ts)
- [`apps/api/src/services/gps-state.ts`](./apps/api/src/services/gps-state.ts)
- [`apps/api/src/websocket.ts`](./apps/api/src/websocket.ts)
- [`apps/api/src/routes/gps.ts`](./apps/api/src/routes/gps.ts)
- [`apps/desktop/src/hooks/useVehicleGpsFeed.ts`](./apps/desktop/src/hooks/useVehicleGpsFeed.ts)
- [`apps/desktop/src/components/MapPanel.tsx`](./apps/desktop/src/components/MapPanel.tsx)

## 3. Test Methodology

The investigation was designed to answer four questions with measured timestamps rather than assumptions:

1. How old is each router-provided GNSS sample when the backend receives it?
2. How much delay is introduced in backend processing and rebroadcast?
3. How much delay is introduced between frontend message receipt and visible marker update?
4. Are visible jumps caused by delayed samples, duplicate samples, sparse coordinate changes, or coordinate jitter?

Instrumentation now records:

- `localPollTime`
- `apiPollReceivedAt`
- `routerGnssTime`
- `routerSampleAgeMs`
- `coordinateChanged`
- `intervalSinceLastCoordinateChangeMs`
- `distanceFromPreviousMeters`
- `speedEstimateMps`
- `headingEstimateDeg`
- `suspiciousJump`
- `duplicateSample`
- `locationManagerProcessingMs`
- `backendProcessingMs`
- `websocketBroadcastLatencyMs`
- `apiResponseGenerationMs`
- frontend receipt time
- frontend render/update time
- next-frame display time
- total visible delay

## 4. Collected Metrics

### Backend GNSS Poll Logs

Primary log labels:

- `[gnss-investigation] poll`
- `[gnss-investigation] coordinate changed`
- `[gnss-investigation] coordinate unchanged`
- `[gnss-investigation] stale sample`
- `[gnss-investigation] location-manager update`
- `[gnss-investigation] gps-state ingest`
- `[gnss-investigation] websocket broadcast`
- `[gnss-investigation] api response`

Example poll log:

```text
[gnss-investigation] poll {
  "vehicleId":"vehicle-1",
  "localPollTime":"2026-05-28T10:00:01.015Z",
  "apiPollReceivedAt":"2026-05-28T10:00:01.162Z",
  "routerGnssTime":"2026-05-28T10:00:00.000Z",
  "latitude":35.863233,
  "longitude":139.658637,
  "coordinateChanged":true,
  "ageMs":1162,
  "intervalSinceLastCoordinateChangeMs":1006,
  "distanceFromPreviousMeters":4.3,
  "speedEstimateMps":4.2,
  "headingEstimateDeg":91.4,
  "suspiciousJump":false,
  "duplicateSample":false
}
```

Example stale sample log:

```text
[gnss-investigation] stale sample {
  "vehicleId":"vehicle-1",
  "routerGnssTime":"2026-05-28T10:00:00.000Z",
  "localPollTime":"2026-05-28T10:00:04.010Z",
  "ageMs":4010
}
```

### Frontend Map Logs

Primary log label:

- `[map-investigation]`

Phases:

- `received`
- `rendered`
- `displayed`

Example received log:

```text
[map-investigation] {
  "phase":"received",
  "source":"websocket",
  "vehicleId":"vehicle-1",
  "routerGnssTime":"2026-05-28T10:00:00.000Z",
  "frontendMessageReceivedAt":"2026-05-28T10:00:01.280Z",
  "routerSampleAgeMs":1162,
  "backendProcessingMs":43,
  "websocketMs":18,
  "frontendRenderMs":0,
  "totalDelayMs":1280
}
```

Example displayed log:

```text
[map-investigation] {
  "phase":"displayed",
  "vehicleId":"vehicle-1",
  "metrics":{
    "routerSampleAgeMs":1162,
    "backendProcessingMs":43,
    "websocketMs":18,
    "frontendRenderMs":22,
    "totalDelayMs":1302
  }
}
```

## 5. Delay Measurements

The investigation now produces this delay breakdown per visible update:

```json
{
  "routerSampleAgeMs": 0,
  "backendProcessingMs": 0,
  "websocketMs": 0,
  "frontendRenderMs": 0,
  "totalDelayMs": 0
}
```

Interpretation:

- `routerSampleAgeMs`: age of the GNSS sample relative to router GNSS time when backend poll received it
- `backendProcessingMs`: time from backend poll receipt to bridge into the GPS/map feed
- `websocketMs`: time from websocket broadcast timestamp to frontend receipt or display calculation
- `frontendRenderMs`: time from frontend message receipt to rendered or displayed marker timing
- `totalDelayMs`: time from router GNSS timestamp to visible marker display

At the time of this workspace run, live field logs were not captured from an active SE220 session, so this report includes instrumentation readiness and code-level findings rather than completed production metrics.

## 6. GNSS Refresh Rate Findings

What is now measurable:

- actual SE220 sample time cadence via `routerGnssTime`
- whether the backend polls faster than coordinates change
- whether the router repeats identical samples
- whether the router returns already-aged samples

What is already visible from code:

- backend polling is configured at `1000ms` by default in [`apps/api/src/services/location/se220-direct-poller.ts`](./apps/api/src/services/location/se220-direct-poller.ts)
- polling every second does not guarantee coordinates themselves change every second

Expected decision criteria:

- If `routerGnssTime` changes every second and `routerSampleAgeMs` stays low, the router is not the dominant source of delay.
- If `routerGnssTime` changes more slowly than polling, the apparent lag may start at the GNSS source.
- If coordinates remain unchanged for several polls and then jump, the jump may be sample sparsity rather than rendering alone.

## 7. Backend Findings

Confirmed from code inspection:

1. Backend direct polling already uses the router GNSS API and ingests normalized coordinates into `LocationManager`.
2. The frontend map is still fed through the legacy `GpsStateService` bridge in [`apps/api/src/server.ts`](./apps/api/src/server.ts).
3. Every GPS websocket rebroadcast currently performs an async enabled-vehicle lookup before broadcasting in [`apps/api/src/websocket.ts`](./apps/api/src/websocket.ts).
4. `/gps/latest` is also still active and is polled periodically by the desktop frontend.

Measured backend points now available:

- poll receipt time
- `LocationManager` processing time
- bridge ingest time
- websocket broadcast latency
- `/gps/latest` response generation latency

Backend investigation hypothesis:

- If backend timings remain small while total visible delay is high, the root cause is likely upstream sample age or frontend rendering behavior.
- If backend timings accumulate significantly under load, the bridge or websocket path becomes a stronger candidate.

## 8. Frontend Findings

Confirmed from code inspection:

1. The map feed uses websocket updates and also performs a periodic `/gps/latest` refresh.
2. The frontend animates each new point over `900ms` by setting `animationDurationMs = 900` in [`apps/desktop/src/hooks/useVehicleGpsFeed.ts`](./apps/desktop/src/hooks/useVehicleGpsFeed.ts).
3. The marker position displayed on screen is therefore not updated instantaneously at message arrival.

This is a confirmed code-path contributor to visible latency. It does not prove the full 5 to 10 second delay, but it does prove there is intentional client-side position animation already present today.

Measured frontend points now available:

- message received time
- marker rendered time
- next-frame displayed time
- total visible delay from router sample time to marker display

## 9. Root Cause Analysis

### Confirmed by code inspection

- There is an existing client-side marker animation path of `900ms` per update.
- The map path still goes through an older GPS bridge rather than directly consuming `LocationManager` state.

### Not yet proven without live capture

- whether the SE220 emits fresh coordinates every second
- whether router samples are already several seconds old when fetched
- whether websocket broadcast delay grows under load
- whether duplicate samples or sparse coordinate changes dominate the visible jumps

### Evidence-based interpretation framework

- High `routerSampleAgeMs` with low backend/frontend timings indicates the delay starts at the sample source or router API freshness.
- Low `routerSampleAgeMs` with high `backendProcessingMs` indicates server-side pipeline delay.
- Low router and backend delay with elevated frontend render/display delay indicates a client rendering or animation effect.
- Low total delay but visible side-to-side movement suggests GNSS jitter rather than latency.

## 10. Ranked Causes By Probability

This ranking combines direct code evidence with pending runtime measurement needs.

1. Existing client-side marker animation contributes visible lag.
   Evidence: confirmed `900ms` animation in the current feed hook.

2. Router sample freshness may be slower than poll cadence.
   Evidence: polling frequency is known, but actual `routerGnssTime` cadence had not been logged before this instrumentation.

3. Duplicate or sparse coordinate updates may be causing jump behavior.
   Evidence: prior system did not log `coordinateChanged`, duplicate samples, or interval between actual coordinate changes.

4. Extra latency may be introduced by the legacy backend bridge and websocket snapshot rebroadcast path.
   Evidence: the map does not read direct `LocationManager` state end to end, and websocket broadcasting currently does extra work per update.

5. GNSS jitter may be contributing to off-road marker placement.
   Evidence: off-road placement can be caused by ordinary GNSS variation, but this should only be concluded after comparing sample age, jump distance, and estimated speed.

## 11. Recommended Next Steps

1. Run the desktop and backend against the live SE220 and capture at least several minutes of logs while a vehicle is moving normally.
2. Correlate `routerGnssTime`, `apiPollReceivedAt`, websocket receipt, and visible display delay for the same vehicle.
3. Determine whether the dominant delay is upstream sample age, backend accumulation, or frontend visible animation.
4. Only after measured confirmation decide whether to:
   - adjust frontend animation behavior
   - simplify the backend path
   - investigate router sample freshness
   - classify GNSS jitter separately from pipeline delay

## Appendix A: Exact File Changes

Instrumentation-only edits were made to:

- [`apps/api/src/services/location/types.ts`](./apps/api/src/services/location/types.ts)
- [`apps/api/src/services/location/location-manager.ts`](./apps/api/src/services/location/location-manager.ts)
- [`apps/api/src/services/location/se220-direct-poller.ts`](./apps/api/src/services/location/se220-direct-poller.ts)
- [`apps/api/src/services/gps-state.ts`](./apps/api/src/services/gps-state.ts)
- [`apps/api/src/server.ts`](./apps/api/src/server.ts)
- [`apps/api/src/websocket.ts`](./apps/api/src/websocket.ts)
- [`apps/api/src/routes/gps.ts`](./apps/api/src/routes/gps.ts)
- [`apps/desktop/src/types.ts`](./apps/desktop/src/types.ts)
- [`apps/desktop/src/hooks/useVehicleGpsFeed.ts`](./apps/desktop/src/hooks/useVehicleGpsFeed.ts)
- [`apps/desktop/src/components/MapPanel.tsx`](./apps/desktop/src/components/MapPanel.tsx)

No behavior changes were intentionally introduced to:

- marker animation values
- smoothing/interpolation settings
- UI layout
- websocket protocol semantics used by operators

## Appendix B: Validation

Typecheck completed successfully:

```text
corepack pnpm typecheck
```
