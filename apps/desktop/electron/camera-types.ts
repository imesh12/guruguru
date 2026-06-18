export type CameraPlaybackStatus = 'LIVE' | 'RECONNECTING' | 'OFFLINE';

export type CameraSurface = 'wall' | 'focus';

export type RelativeBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen?: boolean | undefined;
};

export type AbsoluteBounds = RelativeBounds;

export type CameraSummary = {
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
  enabled: boolean;
  bitrateLimit?: number | null | undefined;
};

export type CameraRecord = CameraSummary & {
  username: string | null;
  password: string | null;
};

export type CameraPlaybackConfig = CameraSummary & {
  cameraId: string;
  providerType: 'external-mpv' | 'webrtc';
  sanitizedRtspUrl: string | null;
  error: string | null;
  streamPath: string | null;
  webrtcUrl: string | null;
};

export type CameraSessionState = {
  sessionId: string;
  cameraId: string;
  cameraName: string;
  surface: CameraSurface;
  status: CameraPlaybackStatus;
  updatedAt: string;
  mpvInstalled: boolean;
  provider?: 'mpv' | 'webrtc' | 'demo' | undefined;
  playbackState?: 'idle' | 'connecting' | 'running' | 'error' | 'stopped' | undefined;
  processState?: 'starting' | 'running' | 'exited' | 'failed' | undefined;
  pid?: number | null | undefined;
  retryDelaySeconds?: number | undefined;
  lastExitCode?: number | null | undefined;
  lastError?: string | null | undefined;
  message?: string | undefined;
};

export type CameraLayoutSync = {
  cameraId: string;
  surface: CameraSurface;
  bounds: RelativeBounds;
};

export type MpvAvailability = {
  installed: boolean;
  executable: string | null;
};

export type CameraTestInput = {
  cameraId?: string | undefined;
  name: string;
  rtspUrl: string | null;
  username: string | null;
  password: string | null;
};

export type CameraTestResult = {
  success: boolean;
  message: string;
};
