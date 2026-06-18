import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import type { SystemHealthService } from '../services/system-health.js';

const cameraStatusSchema = z.object({
  cameraId: z.string(),
  status: z.enum(['LIVE', 'RECONNECTING', 'OFFLINE']),
  message: z.string().optional(),
  timestamp: z.string().datetime(),
});

const desktopHeartbeatSchema = z.object({
  timestamp: z.string().datetime(),
  mpvProcessCount: z.number().int().nonnegative(),
  gpuAvailable: z.boolean(),
  gpuStatus: z.string(),
});

export const systemRoutes = (systemHealth: SystemHealthService): FastifyPluginAsync => {
  const plugin: FastifyPluginAsync = async (app) => {
    app.get('/status', async () => systemHealth.getSnapshot());

    app.post('/camera-status', async (request, reply) => {
      await app.requireAdminToken(request, reply);

      const parsed = cameraStatusSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return {
          message: 'Invalid camera status payload',
          issues: parsed.error.issues,
        };
      }

      await systemHealth.reportCameraStatus(parsed.data);
      return {
        status: 'ok',
      };
    });

    app.post('/heartbeat', async (request, reply) => {
      await app.requireAdminToken(request, reply);

      const parsed = desktopHeartbeatSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.status(400);
        return {
          message: 'Invalid desktop heartbeat payload',
          issues: parsed.error.issues,
        };
      }

      await systemHealth.reportDesktopHeartbeat(parsed.data);
      return {
        status: 'ok',
      };
    });

    app.post('/diagnostics/export', async (request, reply) => {
      await app.requireAdminToken(request, reply);
      const bundle = await systemHealth.exportDiagnostics();
      reply.status(201);
      return bundle;
    });

    app.post('/maintenance/prune-orphans', async (request, reply) => {
      await app.requireAdminToken(request, reply);
      const result = await systemHealth.pruneOrphanRuntimeState();
      reply.status(200);
      return {
        status: 'ok',
        result,
      };
    });
  };

  return plugin;
};
