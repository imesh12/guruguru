import { useEffect, useRef, useState } from 'react';

import type { CameraPlaybackConfig } from '../../electron/camera-types';
import { getStreamProvider } from '../lib/stream-provider';

type WebRtcPlayerState = 'idle' | 'connecting' | 'live' | 'retrying' | 'error' | 'stopped';

type UseWebRtcPlayerInput = {
  cameraId: string;
  playbackConfig: CameraPlaybackConfig | null;
  enabled: boolean;
  desiredRunning: boolean;
  reconnectToken: number;
  onStateChange?: ((state: WebRtcPlayerState, error: string | null) => void) | undefined;
};

type UseWebRtcPlayerResult = {
  state: WebRtcPlayerState;
  error: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
};

const RETRY_DELAYS_MS = [1000, 2500, 5000] as const;
const WHEP_RESPONSE_LOG_LIMIT = 300;

const logWebRtcWall = (message: string, details?: Record<string, unknown>) => {
  console.info(message, details ?? {});
  try {
    window.electronAPI?.wallDebugLog?.(message, details);
  } catch (error) {
    console.error('[webrtc-wall] debug bridge failed', {
      message,
      details: details ?? {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const waitForIceGatheringComplete = (peerConnection: RTCPeerConnection) =>
  new Promise<void>((resolve) => {
    if (peerConnection.iceGatheringState === 'complete') {
      resolve();
      return;
    }

    const handleChange = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        peerConnection.removeEventListener('icegatheringstatechange', handleChange);
        resolve();
      }
    };

    peerConnection.addEventListener('icegatheringstatechange', handleChange);
    window.setTimeout(() => {
      peerConnection.removeEventListener('icegatheringstatechange', handleChange);
      resolve();
    }, 1500);
  });

export function useWebRtcPlayer({
  cameraId,
  playbackConfig,
  enabled,
  desiredRunning,
  reconnectToken,
  onStateChange,
}: UseWebRtcPlayerInput): UseWebRtcPlayerResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const manualStopRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const [state, setState] = useState<WebRtcPlayerState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const status = state === 'live' ? 'LIVE' : state === 'connecting' || state === 'retrying' ? 'RECONNECTING' : 'OFFLINE';
    const playbackState =
      state === 'live'
        ? 'running'
        : state === 'connecting' || state === 'retrying'
          ? 'connecting'
          : state === 'stopped'
            ? 'stopped'
            : state === 'idle'
              ? 'idle'
              : 'error';

    void window.electronAPI.reportCameraSessionState({
      sessionId: `wall:${cameraId}`,
      cameraId,
      cameraName: playbackConfig?.name ?? cameraId,
      surface: 'wall',
      status,
      updatedAt: new Date().toISOString(),
      mpvInstalled: false,
      provider: 'webrtc',
      playbackState,
      processState: state === 'live' ? 'running' : state === 'connecting' || state === 'retrying' ? 'starting' : 'failed',
      lastError: error,
      message: error ?? (state === 'live' ? 'WebRTC stream connected' : state === 'connecting' || state === 'retrying' ? 'Connecting to WebRTC stream...' : 'Playback stopped'),
    }).catch(() => undefined);
  }, [cameraId, error, playbackConfig?.name, state]);

  useEffect(() => {
    onStateChange?.(state, error);
  }, [error, onStateChange, state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void window.electronAPI.reportCameraSessionState({
        sessionId: `wall:${cameraId}`,
        cameraId,
        cameraName: playbackConfig?.name ?? cameraId,
        surface: 'wall',
        status: 'OFFLINE',
        updatedAt: new Date().toISOString(),
        mpvInstalled: false,
        provider: 'webrtc',
        playbackState: 'stopped',
        processState: 'failed',
        lastError: null,
        message: 'Playback stopped',
      }).catch(() => undefined);
    };
  }, [cameraId, playbackConfig?.name]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handlePlaying = () => {
      setState('live');
      setError(null);
      retryAttemptRef.current = 0;
      logWebRtcWall('[webrtc-wall] connected', {
        cameraId,
      });
    };

    video.addEventListener('playing', handlePlaying);
    return () => {
      video.removeEventListener('playing', handlePlaying);
    };
  }, [cameraId]);

  useEffect(() => {
    manualStopRef.current = !desiredRunning;
  }, [desiredRunning]);

  useEffect(() => {
    const cleanup = () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      abortControllerRef.current?.abort();
      abortControllerRef.current = null;

      const peerConnection = peerConnectionRef.current;
      if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onconnectionstatechange = null;
        peerConnection.oniceconnectionstatechange = null;
        peerConnection.close();
        peerConnectionRef.current = null;
      }

      const video = videoRef.current;
      if (video) {
        video.pause();
        video.srcObject = null;
      }
    };

    if (!enabled || !desiredRunning || !playbackConfig) {
      cleanup();
      setState(desiredRunning ? 'idle' : 'stopped');
      return cleanup;
    }

    const provider = getStreamProvider(playbackConfig);
    if (provider.providerType !== 'webrtc' || !provider.webrtcUrl) {
      setState('error');
      setError('Embedded WebRTC playback is not available for this camera.');
      return cleanup;
    }
    const webrtcUrl = provider.webrtcUrl;

    let cancelled = false;

    const connect = async () => {
      cleanup();
      setState(retryAttemptRef.current > 0 ? 'retrying' : 'connecting');
      setError(null);
      if (retryAttemptRef.current > 0) {
        logWebRtcWall('[webrtc-wall] reconnecting', {
          cameraId,
          attempt: retryAttemptRef.current,
          url: webrtcUrl,
        });
      } else {
        logWebRtcWall('[webrtc-wall] connecting', {
          cameraId,
          url: webrtcUrl,
        });
      }

      try {
        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        const peerConnection = new RTCPeerConnection({
          iceServers: [],
          bundlePolicy: 'max-bundle',
        });
        peerConnectionRef.current = peerConnection;

        peerConnection.addTransceiver('video', { direction: 'recvonly' });

        peerConnection.ontrack = (event) => {
          const [stream] = event.streams;
          if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
            void videoRef.current.play().catch(() => undefined);
          }
        };

        peerConnection.onconnectionstatechange = () => {
          if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
            logWebRtcWall('[webrtc-wall] peer disconnected', {
              cameraId,
              connectionState: peerConnection.connectionState,
            });
            cleanup();
            const message = `Peer connection ${peerConnection.connectionState}`;
            setError(message);
            setState('error');
          }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        logWebRtcWall('[webrtc-wall] local description set', {
          cameraId,
          type: offer.type,
        });
        await waitForIceGatheringComplete(peerConnection);

        const localDescription = peerConnection.localDescription;
        if (!localDescription?.sdp) {
          throw new Error('WebRTC offer SDP was not created.');
        }

        logWebRtcWall('[webrtc-wall] offer created', {
          cameraId,
          url: webrtcUrl,
        });

        const response = await fetch(webrtcUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/sdp',
          },
          body: localDescription.sdp,
          signal: abortController.signal,
        });

        const responseBody = await response.text();
        logWebRtcWall('[webrtc-wall] WHEP status', {
          cameraId,
          status: response.status,
          ok: response.ok,
          url: webrtcUrl,
        });
        logWebRtcWall('[webrtc-wall] WHEP response body', {
          cameraId,
          status: response.status,
          body: responseBody.slice(0, WHEP_RESPONSE_LOG_LIMIT),
        });

        if (!response.ok) {
          throw new Error(`WHEP request failed with ${response.status}`);
        }

        await peerConnection.setRemoteDescription({
          type: 'answer',
          sdp: responseBody,
        });
        logWebRtcWall('[webrtc-wall] set remote answer success', {
          cameraId,
          url: webrtcUrl,
        });

        logWebRtcWall('[webrtc-wall] whep connected', {
          cameraId,
          url: webrtcUrl,
        });
        setState('connecting');
      } catch (err) {
        cleanup();
        const message = err instanceof Error ? err.message : 'Embedded playback failed.';
        if (!cancelled && mountedRef.current) {
          logWebRtcWall('[webrtc-wall] set remote answer failure', {
            cameraId,
            url: webrtcUrl,
            error: message,
          });
          setError(message);
          setState('error');
          logWebRtcWall('[webrtc-wall] failed', {
            cameraId,
            error: message,
            url: webrtcUrl,
          });

          if (!manualStopRef.current) {
            const delay = RETRY_DELAYS_MS[Math.min(retryAttemptRef.current, RETRY_DELAYS_MS.length - 1)];
            retryAttemptRef.current += 1;
            retryTimerRef.current = window.setTimeout(() => {
              if (!cancelled && mountedRef.current && !manualStopRef.current) {
                void connect();
              }
            }, delay);
          }
        }
      }
    };

    retryAttemptRef.current = 0;
    void connect();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [cameraId, desiredRunning, enabled, playbackConfig, reconnectToken]);

  return {
    state,
    error,
    videoRef,
  };
}
