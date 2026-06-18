# Production Operations

## Daily operation

- Confirm the Ubuntu PC boots into the desktop session and `kurukuru-monitor` opens automatically.
- Open the System Status page and verify:
  - API is `ONLINE`
  - Receiver is `ONLINE` or `DISABLED` as expected
  - cameras are not all `OFFLINE`
  - vehicle GPS is updating
- If the map is open, confirm the vehicle names and colors still match the configured fleet.

## Electron runtime directories

- `ELECTRON_USER_DATA_DIR` stores Electron window and session data.
- `ELECTRON_CACHE_DIR` stores Chromium and GPU cache data.
- On Windows, setting both paths inside the app runtime folder helps avoid cache permission errors and black-window startup failures.

## Weekly maintenance

- Export a diagnostics bundle from the System Status page.
- Run a backup with `scripts/backup-settings.sh`.
- Check free disk space and database size from the System Status page.
- Confirm old GPS history is being cleaned according to `GPS_HISTORY_DAYS`.
- If you need to compact the SQLite file, stop the API first and then run `scripts/vacuum-db.sh`.

## Log cleanup

- Runtime logs are stored under `APP_DATA_DIR/logs`.
- Current logs use:
  - `api.log`
  - `desktop.log`
  - `gps.log`
  - `field-test.log`
- Older logs rotate daily and are trimmed using `LOG_RETENTION_DAYS`.
- Do not run `VACUUM` while the API is live. The app now deletes old `gps_points` online, and offline compaction is a separate maintenance step only.

## Backup policy

- Create a backup before changing live camera credentials or receiver settings.
- Keep at least:
  - the latest daily backup
  - one weekly backup
  - one backup before any software update

## Reboot procedure

1. Confirm operators are not actively watching a live incident.
2. Export diagnostics if there is an active issue.
3. Reboot Ubuntu normally.
4. After login, confirm the API and desktop services recover automatically.

## Recovery procedure

- Use the System Status recovery tools first:
  - `Restart API`
  - `Restart Desktop`
  - `Restart mpv sessions`
  - `Clear stale mpv sessions`
  - `Reconnect all cameras`
- If the API restart button is unavailable outside Ubuntu service mode, run:

```bash
scripts/restart-services.sh
```

## Diagnostics export

- Use `Export Diagnostics Bundle` from the System Status page.
- Output is written under `APP_DATA_DIR/diagnostics`.
- The bundle includes:
  - recent logs
  - latest system status
  - service status
  - safe config snapshot
  - recent field-test reports
- Secrets and passwords are excluded or masked.

## LTE troubleshooting

- If map updates are delayed, compare the GPS age on the map and System Status page.
- If LTE quality is poor, expect markers to move with delayed rather than smooth live updates.
- Use the field-test checklist to record measured delay at the client site.

## Camera troubleshooting

- If all cameras are `OFFLINE`, confirm:
  - `mpv` is installed
  - the RTSP network path is reachable
  - VPN/WireGuard is connected if the stream is remote
- If one camera is failing, test it from Settings before changing credentials.
- If playback freezes, use `Restart mpv sessions` or `Reconnect all cameras`.

## VPN troubleshooting

- Confirm WireGuard is installed and the tunnel is connected.
- If cameras or GNSS feed depend on the tunnel, verify the remote IPs are reachable before editing app settings.
- If service routing changes, re-run field test items for camera live view and GPS update flow.

## Release build notes

- Primary desktop build outputs:
  - renderer assets in `apps/desktop/dist`
  - Electron entry files in `apps/desktop/dist-electron`
- Treat these folders as the release staging area for packaging and deployment.
- Use `.env.production.example` as the baseline for the final production `.env`.
- Application display name is `Kurukuru Monitor`.
