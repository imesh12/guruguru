import type { LocationProvider } from './location-provider.js';
import { Se220AuthBlockedError, Se220DirectClient } from './se220-direct-client.js';
import { LocationStatus, type LocationProviderStatusSnapshot, type VehicleLocation } from './types.js';
import type { LocationManager } from './location-manager.js';

type PollerLogger = {
  info?: (context: unknown, message?: string) => void;
  warn?: (context: unknown, message?: string) => void;
  error?: (context: unknown, message?: string) => void;
};

type DirectPollerTarget = {
  vehicleId: string;
  routeId: string | null;
  baseUrl: string;
  client: Se220DirectClient;
};

type DirectPollerRuntimeState = {
  status: LocationStatus;
  lastUpdateAt: string | null;
  error: string | null;
  inFlight: boolean;
  successCountSinceLastLog: number;
  lastSuccessLogAt: number;
  lastCoordinateSignature: string | null;
  lastCoordinateChangeAtMs: number | null;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastGnssTime: string | null;
  lastPollStartedAt: string | null;
  lastPollCompletedAt: string | null;
  lastPollCompletedAtMs: number | null;
};

const SUCCESS_LOG_INTERVAL_MS = 30_000;
const STALE_SAMPLE_THRESHOLD_MS = 15_000;
const SUSPICIOUS_JUMP_SPEED_MPS = 35;

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  return value.trim().toLowerCase() === 'true';
};

const parsePositiveInteger = (value: string | undefined, fallback: number, key: string) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}. Expected a positive integer.`);
  }

  return parsed;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const calculateDistanceMeters = (fromLat: number, fromLng: number, toLat: number, toLng: number) => {
  const earthRadiusMeters = 6_371_000;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
};

const calculateHeadingDegrees = (fromLat: number, fromLng: number, toLat: number, toLng: number) => {
  const startLat = toRadians(fromLat);
  const endLat = toRadians(toLat);
  const deltaLng = toRadians(toLng - fromLng);
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
};

/**
 * Parses `SE220_DIRECT_POLLERS` entries in the form:
 *
 * Static token fallback:
 * `vehicle-001|route-001|https://219.112.88.189|token1`
 *
 * Recommended auto-login mode:
 * `vehicle-001|route-001|https://219.112.88.189|admin|password`
 *
 * This mode fits the current two-vehicle deployment where each SE220 is
 * reachable by public IP from the admin office. For larger fleets or changing
 * mobile IPs, VPN, DDNS, or the existing vehicle-agent pattern is safer.
 */
const parseDirectPollers = (
  raw: string | undefined,
  allowSelfSigned: boolean,
  requestTimeoutMs: number,
  authLockCooldownMs: number,
  logger?: PollerLogger,
) => {
  if (!raw?.trim()) {
    return [];
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const parts = entry.split('|').map((part) => part.trim());
      if (parts.length !== 4 && parts.length !== 5) {
        throw new Error(`Invalid SE220_DIRECT_POLLERS entry at index ${index}. Expected vehicleId|routeId|baseUrl|token or vehicleId|routeId|baseUrl|username|password.`);
      }

      const [vehicleId, routeIdRaw, baseUrlRaw] = parts;
      if (!vehicleId || !baseUrlRaw) {
        throw new Error(`Invalid SE220_DIRECT_POLLERS entry at index ${index}. Expected vehicleId|routeId|baseUrl|token or vehicleId|routeId|baseUrl|username|password.`);
      }

      const routeId = routeIdRaw ? routeIdRaw : null;
      const baseUrl = baseUrlRaw.replace(/\/+$/u, '');
      const sharedConfig = {
        vehicleId,
        baseUrl,
        allowSelfSigned,
        requestTimeoutMs,
        authLockCooldownMs,
        ...(logger ? { logger } : {}),
      };

      const client =
        parts.length === 4
          ? new Se220DirectClient({
              ...sharedConfig,
              token: parts[3] ?? '',
            })
          : new Se220DirectClient({
              ...sharedConfig,
              username: parts[3] ?? '',
              password: parts[4] ?? '',
            });

      if (parts.length === 4 && !(parts[3] ?? '').trim()) {
        throw new Error(`Invalid SE220_DIRECT_POLLERS entry at index ${index}. Static token mode requires a non-empty token.`);
      }
      if (parts.length === 5 && (!(parts[3] ?? '').trim() || !(parts[4] ?? '').trim())) {
        throw new Error(`Invalid SE220_DIRECT_POLLERS entry at index ${index}. Auto-login mode requires non-empty username and password.`);
      }

      return {
        vehicleId,
        routeId,
        baseUrl,
        client,
      } satisfies DirectPollerTarget;
    });
};

export class Se220DirectPoller implements LocationProvider {
  readonly id = 'rooster-se220-direct';

  private readonly enabled: boolean;
  private readonly pollIntervalMs: number;
  private readonly gnssStaleThresholdMs: number;
  private readonly targets: DirectPollerTarget[];
  private readonly logger: PollerLogger | undefined;
  private readonly runtimeStateByVehicle = new Map<string, DirectPollerRuntimeState>();
  private timer?: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly locationManager: LocationManager,
    logger?: PollerLogger,
  ) {
    this.logger = logger;
    this.enabled = parseBoolean(process.env.SE220_DIRECT_POLLING_ENABLED, false);
    const requestTimeoutMs = parsePositiveInteger(
      process.env.SE220_DIRECT_REQUEST_TIMEOUT_MS,
      3000,
      'SE220_DIRECT_REQUEST_TIMEOUT_MS',
    );
    const authLockCooldownMs = parsePositiveInteger(
      process.env.SE220_DIRECT_AUTH_LOCK_COOLDOWN_MS,
      300_000,
      'SE220_DIRECT_AUTH_LOCK_COOLDOWN_MS',
    );
    this.pollIntervalMs = parsePositiveInteger(
      process.env.SE220_DIRECT_POLL_INTERVAL_MS,
      1000,
      'SE220_DIRECT_POLL_INTERVAL_MS',
    );
    this.gnssStaleThresholdMs = parsePositiveInteger(
      process.env.SE220_GNSS_STALE_THRESHOLD_MS,
      5000,
      'SE220_GNSS_STALE_THRESHOLD_MS',
    );
    const allowSelfSigned = parseBoolean(process.env.SE220_DIRECT_ALLOW_SELF_SIGNED, true);
    this.targets = parseDirectPollers(process.env.SE220_DIRECT_POLLERS, allowSelfSigned, requestTimeoutMs, authLockCooldownMs, logger);

    for (const target of this.targets) {
      this.runtimeStateByVehicle.set(target.vehicleId, {
        status: this.enabled ? LocationStatus.OFFLINE : LocationStatus.OFFLINE,
        lastUpdateAt: null,
        error: null,
        inFlight: false,
        successCountSinceLastLog: 0,
        lastSuccessLogAt: Date.now(),
        lastCoordinateSignature: null,
        lastCoordinateChangeAtMs: null,
        lastLatitude: null,
        lastLongitude: null,
        lastGnssTime: null,
        lastPollStartedAt: null,
        lastPollCompletedAt: null,
        lastPollCompletedAtMs: null,
      });
    }
  }

  getStatus(): LocationProviderStatusSnapshot {
    if (!this.enabled) {
      return {
        providerId: this.id,
        status: LocationStatus.OFFLINE,
        lastUpdateAt: null,
        error: null,
      };
    }

    const states = Array.from(this.runtimeStateByVehicle.values());
    const status =
      states.find((state) => state.status === LocationStatus.ERROR)?.status ??
      states.find((state) => state.status === LocationStatus.OFFLINE)?.status ??
      states.find((state) => state.status === LocationStatus.STALE)?.status ??
      states.find((state) => state.status === LocationStatus.NO_FIX)?.status ??
      states.find((state) => state.status === LocationStatus.ONLINE)?.status ??
      LocationStatus.OFFLINE;

    const lastUpdateAt = states
      .map((state) => state.lastUpdateAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;

    const error = states.map((state) => state.error).find((value): value is string => Boolean(value)) ?? null;

    return {
      providerId: this.id,
      status,
      lastUpdateAt,
      error,
    };
  }

  async start() {
    if (!this.enabled) {
      this.logger?.info?.({ providerId: this.id }, 'SE220 direct polling is disabled.');
      return;
    }

    if (this.running) {
      return;
    }

    this.running = true;
    this.logger?.info?.(
      {
        providerId: this.id,
        vehicleCount: this.targets.length,
      },
      'Starting direct SE220 polling for public-IP vehicle routers.',
    );

    await this.runCycle();
    this.scheduleNextCycle();
  }

  async stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextCycle() {
    if (!this.running) {
      return;
    }

    this.timer = setTimeout(() => {
      void this.runCycle()
        .catch((error) => {
          this.logger?.warn?.({ error, providerId: this.id }, 'SE220 direct polling cycle failed.');
        })
        .finally(() => {
          this.scheduleNextCycle();
        });
    }, this.pollIntervalMs);
  }

  private async runCycle() {
    await Promise.all(this.targets.map((target) => this.pollTarget(target)));
  }

  private async pollTarget(target: DirectPollerTarget) {
    const state = this.runtimeStateByVehicle.get(target.vehicleId);
    if (!state) {
      return;
    }

    if (state.inFlight) {
      return;
    }

    const authState = target.client.getAuthState();
    if (authState.status === 'LOCKED' || authState.status === 'COOLDOWN') {
      state.status = LocationStatus.ERROR;
      state.error = authState.error;
      return;
    }

    state.inFlight = true;
    try {
      const localPollStartedAtMs = Date.now();
      const localPollTime = new Date(localPollStartedAtMs).toISOString();
      const previousPollStartedAtMs =
        state.lastPollStartedAt === null ? null : Date.parse(state.lastPollStartedAt);
      const effectiveUpdateIntervalMs =
        previousPollStartedAtMs === null ? null : Math.max(0, localPollStartedAtMs - previousPollStartedAtMs);
      state.lastPollStartedAt = localPollTime;
      const next = await target.client.getGnssInfo();
      const apiPollReceivedAtMs = Date.now();
      const receivedAt = new Date(apiPollReceivedAtMs).toISOString();
      const requestDurationMs = Math.max(0, apiPollReceivedAtMs - localPollStartedAtMs);
      const routerSampleAgeMs = Math.max(0, apiPollReceivedAtMs - Date.parse(next.gnssTime));
      const gnssStale = routerSampleAgeMs >= this.gnssStaleThresholdMs;
      const communicationFresh = true;
      const positionFresh = !gnssStale;
      const coordinateSignature = `${next.latitude.toFixed(6)},${next.longitude.toFixed(6)}`;
      const coordinateChanged = state.lastCoordinateSignature !== coordinateSignature;
      const intervalSinceLastCoordinateChangeMs = state.lastCoordinateChangeAtMs === null ? null : apiPollReceivedAtMs - state.lastCoordinateChangeAtMs;
      const duplicateSample =
        !coordinateChanged &&
        state.lastGnssTime === next.gnssTime &&
        state.lastLatitude === next.latitude &&
        state.lastLongitude === next.longitude;
      const distanceFromPreviousMeters =
        state.lastLatitude === null || state.lastLongitude === null
          ? null
          : calculateDistanceMeters(state.lastLatitude, state.lastLongitude, next.latitude, next.longitude);
      const timeDeltaSeconds =
        state.lastGnssTime === null ? null : Math.max(0, (Date.parse(next.gnssTime) - Date.parse(state.lastGnssTime)) / 1000);
      const speedEstimateMps =
        distanceFromPreviousMeters === null || timeDeltaSeconds === null || timeDeltaSeconds <= 0
          ? null
          : distanceFromPreviousMeters / timeDeltaSeconds;
      const headingEstimateDeg =
        state.lastLatitude === null || state.lastLongitude === null
          ? null
          : calculateHeadingDegrees(state.lastLatitude, state.lastLongitude, next.latitude, next.longitude);
      const suspiciousJump =
        coordinateChanged &&
        distanceFromPreviousMeters !== null &&
        speedEstimateMps !== null &&
        speedEstimateMps > SUSPICIOUS_JUMP_SPEED_MPS;

      this.logger?.info?.(
        {
          providerId: this.id,
          vehicleId: target.vehicleId,
          routeId: target.routeId,
          localPollTime,
          apiPollReceivedAt: receivedAt,
          requestDurationMs,
          effectiveUpdateIntervalMs,
          lastPollStartedAt: localPollTime,
          lastPollCompletedAt: receivedAt,
          routerGnssTime: next.gnssTime,
          latitude: next.latitude,
          longitude: next.longitude,
          gnssStaleThresholdMs: this.gnssStaleThresholdMs,
          gnssStale,
          communicationFresh,
          positionFresh,
          coordinateChanged,
          ageMs: routerSampleAgeMs,
          intervalSinceLastCoordinateChangeMs,
          distanceFromPreviousMeters,
          speedEstimateMps,
          headingEstimateDeg,
          suspiciousJump,
          duplicateSample,
        },
        '[gnss-investigation] poll',
      );

      if (routerSampleAgeMs >= STALE_SAMPLE_THRESHOLD_MS) {
        this.logger?.warn?.(
          {
            providerId: this.id,
            vehicleId: target.vehicleId,
            routerGnssTime: next.gnssTime,
            localPollTime,
            ageMs: routerSampleAgeMs,
          },
          '[gnss-investigation] stale sample',
        );
      } else if (coordinateChanged) {
        this.logger?.info?.(
          {
            providerId: this.id,
            vehicleId: target.vehicleId,
            routerGnssTime: next.gnssTime,
            latitude: next.latitude,
            longitude: next.longitude,
            intervalSinceLastCoordinateChangeMs,
            distanceFromPreviousMeters,
            speedEstimateMps,
            headingEstimateDeg,
            suspiciousJump,
          },
          '[gnss-investigation] coordinate changed',
        );
      } else {
        this.logger?.info?.(
          {
            providerId: this.id,
            vehicleId: target.vehicleId,
            routerGnssTime: next.gnssTime,
            latitude: next.latitude,
            longitude: next.longitude,
            ageMs: routerSampleAgeMs,
            intervalSinceLastCoordinateChangeMs,
            duplicateSample,
          },
          '[gnss-investigation] coordinate unchanged',
        );
      }

      const payload: VehicleLocation = {
        vehicleId: target.vehicleId,
        routeId: target.routeId,
        latitude: next.latitude,
        longitude: next.longitude,
        gnssTime: next.gnssTime,
        receivedAt,
        source: 'rooster-se220-direct',
        status: LocationStatus.ONLINE,
        error: null,
        rawJson: JSON.stringify(next.raw),
        investigation: {
          localPollTime,
          apiPollReceivedAt: receivedAt,
          routerGnssTime: next.gnssTime,
          routerSampleAgeMs,
          gnssStaleThresholdMs: this.gnssStaleThresholdMs,
          gnssStale,
          communicationFresh,
          positionFresh,
          coordinateChanged,
          intervalSinceLastCoordinateChangeMs,
          distanceFromPreviousMeters,
          speedEstimateMps,
          headingEstimateDeg,
          suspiciousJump,
          duplicateSample,
          requestDurationMs,
          effectiveUpdateIntervalMs,
          lastPollStartedAt: localPollTime,
          lastPollCompletedAt: receivedAt,
        },
      };

      await this.locationManager.ingestLocation(payload);
      state.status = LocationStatus.ONLINE;
      state.lastUpdateAt = receivedAt;
      state.lastPollCompletedAt = receivedAt;
      state.lastPollCompletedAtMs = apiPollReceivedAtMs;
      state.error = null;
      state.successCountSinceLastLog += 1;
      state.lastCoordinateSignature = coordinateSignature;
      state.lastLatitude = next.latitude;
      state.lastLongitude = next.longitude;
      state.lastGnssTime = next.gnssTime;
      if (coordinateChanged || state.lastCoordinateChangeAtMs === null) {
        state.lastCoordinateChangeAtMs = apiPollReceivedAtMs;
      }

      const now = Date.now();
      if (now - state.lastSuccessLogAt >= SUCCESS_LOG_INTERVAL_MS) {
        this.logger?.info?.(
          {
            providerId: this.id,
            vehicleId: target.vehicleId,
            routeId: target.routeId,
            successCount: state.successCountSinceLastLog,
            gnssTime: next.gnssTime,
            latitude: next.latitude,
            longitude: next.longitude,
          },
          'SE220 direct polling success summary.',
        );
        state.successCountSinceLastLog = 0;
        state.lastSuccessLogAt = now;
      }
    } catch (error) {
      if (error instanceof Se220AuthBlockedError) {
        state.status = LocationStatus.ERROR;
        state.error = error.message;
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      state.status = LocationStatus.ERROR;
      state.error = message;

      this.logger?.warn?.(
        {
          providerId: this.id,
          vehicleId: target.vehicleId,
          routeId: target.routeId,
          error: message,
        },
        'SE220 direct polling failed for vehicle.',
      );
    } finally {
      state.inFlight = false;
    }
  }
}
