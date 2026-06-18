import type { CameraPlaybackConfig } from '../../electron/camera-types';
import { useWebRtcPlayer } from '../hooks/useWebRtcPlayer';

type EmbeddedCameraPlayerProps = {
  cameraId: string;
  playbackConfig: CameraPlaybackConfig | null;
  enabled: boolean;
  desiredRunning: boolean;
  reconnectToken: number;
  onOpenExternalPlayer: () => void;
  className?: string | undefined;
  videoClassName?: string | undefined;
  showStatusChrome?: boolean | undefined;
  showExternalPlayerAction?: boolean | undefined;
  onStateChange?: (state: 'idle' | 'connecting' | 'live' | 'retrying' | 'error' | 'stopped', error: string | null) => void;
};

export function EmbeddedCameraPlayer({
  cameraId,
  playbackConfig,
  enabled,
  desiredRunning,
  reconnectToken,
  onOpenExternalPlayer,
  className,
  videoClassName,
  showStatusChrome = true,
  showExternalPlayerAction = true,
  onStateChange,
}: EmbeddedCameraPlayerProps) {
  const { state, error, videoRef } = useWebRtcPlayer({
    cameraId,
    playbackConfig,
    enabled,
    desiredRunning,
    reconnectToken,
    onStateChange,
  });

  return (
    <div
      className={
        className ?? 'relative flex h-full w-full min-h-0 min-w-0 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_40%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))]'
      }
    >
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        className={videoClassName ?? 'absolute inset-0 h-full w-full min-h-0 min-w-0 object-cover'}
      />
      {showStatusChrome && state !== 'live' ? <div className="absolute inset-0 bg-black/45" /> : null}

      {showStatusChrome && state !== 'live' ? (
        <div className="relative z-10 mx-auto max-w-sm px-4 text-center">
          <p className="text-sm font-medium text-white/90">
            {state === 'connecting' && 'Connecting'}
            {state === 'retrying' && 'Reconnecting'}
            {state === 'error' && 'Playback unavailable'}
            {state === 'stopped' && 'Playback stopped'}
            {state === 'idle' && 'Preparing video'}
          </p>
          {error ? <p className="mt-2 text-xs text-slate-300">{error}</p> : null}
          {showExternalPlayerAction && (state === 'error' || state === 'stopped') ? (
            <div className="mt-4 flex justify-center">
              <button
                type="button"
                onClick={onOpenExternalPlayer}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-900"
              >
                Open External Player
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
