import {
  buildAxisRtspUrl,
  buildHikvisionRtspUrl,
  isFullRtspUrl,
  sanitizeRtspUrl as sanitizeBuiltRtspUrl,
  trimOptionalString,
  type CameraQualityPreset,
  type CameraVendor,
} from './rtsp-url-builder.js';

type ResolveRtspUrlInput = {
  vendor: CameraVendor;
  host?: string | null | undefined;
  rtspPort?: number | null | undefined;
  username?: string | null | undefined;
  password?: string | null | undefined;
  qualityPreset?: CameraQualityPreset | null | undefined;
  customRtspUrl?: string | null | undefined;
  rtspUrl?: string | null | undefined;
};

export type ResolvedRtspUrl = {
  rtspUrl: string | null;
  sanitizedRtspUrl: string | null;
  error: string | null;
  source: 'custom' | 'vendor';
};

export const sanitizeRtspUrl = sanitizeBuiltRtspUrl;

const applyCredentialsToFullRtspUrl = (
  rtspUrl: string,
  username: string | null,
  password: string | null,
) => {
  const parsed = new URL(rtspUrl);
  if (!/^rtsps?:$/i.test(parsed.protocol)) {
    throw new Error('RTSP URL must start with rtsp:// or rtsps://');
  }

  if (parsed.username || parsed.password) {
    return parsed.toString();
  }

  if (username) {
    parsed.username = username;
  }

  if (password) {
    parsed.password = password;
  }

  return parsed.toString();
};

const resolveHostInput = (input: ResolveRtspUrlInput) => {
  const host = trimOptionalString(input.host);
  if (host) {
    return host;
  }

  const legacy = trimOptionalString(input.rtspUrl);
  if (!legacy || isFullRtspUrl(legacy)) {
    return null;
  }

  try {
    const parsed = new URL(`rtsp://${legacy}`);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    if (parsed.hostname.length > 0 && (normalizedPath === '' || normalizedPath === '/') && !parsed.search && !parsed.hash) {
      return legacy;
    }
  } catch {
    return null;
  }

  return null;
};

export const resolveRtspUrl = (input: ResolveRtspUrlInput): ResolvedRtspUrl => {
  const customRtspUrl = trimOptionalString(input.customRtspUrl) ?? trimOptionalString(input.rtspUrl);
  const username = trimOptionalString(input.username);
  const password = trimOptionalString(input.password);

  if (customRtspUrl && isFullRtspUrl(customRtspUrl)) {
    try {
      const rtspUrl = applyCredentialsToFullRtspUrl(customRtspUrl, username, password);

      return {
        rtspUrl,
        sanitizedRtspUrl: sanitizeBuiltRtspUrl(rtspUrl),
        error: null,
        source: 'custom',
      };
    } catch (error) {
      return {
        rtspUrl: null,
        sanitizedRtspUrl: sanitizeBuiltRtspUrl(customRtspUrl),
        error: error instanceof Error ? error.message : 'Invalid RTSP URL.',
        source: 'custom',
      };
    }
  }

  const host = resolveHostInput(input);
  if (!host) {
    return {
      rtspUrl: null,
      sanitizedRtspUrl: null,
      error: input.vendor === 'CUSTOM' ? 'Custom RTSP URL is required.' : 'Host or DDNS name is required.',
      source: input.vendor === 'CUSTOM' ? 'custom' : 'vendor',
    };
  }

  try {
    const rtspUrl =
      input.vendor === 'AXIS'
        ? buildAxisRtspUrl({
            host,
            rtspPort: input.rtspPort ?? null,
            username,
            password,
            qualityPreset: input.qualityPreset ?? 'STANDARD',
            includeCredentials: true,
          })
        : input.vendor === 'HIKVISION'
          ? buildHikvisionRtspUrl({
              host,
              rtspPort: input.rtspPort ?? null,
              username,
              password,
              includeCredentials: true,
            })
          : customRtspUrl && !isFullRtspUrl(customRtspUrl)
            ? customRtspUrl
            : null;

    if (!rtspUrl) {
      throw new Error('Custom RTSP URL is required.');
    }

    return {
      rtspUrl,
      sanitizedRtspUrl: sanitizeBuiltRtspUrl(rtspUrl),
      error: null,
      source: input.vendor === 'CUSTOM' ? 'custom' : 'vendor',
    };
  } catch (error) {
    return {
      rtspUrl: null,
      sanitizedRtspUrl: null,
      error: error instanceof Error ? error.message : 'Unable to build RTSP URL.',
      source: input.vendor === 'CUSTOM' ? 'custom' : 'vendor',
    };
  }
};
