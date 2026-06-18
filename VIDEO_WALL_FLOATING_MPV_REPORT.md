# VIDEO_WALL_FLOATING_MPV_REPORT

## Summary

The current Video Wall does **not** embed `mpv` into Electron. It launches **independent top-level Windows desktop windows** and then tries to move/style them so they visually line up with the Electron wall tiles.

That means the wall depends on three things all succeeding every time:

1. the correct `mpv` top-level HWND being found,
2. the wall sessions being stopped before the Video Wall window disappears,
3. no late wall sync/show/hide IPC recreating or re-showing sessions after close.

The latest behavior matches a failure in that chain:

- the Electron Video Wall window can close,
- but one or more `mpv` desktop windows remain alive and visible,
- because those windows are **not parented/owned/clipped by Electron**,
- and the manager can lose track of a session even if `taskkill` fails or a late sync recreates the session.

This is **not just an HWND-selection issue anymore**. HWND targeting matters, but the larger architectural fact is:

> Wall `mpv` windows are global desktop windows, not Electron child windows.

---

## Exact Root Cause

### Root cause A: wall `mpv` windows are global top-level windows

In `apps/desktop/electron/mpv-manager.ts`, wall playback is launched with arguments such as:

- `--force-window=yes`
- `--geometry=<w>x<h>+<x>+<y>`
- `--ontop=yes`
- `--no-border`

There is **no**:

- `--wid`
- `SetParent(...)`
- owner HWND assignment
- child-window embedding mechanism

So the visible camera surfaces are ordinary Windows top-level windows positioned over the desktop. They only **look** aligned to the Electron wall.

Result:

- closing Electron does **not inherently destroy** those `mpv` windows,
- they must be stopped explicitly every time,
- if stop fails or a later sync recreates them, they remain floating on the desktop.

### Root cause B: `stopSurface('wall')` is best-effort, but wall sessions can still outlive tracking

`stopSurface('wall')` does exist and is called from:

1. renderer cleanup in `apps/desktop/src/pages/VideoWallPage.tsx`
2. main-process `onVideoWallClosed` callback in `apps/desktop/electron/main.ts`

However, in `stopSessionInternal()`:

- `killProcessTree(pid)` is awaited,
- but on Windows, `killProcessTree()` resolves even when `taskkill` fails,
- and then the session is removed from `this.sessions` anyway.

So if `taskkill /PID <pid> /T /F` fails for any reason:

- the manager forgets the session,
- persisted tracking is cleared,
- but the real `mpv` process can still remain alive on the desktop.

This explains the observed combination:

- `mpv-sessions.json` can be empty,
- but visible `mpv` windows can still remain.

### Root cause C: late wall sync/show/hide IPC can race against close

`VideoWallPage.tsx` schedules multiple async wall actions:

- periodic camera/layout refresh
- `updateMpvBounds(...)`
- `hideSession(...)`
- `showSession(...)`
- `stopSession(...)`
- resize/scroll/focus/visibility-driven sync
- fullscreen layout changes

There are mounted/disposed guards in the renderer, but wall control still comes from several independent effects and timers. A close race can look like:

1. Video Wall begins unmount / closes,
2. `stopSurface('wall')` is sent,
3. a previously scheduled `updateMpvBounds` or `showSession` still reaches main,
4. main recreates or re-shows a wall session,
5. because the `mpv` window is top-level, it becomes visible on the desktop even though the Electron wall is gone.

So the surviving floating footage can come from either:

- stop failing to kill a process, or
- a post-close wall sync recreating it.

The code path allows both.

---

## Exact IPC Flow

## 1. Wall geometry / session creation

Renderer:

- `apps/desktop/src/pages/VideoWallPage.tsx`
- `window.electronAPI.updateMpvBounds({ cameraId, surface: 'wall', bounds })`

Preload:

- `apps/desktop/electron/preload.ts`
- `updateMpvBounds(...) => ipcRenderer.invoke('mpv:sync-layout', payload)`

Main:

- `apps/desktop/electron/main.ts`
- `ipcMain.handle('mpv:sync-layout', ...)`

Main handler flow:

1. fetch playback config from API
2. resolve owner `BrowserWindow` from sender
3. convert renderer-relative bounds to screen coordinates using `screen.dipToScreenRect(...)`
4. compute session id:
   - wall: `wall:${cameraId}`
   - focus: `focus:${cameraId}`
5. call:
   - `mpvManager.syncSession({ sessionId, surface, camera, bounds })`

Manager:

- `apps/desktop/electron/mpv-manager.ts`
- `syncSession(...)`

Behavior:

- if same session exists and same camera is active, move/show existing window
- otherwise stop/replace existing session and spawn `mpv`

## 2. Wall close path

Renderer cleanup:

- `VideoWallPage.tsx`
- cleanup calls `window.electronAPI.stopSurface('wall')`

Preload:

- `stopSurface(...) => ipcRenderer.invoke('mpv:stop-surface', 'wall')`

Main:

- `ipcMain.handle('mpv:stop-surface', ...)`
- calls `mpvManager.stopSurface('wall')`

Window manager path:

- `apps/desktop/electron/window-manager.ts`
- closing the Video Wall window triggers `onVideoWallClosed`

Main callback:

- `apps/desktop/electron/main.ts`
- `onVideoWallClosed: async () => { await mpvManager.stopSurface('wall') }`

So the wall stop is attempted from **both** renderer and main window lifecycle.

---

## Session IDs and Surface IDs

These are consistent in the current code.

### Wall sessions

- `surface = 'wall'`
- `sessionId = wall:${cameraId}`

### Focus sessions

- `surface = 'focus'`
- `sessionId = focus:${cameraId}`

I did **not** find evidence that wall sessions are registered under the wrong key.

The problem is not wrong naming. The problem is that correctly named wall sessions still manage **external desktop windows**.

---

## Why `stopSurface('wall')` does not reliably remove all wall windows

`stopSurface('wall')` itself is correct in intent:

- it enumerates sessions where `session.surface === 'wall'`
- calls `stopSession(sessionId, reason)`
- `stopSessionInternal()` sets expected exit, clears timers, and calls `killProcessTree(pid)`

But there are two practical weaknesses:

### 1. stop removes manager tracking even if kill fails

On Windows:

- `killProcessTree()` uses `taskkill /PID <pid> /T /F`
- if `taskkill` errors, the promise still resolves
- `stopSessionInternal()` continues
- session is deleted from `this.sessions`

So the manager can say "stopped" while the real `mpv` process survives.

### 2. late wall sync can recreate the session after stop

Because wall sync is renderer-driven and multi-source:

- a post-close or late callback can still call `mpv:sync-layout`
- main can still call `mpvManager.syncSession(...)`
- a new external top-level `mpv` window can appear after the wall has closed

That creates the "footage remains fixed in the middle of the Windows desktop" symptom.

---

## Whether wall sessions are global/floating instead of child/owned windows

Yes.

That is the core architectural fact behind the symptom.

The current wall `mpv` window:

- is top-level,
- is borderless,
- is topmost,
- is moved to screen coordinates,
- is not parented into the Electron `BrowserWindow`,
- is not clipped by Electron layout,
- is not destroyed automatically with Electron close.

So the current system is **window positioning**, not **window embedding**.

---

## Whether HWND targeting now finds a visible window but still does not bind it to Electron

Yes.

The recent HWND-selection improvements help choose a better visible `mpv` window for:

- `MoveWindow`
- `ShowWindow`
- `SetWindowPos`
- extended style changes

But they still operate on a **top-level desktop window**.

So even if the visible video HWND is correctly selected, it is still:

- outside Electron ownership,
- outside Electron clipping,
- vulnerable to surviving after Electron close if not explicitly killed.

---

## Why double-click / fullscreen / Esc are unreliable

This is not only a React handler problem.

Because the visible wall surface is a real top-level `mpv` window:

- it sits above the Electron content plane,
- mouse routing depends on Windows extended styles and timing,
- if click-through/no-activate is not applied to the **actual visible** video HWND at the right moment, `mpv` can still steal focus or block React interaction.

So even if the React tile has double-click handlers:

- React cannot reliably receive those events if the visible `mpv` window is intercepting them.

This is why fullscreen via double-click is unreliable in the current architecture.

---

## Whether cleanup/unmount actually sends `stopSurface('wall')`

Yes.

I confirmed:

- `VideoWallPage.tsx` cleanup calls `window.electronAPI.stopSurface('wall')`
- `preload.ts` exposes `stopSurface`
- `main.ts` handles `'mpv:stop-surface'`
- `window-manager.ts` also triggers `onVideoWallClosed`
- `main.ts` `onVideoWallClosed` also calls `mpvManager.stopSurface('wall')`

So the stop request **is being sent** in the code path.

The bug is that sending the request is not enough because:

1. wall `mpv` is external top-level windowing,
2. stop can lose tracking even if kill fails,
3. a late renderer/main sync can recreate sessions after close.

---

## Whether main process receives `stopSurface('wall')`

Yes, the handler exists and calls the manager:

- `ipcMain.handle('mpv:stop-surface', async (_, surface) => { await mpvManager.stopSurface(surface) ... })`

I did not find a missing handler or wrong IPC name.

---

## Whether `killProcessTree` really kills the `mpv` PID

It is intended to, but it is **not authoritative** in the current implementation.

Current Windows behavior:

- executes `taskkill /PID <pid> /T /F`
- logs failure or success
- resolves regardless

That means:

- a failed `taskkill` does not stop the teardown flow,
- session tracking can be removed even when process termination did not actually happen.

So the current answer is:

> The code tries to kill the `mpv` PID, but it does not verify success strongly enough before forgetting the session.

---

## Whether the `mpv` process survives after close

Based on the observed operator symptoms and the current code paths:

**Yes, it can survive after close** in two ways:

1. `taskkill` fails but the session is removed from manager tracking anyway
2. a late wall sync recreates a new wall session after the close has already started

Both are consistent with:

- Electron wall closed
- floating `mpv` windows still visible
- development environment remains busy until manually stopped

---

## Recommended minimal fix

This is the smallest fix set consistent with the current architecture.

### 1. Make wall close authoritative

When wall close begins, mark the wall/window generation as closed and reject all later wall IPC for that closed generation:

- reject late `mpv:sync-layout` for wall
- reject late `showSession('wall:...')`
- reject late `hideSession('wall:...')`

This prevents post-close recreation.

### 2. Do not forget a session until kill success is confirmed

In Windows stop flow:

- do not immediately delete wall session tracking if `taskkill` failed
- log and keep the session marked as stopping
- optionally retry termination briefly

Right now the manager can orphan a real desktop `mpv` process by forgetting it too early.

### 3. Keep using improved visible-HWND selection, but accept that it is still external windowing

Visible HWND targeting is still necessary, but it is not sufficient.

It improves:

- move
- show/hide
- click-through

It does **not** solve ownership.

### 4. If long-term stability is required, wall must become embedded/owned rendering

That is not the requested minimal fix, but it is the long-term truth:

- as long as wall video is implemented as external top-level `mpv` windows,
- there will always be lifecycle/focus/ownership edge cases that true embedding would avoid.

---

## Bottom line

The wall footage remains visible after Video Wall closes because the current wall player is **not an Electron-owned child surface**. It is a **top-level Windows `mpv` window** that is only positioned to look like it belongs inside Electron.

`stopSurface('wall')` is wired correctly, but it is not sufficient because:

1. `killProcessTree()` is not authoritative on failure,
2. session tracking can be removed even if the real process survives,
3. late wall sync/show/hide can recreate wall sessions after close,
4. improved HWND targeting still does not bind `mpv` to Electron.

That combination explains all observed symptoms:

- floating desktop camera windows
- close does not fully remove footage
- double-click/fullscreen unreliable
- dev environment stays busy
- wall appears to reload/recreate sessions after close
