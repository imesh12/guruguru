const SECRET_KEYS = ['password', 'api_token', 'credential_encryption_key', 'authorization'] as const;

export const sanitizeRtspUrl = (value: string | null | undefined) => {
  if (!value) {
    return value ?? null;
  }

  try {
    const url = new URL(value);
    if (url.password) {
      url.password = '***';
    }
    if (url.username) {
      url.username = url.username;
    }
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:/]+):([^@]+)@/g, '://$1:***@');
  }
};

export const sanitizeForLogs = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return sanitizeRtspUrl(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeForLogs(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (SECRET_KEYS.includes(key.toLowerCase() as (typeof SECRET_KEYS)[number])) {
        return [key, '[REDACTED]'];
      }

      if (key.toLowerCase().includes('rtsp')) {
        return [key, typeof entry === 'string' ? sanitizeRtspUrl(entry) : sanitizeForLogs(entry)];
      }

      return [key, sanitizeForLogs(entry)];
    }),
  );
};
