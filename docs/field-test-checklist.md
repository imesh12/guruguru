# Field Test Checklist

Use this checklist at the client site before final handover.

## Pre-test Preparation

- Confirm both `kurukuru-api.service` and `kurukuru-desktop.service` are running.
- Confirm `mpv --version` works on the receiving PC.
- Confirm the local API responds at `/health` and `/system/status`.
- Confirm camera and vehicle settings are loaded in the desktop Settings page.
- Confirm the Mapbox token is set when a real basemap is required.
- Confirm the SE220 receiver settings match the field network plan.

## On-site Test Steps

1. Open the desktop Field Test page and start a new session with the operator name.
2. Open the video wall and verify all expected camera tiles come up.
3. Open a large camera popup and confirm the focused RTSP player launches.
4. Open the map and confirm both vehicle markers are visible.
5. Observe GNSS updates until each vehicle shows `ONLINE`.
6. Confirm both markers move smoothly without large jumps or freezes.
7. Open the System Status page and confirm there are no red errors.
8. Restart the services and confirm the app recovers after restart.
9. Ask the operator to repeat the key actions themselves:
   - open video wall
   - open map
   - open large camera popup
10. Record any notes directly in the field-test items.

## Pass/Fail Criteria

- Pass when every required item is marked `PASSED` and the operator confirms normal workflow.
- Fail when a required camera, GNSS feed, map update, service recovery path, or operator workflow item cannot be demonstrated.
- A session can still finish with `FAILED` while preserving detailed notes and an exported report for follow-up.

## LTE Delay Measurement Method

- Ask the field operator to move a vehicle or camera-visible reference point at a known time.
- Compare observed motion timing in the video wall or map against the real-world action.
- Record the approximate delay in the relevant item notes.
- Repeat at least twice if the signal is unstable.

## GPS Delay Measurement Method

- Trigger or observe a known vehicle position change.
- Compare the real movement time with the timestamp shown in the map or System Status page.
- Record the estimated delay and whether the marker movement remained smooth.
- If GNSS changes arrive but age remains high, inspect `/system/status` and receiver logs.

## Final Handover Checklist

- Export the field-test report from the desktop Field Test page.
- Confirm the report exists under `APP_DATA_DIR/reports`.
- Create a backup with `./scripts/backup-settings.sh`.
- Share any failed items, workaround notes, and restart instructions with the client.
- Confirm the operator knows how to open:
  - video wall
  - map
  - system status
  - settings
  - field test
