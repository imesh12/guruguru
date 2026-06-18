import type { CameraPlaybackConfig } from '../../electron/camera-types';

export type StreamProviderType = 'webrtc' | 'external-mpv';
export type WallPlaybackProvider = 'webrtc' | 'mpv';

export type StreamProviderResult = {
  providerType: StreamProviderType;
  cameraId: string;
  streamPath: string | null;
  webrtcUrl: string | null;
};

const configuredWallPlaybackProvider = String((import.meta as any).env?.VITE_WALL_PLAYBACK_PROVIDER ?? '')
  .trim()
  .toLowerCase();

export const getWallPlaybackProvider = (): WallPlaybackProvider => (configuredWallPlaybackProvider === 'mpv' ? 'mpv' : 'webrtc');

export const getStreamProvider = (config: CameraPlaybackConfig): StreamProviderResult => ({
  providerType: config.webrtcUrl ? 'webrtc' : 'external-mpv',
  cameraId: config.cameraId,
  streamPath: config.streamPath,
  webrtcUrl: config.webrtcUrl,
});
