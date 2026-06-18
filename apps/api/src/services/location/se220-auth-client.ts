export type Se220AuthClientConfig = {
  baseUrl: string;
  allowSelfSigned: boolean;
  requestTimeoutMs: number;
};

export class Se220LoginError extends Error {
  readonly code: 'LOCKED' | 'LOGIN_FAILED';

  constructor(code: 'LOCKED' | 'LOGIN_FAILED', message: string) {
    super(message);
    this.name = 'Se220LoginError';
    this.code = code;
  }
}

type Se220LoginResponse = {
  result?: unknown;
  message?: unknown;
  data?: {
    login?: unknown;
    token?: unknown;
    defaultPassword?: unknown;
    locked?: unknown;
  };
};

/**
 * Backend-only SE220 login client. Credentials and issued tokens must remain
 * server-side and are never written to logs.
 */
export class Se220AuthClient {
  private readonly config: Se220AuthClientConfig;

  constructor(config: Se220AuthClientConfig) {
    this.config = config;
  }

  async login(baseUrl: string, username: string, password: string) {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/u, '');
    const requestUrl = `${normalizedBaseUrl}/api/login.cgi`;
    const response = await this.requestJson(requestUrl, {
      user: username,
      password,
    });

    if (response.result !== true) {
      const message = typeof response.message === 'string' && response.message.trim() ? response.message.trim() : 'SE220 login returned result=false.';
      if (response.data?.locked === true || message.toLowerCase().includes('locked')) {
        throw new Se220LoginError('LOCKED', message);
      }
      throw new Se220LoginError('LOGIN_FAILED', message);
    }

    const data = response.data;
    if (!data || typeof data !== 'object') {
      throw new Se220LoginError('LOGIN_FAILED', 'SE220 login response is missing data.');
    }
    if (data.locked === true) {
      throw new Se220LoginError('LOCKED', 'SE220 login is locked.');
    }
    if (data.login !== true) {
      throw new Se220LoginError('LOGIN_FAILED', 'SE220 login was not accepted.');
    }
    if (typeof data.token !== 'string' || !data.token.trim()) {
      throw new Se220LoginError('LOGIN_FAILED', 'SE220 login response is missing token.');
    }

    return data.token.trim();
  }

  private async requestJson(requestUrl: string, body: { user: string; password: string }) {
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
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Se220LoginError('LOGIN_FAILED', `SE220 login failed with HTTP ${response.status}.`);
      }

      try {
        return JSON.parse(text) as Se220LoginResponse;
      } catch {
        throw new Se220LoginError('LOGIN_FAILED', 'SE220 login returned invalid JSON.');
      }
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
}
