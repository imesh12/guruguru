import { prisma } from '../prisma.js';
import { getGpsRouteHistoryRetentionDays } from '../runtime-config.js';
import {
  compareRouteHistoryPoints,
  hasUsableCoordinates,
  toJapanDateKey,
  toJapanWeekKey,
  type VehicleLocation,
  type VehicleRouteHistoryPoint,
} from './types.js';

type HistoryStoreLogger = {
  info?: (context: unknown, message?: string) => void;
  warn?: (context: unknown, message?: string) => void;
  error?: (context: unknown, message?: string) => void;
};

type PrismaGpsPointRecord = {
  id: string;
  vehicleId: string;
  routeId: string | null;
  latitude: number;
  longitude: number;
  gnssTime: Date | null;
  receivedAt: Date;
  dateKey: string;
  weekKey: string;
  source: string;
  status: string;
  rawJson: string | null;
};

/**
 * Persistence layer for date-based route history.
 *
 * Route history is stored in a dedicated `VehicleRoutePoint` table.
 *
 * `dateKey` is derived in Japan time as `YYYY-MM-DD`.
 * `weekKey` is derived in Japan time as a Monday-start `YYYY-WW` retention key.
 */
export class LocationHistoryStore {
  private maintenanceTimer?: NodeJS.Timeout | undefined;

  constructor(private readonly logger?: HistoryStoreLogger) {}

  /**
   * Documents the current persistence mode so future phases can upgrade it
   * intentionally.
   */
  describePersistenceMode() {
    return {
      table: 'VehicleRoutePoint',
      mode: 'dedicated-route-history',
      timeZone: 'Asia/Tokyo',
      dateKeyFormat: 'YYYY-MM-DD',
      weekKeyFormat: 'YYYY-WW (Monday-start)',
    } as const;
  }

  /**
   * Appends a route point when the update has usable coordinates.
   */
  async appendLocation(location: VehicleLocation) {
    if (!hasUsableCoordinates(location)) {
      return null;
    }

    const gnssTime = location.gnssTime?.trim() ? new Date(location.gnssTime) : null;
    const dateBasis = location.gnssTime ?? location.receivedAt;
    const dateKey = toJapanDateKey(dateBasis);
    const weekKey = toJapanWeekKey(dateBasis);

    try {
      const latestExisting = (await prisma.vehicleRoutePoint.findFirst({
        where: {
          vehicleId: location.vehicleId,
        },
        orderBy: [{ gnssTime: 'desc' }, { receivedAt: 'desc' }],
      })) as PrismaGpsPointRecord | null;

      if (
        latestExisting &&
        latestExisting.latitude === location.latitude &&
        latestExisting.longitude === location.longitude &&
        (latestExisting.gnssTime?.toISOString() ?? null) === (gnssTime?.toISOString() ?? null)
      ) {
        return this.mapRecordToHistoryPoint(latestExisting);
      }

      const created = await prisma.vehicleRoutePoint.create({
        data: {
          vehicleId: location.vehicleId,
          routeId: location.routeId,
          latitude: location.latitude,
          longitude: location.longitude,
          gnssTime,
          receivedAt: new Date(location.receivedAt),
          dateKey,
          weekKey,
          source: location.source,
          status: location.status,
          rawJson: location.rawJson ?? null,
        },
      });

      return this.mapRecordToHistoryPoint(created);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.error?.(
        {
          error: message,
          vehicleId: location.vehicleId,
          dateKey,
          weekKey,
        },
        `[location-history] append error message=${message}`,
      );
      throw error;
    }
  }

  /**
   * Returns route history for one vehicle on one Japan local day.
   */
  async getRouteHistoryByVehicleAndDate(vehicleId: string, dateKey: string) {
    const rows = (await prisma.vehicleRoutePoint.findMany({
      where: {
        vehicleId,
        dateKey,
      },
      orderBy: [{ gnssTime: 'asc' }, { receivedAt: 'asc' }],
    })) as PrismaGpsPointRecord[];

    return rows
      .map((row) => this.mapRecordToHistoryPoint(row))
      .sort(compareRouteHistoryPoints);
  }

  /**
   * Returns route history for all vehicles on one Japan local day.
   */
  async getRouteHistoryByDate(dateKey: string) {
    const rows = (await prisma.vehicleRoutePoint.findMany({
      where: {
        dateKey,
      },
      orderBy: [
        {
          gnssTime: 'asc',
        },
        {
          vehicleId: 'asc',
        },
        {
          receivedAt: 'asc',
        },
      ],
    })) as PrismaGpsPointRecord[];

    return rows
      .map((row) => this.mapRecordToHistoryPoint(row))
      .sort(compareRouteHistoryPoints);
  }

  /**
   * Deletes route history for one vehicle on one Japan local day.
   */
  async deleteRouteHistoryByVehicleAndDate(vehicleId: string, dateKey: string) {
    const result = await prisma.vehicleRoutePoint.deleteMany({
      where: {
        vehicleId,
        dateKey,
      },
    });

    return result.count;
  }

  /**
   * Deletes route history for all vehicles on one Japan local day.
   */
  async deleteRouteHistoryByDate(dateKey: string) {
    const result = await prisma.vehicleRoutePoint.deleteMany({
      where: {
        dateKey,
      },
    });

    return result.count;
  }

  startRetentionMaintenance() {
    if (this.maintenanceTimer) {
      return;
    }

    this.maintenanceTimer = setInterval(() => {
      void this.runRetentionCleanup('scheduled').catch((error: unknown) => {
        this.logger?.error?.({ error }, 'Route history retention cleanup failed.');
      });
    }, 24 * 60 * 60 * 1000);
  }

  stopRetentionMaintenance() {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = undefined;
    }
  }

  async runRetentionCleanup(reason: 'startup' | 'scheduled' = 'startup') {
    const retentionDays = getGpsRouteHistoryRetentionDays();
    const currentDateKey = toJapanDateKey(new Date());
    const cutoffDateKey = this.shiftDateKey(currentDateKey, -(retentionDays - 1));

    const result = await prisma.vehicleRoutePoint.deleteMany({
      where: {
        dateKey: {
          lt: cutoffDateKey,
        },
      },
    });

    this.logger?.info?.(
      {
        reason,
        retentionDays,
        currentDateKey,
        cutoffDateKey,
        deletedCount: result.count,
      },
      'Route history retention cleanup completed.',
    );

    return {
      deletedCount: result.count,
      retentionDays,
      currentDateKey,
      cutoffDateKey,
    };
  }

  private mapRecordToHistoryPoint(row: PrismaGpsPointRecord): VehicleRouteHistoryPoint {
    const receivedAt = row.receivedAt.toISOString();
    const gnssTime = row.gnssTime?.toISOString() ?? null;

    return {
      id: row.id,
      vehicleId: row.vehicleId,
      routeId: row.routeId,
      latitude: row.latitude,
      longitude: row.longitude,
      gnssTime,
      receivedAt,
      dateKey: row.dateKey,
      weekKey: row.weekKey,
      source: row.source,
      status: row.status as VehicleRouteHistoryPoint['status'],
      rawJson: row.rawJson,
    };
  }

  private shiftDateKey(dateKey: string, days: number) {
    const [yearRaw, monthRaw, dayRaw] = dateKey.split('-');
    const shifted = new Date(Date.UTC(Number(yearRaw), Number(monthRaw) - 1, Number(dayRaw) + days, 0, 0, 0));
    return toJapanDateKey(shifted);
  }
}
