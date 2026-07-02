# MediaMTX Local Setup

This Phase 2 proof-of-concept keeps the current desktop and mpv flow intact while adding a local MediaMTX sidecar that proxies Axis RTSP cameras into deterministic local paths.

## Seeded demo cameras

- `camera-axis-190` -> `<CAMERA_HOST>`
- `camera-axis-187` -> `<CAMERA_HOST>`
- `camera-axis-175` -> `<CAMERA_HOST>`

Each camera uses the Axis pattern:

```text
rtsp://<RTSP_USERNAME>:<RTSP_PASSWORD>@<CAMERA_HOST>/axis-media/media.amp?videocodec=h264&resolution=1280x720
```

In seed data, credentials are stored separately from the `rtspUrl` field so the desktop Settings UI and sanitized playback output do not expose the password.

## Config location

- MediaMTX config: [mediamtx/mediamtx.yml](/C:/Users/cs_in/projects/kurukuru-monitor/mediamtx/mediamtx.yml)
- Windows helper: [scripts/start-mediamtx.ps1](/C:/Users/cs_in/projects/kurukuru-monitor/scripts/start-mediamtx.ps1)

## Expected local URLs

Browser path URLs:

- [http://127.0.0.1:8889/camera-axis-190/](http://127.0.0.1:8889/camera-axis-190/)
- [http://127.0.0.1:8889/camera-axis-187/](http://127.0.0.1:8889/camera-axis-187/)
- [http://127.0.0.1:8889/camera-axis-175/](http://127.0.0.1:8889/camera-axis-175/)

WHEP URLs:

- [http://127.0.0.1:8889/camera-axis-190/whep](http://127.0.0.1:8889/camera-axis-190/whep)
- [http://127.0.0.1:8889/camera-axis-187/whep](http://127.0.0.1:8889/camera-axis-187/whep)
- [http://127.0.0.1:8889/camera-axis-175/whep](http://127.0.0.1:8889/camera-axis-175/whep)

Optional HLS URLs:

- [http://127.0.0.1:8888/camera-axis-190/index.m3u8](http://127.0.0.1:8888/camera-axis-190/index.m3u8)
- [http://127.0.0.1:8888/camera-axis-187/index.m3u8](http://127.0.0.1:8888/camera-axis-187/index.m3u8)
- [http://127.0.0.1:8888/camera-axis-175/index.m3u8](http://127.0.0.1:8888/camera-axis-175/index.m3u8)

## Install MediaMTX locally

1. Download a Windows MediaMTX release from [mediamtx.org](https://mediamtx.org/) or the GitHub releases page.
2. Extract `mediamtx.exe`.
3. Place it in one of these locations:
   - `C:\Users\cs_in\projects\kurukuru-monitor\mediamtx\mediamtx.exe`
   - `C:\Users\cs_in\projects\kurukuru-monitor\tools\mediamtx\mediamtx.exe`
   - anywhere on `PATH`
4. Or pass a custom path with the helper script `-BinaryPath` argument.

## Start MediaMTX

PowerShell:

```powershell
cd C:\Users\cs_in\projects\kurukuru-monitor
.\scripts\start-mediamtx.ps1
```

Check that the script can find the binary without starting the server:

```powershell
cd C:\Users\cs_in\projects\kurukuru-monitor
.\scripts\start-mediamtx.ps1 -CheckOnly
```

Use an explicit binary path if needed:

```powershell
cd C:\Users\cs_in\projects\kurukuru-monitor
.\scripts\start-mediamtx.ps1 -BinaryPath 'C:\tools\mediamtx\mediamtx.exe'
```

## Verification

1. Start MediaMTX with the helper script.
2. Open the browser path URLs above.
3. Confirm the WHEP endpoints respond and that MediaMTX logs show readers attaching to the expected path names.
4. If a path fails, verify:
   - the camera is reachable on the LAN
   - the camera still serves H.264 over the Axis URL
   - the local machine can connect to the configured `<CAMERA_HOST>` addresses
   - firewall rules allow local ports `8554`, `8888`, and `8889`
