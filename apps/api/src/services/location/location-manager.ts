import type { LocationProvider } from './location-provider.js';
import { LocationHistoryStore } from './location-history-store.js';
import { LocationStatus, hasUsableCoordinates, type GpsQuality, type LocationInvestigationTelemetry, type LocationUpdateSubscriber, type VehicleLocation } from './types.js';

type LocationManagerLogger = {
  info?: (context: unknown, message?: string) => void;
  warn?: (context: unknown, message?: string) => void;
  error?: (context: unknown, message?: string) => void;
};

const MAX_REASONABLE_SPEED_MPS = 150 / 3.6;

const toRadians = (value: number) => (value * Math.PI) / 180;

const haversineMeters = (
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
) => {
  const earthRadiusMeters = 6_371_000;
  const deltaLat = toRadians(toLat - fromLat);
  const deltaLng = toRadians(toLng - fromLng);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(fromLat)) * Math.cos(toRadians(toLat)) * Math.sin(deltaLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
};

const toGpsQuality = (accuracyMeters: number | null): GpsQuality => {
  if (accuracyMeters === null || !Number.isFinite(accuracyMeters)) {
    return 'UNKNOWN';
  }
  if (accuracyMeters <= 15) {
    return 'GOOD';
  }
  if (accuracyMeters <= 50) {
    return 'FAIR';
  }
  return 'POOR';
};

/**
 * Central backend coordinator for realtime vehicle location state.
 *
 * This service is intentionally UI-agnostic. Providers can push normalized
 * updates into the manager, and later API routes or websocket publishers can
 * subscribe to the manager without knowing anything about the underlying source.
 */
export class LocationManager {
  private readonly providers = new Map<string, LocationProvider>();
  private readonly latestByVehicle = new Map<string, VehicleLocation>();
  private readonly subscribers = new Set<LocationUpdateSubscriber>();

  constructor(
    private readonly historyStore = new LocationHistoryStore(),
    private readonly logger?: LocationManagerLogger,
  ) {}

  /**
   * Registers a provider by id. Duplicate ids are rejected to keep lifecycle
   * behavior deterministic.
   */
  registerProvider(provider: LocationProvider) {
    if (this.providers.has(provider.id)) {
      throw new Error(`Location provider "${provider.id}" is already registered.`);
    }

    this.providers.set(provider.id, provider);
  }

  /**
   * Starts all registered providers.
   */
  async start() {
    for (const provider of this.providers.values()) {
      await provider.start();
      this.logger?.info?.({ providerId: provider.id }, 'Location provider started.');
    }
  }

  /**
   * Stops all registered providers.
   */
  async stop() {
    const providers = Array.from(this.providers.values()).reverse();
    for (const provider of providers) {
      await provider.stop();
      this.logger?.info?.({ providerId: provider.id }, 'Location provider stopped.');
    }
  }

  /**
   * Returns provider runtime status snapshots.
   */
  getProviderStatuses() {
    return Array.from(this.providers.values())
      .map((provider) => provider.getStatus())
      .sort((left, right) => left.providerId.localeCompare(right.providerId));
  }

  /**
   * Returns the last known location for one vehicle.
   */
  getLatestLocation(vehicleId: string) {
    return this.latestByVehicle.get(vehicleId) ?? null;
  }

  /**
   * Returns all latest vehicle locations in deterministic order.
   */
  listLatestLocations() {
    return Array.from(this.latestByVehicle.values()).sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
  }

  /**
   * Allows routes, websocket bridges, or other backend services to react to
   * normalized location updates.
   */
  subscribe(subscriber: LocationUpdateSubscriber) {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  /**
   * Ingests a normalized location update from a provider or a future edge-agent
   * intake route.
   *
   * The manager keeps a realtime latest-state view and forwards valid route
   * points to the history store.
   */
  async ingestLocation(location: VehicleLocation) {
    const ingestStartedAtMs = Date.now();
    const normalized = this.normalizeLocation(location);
    const previous = this.latestByVehicle.get(normalized.vehicleId);
    const impossibleJump = this.detectImpossibleJump(previous, normalized);

    if (impossibleJump) {
      this.logger?.warn?.(
        {
          vehicleId: normalized.vehicleId,
          source: normalized.source,
          previousReceivedAt: previous?.receivedAt ?? null,
          receivedAt: normalized.receivedAt,
          distanceMeters: impossibleJump.distanceMeters,
          elapsedSeconds: impossibleJump.elapsedSeconds,
          requiredSpeedKmh: impossibleJump.requiredSpeedMps * 3.6,
        },
        '[gps-filter] rejected impossible jump',
      );
      return previous ?? normalized;
    }

    if (!previous || this.compareLocationRecency(previous, normalized) <= 0) {
      this.latestByVehicle.set(normalized.vehicleId, normalized);
    } else {
      this.logger?.warn?.(
        {
          vehicleId: normalized.vehicleId,
          previousReceivedAt: previous.receivedAt,
          ignoredReceivedAt: normalized.receivedAt,
        },
        'Ignored out-of-order location update for latest-state tracking.',
      );
    }

    if (this.shouldAppendToHistory(normalized)) {
      try {
        await this.historyStore.appendLocation(normalized);
      } catch (error) {
        this.logger?.error?.(
          {
            error,
            vehicleId: normalized.vehicleId,
            status: normalized.status,
            gnssTime: normalized.gnssTime,
            receivedAt: normalized.receivedAt,
          },
          'Location history append failed during ingestLocation.',
        );
        throw error;
      }
    }

    const ingestCompletedAtMs = Date.now();
    normalized.investigation = {
      ...(normalized.investigation ?? {}),
      locationManagerReceivedAt: normalized.investigation?.locationManagerReceivedAt ?? new Date(ingestStartedAtMs).toISOString(),
      locationManagerUpdatedAt: new Date(ingestCompletedAtMs).toISOString(),
      locationManagerProcessingMs: ingestCompletedAtMs - ingestStartedAtMs,
    };

    this.logger?.info?.(
      {
        vehicleId: normalized.vehicleId,
        source: normalized.source,
        routerGnssTime: normalized.investigation?.routerGnssTime ?? normalized.gnssTime,
        receivedAt: normalized.receivedAt,
        locationManagerReceivedAt: normalized.investigation?.locationManagerReceivedAt,
        locationManagerUpdatedAt: normalized.investigation?.locationManagerUpdatedAt,
        locationManagerProcessingMs: normalized.investigation?.locationManagerProcessingMs ?? null,
      },
      '[gnss-investigation] location-manager update',
    );

    const snapshot = this.listLatestLocations();
    for (const subscriber of this.subscribers) {
      subscriber(normalized, snapshot);
    }

    return normalized;
  }

  /**
   * Exposes the persistence contract of the current history store.
   */
  getHistoryStoreInfo() {
    return this.historyStore.describePersistenceMode();
  }

  private normalizeLocation(location: VehicleLocation): VehicleLocation {
    const routeId = location.routeId?.trim() ? location.routeId.trim() : null;
    const source = location.source.trim();
    const error = location.error?.trim() ? location.error.trim() : null;
    const accuracyMeters = this.normalizePositiveNumber(location.accuracyMeters ?? null);
    const headingDegrees = this.normalizeBoundedNumber(location.headingDegrees ?? null, 0, 360, false);
    const speedMps = this.normalizeBoundedNumber(location.speedMps ?? null, 0, 80, true);
    const gpsQuality = toGpsQuality(accuracyMeters);

    if (gpsQuality === 'POOR') {
      this.logger?.warn?.(
        {
          vehicleId: location.vehicleId.trim(),
          source,
          accuracyMeters,
        },
        '[gps-quality] poor accuracy',
      );
    }

    return {
      vehicleId: location.vehicleId.trim(),
      routeId,
      latitude: this.normalizeCoordinate(location.latitude),
      longitude: this.normalizeCoordinate(location.longitude),
      accuracyMeters,
      headingDegrees,
      speedMps,
      gpsQuality,
      gnssTime: location.gnssTime?.trim() ? location.gnssTime.trim() : null,
      receivedAt: new Date(location.receivedAt).toISOString(),
      source,
      status: location.status,
      error,
      rawJson: location.rawJson?.trim() ? location.rawJson.trim() : null,
      investigation: this.normalizeInvestigation(location.investigation),
    };
  }

  private normalizeCoordinate(value: number | null) {
    if (value === null) {
      return null;
    }

    return Number.isFinite(value) ? value : null;
  }

  private normalizePositiveNumber(value: number | null) {
    if (value === null) {
      return null;
    }

    return Number.isFinite(value) && value > 0 ? value : null;
  }

  private normalizeBoundedNumber(
    value: number | null,
    min: number,
    max: number,
    maxInclusive: boolean,
  ) {
    if (value === null) {
      return null;
    }

    if (!Number.isFinite(value) || value < min) {
      return null;
    }

    if (maxInclusive ? value > max : value >= max) {
      return null;
    }

    return value;
  }

  private normalizeInvestigation(investigation: VehicleLocation['investigation']): LocationInvestigationTelemetry | null {
    if (!investigation) {
      return null;
    }

    return {
      localPollTime: investigation.localPollTime ?? null,
      apiPollReceivedAt: investigation.apiPollReceivedAt ?? null,
      routerGnssTime: investigation.routerGnssTime ?? null,
      routerSampleAgeMs: investigation.routerSampleAgeMs ?? null,
      coordinateChanged: investigation.coordinateChanged ?? null,
      intervalSinceLastCoordinateChangeMs: investigation.intervalSinceLastCoordinateChangeMs ?? null,
      distanceFromPreviousMeters: investigation.distanceFromPreviousMeters ?? null,
      speedEstimateMps: investigation.speedEstimateMps ?? null,
      headingEstimateDeg: investigation.headingEstimateDeg ?? null,
      suspiciousJump: investigation.suspiciousJump ?? null,
      duplicateSample: investigation.duplicateSample ?? null,
      locationManagerReceivedAt: investigation.locationManagerReceivedAt ?? null,
      locationManagerUpdatedAt: investigation.locationManagerUpdatedAt ?? null,
      locationManagerProcessingMs: investigation.locationManagerProcessingMs ?? null,
      gpsStateIngestedAt: investigation.gpsStateIngestedAt ?? null,
      backendProcessingMs: investigation.backendProcessingMs ?? null,
      websocketBroadcastAt: investigation.websocketBroadcastAt ?? null,
      websocketBroadcastLatencyMs: investigation.websocketBroadcastLatencyMs ?? null,
      latestApiResponseAt: investigation.latestApiResponseAt ?? null,
      apiResponseGenerationMs: investigation.apiResponseGenerationMs ?? null,
    };
  }

  private shouldAppendToHistory(location: VehicleLocation) {
    if (!hasUsableCoordinates(location)) {
      return false;
    }

    return location.status === LocationStatus.ONLINE || location.status === LocationStatus.STALE;
  }

  private detectImpossibleJump(previous: VehicleLocation | null | undefined, next: VehicleLocation) {
    if (!previous || !hasUsableCoordinates(previous) || !hasUsableCoordinates(next)) {
      return null;
    }

    const previousTimeMs = Date.parse(previous.gnssTime ?? previous.receivedAt);
    const nextTimeMs = Date.parse(next.gnssTime ?? next.receivedAt);
    const elapsedSeconds = Math.max(0, (nextTimeMs - previousTimeMs) / 1000);

    if (elapsedSeconds <= 0) {
      return null;
    }

    const distanceMeters = haversineMeters(
      previous.latitude,
      previous.longitude,
      next.latitude,
      next.longitude,
    );
    const requiredSpeedMps = distanceMeters / elapsedSeconds;

    if (requiredSpeedMps <= MAX_REASONABLE_SPEED_MPS) {
      return null;
    }

    return {
      distanceMeters,
      elapsedSeconds,
      requiredSpeedMps,
    };
  }

  private compareLocationRecency(left: VehicleLocation, right: VehicleLocation) {
    const leftPrimary = Date.parse(left.gnssTime ?? left.receivedAt);
    const rightPrimary = Date.parse(right.gnssTime ?? right.receivedAt);
    if (leftPrimary !== rightPrimary) {
      return leftPrimary - rightPrimary;
    }

    const leftReceived = Date.parse(left.receivedAt);
    const rightReceived = Date.parse(right.receivedAt);
    return leftReceived - rightReceived;
  }
}
