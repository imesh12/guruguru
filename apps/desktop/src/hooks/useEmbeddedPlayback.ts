import { useEffect, useRef, useState } from 'react';

import type { CameraPlaybackConfig } from '../../electron/camera-types';
import { getStreamProvider } from '../lib/stream-provider';

type EmbeddedPlaybackState = 'idle' | 'connecting' | 'live' | 'retrying' | 'error' | 'stopped';

type UseEmbeddedPlaybackInput = {
  cameraId: string;
  playbackConfig: CameraPlaybackConfig | null;
  enabled: boolean;
  desiredRunning: boolean;
  reconnectToken: number;
  onStateChange?: ((state: EmbeddedPlaybackState, error: string | null) => void) | undefined;
};

type UseEmbeddedPlaybackResult = {
  state: EmbeddedPlaybackState;
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

export function useEmbeddedPlayback({ cameraId, playbackConfig, enabled, desiredRunning, reconnectToken, onStateChange }: UseEmbeddedPlaybackInput): UseEmbeddedPlaybackResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const manualStopRef = useRef(false);
  const retryAttemptRef = useRef(0);
  const [state, setState] = useState<EmbeddedPlaybackState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onStateChange?.(state, error);
  }, [error, onStateChange, state]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const handlePlaying = () => {
      console.log('[embedded-player] live', { cameraId });
      setState('live');
      setError(null);
      retryAttemptRef.current = 0;
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
      if (!desiredRunning) {
        console.log('[embedded-player] stopped', { cameraId });
      }
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
        console.log(`[embedded-player] ${retryAttemptRef.current > 0 ? 'retrying' : 'connecting'}`, {
          cameraId,
          attempt: retryAttemptRef.current,
          url: webrtcUrl,
        });

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
            void videoRef.current.play().catch(() => {
              // `playing` or connection-state handlers will surface the real status.
            });
          }
        };

        peerConnection.onconnectionstatechange = () => {
          if (peerConnection.connectionState === 'failed' || peerConnection.connectionState === 'disconnected') {
            cleanup();
            const message = `Peer connection ${peerConnection.connectionState}`;
            console.log('[embedded-player] error', { cameraId, message });
            setError(message);
            setState('error');
          }
        };

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGatheringComplete(peerConnection);

        const localDescription = peerConnection.localDescription;
        if (!localDescription?.sdp) {
          throw new Error('WebRTC offer SDP was not created.');
        }

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

        setState('connecting');
      } catch (err) {
        cleanup();
        const message = err instanceof Error ? err.message : 'Embedded playback failed.';
        if (!cancelled && mountedRef.current) {
          console.log('[embedded-player] error', { cameraId, message });
          setError(message);
          setState('error');

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
      console.log('[embedded-player] stopped', { cameraId });
      setState((current) => (current === 'live' || current === 'connecting' || current === 'retrying' ? 'stopped' : current));
    };
  }, [cameraId, desiredRunning, enabled, playbackConfig, reconnectToken]);

  return {
    state,
    error,
    videoRef,
  };
}
