import { prisma } from '../prisma.js';
import { summarizeRouteHistory } from './route-history-analysis.js';
import type { VehicleRouteHistoryPoint } from './types.js';

export type DailyRouteReport = {
  vehicleId: string;
  vehicleName: string;
  date: string;
  pointCount: number;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  operationMinutes: number;
  distanceKm: number;
  stopCount: number;
  longestStopMinutes: number;
  gpsGapMinutes: number;
  stops: Array<{
    startAt: string;
    endAt: string;
    durationMinutes: number;
    latitude: number;
    longitude: number;
  }>;
};

type RouteHistoryReader = {
  getRouteHistoryByVehicleAndDate: (vehicleId: string, dateKey: string) => Promise<VehicleRouteHistoryPoint[]>;
  getRouteHistoryByDate: (dateKey: string) => Promise<VehicleRouteHistoryPoint[]>;
};

export class DailyRouteReportService {
  constructor(private readonly historyStore: RouteHistoryReader) {}

  async getVehicleDailyReport(vehicleId: string, dateKey: string): Promise<DailyRouteReport> {
    const [vehicle, points] = await Promise.all([
      prisma.vehicle.findUnique({
        where: {
          id: vehicleId,
        },
        select: {
          id: true,
          name: true,
        },
      }),
      this.historyStore.getRouteHistoryByVehicleAndDate(vehicleId, dateKey),
    ]);

    return this.buildReport(vehicleId, vehicle?.name ?? vehicleId, dateKey, points);
  }

  async getDailyReports(dateKey: string): Promise<DailyRouteReport[]> {
    const [vehicles, points] = await Promise.all([
      prisma.vehicle.findMany({
        select: {
          id: true,
          name: true,
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.historyStore.getRouteHistoryByDate(dateKey),
    ]);

    const pointsByVehicleId = new Map<string, VehicleRouteHistoryPoint[]>();
    for (const point of points) {
      const list = pointsByVehicleId.get(point.vehicleId);
      if (list) {
        list.push(point);
      } else {
        pointsByVehicleId.set(point.vehicleId, [point]);
      }
    }

    return vehicles.map((vehicle: { id: string; name: string }) =>
      this.buildReport(vehicle.id, vehicle.name, dateKey, pointsByVehicleId.get(vehicle.id) ?? []),
    );
  }

  private buildReport(vehicleId: string, vehicleName: string, dateKey: string, points: VehicleRouteHistoryPoint[]): DailyRouteReport {
    const summary = summarizeRouteHistory(points);

    return {
      vehicleId,
      vehicleName,
      date: dateKey,
      pointCount: summary.pointCount,
      firstReceivedAt: summary.firstReceivedAt,
      lastReceivedAt: summary.lastReceivedAt,
      operationMinutes: summary.operationMinutes,
      distanceKm: summary.distanceKm,
      stopCount: summary.stopCount,
      longestStopMinutes: summary.longestStopMinutes,
      gpsGapMinutes: summary.gpsGapMinutes,
      stops: summary.stops,
    };
  }
}
