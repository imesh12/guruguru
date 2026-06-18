import { useEffect, useMemo, useRef, useState } from 'react';

import { vehicleDemoRoutes } from '../demo/kawachinagano-demo-routes';
import type { VehicleMapViewModel } from '../types';

type DemoAnimatedVehicle = {
  vehicleId: string;
  vehicleName: string;
  color: string;
  route: Array<{ lat: number; lng: number; speed: number; heading: number }>;
  routeIndex: number;
  direction: 1 | -1;
  currentLat: number;
  currentLng: number;
  sourceLat: number;
  sourceLng: number;
  targetLat: number;
  targetLng: number;
  speed: number;
  heading: number;
  receivedAt: string;
  animationStart: number;
  animationDurationMs: number;
};

const DEMO_VEHICLES: DemoAnimatedVehicle[] = [
  {
    vehicleId: 'vehicle-1',
    vehicleName: 'Vehicle 1',
    color: '#ef4444',
    route: vehicleDemoRoutes.vehicle1,
    routeIndex: 0,
    direction: 1,
    currentLat: vehicleDemoRoutes.vehicle1[0]?.lat ?? 34.43295176377536,
    currentLng: vehicleDemoRoutes.vehicle1[0]?.lng ?? 135.56125363751843,
    sourceLat: vehicleDemoRoutes.vehicle1[0]?.lat ?? 34.43295176377536,
    sourceLng: vehicleDemoRoutes.vehicle1[0]?.lng ?? 135.56125363751843,
    targetLat: vehicleDemoRoutes.vehicle1[1]?.lat ?? vehicleDemoRoutes.vehicle1[0]?.lat ?? 34.43295176377536,
    targetLng: vehicleDemoRoutes.vehicle1[1]?.lng ?? vehicleDemoRoutes.vehicle1[0]?.lng ?? 135.56125363751843,
    speed: vehicleDemoRoutes.vehicle1[0]?.speed ?? 24,
    heading: vehicleDemoRoutes.vehicle1[0]?.heading ?? 0,
    receivedAt: new Date().toISOString(),
    animationStart: 0,
    animationDurationMs: 1,
  },
  {
    vehicleId: 'vehicle-2',
    vehicleName: 'Vehicle 2',
    color: '#22c55e',
    route: vehicleDemoRoutes.vehicle2,
    routeIndex: 0,
    direction: 1,
    currentLat: vehicleDemoRoutes.vehicle2[0]?.lat ?? 34.42482736799435,
    currentLng: vehicleDemoRoutes.vehicle2[0]?.lng ?? 135.55104659122847,
    sourceLat: vehicleDemoRoutes.vehicle2[0]?.lat ?? 34.42482736799435,
    sourceLng: vehicleDemoRoutes.vehicle2[0]?.lng ?? 135.55104659122847,
    targetLat: vehicleDemoRoutes.vehicle2[1]?.lat ?? vehicleDemoRoutes.vehicle2[0]?.lat ?? 34.42482736799435,
    targetLng: vehicleDemoRoutes.vehicle2[1]?.lng ?? vehicleDemoRoutes.vehicle2[0]?.lng ?? 135.55104659122847,
    speed: vehicleDemoRoutes.vehicle2[0]?.speed ?? 20,
    heading: vehicleDemoRoutes.vehicle2[0]?.heading ?? 0,
    receivedAt: new Date().toISOString(),
    animationStart: 0,
    animationDurationMs: 1,
  },
];

export function useDemoVehicleLocations(enabled = true) {
  const [vehicles, setVehicles] = useState<VehicleMapViewModel[]>([]);
  const targetsRef = useRef<Map<string, DemoAnimatedVehicle>>(new Map());

  useEffect(() => {
    if (!enabled) {
      setVehicles([]);
      targetsRef.current.clear();
      return;
    }

    let disposed = false;
    let frame = 0;
    let tickTimer = 0;

    targetsRef.current = new Map(
      DEMO_VEHICLES.map((vehicle) => [
        vehicle.vehicleId,
        {
          ...vehicle,
          receivedAt: new Date().toISOString(),
          animationStart: performance.now(),
        },
      ]),
    );

    const syncState = () => {
      const now = Date.now();
      const nextVehicles = Array.from(targetsRef.current.values()).map((entry) => {
        const duration = Math.max(entry.animationDurationMs, 1);
        const progress = Math.min(1, (performance.now() - entry.animationStart) / duration);
        const lat = entry.sourceLat + (entry.targetLat - entry.sourceLat) * progress;
        const lng = entry.sourceLng + (entry.targetLng - entry.sourceLng) * progress;
        const ageSeconds = Math.max(0, Math.floor((now - new Date(entry.receivedAt).getTime()) / 1000));

        entry.currentLat = lat;
        entry.currentLng = lng;

        return {
          vehicleId: entry.vehicleId,
          vehicleName: entry.vehicleName,
          lat,
          lng,
          speed: entry.speed,
          heading: entry.heading,
          receivedAt: entry.receivedAt,
          color: entry.color,
          ageSeconds,
          status: 'ONLINE' as const,
        };
      });

      nextVehicles.sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
      if (!disposed) {
        setVehicles(nextVehicles);
      }
    };

    const advanceRoute = () => {
      const nowIso = new Date().toISOString();
      const animationStart = performance.now();

      targetsRef.current.forEach((entry) => {
        const lastIndex = entry.route.length - 1;
        const atBoundary =
          (entry.direction === 1 && entry.routeIndex >= lastIndex) ||
          (entry.direction === -1 && entry.routeIndex <= 0);

        if (atBoundary) {
          entry.direction = entry.direction === 1 ? -1 : 1;
        }

        const nextIndex = Math.min(lastIndex, Math.max(0, entry.routeIndex + entry.direction));
        const nextPoint = entry.route[nextIndex] ?? entry.route[entry.routeIndex];

        entry.sourceLat = entry.currentLat;
        entry.sourceLng = entry.currentLng;
        entry.targetLat = nextPoint?.lat ?? entry.currentLat;
        entry.targetLng = nextPoint?.lng ?? entry.currentLng;
        entry.routeIndex = nextIndex;
        entry.speed = nextPoint?.speed ?? entry.speed;
        entry.heading = nextPoint?.heading ?? entry.heading;
        entry.receivedAt = nowIso;
        entry.animationStart = animationStart;
        entry.animationDurationMs = 1000;
      });

      syncState();
    };

    const animationLoop = () => {
      syncState();
      frame = window.requestAnimationFrame(animationLoop);
    };

    syncState();
    tickTimer = window.setInterval(advanceRoute, 1000);
    frame = window.requestAnimationFrame(animationLoop);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      window.clearInterval(tickTimer);
      targetsRef.current.clear();
    };
  }, [enabled]);

  return useMemo(
    () => ({
      vehicles,
      connected: enabled,
      demoMode: enabled,
      error: null as string | null,
    }),
    [enabled, vehicles],
  );
}
