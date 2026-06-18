import type { GpsStateService } from './services/gps-state.js';
import { prisma } from './services/prisma.js';

type SocketMessage = Buffer | ArrayBuffer | Buffer[];

type RealSocket = {
  OPEN: number;
  readyState: number;
  isAlive?: boolean | undefined;
  send: (payload: string) => void;
  ping: () => void;
  terminate: () => void;
  on: (event: 'pong' | 'close' | 'message', listener: (() => void) | ((_payload: SocketMessage) => void)) => void;
};

type WebSocketConnection = {
  socket?: RealSocket | undefined;
};

const HEARTBEAT_INTERVAL_MS = 10_000;

export const registerVehicleLocationSocket = (
  app: {
    websocketServer: {
      clients: Set<RealSocket>;
    };
    log: {
      info: (context: unknown, message?: string) => void;
      warn: (context: unknown, message?: string) => void;
      error: (context: unknown, message?: string) => void;
    };
    get: (path: string, options: { websocket: true }, handler: (connection: RealSocket | WebSocketConnection) => void) => void;
    addHook: (name: 'onClose', hook: () => void) => void;
  },
  gpsState: GpsStateService,
) => {
  const websocketClients = new Set<RealSocket>();

  const resolveRealSocket = (candidate: RealSocket | WebSocketConnection | null | undefined) => {
    if (candidate && typeof (candidate as RealSocket).send === 'function') {
      return candidate as RealSocket;
    }

    if (candidate && typeof (candidate as WebSocketConnection).socket?.send === 'function') {
      return (candidate as WebSocketConnection).socket as RealSocket;
    }

    return null;
  };

  const sendSocketSnapshot = (
    client: RealSocket | WebSocketConnection | null | undefined,
    vehicles: ReturnType<GpsStateService['listLatest']>,
    reason: 'connect' | 'broadcast',
  ) => {
    const realSocket = resolveRealSocket(client);
    if (!realSocket || typeof realSocket.send !== 'function') {
      app.log.warn(
        {
          reason,
          candidateType: client === null ? 'null' : typeof client,
          hasSocket: Boolean((client as WebSocketConnection | undefined)?.socket),
        },
        '[gnss-investigation] websocket client missing send; snapshot skipped',
      );
      return false;
    }

    const nowMs = Date.now();
    const websocketBroadcastAt = new Date(nowMs).toISOString();
    try {
      realSocket.send(
        JSON.stringify({
          type: 'snapshot',
          vehicles: vehicles.map((vehicle) => ({
            ...vehicle,
            investigation: {
              ...(vehicle.investigation ?? {}),
              websocketBroadcastAt,
              websocketBroadcastLatencyMs:
                vehicle.investigation?.gpsStateIngestedAt
                  ? Math.max(0, nowMs - Date.parse(vehicle.investigation.gpsStateIngestedAt))
                  : null,
            },
          })),
        }),
      );
      app.log.info(
        {
          vehicleCount: vehicles.length,
          websocketBroadcastAt,
          reason,
        },
        '[gnss-investigation] websocket snapshot sent',
      );
      return true;
    } catch (error) {
      app.log.error(
        {
          error,
          reason,
          vehicleCount: vehicles.length,
        },
        '[gnss-investigation] websocket snapshot send failed',
      );
      return false;
    }
  };

  gpsState.subscribe((update, snapshot) => {
    void (async () => {
      const broadcastStartedAtMs = Date.now();
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
      const websocketBroadcastAt = new Date(broadcastStartedAtMs).toISOString();
      const filteredSnapshot = snapshot
        .filter((vehicle: { vehicleId: string }) => validVehicleIds.has(vehicle.vehicleId))
        .map((vehicle) => ({
          ...vehicle,
          investigation: {
            ...(vehicle.investigation ?? {}),
            websocketBroadcastAt,
            websocketBroadcastLatencyMs:
              vehicle.investigation?.gpsStateIngestedAt
                ? Math.max(0, broadcastStartedAtMs - Date.parse(vehicle.investigation.gpsStateIngestedAt))
                : null,
          },
        }));

      if (!validVehicleIds.has(update.vehicleId)) {
        return;
      }

      const targetVehicle = filteredSnapshot.find((vehicle) => vehicle.vehicleId === update.vehicleId);
      const clientCount = Array.from(websocketClients).filter((client) => client.readyState === client.OPEN).length;
      app.log.info(
        {
          vehicleId: update.vehicleId,
          clientCount,
          vehicleCount: filteredSnapshot.length,
          receivedAt: update.receivedAt,
        },
        '[websocket] vehicle broadcast',
      );
      app.log.info(
        {
          vehicleId: update.vehicleId,
          websocketBroadcastAt,
          websocketMs: targetVehicle?.investigation?.websocketBroadcastLatencyMs ?? null,
          clientCount,
        },
        '[gnss-investigation] websocket broadcast clientCount',
      );

      websocketClients.forEach((client) => {
        if (client.readyState === client.OPEN) {
          sendSocketSnapshot(client, filteredSnapshot, 'broadcast');
        }
      });
    })().catch((error) => {
      app.log.error(
        {
          error,
          vehicleId: update.vehicleId,
        },
        '[gnss-investigation] websocket broadcast failed',
      );
    });
  });

  const heartbeatTimer = setInterval(() => {
    websocketClients.forEach((client) => {
      if (client.readyState !== client.OPEN) {
        return;
      }

      if (client.isAlive === false) {
        client.terminate();
        return;
      }

      client.isAlive = false;
      client.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  app.addHook('onClose', () => {
    clearInterval(heartbeatTimer);
  });

  app.get('/ws/vehicles', { websocket: true }, (connection) => {
    const socket = resolveRealSocket(connection);
    if (!socket) {
      app.log.error(
        {
          candidateType: connection === null ? 'null' : typeof connection,
          hasSocket: Boolean((connection as WebSocketConnection | undefined)?.socket),
        },
        '[gnss-investigation] websocket handshake failed: real socket not found',
      );
      return;
    }

    try {
      socket.isAlive = true;
      websocketClients.add(socket);
      socket.on('pong', () => {
        socket.isAlive = true;
      });
      socket.on('close', () => {
        socket.isAlive = false;
        websocketClients.delete(socket);
        app.log.info({}, '[gnss-investigation] websocket client closed');
      });

      app.log.info(
        {
          registeredClientCount: websocketClients.size,
        },
        '[gnss-investigation] websocket client registered',
      );

      // Send the latest cached GNSS state immediately and keep the handshake path free of DB dependencies.
      sendSocketSnapshot(socket, gpsState.listLatest(), 'connect');

      void (async () => {
        try {
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
          sendSocketSnapshot(socket, gpsState.listLatestForVehicleIds(validVehicleIds), 'connect');
        } catch (error) {
          app.log.error(
            {
              error,
            },
            '[gnss-investigation] websocket enabled-vehicle refresh failed',
          );
        }
      })();

      socket.on('message', (_payload: SocketMessage) => {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: 'Server websocket is broadcast-only. Use POST /gps/mock for local testing.',
          }),
        );
      });
    } catch (error) {
      app.log.error(
        {
          error,
        },
        '[gnss-investigation] websocket handshake handler failed',
      );
      throw error;
    }
  });
};
