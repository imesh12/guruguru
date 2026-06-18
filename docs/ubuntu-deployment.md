# Ubuntu Deployment

This guide prepares `kurukuru-monitor` for the client Ubuntu receiving PC so the API and Electron desktop recover automatically after reboot or crash.

## First Installation

1. Install Node.js 22 or newer on the Ubuntu PC.
2. Clone or copy the project onto the machine.
3. Copy `.env.example` to `.env` and set at least:
   - `APP_DATA_DIR`
   - `DATABASE_URL`
   - `API_PORT`
   - `VITE_MAPBOX_ACCESS_TOKEN`
   - `SE220_RECEIVER_ENABLED`
4. Run:

```bash
chmod +x scripts/*.sh
./scripts/install-ubuntu.sh
```

5. If this is the first deployment and you want starter data, run with:

```bash
SEED_INITIAL_DATA=true ./scripts/install-ubuntu.sh
```

6. Install the systemd services:

```bash
DISPLAY_VALUE=:0 XAUTHORITY_VALUE=/home/<user>/.Xauthority ./scripts/install-services.sh
```

## What The Installer Does

- Checks for Node.js 22+
- Enables `pnpm` through `corepack`
- Installs `mpv`, `ffmpeg`, `sqlite3`, and `wireguard-tools`
- Installs project dependencies
- Runs Prisma generate and push
- Optionally seeds initial data
- Creates runtime directories for database, logs, and backups

## Update Procedure

1. Pull or copy the updated project files.
2. Review `.env` for any new settings.
3. Reinstall dependencies and rebuild:

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm build
corepack pnpm prisma:generate
corepack pnpm prisma:push
```

4. Restart services:

```bash
./scripts/restart-services.sh
```

## Start, Stop, Restart, Status

```bash
./scripts/status-services.sh
./scripts/restart-services.sh
sudo systemctl stop kurukuru-desktop.service
sudo systemctl stop kurukuru-api.service
sudo systemctl start kurukuru-api.service
sudo systemctl start kurukuru-desktop.service
```

## Checking Logs

Follow both logs:

```bash
./scripts/view-logs.sh
```

API only:

```bash
./scripts/view-logs.sh api
```

Desktop only:

```bash
./scripts/view-logs.sh desktop
```

## Backup And Restore

Create a backup:

```bash
./scripts/backup-settings.sh
```

Restore a backup:

```bash
./scripts/restore-settings.sh ./runtime/backups/<timestamp>
./scripts/restart-services.sh
```

The backup includes:

- SQLite database
- `.env`
- runtime logs when present
- recent `journalctl` output when available

## Troubleshooting

### mpv not found

- Confirm `mpv` is installed: `mpv --version`
- Re-run `./scripts/install-ubuntu.sh` if needed
- Check desktop logs with `./scripts/view-logs.sh desktop`

### Mapbox token missing

- Set `VITE_MAPBOX_ACCESS_TOKEN` in `.env`
- Restart services after changing the token
- Without a token, the app falls back to the simplified map panel

### Camera not connecting

- Open the Settings page and run `Test Camera`
- Verify RTSP URL, username, and password
- Check `mpv` and desktop service logs
- Confirm the camera is still enabled in Settings

### GPS not receiving

- Confirm `SE220_RECEIVER_ENABLED=true`
- Confirm `SE220_RECEIVER_MODE` and `SE220_RECEIVER_PORT`
- Review `SE220_VEHICLE_MAP`
- Check API logs for unknown source warnings or receiver errors

### Boot auto-start troubleshooting

- Check service health:

```bash
./scripts/status-services.sh
```

- If the API starts but the desktop does not, verify:
  - `DISPLAY_VALUE` used during install matches the active desktop session
  - `XAUTHORITY_VALUE` points to the active user’s `.Xauthority`
  - the machine reaches a graphical login before starting the desktop service
- Re-run `./scripts/install-services.sh` after changing display user or home directory
- Inspect `journalctl -u kurukuru-desktop.service`
