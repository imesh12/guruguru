import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { DesktopFileLogger } from './file-logger.js';
import { CAMERA_STATUS_CHANGED, PLACE_MARKERS_CHANGED } from './ipc.js';
import { MediaMtxManager } from './mediamtx-manager.js';
import { MpvManager } from './mpv-manager.js';
import type { CameraLayoutSync, CameraPlaybackConfig, CameraRecord, CameraSessionState, RelativeBounds } from './camera-types.js';
import { createWindowManager } from './window-manager.js';
import {
  DEFAULT_PLACE_MARKER_ICON_ID,
  isPlaceMarkerIconId,
  type PlaceMarker,
  type PlaceMarkerInput,
} from '../shared/place-markers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const resolveRepoRoot = () => {
  const searchRoots = [__dirname, process.cwd()];

  for (const start of searchRoots) {
    let current = path.resolve(start);
    while (true) {
      const workspacePath = path.join(current, 'pnpm-workspace.yaml');
      const envPath = path.join(current, '.env');
      const packageJsonPath = path.join(current, 'package.json');
      if (existsSync(workspacePath) && existsSync(envPath) && existsSync(packageJsonPath)) {
        return current;
      }

      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return path.resolve(__dirname, '../../../..');
};

const repoRoot = resolveRepoRoot();
const envFilePath = path.join(repoRoot, '.env');
const envLoadStatus = {
  loaded: false,
  path: envFilePath,
  reason: existsSync(envFilePath) ? undefined : 'not found',
};

const stripOptionalQuotes = (value: string) => value.replace(/^['"]+|['"]+$/g, '').trim();
const redactSecrets = (value: string) => value.replace(/(rtsp:\/\/[^:\s]+:)([^@]+)(@)/giu, '$1***$3');

const applyEnvFileOverrides = (filePath: string) => {
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key) {
      continue;
    }

    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = stripOptionalQuotes(rawValue);
  }
};

try {
  if (existsSync(envFilePath)) {
    process.loadEnvFile?.(envFilePath);
    applyEnvFileOverrides(envFilePath);
    envLoadStatus.loaded = true;
  }
} catch (error) {
  envLoadStatus.reason = error instanceof Error ? error.message : String(error);
}

const resolveAppDataDir = () => {
  const value = process.env.APP_DATA_DIR?.trim() || path.join(repoRoot, 'data');
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
};

const electronUserDataDir = process.env.ELECTRON_USER_DATA_DIR || path.join(resolveAppDataDir(), 'electron-user-data');
const electronCacheDir = process.env.ELECTRON_CACHE_DIR || path.join(resolveAppDataDir(), 'electron-cache');
const electronApp = app as typeof app & {
  setPath(name: 'cache', filePath: string): void;
  getPath(name: 'cache'): string;
};

mkdirSync(electronUserDataDir, { recursive: true });
mkdirSync(electronCacheDir, { recursive: true });

app.setPath('userData', electronUserDataDir);
electronApp.setPath('cache', electronCacheDir);

const placeMarkersFilePath = path.join(electronUserDataDir, 'place-markers.json');

const isValidPlaceMarker = (value: unknown): value is PlaceMarker => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.latitude === 'number' &&
    Number.isFinite(candidate.latitude) &&
    candidate.latitude >= -90 &&
    candidate.latitude <= 90 &&
    typeof candidate.longitude === 'number' &&
    Number.isFinite(candidate.longitude) &&
    candidate.longitude >= -180 &&
    candidate.longitude <= 180 &&
    typeof candidate.markerIconId === 'string' &&
    isPlaceMarkerIconId(candidate.markerIconId) &&
    (typeof candidate.description === 'string' || typeof candidate.description === 'undefined') &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
};

const readPlaceMarkersFromDisk = () => {
  try {
    if (!existsSync(placeMarkersFilePath)) {
      return [] as PlaceMarker[];
    }

    const raw = readFileSync(placeMarkersFilePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as PlaceMarker[];
    }

    return parsed.filter(isValidPlaceMarker).sort((left, right) => left.title.localeCompare(right.title, 'ja'));
  } catch {
    return [] as PlaceMarker[];
  }
};

const writePlaceMarkersToDisk = (placeMarkers: PlaceMarker[]) => {
  mkdirSync(path.dirname(placeMarkersFilePath), { recursive: true });
  writeFileSync(placeMarkersFilePath, `${JSON.stringify(placeMarkers, null, 2)}\n`, 'utf8');
};

const normalizePlaceMarkerInput = (payload: PlaceMarkerInput) => {
  const title = payload.title.trim();
  if (!title) {
    throw new Error('場所名を入力してください。');
  }

  if (!Number.isFinite(payload.latitude) || payload.latitude < -90 || payload.latitude > 90) {
    throw new Error('緯度は -90 から 90 の範囲で入力してください。');
  }

  if (!Number.isFinite(payload.longitude) || payload.longitude < -180 || payload.longitude > 180) {
    throw new Error('経度は -180 から 180 の範囲で入力してください。');
  }

  if (!isPlaceMarkerIconId(payload.markerIconId ?? DEFAULT_PLACE_MARKER_ICON_ID)) {
    throw new Error('マーカーを選択してください。');
  }

  const description = payload.description?.trim();

  return {
    title,
    latitude: payload.latitude,
    longitude: payload.longitude,
    markerIconId: payload.markerIconId,
    description: description ? description : undefined,
  } satisfies PlaceMarkerInput;
};

const bootstrap = async () => {
  app.setName('Kurukuru Monitor');

  const desktopLog = new DesktopFileLogger('desktop');
  const logWallDebugMain = (message: string, details?: Record<string, unknown>) => {
    console.info(message, details ?? {});
    void desktopLog.info(message, details ?? {});
  };
  const warnWallDebugMain = (message: string, details?: Record<string, unknown>) => {
    console.info(message, details ?? {});
    void desktopLog.warn(message, details ?? {});
  };
  const errorWallDebugMain = (message: string, details?: Record<string, unknown>) => {
    console.info(message, details ?? {});
    void desktopLog.error(message, details ?? {});
  };
  await desktopLog.info('Desktop bootstrap started.');
  await desktopLog.info('Environment file load status.', {
    loaded: envLoadStatus.loaded,
    path: envLoadStatus.path,
    reason: envLoadStatus.reason,
  });
  await desktopLog.info('Electron runtime paths configured.', {
    repoRoot,
    appDataDir: resolveAppDataDir(),
    userDataDir: app.getPath('userData'),
    cacheDir: electronApp.getPath('cache'),
  });

  if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
    const warning =
      process.env.NODE_ENV === 'production'
        ? 'CREDENTIAL_ENCRYPTION_KEY is not set. Camera passwords remain plaintext at rest until a key is configured.'
        : 'CREDENTIAL_ENCRYPTION_KEY is not set. Development mode will keep supporting plaintext camera passwords.';
    console.warn(warning);
    await desktopLog.warn(warning);
  }

  const apiBaseUrl = process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000';
  const rendererBaseUrl = process.env.ELECTRON_RENDERER_URL?.trim() || null;
  const wallPlaybackProvider = process.env.VITE_WALL_PLAYBACK_PROVIDER === 'mpv' ? 'mpv' : 'webrtc';
  const apiToken = process.env.API_TOKEN?.trim();
  const isPackagedApp = app.isPackaged;
  const API_HEALTH_PATH = '/health';
  const API_REQUEST_TIMEOUT_MS = 5000;
  const API_READY_RETRY_DELAY_MS = 1500;
  let apiReadyWaitPromise: Promise<boolean> | null = null;
  let activeRecoveryAction:
    | 'restart-api'
    | 'restart-desktop'
    | 'restart-mpv'
    | 'clear-stale-mpv'
    | 'reconnect-cameras'
    | 'export-diagnostics'
    | null = null;
  const apiHeaders = (headers?: HeadersInit, hasBody = false) => {
    const nextHeaders = new Headers(headers);

    if (hasBody && !nextHeaders.has('content-type')) {
      nextHeaders.set('content-type', 'application/json');
    }

    if (apiToken) {
      nextHeaders.set('Authorization', `Bearer ${apiToken}`);
    }

    return nextHeaders;
  };

  const isApiUnavailableError = (error: unknown) => {
    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();
    return (
      message.includes('fetch failed') ||
      message.includes('failed to fetch') ||
      message.includes('econnrefused') ||
      message.includes('connect') ||
      message.includes('timed out') ||
      message.includes('socket')
    );
  };

  const fetchWithTimeout = async (input: string, init?: RequestInit) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${API_REQUEST_TIMEOUT_MS}ms`)), API_REQUEST_TIMEOUT_MS);

    try {
      return await fetch(input, {
        ...init,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  const isRendererReady = async (timeoutMs = 5000) => {
    if (!rendererBaseUrl) {
      return true;
    }

    try {
      const response = await fetchWithTimeout(rendererBaseUrl, {
        method: 'GET',
      });
      return response.ok;
    } catch {
      return false;
    }
  };

  const waitForApiReady = async (reason: string, timeoutMs = 15000) => {
    if (apiReadyWaitPromise) {
      return apiReadyWaitPromise;
    }

    apiReadyWaitPromise = (async () => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        try {
          const response = await fetchWithTimeout(`${apiBaseUrl}${API_HEALTH_PATH}`, {
            headers: apiHeaders(),
          });
          if (response.ok) {
            await desktopLog.info('[api-readiness] API became ready.', { reason, apiBaseUrl });
            return true;
          }

          await desktopLog.warn('[api-readiness] Health check returned non-OK status.', {
            reason,
            status: response.status,
          });
        } catch (error) {
          await desktopLog.warn('[api-readiness] Waiting for local API.', {
            reason,
            apiBaseUrl,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        await new Promise((resolve) => setTimeout(resolve, API_READY_RETRY_DELAY_MS));
      }

      await desktopLog.warn('[api-readiness] API did not become ready before timeout.', {
        reason,
        apiBaseUrl,
        timeoutMs,
      });
      return false;
    })().finally(() => {
      apiReadyWaitPromise = null;
    });

    return apiReadyWaitPromise;
  };

  const fetchJson = async <T>(input: string, init?: RequestInit): Promise<T> => {
    const execute = async () => {
      const headers = apiHeaders(init?.headers, Boolean(init?.body));

      if (input === '/vehicles') {
        console.info('[desktop-api-debug] request', {
          path: input,
          hasAuthorization: headers.has('Authorization'),
        });
      }

      const response = await fetchWithTimeout(`${apiBaseUrl}${input}`, {
        ...init,
        headers,
      });

      if (!response.ok) {
        const rawBody = (await response.text()).trim();
        let message = rawBody || `HTTP ${response.status}`;
        try {
          const parsed = rawBody ? (JSON.parse(rawBody) as { message?: string }) : null;
          if (parsed?.message) {
            message = parsed.message;
          }
        } catch {
          // Keep the response text when it is not JSON.
        }
        const method = init?.method ?? 'GET';
        throw new Error(`${method} ${input} failed: ${message}`);
      }

      return (await response.json()) as T;
    };

    try {
      return await execute();
    } catch (error) {
      if (!isApiUnavailableError(error)) {
        throw error;
      }

      await waitForApiReady(`retry ${init?.method ?? 'GET'} ${input}`);
      return await execute();
    }
  };
  const fetchVehicles = async () => {
    const body = await fetchJson<{ vehicles: Array<{ id: string; name: string; displayColor: string; enabled: boolean }> }>('/vehicles');
    return body.vehicles;
  };
  const fetchCameras = async () => {
    const body = await fetchJson<{
      cameras: Array<{
        id: string;
        vehicleId: string;
        vehicleName: string;
        name: string;
        type: 'FRONT' | 'INTERNAL';
        vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
        host: string | null;
        rtspPort: number | null;
        customRtspUrl: string | null;
        qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
        rtspUrl: string | null;
        username: string | null;
        hasSavedPassword: boolean;
        enabled: boolean;
        bitrateLimit: number | null;
      }>;
    }>('/cameras');
    return body.cameras;
  };
  const fetchPlaybackConfig = async (cameraId: string) => {
    const body = await fetchJson<{ camera: CameraPlaybackConfig }>(`/cameras/${cameraId}/playback-config`);
    return body.camera;
  };
  const fetchRuntimePlaybackConfig = async (cameraId: string) => {
    const body = await fetchJson<{ camera: CameraPlaybackConfig & {
      auth: {
        username: string | null;
        password: string | null;
        usernameExists: boolean;
        passwordExists: boolean;
      };
    } }>(`/cameras/${cameraId}/runtime-playback-config`);
    return body.camera;
  };
  const mediaMtxConfigPath = path.join(repoRoot, 'mediamtx', 'mediamtx.yml');
  const MEDIA_MTX_SYNC_DEBOUNCE_MS = 250;
  let mediaMtxSyncPromise: Promise<void> | null = null;
  let mediaMtxSyncTimer: NodeJS.Timeout | null = null;
  let mediaMtxSyncQueuedPromise: Promise<void> | null = null;
  let resolveMediaMtxSyncQueue: (() => void) | null = null;
  const pendingMediaMtxSyncReasons = new Set<string>();
  const toYamlScalar = (value: string) => `'${value.replace(/'/g, "''")}'`;
  const buildMediaMtxConfig = (configs: Array<{ streamPath: string; rtspUrl: string }>) => {
    const lines = [
      'logLevel: info',
      'logDestinations: [stdout]',
      '',
      'rtsp: yes',
      'rtspAddress: 127.0.0.1:8554',
      'webrtc: yes',
      'webrtcAddress: 127.0.0.1:8889',
      'webrtcAdditionalHosts: [127.0.0.1, localhost]',
      'webrtcIPsFromInterfaces: no',
      'hls: yes',
      'hlsAddress: 127.0.0.1:8888',
      'api: yes',
      'apiAddress: 127.0.0.1:9997',
      '',
      'pathDefaults:',
      '  rtspTransport: tcp',
      '  sourceOnDemand: yes',
      '  sourceOnDemandStartTimeout: 10s',
      '  sourceOnDemandCloseAfter: 10s',
      '',
      'paths:',
    ];

    if (configs.length === 0) {
      lines.push('  all_others:');
      lines.push('    source: publisher');
      return `${lines.join('\n')}\n`;
    }

    configs
      .slice()
      .sort((left, right) => left.streamPath.localeCompare(right.streamPath))
      .forEach((config) => {
        lines.push(`  ${config.streamPath}:`);
        lines.push(`    source: ${toYamlScalar(config.rtspUrl)}`);
      });

    return `${lines.join('\n')}\n`;
  };
  const readMediaMtxConfig = () => {
    if (!existsSync(mediaMtxConfigPath)) {
      return null;
    }

    return readFileSync(mediaMtxConfigPath, 'utf8');
  };
  const mediaMtxManager = new MediaMtxManager(desktopLog, repoRoot, mediaMtxConfigPath);
  const pruneRendererSessionStates = (validCameraIds: Iterable<string>) => {
    const validIds = new Set(validCameraIds);
    let removedCount = 0;

    for (const [sessionKey, status] of rendererSessionStates.entries()) {
      if (!validIds.has(status.cameraId)) {
        rendererSessionStates.delete(sessionKey);
        removedCount += 1;
      }
    }

    return removedCount;
  };
  const syncMediaMtxConfig = async (reason: string) => {
    if (wallPlaybackProvider !== 'webrtc') {
      await desktopLog.info('[mediamtx] sync skipped for mpv wall provider', {
        reason,
        wallPlaybackProvider,
      });
      return;
    }

    if (mediaMtxSyncPromise) {
      await mediaMtxSyncPromise;
      return;
    }

    mediaMtxSyncPromise = (async () => {
      try {
        const cameras = await fetchCameras();
        const enabledCameras = cameras.filter((camera) => camera.enabled);
        pruneRendererSessionStates(enabledCameras.map((camera) => camera.id));
        const runtimeConfigs = await Promise.all(enabledCameras.map(async (camera) => fetchRuntimePlaybackConfig(camera.id)));
        const validConfigs = runtimeConfigs
          .map((config) => {
            if (!config.enabled || !config.streamPath || !config.rtspUrl || !config.webrtcUrl || config.error) {
              return null;
            }

            return {
              cameraId: config.cameraId,
              streamPath: config.streamPath,
              rtspUrl: config.rtspUrl,
              webrtcUrl: config.webrtcUrl,
            };
          })
          .filter((config): config is { cameraId: string; streamPath: string; rtspUrl: string; webrtcUrl: string } => Boolean(config));

        const nextConfigContent = buildMediaMtxConfig(
          validConfigs.map((config) => ({
            streamPath: config.streamPath,
            rtspUrl: config.rtspUrl,
          })),
        );
        const currentConfigContent = readMediaMtxConfig();
        const configChanged = currentConfigContent !== nextConfigContent;

        mkdirSync(path.dirname(mediaMtxConfigPath), { recursive: true });
        mediaMtxManager.setTrackedPaths(validConfigs.map((config) => ({
          cameraId: config.cameraId,
          streamPath: config.streamPath,
          webrtcUrl: config.webrtcUrl,
        })));

        if (configChanged) {
          writeFileSync(mediaMtxConfigPath, nextConfigContent, 'utf8');
          const maskedConfig = redactSecrets(nextConfigContent);

          await desktopLog.info('[mediamtx] config synced', {
            reason,
            pathCount: validConfigs.length,
            configPath: mediaMtxConfigPath,
          });
          await desktopLog.info('[mediamtx] generated config', {
            reason,
            configPath: mediaMtxConfigPath,
            config: maskedConfig,
          });

          validConfigs.forEach((config) => {
            logWallDebugMain('[mediamtx] path configured', {
              cameraId: config.cameraId,
              streamPath: config.streamPath,
              webrtcUrl: config.webrtcUrl,
              whepDebugCommand: `curl -v -X POST -H "Content-Type: application/sdp" --data-binary @offer.sdp ${config.webrtcUrl}`,
            });
          });

          await mediaMtxManager.restart(`config-sync:${reason}`);
          await mediaMtxManager.waitForConfiguredPaths(7000);
          return;
        }

        await desktopLog.info('[mediamtx] config unchanged, skipping rewrite', {
          reason,
          pathCount: validConfigs.length,
          configPath: mediaMtxConfigPath,
        });

        if (!mediaMtxManager.isRunning()) {
          await mediaMtxManager.start(`config-sync:${reason}`);
          await mediaMtxManager.waitForConfiguredPaths(7000);
        }
      } catch (error) {
        await desktopLog.error('[mediamtx] config sync failed', {
          reason,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        mediaMtxSyncPromise = null;
      }
    })();

    await mediaMtxSyncPromise;
  };
  const flushQueuedMediaMtxSync = async () => {
    if (mediaMtxSyncTimer) {
      clearTimeout(mediaMtxSyncTimer);
      mediaMtxSyncTimer = null;
    }

    while (mediaMtxSyncPromise) {
      await mediaMtxSyncPromise;
    }

    while (pendingMediaMtxSyncReasons.size > 0) {
      const reasons = Array.from(pendingMediaMtxSyncReasons);
      pendingMediaMtxSyncReasons.clear();
      await syncMediaMtxConfig(reasons.join(','));
    }

    resolveMediaMtxSyncQueue?.();
    resolveMediaMtxSyncQueue = null;
    mediaMtxSyncQueuedPromise = null;
  };
  const queueMediaMtxConfigSync = (reason: string) => {
    if (wallPlaybackProvider !== 'webrtc') {
      return Promise.resolve();
    }

    pendingMediaMtxSyncReasons.add(reason);
    if (!mediaMtxSyncQueuedPromise) {
      mediaMtxSyncQueuedPromise = new Promise<void>((resolve) => {
        resolveMediaMtxSyncQueue = resolve;
      });
    }

    if (mediaMtxSyncTimer) {
      clearTimeout(mediaMtxSyncTimer);
    }

    mediaMtxSyncTimer = setTimeout(() => {
      void flushQueuedMediaMtxSync();
    }, MEDIA_MTX_SYNC_DEBOUNCE_MS);

    return mediaMtxSyncQueuedPromise;
  };
  const fetchLayouts = async () => {
    const body = await fetchJson<{
      layouts: Array<{
        id: string;
        name: string;
        active: boolean;
        updatedAt: string;
        slots: Array<{
          id: string;
          slotIndex: number;
          cameraId: string | null;
          cameraName: string | null;
          cameraType: 'FRONT' | 'INTERNAL' | null;
          vehicleName: string | null;
        }>;
      }>;
    }>('/layouts');
    return body.layouts;
  };
  const fetchActiveLayout = async () => {
    try {
      const body = await fetchJson<{
        layout: {
          id: string;
          name: string;
          active: boolean;
          updatedAt: string;
          slots: Array<{
            id: string;
            slotIndex: number;
            cameraId: string | null;
            cameraName: string | null;
            cameraType: 'FRONT' | 'INTERNAL' | null;
            vehicleName: string | null;
          }>;
        };
      }>('/layouts/active');
      return body.layout;
    } catch (error) {
      if (error instanceof Error && error.message.includes('GET /layouts/active failed: No active layout found')) {
        return null;
      }
      throw error;
    }
  };
  const reportCameraStatus = async (state: {
    cameraId: string;
    status: 'LIVE' | 'RECONNECTING' | 'OFFLINE';
    message?: string | undefined;
    updatedAt: string;
  }) => {
    try {
      await fetch(`${apiBaseUrl}/system/camera-status`, {
        method: 'POST',
        headers: apiHeaders(undefined, true),
        body: JSON.stringify({
          cameraId: state.cameraId,
          status: state.status,
          message: state.message,
          timestamp: state.updatedAt,
        }),
      });
    } catch {
      // The operator desktop should keep running even when the API is unavailable.
    }
  };
  const mpvManager = new MpvManager(reportCameraStatus, desktopLog, path.join(resolveAppDataDir(), 'mpv-sessions.json'));
  const rendererSessionStates = new Map<string, CameraSessionState>();
  const clearCameraRuntimeState = async (cameraId: string) => {
    rendererSessionStates.delete(`wall:${cameraId}`);
    rendererSessionStates.delete(`focus:${cameraId}`);
    await mpvManager.stopSession(`wall:${cameraId}`, 'shutdown');
    await mpvManager.stopSession(`focus:${cameraId}`, 'shutdown');
  };
  const mergeCameraStatuses = () => {
    const merged = new Map<string, CameraSessionState>();

    for (const status of mpvManager.getStatuses()) {
      merged.set(`${status.surface}:${status.cameraId}`, status);
    }

    for (const status of rendererSessionStates.values()) {
      merged.set(`${status.surface}:${status.cameraId}`, status);
    }

    return Array.from(merged.values()).sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  };
  await mpvManager.cleanupPersistedSessions();
  void waitForApiReady('desktop bootstrap');
  void queueMediaMtxConfigSync('bootstrap');
  const closingWebContentsIds = new Set<number>();
  const syncLayoutDebounceTimers = new Map<string, NodeJS.Timeout>();
  const syncLayoutLatestPayloads = new Map<string, CameraLayoutSync>();
  const windows = createWindowManager({
    logger: desktopLog,
    openDevTools: process.env.ELECTRON_OPEN_DEVTOOLS === 'true',
    onVideoWallClosing: async (window) => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        closingWebContentsIds.add(window.webContents.id);
        await mpvManager.stopOwnedSurface('wall', window.webContents.id, 'shutdown');
      }
    },
    onVideoWallClosed: async (webContentsId) => {
      await desktopLog.info('[window-lifecycle] video wall closed, stopping wall surface');
      if (typeof webContentsId === 'number') {
        closingWebContentsIds.add(webContentsId);
        await mpvManager.stopOwnedSurface('wall', webContentsId, 'shutdown');
      }
      await mpvManager.stopSurface('wall', 'shutdown');
    },
    onVideoWallMinimized: async () => {
      await desktopLog.info('[window-lifecycle] video wall minimized, hiding wall surface');
      await mpvManager.hideSurface('wall');
    },
    onVideoWallRestored: async () => {
      await desktopLog.info('[window-lifecycle] video wall restored, showing wall surface');
      await mpvManager.showSurface('wall');
    },
    onCameraClosing: async (cameraId, webContentsId) => {
      closingWebContentsIds.add(webContentsId);
      await mpvManager.stopOwnedSurface('focus', webContentsId, 'shutdown');
      await mpvManager.stopSession(`focus:${cameraId}`, 'shutdown');
    },
    onCameraClosed: async (cameraId, webContentsId) => {
      closingWebContentsIds.add(webContentsId);
      const sessionId = `focus:${cameraId}`;
      await desktopLog.info(`[window-lifecycle] camera focus closed, stopping session ${sessionId}`);
      await mpvManager.stopOwnedSurface('focus', webContentsId, 'shutdown');
      await mpvManager.stopSession(sessionId, 'shutdown');
    },
  });

  const broadcastStatuses = () => {
    const payload = mergeCameraStatuses();
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed()) {
        continue;
      }
      const webContents = window.webContents;
      if (webContents.isDestroyed()) {
        continue;
      }
      try {
        webContents.send(CAMERA_STATUS_CHANGED, payload);
      } catch (error) {
        void desktopLog.warn('Skipped broadcasting camera statuses to a destroyed window.', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const broadcastPlaceMarkers = (payload = readPlaceMarkersFromDisk()) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) {
        continue;
      }

      try {
        window.webContents.send(PLACE_MARKERS_CHANGED, payload);
      } catch (error) {
        void desktopLog.warn('Skipped broadcasting place markers to a destroyed window.', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  mpvManager.on('status-changed', broadcastStatuses);

  const sendDesktopHeartbeat = async () => {
    try {
      const gpuFeatureStatus = app.getGPUFeatureStatus?.();
      const heartbeatPayload = {
        timestamp: new Date().toISOString(),
        mpvProcessCount: mpvManager.getProcessCount?.() ?? 0,
        gpuAvailable: gpuFeatureStatus?.gpu_compositing !== undefined
          ? gpuFeatureStatus.gpu_compositing !== 'disabled'
          : false,
        gpuStatus: gpuFeatureStatus?.gpu_compositing ?? 'Unavailable',
      };

      const response = await fetch(`${apiBaseUrl}/system/heartbeat`, {
        method: 'POST',
        headers: apiHeaders(undefined, true),
        body: JSON.stringify(heartbeatPayload),
      });

      if (!response.ok) {
        const responseBody = (await response.text()).trim();
        console.error('[desktop-heartbeat] request failed', {
          status: response.status,
          body: responseBody,
        });
      }
    } catch {
      // Heartbeats are best-effort only.
    }
  };

  const heartbeatTimer = setInterval(() => {
    void sendDesktopHeartbeat();
  }, 5000);
  void sendDesktopHeartbeat();

  ipcMain.handle('window:open-video-wall', async () => {
    windows.openVideoWall();
  });

  ipcMain.handle('window:open-map', async () => {
    windows.openMap();
  });

  ipcMain.handle('window:open-system-status', async () => {
    windows.openSystemStatus();
  });

  ipcMain.handle('window:open-camera-popup', async (_, cameraId: string) => {
    await mpvManager.stopSession(`focus:${cameraId}`, 'restart');
    try {
      const camera = await fetchPlaybackConfig(cameraId);
      windows.openCamera(cameraId, `${camera.name} Player`);
    } catch {
      windows.openCamera(cameraId, 'Camera Player');
    }
  });

  ipcMain.handle('place-marker:list', async () => readPlaceMarkersFromDisk());
  ipcMain.handle('place-marker:create', async (_, payload: PlaceMarkerInput) => {
    const normalized = normalizePlaceMarkerInput(payload);
    const now = new Date().toISOString();
    const placeMarkers = readPlaceMarkersFromDisk();
    const nextMarker: PlaceMarker = {
      id: randomUUID(),
      title: normalized.title,
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      markerIconId: normalized.markerIconId,
      description: normalized.description,
      createdAt: now,
      updatedAt: now,
    };

    const nextPlaceMarkers = [...placeMarkers, nextMarker];
    writePlaceMarkersToDisk(nextPlaceMarkers);
    broadcastPlaceMarkers(nextPlaceMarkers);
    return nextMarker;
  });
  ipcMain.handle('place-marker:update', async (_, payload: PlaceMarkerInput & { id: string }) => {
    const normalized = normalizePlaceMarkerInput(payload);
    const placeMarkers = readPlaceMarkersFromDisk();
    const index = placeMarkers.findIndex((placeMarker) => placeMarker.id === payload.id);
    if (index < 0) {
      throw new Error('対象の場所マーカーが見つかりません。');
    }

    const current = placeMarkers[index]!;
    const updatedMarker: PlaceMarker = {
      id: current.id,
      createdAt: current.createdAt,
      title: normalized.title,
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      markerIconId: normalized.markerIconId,
      description: normalized.description,
      updatedAt: new Date().toISOString(),
    };

    const nextPlaceMarkers = placeMarkers.slice();
    nextPlaceMarkers[index] = updatedMarker;
    writePlaceMarkersToDisk(nextPlaceMarkers);
    broadcastPlaceMarkers(nextPlaceMarkers);
    return updatedMarker;
  });
  ipcMain.handle('place-marker:delete', async (_, placeMarkerId: string) => {
    const placeMarkers = readPlaceMarkersFromDisk();
    const nextPlaceMarkers = placeMarkers.filter((placeMarker) => placeMarker.id !== placeMarkerId);
    if (nextPlaceMarkers.length === placeMarkers.length) {
      throw new Error('対象の場所マーカーが見つかりません。');
    }

    writePlaceMarkersToDisk(nextPlaceMarkers);
    broadcastPlaceMarkers(nextPlaceMarkers);
    return { status: 'ok' };
  });

  ipcMain.handle('camera:list', async () => fetchCameras());
  ipcMain.handle('camera:get-playback-config', async (_, cameraId: string) => fetchPlaybackConfig(cameraId));
  ipcMain.handle('camera:get-runtime-playback-config', async (_, cameraId: string) => {
    const { auth: _auth, ...camera } = await fetchRuntimePlaybackConfig(cameraId);
    if (wallPlaybackProvider === 'webrtc') {
      void queueMediaMtxConfigSync(`runtime-playback-config:${cameraId}`);
    }
    return camera;
  });
  ipcMain.handle('vehicle:list', async () => fetchVehicles());
  ipcMain.handle('vehicle:create', async (_, payload: { name: string; displayColor: string; enabled: boolean }) => {
    const body = await fetchJson<{ vehicle: { id: string; name: string; displayColor: string; enabled: boolean } }>('/vehicles', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return body.vehicle;
  });
  ipcMain.handle('vehicle:update', async (_, payload: { id: string; name: string; displayColor: string; enabled: boolean }) => {
    const body = await fetchJson<{ vehicle: { id: string; name: string; displayColor: string; enabled: boolean } }>(`/vehicles/${payload.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: payload.name,
        displayColor: payload.displayColor,
        enabled: payload.enabled,
      }),
    });
    return body.vehicle;
  });
  ipcMain.handle('vehicle:delete', async (_, vehicleId: string) => {
    const body = await fetchJson<{ status: string }>(`/vehicles/${vehicleId}`, {
      method: 'DELETE',
    });
    return body;
  });
  ipcMain.handle('camera:create', async (_, payload: {
    vehicleId: string;
    name: string;
    type: 'FRONT' | 'INTERNAL';
    vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
    host: string | null;
    rtspPort: number | null;
    customRtspUrl: string | null;
    qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
    username: string | null;
    password: string | null;
    enabled: boolean;
    bitrateLimit: number | null;
  }) => {
    const body = await fetchJson<{ camera: {
      id: string;
      vehicleId: string;
      vehicleName: string;
      name: string;
      type: 'FRONT' | 'INTERNAL';
      vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
      host: string | null;
      rtspPort: number | null;
      customRtspUrl: string | null;
      qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
      rtspUrl: string | null;
      username: string | null;
      hasSavedPassword: boolean;
      enabled: boolean;
      bitrateLimit: number | null;
    } }>('/cameras', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await queueMediaMtxConfigSync(`camera:create:${body.camera.id}`);
    return body.camera;
  });
  ipcMain.handle('camera:update', async (_, payload: {
    id: string;
    vehicleId: string;
    name: string;
    type: 'FRONT' | 'INTERNAL';
    vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
    host: string | null;
    rtspPort: number | null;
    customRtspUrl: string | null;
    qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
    username: string | null;
    password: string | null;
    enabled: boolean;
    bitrateLimit: number | null;
  }) => {
    const body = await fetchJson<{ camera: {
      id: string;
      vehicleId: string;
      vehicleName: string;
      name: string;
      type: 'FRONT' | 'INTERNAL';
      vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
      host: string | null;
      rtspPort: number | null;
      customRtspUrl: string | null;
      qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
      rtspUrl: string | null;
      username: string | null;
      hasSavedPassword: boolean;
      enabled: boolean;
      bitrateLimit: number | null;
    } }>(`/cameras/${payload.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        vehicleId: payload.vehicleId,
        name: payload.name,
        type: payload.type,
        vendor: payload.vendor,
        host: payload.host,
        rtspPort: payload.rtspPort,
        customRtspUrl: payload.customRtspUrl,
        qualityPreset: payload.qualityPreset,
        username: payload.username,
        password: payload.password,
        enabled: payload.enabled,
        bitrateLimit: payload.bitrateLimit,
      }),
    });
    await queueMediaMtxConfigSync(`camera:update:${body.camera.id}`);
    return body.camera;
  });
  ipcMain.handle('camera:delete', async (_, cameraId: string) => {
    await clearCameraRuntimeState(cameraId);
    const body = await fetchJson<{ status: string }>(`/cameras/${cameraId}`, {
      method: 'DELETE',
    });
    await queueMediaMtxConfigSync(`camera:delete:${cameraId}`);
    broadcastStatuses();
    return body;
  });
  ipcMain.handle('layout:list', async () => fetchLayouts());
  ipcMain.handle('layout:get-active', async () => fetchActiveLayout());
  ipcMain.handle('layout:create', async (_, payload: { name: string; slots: Array<{ slotIndex: number; cameraId: string | null }> }) => {
    const body = await fetchJson<{ layout: {
      id: string;
      name: string;
      active: boolean;
      updatedAt: string;
      slots: Array<{
        id: string;
        slotIndex: number;
        cameraId: string | null;
        cameraName: string | null;
        cameraType: 'FRONT' | 'INTERNAL' | null;
        vehicleName: string | null;
      }>;
    } }>('/layouts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return body.layout;
  });
  ipcMain.handle('layout:update', async (_, payload: { id: string; name: string; slots: Array<{ slotIndex: number; cameraId: string | null }> }) => {
    const body = await fetchJson<{ layout: {
      id: string;
      name: string;
      active: boolean;
      updatedAt: string;
      slots: Array<{
        id: string;
        slotIndex: number;
        cameraId: string | null;
        cameraName: string | null;
        cameraType: 'FRONT' | 'INTERNAL' | null;
        vehicleName: string | null;
      }>;
    } }>(`/layouts/${payload.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: payload.name,
        slots: payload.slots,
      }),
    });
    return body.layout;
  });
  ipcMain.handle('layout:delete', async (_, layoutId: string) => {
    const body = await fetchJson<{ status: string }>(`/layouts/${layoutId}`, {
      method: 'DELETE',
    });
    return body;
  });
  ipcMain.handle('layout:activate', async (_, layoutId: string) => {
    const body = await fetchJson<{ layout: {
      id: string;
      name: string;
      active: boolean;
      updatedAt: string;
      slots: Array<{
        id: string;
        slotIndex: number;
        cameraId: string | null;
        cameraName: string | null;
        cameraType: 'FRONT' | 'INTERNAL' | null;
        vehicleName: string | null;
      }>;
    } }>(`/layouts/${layoutId}/activate`, {
      method: 'POST',
    });
    return body.layout;
  });
  ipcMain.handle('camera:resolve-rtsp', async (_, payload: {
    vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
    host: string | null;
    rtspPort: number | null;
    customRtspUrl: string | null;
    qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
    username: string | null;
    password: string | null;
  }) => {
    return fetchJson<{ rtspUrl: string | null; sanitizedRtspUrl: string | null; error: string | null; source: 'custom' | 'vendor' }>('/cameras/resolve-rtsp', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  });
  ipcMain.handle('camera:status:list', async () => mergeCameraStatuses());
  ipcMain.handle('camera:report-session-state', async (_, state: CameraSessionState) => {
    rendererSessionStates.set(`${state.surface}:${state.cameraId}`, state);
    if (state.provider === 'webrtc') {
      if (state.status === 'LIVE') {
        logWallDebugMain('[webrtc-status] camera live', {
          cameraId: state.cameraId,
          cameraName: state.cameraName,
          surface: state.surface,
          updatedAt: state.updatedAt,
        });
      } else if (state.status === 'OFFLINE') {
        warnWallDebugMain('[webrtc-status] camera offline', {
          cameraId: state.cameraId,
          cameraName: state.cameraName,
          surface: state.surface,
          updatedAt: state.updatedAt,
          lastError: state.lastError ?? null,
        });
      }

      await reportCameraStatus({
        cameraId: state.cameraId,
        status: state.status,
        message: state.lastError ?? state.message,
        updatedAt: state.updatedAt,
      });
    }

    broadcastStatuses();
    return mergeCameraStatuses();
  });
  ipcMain.handle('mpv:get-availability', async () => mpvManager.getAvailability());
  ipcMain.on('wall:debug-log', (event, payload: { message?: string; details?: Record<string, unknown> }) => {
    logWallDebugMain(payload.message ?? '[wall-debug] renderer log', {
      senderWebContentsId: event.sender.id,
      ...(payload.details ?? {}),
    });
  });
  ipcMain.handle('mpv:restart-camera', async (_, cameraId: string) => {
    await mpvManager.restartCamera(cameraId);
    return mpvManager.getStatuses();
  });
  ipcMain.handle('mpv:stop-camera', async (_, cameraId: string) => {
    await mpvManager.stopCamera(cameraId);
    return mpvManager.getStatuses();
  });
  ipcMain.handle('mpv:test-camera', async (_, camera) => mpvManager.testCamera(camera));
  ipcMain.handle('mpv:stop-session', async (_, sessionId: string) => {
    await mpvManager.stopSession(sessionId);
    return mpvManager.getStatuses();
  });
  ipcMain.handle('mpv:hide-session', async (_, sessionId: string) => {
    await mpvManager.hideSession(sessionId);
    return mpvManager.getStatuses();
  });
  ipcMain.handle('mpv:show-session', async (_, sessionId: string) => {
    await mpvManager.showSession(sessionId);
    return mpvManager.getStatuses();
  });
  ipcMain.handle('mpv:stop-surface', async (event, surface: 'wall' | 'focus') => {
    logWallDebugMain('[mpv-kill-trace] renderer requested stop surface', {
      senderWebContentsId: event.sender.id,
      surface,
      senderDestroyed: event.sender.isDestroyed(),
      stack: new Error().stack,
    });
    if (!event.sender.isDestroyed()) {
      await mpvManager.stopOwnedSurface(surface, event.sender.id, 'shutdown');
      if (surface === 'wall') {
        await mpvManager.stopSurface(surface, 'shutdown');
      }
      return mpvManager.getStatuses();
    }

    await mpvManager.stopSurface(surface, 'shutdown');
    return mpvManager.getStatuses();
  });
  ipcMain.handle('mpv:sync-layout', async (event, payload: CameraLayoutSync) => {
    const sessionId = payload.surface === 'wall' ? `wall:${payload.cameraId}` : `focus:${payload.cameraId}`;
    syncLayoutLatestPayloads.set(sessionId, payload);
    const existingDebounce = syncLayoutDebounceTimers.get(sessionId);
    if (existingDebounce) {
      clearTimeout(existingDebounce);
    }

    return await new Promise<CameraSessionState[]>((resolve) => {
      const timer = setTimeout(() => {
        syncLayoutDebounceTimers.delete(sessionId);
        const latestPayload = syncLayoutLatestPayloads.get(sessionId) ?? payload;
        syncLayoutLatestPayloads.delete(sessionId);
        void (async () => {
          const result = await (async () => {
    logWallDebugMain('[wall-debug] main mpv:sync-layout entry', {
      senderWebContentsId: event.sender.id,
      senderDestroyed: event.sender.isDestroyed(),
      cameraId: latestPayload.cameraId,
      surface: latestPayload.surface,
      bounds: latestPayload.bounds,
    });

    if (event.sender.isDestroyed()) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout skipped because sender is destroyed', {
        senderWebContentsId: event.sender.id,
        cameraId: latestPayload.cameraId,
        surface: latestPayload.surface,
      });
      return mpvManager.getStatuses();
    }

    let ownerWindow: BrowserWindow | null = null;

    try {
      ownerWindow = BrowserWindow.fromWebContents(event.sender);
    } catch (error) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout BrowserWindow lookup failed', {
        senderWebContentsId: event.sender.id,
        cameraId: latestPayload.cameraId,
        surface: latestPayload.surface,
        error: error instanceof Error ? error.message : String(error),
      });
      return mpvManager.getStatuses();
    }

    if (closingWebContentsIds.has(event.sender.id) && ownerWindow && !ownerWindow.isDestroyed()) {
      closingWebContentsIds.delete(event.sender.id);
      logWallDebugMain('[wall-debug] main removed stale closing sender id', {
        senderWebContentsId: event.sender.id,
        cameraId: latestPayload.cameraId,
        surface: latestPayload.surface,
      });
    }

    const isClosingSender = closingWebContentsIds.has(event.sender.id);
    logWallDebugMain('[wall-debug] main closingWallWebContentsIds check', {
      senderWebContentsId: event.sender.id,
      surface: latestPayload.surface,
      isClosingWallSender: isClosingSender,
      closingCount: closingWebContentsIds.size,
    });

    if (isClosingSender) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout skipped because wall sender is closing', {
        senderWebContentsId: event.sender.id,
        cameraId: latestPayload.cameraId,
      });
      return mpvManager.getStatuses();
    }

    let camera: Awaited<ReturnType<typeof fetchRuntimePlaybackConfig>>;
    try {
      camera = await fetchRuntimePlaybackConfig(latestPayload.cameraId);
    } catch (error) {
      errorWallDebugMain('[wall-debug] main runtime-playback-config fetch failed', {
        cameraId: latestPayload.cameraId,
        surface: latestPayload.surface,
        error: error instanceof Error ? error.message : String(error),
      });
      return mpvManager.getStatuses();
    }

    logWallDebugMain('[wall-debug] main runtime-playback-config fetched', {
      cameraId: camera.id,
      host: camera.host,
      rtspPort: camera.rtspPort,
      vendor: camera.vendor,
      enabled: camera.enabled,
      usernameExists: camera.auth.usernameExists,
      passwordExists: camera.auth.passwordExists,
      rtspUrl: camera.sanitizedRtspUrl,
      error: camera.error,
    });

    if (camera.error) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout skipped because camera.error is set', {
        cameraId: camera.id,
        surface: latestPayload.surface,
        error: camera.error,
      });
      return mpvManager.getStatuses();
    }

    if (!camera.enabled) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout skipped because camera is disabled', {
        cameraId: camera.id,
        surface: latestPayload.surface,
      });
      return mpvManager.getStatuses();
    }

    if (!camera.rtspUrl) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout skipped because camera rtspUrl is missing', {
        cameraId: camera.id,
        surface: latestPayload.surface,
      });
      return mpvManager.getStatuses();
    }

    logWallDebugMain('[camera-runtime-playback] preparing mpv session', {
      cameraId: camera.id,
      host: camera.host,
      usernameExists: camera.auth.usernameExists,
      passwordExists: camera.auth.passwordExists,
      rtspUrl: camera.sanitizedRtspUrl,
      error: camera.error,
    });

    const cameraRecord: CameraRecord = {
      id: camera.id,
      vehicleId: camera.vehicleId,
      vehicleName: camera.vehicleName,
      name: camera.name,
      type: camera.type,
      vendor: camera.vendor,
      host: camera.host,
      rtspPort: camera.rtspPort,
      customRtspUrl: camera.customRtspUrl,
      qualityPreset: camera.qualityPreset,
      rtspUrl: camera.rtspUrl,
      enabled: camera.enabled,
      bitrateLimit: camera.bitrateLimit,
      username: camera.auth.username,
      password: camera.auth.password,
    };

    if (event.sender.isDestroyed()) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout skipped because sender was destroyed after config fetch', {
        senderWebContentsId: event.sender.id,
        cameraId: latestPayload.cameraId,
        surface: latestPayload.surface,
      });
      return mpvManager.getStatuses();
    }

    if (!ownerWindow) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout skipped because BrowserWindow is null', {
        senderWebContentsId: event.sender.id,
        cameraId: latestPayload.cameraId,
        surface: latestPayload.surface,
      });
      return mpvManager.getStatuses();
    }

    if (!ownerWindow || ownerWindow.isDestroyed()) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout skipped because BrowserWindow is destroyed', {
        senderWebContentsId: event.sender.id,
        cameraId: latestPayload.cameraId,
        surface: latestPayload.surface,
      });
      return mpvManager.getStatuses();
    }

    let bounds: Electron.Rectangle;
    try {
      bounds = ownerWindow.getContentBounds();
    } catch (error) {
      warnWallDebugMain('[wall-debug] main mpv:sync-layout skipped because owner bounds lookup failed', {
        senderWebContentsId: event.sender.id,
        cameraId: latestPayload.cameraId,
        surface: latestPayload.surface,
        error: error instanceof Error ? error.message : String(error),
      });
      return mpvManager.getStatuses();
    }

    const absoluteBounds = relativeToAbsoluteBounds(ownerWindow, latestPayload.bounds, bounds);

    logWallDebugMain('[wall-debug] main calling mpvManager.syncSession', {
      sessionId,
      senderWebContentsId: event.sender.id,
      cameraId: latestPayload.cameraId,
      surface: latestPayload.surface,
      absoluteBounds,
    });

    await mpvManager.syncSession({
      sessionId,
      surface: latestPayload.surface,
      camera: cameraRecord,
      bounds: absoluteBounds,
      ownerWindowId: ownerWindow.id,
      ownerWebContentsId: event.sender.id,
      ownerNativeWindowHandle: nativeWindowHandleToString(ownerWindow),
    });

    logWallDebugMain('[wall-debug] main mpvManager.syncSession completed', {
      sessionId,
      senderWebContentsId: event.sender.id,
      cameraId: latestPayload.cameraId,
      surface: latestPayload.surface,
    });

    return mpvManager.getStatuses();
          })();
          resolve(result);
        })();
      }, 150);

      syncLayoutDebounceTimers.set(sessionId, timer);
    });
  });

  ipcMain.handle('system:run-recovery-action', async (_, action: 'restart-api' | 'restart-desktop' | 'restart-mpv' | 'clear-stale-mpv' | 'reconnect-cameras' | 'export-diagnostics') => {
    if (activeRecoveryAction) {
      return {
        success: false,
        message: `Another recovery action is already running: ${activeRecoveryAction}`,
      };
    }

    activeRecoveryAction = action;
    try {
      await desktopLog.warn('[recovery] action requested', {
        action,
        packaged: isPackagedApp,
      });

      if (action === 'restart-mpv') {
        await mpvManager.restartAllSessions();
        broadcastStatuses();
        await desktopLog.warn('Recovery action completed.', { action });
        return { success: true, message: 'Restarted active mpv sessions.' };
      }

      if (action === 'clear-stale-mpv') {
        mpvManager.clearStaleSessions();
        broadcastStatuses();
        await desktopLog.warn('Recovery action completed.', { action });
        return { success: true, message: 'Cleared stale mpv sessions.' };
      }

      if (action === 'reconnect-cameras') {
        await mpvManager.reconnectAllCameras();
        broadcastStatuses();
        await desktopLog.warn('Recovery action completed.', { action });
        return { success: true, message: 'Reconnect requested for all cameras.' };
      }

      if (action === 'restart-desktop') {
        await desktopLog.warn('[recovery] restart-desktop requested', {
          packaged: isPackagedApp,
          rendererBaseUrl,
        });

        if (!isPackagedApp) {
          const rendererReady = await isRendererReady();
          if (!rendererReady) {
            await desktopLog.error('[recovery] dev reload renderer failed', {
              reason: 'renderer-not-reachable',
              rendererBaseUrl,
            });
            windows.openControl();
            return {
              success: false,
              message: 'Development renderer is not reachable. Keep the current window open and restart the desktop dev process from the terminal if needed.',
            };
          }

          try {
            await desktopLog.info('[recovery] dev reload renderer', {
              rendererBaseUrl,
            });
            await windows.reloadControlWindow();
            return {
              success: true,
              message: 'Desktop renderer reloaded safely in development mode.',
            };
          } catch (error) {
            await desktopLog.error('[recovery] dev reload renderer failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            windows.openControl();
            return {
              success: false,
              message: error instanceof Error ? error.message : 'Development renderer reload failed.',
            };
          }
        }

        await desktopLog.warn('[recovery] packaged relaunch app', {
          packaged: isPackagedApp,
        });
        app.relaunch();
        app.exit(0);
        return { success: true, message: 'Desktop relaunch requested.' };
      }

      if (action === 'export-diagnostics') {
        const response = await fetchWithTimeout(`${apiBaseUrl}/system/diagnostics/export`, {
          method: 'POST',
          headers: apiHeaders(),
        });
        if (!response.ok) {
          throw new Error(`Diagnostics export failed with ${response.status}`);
        }

        const body = (await response.json()) as { bundlePath: string; zipped: boolean };
        await desktopLog.info('Diagnostics export completed.', body as unknown as Record<string, unknown>);
        return {
          success: true,
          message: body.zipped ? `Diagnostics bundle exported to ${body.bundlePath}` : `Diagnostics files prepared at ${body.bundlePath}`,
        };
      }

      if (action === 'restart-api') {
        if (!isPackagedApp) {
          await desktopLog.warn('[recovery] restart-api skipped in development', {
            action,
          });
          return {
            success: true,
            message: 'Development mode does not auto-restart the API. Restart it from the terminal with: corepack pnpm --filter @kurukuru-monitor/api dev',
          };
        }

        if (process.platform === 'linux') {
          const child = spawn('systemctl', ['restart', 'kurukuru-api.service'], {
            stdio: 'ignore',
            detached: true,
          });
          child.unref();
          await desktopLog.warn('Recovery action started.', { action });
          return { success: true, message: 'API restart command sent to systemctl.' };
        }

        return { success: false, message: 'API restart is only supported on Ubuntu service deployments.' };
      }

      return { success: false, message: 'Unknown recovery action.' };
    } catch (error) {
      await desktopLog.error('Recovery action failed.', {
        action,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      activeRecoveryAction = null;
    }
  });

  ipcMain.handle('system:get-api-security-config', () => ({
    apiToken: process.env.API_TOKEN ?? null,
  }));

  ipcMain.handle('system:get-runtime-config', () => ({
    demoMode: process.env.DEMO_MODE === 'true',
    apiBaseUrl: process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000',
    embeddedPlaybackPoc: process.env.EMBEDDED_PLAYBACK_POC === 'true',
  }));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windows.openControl();
    }
  });

  app.on('before-quit', () => {
    clearInterval(heartbeatTimer);
    void mediaMtxManager.stop('before-quit');
    mpvManager.shutdown();
    void desktopLog.info('Desktop shutting down.');
  });

  windows.openControl();
};

app.whenReady().then(bootstrap);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const relativeToAbsoluteBounds = (window: BrowserWindow, relative: RelativeBounds, container: Electron.Rectangle) => {
  const dipRect = {
    x: container.x + Math.round(relative.x),
    y: container.y + Math.round(relative.y),
    width: Math.max(320, Math.round(relative.width)),
    height: Math.max(180, Math.round(relative.height)),
  };
  const screenRect = screen.dipToScreenRect(window, dipRect);

  return {
    x: screenRect.x,
    y: screenRect.y,
    width: Math.max(320, screenRect.width),
    height: Math.max(180, screenRect.height),
  };
};

const nativeWindowHandleToString = (window: BrowserWindow) => {
  const handle = window.getNativeWindowHandle();
  if (handle.length >= 8) {
    return handle.readBigUInt64LE(0).toString();
  }
  if (handle.length >= 4) {
    return BigInt(handle.readUInt32LE(0)).toString();
  }
  return '';
};
