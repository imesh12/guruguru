import https from 'node:https';
import { URL } from 'node:url';

type Se220ClientConfig = {
  baseUrl: string;
  token: string;
  allowSelfSigned: boolean;
  requestTimeoutMs: number;
};

export type Se220Location = {
  gnssTime: string;
  latitude: number;
  longitude: number;
  raw: unknown;
};

type Se220ApiResponse = {
  result?: unknown;
  message?: unknown;
  processState?: unknown;
  data?: {
    time?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  };
};

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

export class Se220Client {
  private readonly config: Se220ClientConfig;
  private readonly agent: https.Agent;

  constructor(config: Se220ClientConfig) {
    this.config = config;
    this.agent = new https.Agent({
      rejectUnauthorized: !config.allowSelfSigned,
    });
  }

  async getGnssInfo() {
    const url = new URL('/api/get_gnss_info.cgi', this.config.baseUrl);
    url.searchParams.set('token', this.config.token);

    const response = await this.requestJson(url);
    if (response.result !== true) {
      throw new Error(`SE220 returned result=false${typeof response.message === 'string' && response.message.trim() ? `: ${response.message.trim()}` : ''}`);
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
    } satisfies Se220Location;
  }

  private async requestJson(url: URL) {
    const transport = url.protocol === 'https:' ? https : undefined;
    if (!transport) {
      throw new Error('SE220 base URL must use HTTPS.');
    }

    return await new Promise<Se220ApiResponse>((resolve, reject) => {
      const request = transport.request(
        url,
        {
          method: 'GET',
          agent: this.agent,
          timeout: this.config.requestTimeoutMs,
          headers: {
            accept: 'application/json',
          },
        },
        (response) => {
          const chunks: Buffer[] = [];

          response.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });

          response.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
              reject(new Error(`SE220 request failed with HTTP ${response.statusCode ?? 500}.`));
              return;
            }

            try {
              resolve(JSON.parse(body) as Se220ApiResponse);
            } catch {
              reject(new Error('SE220 returned invalid JSON.'));
            }
          });
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error('SE220 request timed out.'));
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.end();
    });
  }
}
