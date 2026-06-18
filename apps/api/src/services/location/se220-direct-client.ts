import { Se220AuthClient, Se220LoginError } from './se220-auth-client.js';

export type Se220DirectClientConfig = {
  baseUrl: string;
  allowSelfSigned: boolean;
  requestTimeoutMs: number;
  authLockCooldownMs: number;
  vehicleId: string;
  logger?: {
    info?: (context: unknown, message?: string) => void;
    warn?: (context: unknown, message?: string) => void;
  };
} & (
  | {
      token: string;
      username?: never;
      password?: never;
    }
  | {
      token?: never;
      username: string;
      password: string;
    }
);

export type Se220DirectLocation = {
  gnssTime: string;
  latitude: number;
  longitude: number;
  raw: unknown;
};

type Se220DirectApiResponse = {
  result?: unknown;
  message?: unknown;
  processState?: unknown;
  data?: {
    time?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  };
};

type Se220FetchResult = {
  status: number;
  body: string;
  json: Se220DirectApiResponse | null;
};

type Se220AuthState = {
  status: 'ACTIVE' | 'COOLDOWN' | 'LOCKED';
  retryAfterAt: number | null;
  error: string | null;
};

export class Se220AuthBlockedError extends Error {
  readonly code: 'LOCKED' | 'COOLDOWN';
  readonly retryAfterAt: number | null;

  constructor(code: 'LOCKED' | 'COOLDOWN', message: string, retryAfterAt: number | null) {
    super(message);
    this.name = 'Se220AuthBlockedError';
    this.code = code;
    this.retryAfterAt = retryAfterAt;
  }
}

const parseCoordinate = (label: 'latitude' | 'longitude', raw: unknown, min: number, max: number) => {
  if (typeof raw !== 'string') {
    throw new Error(`SE220 ${label} is missing.`);
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error(`SE220 ${label} is empty.`);
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`SE220 ${label} is out of range.`);
  }

  return value;
};

const parseGnssTime = (raw: unknown) => {
  if (typeof raw !== 'string') {
    throw new Error('SE220 gnssTime is missing.');
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('SE220 gnssTime is empty.');
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    throw new Error('SE220 gnssTime is invalid.');
  }

  return new Date(timestamp).toISOString();
};

const getAuthLikeMessage = (response: Se220DirectApiResponse | null) => {
  const candidates = [response?.message, response?.processState]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return candidates.find((value) =>
    ['auth', 'token', 'login', 'unauthorized', 'forbidden', 'session', 'permission'].some((needle) => value.includes(needle)),
  );
};

const isAuthFailure = (result: Se220FetchResult) => {
  if (result.status === 401 || result.status === 403) {
    return true;
  }

  const body = result.body.toLowerCase();
  if (body.includes('error 401') || body.includes('error 403')) {
    return true;
  }

  if (result.json?.result === false && getAuthLikeMessage(result.json)) {
    return true;
  }

  return false;
};

/**
 * Backend-only Rooster SE220 GNSS client. Static token mode remains supported,
 * and username/password mode logs in server-side and refreshes the token in
 * memory when the router session changes.
 */
export class Se220DirectClient {
  private readonly config: Se220DirectClientConfig;
  private readonly authClient: Se220AuthClient;
  private cachedToken: string | null = null;
  private authState: Se220AuthState = {
    status: 'ACTIVE',
    retryAfterAt: null,
    error: null,
  };

  constructor(config: Se220DirectClientConfig) {
    this.config = config;
    this.authClient = new Se220AuthClient({
      baseUrl: config.baseUrl,
      allowSelfSigned: config.allowSelfSigned,
      requestTimeoutMs: config.requestTimeoutMs,
    });

    if ('token' in config && typeof config.token === 'string') {
      this.cachedToken = config.token;
    }
  }

  async getGnssInfo() {
    this.ensureAuthAllowed();
    const normalizedBaseUrl = this.config.baseUrl.replace(/\/+$/u, '');
    const loginAttemptedRef = { current: false };
    const initialToken = await this.getToken({ forceRefresh: false, loginAttemptedRef });
    const firstResult = await this.requestGnss(normalizedBaseUrl, initialToken);

    if (this.shouldRetryAfterAuthFailure(firstResult) && !loginAttemptedRef.current) {
      this.loggerInfo('SE220 token refresh after auth failure vehicleId=...');
      this.clearCachedToken();
      const retryToken = await this.getToken({ forceRefresh: true, loginAttemptedRef });
      const retryResult = await this.requestGnss(normalizedBaseUrl, retryToken);
      return this.parseGnssResponse(retryResult);
    }

    return this.parseGnssResponse(firstResult);
  }

  getAuthState() {
    if (this.authState.status !== 'ACTIVE' && this.authState.retryAfterAt !== null && Date.now() >= this.authState.retryAfterAt) {
      this.authState = {
        status: 'ACTIVE',
        retryAfterAt: null,
        error: null,
      };
    }

    return this.authState;
  }

  private ensureAuthAllowed() {
    const authState = this.getAuthState();
    if (authState.status === 'LOCKED') {
      throw new Se220AuthBlockedError('LOCKED', 'SE220 account locked.', authState.retryAfterAt);
    }
    if (authState.status === 'COOLDOWN') {
      throw new Se220AuthBlockedError('COOLDOWN', 'SE220 login cooldown active.', authState.retryAfterAt);
    }
  }

  private async getToken({
    forceRefresh,
    loginAttemptedRef,
  }: {
    forceRefresh: boolean;
    loginAttemptedRef: { current: boolean };
  }) {
    if ('token' in this.config && typeof this.config.token === 'string') {
      return this.config.token;
    }

    this.ensureAuthAllowed();

    if (!forceRefresh && this.cachedToken) {
      return this.cachedToken;
    }

    if (loginAttemptedRef.current) {
      throw new Se220AuthBlockedError('COOLDOWN', 'SE220 login already attempted this poll cycle.', this.authState.retryAfterAt);
    }
    loginAttemptedRef.current = true;

    this.loggerInfo('SE220 auto-login attempted vehicleId=...');
    try {
      const token = await this.authClient.login(this.config.baseUrl, this.config.username, this.config.password);
      this.cachedToken = token;
      this.authState = {
        status: 'ACTIVE',
        retryAfterAt: null,
        error: null,
      };
      this.loggerInfo('SE220 auto-login succeeded vehicleId=...');
      return token;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.clearCachedToken();

      const retryAfterAt = Date.now() + this.config.authLockCooldownMs;
      if (error instanceof Se220LoginError && error.code === 'LOCKED') {
        this.authState = {
          status: 'LOCKED',
          retryAfterAt,
          error: message,
        };
        this.loggerWarn('SE220 account locked vehicleId=...', message, true);
        throw new Se220AuthBlockedError('LOCKED', 'SE220 account locked.', retryAfterAt);
      }

      this.authState = {
        status: 'COOLDOWN',
        retryAfterAt,
        error: message,
      };
      this.loggerWarn('SE220 login failed vehicleId=... message=...', message);
      throw new Se220AuthBlockedError('COOLDOWN', 'SE220 login cooldown active.', retryAfterAt);
    }
  }

  private clearCachedToken() {
    if ('token' in this.config && typeof this.config.token === 'string') {
      return;
    }

    this.cachedToken = null;
  }

  private shouldRetryAfterAuthFailure(result: Se220FetchResult) {
    if ('token' in this.config && typeof this.config.token === 'string') {
      return false;
    }

    return isAuthFailure(result);
  }

  private parseGnssResponse(result: Se220FetchResult) {
    if (isAuthFailure(result)) {
      throw new Error('SE220 authentication failed.');
    }

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`SE220 request failed with HTTP ${result.status}.`);
    }

    const response = result.json;
    if (!response) {
      throw new Error('SE220 returned invalid JSON.');
    }

    if (response.result !== true) {
      const authLikeMessage = getAuthLikeMessage(response);
      if (authLikeMessage) {
        throw new Error(`SE220 authentication failed: ${authLikeMessage}`);
      }

      const message = typeof response.message === 'string' && response.message.trim() ? response.message.trim() : 'SE220 returned result=false.';
      throw new Error(message);
    }

    const data = response.data;
    if (!data || typeof data !== 'object') {
      throw new Error('SE220 response is missing data.');
    }

    return {
      gnssTime: parseGnssTime(data.time),
      latitude: parseCoordinate('latitude', data.latitude, -90, 90),
      longitude: parseCoordinate('longitude', data.longitude, -180, 180),
      raw: response,
    } satisfies Se220DirectLocation;
  }

  private async requestGnss(normalizedBaseUrl: string, token: string) {
    const requestUrl = `${normalizedBaseUrl}/api/get_gnss_info.cgi?token=${token}`;
    return this.requestText(requestUrl);
  }

  private async requestText(requestUrl: string) {
    if (!requestUrl.startsWith('https://')) {
      throw new Error('SE220 direct polling requires HTTPS.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    const previousTlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

    try {
      if (this.config.allowSelfSigned) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      }

      const response = await fetch(requestUrl, {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
        signal: controller.signal,
      });

      const body = await response.text();
      let json: Se220DirectApiResponse | null = null;
      try {
        json = JSON.parse(body) as Se220DirectApiResponse;
      } catch {
        json = null;
      }

      return {
        status: response.status,
        body,
        json,
      } satisfies Se220FetchResult;
    } finally {
      clearTimeout(timeout);
      if (this.config.allowSelfSigned) {
        if (previousTlsRejectUnauthorized === undefined) {
          delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        } else {
          process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsRejectUnauthorized;
        }
      }
    }
  }

  private loggerInfo(message: string) {
    this.config.logger?.info?.(
      {
        vehicleId: this.config.vehicleId,
        baseUrl: this.config.baseUrl,
      },
      message.replace('vehicleId=...', `vehicleId=${this.config.vehicleId}`),
    );
  }

  private loggerWarn(message: string, error: string, omitErrorDetail = false) {
    this.config.logger?.warn?.(
      {
        vehicleId: this.config.vehicleId,
        baseUrl: this.config.baseUrl,
        ...(omitErrorDetail ? {} : { error }),
      },
      omitErrorDetail
        ? message.replace('vehicleId=...', `vehicleId=${this.config.vehicleId}`)
        : message
            .replace('vehicleId=...', `vehicleId=${this.config.vehicleId}`)
            .replace('message=...', `message=${error}`),
    );
  }
}
