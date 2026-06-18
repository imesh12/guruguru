type AdminApiClientConfig = {
  adminApiUrl: string;
  agentToken: string;
  requestTimeoutMs: number;
};

type SendLocationInput = {
  vehicleId: string;
  routeId: string | null;
  gnssTime: string;
  latitude: number;
  longitude: number;
  raw: unknown;
};

export class AdminApiClient {
  private readonly config: AdminApiClientConfig;

  constructor(config: AdminApiClientConfig) {
    this.config = config;
  }

  async sendLocation(input: SendLocationInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await fetch(`${this.config.adminApiUrl}/api/vehicles/${encodeURIComponent(input.vehicleId)}/location`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.agentToken}`,
        },
        body: JSON.stringify({
          routeId: input.routeId,
          source: 'rooster-se220',
          gnssTime: input.gnssTime,
          latitude: input.latitude,
          longitude: input.longitude,
          status: 'ONLINE',
          raw: input.raw,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await response.text().catch(() => '');
        throw new Error(`Admin API request failed with HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 200)}` : ''}`);
      }

      return (await response.json()) as {
        ok: boolean;
        vehicleId: string;
        receivedAt: string;
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
