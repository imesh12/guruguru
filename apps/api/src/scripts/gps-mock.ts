import process from 'node:process';

type RoutePoint = {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
};

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';

const routes: Record<string, RoutePoint[]> = {
  'vehicle-1': [
    { lat: 35.6804, lng: 139.769, speed: 12, heading: 45 },
    { lat: 35.6809, lng: 139.7696, speed: 14, heading: 60 },
    { lat: 35.6815, lng: 139.7701, speed: 15, heading: 75 },
    { lat: 35.682, lng: 139.7708, speed: 13, heading: 90 },
    { lat: 35.6815, lng: 139.7715, speed: 11, heading: 120 },
    { lat: 35.6808, lng: 139.7713, speed: 10, heading: 180 },
  ],
  'vehicle-2': [
    { lat: 35.6816, lng: 139.7712, speed: 10, heading: 225 },
    { lat: 35.6811, lng: 139.772, speed: 12, heading: 240 },
    { lat: 35.6806, lng: 139.7724, speed: 14, heading: 260 },
    { lat: 35.6799, lng: 139.7721, speed: 11, heading: 295 },
    { lat: 35.6797, lng: 139.7712, speed: 9, heading: 330 },
    { lat: 35.6804, lng: 139.7707, speed: 10, heading: 10 },
  ],
};

const vehicleNames: Record<string, string> = {
  'vehicle-1': 'Vehicle 1',
  'vehicle-2': 'Vehicle 2',
};

const indexes = new Map<string, number>();

for (const vehicleId of Object.keys(routes)) {
  indexes.set(vehicleId, 0);
}

const sendUpdate = async (vehicleId: string) => {
  const route = routes[vehicleId];
  const nextIndex = indexes.get(vehicleId) ?? 0;
  const point = route?.[nextIndex];
  if (!route || !point) {
    return;
  }

  indexes.set(vehicleId, (nextIndex + 1) % route.length);

  await fetch(`${API_BASE_URL}/gps/mock`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      vehicleId,
      vehicleName: vehicleNames[vehicleId],
      lat: point.lat,
      lng: point.lng,
      speed: point.speed,
      heading: point.heading,
      receivedAt: new Date().toISOString(),
    }),
  });
};

const tick = async () => {
  await Promise.all(Object.keys(routes).map((vehicleId) => sendUpdate(vehicleId)));
};

const interval = setInterval(() => {
  void tick().catch((error: unknown) => {
    console.error(error);
  });
}, 1000);

void tick();

process.on('SIGINT', () => {
  clearInterval(interval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  clearInterval(interval);
  process.exit(0);
});
