import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { decryptPassword, encryptPassword, migratePlaintextPasswordIfPossible } from '../services/camera-credentials.js';
import type { MediaMtxConfigService } from '../services/mediamtx-config-service.js';
import { prisma } from '../services/prisma.js';
import { resolveRtspUrl } from '../services/rtsp-url.js';
import {
  buildAxisRtspUrl,
  buildHikvisionRtspUrl,
  type CameraQualityPreset,
  type CameraVendor,
} from '../services/rtsp-url-builder.js';

const vehicleInputSchema = z.object({
  name: z.string().trim().min(1),
  displayColor: z.string().trim().min(1),
  enabled: z.boolean(),
});

const cameraInputSchema = z.object({
  vehicleId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: z.enum(['FRONT', 'INTERNAL']),
  vendor: z.enum(['AXIS', 'HIKVISION', 'CUSTOM']),
  host: z.string().trim().nullable(),
  rtspPort: z.number().int().min(1).max(65535).nullable(),
  customRtspUrl: z.string().trim().nullable(),
  qualityPreset: z.enum(['LOW', 'STANDARD', 'HIGH']),
  username: z.string().trim().nullable(),
  password: z.string().nullable(),
  enabled: z.boolean(),
  bitrateLimit: z.number().int().positive().nullable(),
});

const cameraRtspResolveSchema = z.object({
  vendor: z.enum(['AXIS', 'HIKVISION', 'CUSTOM']),
  host: z.string().trim().nullable(),
  rtspPort: z.number().int().min(1).max(65535).nullable(),
  customRtspUrl: z.string().trim().nullable(),
  qualityPreset: z.enum(['LOW', 'STANDARD', 'HIGH']),
  username: z.string().trim().nullable(),
  password: z.string().nullable(),
});

const layoutSlotInputSchema = z.object({
  slotIndex: z.number().int().min(1).max(4),
  cameraId: z.string().trim().min(1).nullable(),
});

const layoutInputSchema = z.object({
  name: z.string().trim().min(1),
  slots: z.array(layoutSlotInputSchema).length(4),
});

const buildStreamPath = (cameraId: string) => {
  const normalizedId = cameraId.trim().replace(/^camera-/u, '');
  const asciiId = normalizedId.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return `camera-${asciiId || 'unknown'}`;
};
type PlaybackLogger = {
  info: (context: Record<string, unknown>, message: string) => void;
};

const buildStoredRtspUrl = (camera: {
  vendor: CameraVendor;
  host: string | null;
  rtspPort: number | null;
  qualityPreset: CameraQualityPreset;
  customRtspUrl: string | null;
}) => {
  if (camera.vendor === 'AXIS' && camera.host) {
    return buildAxisRtspUrl({
      host: camera.host,
      rtspPort: camera.rtspPort,
      qualityPreset: camera.qualityPreset,
      includeCredentials: false,
    });
  }

  if (camera.vendor === 'HIKVISION' && camera.host) {
    return buildHikvisionRtspUrl({
      host: camera.host,
      rtspPort: camera.rtspPort,
      includeCredentials: false,
    });
  }

  return camera.customRtspUrl;
};

const cameraResponse = (camera: {
  id: string;
  vehicleId: string;
  name: string;
  type: 'FRONT' | 'INTERNAL';
  vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
  host: string | null;
  rtspPort: number | null;
  customRtspUrl: string | null;
  qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
  rtspUrl: string | null;
  username: string | null;
  password: string | null;
  enabled: boolean;
  bitrateLimit: number | null;
  vehicle: {
    name: string;
  };
}) => ({
  id: camera.id,
  vehicleId: camera.vehicleId,
  vehicleName: camera.vehicle.name,
  name: camera.name,
  type: camera.type,
  vendor: camera.vendor,
  host: camera.host,
  rtspPort: camera.rtspPort,
  customRtspUrl: camera.customRtspUrl,
  qualityPreset: camera.qualityPreset,
  rtspUrl: camera.rtspUrl,
  username: camera.username,
  hasSavedPassword: Boolean(camera.password),
  enabled: camera.enabled,
  bitrateLimit: camera.bitrateLimit,
});

const buildRuntimePlaybackConfig = (
  logger: PlaybackLogger,
  camera: {
  id: string;
  vehicleId: string;
  name: string;
  type: 'FRONT' | 'INTERNAL';
  vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
  host: string | null;
  rtspPort: number | null;
  customRtspUrl: string | null;
  qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
  enabled: boolean;
  bitrateLimit: number | null;
  password: string | null;
  username: string | null;
  vehicle: { name: string };
}) => {
  const password = decryptPassword(camera.password);
  const resolved = resolveRtspUrl({
    vendor: camera.vendor,
    host: camera.host,
    rtspPort: camera.rtspPort,
    username: camera.username,
    password,
    qualityPreset: camera.qualityPreset,
    customRtspUrl: camera.customRtspUrl,
    rtspUrl: null,
  });
  const streamPath = buildStreamPath(camera.id);
  const webrtcBase = process.env.MEDIAMTX_WEBRTC_BASE?.trim() || 'http://127.0.0.1:8889';

  logger.info(
    {
      cameraId: camera.id,
      host: camera.host,
      rtspPort: camera.rtspPort,
      usernameExists: Boolean(camera.username),
      passwordExists: Boolean(camera.password),
      decryptedPasswordExists: Boolean(password),
      resolvedRtspUrl: resolved.sanitizedRtspUrl,
      error: resolved.error,
    },
    '[camera-playback-config] resolved runtime RTSP',
  );

  return {
    id: camera.id,
    cameraId: camera.id,
    vehicleId: camera.vehicleId,
    vehicleName: camera.vehicle.name,
    name: camera.name,
    type: camera.type,
    vendor: camera.vendor,
    host: camera.host,
    rtspPort: camera.rtspPort,
    customRtspUrl: camera.customRtspUrl,
    qualityPreset: camera.qualityPreset,
    enabled: camera.enabled,
    bitrateLimit: camera.bitrateLimit,
    providerType: 'external-mpv' as const,
    rtspUrl: resolved.rtspUrl,
    sanitizedRtspUrl: resolved.sanitizedRtspUrl,
    error: resolved.error,
    streamPath,
    webrtcUrl: `${webrtcBase.replace(/\/+$/, '')}/${streamPath}/whep`,
    auth: {
      username: camera.username,
      password,
      usernameExists: Boolean(camera.username),
      passwordExists: Boolean(password),
    },
  };
};

const layoutResponse = (layout: {
  id: string;
  name: string;
  active: boolean;
  updatedAt: Date;
  slots: Array<{
    id: string;
    slotIndex: number;
    cameraId: string | null;
    camera: {
      name: string;
      type: 'FRONT' | 'INTERNAL';
      vehicle: {
        name: string;
      };
    } | null;
  }>;
}) => ({
  id: layout.id,
  name: layout.name,
  active: layout.active,
  updatedAt: layout.updatedAt.toISOString(),
  slots: layout.slots
    .slice()
    .sort((left, right) => left.slotIndex - right.slotIndex)
    .map((slot) => ({
      id: slot.id,
      slotIndex: slot.slotIndex,
      cameraId: slot.cameraId,
      cameraName: slot.camera?.name ?? null,
      cameraType: slot.camera?.type ?? null,
      vehicleName: slot.camera?.vehicle.name ?? null,
    })),
});

type FleetRouteOptions = {
  mediamtxConfigService?: MediaMtxConfigService;
};

export const fleetRoutes: FastifyPluginAsync<FleetRouteOptions> = async (app, options) => {
  app.addHook('onRequest', app.requireAdminToken);

  app.get('/vehicles', async () => {
    const vehicles = await prisma.vehicle.findMany({
      orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    });

    return {
      vehicles: vehicles.map((vehicle: (typeof vehicles)[number]) => ({
        id: vehicle.id,
        name: vehicle.name,
        displayColor: vehicle.displayColor,
        enabled: vehicle.enabled,
      })),
    };
  });

  app.post('/vehicles', async (request, reply) => {
    const parsed = vehicleInputSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid vehicle payload',
        issues: parsed.error.issues,
      };
    }

    const vehicle = await prisma.vehicle.create({
      data: parsed.data,
    });

    reply.status(201);
    return {
      vehicle: {
        id: vehicle.id,
        name: vehicle.name,
        displayColor: vehicle.displayColor,
        enabled: vehicle.enabled,
      },
    };
  });

  app.put('/vehicles/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
    const parsed = vehicleInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid vehicle update payload',
        issues: [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)],
      };
    }

    const vehicle = await prisma.vehicle.update({
      where: {
        id: params.data.id,
      },
      data: parsed.data,
    });

    return {
      vehicle: {
        id: vehicle.id,
        name: vehicle.name,
        displayColor: vehicle.displayColor,
        enabled: vehicle.enabled,
      },
    };
  });

  app.delete('/vehicles/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        message: 'Invalid vehicle id',
        issues: params.error.issues,
      };
    }

    const assignedCameraCount = await prisma.camera.count({
      where: {
        vehicleId: params.data.id,
      },
    });

    if (assignedCameraCount > 0) {
      reply.status(409);
      return {
        message: 'Cannot delete vehicle while cameras are assigned. Delete or move cameras first.',
      };
    }

    await prisma.vehicle.delete({
      where: {
        id: params.data.id,
      },
    });

    return {
      status: 'ok',
    };
  });

  app.get('/cameras', async () => {
    const cameras = await prisma.camera.findMany({
      include: {
        vehicle: true,
      },
      orderBy: [{ enabled: 'desc' }, { vehicleId: 'asc' }, { type: 'asc' }, { name: 'asc' }],
    });

    await Promise.all(cameras.map((camera: (typeof cameras)[number]) => migratePlaintextPasswordIfPossible(camera.id, camera.password)));

    return {
      cameras: cameras.map((camera: (typeof cameras)[number]) => cameraResponse(camera)),
    };
  });

  app.get('/cameras/:id/playback-config', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        message: 'Invalid camera id',
        issues: params.error.issues,
      };
    }

    const camera = await prisma.camera.findUnique({
      where: {
        id: params.data.id,
      },
      include: {
        vehicle: true,
      },
    });

    if (!camera) {
      reply.status(404);
      return {
        message: 'Camera not found',
      };
    }

    await migratePlaintextPasswordIfPossible(camera.id, camera.password);

    return {
      camera: (() => {
        const runtimeConfig = buildRuntimePlaybackConfig(app.log, camera);
        const { auth: _auth, ...publicConfig } = runtimeConfig;
        return publicConfig;
      })(),
    };
  });

  app.get('/cameras/:id/runtime-playback-config', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        message: 'Invalid camera id',
        issues: params.error.issues,
      };
    }

    const camera = await prisma.camera.findUnique({
      where: {
        id: params.data.id,
      },
      include: {
        vehicle: true,
      },
    });

    if (!camera) {
      reply.status(404);
      return {
        message: 'Camera not found',
      };
    }

    await migratePlaintextPasswordIfPossible(camera.id, camera.password);

    return {
      camera: buildRuntimePlaybackConfig(app.log, camera),
    };
  });

  app.post('/cameras/resolve-rtsp', async (request, reply) => {
    const parsed = cameraRtspResolveSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid RTSP resolve payload',
        issues: parsed.error.issues,
      };
    }

    const resolved = resolveRtspUrl({
      vendor: parsed.data.vendor,
      host: parsed.data.host,
      rtspPort: parsed.data.rtspPort,
      username: parsed.data.username,
      password: parsed.data.password,
      qualityPreset: parsed.data.qualityPreset,
      customRtspUrl: parsed.data.customRtspUrl,
    });

    return {
      rtspUrl: resolved.rtspUrl,
      sanitizedRtspUrl: resolved.sanitizedRtspUrl,
      error: resolved.error,
      source: resolved.source,
    };
  });

  app.post('/cameras', async (request, reply) => {
    const parsed = cameraInputSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid camera payload',
        issues: parsed.error.issues,
      };
    }

    const camera = await prisma.camera.create({
      data: {
        id: `camera-${randomUUID()}`,
        vehicleId: parsed.data.vehicleId,
        name: parsed.data.name,
        type: parsed.data.type,
        vendor: parsed.data.vendor,
        host: parsed.data.host,
        rtspPort: parsed.data.rtspPort,
        customRtspUrl: parsed.data.customRtspUrl,
        qualityPreset: parsed.data.qualityPreset,
        rtspUrl: buildStoredRtspUrl({
          vendor: parsed.data.vendor,
          host: parsed.data.host,
          rtspPort: parsed.data.rtspPort,
          qualityPreset: parsed.data.qualityPreset,
          customRtspUrl: parsed.data.customRtspUrl,
        }),
        username: parsed.data.username,
        enabled: parsed.data.enabled,
        bitrateLimit: parsed.data.bitrateLimit,
        password: parsed.data.password ? encryptPassword(parsed.data.password) : null,
      },
      include: {
        vehicle: true,
      },
    });

    reply.status(201);
    options.mediamtxConfigService?.scheduleRegeneration(`camera:create:${camera.id}`);
    return {
      camera: cameraResponse(camera),
    };
  });

  app.put('/cameras/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
    const parsed = cameraInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid camera update payload',
        issues: [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)],
      };
    }

    const camera = await prisma.camera.update({
      where: {
        id: params.data.id,
      },
      data: {
        vehicleId: parsed.data.vehicleId,
        name: parsed.data.name,
        type: parsed.data.type,
        vendor: parsed.data.vendor,
        host: parsed.data.host,
        rtspPort: parsed.data.rtspPort,
        customRtspUrl: parsed.data.customRtspUrl,
        qualityPreset: parsed.data.qualityPreset,
        rtspUrl: buildStoredRtspUrl({
          vendor: parsed.data.vendor,
          host: parsed.data.host,
          rtspPort: parsed.data.rtspPort,
          qualityPreset: parsed.data.qualityPreset,
          customRtspUrl: parsed.data.customRtspUrl,
        }),
        username: parsed.data.username,
        enabled: parsed.data.enabled,
        bitrateLimit: parsed.data.bitrateLimit,
        ...(parsed.data.password ? { password: encryptPassword(parsed.data.password) } : {}),
      },
      include: {
        vehicle: true,
      },
    });

    options.mediamtxConfigService?.scheduleRegeneration(`camera:update:${camera.id}`);
    return {
      camera: cameraResponse(camera),
    };
  });

  app.delete('/cameras/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        message: 'Invalid camera id',
        issues: params.error.issues,
      };
    }

    await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.layoutSlot.updateMany({
        where: {
          cameraId: params.data.id,
        },
        data: {
          cameraId: null,
        },
      });

      await tx.camera.delete({
        where: {
          id: params.data.id,
        },
      });
    });

    options.mediamtxConfigService?.scheduleRegeneration(`camera:delete:${params.data.id}`);
    return {
      status: 'ok',
    };
  });

  app.get('/layouts', async () => {
    const layouts = await prisma.layoutConfig.findMany({
      include: {
        slots: {
          include: {
            camera: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
      orderBy: [{ active: 'desc' }, { updatedAt: 'desc' }],
    });

    return {
      layouts: layouts.map((layout: (typeof layouts)[number]) => layoutResponse(layout)),
    };
  });

  app.get('/layouts/active', async (_request, reply) => {
    const layout = await prisma.layoutConfig.findFirst({
      where: {
        active: true,
      },
      include: {
        slots: {
          include: {
            camera: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
    });

    if (!layout) {
      reply.status(404);
      return {
        message: 'No active layout found',
      };
    }

    return {
      layout: layoutResponse(layout),
    };
  });

  app.post('/layouts', async (request, reply) => {
    const parsed = layoutInputSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid layout payload',
        issues: parsed.error.issues,
      };
    }

    const layout = await prisma.layoutConfig.create({
      data: {
        name: parsed.data.name,
        slots: {
          create: parsed.data.slots.map((slot) => ({
            slotIndex: slot.slotIndex,
            cameraId: slot.cameraId,
          })),
        },
      },
      include: {
        slots: {
          include: {
            camera: {
              include: {
                vehicle: true,
              },
            },
          },
        },
      },
    });

    reply.status(201);
    return {
      layout: layoutResponse(layout),
    };
  });

  app.put('/layouts/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
    const parsed = layoutInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid layout update payload',
        issues: [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)],
      };
    }

    const layout = await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.layoutSlot.deleteMany({
        where: {
          layoutConfigId: params.data.id,
        },
      });

      return tx.layoutConfig.update({
        where: {
          id: params.data.id,
        },
        data: {
          name: parsed.data.name,
          slots: {
            create: parsed.data.slots.map((slot) => ({
              slotIndex: slot.slotIndex,
              cameraId: slot.cameraId,
            })),
          },
        },
        include: {
          slots: {
            include: {
              camera: {
                include: {
                  vehicle: true,
                },
              },
            },
          },
        },
      });
    });

    return {
      layout: layoutResponse(layout),
    };
  });

  app.delete('/layouts/:id', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        message: 'Invalid layout id',
        issues: params.error.issues,
      };
    }

    const layout = await prisma.layoutConfig.findUnique({
      where: {
        id: params.data.id,
      },
      select: {
        active: true,
      },
    });

    if (!layout) {
      reply.status(404);
      return {
        message: 'Layout not found',
      };
    }

    await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.layoutConfig.delete({
        where: {
          id: params.data.id,
        },
      });

      if (layout.active) {
        const replacement = await tx.layoutConfig.findFirst({
          orderBy: {
            updatedAt: 'desc',
          },
        });

        if (replacement) {
          await tx.layoutConfig.update({
            where: {
              id: replacement.id,
            },
            data: {
              active: true,
            },
          });
        }
      }
    });

    return {
      status: 'ok',
    };
  });

  app.post('/layouts/:id/activate', async (request, reply) => {
    const params = z.object({ id: z.string().trim().min(1) }).safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        message: 'Invalid layout id',
        issues: params.error.issues,
      };
    }

    const layout = await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.layoutConfig.updateMany({
        data: {
          active: false,
        },
      });

      return tx.layoutConfig.update({
        where: {
          id: params.data.id,
        },
        data: {
          active: true,
        },
        include: {
          slots: {
            include: {
              camera: {
                include: {
                  vehicle: true,
                },
              },
            },
          },
        },
      });
    });

    return {
      layout: layoutResponse(layout),
    };
  });
};
