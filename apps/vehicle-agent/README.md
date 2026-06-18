# Kurukuru Monitor Vehicle Edge Agent

This agent runs inside each vehicle network. It reads GNSS coordinates from the vehicle's local Rooster SE220 router and posts normalized location updates to the central Kurukuru Monitor API.

The same local router IP is safe across multiple vehicles. Vehicle separation is not based on router IP. Each vehicle is identified by:

- `VEHICLE_ID`
- `AGENT_TOKEN`
- optional `ROUTE_ID`

That means vehicle 1 and vehicle 2 can both use `https://192.168.0.1` locally, while still being separated correctly by the central API.

## What The Agent Does

- polls the local SE220 GNSS API every second by default
- can run in mock GNSS mode for end-to-end verification without a router
- trims leading spaces from `time`, `latitude`, and `longitude`
- validates and normalizes GNSS data
- posts the data to `POST /api/vehicles/:vehicleId/location`
- avoids overlapping polls
- shuts down cleanly on `SIGINT` and `SIGTERM`

## Where It Runs

- inside the vehicle network
- on a small Windows, Linux, or future mobile edge device
- close to the local SE220 router

## Security Notes

- do not hardcode `SE220_TOKEN`
- do not hardcode `AGENT_TOKEN`
- keep both tokens in local environment configuration only
- the agent never logs the full SE220 URL with token
- the agent never logs the admin bearer token

## Configuration

Copy `.env.example` to `.env` and adjust values for each vehicle.

### Vehicle 1 example

```env
VEHICLE_ID=vehicle-001
ROUTE_ID=route-001
MOCK_GNSS=false
MOCK_LATITUDE=35.863239
MOCK_LONGITUDE=139.658787
SE220_BASE_URL=https://192.168.0.1
SE220_TOKEN=<SE220_TOKEN_V1>
SE220_ALLOW_SELF_SIGNED=true
ADMIN_API_URL=http://central-api-host:4000
AGENT_TOKEN=<AGENT_TOKEN_V1>
POLL_INTERVAL_MS=1000
REQUEST_TIMEOUT_MS=3000
```

### Vehicle 2 example

```env
VEHICLE_ID=vehicle-002
ROUTE_ID=route-002
MOCK_GNSS=false
MOCK_LATITUDE=35.872000
MOCK_LONGITUDE=139.660000
SE220_BASE_URL=https://192.168.0.1
SE220_TOKEN=<SE220_TOKEN_V2>
SE220_ALLOW_SELF_SIGNED=true
ADMIN_API_URL=http://central-api-host:4000
AGENT_TOKEN=<AGENT_TOKEN_V2>
POLL_INTERVAL_MS=1000
REQUEST_TIMEOUT_MS=3000
```

Both vehicles can use `https://192.168.0.1` because that IP exists only inside each vehicle's own local network.

## End-To-End Mock Test

For local end-to-end verification without a live SE220 router, set the API env to:

```env
VEHICLE_AGENT_TOKENS=vehicle-001:token1,vehicle-002:token2
```

Then run two mock agents with configs like these.

### Mock vehicle 1

```env
VEHICLE_ID=vehicle-001
ROUTE_ID=route-001
ADMIN_API_URL=http://localhost:4000
AGENT_TOKEN=token1
MOCK_GNSS=true
MOCK_LATITUDE=35.863239
MOCK_LONGITUDE=139.658787
POLL_INTERVAL_MS=1000
REQUEST_TIMEOUT_MS=3000
```

### Mock vehicle 2

```env
VEHICLE_ID=vehicle-002
ROUTE_ID=route-002
ADMIN_API_URL=http://localhost:4000
AGENT_TOKEN=token2
MOCK_GNSS=true
MOCK_LATITUDE=35.872000
MOCK_LONGITUDE=139.660000
POLL_INTERVAL_MS=1000
REQUEST_TIMEOUT_MS=3000
```

You can also use the Windows helper script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./apps/vehicle-agent/scripts/run-mock-two-vehicles.ps1
```

### Verify latest locations

Call the admin endpoint with the admin API bearer token:

```http
GET /api/vehicles/locations
Authorization: Bearer <API_TOKEN>
```

Expected:

- `vehicle-001` latest location exists
- `vehicle-002` latest location exists

### Verify route history

Call:

```http
GET /api/vehicles/route-history?date=YYYY-MM-DD
Authorization: Bearer <API_TOKEN>
```

Expected:

- chronological points for both vehicles
- `routeId` saved
- `source` saved
- `status` saved
- `dateKey` saved
- `weekKey` saved

### Existing map feed

The current desktop map still reads the existing GPS endpoints:

- `GET /gps/latest`
- `GET /ws/vehicles`

The backend now bridges new `LocationManager` updates into the existing `GpsStateService`, so the current map consumer keeps working without UI changes.

## Development

Install workspace dependencies from the repo root, then run:

```bash
pnpm --filter @kurukuru-monitor/vehicle-agent dev
```

Typecheck:

```bash
pnpm --filter @kurukuru-monitor/vehicle-agent typecheck
```

Build:

```bash
pnpm --filter @kurukuru-monitor/vehicle-agent build
```

Start the built agent:

```bash
pnpm --filter @kurukuru-monitor/vehicle-agent start
```
