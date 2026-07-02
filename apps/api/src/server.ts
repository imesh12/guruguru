import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import process from 'node:process';

import './services/runtime-config.js';
import { authRoutes } from './routes/auth.js';
import { fieldTestRoutes } from './routes/field-tests.js';
import { fleetRoutes } from './routes/fleet.js';
import { gpsRoutes } from './routes/gps.js';
import { healthRoutes } from './routes/health.js';
import { locationRoutes } from './routes/locations.js';
import { placeMarkerRoutes } from './routes/place-markers.js';
import { systemRoutes } from './routes/system.js';
import { getApiHost, requireAdminToken } from './services/api-security.js';
import { warnIfCredentialKeyMissing } from './services/camera-credentials.js';
import { FileLogger } from './services/file-logger.js';
import { DailyRouteReportService } from './services/location/daily-route-report.js';
import { LocationHistoryStore } from './services/location/location-history-store.js';
import { LocationManager } from './services/location/location-manager.js';
import { Se220DirectPoller } from './services/location/se220-direct-poller.js';
import { LocationStatus, hasUsableCoordinates, type VehicleLocation } from './services/location/types.js';
import { MediaMtxConfigService } from './services/mediamtx-config-service.js';
import { GpsStateService } from './services/gps-state.js';
import { initializeSqlitePragmas, prisma } from './services/prisma.js';
import { Se220Receiver } from './services/se220-receiver.js';
import { SystemHealthService } from './services/system-health.js';
import { registerVehicleLocationSocket } from './websocket.js';

const port = Number(process.env.API_PORT ?? 4000);
const host = getApiHost();

const buildServer = () => {
  const apiLog = new FileLogger('api');
  const app = Fastify({
    logger: {
      redact: {
        paths: ['req.headers.authorization', 'headers.authorization', 'password', 'apiToken', 'api_token', 'CREDENTIAL_ENCRYPTION_KEY', 'API_TOKEN'],
        censor: '[REDACTED]',
      },
    },
  });

  app.decorate('requireAdminToken', requireAdminToken);

  app.register(cors, {
    origin: true,
  });
  app.register(websocket);
  app.log.info({ plugin: '@fastify/websocket' }, '[gnss-investigation] websocket plugin registered');

  app.addHook('onRequest', async (request) => {
    if (request.headers.upgrade?.toLowerCase() === 'websocket') {
      app.log.info(
        {
          method: request.method,
          url: request.url,
          origin: request.headers.origin ?? null,
          userAgent: request.headers['user-agent'] ?? null,
        },
        '[gnss-investigation] websocket upgrade request',
      );
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (request.headers.upgrade?.toLowerCase() === 'websocket' || request.url === '/ws/vehicles') {
      app.log.error(
        {
          error,
          method: request.method,
          url: request.url,
          upgrade: request.headers.upgrade ?? null,
        },
        '[gnss-investigation] websocket request failed',
      );
    }

    reply.send(error);
  });

  warnIfCredentialKeyMissing({
    warn: (context, message) => app.log.warn(context, message),
  });

  const gpsState = new GpsStateService(app.log);
  const mediamtxConfigService = new MediaMtxConfigService(app.log);
  const se220Receiver = new Se220Receiver(gpsState, app.log);
  const systemHealth = new SystemHealthService(gpsState, se220Receiver, app.log);
  const locationHistoryStore = new LocationHistoryStore(app.log);
  const dailyRouteReportService = new DailyRouteReportService(locationHistoryStore);
  const locationManager = new LocationManager(locationHistoryStore, app.log);
  const se220DirectPoller = new Se220DirectPoller(locationManager, app.log);
  locationManager.registerProvider(se220DirectPoller);

  const shouldBridgeLocationToGpsState = (location: VehicleLocation) => {
    if (!hasUsableCoordinates(location)) {
      return false;
    }

    return location.status === LocationStatus.ONLINE || location.status === LocationStatus.STALE;
  };

  const bridgeLocationToGpsStateInFlight = new WeakMap<VehicleLocation, Promise<void>>();
  const bridgeVehicleLocationToGpsState = (location: VehicleLocation) => {
    const existing = bridgeLocationToGpsStateInFlight.get(location);
    if (existing) {
      return existing;
    }

    const bridgePromise = (async () => {
      if (!shouldBridgeLocationToGpsState(location)) {
        return;
      }

      const gpsBridgeStartedAtMs = Date.now();
      const vehicle = await prisma.vehicle.findUnique({
        where: {
          id: location.vehicleId,
        },
        select: {
          id: true,
          name: true,
        },
      });
      if (!vehicle) {
        return;
      }

      const lat = location.latitude;
      const lng = location.longitude;
      if (lat === null || lng === null) {
        return;
      }

      const gpsStateIngestedAt = new Date().toISOString();
      const backendProcessingMs =
        location.investigation?.apiPollReceivedAt
          ? Math.max(0, gpsBridgeStartedAtMs - Date.parse(location.investigation.apiPollReceivedAt))
          : null;

      app.log.info(
        {
          vehicleId: vehicle.id,
          source: location.source,
          routerGnssTime: location.investigation?.routerGnssTime ?? location.gnssTime,
          apiPollReceivedAt: location.investigation?.apiPollReceivedAt ?? location.receivedAt,
          gpsStateIngestedAt,
          backendProcessingMs,
        },
        '[gnss-investigation] gps-state ingest',
      );

      await gpsState.ingest({
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        lat,
        lng,
        locationStatus: location.status,
        speed: location.speedMps ?? undefined,
        heading: location.headingDegrees ?? undefined,
        speedMps: location.speedMps ?? undefined,
        headingDegrees: location.headingDegrees ?? undefined,
        accuracyMeters: location.accuracyMeters ?? undefined,
        gpsQuality: location.gpsQuality ?? undefined,
        source: location.source,
        receivedAt: location.receivedAt,
        investigation: {
          ...(location.investigation ?? {}),
          gpsStateIngestedAt,
          backendProcessingMs,
        },
      });

      if (location.source === 'android-phone') {
        app.log.info(
          {
            vehicleId: vehicle.id,
            vehicleName: vehicle.name,
            source: location.source,
            status: location.status,
            latitude: lat,
            longitude: lng,
            receivedAt: location.receivedAt,
            gnssTime: location.gnssTime,
          },
          '[android-location] bridged-to-gps-state',
        );
      }
    })()
      .catch((error) => {
        app.log.warn(
          {
            error,
            vehicleId: location.vehicleId,
            source: location.source,
          },
          'Failed to bridge LocationManager update into the legacy GPS feed.',
        );
        throw error;
      })
      .finally(() => {
        bridgeLocationToGpsStateInFlight.delete(location);
      });

    bridgeLocationToGpsStateInFlight.set(location, bridgePromise);
    return bridgePromise;
  };

  locationManager.subscribe((location) => {
    void bridgeVehicleLocationToGpsState(location);
  });

  app.get('/', async () => ({
    name: 'kurukuru-monitor-api',
    status: 'ok',
  }));

  app.register(healthRoutes, { prefix: '/health' });
  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(fieldTestRoutes);
  app.register(fleetRoutes, { mediamtxConfigService });
  app.register(gpsRoutes(gpsState), { prefix: '/gps' });
  app.register(locationRoutes(locationManager, locationHistoryStore, dailyRouteReportService, bridgeVehicleLocationToGpsState), { prefix: '/api' });
  app.register(placeMarkerRoutes, { prefix: '/api' });
  app.register(systemRoutes(systemHealth), { prefix: '/system' });
  registerVehicleLocationSocket(app, gpsState);
  app.log.info({ route: '/ws/vehicles' }, '[gnss-investigation] websocket route registered');

  app.addHook('onReady', async () => {
    await initializeSqlitePragmas();
    locationHistoryStore.startRetentionMaintenance();
    void locationHistoryStore.runRetentionCleanup('startup').catch((error) => {
      app.log.warn({ error }, 'Route history startup retention cleanup failed. Continuing startup.');
    });
    try {
      await gpsState.runMaintenance();
    } catch (error) {
      app.log.warn({ error }, 'GPS startup maintenance failed. Continuing with degraded startup.');
      await apiLog.warn('GPS startup maintenance failed. Continuing with degraded startup.', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await systemHealth.initialize();
    if (mediamtxConfigService.isAutoRegenerateEnabled()) {
      void mediamtxConfigService.regenerateNow('startup').catch((error) => {
        app.log.warn(
          {
            error,
          },
          '[mediamtx] startup regeneration failed',
        );
      });
    }
    await locationManager.start();
    await se220Receiver.start();
    await apiLog.info('API ready.', { host, port });
  });

  app.addHook('onClose', async () => {
    systemHealth.stop();
    locationHistoryStore.stopRetentionMaintenance();
    await locationManager.stop();
    await se220Receiver.stop();
    gpsState.stop();
    await gpsState.flushPending();
    await prisma.$disconnect();
    await apiLog.info('API stopped.');
  });

  return app;
};

const start = async () => {
  const app = buildServer();

  try {
    await app.listen({
      host,
      port,
    });
  } catch (error) {
    app.log.error(error);
    await new FileLogger('api').error('API failed to start.', { host, port });
    process.exit(1);
  }
};

void start();
