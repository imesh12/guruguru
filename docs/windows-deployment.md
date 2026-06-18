# Windows Deployment

## First install

Run from the repo root:

```powershell
corepack pnpm install
corepack pnpm prisma:generate
corepack pnpm prisma:push
corepack pnpm --filter @kurukuru-monitor/api build
corepack pnpm --filter @kurukuru-monitor/desktop build
```

## One-time DB sync

The local SQLite database path is:

```text
data\kurukuru.db
```

Apply schema updates without resetting data:

```powershell
corepack pnpm prisma:push
```

## Manual start

Start the API:

```powershell
corepack pnpm deploy:start-api
```

Start the desktop after the API is healthy:

```powershell
corepack pnpm deploy:start-desktop
```

Run a deployment check:

```powershell
corepack pnpm deploy:check
```

## Scheduled tasks

Install the Windows Task Scheduler entries for the current user:

```powershell
corepack pnpm deploy:install-tasks
```

This creates:

- `Kurukuru Monitor API`
- `Kurukuru Monitor Desktop`

The desktop task starts on user logon with a 25 second delay so the API has time to initialize.

Remove the tasks:

```powershell
corepack pnpm deploy:uninstall-tasks
```

## Startup scripts

### `scripts/start-api.ps1`

This script:

- switches to the repo root
- loads `.env`
- ensures `data` and `data\logs` exist
- runs `prisma:generate`
- runs `prisma:push`
- builds the API if `apps\api\dist\server.js` is missing
- starts the production API
- writes startup activity to `data\logs\api-startup.log`

### `scripts/start-desktop.ps1`

This script:

- switches to the repo root
- waits for `http://127.0.0.1:4000/health`
- starts the desktop process
- writes startup activity to `data\logs\desktop-startup.log`

### `scripts/check-system.ps1`

This script checks:

- `node`
- `corepack` / `pnpm`
- `data\kurukuru.db`
- API TCP port `4000`
- `GET /health`
- `GET /health/deep`
- MediaMTX WHEP TCP port `8889`
- MediaMTX API TCP port `9997` as a warning-only check
- `MPV_PATH`
- configured camera RTSP hosts on TCP `554` as warning-only checks

## Troubleshooting

### API start error

Re-run:

```powershell
corepack pnpm prisma:generate
corepack pnpm prisma:push
corepack pnpm --filter @kurukuru-monitor/api build
corepack pnpm deploy:start-api
```

Check:

- `data\logs\api-startup.log`
- `data\logs\api-service.stdout.log`
- `data\logs\api-service.stderr.log`

### DB missing table

If you see a Prisma missing-table error, run:

```powershell
corepack pnpm prisma:push
```

Then confirm:

```powershell
Invoke-WebRequest http://127.0.0.1:4000/health/deep
```

### MediaMTX WHEP port `8889`

If WHEP playback fails:

```powershell
Test-NetConnection 127.0.0.1 -Port 8889
```

If this is closed, MediaMTX WebRTC/WHEP is not reachable.

### MediaMTX API port `9997`

This is optional for diagnostics, but if you want MediaMTX API visibility:

```powershell
Test-NetConnection 127.0.0.1 -Port 9997
```

The system can still work with `8889` reachable even if `9997` is down, but path/API diagnostics will be limited.

### MPV path

Confirm the configured path exists:

```powershell
Test-Path C:\tools\mpv\mpv.exe
```

Or run:

```powershell
corepack pnpm deploy:check
```

### Reboot recovery test

1. Confirm the repo is built and Prisma is in sync.
2. Install scheduled tasks.
3. Reboot Windows.
4. Log in with the same user who installed the tasks.
5. Wait 30 to 60 seconds.
6. Check:

```powershell
Invoke-WebRequest http://127.0.0.1:4000/health
Invoke-WebRequest http://127.0.0.1:4000/health/deep
Test-NetConnection 127.0.0.1 -Port 4000
Test-NetConnection 127.0.0.1 -Port 8889
corepack pnpm deploy:check
```
