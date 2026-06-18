import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { requireVehicleAgentToken } from '../services/api-security.js';
import type { DailyRouteReportService } from '../services/location/daily-route-report.js';
import { prisma } from '../services/prisma.js';
import type { LocationHistoryStore } from '../services/location/location-history-store.js';
import type { LocationManager } from '../services/location/location-manager.js';
import { classifyRouteHistoryPoints } from '../services/location/route-history-analysis.js';
import { LocationStatus, type VehicleLocation } from '../services/location/types.js';

const vehicleParamsSchema = z.object({
  vehicleId: z.string().trim().min(1),
});

const routeHistoryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Expected YYYY-MM-DD'),
});

const locationPayloadSchema = z.object({
  routeId: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1),
  gnssTime: z.string().datetime().optional(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  accuracyMeters: z.number().finite().gt(0).max(5000).optional(),
  headingDegrees: z.number().finite().min(0).lt(360).optional(),
  speedMps: z.number().finite().min(0).max(80).optional(),
  status: z.nativeEnum(LocationStatus).optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const locationRoutes = (
  locationManager: LocationManager,
  historyStore: LocationHistoryStore,
  dailyRouteReportService: DailyRouteReportService,
  bridgeVehicleLocationToGpsState?: (location: VehicleLocation) => Promise<void>,
): FastifyPluginAsync => {
  const plugin: FastifyPluginAsync = async (app) => {
    app.post('/vehicles/:vehicleId/location', async (request, reply) => {
      const params = vehicleParamsSchema.safeParse(request.params);
      if (!params.success) {
        reply.status(400);
        return {
          message: 'Invalid vehicle id',
          issues: params.error.issues,
        };
      }

      await requireVehicleAgentToken(request, reply, params.data.vehicleId);

      const vehicle = await prisma.vehicle.findUnique({
        where: {
          id: params.data.vehicleId,
        },
        select: {
          id: true,
        },
      });
      if (!vehicle) {
        reply.status(404);
        return {
          message: 'Vehicle not found',
        };
      }

      const parsed = locationPayloadSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return {
          message: 'Invalid vehicle location payload',
          issues: parsed.error.issues,
        };
      }

      const receivedAt = new Date().toISOString();
      if (parsed.data.source === 'android-phone') {
        app.log.info(
          {
            vehicleId: params.data.vehicleId,
            routeId: parsed.data.routeId ?? null,
            source: parsed.data.source,
            status: parsed.data.status ?? LocationStatus.ONLINE,
            latitude: parsed.data.latitude,
            longitude: parsed.data.longitude,
            gnssTime: parsed.data.gnssTime ?? null,
            receivedAt,
          },
          '[android-location] received',
        );
      }

      const location = await locationManager.ingestLocation({
        vehicleId: params.data.vehicleId,
        routeId: parsed.data.routeId ?? null,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        accuracyMeters: parsed.data.accuracyMeters ?? null,
        headingDegrees: parsed.data.headingDegrees ?? null,
        speedMps: parsed.data.speedMps ?? null,
        gnssTime: parsed.data.gnssTime ?? null,
        receivedAt,
        source: parsed.data.source,
        status: parsed.data.status ?? LocationStatus.ONLINE,
        error: null,
        rawJson: JSON.stringify({
          ...(parsed.data.raw ?? {}),
          accuracyMeters: parsed.data.accuracyMeters ?? null,
          headingDegrees: parsed.data.headingDegrees ?? null,
          speedMps: parsed.data.speedMps ?? null,
        }),
      });
      if (location.source === 'android-phone') {
        app.log.info(
          {
            vehicleId: location.vehicleId,
            routeId: location.routeId,
            source: location.source,
            status: location.status,
            latitude: location.latitude,
            longitude: location.longitude,
            gnssTime: location.gnssTime,
            receivedAt: location.receivedAt,
          },
          '[android-location] location-manager-updated',
        );
      }

      if (bridgeVehicleLocationToGpsState) {
        await bridgeVehicleLocationToGpsState(location);
      }

      reply.status(202);
      return {
        ok: true,
        vehicleId: params.data.vehicleId,
        receivedAt,
      };
    });

    app.get('/vehicles/locations', async (request, reply) => {
      await app.requireAdminToken(request, reply);

      return {
        vehicles: locationManager.listLatestLocations(),
      };
    });

    app.get('/vehicles/:vehicleId/route-history', async (request, reply) => {
      await app.requireAdminToken(request, reply);

      const params = vehicleParamsSchema.safeParse(request.params);
      if (!params.success) {
        reply.status(400);
        return {
          message: 'Invalid vehicle id',
          issues: params.error.issues,
        };
      }

      const query = routeHistoryQuerySchema.safeParse(request.query);
      if (!query.success) {
        reply.status(400);
        return {
          message: 'Invalid route history date',
          issues: query.error.issues,
        };
      }

      return {
        vehicleId: params.data.vehicleId,
        date: query.data.date,
        points: classifyRouteHistoryPoints(await historyStore.getRouteHistoryByVehicleAndDate(params.data.vehicleId, query.data.date)),
      };
    });

    app.get('/vehicles/route-history', async (request, reply) => {
      await app.requireAdminToken(request, reply);

      const query = routeHistoryQuerySchema.safeParse(request.query);
      if (!query.success) {
        reply.status(400);
        return {
          message: 'Invalid route history date',
          issues: query.error.issues,
        };
      }

      return {
        date: query.data.date,
        points: classifyRouteHistoryPoints(await historyStore.getRouteHistoryByDate(query.data.date)),
      };
    });

    app.get('/vehicles/:vehicleId/daily-report', async (request, reply) => {
      await app.requireAdminToken(request, reply);

      const params = vehicleParamsSchema.safeParse(request.params);
      if (!params.success) {
        reply.status(400);
        return {
          message: 'Invalid vehicle id',
          issues: params.error.issues,
        };
      }

      const query = routeHistoryQuerySchema.safeParse(request.query);
      if (!query.success) {
        reply.status(400);
        return {
          message: 'Invalid report date',
          issues: query.error.issues,
        };
      }

      return {
        report: await dailyRouteReportService.getVehicleDailyReport(params.data.vehicleId, query.data.date),
      };
    });

    app.get('/vehicles/daily-reports', async (request, reply) => {
      await app.requireAdminToken(request, reply);

      const query = routeHistoryQuerySchema.safeParse(request.query);
      if (!query.success) {
        reply.status(400);
        return {
          message: 'Invalid report date',
          issues: query.error.issues,
        };
      }

      return {
        date: query.data.date,
        reports: await dailyRouteReportService.getDailyReports(query.data.date),
      };
    });

    app.delete('/vehicles/:vehicleId/route-history', async (request, reply) => {
      await app.requireAdminToken(request, reply);

      const params = vehicleParamsSchema.safeParse(request.params);
      if (!params.success) {
        reply.status(400);
        return {
          message: 'Invalid vehicle id',
          issues: params.error.issues,
        };
      }

      const query = routeHistoryQuerySchema.safeParse(request.query);
      if (!query.success) {
        reply.status(400);
        return {
          message: 'Invalid route history date',
          issues: query.error.issues,
        };
      }

      const deletedCount = await historyStore.deleteRouteHistoryByVehicleAndDate(params.data.vehicleId, query.data.date);
      return {
        ok: true,
        vehicleId: params.data.vehicleId,
        date: query.data.date,
        deletedCount,
      };
    });

    app.delete('/vehicles/route-history', async (request, reply) => {
      await app.requireAdminToken(request, reply);

      const query = routeHistoryQuerySchema.safeParse(request.query);
      if (!query.success) {
        reply.status(400);
        return {
          message: 'Invalid route history date',
          issues: query.error.issues,
        };
      }

      const deletedCount = await historyStore.deleteRouteHistoryByDate(query.data.date);
      return {
        ok: true,
        date: query.data.date,
        deletedCount,
      };
    });
  };

  return plugin;
};
