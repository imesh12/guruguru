import { compareRouteHistoryPoints, type VehicleRouteHistoryPoint } from './types.js';

const MIN_MOVEMENT_METERS = 5;
const MAX_CONTIGUOUS_GAP_MINUTES = 5;
const STOP_RADIUS_METERS = 15;
const MIN_STOP_MINUTES = 3;
const STOP_MERGE_RADIUS_METERS = 30;
const STOP_MERGE_GAP_MINUTES = 15;
const SLOW_SPEED_KMH = 8;

export type RouteMotionClass = 'moving' | 'slow' | 'stopped' | 'gap';

export type DetectedStop = {
  startAt: string;
  endAt: string;
  durationMinutes: number;
  latitude: number;
  longitude: number;
  pointIds: string[];
};

export type ClassifiedRouteHistoryPoint = VehicleRouteHistoryPoint & {
  motionState: RouteMotionClass;
};

type IndexedPoint = VehicleRouteHistoryPoint & {
  sortTimeMs: number;
};

const toTimestampMs = (point: VehicleRouteHistoryPoint) => Date.parse(point.gnssTime ?? point.receivedAt);

const toDurationMinutes = (durationMs: number) => Math.max(0, Math.round(durationMs / 60000));

export const haversineMeters = (left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) => {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const latitudeDelta = toRadians(right.latitude - left.latitude);
  const longitudeDelta = toRadians(right.longitude - left.longitude);
  const leftLatitude = toRadians(left.latitude);
  const rightLatitude = toRadians(right.latitude);

  const a =
    Math.sin(latitudeDelta / 2) * Math.sin(latitudeDelta / 2) +
    Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) * Math.sin(longitudeDelta / 2);

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const computeCentroid = (points: IndexedPoint[]) => ({
  latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
  longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
});

const sortPoints = (points: VehicleRouteHistoryPoint[]) =>
  points
    .slice()
    .sort(compareRouteHistoryPoints)
    .map((point) => ({
      ...point,
      sortTimeMs: toTimestampMs(point),
    }));

export const detectStops = (points: VehicleRouteHistoryPoint[]) => {
  const sortedPoints = sortPoints(points);
  if (sortedPoints.length === 0) {
    return [];
  }

  const rawStops: DetectedStop[] = [];
  const firstPoint = sortedPoints[0];
  if (!firstPoint) {
    return [];
  }

  let cluster: IndexedPoint[] = [firstPoint];

  const flushCluster = () => {
    if (cluster.length === 0) {
      return;
    }

    const durationMs = cluster[cluster.length - 1]!.sortTimeMs - cluster[0]!.sortTimeMs;
    if (durationMs >= MIN_STOP_MINUTES * 60000) {
      const centroid = computeCentroid(cluster);
      rawStops.push({
        startAt: cluster[0]!.gnssTime ?? cluster[0]!.receivedAt,
        endAt: cluster[cluster.length - 1]!.gnssTime ?? cluster[cluster.length - 1]!.receivedAt,
        durationMinutes: toDurationMinutes(durationMs),
        latitude: centroid.latitude,
        longitude: centroid.longitude,
        pointIds: cluster.map((point) => point.id),
      });
    }

    cluster = [];
  };

  for (const point of sortedPoints.slice(1)) {
    const candidateCluster = [...cluster, point];
    const centroid = computeCentroid(candidateCluster);
    const staysWithinRadius = candidateCluster.every(
      (entry) => haversineMeters(entry, centroid) <= STOP_RADIUS_METERS,
    );

    if (staysWithinRadius) {
      cluster = candidateCluster;
      continue;
    }

    flushCluster();
    cluster = [point];
  }

  flushCluster();

  if (rawStops.length <= 1) {
    return rawStops;
  }

  const mergedStops: DetectedStop[] = [];
  for (const stop of rawStops) {
    const previous = mergedStops[mergedStops.length - 1];
    if (!previous) {
      mergedStops.push(stop);
      continue;
    }

    const gapMinutes = (Date.parse(stop.startAt) - Date.parse(previous.endAt)) / 60000;
    const centroidDistanceMeters = haversineMeters(previous, stop);
    if (gapMinutes <= STOP_MERGE_GAP_MINUTES && centroidDistanceMeters <= STOP_MERGE_RADIUS_METERS) {
      previous.endAt = stop.endAt;
      previous.durationMinutes = toDurationMinutes(Date.parse(previous.endAt) - Date.parse(previous.startAt));
      previous.latitude = (previous.latitude + stop.latitude) / 2;
      previous.longitude = (previous.longitude + stop.longitude) / 2;
      previous.pointIds = [...previous.pointIds, ...stop.pointIds];
      continue;
    }

    mergedStops.push(stop);
  }

  return mergedStops;
};

export const classifyRouteHistoryPoints = (points: VehicleRouteHistoryPoint[]) => {
  const sortedPoints = sortPoints(points);
  const stops = detectStops(sortedPoints);
  const stopPointIds = new Set(stops.flatMap((stop) => stop.pointIds));

  return sortedPoints.map((point, index): ClassifiedRouteHistoryPoint => {
    if (stopPointIds.has(point.id)) {
      return {
        ...point,
        motionState: 'stopped',
      };
    }

    if (index === 0) {
      return {
        ...point,
        motionState: 'moving',
      };
    }

    const previous = sortedPoints[index - 1]!;
    const deltaMinutes = (point.sortTimeMs - previous.sortTimeMs) / 60000;
    if (deltaMinutes > MAX_CONTIGUOUS_GAP_MINUTES) {
      return {
        ...point,
        motionState: 'gap',
      };
    }

    const distanceMeters = haversineMeters(previous, point);
    const speedKmh = deltaMinutes > 0 ? (distanceMeters / 1000) / (deltaMinutes / 60) : 0;

    return {
      ...point,
      motionState: distanceMeters < MIN_MOVEMENT_METERS || speedKmh < SLOW_SPEED_KMH ? 'slow' : 'moving',
    };
  });
};

export const summarizeRouteHistory = (points: VehicleRouteHistoryPoint[]) => {
  const sortedPoints = sortPoints(points);
  const classifiedPoints = classifyRouteHistoryPoints(sortedPoints);
  const stops = detectStops(sortedPoints);

  let distanceMeters = 0;
  let totalGapMinutes = 0;

  for (let index = 1; index < sortedPoints.length; index += 1) {
    const previous = sortedPoints[index - 1]!;
    const current = sortedPoints[index]!;
    const deltaMinutes = (current.sortTimeMs - previous.sortTimeMs) / 60000;

    if (deltaMinutes > MAX_CONTIGUOUS_GAP_MINUTES) {
      totalGapMinutes += deltaMinutes;
      continue;
    }

    const movementMeters = haversineMeters(previous, current);
    if (movementMeters >= MIN_MOVEMENT_METERS) {
      distanceMeters += movementMeters;
    }
  }

  const firstReceivedAt = sortedPoints[0]?.receivedAt ?? null;
  const lastReceivedAt = sortedPoints[sortedPoints.length - 1]?.receivedAt ?? null;
  const operationWindowMs =
    firstReceivedAt && lastReceivedAt ? Math.max(0, Date.parse(lastReceivedAt) - Date.parse(firstReceivedAt)) : 0;

  return {
    classifiedPoints,
    stops: stops.map(({ pointIds: _pointIds, ...stop }) => stop),
    pointCount: sortedPoints.length,
    firstReceivedAt,
    lastReceivedAt,
    operationMinutes: toDurationMinutes(Math.max(0, operationWindowMs - totalGapMinutes * 60000)),
    distanceKm: Number((distanceMeters / 1000).toFixed(2)),
    stopCount: stops.length,
    longestStopMinutes: stops.reduce((max, stop) => Math.max(max, stop.durationMinutes), 0),
    gpsGapMinutes: toDurationMinutes(totalGapMinutes * 60000),
  };
};
