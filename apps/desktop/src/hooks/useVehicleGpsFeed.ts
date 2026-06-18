import { useEffect, useMemo, useRef, useState } from 'react';

import type { VehicleAdmin, VehicleGpsState, VehicleMapStatus, VehicleMapViewModel } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:4000';

type AnimatedPoint = VehicleGpsState & {
  currentLat: number;
  currentLng: number;
  sourceLat: number;
  sourceLng: number;
  targetLat: number;
  targetLng: number;
  animationStart: number;
  animationDurationMs: number;
};

type SnapshotSource = 'websocket' | 'http' | 'demo';

const toStatus = (ageSeconds: number): VehicleMapStatus => {
  if (ageSeconds <= 5) {
    return 'ONLINE';
  }
  if (ageSeconds <= 15) {
    return 'DELAYED';
  }
  return 'OFFLINE';
};

export function useVehicleGpsFeed(enabled = true) {
  const [vehicles, setVehicles] = useState<VehicleMapViewModel[]>([]);
  const [connected, setConnected] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetsRef = useRef<Map<string, AnimatedPoint>>(new Map());
  const vehicleColorsRef = useRef<Map<string, string>>(new Map());
  const frontendSequenceRef = useRef(0);
  const websocketConnectedRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setVehicles([]);
      setConnected(false);
      setDemoMode(false);
      setError(null);
      targetsRef.current.clear();
      vehicleColorsRef.current.clear();
      websocketConnectedRef.current = false;
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let frame = 0;
    let reconnectTimer = 0;
    let ageTimer = 0;
    let demoTimer = 0;
    let refreshTimer = 0;
    let vehicleRefreshTimer = 0;
    let resolvedApiBaseUrl = API_BASE_URL;
    let resolvedWebSocketUrl = `${API_BASE_URL.replace(/^http/u, 'ws')}/ws/vehicles`;

    const loadVehicleColors = async () => {
      const list = await window.electronAPI.listVehicles();
      if (disposed) {
        return;
      }

      vehicleColorsRef.current = new Map(
        list.map((vehicle: VehicleAdmin) => [vehicle.id, vehicle.displayColor]),
      );
      syncState();
    };

    const syncState = () => {
      const now = Date.now();
      const nextVehicles = Array.from(targetsRef.current.values()).map((entry) => {
        const duration = Math.max(entry.animationDurationMs, 1);
        const progress = Math.min(1, (now - entry.animationStart) / duration);
        const lat = entry.sourceLat + (entry.targetLat - entry.sourceLat) * progress;
        const lng = entry.sourceLng + (entry.targetLng - entry.sourceLng) * progress;
        const ageSeconds = Math.max(0, Math.floor((now - new Date(entry.receivedAt).getTime()) / 1000));
        const status = toStatus(ageSeconds);

        entry.currentLat = lat;
        entry.currentLng = lng;

        return {
          vehicleId: entry.vehicleId,
          vehicleName: entry.vehicleName,
          lat,
          lng,
          locationStatus: entry.locationStatus,
          speed: entry.speed,
          heading: entry.heading,
          speedMps: entry.speedMps,
          headingDegrees: entry.headingDegrees,
          accuracyMeters: entry.accuracyMeters,
          gpsQuality: entry.gpsQuality,
          source: entry.source,
          receivedAt: entry.receivedAt,
          investigation: entry.investigation ?? null,
          color: vehicleColorsRef.current.get(entry.vehicleId) ?? '#38bdf8',
          ageSeconds,
          status,
        };
      });

      nextVehicles.sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
      if (!disposed) {
        setVehicles(nextVehicles);
      }
    };

    const animationLoop = () => {
      syncState();
      frame = window.requestAnimationFrame(animationLoop);
    };

    const logMapInvestigation = (phase: 'received' | 'rendered' | 'displayed', details: Record<string, unknown>) => {
      console.info('[map-investigation]', JSON.stringify({ phase, ...details }));
    };

    const applySnapshot = (payload: VehicleGpsState[], replaceMissing = false, source: SnapshotSource = 'websocket') => {
      const now = performance.now();
      const frontendMessageReceivedAt = new Date().toISOString();
      const nextIds = new Set(payload.map((vehicle) => vehicle.vehicleId));

      if (replaceMissing) {
        for (const vehicleId of Array.from(targetsRef.current.keys())) {
          if (!nextIds.has(vehicleId)) {
            targetsRef.current.delete(vehicleId);
          }
        }
      }

      for (const vehicle of payload) {
        const frontendSequence = ++frontendSequenceRef.current;
        const backendReferenceTime =
          vehicle.investigation?.websocketBroadcastAt ??
          vehicle.investigation?.latestApiResponseAt ??
          vehicle.investigation?.gpsStateIngestedAt ??
          vehicle.investigation?.locationManagerUpdatedAt ??
          vehicle.investigation?.apiPollReceivedAt ??
          vehicle.receivedAt;
        const websocketMs =
          vehicle.investigation?.websocketBroadcastAt
            ? Math.max(0, Date.parse(frontendMessageReceivedAt) - Date.parse(vehicle.investigation.websocketBroadcastAt))
            : null;
        const frontendDelayMs = 0;
        const totalDelayMs =
          vehicle.investigation?.routerGnssTime
            ? Math.max(0, Date.parse(frontendMessageReceivedAt) - Date.parse(vehicle.investigation.routerGnssTime))
            : backendReferenceTime
              ? Math.max(0, Date.parse(frontendMessageReceivedAt) - Date.parse(backendReferenceTime))
              : null;

        logMapInvestigation('received', {
          source,
          vehicleId: vehicle.vehicleId,
          vehicleName: vehicle.vehicleName,
          routerGnssTime: vehicle.investigation?.routerGnssTime ?? null,
          frontendMessageReceivedAt,
          latitude: vehicle.lat,
          longitude: vehicle.lng,
          routerSampleAgeMs: vehicle.investigation?.routerSampleAgeMs ?? null,
          backendProcessingMs: vehicle.investigation?.backendProcessingMs ?? null,
          websocketMs,
          frontendRenderMs: frontendDelayMs,
          totalDelayMs,
          coordinateChanged: vehicle.investigation?.coordinateChanged ?? null,
          intervalSinceLastCoordinateChangeMs: vehicle.investigation?.intervalSinceLastCoordinateChangeMs ?? null,
          distanceFromPreviousMeters: vehicle.investigation?.distanceFromPreviousMeters ?? null,
          speedEstimateMps: vehicle.investigation?.speedEstimateMps ?? null,
          headingEstimateDeg: vehicle.investigation?.headingEstimateDeg ?? null,
          suspiciousJump: vehicle.investigation?.suspiciousJump ?? null,
          duplicateSample: vehicle.investigation?.duplicateSample ?? null,
        });

        const existing = targetsRef.current.get(vehicle.vehicleId);
        const sameCoordinates =
          existing !== undefined &&
          existing.targetLat === vehicle.lat &&
          existing.targetLng === vehicle.lng;
        const sameReceivedAt = existing !== undefined && existing.receivedAt === vehicle.receivedAt;
        const isDuplicateSample = sameCoordinates && sameReceivedAt;
        if (existing) {
          existing.vehicleName = vehicle.vehicleName;
          existing.locationStatus = vehicle.locationStatus;
          existing.speed = vehicle.speed;
          existing.heading = vehicle.heading;
          existing.speedMps = vehicle.speedMps;
          existing.headingDegrees = vehicle.headingDegrees;
          existing.accuracyMeters = vehicle.accuracyMeters;
          existing.gpsQuality = vehicle.gpsQuality;
          existing.source = vehicle.source;
          existing.receivedAt = vehicle.receivedAt;
          existing.investigation = {
            ...(vehicle.investigation ?? {}),
            frontendMessageReceivedAt,
            frontendMessageReceivedPerfMs: now,
            frontendSequence,
          };

          if (source === 'http' && websocketConnectedRef.current) {
            continue;
          }

          if (isDuplicateSample) {
            existing.receivedAt = vehicle.receivedAt;
            existing.investigation = {
              ...(vehicle.investigation ?? {}),
              frontendMessageReceivedAt,
              frontendMessageReceivedPerfMs: now,
              frontendSequence,
            };

            if (source === 'http') {
              logMapInvestigation('received', {
                source,
                vehicleId: vehicle.vehicleId,
                skipped: true,
                reason: 'same-coordinate-same-receivedAt',
                routerSampleAgeMs: vehicle.investigation?.routerSampleAgeMs ?? null,
                totalDelayMs,
              });
            }

            continue;
          }

          existing.sourceLat = existing.currentLat;
          existing.sourceLng = existing.currentLng;
          existing.targetLat = vehicle.lat;
          existing.targetLng = vehicle.lng;
          existing.receivedAt = vehicle.receivedAt;
          existing.animationStart = now;
          existing.animationDurationMs = 900;
        } else {
          targetsRef.current.set(vehicle.vehicleId, {
            ...vehicle,
            investigation: {
              ...(vehicle.investigation ?? {}),
              frontendMessageReceivedAt,
              frontendMessageReceivedPerfMs: now,
              frontendSequence,
            },
            currentLat: vehicle.lat,
            currentLng: vehicle.lng,
            sourceLat: vehicle.lat,
            sourceLng: vehicle.lng,
            targetLat: vehicle.lat,
            targetLng: vehicle.lng,
            animationStart: now,
            animationDurationMs: 1,
          });
        }

        if (import.meta.env.DEV) {
          console.debug('[vehicle-status-debug]', {
            vehicleId: vehicle.vehicleId,
            status: toStatus(Math.max(0, Math.floor((Date.now() - new Date(vehicle.receivedAt).getTime()) / 1000))),
            locationStatus: vehicle.locationStatus ?? null,
            rawVehicle: vehicle,
          });
        }
      }

      syncState();
    };

    const fetchLatest = async (reason: 'initial' | 'fallback' | 'health-check' = 'fallback') => {
      if (websocketConnectedRef.current && reason !== 'health-check') {
        return;
      }

      const response = await fetch(`${resolvedApiBaseUrl}/gps/latest`);
      if (reason === 'health-check' && websocketConnectedRef.current) {
        return;
      }

      const body = (await response.json()) as { vehicles: VehicleGpsState[] };
      applySnapshot(body.vehicles, true, 'http');
    };

    const startDemoMode = () => {
      setDemoMode(true);
      setConnected(true);
      let step = 0;
      const routeA: Array<[number, number]> = [
        [35.6804, 139.769],
        [35.6809, 139.7697],
        [35.6813, 139.7704],
        [35.6818, 139.771],
      ];
      const routeB: Array<[number, number]> = [
        [35.6816, 139.7712],
        [35.6812, 139.7718],
        [35.6808, 139.7724],
        [35.6803, 139.7729],
      ];

      const pushDemoSnapshot = () => {
        const index = step % routeA.length;
        const pointA = routeA[index] ?? routeA[0] ?? [35.6804, 139.769];
        const pointB = routeB[index] ?? routeB[0] ?? [35.6816, 139.7712];
        const receivedAt = new Date().toISOString();
        applySnapshot([
          {
            vehicleId: 'vehicle-1',
            vehicleName: 'Vehicle 1',
            lat: pointA[0],
            lng: pointA[1],
            speed: 18,
            heading: 72,
            receivedAt,
          },
          {
            vehicleId: 'vehicle-2',
            vehicleName: 'Vehicle 2',
            lat: pointB[0],
            lng: pointB[1],
            speed: 15,
            heading: 218,
            receivedAt,
          },
        ], false, 'demo');
        step += 1;
      };

      pushDemoSnapshot();
      demoTimer = window.setInterval(pushDemoSnapshot, 1000);
    };

    const connect = () => {
      console.info('[map-investigation]', JSON.stringify({ phase: 'websocket connecting', url: resolvedWebSocketUrl }));
      socket = new WebSocket(resolvedWebSocketUrl);

      socket.addEventListener('open', () => {
        websocketConnectedRef.current = true;
        console.info('[map-investigation]', JSON.stringify({ phase: 'websocket connected', url: resolvedWebSocketUrl }));
        setConnected(true);
        setError(null);
      });

      socket.addEventListener('message', (event) => {
        console.info('[map-investigation]', JSON.stringify({ phase: 'websocket message received', url: resolvedWebSocketUrl }));
        const payload = JSON.parse(event.data) as { type: 'snapshot' | 'update'; vehicles?: VehicleGpsState[]; vehicle?: VehicleGpsState };
        if (payload.type === 'snapshot' && payload.vehicles) {
          applySnapshot(payload.vehicles, true, 'websocket');
        }
        if (payload.type === 'update' && payload.vehicle) {
          applySnapshot([payload.vehicle], false, 'websocket');
        }
      });

      socket.addEventListener('close', () => {
        websocketConnectedRef.current = false;
        console.info('[map-investigation]', JSON.stringify({ phase: 'websocket closed', url: resolvedWebSocketUrl }));
        setConnected(false);
        void fetchLatest('fallback').catch(() => {
          // Keep fallback resilient if HTTP refresh is temporarily unavailable at disconnect time.
        });
        reconnectTimer = window.setTimeout(connect, 1500);
      });

      socket.addEventListener('error', () => {
        websocketConnectedRef.current = false;
        console.info('[map-investigation]', JSON.stringify({ phase: 'websocket error', url: resolvedWebSocketUrl }));
        socket?.close();
      });
    };

    void window.electronAPI
      .getRuntimeConfig()
      .then((config) => {
        if (disposed) {
          return;
        }

        resolvedApiBaseUrl = config.apiBaseUrl?.trim() || API_BASE_URL;
        const webSocketUrl = new URL('/ws/vehicles', resolvedApiBaseUrl);
        webSocketUrl.protocol = webSocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
        resolvedWebSocketUrl = webSocketUrl.toString();

        console.info(
          '[map-investigation]',
          JSON.stringify({
            phase: 'runtime config resolved',
            apiBaseUrl: resolvedApiBaseUrl,
            webSocketUrl: resolvedWebSocketUrl,
            demoMode: config.demoMode,
          }),
        );

        if (config.demoMode) {
          setDemoMode(true);
          startDemoMode();
          return;
        }

        setDemoMode(false);
        void loadVehicleColors().catch(() => {
          // Fall back to default marker colors if vehicle metadata is temporarily unavailable.
        });
        void fetchLatest('initial').catch(() => {
          setError('API unavailable');
        });
        connect();
        refreshTimer = window.setInterval(() => {
          void fetchLatest(websocketConnectedRef.current ? 'health-check' : 'fallback').catch(() => {
            // Keep the existing websocket-driven UI stable if a single refresh fails.
          });
        }, 1000);
        vehicleRefreshTimer = window.setInterval(() => {
          void loadVehicleColors().catch(() => {
            // Keep the current map usable if vehicle settings cannot be refreshed momentarily.
          });
        }, 5000);
      })
      .catch(() => {
        setError('Runtime configuration unavailable');
      });

    frame = window.requestAnimationFrame(animationLoop);
    ageTimer = window.setInterval(syncState, 1000);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(reconnectTimer);
      window.clearInterval(ageTimer);
      window.clearInterval(demoTimer);
      window.clearInterval(refreshTimer);
      window.clearInterval(vehicleRefreshTimer);
      socket?.close();
      websocketConnectedRef.current = false;
    };
  }, [enabled]);

  return useMemo(
    () => ({
      vehicles,
      connected,
      demoMode,
      error,
    }),
    [connected, demoMode, error, vehicles],
  );
}
