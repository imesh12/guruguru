import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CameraPlaybackConfig, CameraSessionState, CameraSummary, RelativeBounds } from '../../electron/camera-types';
import { CameraTile } from '../components/CameraTile';
import { EmbeddedCameraPlayer } from '../components/EmbeddedCameraPlayer';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';
import { getWallPlaybackProvider } from '../lib/stream-provider';
import type { LayoutAdmin } from '../types';

const CAMERA_REFRESH_INTERVAL = 2000;
const WALL_PADDING_PX = 8;
const WALL_GAP_PX = 6;
const WALL_ASPECT_RATIO = 16 / 9;
const WALL_DEBUG_ENABLED = ((import.meta as any).env?.VITE_WALL_DEBUG === 'true');
const WALL_SURFACE_STOP_GRACE_MS = 500;
const WALL_SLOT_REMOVAL_GRACE_MS = 500;

let activeWallPageInstances = 0;
let pendingWallSurfaceStopTimer: number | null = null;

type WallSlot = {
  slotIndex: number;
  camera: CameraSummary | null;
};

type DebugBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen: boolean;
};

type SentBounds = RelativeBounds;
type EmbeddedWallState = 'idle' | 'connecting' | 'live' | 'retrying' | 'error' | 'stopped';

type EmbeddedWallStatus = {
  state: EmbeddedWallState;
  error: string | null;
};

const WALL_PLAYBACK_PROVIDER = getWallPlaybackProvider();

export function VideoWallPage() {
  const { demoMode } = useRuntimeConfig();
  const [cameras, setCameras] = useState<CameraSummary[]>([]);
  const [activeLayout, setActiveLayout] = useState<LayoutAdmin | null>(null);
  const [cameraListLoaded, setCameraListLoaded] = useState(false);
  const [activeLayoutLoaded, setActiveLayoutLoaded] = useState(false);
  const [statuses, setStatuses] = useState<CameraSessionState[]>([]);
  const [mpvInstalled, setMpvInstalled] = useState(true);
  const [mpvAvailabilityChecked, setMpvAvailabilityChecked] = useState(false);
  const [apiOnline, setApiOnline] = useState(true);
  const [fullscreenCameraId, setFullscreenCameraId] = useState<string | null>(null);
  const [pendingReconnectIds, setPendingReconnectIds] = useState<string[]>([]);
  const [wallBounds, setWallBounds] = useState<{ width: number; height: number }>({ width: 1280, height: 720 });
  const [debugBounds, setDebugBounds] = useState<Record<string, DebugBounds>>({});
  const [pageStableForMpv, setPageStableForMpv] = useState(false);
  const [wallPlaybackConfigs, setWallPlaybackConfigs] = useState<Record<string, CameraPlaybackConfig | null>>({});
  const [wallPlaybackStates, setWallPlaybackStates] = useState<Record<string, EmbeddedWallStatus>>({});
  const [wallReconnectTokens, setWallReconnectTokens] = useState<Record<string, number>>({});
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const videoContainerRefs = useRef(new Map<string, HTMLDivElement>());
  const videoContainerRefCallbacks = useRef(new Map<string, (node: HTMLDivElement | null) => void>());
  const lastSentBoundsRef = useRef(new Map<string, SentBounds>());
  const sentInitialSyncRef = useRef(new Set<string>());
  const lastLoggedCameraSignatureRef = useRef<string | null>(null);
  const lastLoggedLayoutSignatureRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const syncRequestVersionRef = useRef(0);
  const syncWakeTimerRef = useRef<number | null>(null);
  const mpvStabilityTimerRef = useRef<number | null>(null);
  const pendingSlotRemovalTimersRef = useRef(new Map<string, number>());
  const cleanedRemovedWallSessionIdsRef = useRef(new Set<string>());
  const wallPlaybackLogSignaturesRef = useRef(new Map<string, string>());
  const wallStateLogSignaturesRef = useRef(new Map<string, string>());
  const wallUsesWebrtc = WALL_PLAYBACK_PROVIDER === 'webrtc';
  const logWallDebug = (message: string, details?: Record<string, unknown>) => {
    console.info(message, details ?? {});
    try {
      window.electronAPI?.wallDebugLog?.(message, details);
    } catch (error) {
      console.error('[wall-debug] renderer wallDebugLog failed', {
        message,
        details: details ?? {},
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const logWallCleanupTrace = useCallback((effectName: string, reason: string, details?: Record<string, unknown>) => {
    logWallDebug('[wall-cleanup-trace]', {
      effectName,
      reason,
      mountedRef: mountedRef.current,
      disposedRef: details?.disposedRef ?? null,
      webContentsId: 'renderer',
      stack: new Error().stack,
      ...(details ?? {}),
    });
  }, []);
  const requestWallSyncSoon = useCallback(() => {
    syncRequestVersionRef.current += 1;
    if (syncWakeTimerRef.current !== null) {
      window.clearTimeout(syncWakeTimerRef.current);
    }
    syncWakeTimerRef.current = window.setTimeout(() => {
      syncWakeTimerRef.current = null;
      window.dispatchEvent(new CustomEvent('kurukuru-wall-sync-request'));
    }, 0);
  }, []);
  const registerVideoContainer = useCallback((cameraId: string, slotIndex: number, node: HTMLDivElement | null) => {
    const current = videoContainerRefs.current.get(cameraId);

    if (node) {
      if (current === node) {
        return;
      }

      videoContainerRefs.current.set(cameraId, node);
      logWallDebug('[wall-debug] video ref registered', {
        cameraId,
        slotIndex,
      });
      requestWallSyncSoon();
      return;
    }

    if (!videoContainerRefs.current.has(cameraId)) {
      return;
    }

    videoContainerRefs.current.delete(cameraId);
    logWallDebug('[wall-debug] video ref removed', {
      cameraId,
      slotIndex,
    });
    logWallDebug('[mpv-manager] no kill during ref churn', {
      cameraId,
      slotIndex,
      reason: 'video ref removed while wall page remains mounted',
    });
    requestWallSyncSoon();
  }, [requestWallSyncSoon]);
  const getVideoContainerRef = useCallback((cameraId: string, slotIndex: number) => {
    const existing = videoContainerRefCallbacks.current.get(cameraId);
    if (existing) {
      return existing;
    }

    const callback = (node: HTMLDivElement | null) => {
      registerVideoContainer(cameraId, slotIndex, node);
    };
    videoContainerRefCallbacks.current.set(cameraId, callback);
    return callback;
  }, [registerVideoContainer]);

  useEffect(() => {
    activeWallPageInstances += 1;
    if (pendingWallSurfaceStopTimer !== null) {
      window.clearTimeout(pendingWallSurfaceStopTimer);
      pendingWallSurfaceStopTimer = null;
    }
    mountedRef.current = true;
    return () => {
      logWallCleanupTrace('mount', 'component unmount');
      activeWallPageInstances = Math.max(0, activeWallPageInstances - 1);
      mountedRef.current = false;
      sentInitialSyncRef.current.clear();
      lastSentBoundsRef.current.clear();
      wallPlaybackLogSignaturesRef.current.clear();
      wallStateLogSignaturesRef.current.clear();
      if (syncWakeTimerRef.current !== null) {
        window.clearTimeout(syncWakeTimerRef.current);
        syncWakeTimerRef.current = null;
      }
      if (mpvStabilityTimerRef.current !== null) {
        window.clearTimeout(mpvStabilityTimerRef.current);
        mpvStabilityTimerRef.current = null;
      }
      pendingSlotRemovalTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      pendingSlotRemovalTimersRef.current.clear();
      cleanedRemovedWallSessionIdsRef.current.clear();
    };
  }, [logWallCleanupTrace]);

  useEffect(() => {
    let disposed = false;

    const syncCameraList = async () => {
  try {
    const cameraResponse = await window.electronAPI.listCameras();
    const layoutResponse = await window.electronAPI.getActiveLayout();

    const cameraList: CameraSummary[] = Array.isArray(cameraResponse)
      ? cameraResponse
      : ((cameraResponse as any)?.cameras ?? []);

    const layout: LayoutAdmin | null =
      (layoutResponse as any)?.layout ?? layoutResponse ?? null;

    const layoutSlots = Array.isArray((layout as any)?.slots)
      ? (layout as LayoutAdmin).slots
      : [];

    if (disposed) return;
    if (!mountedRef.current) return;

    setApiOnline(true);
    setActiveLayout(layout);
    setCameras(cameraList);
    setActiveLayoutLoaded(true);
    setCameraListLoaded(true);

    const enabledCameraIds = cameraList
      .filter((camera) => camera.enabled)
      .map((camera) => camera.id)
      .sort();

    const assignedCameraIds = layoutSlots
      .map((slot) => slot.cameraId)
      .filter((cameraId): cameraId is string => Boolean(cameraId))
      .sort();

    const cameraSignature = enabledCameraIds.join('|');
    const layoutSignature = `${layout?.id ?? 'none'}:${assignedCameraIds.join('|')}`;
    const cameraSignatureChanged = lastLoggedCameraSignatureRef.current !== cameraSignature;
    const layoutSignatureChanged = lastLoggedLayoutSignatureRef.current !== layoutSignature;

    if (cameraSignatureChanged) {
      lastLoggedCameraSignatureRef.current = cameraSignature;
      logWallDebug('[wall-debug] listCameras success', {
        count: cameraList.length,
        enabledCameraIds,
      });
    }

    if (layoutSignatureChanged) {
      lastLoggedLayoutSignatureRef.current = layoutSignature;
      logWallDebug('[wall-debug] getActiveLayout success', {
        activeLayoutId: layout?.id ?? null,
        assignedCameraIds,
      });
    }

    if (cameraSignatureChanged || layoutSignatureChanged) {
      logWallDebug('[wall-debug] active layout/cameras loaded', {
        cameraCount: cameraList.length,
        activeLayoutId: layout?.id ?? null,
        assignedCameraIds,
      });
    }

    const selectedIds = new Set(assignedCameraIds);

    cameraList
      .filter((camera) => !selectedIds.has(camera.id) || !camera.enabled)
      .forEach((camera) => {
        if (!disposed && mountedRef.current) {
          void window.electronAPI.stopCamera(camera.id);
        }
      });
  } catch (error) {
    console.error('Failed to sync camera list', error);
    logWallDebug('[wall-debug] syncCameraList failure', {
      error: error instanceof Error ? error.message : String(error),
    });
    if (!disposed) {
      setApiOnline(false);
    }
  }
};

    const boot = async () => {
      try {
        logWallDebug('[wall-debug] boot start');
        const [initialStatuses, availability] = await Promise.all([window.electronAPI.listCameraStatuses(), window.electronAPI.getMpvAvailability()]);
        if (disposed) {
          return;
        }

        setStatuses(initialStatuses);
        logWallDebug('[wall-debug] listCameraStatuses success', {
          count: initialStatuses.length,
          wallCount: initialStatuses.filter((status) => status.surface === 'wall').length,
        });
        setMpvInstalled(availability.installed);
        setMpvAvailabilityChecked(true);
        setApiOnline(true);
        logWallDebug('[wall-debug] mpvInstalled', {
          installed: availability.installed,
          executable: availability.executable,
        });
        await syncCameraList();
        if (mpvStabilityTimerRef.current === null) {
          mpvStabilityTimerRef.current = window.setTimeout(() => {
            mpvStabilityTimerRef.current = null;
            if (!disposed && mountedRef.current) {
              setPageStableForMpv(true);
              logWallDebug('[wall-debug] page stable for mpv sync');
              requestWallSyncSoon();
            }
          }, 0);
        }
      } catch (error) {
        console.error('Failed to boot video wall page', error);
        logWallDebug('[wall-debug] boot failure', {
          error: error instanceof Error ? error.message : String(error),
        });
        if (!disposed) {
          setMpvAvailabilityChecked(true);
          setApiOnline(false);
        }
      }
    };

    void boot();

    const unsubscribe = window.electronAPI.onCameraStatusChanged((nextStatuses: CameraSessionState[]) => {
      if (!disposed) {
        setStatuses(nextStatuses);
      }
    });
    const refreshTimer = window.setInterval(() => {
      void syncCameraList();
    }, CAMERA_REFRESH_INTERVAL);

    return () => {
      disposed = true;
      logWallCleanupTrace('boot-and-polling', 'effect cleanup stopSurface wall', {
        disposedRef: disposed,
      });
      unsubscribe();
      window.clearInterval(refreshTimer);
      if (pendingWallSurfaceStopTimer !== null) {
        window.clearTimeout(pendingWallSurfaceStopTimer);
      }
      pendingWallSurfaceStopTimer = window.setTimeout(() => {
        pendingWallSurfaceStopTimer = null;
        if (activeWallPageInstances > 0) {
          logWallDebug('[mpv-manager] delayed stopSurface cancelled', {
            activeWallPageInstances,
          });
          return;
        }
        void window.electronAPI.stopSurface('wall');
      }, WALL_SURFACE_STOP_GRACE_MS);
    };
  }, [logWallCleanupTrace]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const previousRootOverflow = root?.style.overflow ?? '';
    const previousRootHeight = root?.style.height ?? '';
    const previousRootWidth = root?.style.width ?? '';

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (root) {
      root.style.overflow = 'hidden';
      root.style.height = '100%';
      root.style.width = '100%';
    }

    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      if (root) {
        root.style.overflow = previousRootOverflow;
        root.style.height = previousRootHeight;
        root.style.width = previousRootWidth;
      }
    };
  }, []);

  const wallStatuses = useMemo(() => {
    const map = new Map<string, CameraSessionState>();
    statuses
      .filter((status) => status.surface === 'wall')
      .forEach((status) => map.set(status.cameraId, status));
    return map;
  }, [statuses]);

  const wallStatusKey = useMemo(
    () =>
      statuses
        .filter((status) => status.surface === 'wall')
        .map((status) => `${status.cameraId}:${status.status}:${status.updatedAt}`)
        .sort()
        .join('|'),
    [statuses],
  );

  const wallSlots = useMemo<WallSlot[]>(() => {
    const cameraMap = new Map(cameras.map((camera) => [camera.id, camera]));
    const selected = activeLayout?.slots.slice().sort((left, right) => left.slotIndex - right.slotIndex) ?? [];
    return [1, 2, 3, 4].map((slotIndex) => {
      const slot = selected.find((entry) => entry.slotIndex === slotIndex);
      return {
        slotIndex,
        camera: slot?.cameraId ? cameraMap.get(slot.cameraId) ?? null : null,
      };
    });
  }, [activeLayout, cameras]);

  const fullscreenSlot = useMemo(
    () => wallSlots.find((slot) => slot.camera?.id === fullscreenCameraId) ?? null,
    [fullscreenCameraId, wallSlots],
  );

  const visibleSlots = useMemo(() => (fullscreenSlot?.camera ? [fullscreenSlot] : wallSlots), [fullscreenSlot, wallSlots]);
  const layoutPlayableSlots = useMemo(
    () => wallSlots.filter((slot): slot is { slotIndex: number; camera: CameraSummary } => Boolean(slot.camera?.enabled)),
    [wallSlots],
  );

  const wallTileStatuses = useMemo(() => {
    if (!wallUsesWebrtc) {
      const nextStatuses = new Map<string, CameraSessionState>();
      wallStatuses.forEach((status, cameraId) => {
        if (status.processState === 'running') {
          nextStatuses.set(cameraId, {
            ...status,
            status: 'LIVE',
            message: status.message === 'Playback stopped' ? 'Stream running' : (status.message ?? 'Stream running'),
          });
          return;
        }

        if (status.processState === 'starting') {
          nextStatuses.set(cameraId, {
            ...status,
            status: 'RECONNECTING',
            message: status.message ?? 'Connecting to RTSP stream...',
          });
          return;
        }

        nextStatuses.set(cameraId, status);
      });
      return nextStatuses;
    }

    const nextStatuses = new Map<string, CameraSessionState>();
    layoutPlayableSlots.forEach(({ camera }) => {
      const playbackState = wallPlaybackStates[camera.id];
      const status =
        playbackState?.state === 'live'
          ? 'LIVE'
          : playbackState && (playbackState.state === 'error' || playbackState.state === 'stopped')
            ? 'OFFLINE'
            : 'RECONNECTING';

      nextStatuses.set(camera.id, {
        sessionId: `wall:${camera.id}`,
        cameraId: camera.id,
        cameraName: camera.name,
        surface: 'wall',
        status,
        updatedAt: new Date().toISOString(),
        mpvInstalled,
        message: playbackState?.error ?? (status === 'RECONNECTING' ? 'Connecting to WebRTC stream...' : undefined),
      });
    });

    return nextStatuses;
  }, [layoutPlayableSlots, mpvInstalled, wallPlaybackStates, wallStatuses, wallUsesWebrtc]);

  const setWallPlaybackState = useCallback((camera: CameraSummary, state: EmbeddedWallState, error: string | null) => {
    const nextSignature = `${state}:${error ?? ''}`;
    if (wallPlaybackLogSignaturesRef.current.get(camera.id) !== nextSignature) {
      wallPlaybackLogSignaturesRef.current.set(camera.id, nextSignature);
      if (state === 'live') {
        logWallDebug('[webrtc-wall] connected', {
          cameraId: camera.id,
          streamPath: wallPlaybackConfigs[camera.id]?.streamPath ?? null,
          webrtcUrl: wallPlaybackConfigs[camera.id]?.webrtcUrl ?? null,
        });
      } else if (state === 'connecting' || state === 'retrying' || state === 'idle') {
        logWallDebug('[webrtc-wall] connecting', {
          cameraId: camera.id,
          state,
          streamPath: wallPlaybackConfigs[camera.id]?.streamPath ?? null,
          webrtcUrl: wallPlaybackConfigs[camera.id]?.webrtcUrl ?? null,
        });
      } else if (state === 'error' || state === 'stopped') {
        logWallDebug('[webrtc-wall] failed', {
          cameraId: camera.id,
          state,
          error,
          streamPath: wallPlaybackConfigs[camera.id]?.streamPath ?? null,
          webrtcUrl: wallPlaybackConfigs[camera.id]?.webrtcUrl ?? null,
        });
      }
    }

    setWallPlaybackStates((current) => {
      const previous = current[camera.id];
      if (previous?.state === state && previous?.error === error) {
        return current;
      }

      return {
        ...current,
        [camera.id]: {
          state,
          error,
        },
      };
    });
  }, [wallPlaybackConfigs]);

  useEffect(() => {
    if (wallUsesWebrtc) {
      return;
    }

    layoutPlayableSlots.forEach(({ camera }) => {
      const rawStatus = wallStatuses.get(camera.id);
      const effectiveStatus = wallTileStatuses.get(camera.id);
      const signature = `${rawStatus?.status ?? 'missing'}:${rawStatus?.processState ?? 'none'}:${effectiveStatus?.status ?? 'missing'}:${effectiveStatus?.processState ?? 'none'}:${effectiveStatus?.lastExitCode ?? 'none'}`;

      if (wallStateLogSignaturesRef.current.get(camera.id) === signature) {
        return;
      }
      wallStateLogSignaturesRef.current.set(camera.id, signature);

      if (rawStatus?.processState === 'running') {
        if (rawStatus.status === 'OFFLINE' || rawStatus.status === 'RECONNECTING') {
          logWallDebug('[wall-state] ignored offline because mpv provider owns state', {
            cameraId: camera.id,
            rawStatus: rawStatus.status,
            processState: rawStatus.processState,
          });
          logWallDebug('[wall-state] camera status ignored because mpv running', {
            cameraId: camera.id,
            rawStatus: rawStatus.status,
            processState: rawStatus.processState,
          });
        }
        logWallDebug('[wall-state] mpv running -> live', {
          cameraId: camera.id,
          pid: rawStatus.pid ?? null,
        });
        return;
      }

      if (rawStatus?.processState === 'failed' || rawStatus?.processState === 'exited') {
        logWallDebug('[wall-state] mpv exited -> offline', {
          cameraId: camera.id,
          processState: rawStatus.processState,
          lastExitCode: rawStatus.lastExitCode ?? null,
          lastError: rawStatus.lastError ?? null,
        });
      }
    });
  }, [layoutPlayableSlots, logWallDebug, wallStatuses, wallTileStatuses, wallUsesWebrtc]);

  useEffect(() => {
    if (!mountedRef.current) {
      return;
    }

    if (pendingReconnectIds.length === 0) {
      return;
    }

    setPendingReconnectIds((current) => {
      const next = current.filter((cameraId) => {
        const nextStatus = wallUsesWebrtc
          ? wallTileStatuses.get(cameraId)?.status
          : statuses.find((status) => status.surface === 'wall' && status.cameraId === cameraId)?.status;
        return nextStatus !== 'LIVE' && nextStatus !== 'RECONNECTING';
      });

      return next.length === current.length && next.every((cameraId, index) => cameraId === current[index]) ? current : next;
    });
  }, [pendingReconnectIds.length, statuses, wallStatusKey, wallTileStatuses, wallUsesWebrtc]);

  useEffect(() => {
    const wallCameraIds = new Set(wallSlots.map((slot) => slot.camera?.id).filter((cameraId): cameraId is string => Boolean(cameraId)));

    Array.from(lastSentBoundsRef.current.keys()).forEach((cameraId) => {
      if (!wallCameraIds.has(cameraId)) {
        lastSentBoundsRef.current.delete(cameraId);
        sentInitialSyncRef.current.delete(cameraId);
      }
    });
  }, [wallSlots]);

  useEffect(() => {
    sentInitialSyncRef.current.clear();
    lastSentBoundsRef.current.clear();
    if (mountedRef.current) {
      requestWallSyncSoon();
    }
  }, [fullscreenCameraId, requestWallSyncSoon]);

  useEffect(() => {
    if (fullscreenCameraId && !wallSlots.some((slot) => slot.camera?.id === fullscreenCameraId)) {
      setFullscreenCameraId(null);
    }
  }, [fullscreenCameraId, wallSlots]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreenCameraId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!wallUsesWebrtc) {
      return;
    }

    logWallCleanupTrace('provider-switch', 'webrtc provider requested wall stopSurface');
    void window.electronAPI.stopSurface('wall');
  }, [logWallCleanupTrace, wallUsesWebrtc]);

  useEffect(() => {
    if (!wallUsesWebrtc) {
      return;
    }

    let disposed = false;
    const activeWallCameraIds = layoutPlayableSlots.map((slot) => slot.camera.id);
    const activeWallCameraIdSet = new Set(activeWallCameraIds);

    setWallPlaybackConfigs((current) => {
      const nextEntries = Object.entries(current).filter(([cameraId]) => activeWallCameraIdSet.has(cameraId));
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
    setWallPlaybackStates((current) => {
      const nextEntries = Object.entries(current).filter(([cameraId]) => activeWallCameraIdSet.has(cameraId));
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });
    setWallReconnectTokens((current) => {
      const nextEntries = Object.entries(current).filter(([cameraId]) => activeWallCameraIdSet.has(cameraId));
      return nextEntries.length === Object.keys(current).length ? current : Object.fromEntries(nextEntries);
    });

    activeWallCameraIds.forEach((cameraId) => {
      void window.electronAPI
        .getCameraRuntimePlaybackConfig(cameraId)
        .then((config) => {
          if (disposed || !mountedRef.current) {
            return;
          }

          logWallDebug('[webrtc-wall] config loaded', {
            cameraId,
            streamPath: config.streamPath,
            webrtcUrl: config.webrtcUrl,
          });
          setWallPlaybackConfigs((current) => {
            const previous = current[cameraId];
            if (
              previous?.webrtcUrl === config.webrtcUrl &&
              previous?.streamPath === config.streamPath &&
              previous?.rtspUrl === config.rtspUrl &&
              previous?.enabled === config.enabled &&
              previous?.error === config.error
            ) {
              return current;
            }

            return {
              ...current,
              [cameraId]: config,
            };
          });
        })
        .catch((error) => {
          if (disposed || !mountedRef.current) {
            return;
          }

          logWallDebug('[webrtc-wall] failed', {
            cameraId,
            stage: 'config',
            error: error instanceof Error ? error.message : String(error),
          });
          setWallPlaybackConfigs((current) => ({
            ...current,
            [cameraId]: null,
          }));
        });
    });

    return () => {
      disposed = true;
    };
  }, [layoutPlayableSlots, wallUsesWebrtc]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }

    const syncWallFrame = () => {
      const availableWidth = viewport.clientWidth - WALL_PADDING_PX * 2;
      const availableHeight = viewport.clientHeight - WALL_PADDING_PX * 2;
      const aspectWidth = Math.min(availableWidth, availableHeight * WALL_ASPECT_RATIO);
      const aspectHeight = aspectWidth / WALL_ASPECT_RATIO;
      setWallBounds({
        width: Math.max(0, Math.floor(aspectWidth)),
        height: Math.max(0, Math.floor(aspectHeight)),
      });
    };

    const observer = new ResizeObserver(syncWallFrame);
    observer.observe(viewport);
    syncWallFrame();
    window.addEventListener('resize', syncWallFrame);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncWallFrame);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    const visiblePlayableSlots = visibleSlots.filter((slot): slot is { slotIndex: number; camera: CameraSummary } => Boolean(slot.camera?.enabled));
    const hiddenWallCameras = layoutPlayableSlots.filter(
      (slot) => !visiblePlayableSlots.some((visibleSlot) => visibleSlot.camera.id === slot.camera.id),
    );
    const activeWallCameraIds = new Set(layoutPlayableSlots.map((slot) => slot.camera.id));
    const visibleWallCameraIds = new Set(visiblePlayableSlots.map((slot) => slot.camera.id));
    const wallRuntimeCameraIds = new Set<string>([
      ...wallStatuses.keys(),
      ...Object.keys(wallPlaybackStates),
      ...Object.keys(wallPlaybackConfigs),
      ...lastSentBoundsRef.current.keys(),
      ...sentInitialSyncRef.current.keys(),
    ]);
    const stoppedWallCameraIds = Array.from(wallRuntimeCameraIds).filter((cameraId) => !activeWallCameraIds.has(cameraId));

    pendingSlotRemovalTimersRef.current.forEach((timer, cameraId) => {
      if (activeWallCameraIds.has(cameraId) || visibleWallCameraIds.has(cameraId)) {
        window.clearTimeout(timer);
        pendingSlotRemovalTimersRef.current.delete(cameraId);
        cleanedRemovedWallSessionIdsRef.current.delete(cameraId);
        logWallDebug('[mpv-manager] delayed slot removal cancelled', {
          cameraId,
        });
      }
    });

    hiddenWallCameras.forEach((slot) => {
      if (!disposed && mountedRef.current) {
        logWallCleanupTrace('sync-visible-slots', 'hidden wall camera session hidden/stopped', {
          cameraId: slot.camera.id,
          disposedRef: disposed,
          wallUsesWebrtc,
        });
        lastSentBoundsRef.current.delete(slot.camera.id);
        sentInitialSyncRef.current.delete(slot.camera.id);
        if (wallUsesWebrtc) {
          void window.electronAPI.stopSession(`wall:${slot.camera.id}`);
        } else {
          void window.electronAPI.hideSession(`wall:${slot.camera.id}`);
        }
      }
    });

    visiblePlayableSlots.forEach((slot) => {
      if (!wallUsesWebrtc && !disposed && mountedRef.current) {
        void window.electronAPI.showSession(`wall:${slot.camera.id}`);
      }
    });

    stoppedWallCameraIds.forEach((cameraId) => {
      if (!disposed && mountedRef.current) {
        lastSentBoundsRef.current.delete(cameraId);
        sentInitialSyncRef.current.delete(cameraId);
        if (pendingSlotRemovalTimersRef.current.has(cameraId) || cleanedRemovedWallSessionIdsRef.current.has(cameraId)) {
          return;
        }
        logWallCleanupTrace('sync-visible-slots', 'stopped wall camera session removal scheduled', {
          cameraId,
          disposedRef: disposed,
          delayMs: WALL_SLOT_REMOVAL_GRACE_MS,
        });
        const timer = window.setTimeout(() => {
          pendingSlotRemovalTimersRef.current.delete(cameraId);
          if (disposed || !mountedRef.current) {
            return;
          }
          const stillRemoved = !wallSlots.some((slot) => slot.camera?.id === cameraId);
          if (!stillRemoved) {
            cleanedRemovedWallSessionIdsRef.current.delete(cameraId);
            logWallDebug('[mpv-manager] delayed slot removal cancelled', {
              cameraId,
              reason: 'camera returned before grace window elapsed',
            });
            return;
          }
          cleanedRemovedWallSessionIdsRef.current.add(cameraId);
          logWallCleanupTrace('sync-visible-slots', 'stopped wall camera session removed', {
            cameraId,
            disposedRef: disposed,
          });
          void window.electronAPI.stopSession(`wall:${cameraId}`);
        }, WALL_SLOT_REMOVAL_GRACE_MS);
        pendingSlotRemovalTimersRef.current.set(cameraId, timer);
      }
    });

    logWallDebug('[wall-debug] visiblePlayableSlots count', {
      count: visiblePlayableSlots.length,
      visibleCameraIds: visiblePlayableSlots.map((slot) => slot.camera.id),
      wallCameraIds: layoutPlayableSlots.map((slot) => slot.camera.id),
      cameraListLoaded,
      activeLayoutLoaded,
      mpvAvailabilityChecked,
    });
    logWallDebug('[wall-debug] mpvInstalled', {
      installed: mpvInstalled,
      demoMode,
      pageStableForMpv,
      wallPlaybackProvider: WALL_PLAYBACK_PROVIDER,
    });

    if (!cameraListLoaded || !activeLayoutLoaded || (!wallUsesWebrtc && !mpvAvailabilityChecked)) {
      logWallDebug('[wall-debug] sync effect waiting', {
        cameraListLoaded,
        activeLayoutLoaded,
        mpvAvailabilityChecked,
        wallUsesWebrtc,
      });
      return;
    }

    if (visiblePlayableSlots.length === 0) {
      logWallDebug('[wall-debug] visiblePlayableSlots count', {
        count: 0,
        reason: 'no enabled visible slots',
      });
      return;
    }

    if (wallUsesWebrtc) {
      return;
    }

    let frameHandle: number | null = null;
    let retryTimeoutHandle: number | null = null;
    let initialSyncTimeoutHandle: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      scheduleSync();
    });

    const scheduleRetry = () => {
      if (disposed || !mountedRef.current) {
        return;
      }

      if (retryTimeoutHandle === null) {
        retryTimeoutHandle = window.setTimeout(() => {
          retryTimeoutHandle = null;
          scheduleSync();
        }, 300);
      }

      scheduleSync();
    };

    const syncVisibleSlots = () => {
      frameHandle = null;
      if (disposed || !mountedRef.current) {
        return;
      }

      const nextDebugBounds: Record<string, DebugBounds> = {};

      visiblePlayableSlots.forEach(({ camera }) => {
        const element = videoContainerRefs.current.get(camera.id);
        if (!element) {
          logWallDebug('[wall-debug] ref missing', {
            cameraId: camera.id,
            surface: 'wall',
          });
          scheduleRetry();
          return;
        }

        const rect = element.getBoundingClientRect();
        const bounds: RelativeBounds = {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          fullscreen: Boolean(fullscreenCameraId),
        };

        nextDebugBounds[camera.id] = {
          x: Math.round(bounds.x),
          y: Math.round(bounds.y),
          width: Math.round(bounds.width),
          height: Math.round(bounds.height),
          fullscreen: Boolean(bounds.fullscreen),
        };

        if (bounds.width < 24 || bounds.height < 24) {
          logWallDebug('[wall-debug] bounds too small', {
            cameraId: camera.id,
            surface: 'wall',
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
          });
          scheduleRetry();
          return;
        }

        if (!pageStableForMpv) {
          logWallDebug('[wall-debug] sync effect waiting', {
            reason: 'page not yet stable for mpv',
            cameraId: camera.id,
          });
          scheduleRetry();
          return;
        }

        if ((!demoMode || mpvInstalled) && !disposed && mountedRef.current) {
          const initialSyncSent = sentInitialSyncRef.current.has(camera.id);
          const lastSentBounds = lastSentBoundsRef.current.get(camera.id);
          const wallSessionStatus = wallTileStatuses.get(camera.id);
          const sessionNeedsRestart = !wallSessionStatus || wallSessionStatus.status === 'OFFLINE';
          const materiallyChanged =
            !lastSentBounds ||
            Math.abs(lastSentBounds.x - bounds.x) > 2 ||
            Math.abs(lastSentBounds.y - bounds.y) > 2 ||
            Math.abs(lastSentBounds.width - bounds.width) > 2 ||
            Math.abs(lastSentBounds.height - bounds.height) > 2 ||
            Boolean(lastSentBounds.fullscreen) !== Boolean(bounds.fullscreen);

          if (initialSyncSent && !materiallyChanged && !sessionNeedsRestart) {
            logWallDebug('[wall-debug] skipped updateMpvBounds unchanged bounds', {
              cameraId: camera.id,
              surface: 'wall',
              bounds: {
                x: Math.round(bounds.x),
                y: Math.round(bounds.y),
                width: Math.round(bounds.width),
                height: Math.round(bounds.height),
                fullscreen: bounds.fullscreen,
              },
            });
            return;
          }

          if (!initialSyncSent) {
            logWallDebug('[wall-debug] forcing initial updateMpvBounds', {
              cameraId: camera.id,
              surface: 'wall',
            });
          } else if (sessionNeedsRestart) {
            logWallDebug('[wall-debug] watchdog restart updateMpvBounds', {
              cameraId: camera.id,
              surface: 'wall',
              reason: 'session missing or offline watchdog',
              status: wallSessionStatus?.status ?? 'missing',
              bounds: {
                x: Math.round(bounds.x),
                y: Math.round(bounds.y),
                width: Math.round(bounds.width),
                height: Math.round(bounds.height),
                fullscreen: bounds.fullscreen,
              },
            });
          }

          logWallDebug('[wall-debug] invoking updateMpvBounds', {
            cameraId: camera.id,
            surface: 'wall',
            bounds: {
              x: Math.round(bounds.x),
              y: Math.round(bounds.y),
              width: Math.round(bounds.width),
              height: Math.round(bounds.height),
              fullscreen: bounds.fullscreen,
            },
            mpvInstalled,
            demoMode,
            disposed,
            mounted: mountedRef.current,
          });
          void window.electronAPI.updateMpvBounds({
            cameraId: camera.id,
            surface: 'wall',
            bounds,
          });
          lastSentBoundsRef.current.set(camera.id, { ...bounds });
          sentInitialSyncRef.current.add(camera.id);
        } else {
          logWallDebug('[wall-debug] mpvInstalled', {
            installed: mpvInstalled,
            demoMode,
            skippedInvoke: true,
            cameraId: camera.id,
          });
        }
      });

      if (WALL_DEBUG_ENABLED && !disposed && mountedRef.current) {
        setDebugBounds((current) => {
          const currentKeys = Object.keys(current);
          const nextKeys = Object.keys(nextDebugBounds);
          if (
            currentKeys.length === nextKeys.length &&
            nextKeys.every((key) => {
              const currentBounds = current[key];
              const nextBounds = nextDebugBounds[key];
              return (
                currentBounds?.x === nextBounds?.x &&
                currentBounds?.y === nextBounds?.y &&
                currentBounds?.width === nextBounds?.width &&
                currentBounds?.height === nextBounds?.height &&
                currentBounds?.fullscreen === nextBounds?.fullscreen
              );
            })
          ) {
            return current;
          }

          return nextDebugBounds;
        });
      }
    };

    const scheduleSync = () => {
      if (disposed || !mountedRef.current) {
        return;
      }
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
      }
      frameHandle = window.requestAnimationFrame(syncVisibleSlots);
    };

    visiblePlayableSlots.forEach(({ camera }) => {
      const element = videoContainerRefs.current.get(camera.id);
      if (element) {
        resizeObserver.observe(element);
      }
    });

    initialSyncTimeoutHandle = window.setTimeout(scheduleSync, 50);
    scheduleSync();
    retryTimeoutHandle = window.setTimeout(() => {
      retryTimeoutHandle = null;
      scheduleSync();
    }, 300);
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('kurukuru-wall-sync-request', scheduleSync as EventListener);

    return () => {
      disposed = true;
      logWallCleanupTrace('sync-visible-slots', 'effect cleanup', {
        disposedRef: disposed,
        visibleCameraIds: visiblePlayableSlots.map((slot) => slot.camera.id),
      });
      resizeObserver.disconnect();
      if (frameHandle !== null) {
        window.cancelAnimationFrame(frameHandle);
      }
      if (initialSyncTimeoutHandle !== null) {
        window.clearTimeout(initialSyncTimeoutHandle);
      }
      if (retryTimeoutHandle !== null) {
        window.clearTimeout(retryTimeoutHandle);
      }
      pendingSlotRemovalTimersRef.current.forEach((timer, cameraId) => {
        if (visibleWallCameraIds.has(cameraId) || activeWallCameraIds.has(cameraId)) {
          window.clearTimeout(timer);
          pendingSlotRemovalTimersRef.current.delete(cameraId);
          cleanedRemovedWallSessionIdsRef.current.delete(cameraId);
          logWallDebug('[mpv-manager] delayed slot removal cancelled', {
            cameraId,
            reason: 'sync effect cleanup while camera still active',
          });
        }
      });
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('kurukuru-wall-sync-request', scheduleSync as EventListener);
    };
  }, [activeLayoutLoaded, cameraListLoaded, demoMode, fullscreenCameraId, layoutPlayableSlots, logWallCleanupTrace, mpvAvailabilityChecked, mpvInstalled, pageStableForMpv, visibleSlots, wallPlaybackConfigs, wallPlaybackStates, wallStatusKey, wallTileStatuses, wallUsesWebrtc, wallStatuses, wallSlots]);

  const gridSlots = fullscreenSlot?.camera ? [fullscreenSlot] : wallSlots;

  return (
    <main
      ref={viewportRef}
      className="h-screen w-screen select-none overflow-hidden bg-black text-white"
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
    >
      {!apiOnline ? (
        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded bg-red-500/85 px-2 py-1 text-[11px] font-medium text-white">
          API offline
        </div>
      ) : null}

      <div className="flex h-full w-full items-center justify-center overflow-hidden p-2">
        <section
          className={`grid overflow-hidden bg-black ${fullscreenSlot?.camera ? 'grid-cols-1 grid-rows-1 gap-0' : 'grid-cols-2 grid-rows-2'}`}
          style={{
            width: `${wallBounds.width}px`,
            height: `${wallBounds.height}px`,
            gap: fullscreenSlot?.camera ? '0px' : `${WALL_GAP_PX}px`,
            gridTemplateColumns: fullscreenSlot?.camera ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
            gridTemplateRows: fullscreenSlot?.camera ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))',
          }}
        >
          {gridSlots.map((slot) => (
            <div key={slot.camera?.id ?? `slot-${slot.slotIndex}`} className="min-h-0 min-w-0 overflow-hidden">
              <CameraTile
                slotIndex={slot.slotIndex}
                camera={slot.camera}
                status={
                  slot.camera && pendingReconnectIds.includes(slot.camera.id)
                    ? {
                        sessionId: `wall:${slot.camera.id}`,
                        cameraId: slot.camera.id,
                        cameraName: slot.camera.name,
                        surface: 'wall',
                        status: 'RECONNECTING',
                        updatedAt: new Date().toISOString(),
                        mpvInstalled,
                        message: '再接続しています...',
                      }
                    : slot.camera
                      ? wallTileStatuses.get(slot.camera.id)
                      : undefined
                }
                isFullscreen={fullscreenCameraId === slot.camera?.id}
                onToggleFullscreen={(cameraId) => {
                  setFullscreenCameraId((current) => (current === cameraId ? null : cameraId));
                }}
                onReconnect={(cameraId) => {
                  if (!mountedRef.current) {
                    return;
                  }
                  setPendingReconnectIds((current) => (current.includes(cameraId) ? current : [...current, cameraId]));
                  if (wallUsesWebrtc) {
                    setWallReconnectTokens((current) => ({
                      ...current,
                      [cameraId]: (current[cameraId] ?? 0) + 1,
                    }));
                    void window.electronAPI
                      .getCameraRuntimePlaybackConfig(cameraId)
                      .then((config) => {
                        if (!mountedRef.current) {
                          return;
                        }

                        logWallDebug('[webrtc-wall] config loaded', {
                          cameraId,
                          streamPath: config.streamPath,
                          webrtcUrl: config.webrtcUrl,
                          reason: 'manual reconnect',
                        });
                        setWallPlaybackConfigs((current) => ({
                          ...current,
                          [cameraId]: config,
                        }));
                      })
                      .catch((error) => {
                        logWallDebug('[webrtc-wall] failed', {
                          cameraId,
                          stage: 'manual reconnect',
                          error: error instanceof Error ? error.message : String(error),
                        });
                      });
                    return;
                  }

                  void window.electronAPI.restartCamera(cameraId);
                }}
                videoContainerRef={!wallUsesWebrtc && slot.camera?.id ? getVideoContainerRef(slot.camera.id, slot.slotIndex) : undefined}
                videoContent={
                  wallUsesWebrtc && slot.camera ? (
                    <EmbeddedCameraPlayer
                      cameraId={slot.camera!.id}
                      playbackConfig={wallPlaybackConfigs[slot.camera!.id] ?? null}
                      enabled={slot.camera!.enabled}
                      desiredRunning
                      reconnectToken={wallReconnectTokens[slot.camera!.id] ?? 0}
                      onOpenExternalPlayer={() => {
                        void window.electronAPI.openCameraPopup(slot.camera!.id);
                      }}
                      className="absolute inset-0 h-full w-full overflow-hidden bg-black"
                      videoClassName="absolute inset-0 h-full w-full min-h-0 min-w-0 object-cover"
                      showStatusChrome={false}
                      showExternalPlayerAction={false}
                      onStateChange={(state, error) => {
                        setWallPlaybackState(slot.camera!, state, error);
                      }}
                    />
                  ) : undefined
                }
                debugOverlay={
                  WALL_DEBUG_ENABLED && !wallUsesWebrtc && slot.camera
                    ? `slot=${slot.slotIndex} x=${debugBounds[slot.camera.id]?.x ?? 0} y=${debugBounds[slot.camera.id]?.y ?? 0} w=${debugBounds[slot.camera.id]?.width ?? 0} h=${debugBounds[slot.camera.id]?.height ?? 0} fs=${debugBounds[slot.camera.id]?.fullscreen ? 1 : 0}`
                    : null
                }
              />
            </div>
          ))}
        </section>
      </div>
    </main>
  );
}
