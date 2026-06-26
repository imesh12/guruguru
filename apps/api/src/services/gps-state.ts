import type { FastifyBaseLogger } from 'fastify';

import { prisma } from './prisma.js';
import { getGpsHistoryDays } from './runtime-config.js';

export type VehicleGpsUpdate = {
  vehicleId: string;
  vehicleName: string;
  lat: number;
  lng: number;
  locationStatus?: 'ONLINE' | 'STALE' | 'OFFLINE' | 'NO_FIX' | 'ERROR' | undefined;
  speed?: number | undefined;
  heading?: number | undefined;
  speedMps?: number | undefined;
  headingDegrees?: number | undefined;
  accuracyMeters?: number | undefined;
  gpsQuality?: 'GOOD' | 'FAIR' | 'POOR' | 'UNKNOWN' | undefined;
  source?: string | undefined;
  receivedAt: string;
  investigation?: {
    localPollTime?: string | null;
    apiPollReceivedAt?: string | null;
    routerGnssTime?: string | null;
    routerSampleAgeMs?: number | null;
    gnssStaleThresholdMs?: number | null;
    gnssStale?: boolean | null;
    communicationFresh?: boolean | null;
    positionFresh?: boolean | null;
    coordinateChanged?: boolean | null;
    intervalSinceLastCoordinateChangeMs?: number | null;
    distanceFromPreviousMeters?: number | null;
    speedEstimateMps?: number | null;
    headingEstimateDeg?: number | null;
    suspiciousJump?: boolean | null;
    duplicateSample?: boolean | null;
    requestDurationMs?: number | null;
    effectiveUpdateIntervalMs?: number | null;
    lastPollStartedAt?: string | null;
    lastPollCompletedAt?: string | null;
    locationManagerReceivedAt?: string | null;
    locationManagerUpdatedAt?: string | null;
    locationManagerProcessingMs?: number | null;
    gpsStateIngestedAt?: string | null;
    backendProcessingMs?: number | null;
    websocketBroadcastAt?: string | null;
    websocketBroadcastLatencyMs?: number | null;
    latestApiResponseAt?: string | null;
    apiResponseGenerationMs?: number | null;
  } | null;
};

type Subscriber = (update: VehicleGpsUpdate, snapshot: VehicleGpsUpdate[]) => void;

type PrismaLikeError = {
  code?: string | undefined;
  meta?: Record<string, unknown> | undefined;
  message?: string | undefined;
};

export type DatabaseWriteStatus = {
  status: 'ONLINE' | 'ERROR';
  lastWriteAt: string | null;
  lastError: string | null;
};

export class GpsStateService {
  private readonly latestByVehicle = new Map<string, VehicleGpsUpdate>();
  private readonly subscribers = new Set<Subscriber>();
  private readonly persistQueue: VehicleGpsUpdate[] = [];
  private flushTimer?: NodeJS.Timeout | undefined;
  private readonly logger?: FastifyBaseLogger | undefined;
  private databaseWriteStatus: DatabaseWriteStatus = {
    status: 'ONLINE',
    lastWriteAt: null,
    lastError: null,
  };
  private maintenanceTimer?: NodeJS.Timeout | undefined;
  private lastMaintenanceAt: string | null = null;
  private lastMaintenanceWarning: string | null = null;

  constructor(logger?: FastifyBaseLogger) {
    this.logger = logger;

    this.scheduleMaintenance();
  }

  listLatest() {
    return Array.from(this.latestByVehicle.values()).sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
  }

  listLatestForVehicleIds(validVehicleIds: Iterable<string>) {
    const validIds = new Set(validVehicleIds);
    return this.listLatest().filter((vehicle) => validIds.has(vehicle.vehicleId));
  }

  pruneOrphanVehicles(validVehicleIds: Iterable<string>) {
    const validIds = new Set(validVehicleIds);
    let removedCount = 0;

    for (const vehicleId of this.latestByVehicle.keys()) {
      if (!validIds.has(vehicleId)) {
        this.latestByVehicle.delete(vehicleId);
        removedCount += 1;
      }
    }

    return removedCount;
  }

  clearVehicle(vehicleId: string) {
    this.latestByVehicle.delete(vehicleId);
  }

  async pruneOrphanGpsHistory() {
    const vehicles = await prisma.vehicle.findMany({
      select: {
        id: true,
      },
    });
    const validVehicleIds = new Set<string>(vehicles.map((vehicle: { id: string }) => vehicle.id));
    const removedRuntimeCount = this.pruneOrphanVehicles(validVehicleIds);

    const orphanVehicleIds = Array.from(
      new Set(
        (
          await prisma.gpsPoint.findMany({
            select: {
              vehicleId: true,
            },
          })
        )
          .map((entry: { vehicleId: string }) => entry.vehicleId)
          .filter((vehicleId: string) => !validVehicleIds.has(vehicleId)),
      ),
    );

    const deletedGpsPointCount =
      orphanVehicleIds.length === 0
        ? 0
        : (
            await prisma.gpsPoint.deleteMany({
              where: {
                vehicleId: {
                  in: orphanVehicleIds,
                },
              },
            })
          ).count;

    return {
      removedRuntimeCount,
      deletedGpsPointCount,
      orphanVehicleIds,
    };
  }

  getDatabaseWriteStatus() {
    return this.databaseWriteStatus;
  }

  subscribe(subscriber: Subscriber) {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  async ingest(update: VehicleGpsUpdate) {
    this.latestByVehicle.set(update.vehicleId, update);
    this.persistQueue.push(update);
    this.scheduleFlush();
    this.logger?.info(
      {
        vehicleId: update.vehicleId,
        lat: update.lat,
        lng: update.lng,
        accuracyMeters: update.accuracyMeters ?? null,
        gpsQuality: update.gpsQuality ?? null,
        source: update.source ?? null,
        receivedAt: update.receivedAt,
      },
      '[gps-state] latest-updated',
    );

    const snapshot = this.listLatest();
    for (const subscriber of this.subscribers) {
      subscriber(update, snapshot);
    }

    return update;
  }

  async flushPending() {
    if (this.persistQueue.length === 0) {
      return;
    }

    const batch = this.persistQueue.splice(0, this.persistQueue.length);

    try {
      await prisma.gpsPoint.createMany({
        data: batch.map((entry) => ({
          vehicleId: entry.vehicleId,
          lat: entry.lat,
          lng: entry.lng,
          speed: entry.speed ?? null,
          heading: entry.heading ?? null,
          receivedAt: new Date(entry.receivedAt),
        })),
      });

      this.databaseWriteStatus = {
        status: 'ONLINE',
        lastWriteAt: new Date().toISOString(),
        lastError: null,
      };
    } catch (error) {
      this.persistQueue.unshift(...batch);
      this.databaseWriteStatus = {
        status: 'ERROR',
        lastWriteAt: this.databaseWriteStatus.lastWriteAt,
        lastError: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  }

  stop() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flushPending().catch((error: unknown) => {
        this.logger?.error({ error }, 'Failed to flush GPS queue');
      });
    }, 1000);
  }

  private scheduleMaintenance() {
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance().catch((error: unknown) => {
        this.logger?.error({ error }, 'Failed to run GPS history maintenance');
      });
    }, 12 * 60 * 60 * 1000);
  }

  async runMaintenance() {
    const retentionDays = getGpsHistoryDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    try {
      await prisma.gpsPoint.deleteMany({
        where: {
          receivedAt: {
            lt: cutoff,
          },
        },
      });
    } catch (error) {
      const prismaError = error as PrismaLikeError;
      if (prismaError?.code === 'P2021') {
        const message = 'GPS history maintenance skipped because the GpsPoint table is not available yet.';
        this.lastMaintenanceWarning = message;
        this.logger?.warn(
          {
            code: prismaError.code,
            meta: prismaError.meta,
            message: prismaError.message,
          },
          message,
        );
        return {
          retentionDays,
          lastMaintenanceAt: this.lastMaintenanceAt,
          skippedReason: message,
        };
      }

      throw error;
    }

    this.lastMaintenanceAt = new Date().toISOString();
    this.lastMaintenanceWarning = null;
    return {
      retentionDays,
      lastMaintenanceAt: this.lastMaintenanceAt,
    };
  }

  getMaintenanceStatus() {
    return {
      retentionDays: getGpsHistoryDays(),
      lastMaintenanceAt: this.lastMaintenanceAt,
      warning: this.lastMaintenanceWarning,
    };
  }
}
