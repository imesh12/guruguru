import { exec, execSync, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import type { DesktopFileLogger } from './file-logger.js';
import type {
  AbsoluteBounds,
  CameraPlaybackStatus,
  CameraRecord,
  CameraSessionState,
  CameraSurface,
  CameraTestInput,
  CameraTestResult,
  MpvAvailability,
} from './camera-types.js';

type SessionRecord = {
  sessionId: string;
  camera: CameraRecord;
  surface: CameraSurface;
  bounds: AbsoluteBounds;
  fingerprint: string;
  title: string;
  ownerWindowId?: number | undefined;
  ownerWebContentsId?: number | undefined;
  ownerNativeWindowHandle?: string | undefined;
  process: ChildProcess;
  hidden: boolean;
  expectedExit: boolean;
  retries: number;
  stopReason?: 'user' | 'restart' | 'shutdown' | 'replace' | undefined;
  retryTimer?: NodeJS.Timeout | undefined;
  startupTimer?: NodeJS.Timeout | undefined;
  boundsRetryTimer?: NodeJS.Timeout | undefined;
  lastExitCode?: number | null | undefined;
  lastExitSignal?: NodeJS.Signals | null | undefined;
  lastStdout?: string | undefined;
  lastStderr?: string | undefined;
  lastError?: string | undefined;
  processState: 'starting' | 'running' | 'exited' | 'failed';
  lastSyncAt?: number | undefined;
  lastRequestedBounds?: AbsoluteBounds | undefined;
};

type CameraStatusReport = {
  cameraId: string;
  cameraName: string;
  status: CameraPlaybackStatus;
  updatedAt: string;
  message?: string | undefined;
};

type PersistedSession = {
  sessionId: string;
  cameraId: string;
  cameraName: string;
  surface: CameraSurface;
  pid: number;
  startedAt: string;
};

type StatusReporter = (state: CameraStatusReport) => void | Promise<void>;

const RECONNECT_DELAYS = [2, 5, 10] as const;
const STARTUP_GRACE_MS = 20000;
const SESSION_STORE_RETRIES = 5;
const SESSION_STORE_RETRY_MS = 40;
const PROCESS_LOG_TAIL_LIMIT = 4000;
const SYNC_NOOP_WINDOW_MS = 400;
const MPV_RECONNECT_DISABLED = process.env.VITE_DISABLE_MPV_RECONNECT === 'true';

const killProcessTree = async (pid: number, logger?: DesktopFileLogger): Promise<void> => {
  if (pid <= 0) {
    return;
  }

  if (process.platform === 'win32') {
    return new Promise((resolve) => {
      exec(`taskkill /PID ${pid} /T /F`, { windowsHide: true }, (err) => {
        if (err) {
          void logger?.warn?.(`taskkill of PID ${pid} failed or process already exited.`, { error: err.message });
        } else {
          void logger?.info?.(`Successfully killed process tree for PID ${pid} using taskkill.`);
        }
        resolve();
      });
    });
  } else {
    try {
      process.kill(pid, 'SIGTERM');
      void logger?.info?.(`Sent SIGTERM to process tree PID ${pid}.`);
    } catch {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
      void logger?.warn?.(`Process PID ${pid} did not exit after SIGTERM, sent SIGKILL.`);
    } catch {
      void logger?.info?.(`Process PID ${pid} exited cleanly after SIGTERM.`);
    }
  }
};

export class MpvManager extends EventEmitter {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionStates = new Map<string, CameraSessionState>();
  private readonly testProcesses = new Set<ChildProcess>();
  private availabilityPromise?: Promise<MpvAvailability> | undefined;
  private availabilityCache: MpvAvailability = {
    installed: false,
    executable: null,
  };
  private readonly reportedCameraStatuses = new Map<string, CameraPlaybackStatus>();
  private readonly sessionsFilePath: string;
  private availabilityExecutable?: string | undefined;
  private lastLoggedExecutable?: string | undefined;
  private sessionStoreQueue: Promise<void> = Promise.resolve();
  private readonly sessionOperationQueues = new Map<string, Promise<void>>();
  private readonly inFlightStartSessions = new Set<string>();
  private readonly delayedStopTimers = new Map<string, NodeJS.Timeout>();

  private buildTraceStack() {
    return new Error().stack ?? 'stack unavailable';
  }

  private async logKillTrace(
    session: Pick<SessionRecord, 'sessionId' | 'camera' | 'ownerWebContentsId' | 'process'>,
    reason: string,
    caller: string,
  ) {
    await this.logger?.warn('[mpv-kill-trace]', {
      sessionId: session.sessionId,
      cameraId: session.camera.id,
      pid: session.process.pid ?? null,
      reason,
      caller,
      ownerWebContentsId: session.ownerWebContentsId ?? null,
      stack: this.buildTraceStack(),
    });
  }

  private async logSpawnTrace(input: {
    sessionId: string;
    cameraId: string;
    pid: number | null;
    maskedUrl: string | null;
    ownerWebContentsId?: number | undefined;
    reason: string;
  }) {
    await this.logger?.info('[mpv-spawn-trace]', {
      sessionId: input.sessionId,
      cameraId: input.cameraId,
      pid: input.pid,
      maskedUrl: input.maskedUrl,
      ownerWebContentsId: input.ownerWebContentsId ?? null,
      reason: input.reason,
      stack: this.buildTraceStack(),
    });
  }

  private async logReconnectTrace(input: {
    sessionId: string;
    cameraId: string;
    action: 'created' | 'cleared' | 'fired' | 'aborted';
    pid: number | null;
    reason: string;
    ownerWebContentsId?: number | undefined;
  }) {
    await this.logger?.info('[mpv-reconnect-trace]', {
      sessionId: input.sessionId,
      cameraId: input.cameraId,
      action: input.action,
      pid: input.pid,
      reason: input.reason,
      ownerWebContentsId: input.ownerWebContentsId ?? null,
      stack: this.buildTraceStack(),
    });
  }

  private buildSessionFingerprint(input: {
    camera: CameraRecord;
    surface: CameraSurface;
    ownerWindowId?: number;
  }) {
    return `${this.buildRtspUrl(input.camera)}|${input.surface}|${input.ownerWindowId ?? 'none'}`;
  }

  constructor(
    private readonly statusReporter?: StatusReporter,
    private readonly logger?: DesktopFileLogger,
    sessionsFilePath?: string,
  ) {
    super();
    this.sessionsFilePath = sessionsFilePath ?? path.resolve(process.env.APP_DATA_DIR ?? './data', 'mpv-sessions.json');
  }

  async getAvailability(): Promise<MpvAvailability> {
    const mpvExecutable = this.getMpvExecutable();

    if (this.availabilityCache.installed && this.availabilityCache.executable === mpvExecutable) {
      return this.availabilityCache;
    }

    if (this.availabilityPromise && this.availabilityExecutable === mpvExecutable) {
      return this.availabilityPromise;
    }

    this.availabilityExecutable = mpvExecutable;
    this.availabilityPromise = this.detectAvailability(mpvExecutable)
      .then((availability) => {
        this.availabilityCache = availability;
        return availability;
      })
      .finally(() => {
        this.availabilityPromise = undefined;
      });

    return this.availabilityPromise;
  }

  getStatuses(): CameraSessionState[] {
    return Array.from(this.sessionStates.values())
      .map(state => {
        if (state.processState === 'running' && state.status === 'OFFLINE') {
          void this.logger?.warn('[mpv-manager] state invariant running cannot be offline', {
            sessionId: state.sessionId,
            cameraId: state.cameraId,
          });
          return {
            ...state,
            status: 'LIVE' as const,
            message: state.message === 'Playback stopped' ? 'Stream running' : (state.message ?? 'Stream running'),
          };
        }
        return state;
      })
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  async syncSession(input: {
    sessionId: string;
    surface: CameraSurface;
    camera: CameraRecord;
    bounds: AbsoluteBounds;
    ownerWindowId?: number;
    ownerWebContentsId?: number;
    ownerNativeWindowHandle?: string;
  }) {
    // Round bounds immediately to avoid subpixel float differences triggering sync restarts
    input.bounds = {
      x: Math.round(input.bounds.x),
      y: Math.round(input.bounds.y),
      width: Math.round(input.bounds.width),
      height: Math.round(input.bounds.height),
      fullscreen: input.bounds.fullscreen,
    };

    // Cancel any pending delayed stop for this session
    const pendingTimer = this.delayedStopTimers.get(input.sessionId);
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      this.delayedStopTimers.delete(input.sessionId);
      await this.logger?.info('[mpv-manager] delayed slot removal cancelled', { sessionId: input.sessionId });
      await this.logger?.info('[mpv-manager] no kill during ref churn', { sessionId: input.sessionId });
    }

    await this.runSessionOperation(input.sessionId, async () => {
      if (input.surface === 'focus') {
        for (const wallSession of this.sessions.values()) {
          if (wallSession.surface === 'wall' && !wallSession.hidden) {
            await this.logger?.info('[mpv-zorder] hide wall for focus', {
              sessionId: wallSession.sessionId,
              cameraId: wallSession.camera.id,
            });
            wallSession.hidden = true;
            await this.setSessionVisibility(wallSession, false);
          }
        }
      }

      await this.logger?.info('[mpv-session] syncSession entry', {
        sessionId: input.sessionId,
        surface: input.surface,
        cameraId: input.camera.id,
        host: input.camera.host,
        usernameExists: Boolean(input.camera.username),
        passwordExists: Boolean(input.camera.password),
        rtspUrl: this.redactRtspArg(input.camera.rtspUrl ?? ''),
        bounds: input.bounds,
      });

      await this.logger?.info('[mpv-session] start requested', {
        sessionId: input.sessionId,
        surface: input.surface,
        cameraId: input.camera.id,
        host: input.camera.host,
        usernameExists: Boolean(input.camera.username),
        passwordExists: Boolean(input.camera.password),
        sourceUrl: this.redactRtspArg(input.camera.rtspUrl ?? ''),
      });

      const availability = await this.getAvailability();
      const nextFingerprint = this.buildSessionFingerprint(input);

      if (!input.camera.enabled || !input.camera.rtspUrl) {
        await this.logger?.info('[mpv-session] syncSession return disabled-or-missing-rtsp', {
          sessionId: input.sessionId,
          cameraId: input.camera.id,
          enabled: input.camera.enabled,
          hasRtspUrl: Boolean(input.camera.rtspUrl),
        });
        await this.stopSessionInternal(input.sessionId, 'replace', 'syncSession disabled-or-missing-rtsp');
        this.updateState({
          sessionId: input.sessionId,
          cameraId: input.camera.id,
          cameraName: input.camera.name,
          surface: input.surface,
          status: 'OFFLINE',
          updatedAt: new Date().toISOString(),
          mpvInstalled: availability.installed,
          message: !input.camera.rtspUrl ? 'RTSP URL is not configured' : 'Camera is disabled',
        });
        return;
      }

      if (!availability.installed) {
        await this.logger?.info('[mpv-session] syncSession return mpv-not-installed', {
          sessionId: input.sessionId,
          cameraId: input.camera.id,
        });
        this.updateState({
          sessionId: input.sessionId,
          cameraId: input.camera.id,
          cameraName: input.camera.name,
          surface: input.surface,
          status: 'OFFLINE',
          updatedAt: new Date().toISOString(),
          mpvInstalled: false,
          message: 'mpv player was not found. Please configure MPV_PATH in settings/env.',
        });
        return;
      }

      const existing = this.sessions.get(input.sessionId);
      const syncRequestedAt = Date.now();

      if (existing && !this.isProcessActive(existing.process) && existing.retryTimer && existing.camera.id === input.camera.id) {
        existing.bounds = input.bounds;
        existing.ownerWindowId = input.ownerWindowId;
        existing.ownerWebContentsId = input.ownerWebContentsId;
        existing.ownerNativeWindowHandle = input.ownerNativeWindowHandle;
        existing.camera = input.camera;
        existing.surface = input.surface;
        existing.fingerprint = nextFingerprint;
        await this.logger?.info('[mpv-manager] duplicate reconnect ignored', {
          sessionId: input.sessionId,
          cameraId: input.camera.id,
          surface: input.surface,
        });
        return;
      }

      if (existing && !this.isProcessActive(existing.process)) {
        await this.logger?.info('[mpv-session] existing dead; restarting', {
          sessionId: input.sessionId,
          cameraId: input.camera.id,
        });
        this.sessions.delete(input.sessionId);
        this.persistTrackedSessions();
      }

      const activeExisting = this.sessions.get(input.sessionId);
      if (activeExisting && this.isProcessActive(activeExisting.process) && activeExisting.camera.id === input.camera.id) {
        const isFocusActive = this.isFocusSessionActive();
        if (input.surface === 'wall' && isFocusActive) {
          await this.logger?.warn('[mpv-layout] ignored stale surface owner', {
            sessionId: input.sessionId,
            cameraId: input.camera.id,
            reason: 'focus session is active',
          });
          // Update bounds property so it has correct last known bounds for restoration, but do not apply it to the window!
          activeExisting.bounds = input.bounds;
          return;
        }

        const previousFingerprint = activeExisting.fingerprint;
        const restartReasons: string[] = [];
        if (previousFingerprint !== nextFingerprint) {
          if (this.buildRtspUrl(activeExisting.camera) !== this.buildRtspUrl(input.camera)) {
            restartReasons.push('rtspUrl changed');
          }
          if (activeExisting.surface !== input.surface) {
            restartReasons.push('surface changed');
          }
          if ((activeExisting.ownerWindowId ?? null) !== (input.ownerWindowId ?? null)) {
            restartReasons.push('owner changed');
          }
        }

        activeExisting.ownerWindowId = input.ownerWindowId;
        activeExisting.ownerWebContentsId = input.ownerWebContentsId;
        activeExisting.ownerNativeWindowHandle = input.ownerNativeWindowHandle;
        activeExisting.camera = input.camera;
        activeExisting.surface = input.surface;

        if (restartReasons.length > 0) {
          if (restartReasons.includes('rtspUrl changed')) {
            await this.logger?.info('[mpv-manager] killed due to url change', {
              sessionId: input.sessionId,
              cameraId: input.camera.id,
            });
          }
          await this.logger?.info('[mpv-session] restart required reason=' + restartReasons.join(', '), {
            sessionId: input.sessionId,
            cameraId: input.camera.id,
            surface: input.surface,
          });
          await this.stopSessionInternal(input.sessionId, 'replace', `syncSession restart required: ${restartReasons.join(', ')}`);
          await this.startSession({
            ...input,
            retries: 0,
          });
          return;
        }

        if (activeExisting.hidden) {
          await this.setSessionVisibility(activeExisting, true);
          activeExisting.hidden = false;
        }
        const sameBounds = this.boundsWithinTolerance(activeExisting.bounds, input.bounds);
        const duplicateSyncWindow =
          this.boundsWithinTolerance(activeExisting.lastRequestedBounds, input.bounds) &&
          typeof activeExisting.lastSyncAt === 'number' &&
          syncRequestedAt - activeExisting.lastSyncAt <= SYNC_NOOP_WINDOW_MS;
        activeExisting.lastRequestedBounds = input.bounds;
        activeExisting.lastSyncAt = syncRequestedAt;
        if (sameBounds || duplicateSyncWindow) {
          await this.logger?.info('[mpv-manager] sync noop active session', {
            sessionId: input.sessionId,
            cameraId: input.camera.id,
            surface: input.surface,
          });
          return;
        }
        await this.logger?.info('[mpv-manager] bounds update only', {
          sessionId: input.sessionId,
          cameraId: input.camera.id,
          surface: input.surface,
        });
        await this.updateSessionBounds(activeExisting, input.bounds);
        activeExisting.bounds = input.bounds;
        activeExisting.fingerprint = nextFingerprint;
        activeExisting.hidden = false;
        return;
      }

      const staleExisting = this.sessions.get(input.sessionId);
      if (staleExisting) {
        await this.logger?.info(
          input.surface === 'wall' ? '[mpv-session] replacing existing wall session' : '[mpv-session] stopping existing before start',
          {
            sessionId: input.sessionId,
            cameraId: input.camera.id,
          },
        );
        await this.stopSessionInternal(input.sessionId, 'replace', 'syncSession stale existing before start');
      }

      await this.logger?.info('[mpv-session] no existing session; starting', {
        sessionId: input.sessionId,
        cameraId: input.camera.id,
        surface: input.surface,
      });
      await this.logger?.info('[mpv-session] startSession called', {
        sessionId: input.sessionId,
        cameraId: input.camera.id,
        surface: input.surface,
      });
      await this.startSession({
        ...input,
        retries: 0,
      });
    });
  }

  async restartCamera(cameraId: string) {
    const sessions = Array.from(this.sessions.values()).filter((session) => session.camera.id === cameraId);
    await Promise.all(
      sessions.map(async (session) => {
        const nextBounds = session.bounds;
        const nextCamera = session.camera;
        const nextSurface = session.surface;
        const nextSessionId = session.sessionId;

        await this.stopSession(nextSessionId, 'restart', 'restartCamera');
        await this.syncSession({
          sessionId: nextSessionId,
          surface: nextSurface,
          camera: nextCamera,
          bounds: nextBounds,
          ...(session.ownerWindowId !== undefined ? { ownerWindowId: session.ownerWindowId } : {}),
          ...(session.ownerWebContentsId !== undefined ? { ownerWebContentsId: session.ownerWebContentsId } : {}),
          ...(session.ownerNativeWindowHandle !== undefined ? { ownerNativeWindowHandle: session.ownerNativeWindowHandle } : {}),
        });
      }),
    );
  }

  async stopSession(sessionId: string, reason: 'user' | 'restart' | 'shutdown' | 'replace' = 'user', caller = 'stopSession') {
    if (sessionId.startsWith('wall:') && reason === 'user') {
      await this.logger?.info('[mpv-manager] scheduling delayed stop for session', { sessionId, reason, caller });
      
      const existingTimer = this.delayedStopTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(() => {
        this.delayedStopTimers.delete(sessionId);
        void this.runSessionOperation(sessionId, async () => {
          await this.logger?.info('[mpv-manager] executing delayed stop for session', { sessionId, reason, caller });
          await this.stopSessionInternal(sessionId, reason, caller);
        });
      }, 500); // 500ms grace delay

      this.delayedStopTimers.set(sessionId, timer);
      return;
    }

    // For non-wall/non-user stops, cancel any pending delayed timer and run immediately
    const existingTimer = this.delayedStopTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.delayedStopTimers.delete(sessionId);
    }

    await this.runSessionOperation(sessionId, async () => {
      await this.stopSessionInternal(sessionId, reason, caller);
    });
  }

  private async stopSessionInternal(sessionId: string, reason: 'user' | 'restart' | 'shutdown' | 'replace', caller = 'stopSessionInternal') {
    await this.logger?.info('[mpv-session] stop requested', {
      sessionId,
      reason,
      caller,
    });

    const existing = this.sessions.get(sessionId);
    if (!existing) {
      return;
    }

    await this.logKillTrace(existing, reason, caller);

    existing.expectedExit = true;
    existing.stopReason = reason;
    existing.processState = reason === 'user' ? 'exited' : existing.processState === 'failed' ? 'failed' : 'exited';
    if (existing.retryTimer) {
      clearTimeout(existing.retryTimer);
      await this.logReconnectTrace({
        sessionId,
        cameraId: existing.camera.id,
        action: 'cleared',
        pid: existing.process.pid ?? null,
        reason: `${caller} cleared retry timer`,
        ownerWebContentsId: existing.ownerWebContentsId,
      });
      existing.retryTimer = undefined;
    }
    if (existing.startupTimer) {
      clearTimeout(existing.startupTimer);
      existing.startupTimer = undefined;
    }
    if (existing.boundsRetryTimer) {
      clearTimeout(existing.boundsRetryTimer);
      existing.boundsRetryTimer = undefined;
    }

    await this.setSessionVisibility(existing, false);

    let terminated = true;
    if (!this.isProcessActive(existing.process)) {
      terminated = true;
    } else if (existing.process.pid) {
      if (reason === 'shutdown' || reason === 'user') {
        await this.logger?.info('[mpv-manager] killed due to surface close', {
          sessionId,
          cameraId: existing.camera.id,
          reason,
        });
      }
      terminated = await this.terminateTrackedProcess(existing.process.pid, sessionId, existing.camera.id, reason, caller, existing.ownerWebContentsId);
    } else {
      existing.process.kill();
    }

    if (!terminated) {
      await this.logger?.error('[mpv-session] failed to confirm process exit; keeping session tracked for retry.', {
        sessionId,
        cameraId: existing.camera.id,
        pid: existing.process.pid,
        stderrTail: existing.lastStderr,
        stdoutTail: existing.lastStdout,
      });
      return;
    }
    const stoppedSurface = existing.surface;
    this.sessions.delete(sessionId);
    this.persistTrackedSessions();

    if (stoppedSurface === 'focus') {
      const remainingFocus = Array.from(this.sessions.values()).some((s) => s.surface === 'focus' && this.isProcessActive(s.process));
      if (!remainingFocus) {
        for (const wallSession of this.sessions.values()) {
          if (wallSession.surface === 'wall') {
            await this.logger?.info('[mpv-zorder] restore wall after focus', {
              sessionId: wallSession.sessionId,
              cameraId: wallSession.camera.id,
            });
            wallSession.hidden = false;
            await this.setSessionVisibility(wallSession, true);
            await this.updateSessionBounds(wallSession, wallSession.bounds);
          }
        }
      }
    }

    this.updateState({
      sessionId,
      cameraId: existing.camera.id,
      cameraName: existing.camera.name,
      surface: existing.surface,
      status: 'OFFLINE',
      updatedAt: new Date().toISOString(),
      mpvInstalled: this.availabilityCache.installed,
      processState: existing.processState,
      pid: existing.process.pid ?? null,
      lastExitCode: existing.lastExitCode,
      lastError: existing.lastError ?? null,
      message: reason === 'user'
        ? 'Playback stopped'
        : existing.lastExitCode !== undefined
        ? `Playback exited with code ${existing.lastExitCode}. Check RTSP URL or network connection.`
        : existing.lastError ?? 'Playback stopped',
    });
  }

  async stopSurface(surface: CameraSurface, reason: 'user' | 'restart' | 'shutdown' | 'replace' = 'user') {
    await this.logger?.info('[mpv-session] stop surface wall', {
      surface,
      reason,
      count: Array.from(this.sessions.values()).filter((session) => session.surface === surface).length,
    });
    await Promise.all(
      Array.from(this.sessions.values())
      .filter((session) => session.surface === surface)
      .map((session) => this.stopSession(session.sessionId, reason, 'stopSurface')),
    );
  }

  async stopOwnedSurface(
    surface: CameraSurface,
    ownerWebContentsId: number,
    reason: 'user' | 'restart' | 'shutdown' | 'replace' = 'user',
  ) {
    const matchingSessions = Array.from(this.sessions.values()).filter(
      (session) => session.surface === surface && session.ownerWebContentsId === ownerWebContentsId,
    );

    if (matchingSessions.length === 0) {
      return;
    }

    await this.logger?.info('[mpv-session] stop owned surface', {
      surface,
      ownerWebContentsId,
      reason,
      count: matchingSessions.length,
    });

    await Promise.all(matchingSessions.map((session) => this.stopSession(session.sessionId, reason, 'stopOwnedSurface')));
  }

  async hideSurface(surface: CameraSurface) {
    await Promise.all(
      Array.from(this.sessions.values())
        .filter((session) => session.surface === surface)
        .map((session) => this.hideSession(session.sessionId)),
    );
  }

  async showSurface(surface: CameraSurface) {
    await Promise.all(
      Array.from(this.sessions.values())
        .filter((session) => session.surface === surface)
        .map((session) => this.showSession(session.sessionId)),
    );
  }

  async hideSession(sessionId: string) {
    await this.runSessionOperation(sessionId, async () => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }
      await this.setSessionVisibility(session, false);
    });
  }

  async showSession(sessionId: string) {
    await this.runSessionOperation(sessionId, async () => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }
      await this.setSessionVisibility(session, true);
      await this.updateSessionBounds(session, session.bounds);
    });
  }

  shutdown() {
    for (const session of this.sessions.values()) {
      session.expectedExit = true;
      if (session.retryTimer) {
        clearTimeout(session.retryTimer);
        void this.logReconnectTrace({
          sessionId: session.sessionId,
          cameraId: session.camera.id,
          action: 'cleared',
          pid: session.process.pid ?? null,
          reason: 'shutdown cleared retry timer',
          ownerWebContentsId: session.ownerWebContentsId,
        });
        session.retryTimer = undefined;
      }
      if (session.startupTimer) {
        clearTimeout(session.startupTimer);
        session.startupTimer = undefined;
      }
      if (session.boundsRetryTimer) {
        clearTimeout(session.boundsRetryTimer);
        session.boundsRetryTimer = undefined;
      }

      const pid = session.process.pid ?? 0;
      if (!pid || !this.isProcessActive(session.process)) {
        continue;
      }

      try {
        void this.logKillTrace(session, 'shutdown', 'shutdown');
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${pid} /T /F`, { windowsHide: true, stdio: 'ignore' });
        } else {
          process.kill(pid, 'SIGKILL');
        }
      } catch {
        // Best-effort cleanup during shutdown.
      }
    }

    this.sessions.clear();
    this.inFlightStartSessions.clear();
    for (const processHandle of this.testProcesses) {
      if (processHandle.pid) {
        void killProcessTree(processHandle.pid, this.logger);
      } else {
        processHandle.kill();
      }
    }
    this.testProcesses.clear();
    this.persistTrackedSessions();
  }

  async stopCamera(cameraId: string, reason: 'user' | 'restart' | 'shutdown' | 'replace' = 'user') {
    await Promise.all(
      Array.from(this.sessions.values())
      .filter((session) => session.camera.id === cameraId)
      .map((session) => this.stopSession(session.sessionId, reason, 'stopCamera')),
    );
  }

  getProcessCount() {
    return Array.from(this.sessions.values()).filter((session) => this.isProcessActive(session.process)).length;
  }

  async restartAllSessions() {
    const cameraIds = new Set(Array.from(this.sessions.values()).map((session) => session.camera.id));
    await Promise.all(Array.from(cameraIds).map((cameraId) => this.restartCamera(cameraId)));
  }

  clearStaleSessions() {
    Array.from(this.sessions.values())
      .filter((session) => this.sessionStates.get(session.sessionId)?.status !== 'LIVE' || !this.isProcessActive(session.process))
      .forEach((session) => void this.stopSession(session.sessionId, 'replace', 'clearStaleSessions'));
    return this.getStatuses();
  }

  async reconnectAllCameras() {
    const cameraIds = new Set(Array.from(this.sessionStates.values()).map((state) => state.cameraId));
    await Promise.all(Array.from(cameraIds).map((cameraId) => this.restartCamera(cameraId)));
  }

  async cleanupPersistedSessions() {
    await this.logger?.info('[mpv-session-store] cleanup begin', {
      path: this.sessionsFilePath,
    });

    const persistedSessions = await this.readPersistedSessions();
    if (persistedSessions.length === 0) {
      await this.logger?.info('[mpv-session-store] cleanup end', {
        path: this.sessionsFilePath,
        entries: 0,
      });
      return;
    }

    for (const session of persistedSessions) {
      const isTrackedMpv = await this.isTrackedMpvProcess(session.pid);
      if (!isTrackedMpv) {
        continue;
      }

      try {
        await killProcessTree(session.pid, this.logger);
        await this.logger?.warn('Stopped stale tracked mpv session on startup.', {
          sessionId: session.sessionId,
          cameraId: session.cameraId,
          pid: session.pid,
        });
      } catch (error) {
        await this.logger?.warn('Failed to stop stale tracked mpv session on startup.', {
          sessionId: session.sessionId,
          cameraId: session.cameraId,
          pid: session.pid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await this.writePersistedSessions([]);
    await this.logger?.info('[mpv-session-store] cleanup end', {
      path: this.sessionsFilePath,
      entries: persistedSessions.length,
    });
  }

  async testCamera(input: CameraTestInput): Promise<CameraTestResult> {
    const availability = await this.getAvailability();
    if (!availability.installed) {
      return {
        success: false,
        message: 'mpv was not found on PATH.',
      };
    }

    if (!input.rtspUrl) {
      return {
        success: false,
        message: 'RTSP URL is required for camera testing.',
      };
    }

    return new Promise((resolve) => {
      let settled = false;
      const args = this.buildTestArgs(input);
      const mpvExecutable = this.getMpvExecutable();
      const processHandle = spawn(mpvExecutable, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      void this.logSpawn('test-camera', args, input.name, undefined, input.rtspUrl);
      processHandle.stdout?.on('data', (chunk) => {
        const output = chunk.toString('utf8').trim();
        if (output) {
          void this.logger?.info('[mpv-session] stdout', {
            sessionId: `test:${input.name}`,
            output,
          });
        }
      });
      processHandle.stderr?.on('data', (chunk) => {
        const output = chunk.toString('utf8').trim();
        if (output) {
          void this.logger?.warn('[mpv-session] stderr', {
            sessionId: `test:${input.name}`,
            output,
          });
        }
      });
      this.testProcesses.add(processHandle);

      const finish = (result: CameraTestResult) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      const successTimer = setTimeout(() => {
        finish({
          success: true,
          message: 'mpv test player launched successfully. Close the player window when finished.',
        });
      }, STARTUP_GRACE_MS);

      processHandle.once('error', (error) => {
        clearTimeout(successTimer);
        this.testProcesses.delete(processHandle);
      void this.logger?.error('mpv test player failed to launch.', {
          cameraName: input.name,
          executable: mpvExecutable,
          code: error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : undefined,
          error: error instanceof Error ? error.message : String(error),
        });
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          void this.logger?.error('mpv test player executable was not found.', {
            cameraName: input.name,
            executable: mpvExecutable,
          });
        }
        finish({
          success: false,
          message: 'Failed to launch mpv test player.',
        });
      });

      processHandle.once('exit', (code) => {
        clearTimeout(successTimer);
        this.testProcesses.delete(processHandle);
        void this.logger?.warn('mpv test player exited.', {
          cameraName: input.name,
          exitCode: code,
        });
        if (!settled && code !== 0) {
          finish({
            success: false,
            message: `mpv test player exited early with code ${code ?? 'unknown'}.`,
          });
        }
      });
    });
  }

  private getMpvExecutable(): string {
    const configuredPath = process.env.MPV_PATH?.trim();
    const executable = configuredPath ? configuredPath.replace(/^['"]+|['"]+$/g, '').trim() || 'mpv' : 'mpv';

    if (configuredPath && this.lastLoggedExecutable !== executable) {
      this.lastLoggedExecutable = executable;
      void this.logger?.info('[mpv] using configured MPV_PATH', {
        executable,
      });
    }

    return executable;
  }

  private async detectAvailability(mpvExecutable: string): Promise<MpvAvailability> {
    return new Promise((resolve) => {
      const checker = spawn(mpvExecutable, ['--version'], {
        windowsHide: true,
      });

      const finish = (installed: boolean) => {
        void this.logger?.info('[mpv] availability checked.', {
          installed,
          executable: installed ? mpvExecutable : null,
        });
        resolve({
          installed,
          executable: installed ? mpvExecutable : null,
        });
      };

      checker.once('error', (error) => {
        void this.logger?.warn('[mpv] availability check failed.', {
          executable: mpvExecutable,
          error: error instanceof Error ? error.message : String(error),
        });
        finish(false);
      });
      checker.once('exit', (code) => finish(code === 0));
    });
  }

  private async startSession(input: {
    sessionId: string;
    surface: CameraSurface;
    camera: CameraRecord;
    bounds: AbsoluteBounds;
    retries: number;
    ownerWindowId?: number;
    ownerWebContentsId?: number;
    ownerNativeWindowHandle?: string;
  }) {
    if (this.inFlightStartSessions.has(input.sessionId)) {
      await this.logger?.info('[mpv-guard] start in-flight skipped', {
        sessionId: input.sessionId,
        cameraId: input.camera.id,
        surface: input.surface,
      });
      return;
    }

    const existing = this.sessions.get(input.sessionId);
    if (existing && this.isProcessActive(existing.process)) {
      existing.bounds = input.bounds;
      existing.ownerWindowId = input.ownerWindowId;
      existing.ownerWebContentsId = input.ownerWebContentsId;
      existing.ownerNativeWindowHandle = input.ownerNativeWindowHandle;
      await this.logger?.info('[mpv-manager] spawn skipped active process', {
        sessionId: input.sessionId,
        cameraId: input.camera.id,
        surface: input.surface,
      });
      await this.updateSessionBounds(existing, input.bounds);
      return;
    }

    this.inFlightStartSessions.add(input.sessionId);
    try {
    const title = this.buildSessionWindowTitle(input.sessionId);
    const fingerprint = this.buildSessionFingerprint(input);
    const args = this.buildMpvArgs(input.camera, input.bounds, title);
    const mpvExecutable = this.getMpvExecutable();
    void this.logger?.info('[wall-debug] mpvManager.startSession entry', {
      sessionId: input.sessionId,
      surface: input.surface,
      cameraId: input.camera.id,
      executable: mpvExecutable,
      host: input.camera.host,
      usernameExists: Boolean(input.camera.username),
      passwordExists: Boolean(input.camera.password),
      rtspUrl: this.redactRtspArg(input.camera.rtspUrl ?? ''),
      bounds: input.bounds,
    });
    void this.logger?.info('[mpv-session] launching', {
      sessionId: input.sessionId,
      surface: input.surface,
      cameraId: input.camera.id,
      executable: mpvExecutable,
      args: args.map((arg) => this.redactRtspArg(arg)),
      bounds: input.bounds,
    });
    const processHandle = spawn(mpvExecutable, args, {
      shell: false,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await this.logger?.info('[mpv-session] spawn pid', {
      sessionId: input.sessionId,
      cameraId: input.camera.id,
      surface: input.surface,
      pid: processHandle.pid ?? null,
    });
    await this.logSpawnTrace({
      sessionId: input.sessionId,
      cameraId: input.camera.id,
      pid: processHandle.pid ?? null,
      maskedUrl: this.redactRtspArg(input.camera.rtspUrl ?? ''),
      ownerWebContentsId: input.ownerWebContentsId,
      reason: input.retries > 0 ? `reconnect attempt ${input.retries}` : 'startSession',
    });

    void this.logSpawn(input.sessionId, args, input.camera.name, input.surface, input.camera.rtspUrl);

    const isFocusActive = this.isFocusSessionActive();
    const isHidden = input.surface === 'wall' && isFocusActive;

    const record: SessionRecord = {
      sessionId: input.sessionId,
      camera: input.camera,
      surface: input.surface,
      bounds: input.bounds,
      fingerprint,
      title,
      ownerWindowId: input.ownerWindowId,
      ownerWebContentsId: input.ownerWebContentsId,
      ownerNativeWindowHandle: input.ownerNativeWindowHandle,
      process: processHandle,
      hidden: isHidden,
      expectedExit: false,
      retries: input.retries,
      processState: 'starting',
    };

    this.sessions.set(input.sessionId, record);
    this.persistTrackedSessions();
    this.attachProcessLogging(record);
    this.updateState({
      sessionId: input.sessionId,
      cameraId: input.camera.id,
      cameraName: input.camera.name,
      surface: input.surface,
      status: 'RECONNECTING',
      updatedAt: new Date().toISOString(),
      mpvInstalled: this.availabilityCache.installed,
      processState: 'starting',
      pid: processHandle.pid ?? null,
      lastError: null,
      retryDelaySeconds: Math.ceil(STARTUP_GRACE_MS / 1000),
      message: 'Connecting to RTSP stream...',
    });

    record.startupTimer = setTimeout(() => {
      record.startupTimer = undefined;
      if (this.sessions.get(input.sessionId) !== record || !this.isProcessActive(record.process)) {
        return;
      }

      record.processState = 'running';
      this.updateState({
        sessionId: input.sessionId,
        cameraId: input.camera.id,
        cameraName: input.camera.name,
        surface: input.surface,
        status: 'LIVE',
        updatedAt: new Date().toISOString(),
        mpvInstalled: this.availabilityCache.installed,
        processState: 'running',
        pid: record.process.pid ?? null,
        lastError: null,
        message: 'Stream running',
      });
    }, STARTUP_GRACE_MS);

    processHandle.once('error', (error) => {
      void this.runSessionOperation(record.sessionId, async () => {
        if (record.startupTimer) {
          clearTimeout(record.startupTimer);
          record.startupTimer = undefined;
        }
        record.processState = 'failed';
        record.lastError = error instanceof Error ? error.message : String(error);
        await this.logger?.error('mpv session process error.', {
          sessionId: input.sessionId,
          cameraId: input.camera.id,
          executable: mpvExecutable,
          code: error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : undefined,
          error: error instanceof Error ? error.message : String(error),
          stderrTail: record.lastStderr,
          stdoutTail: record.lastStdout,
        });
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          await this.logger?.error('mpv session executable was not found.', {
            sessionId: input.sessionId,
            cameraId: input.camera.id,
            executable: mpvExecutable,
          });
        }
        await this.handleUnexpectedExit(record, null);
      });
    });

    processHandle.once('exit', (code, signal) => {
      record.lastExitCode = code;
      record.lastExitSignal = signal;
      record.processState = code === 0 ? 'exited' : 'failed';
      void this.runSessionOperation(record.sessionId, async () => {
        if (record.startupTimer) {
          clearTimeout(record.startupTimer);
          record.startupTimer = undefined;
        }
        await this.logger?.warn('[mpv-session] process exited', {
          sessionId: input.sessionId,
          cameraId: input.camera.id,
          exitCode: code,
          signal,
          executable: mpvExecutable,
          stderrTail: record.lastStderr,
          stdoutTail: record.lastStdout,
        });
        if (record.expectedExit) {
          return;
        }

        await this.handleUnexpectedExit(record, code);
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 250));
    if (this.sessions.get(input.sessionId) === record && this.isProcessActive(record.process)) {
      record.processState = 'running';
      await this.attachSessionWindow(record);
    }
    } finally {
      this.inFlightStartSessions.delete(input.sessionId);
    }
  }

  private async handleUnexpectedExit(record: SessionRecord, code: number | null) {
    if (this.sessions.get(record.sessionId) !== record || record.expectedExit) {
      return;
    }

    if (record.retryTimer) {
      await this.logReconnectTrace({
        sessionId: record.sessionId,
        cameraId: record.camera.id,
        action: 'aborted',
        pid: record.process.pid ?? null,
        reason: 'duplicate reconnect ignored because timer already exists',
        ownerWebContentsId: record.ownerWebContentsId,
      });
      await this.logger?.info('[mpv-manager] duplicate reconnect ignored', {
        sessionId: record.sessionId,
        cameraId: record.camera.id,
        surface: record.surface,
      });
      return;
    }
    if (record.startupTimer) {
      clearTimeout(record.startupTimer);
      record.startupTimer = undefined;
    }
    if (record.boundsRetryTimer) {
      clearTimeout(record.boundsRetryTimer);
      record.boundsRetryTimer = undefined;
    }
    this.persistTrackedSessions();

    if (MPV_RECONNECT_DISABLED) {
      await this.logReconnectTrace({
        sessionId: record.sessionId,
        cameraId: record.camera.id,
        action: 'aborted',
        pid: record.process.pid ?? null,
        reason: 'VITE_DISABLE_MPV_RECONNECT=true',
        ownerWebContentsId: record.ownerWebContentsId,
      });
      this.updateState({
        sessionId: record.sessionId,
        cameraId: record.camera.id,
        cameraName: record.camera.name,
        surface: record.surface,
        status: 'OFFLINE',
        updatedAt: new Date().toISOString(),
        mpvInstalled: this.availabilityCache.installed,
        processState: record.processState,
        pid: record.process.pid ?? null,
        lastError: record.lastError ?? (code === null ? 'Connection failed.' : null),
        lastExitCode: code,
        message: code !== null
          ? `Stream disconnected (exit code ${code}). Automatic reconnect disabled.`
          : `${record.lastError ?? 'Connection failed.'} Automatic reconnect disabled.`,
      });
      return;
    }

    const nextRetryIndex = Math.min(record.retries, RECONNECT_DELAYS.length - 1);
    const retryDelaySeconds: number = RECONNECT_DELAYS[nextRetryIndex] ?? RECONNECT_DELAYS[RECONNECT_DELAYS.length - 1] ?? 10;

    this.updateState({
      sessionId: record.sessionId,
      cameraId: record.camera.id,
      cameraName: record.camera.name,
      surface: record.surface,
      status: 'RECONNECTING',
      updatedAt: new Date().toISOString(),
      mpvInstalled: this.availabilityCache.installed,
      processState: record.processState,
      pid: record.process.pid ?? null,
      lastError: record.lastError ?? (code === null ? 'Connection failed.' : null),
      retryDelaySeconds,
      lastExitCode: code,
      message: code !== null
        ? `Stream disconnected (exit code ${code}). Retrying in ${retryDelaySeconds}s...`
        : `${record.lastError ?? 'Connection failed.'} Retrying in ${retryDelaySeconds}s...`,
    });

    await this.logReconnectTrace({
      sessionId: record.sessionId,
      cameraId: record.camera.id,
      action: 'created',
      pid: record.process.pid ?? null,
      reason: `unexpected exit scheduled reconnect in ${retryDelaySeconds}s`,
      ownerWebContentsId: record.ownerWebContentsId,
    });

    record.retryTimer = setTimeout(() => {
      void this.runSessionOperation(record.sessionId, async () => {
        const current = this.sessions.get(record.sessionId);
        if (current !== record || record.expectedExit) {
          await this.logReconnectTrace({
            sessionId: record.sessionId,
            cameraId: record.camera.id,
            action: 'aborted',
            pid: record.process.pid ?? null,
            reason: 'reconnect timer fired but session was replaced or expected exit',
            ownerWebContentsId: record.ownerWebContentsId,
          });
          return;
        }

        record.retryTimer = undefined;
        await this.logReconnectTrace({
          sessionId: record.sessionId,
          cameraId: record.camera.id,
          action: 'fired',
          pid: record.process.pid ?? null,
          reason: `starting reconnect after ${retryDelaySeconds}s delay`,
          ownerWebContentsId: record.ownerWebContentsId,
        });
        await this.startSession({
          sessionId: record.sessionId,
          camera: record.camera,
          surface: record.surface,
          bounds: record.bounds,
          ...(record.ownerWindowId !== undefined ? { ownerWindowId: record.ownerWindowId } : {}),
          ...(record.ownerWebContentsId !== undefined ? { ownerWebContentsId: record.ownerWebContentsId } : {}),
          ...(record.ownerNativeWindowHandle !== undefined ? { ownerNativeWindowHandle: record.ownerNativeWindowHandle } : {}),
          retries: record.retries + 1,
        });
      });
    }, retryDelaySeconds * 1000);
  }

  private buildSessionWindowTitle(sessionId: string) {
    const [surface, cameraId] = sessionId.split(':', 2);
    return `Kurukuru-${surface}-${cameraId ?? 'unknown'}`;
  }

  private appendProcessOutput(current: string | undefined, chunk: string) {
    const next = `${current ?? ''}${chunk}`;
    return next.length > PROCESS_LOG_TAIL_LIMIT ? next.slice(-PROCESS_LOG_TAIL_LIMIT) : next;
  }

  private buildMpvArgs(camera: CameraRecord, bounds: AbsoluteBounds, title: string): string[] {
    const geometry = `${Math.round(bounds.width)}x${Math.round(bounds.height)}+${Math.round(bounds.x)}+${Math.round(bounds.y)}`;
    const streamUrl = this.buildRtspUrl(camera);

    return [
      '--profile=low-latency',
      '--no-cache',
      '--demuxer-lavf-o=fflags=nobuffer',
      '--rtsp-transport=tcp',
      '--force-window=yes',
      '--border=no',
      '--no-terminal',
      '--really-quiet',
      '--keepaspect',
      '--window-dragging=no',
      '--cursor-autohide=1000',
      '--osc=no',
      '--keep-open=no',
      '--input-default-bindings=no',
      `--title=${title}`,
      `--geometry=${geometry}`,
      '--ontop=no',
      streamUrl,
    ];
  }

  private buildRtspUrl(camera: CameraRecord): string {
    return this.composeRtspUrl(camera.rtspUrl, camera.username, camera.password);
  }

  private buildRtspUrlFromInput(input: CameraTestInput): string {
    return this.composeRtspUrl(input.rtspUrl, input.username, input.password);
  }

  private buildTestArgs(input: CameraTestInput) {
    return [
      '--profile=low-latency',
      '--untimed',
      '--no-cache',
      '--demuxer-lavf-o=fflags=nobuffer',
      '--rtsp-transport=tcp',
      '--force-window=yes',
      `--title=${input.name} Test Player`,
      '--geometry=960x540+120+120',
      '--osc=yes',
      '--keep-open=no',
      this.buildRtspUrlFromInput(input),
    ];
  }

  private sameBounds(left: AbsoluteBounds, right: AbsoluteBounds): boolean {
    return (
      Math.abs(left.x - right.x) < 2 &&
      Math.abs(left.y - right.y) < 2 &&
      Math.abs(left.width - right.width) < 2 &&
      Math.abs(left.height - right.height) < 2
    );
  }

  private boundsWithinTolerance(left: AbsoluteBounds | undefined, right: AbsoluteBounds): boolean {
    if (!left) {
      return false;
    }

    return (
      Math.abs(left.x - right.x) <= 2 &&
      Math.abs(left.y - right.y) <= 2 &&
      Math.abs(left.width - right.width) <= 2 &&
      Math.abs(left.height - right.height) <= 2 &&
      Boolean(left.fullscreen) === Boolean(right.fullscreen)
    );
  }

  private updateState(state: CameraSessionState) {
    const session = this.sessions.get(state.sessionId);
    let nextState: CameraSessionState = {
      ...this.sessionStates.get(state.sessionId),
      ...state,
      processState: state.processState ?? session?.processState ?? this.sessionStates.get(state.sessionId)?.processState,
      pid: state.pid ?? session?.process.pid ?? this.sessionStates.get(state.sessionId)?.pid ?? null,
      lastError: state.lastError ?? session?.lastError ?? this.sessionStates.get(state.sessionId)?.lastError ?? null,
    };

    if (nextState.processState === 'running' && nextState.status === 'OFFLINE') {
      void this.logger?.warn('[mpv-manager] state invariant running cannot be offline', {
        sessionId: nextState.sessionId,
        cameraId: nextState.cameraId,
      });
      nextState = {
        ...nextState,
        status: 'LIVE',
        message: nextState.message === 'Playback stopped' ? 'Stream running' : (nextState.message ?? 'Stream running'),
      };
    }

    this.sessionStates.set(state.sessionId, nextState);
    this.emit('status-changed', this.getStatuses());
    this.reportCameraAggregateStatus(nextState);
  }

  private reportCameraAggregateStatus(state: CameraSessionState) {
    const aggregate = this.getAggregateStatus(state.cameraId);
    const previousAggregate = this.reportedCameraStatuses.get(state.cameraId);
    if (previousAggregate === aggregate) {
      return;
    }

    this.reportedCameraStatuses.set(state.cameraId, aggregate);
    const message =
      aggregate === 'RECONNECTING'
        ? state.processState === 'starting'
          ? 'Starting mpv session...'
          : `Retrying in ${state.retryDelaySeconds ?? 0}s`
        : aggregate === 'OFFLINE'
          ? state.mpvInstalled
            ? `All sessions offline${state.lastExitCode !== undefined ? ` (exit code ${state.lastExitCode ?? 'unknown'})` : ''}`
            : 'mpv is not installed'
          : undefined;

    void this.statusReporter?.({
      cameraId: state.cameraId,
      cameraName: state.cameraName,
      status: aggregate,
      updatedAt: state.updatedAt,
      message,
    });
  }

  private getAggregateStatus(cameraId: string): CameraPlaybackStatus {
    const states = Array.from(this.sessionStates.values()).filter((entry) => entry.cameraId === cameraId);
    if (states.some((entry) => entry.processState === 'running' || entry.status === 'LIVE')) {
      return 'LIVE';
    }
    if (states.some((entry) => entry.processState === 'starting' || entry.status === 'RECONNECTING')) {
      return 'RECONNECTING';
    }
    return 'OFFLINE';
  }

  private composeRtspUrl(rtspUrl: string | null, username: string | null, password: string | null): string {
    if (!rtspUrl) {
      return '';
    }

    let urlStr = rtspUrl.trim();

    if (!username && !password) {
      return urlStr;
    }

    if (!urlStr.match(/^[a-zA-Z0-9+-.]+:\/\//)) {
      urlStr = `rtsp://${urlStr}`;
    }

    try {
      const url = new URL(urlStr);

      const finalUser = username ?? url.username;
      const finalPass = password ?? url.password;

      url.username = '';
      url.password = '';

      if (finalUser) {
        url.username = finalUser;
      }
      if (finalPass) {
        url.password = finalPass;
      }

      return url.toString();
    } catch {
      return rtspUrl;
    }
  }

  private attachProcessLogging(record: SessionRecord) {
    record.process.stdout?.on('data', (chunk) => {
      const output = chunk.toString('utf8');
      const trimmed = output.trim();
      if (trimmed) {
        record.lastStdout = this.appendProcessOutput(record.lastStdout, output);
        void this.logger?.info('[mpv-session] stdout', {
          sessionId: record.sessionId,
          cameraId: record.camera.id,
          output: trimmed,
        });
      }
    });

    record.process.stderr?.on('data', (chunk) => {
      const output = chunk.toString('utf8');
      const trimmed = output.trim();
      if (trimmed) {
        record.lastStderr = this.appendProcessOutput(record.lastStderr, output);
        void this.logger?.warn('[mpv-session] stderr', {
          sessionId: record.sessionId,
          cameraId: record.camera.id,
          output: trimmed,
        });
      }
    });
  }

  private async logSpawn(
    sessionId: string,
    args: string[],
    cameraName: string,
    surface?: CameraSurface,
    sourceUrl?: string | null,
  ) {
    await this.logger?.info('Launching mpv process.', {
      sessionId,
      cameraName,
      surface: surface ?? 'test',
      host: sourceUrl?.startsWith('rtsp://') ? (() => {
        try {
          return new URL(sourceUrl).hostname;
        } catch {
          return undefined;
        }
      })() : undefined,
      command: this.getMpvExecutable(),
      executableExists: this.executableExists(this.getMpvExecutable()),
      args: args.map((arg) => this.redactRtspArg(arg)),
      sourceUrl: this.redactRtspArg(sourceUrl ?? ''),
      shell: false,
      windowsHide: false,
    });
    await this.logger?.info('[wall-debug] mpvManager.spawn path and source', {
      sessionId,
      surface: surface ?? 'test',
      executable: this.getMpvExecutable(),
      sourceUrl: this.redactRtspArg(sourceUrl ?? ''),
    });
  }

  private redactRtspArg(value: string) {
    if (!value.startsWith('rtsp://')) {
      return value;
    }

    try {
      const url = new URL(value);
      if (url.password) {
        url.password = '***';
      }
      return url.toString();
    } catch {
      return value.replace(/:\/\/([^:/]+):([^@]+)@/g, '://$1:***@');
    }
  }

  private persistTrackedSessions() {
    const data: PersistedSession[] = Array.from(this.sessions.values())
      .filter((session) => session.process.pid && this.isProcessActive(session.process))
      .map((session) => ({
        sessionId: session.sessionId,
        cameraId: session.camera.id,
        cameraName: session.camera.name,
        surface: session.surface,
        pid: session.process.pid ?? -1,
        startedAt: new Date().toISOString(),
      }))
      .filter((session) => session.pid > 0);

    this.sessionStoreQueue = this.sessionStoreQueue
      .catch(() => undefined)
      .then(() => this.writePersistedSessions(data))
      .catch((error) => {
        void this.logger?.error('[mpv-session-store] write failed', {
          path: this.sessionsFilePath,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private isProcessActive(processHandle: ChildProcess) {
    return processHandle.exitCode === null && !processHandle.killed;
  }

  private isFocusSessionActive(): boolean {
    return Array.from(this.sessions.values()).some((s) => s.surface === 'focus' && this.isProcessActive(s.process));
  }

  private async runSessionOperation<T>(sessionId: string, operation: () => Promise<T>) {
    const previous = this.sessionOperationQueues.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.catch(() => undefined).then(() => gate);

    this.sessionOperationQueues.set(sessionId, chained);

    try {
      await previous.catch(() => undefined);
      return await operation();
    } finally {
      release();
      if (this.sessionOperationQueues.get(sessionId) === chained) {
        this.sessionOperationQueues.delete(sessionId);
      }
    }
  }

  private async readPersistedSessions(): Promise<PersistedSession[]> {
    await this.sessionStoreQueue.catch(() => undefined);
    if (!existsSync(this.sessionsFilePath)) {
      return [];
    }

    try {
      const raw = readFileSync(this.sessionsFilePath, 'utf8');
      const parsed = JSON.parse(raw) as PersistedSession[];
      return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry?.pid === 'number' && entry.pid > 0) : [];
    } catch {
      return [];
    }
  }

  private async writePersistedSessions(data: PersistedSession[]) {
    const directory = path.dirname(this.sessionsFilePath);
    mkdirSync(directory, { recursive: true });

    const payload = `${JSON.stringify(data, null, 2)}\n`;
    const tempPath = `${this.sessionsFilePath}.${process.pid}.tmp`;

    await this.logger?.info('[mpv-session-store] write begin', {
      path: this.sessionsFilePath,
      entries: data.length,
    });

    await this.withSessionStoreRetries('write temp', async (attempt) => {
      await fs.writeFile(tempPath, payload, 'utf8');
      await this.logger?.info('[mpv-session-store] write temp complete', {
        path: tempPath,
        attempt,
      });
    });

    await this.withSessionStoreRetries('replace store', async () => {
      try {
        await fs.rename(tempPath, this.sessionsFilePath);
        return;
      } catch (error) {
        if (!existsSync(this.sessionsFilePath)) {
          throw error;
        }
        rmSync(this.sessionsFilePath, { force: true });
        await fs.rename(tempPath, this.sessionsFilePath);
      }
    });

    await this.logger?.info('[mpv-session-store] write end', {
      path: this.sessionsFilePath,
      entries: data.length,
    });
  }

  private async withSessionStoreRetries(action: string, task: (attempt: number) => Promise<void>) {
    let lastError: unknown;

    for (let attempt = 1; attempt <= SESSION_STORE_RETRIES; attempt += 1) {
      try {
        await task(attempt);
        return;
      } catch (error) {
        lastError = error;
        const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : undefined;
        await this.logger?.warn('[mpv-session-store] retry reason', {
          action,
          attempt,
          code,
          error: error instanceof Error ? error.message : String(error),
        });

        if (attempt === SESSION_STORE_RETRIES || !this.isRetryableSessionStoreError(error)) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, SESSION_STORE_RETRY_MS * attempt));
      }
    }

    throw lastError;
  }

  private isRetryableSessionStoreError(error: unknown) {
    const code = error instanceof Error && 'code' in error ? String((error as NodeJS.ErrnoException).code ?? '') : '';
    return ['EBUSY', 'EPERM', 'EACCES'].includes(code);
  }

  private executableExists(executable: string) {
    return /[\\/:]/.test(executable) ? existsSync(executable) : undefined;
  }

  private async cleanupFailedAttach(session: SessionRecord) {
    const pid = session.process.pid ?? 0;
    session.expectedExit = true;

    if (session.retryTimer) {
      clearTimeout(session.retryTimer);
      await this.logReconnectTrace({
        sessionId: session.sessionId,
        cameraId: session.camera.id,
        action: 'cleared',
        pid: session.process.pid ?? null,
        reason: 'cleanupFailedAttach cleared retry timer',
        ownerWebContentsId: session.ownerWebContentsId,
      });
      session.retryTimer = undefined;
    }
    if (session.startupTimer) {
      clearTimeout(session.startupTimer);
      session.startupTimer = undefined;
    }
    if (session.boundsRetryTimer) {
      clearTimeout(session.boundsRetryTimer);
      session.boundsRetryTimer = undefined;
    }

    if (pid > 0 && this.isProcessActive(session.process)) {
      await this.terminateTrackedProcess(
        pid,
        session.sessionId,
        session.camera.id,
        'window attach failed',
        'cleanupFailedAttach',
        session.ownerWebContentsId,
      );
      await this.logger?.info('[mpv-cleanup] attach failed killed pid', {
        sessionId: session.sessionId,
        cameraId: session.camera.id,
        pid,
      });
    }

    if (this.sessions.get(session.sessionId) === session) {
      this.sessions.delete(session.sessionId);
    }
    this.persistTrackedSessions();
    this.updateState({
      sessionId: session.sessionId,
      cameraId: session.camera.id,
      cameraName: session.camera.name,
      surface: session.surface,
      status: 'OFFLINE',
      updatedAt: new Date().toISOString(),
      mpvInstalled: this.availabilityCache.installed,
      processState: 'failed',
      pid: pid > 0 ? pid : null,
      lastExitCode: session.lastExitCode,
      lastError: session.lastError ?? session.lastStderr ?? null,
      message: 'Playback stopped',
    });
  }

  private async attachSessionWindow(session: SessionRecord) {
    if (!session.process.pid || !this.isProcessActive(session.process)) {
      return;
    }

    const maxRetries = 15;
    const retryDelayMs = 200;
    let updated = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (this.sessions.get(session.sessionId) !== session || !this.isProcessActive(session.process) || session.expectedExit) {
        // Session was stopped or replaced in the meantime, abort attaching
        return;
      }

      if (attempt > 1) {
        await this.logger?.info('[mpv-attach-trace] retry', {
          sessionId: session.sessionId,
          cameraId: session.camera.id,
          attempt,
        });
      }

      if (session.hidden) {
        updated = await this.updateNativeWindow(session.process.pid, {
          action: 'hide',
          clickThrough: session.surface === 'wall',
          title: session.title,
          ...(session.ownerNativeWindowHandle !== undefined ? { ownerHandle: session.ownerNativeWindowHandle } : {}),
        });
      } else {
        updated = await this.updateNativeWindow(session.process.pid, {
          action: 'move',
          bounds: session.bounds,
          clickThrough: session.surface === 'wall',
          title: session.title,
          ...(session.ownerNativeWindowHandle !== undefined ? { ownerHandle: session.ownerNativeWindowHandle } : {}),
        });
      }

      if (updated) {
        await this.logger?.info('[mpv-attach-trace] success', {
          sessionId: session.sessionId,
          cameraId: session.camera.id,
          attempts: attempt,
          hidden: session.hidden,
        });
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }

    if (this.sessions.get(session.sessionId) !== session || !this.isProcessActive(session.process) || session.expectedExit) {
      return;
    }

    if (updated) {
      // Clear startupTimer if it exists
      if (session.startupTimer) {
        clearTimeout(session.startupTimer);
        session.startupTimer = undefined;
      }

      session.processState = 'running';

      if (session.hidden) {
        await this.logger?.info('[mpv-layout] attached hidden session', {
          sessionId: session.sessionId,
          cameraId: session.camera.id,
        });

        this.updateState({
          sessionId: session.sessionId,
          cameraId: session.camera.id,
          cameraName: session.camera.name,
          surface: session.surface,
          status: 'LIVE',
          updatedAt: new Date().toISOString(),
          mpvInstalled: this.availabilityCache.installed,
          processState: 'running',
          pid: session.process.pid ?? null,
          lastError: null,
          message: 'Stream running (hidden)',
        });
      } else {
        await this.logger?.info('[mpv-layout] applied bounds', {
          sessionId: session.sessionId,
          cameraId: session.camera.id,
          x: session.bounds.x,
          y: session.bounds.y,
          width: session.bounds.width,
          height: session.bounds.height,
        });

        this.updateState({
          sessionId: session.sessionId,
          cameraId: session.camera.id,
          cameraName: session.camera.name,
          surface: session.surface,
          status: 'LIVE',
          updatedAt: new Date().toISOString(),
          mpvInstalled: this.availabilityCache.installed,
          processState: 'running',
          pid: session.process.pid ?? null,
          lastError: null,
          message: 'Stream running',
        });
      }
      return;
    }

    await this.logger?.error('[mpv-session] window attach failed; stopping session', {
      sessionId: session.sessionId,
      cameraId: session.camera.id,
      title: session.title,
      surface: session.surface,
    });
    await this.cleanupFailedAttach(session);
  }

  private async updateSessionBounds(session: SessionRecord, bounds: AbsoluteBounds) {
    if (!session.process.pid || !this.isProcessActive(session.process)) {
      return;
    }

    if (session.surface === 'wall' && this.isFocusSessionActive()) {
      await this.logger?.warn('[mpv-layout] ignored stale surface owner', {
        sessionId: session.sessionId,
        cameraId: session.camera.id,
        reason: 'focus session is active',
      });
      return;
    }

    if (session.hidden) {
      await this.logger?.warn('[mpv-layout] ignored stale surface owner', {
        sessionId: session.sessionId,
        cameraId: session.camera.id,
        reason: 'session is hidden',
      });
      return;
    }

    const updated = await this.updateNativeWindow(session.process.pid, {
      action: 'move',
      bounds,
      clickThrough: session.surface === 'wall',
      title: session.title,
      ...(session.ownerNativeWindowHandle !== undefined ? { ownerHandle: session.ownerNativeWindowHandle } : {}),
    });

    if (!updated) {
      await this.logger?.warn('[mpv-attach-trace] failed but process kept alive', {
        sessionId: session.sessionId,
        cameraId: session.camera.id,
        title: session.title,
        surface: session.surface,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
      return;
    }

    await this.logger?.info('[mpv-layout] applied bounds', {
      sessionId: session.sessionId,
      cameraId: session.camera.id,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });

    await this.logger?.info('[mpv-session] updated window bounds without restart.', {
      sessionId: session.sessionId,
      cameraId: session.camera.id,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }

  private async setSessionVisibility(session: SessionRecord, visible: boolean) {
    if (!session.process.pid || !this.isProcessActive(session.process)) {
      return;
    }

    const updated = await this.updateNativeWindow(session.process.pid, {
      action: visible ? 'show' : 'hide',
      clickThrough: session.surface === 'wall',
      title: session.title,
      ...(session.ownerNativeWindowHandle !== undefined ? { ownerHandle: session.ownerNativeWindowHandle } : {}),
    });

    if (updated) {
      session.hidden = !visible;
    }
  }

  private async configureSessionWindow(session: SessionRecord) {
    if (!session.process.pid || !this.isProcessActive(session.process)) {
      return;
    }

    const updated = await this.updateNativeWindow(session.process.pid, {
      action: 'configure',
      clickThrough: session.surface === 'wall',
      title: session.title,
      ...(session.ownerNativeWindowHandle !== undefined ? { ownerHandle: session.ownerNativeWindowHandle } : {}),
    });

    if (!updated) {
      await this.logger?.error('[mpv-session] window attach failed; stopping session', {
        sessionId: session.sessionId,
        cameraId: session.camera.id,
        title: session.title,
        surface: session.surface,
      });
      await this.cleanupFailedAttach(session);
    }
  }

  private async updateNativeWindow(
    pid: number,
    input:
      | { action: 'hide' | 'show' | 'configure'; clickThrough: boolean; ownerHandle?: string; title: string }
      | {
          action: 'move';
          bounds: AbsoluteBounds;
          clickThrough: boolean;
          ownerHandle?: string;
          title: string;
        },
  ) {
    if (process.platform !== 'win32' || pid <= 0) {
      return false;
    }

    const script = `
& {
$ErrorActionPreference = 'Stop'
param(
  [int]$Pid,
  [string]$Action,
  [bool]$ClickThrough,
  [string]$OwnerHandle,
  [string]$Title,
  [int]$X,
  [int]$Y,
  [int]$Width,
  [int]$Height
)
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;
public static class NativeWindowOps {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern int GetWindowTextLengthW(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
  public static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
  public const uint SWP_NOMOVE = 0x0002;
  public const uint SWP_NOSIZE = 0x0001;
  public const uint SWP_NOACTIVATE = 0x0010;
  public const uint SWP_NOOWNERZORDER = 0x0200;
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }
  public sealed class WindowCandidate {
    public IntPtr Handle;
    public bool Visible;
    public int WindowWidth;
    public int WindowHeight;
    public int ClientWidth;
    public int ClientHeight;
    public int TitleLength;
    public string Title;
  }
}
"@
$script:candidates = New-Object 'System.Collections.Generic.List[NativeWindowOps+WindowCandidate]'
$callback = [NativeWindowOps+EnumWindowsProc]{
  param([IntPtr]$hWnd, [IntPtr]$lParam)
  [uint32]$procId = 0
  [NativeWindowOps]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
  if ($procId -eq $Pid) {
    $windowRect = New-Object NativeWindowOps+RECT
    $clientRect = New-Object NativeWindowOps+RECT
    [void][NativeWindowOps]::GetWindowRect($hWnd, [ref]$windowRect)
    [void][NativeWindowOps]::GetClientRect($hWnd, [ref]$clientRect)
    $candidate = New-Object NativeWindowOps+WindowCandidate
    $candidate.Handle = $hWnd
    $candidate.Visible = [NativeWindowOps]::IsWindowVisible($hWnd)
    $candidate.WindowWidth = [Math]::Max(0, $windowRect.Right - $windowRect.Left)
    $candidate.WindowHeight = [Math]::Max(0, $windowRect.Bottom - $windowRect.Top)
    $candidate.ClientWidth = [Math]::Max(0, $clientRect.Right - $clientRect.Left)
    $candidate.ClientHeight = [Math]::Max(0, $clientRect.Bottom - $clientRect.Top)
    $candidate.TitleLength = [NativeWindowOps]::GetWindowTextLengthW($hWnd)
    if ($candidate.TitleLength -gt 0) {
      $titleBuffer = New-Object System.Text.StringBuilder ($candidate.TitleLength + 1)
      [void][NativeWindowOps]::GetWindowTextW($hWnd, $titleBuffer, $titleBuffer.Capacity)
      $candidate.Title = $titleBuffer.ToString()
    } else {
      $candidate.Title = ''
    }
    $script:candidates.Add($candidate) | Out-Null
  }
  return $true
}
[NativeWindowOps]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
if ($script:candidates.Count -eq 0) { exit 2 }
$script:target = $script:candidates |
  Where-Object { $_.Title -like "*$Title*" } |
  Where-Object {
    $_.Visible -and
    ($_.TitleLength -gt 0 -or ($_.WindowWidth -ge 64 -and $_.WindowHeight -ge 64) -or ($_.ClientWidth -ge 64 -and $_.ClientHeight -ge 64))
  } |
  Sort-Object -Property @{Expression = { [Math]::Max($_.ClientWidth * $_.ClientHeight, $_.WindowWidth * $_.WindowHeight) }} -Descending |
  Select-Object -First 1
if (-not $script:target) {
  $script:target = $script:candidates |
    Where-Object { $_.Title -like "*$Title*" } |
    Sort-Object -Property @{Expression = { [Math]::Max($_.ClientWidth * $_.ClientHeight, $_.WindowWidth * $_.WindowHeight) }} -Descending |
    Select-Object -First 1
}
if (-not $script:target) {
  $script:target = $script:candidates |
    Sort-Object -Property @{Expression = { [Math]::Max($_.ClientWidth * $_.ClientHeight, $_.WindowWidth * $_.WindowHeight) }} -Descending |
    Select-Object -First 1
}
if (-not $script:target) { exit 2 }
$GWL_EXSTYLE = -20
$GWL_HWNDPARENT = -8
$WS_EX_TRANSPARENT = 0x20
$WS_EX_LAYERED = 0x80000
$WS_EX_NOACTIVATE = 0x8000000
$WS_EX_TOOLWINDOW = 0x80
$targetHandle = $script:target.Handle
$style = [NativeWindowOps]::GetWindowLongPtr($targetHandle, $GWL_EXSTYLE).ToInt64()
if ($Action -eq 'hide' -or $ClickThrough) {
  $nextStyle = $style -bor $WS_EX_LAYERED -bor $WS_EX_TRANSPARENT -bor $WS_EX_NOACTIVATE -bor $WS_EX_TOOLWINDOW
} else {
  $nextStyle = ((($style -bor $WS_EX_LAYERED) -band (-bnot $WS_EX_TRANSPARENT)) -band (-bnot $WS_EX_NOACTIVATE)) -bor $WS_EX_TOOLWINDOW
}
[NativeWindowOps]::SetWindowLongPtr($targetHandle, $GWL_EXSTYLE, [IntPtr]$nextStyle) | Out-Null
if ($OwnerHandle) {
  $ownerValue = [Int64]::Parse($OwnerHandle)
  [NativeWindowOps]::SetWindowLongPtr($targetHandle, $GWL_HWNDPARENT, [IntPtr]$ownerValue) | Out-Null
}
switch ($Action) {
  'hide' { [NativeWindowOps]::ShowWindow($targetHandle, 0) | Out-Null }
  'show' {
    [NativeWindowOps]::ShowWindow($targetHandle, 5) | Out-Null
    [NativeWindowOps]::SetWindowPos($targetHandle, [NativeWindowOps]::HWND_NOTOPMOST, 0, 0, 0, 0, [NativeWindowOps]::SWP_NOMOVE -bor [NativeWindowOps]::SWP_NOSIZE -bor [NativeWindowOps]::SWP_NOACTIVATE -bor [NativeWindowOps]::SWP_NOOWNERZORDER) | Out-Null
  }
  'configure' {
    [NativeWindowOps]::ShowWindow($targetHandle, 5) | Out-Null
    [NativeWindowOps]::SetWindowPos($targetHandle, [NativeWindowOps]::HWND_NOTOPMOST, 0, 0, 0, 0, [NativeWindowOps]::SWP_NOMOVE -bor [NativeWindowOps]::SWP_NOSIZE -bor [NativeWindowOps]::SWP_NOACTIVATE -bor [NativeWindowOps]::SWP_NOOWNERZORDER) | Out-Null
  }
  'move' {
    [NativeWindowOps]::ShowWindow($targetHandle, 5) | Out-Null
    [NativeWindowOps]::MoveWindow($targetHandle, $X, $Y, $Width, $Height, $true) | Out-Null
    [NativeWindowOps]::SetWindowPos($targetHandle, [NativeWindowOps]::HWND_NOTOPMOST, 0, 0, 0, 0, [NativeWindowOps]::SWP_NOMOVE -bor [NativeWindowOps]::SWP_NOSIZE -bor [NativeWindowOps]::SWP_NOACTIVATE -bor [NativeWindowOps]::SWP_NOOWNERZORDER) | Out-Null
  }
}
exit 0
}
`;

    const args = ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script, String(pid), input.action, input.clickThrough ? '$true' : '$false', input.ownerHandle ?? '', input.title];
    if (input.action === 'move') {
      args.push(String(Math.round(input.bounds.x)));
      args.push(String(Math.round(input.bounds.y)));
      args.push(String(Math.round(input.bounds.width)));
      args.push(String(Math.round(input.bounds.height)));
    } else {
      args.push('0', '0', '0', '0');
    }

    return new Promise<boolean>((resolve) => {
      const child = spawn('powershell', args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      child.once('error', () => resolve(false));
      child.once('exit', (code) => resolve(code === 0));
    });
  }

  private async terminateTrackedProcess(
    pid: number,
    sessionId: string,
    cameraId: string,
    reason = 'unknown',
    caller = 'terminateTrackedProcess',
    ownerWebContentsId?: number,
  ) {
    if (pid <= 0) {
      return true;
    }

    await this.logger?.warn('[mpv-kill-trace]', {
      sessionId,
      cameraId,
      pid,
      reason,
      caller,
      ownerWebContentsId: ownerWebContentsId ?? null,
      stack: this.buildTraceStack(),
    });

    await killProcessTree(pid, this.logger);
    if (await this.waitForProcessExit(pid, 2500)) {
      await this.logger?.info('[mpv-cleanup] killed pid', {
        sessionId,
        cameraId,
        pid,
      });
      return true;
    }

    await this.logger?.warn('[mpv-session] process still alive after first taskkill; retrying.', {
      sessionId,
      cameraId,
      pid,
    });

    await killProcessTree(pid, this.logger);
    const exited = await this.waitForProcessExit(pid, 2500);

    if (!exited) {
      await this.logger?.error('[mpv-session] process remained alive after repeated taskkill.', {
        sessionId,
        cameraId,
        pid,
      });
    } else {
      await this.logger?.info('[mpv-cleanup] killed pid', {
        sessionId,
        cameraId,
        pid,
      });
    }

    return exited;
  }

  private async waitForProcessExit(pid: number, timeoutMs: number) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (!(await this.isProcessRunning(pid))) {
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return !(await this.isProcessRunning(pid));
  }

  private async isProcessRunning(pid: number) {
    if (pid <= 0) {
      return false;
    }

    if (process.platform === 'win32') {
      return new Promise<boolean>((resolve) => {
        const child = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        let output = '';
        child.stdout?.on('data', (chunk) => {
          output += chunk.toString('utf8');
        });

        child.once('error', () => resolve(false));
        child.once('exit', (code) => {
          if (code !== 0) {
            resolve(false);
            return;
          }

          resolve(output.toLowerCase().includes('mpv'));
        });
      });
    }

    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private async isTrackedMpvProcess(pid: number) {
    if (pid <= 0) {
      return false;
    }

    const executable = process.platform === 'win32' ? 'tasklist' : 'ps';
    const args = process.platform === 'win32' ? ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'] : ['-p', String(pid), '-o', 'comm='];

    return new Promise<boolean>((resolve) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      let output = '';
      child.stdout?.on('data', (chunk) => {
        output += chunk.toString('utf8');
      });

      child.once('error', () => resolve(false));
      child.once('exit', (code) => {
        if (code !== 0) {
          resolve(false);
          return;
        }

        const normalized = output.toLowerCase();
        resolve(normalized.includes('mpv'));
      });
    });
  }
}
