export type CameraVendor = 'AXIS' | 'HIKVISION' | 'CUSTOM';
export type CameraQualityPreset = 'LOW' | 'STANDARD' | 'HIGH';

export type RtspBuilderInput = {
  host: string;
  rtspPort?: number | null;
  username?: string | null;
  password?: string | null;
  includeCredentials?: boolean | undefined;
};

export type AxisRtspBuilderInput = RtspBuilderInput & {
  qualityPreset?: CameraQualityPreset | null | undefined;
};

export const RTSP_PROTOCOL_PATTERN = /^rtsps?:\/\//i;

export const QUALITY_PRESETS: Record<
  CameraQualityPreset,
  {
    resolution: string;
    fps: number;
    compression: number;
  }
> = {
  LOW: {
    resolution: '640x360',
    fps: 8,
    compression: 45,
  },
  STANDARD: {
    resolution: '1024x576',
    fps: 10,
    compression: 35,
  },
  HIGH: {
    resolution: '1280x720',
    fps: 15,
    compression: 30,
  },
};

const trimToNull = (value: string | null | undefined) => {
  const normalized = value?.trim();
  return normalized ? normalized : null;
};

const normalizePort = (value: number | null | undefined, fallback: number) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 65535) {
    return Math.floor(value);
  }

  return fallback;
};

const buildBaseUrl = ({ host, rtspPort, username, password, includeCredentials = true }: RtspBuilderInput, fallbackPort: number) => {
  const normalizedHost = trimToNull(host);
  if (!normalizedHost) {
    throw new Error('Host is required to build RTSP URL.');
  }

  const source = new URL(`rtsp://${normalizedHost}`);
  const url = new URL('rtsp://placeholder');
  url.protocol = 'rtsp:';
  url.hostname = source.hostname;
  url.port = String(source.port ? Number(source.port) : normalizePort(rtspPort, fallbackPort));

  if (includeCredentials) {
    const normalizedUsername = trimToNull(username);
    const normalizedPassword = trimToNull(password);
    if (normalizedUsername) {
      url.username = normalizedUsername;
    }
    if (normalizedPassword) {
      url.password = normalizedPassword;
    }
  }

  return url;
};

export const buildAxisRtspUrl = (input: AxisRtspBuilderInput) => {
  const url = buildBaseUrl(input, 554);
  const preset = QUALITY_PRESETS[input.qualityPreset ?? 'STANDARD'];

  url.pathname = '/axis-media/media.amp';
  url.searchParams.set('videocodec', 'h264');
  url.searchParams.set('resolution', preset.resolution);
  url.searchParams.set('fps', String(preset.fps));
  url.searchParams.set('compression', String(preset.compression));
  return url.toString();
};

export const buildHikvisionRtspUrl = (input: RtspBuilderInput) => {
  const url = buildBaseUrl(input, 554);
  url.pathname = '/Streaming/Channels/101';
  return url.toString();
};

export const sanitizeRtspUrl = (value: string | null | undefined) => {
  const normalized = trimToNull(value);
  if (!normalized) {
    return null;
  }

  try {
    const url = new URL(normalized);
    if (url.password) {
      url.password = '***';
    }
    return url.toString();
  } catch {
    return normalized.replace(/:\/\/([^:/?#]+):([^@/?#]+)@/g, '://$1:***@');
  }
};

export const isFullRtspUrl = (value: string) => RTSP_PROTOCOL_PATTERN.test(value);

export const trimOptionalString = trimToNull;
