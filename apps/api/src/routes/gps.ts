import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { prisma } from '../services/prisma.js';
import type { GpsStateService } from '../services/gps-state.js';

const gpsUpdateSchema = z.object({
  vehicleId: z.string(),
  vehicleName: z.string(),
  lat: z.number(),
  lng: z.number(),
  locationStatus: z.enum(['ONLINE', 'STALE', 'OFFLINE', 'NO_FIX', 'ERROR']).optional(),
  speed: z.number().optional(),
  heading: z.number().optional(),
  speedMps: z.number().optional(),
  headingDegrees: z.number().optional(),
  accuracyMeters: z.number().optional(),
  gpsQuality: z.enum(['GOOD', 'FAIR', 'POOR', 'UNKNOWN']).optional(),
  source: z.string().optional(),
  receivedAt: z.string().datetime(),
});

export const gpsRoutes = (gpsState: GpsStateService): FastifyPluginAsync => {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/latest', async () => {
      const responseStartedAtMs = Date.now();
      const vehicles = await prisma.vehicle.findMany({
        where: {
          enabled: true,
        },
        select: {
          id: true,
        },
      });
      const validVehicleIds = new Set<string>(vehicles.map((vehicle: { id: string }) => vehicle.id));
      gpsState.pruneOrphanVehicles(validVehicleIds);
      const latestApiResponseAt = new Date().toISOString();
      const apiResponseGenerationMs = Date.now() - responseStartedAtMs;
      const payload = gpsState.listLatestForVehicleIds(validVehicleIds).map((vehicle) => ({
        ...vehicle,
        investigation: {
          ...(vehicle.investigation ?? {}),
          latestApiResponseAt,
          apiResponseGenerationMs,
        },
      }));

      app.log.info(
        {
          vehicleCount: payload.length,
          latestApiResponseAt,
          apiResponseGenerationMs,
        },
        '[gnss-investigation] api response',
      );

      return {
        vehicles: payload,
      };
    });

    app.post('/mock', async (request, reply) => {
      const parsed = gpsUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return {
          message: 'Invalid GPS payload',
          issues: parsed.error.issues,
        };
      }

      const update = await gpsState.ingest(parsed.data);
      return {
        status: 'ok',
        vehicle: update,
      };
    });
  };

  return plugin;
};
