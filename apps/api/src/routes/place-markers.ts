import { randomUUID } from 'node:crypto';

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import {
  listPlaceMarkers,
  savePlaceMarkers,
  type PlaceMarkerIconId,
  type PlaceMarkerRecord,
} from '../services/place-markers.js';

const placeMarkerIconIds = [
  'red-pin',
  'blue-pin',
  'green-pin',
  'yellow-pin',
  'warning',
  'camera',
  'facility',
  'parking',
  'office',
  'work-area',
] as const satisfies readonly PlaceMarkerIconId[];

const placeMarkerInputSchema = z.object({
  title: z.string().trim().min(1),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  markerIconId: z.enum(placeMarkerIconIds),
  description: z.string().trim().optional(),
});

const placeMarkerParamsSchema = z.object({
  id: z.string().trim().min(1),
});

export const placeMarkerRoutes: FastifyPluginAsync = async (app) => {
  app.get('/place-markers', async () => ({
    placeMarkers: listPlaceMarkers(),
  }));

  app.post('/place-markers', async (request, reply) => {
    await app.requireAdminToken(request, reply);

    const parsed = placeMarkerInputSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid place marker payload',
        issues: parsed.error.issues,
      };
    }

    const now = new Date().toISOString();
    const nextMarker: PlaceMarkerRecord = {
      id: randomUUID(),
      title: parsed.data.title,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      markerIconId: parsed.data.markerIconId,
      description: parsed.data.description || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const placeMarkers = listPlaceMarkers();
    const nextPlaceMarkers = [...placeMarkers, nextMarker].sort((left, right) => left.title.localeCompare(right.title, 'ja'));
    savePlaceMarkers(nextPlaceMarkers);

    reply.status(201);
    return {
      placeMarker: nextMarker,
      placeMarkers: nextPlaceMarkers,
    };
  });

  app.put('/place-markers/:id', async (request, reply) => {
    await app.requireAdminToken(request, reply);

    const params = placeMarkerParamsSchema.safeParse(request.params);
    const parsed = placeMarkerInputSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      reply.status(400);
      return {
        message: 'Invalid place marker update payload',
        issues: [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)],
      };
    }

    const placeMarkers = listPlaceMarkers();
    const index = placeMarkers.findIndex((placeMarker) => placeMarker.id === params.data.id);
    if (index < 0) {
      reply.status(404);
      return {
        message: 'Place marker not found',
      };
    }

    const current = placeMarkers[index]!;
    const updatedMarker: PlaceMarkerRecord = {
      id: current.id,
      createdAt: current.createdAt,
      title: parsed.data.title,
      latitude: parsed.data.latitude,
      longitude: parsed.data.longitude,
      markerIconId: parsed.data.markerIconId,
      description: parsed.data.description || undefined,
      updatedAt: new Date().toISOString(),
    };

    const nextPlaceMarkers = placeMarkers.slice();
    nextPlaceMarkers[index] = updatedMarker;
    nextPlaceMarkers.sort((left, right) => left.title.localeCompare(right.title, 'ja'));
    savePlaceMarkers(nextPlaceMarkers);

    return {
      placeMarker: updatedMarker,
      placeMarkers: nextPlaceMarkers,
    };
  });

  app.delete('/place-markers/:id', async (request, reply) => {
    await app.requireAdminToken(request, reply);

    const params = placeMarkerParamsSchema.safeParse(request.params);
    if (!params.success) {
      reply.status(400);
      return {
        message: 'Invalid place marker id',
        issues: params.error.issues,
      };
    }

    const placeMarkers = listPlaceMarkers();
    const nextPlaceMarkers = placeMarkers.filter((placeMarker) => placeMarker.id !== params.data.id);
    if (nextPlaceMarkers.length === placeMarkers.length) {
      reply.status(404);
      return {
        message: 'Place marker not found',
      };
    }

    savePlaceMarkers(nextPlaceMarkers);
    return {
      status: 'ok',
      placeMarkers: nextPlaceMarkers,
    };
  });
};
