import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import type { CameraPlaybackConfig, CameraSessionState, CameraSummary, RelativeBounds } from '../../electron/camera-types';
import type { ElectronAPI } from '../global';
import { EmbeddedCameraPlayer } from '../components/EmbeddedCameraPlayer';
import { getWallPlaybackProvider } from '../lib/stream-provider';

const POPUP_REFRESH_INTERVAL = 2000;
const POPUP_SYNC_INTERVAL = 1200;
const WALL_PLAYBACK_PROVIDER = getWallPlaybackProvider();

const isSameCameraSummary = (left: CameraSummary | null, right: CameraSummary | null) => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.id === right.id &&
    left.vehicleId === right.vehicleId &&
    left.vehicleName === right.vehicleName &&
    left.name === right.name &&
    left.type === right.type &&
    left.vendor === right.vendor &&
    left.host === right.host &&
    left.rtspPort === right.rtspPort &&
    left.customRtspUrl === right.customRtspUrl &&
    left.qualityPreset === right.qualityPreset &&
    left.rtspUrl === right.rtspUrl &&
    left.enabled === right.enabled &&
    left.bitrateLimit === right.bitrateLimit
  );
};

const isSamePlaybackConfig = (left: CameraPlaybackConfig | null, right: CameraPlaybackConfig | null) => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    left.cameraId === right.cameraId &&
    left.id === right.id &&
    left.vehicleId === right.vehicleId &&
    left.vehicleName === right.vehicleName &&
    left.name === right.name &&
    left.type === right.type &&
    left.vendor === right.vendor &&
    left.host === right.host &&
    left.rtspPort === right.rtspPort &&
    left.customRtspUrl === right.customRtspUrl &&
    left.qualityPreset === right.qualityPreset &&
    left.rtspUrl === right.rtspUrl &&
    left.enabled === right.enabled &&
    left.bitrateLimit === right.bitrateLimit &&
    left.providerType === right.providerType &&
    left.sanitizedRtspUrl === right.sanitizedRtspUrl &&
    left.error === right.error &&
    left.streamPath === right.streamPath &&
    left.webrtcUrl === right.webrtcUrl
  );
};

export function CameraPopoutPage() {
  const { cameraId } = useParams<{ cameraId: string }>();
  const electronApi = window.electronAPI as unknown as ElectronAPI;
  const [camera, setCamera] = useState<CameraSummary | null>(null);
  const [statuses, setStatuses] = useState<CameraSessionState[]>([]);
  const [playbackConfig, setPlaybackConfig] = useState<CameraPlaybackConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reconnectToken, setReconnectToken] = useState(0);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const lastCameraIdRef = useRef<string | null>(null);

  const stableCameraId = cameraId ?? null;
  const stablePlaybackConfig = useMemo(() => playbackConfig, [playbackConfig]);
  const popoutEnabled = Boolean(camera?.enabled);
  const cameraLabel = useMemo(
    () => (camera ? `${camera.vehicleName} / ${camera.name}` : null),
    [camera],
  );
  const isWebRtcReady = useMemo(
    () =>
      Boolean(
        stableCameraId &&
        camera &&
        popoutEnabled &&
        stablePlaybackConfig &&
        stablePlaybackConfig.cameraId === stableCameraId &&
        !isLoading,
      ),
    [camera, isLoading, popoutEnabled, stableCameraId, stablePlaybackConfig],
  );
  const handleExternalPlayerOpen = useCallback(() => {
    setReconnectToken((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!stableCameraId || lastCameraIdRef.current === stableCameraId) {
      return;
    }

    lastCameraIdRef.current = stableCameraId;
    if (import.meta.env.DEV) {
      console.info('[camera-popout] camera changed', {
        cameraId: stableCameraId,
      });
    }
    setCamera(null);
    setPlaybackConfig(null);
    setLoadError(null);
    setIsLoading(true);
  }, [stableCameraId]);

  useEffect(() => {
    if (!stableCameraId) {
      return;
    }

    let disposed = false;

    const syncCamera = async () => {
      try {
        if (!disposed) {
          setLoadError(null);
        }
        const [cameraList, initialStatuses] = await Promise.all([
          electronApi.listCameras(),
          electronApi.listCameraStatuses(),
        ]);
        if (disposed) {
          return;
        }

        const nextCamera = cameraList.find((entry) => entry.id === stableCameraId) ?? null;
        setCamera((current) => (isSameCameraSummary(current, nextCamera) ? current : nextCamera));
        setStatuses(initialStatuses);

        if (!nextCamera || !nextCamera.enabled) {
          void electronApi.stopSession(`focus:${stableCameraId}`);
          setPlaybackConfig((current) => (current === null ? current : null));
          if (!disposed) {
            setIsLoading(false);
            setLoadError(nextCamera ? 'Camera disabled' : 'Camera unavailable');
          }
          return;
        }

        if (WALL_PLAYBACK_PROVIDER === 'webrtc') {
          const nextPlaybackConfig = await electronApi.getCameraRuntimePlaybackConfig(stableCameraId);
          if (!disposed) {
            setPlaybackConfig((current) => (isSamePlaybackConfig(current, nextPlaybackConfig) ? current : nextPlaybackConfig));
            setIsLoading(false);
            setLoadError(nextPlaybackConfig.error ?? null);
          }
        } else if (!disposed) {
          setPlaybackConfig((current) => (current === null ? current : null));
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Failed to sync camera popout state', error);
        if (!disposed) {
          setIsLoading(false);
          setLoadError(error instanceof Error ? error.message : 'Failed to load camera stream.');
        }
      }
    };

    void syncCamera();

    const unsubscribe = electronApi.onCameraStatusChanged((nextStatuses) => {
      if (!disposed) {
        setStatuses(nextStatuses);
      }
    });
    const refreshTimer = window.setInterval(() => {
      void syncCamera();
    }, POPUP_REFRESH_INTERVAL);

    return () => {
      disposed = true;
      unsubscribe();
      window.clearInterval(refreshTimer);
      void electronApi.stopSession(`focus:${stableCameraId}`);
    };
  }, [stableCameraId, electronApi]);

  useEffect(() => {
    if (!stableCameraId || !camera || WALL_PLAYBACK_PROVIDER === 'webrtc') {
      return;
    }

    const syncFocus = () => {
      const element = frameRef.current;
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const bounds: RelativeBounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };

      void electronApi.syncCameraLayout({
        cameraId: stableCameraId,
        surface: 'focus',
        bounds,
      });
    };

    const interval = window.setInterval(syncFocus, POPUP_SYNC_INTERVAL);
    const timeout = window.setTimeout(syncFocus, 120);
    window.addEventListener('resize', syncFocus);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener('resize', syncFocus);
    };
  }, [camera, stableCameraId, electronApi]);

  const focusStatus = useMemo(
    () => statuses.find((entry) => entry.sessionId === `focus:${stableCameraId}`),
    [stableCameraId, statuses],
  );

  return (
    <main className="h-screen w-screen overflow-hidden bg-black text-white">
      <div ref={frameRef} className="relative h-full w-full overflow-hidden bg-black">
        {WALL_PLAYBACK_PROVIDER === 'webrtc' && camera && stableCameraId && isWebRtcReady ? (
          <EmbeddedCameraPlayer
            key={stableCameraId}
            cameraId={stableCameraId}
            playbackConfig={stablePlaybackConfig}
            enabled={popoutEnabled}
            desiredRunning
            reconnectToken={reconnectToken}
            onOpenExternalPlayer={handleExternalPlayerOpen}
            className="absolute inset-0 h-full w-full overflow-hidden bg-black"
            videoClassName="absolute inset-0 h-full w-full min-h-0 min-w-0 object-contain"
            showStatusChrome={false}
            showExternalPlayerAction={false}
          />
        ) : (
          <div className="absolute inset-0 h-full w-full overflow-hidden bg-black" />
        )}

        {cameraLabel ? (
          <div className="pointer-events-none absolute left-3 top-3 z-10 rounded bg-black/45 px-3 py-1 text-xs font-medium text-white/90">
            {cameraLabel}
          </div>
        ) : null}

        {isLoading ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-slate-300">
            Loading camera...
          </div>
        ) : null}

        {!isLoading && !camera ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black text-sm text-slate-300">
            Camera unavailable
          </div>
        ) : null}

        {!isLoading && camera && !camera.enabled ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black text-sm text-slate-300">
            Camera disabled
          </div>
        ) : null}

        {!isLoading && loadError ? (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-black/45 px-3 py-1 text-xs text-white/80">
            {loadError}
          </div>
        ) : null}

        {!camera?.enabled && focusStatus?.message ? (
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded bg-black/45 px-3 py-1 text-xs text-white/80">
            {focusStatus.message}
          </div>
        ) : null}
      </div>
    </main>
  );
}
