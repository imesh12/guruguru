import { AdminApiClient } from './admin-api-client.js';
import { loadConfig } from './config.js';
import { Se220Client } from './se220-client.js';
import type { Se220Location } from './se220-client.js';

const config = loadConfig();

const se220Client =
  config.mockGnss || !config.se220BaseUrl || !config.se220Token
    ? null
    : new Se220Client({
        baseUrl: config.se220BaseUrl,
        token: config.se220Token,
        allowSelfSigned: config.se220AllowSelfSigned,
        requestTimeoutMs: config.requestTimeoutMs,
      });

const adminApiClient = new AdminApiClient({
  adminApiUrl: config.adminApiUrl,
  agentToken: config.agentToken,
  requestTimeoutMs: config.requestTimeoutMs,
});

let running = true;
let pollTimer: NodeJS.Timeout | null = null;
let inFlight = false;

const buildMockLocation = (): Se220Location => ({
  gnssTime: new Date().toISOString(),
  latitude: config.mockLatitude ?? 35.863239,
  longitude: config.mockLongitude ?? 139.658787,
  raw: {
    mock: true,
    vehicleId: config.vehicleId,
  },
});

const stop = async (signal: string) => {
  if (!running) {
    return;
  }

  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }

  console.log(`[vehicle-agent] shutdown signal=${signal} vehicle=${config.vehicleId}`);

  while (inFlight) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  process.exit(0);
};

const scheduleNextPoll = () => {
  if (!running) {
    return;
  }

  pollTimer = setTimeout(() => {
    void pollOnce();
  }, config.pollIntervalMs);
};

const pollOnce = async () => {
  if (!running) {
    return;
  }

  if (inFlight) {
    scheduleNextPoll();
    return;
  }

  inFlight = true;
  try {
    const location = config.mockGnss ? buildMockLocation() : await se220Client?.getGnssInfo();
    if (!location) {
      throw new Error('SE220 client is not configured.');
    }

    await adminApiClient.sendLocation({
      vehicleId: config.vehicleId,
      routeId: config.routeId,
      gnssTime: location.gnssTime,
      latitude: location.latitude,
      longitude: location.longitude,
      raw: location.raw,
    });

    console.log(
      `[vehicle-agent] sent vehicle=${config.vehicleId} lat=${location.latitude.toFixed(6)} lng=${location.longitude.toFixed(6)}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[vehicle-agent] error message=${message}`);
  } finally {
    inFlight = false;
    scheduleNextPoll();
  }
};

process.on('SIGINT', () => {
  void stop('SIGINT');
});

process.on('SIGTERM', () => {
  void stop('SIGTERM');
});

console.log(
  `[vehicle-agent] starting vehicle=${config.vehicleId} mode=${config.mockGnss ? 'mock' : 'se220'} adminApiUrl=${config.adminApiUrl}`,
);
void pollOnce();
