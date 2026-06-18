export type DemoRoutePoint = {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
};

type LatLngPoint = {
  lat: number;
  lng: number;
};

const TARGET_POINT_COUNT = 72;

const vehicle1ControlPoints: LatLngPoint[] = [
  // Approximate road-following presentation data around Kawachinagano.
  // These points are manually shaped to follow visible streets, not real navigation output.
  { lat: 34.43295176377536, lng: 135.56125363751843 },
  { lat: 34.43273000000000, lng: 135.56093000000000 },
  { lat: 34.43241000000000, lng: 135.56052000000000 },
  { lat: 34.43205000000000, lng: 135.56006000000000 },
  { lat: 34.43162000000000, lng: 135.55962000000000 },
  { lat: 34.43117000000000, lng: 135.55921000000000 },
  { lat: 34.43076000000000, lng: 135.55876000000000 },
  { lat: 34.43030000000000, lng: 135.55826000000000 },
  { lat: 34.42994000000000, lng: 135.55782000000000 },
  { lat: 34.42952000000000, lng: 135.55731000000000 },
  { lat: 34.42917000000000, lng: 135.55676000000000 },
  { lat: 34.42886400818014, lng: 135.55606632895783 },
];

const vehicle2ControlPoints: LatLngPoint[] = [
  // Approximate road-following presentation data around Kawachinagano.
  // These points are manually shaped to follow visible streets, not real navigation output.
  { lat: 34.42482736799435, lng: 135.55104659122847 },
  { lat: 34.42515000000000, lng: 135.55133000000000 },
  { lat: 34.42552000000000, lng: 135.55170000000000 },
  { lat: 34.42593000000000, lng: 135.55208000000000 },
  { lat: 34.42631000000000, lng: 135.55247000000000 },
  { lat: 34.42667000000000, lng: 135.55291000000000 },
  { lat: 34.42704000000000, lng: 135.55335000000000 },
  { lat: 34.42741000000000, lng: 135.55385000000000 },
  { lat: 34.42776000000000, lng: 135.55436000000000 },
  { lat: 34.42812000000000, lng: 135.55492000000000 },
  { lat: 34.42848000000000, lng: 135.55548000000000 },
  { lat: 34.42886400818014, lng: 135.55606632895783 },
];

function distanceBetween(a: LatLngPoint, b: LatLngPoint) {
  return Math.hypot(b.lat - a.lat, b.lng - a.lng);
}

function headingBetween(a: LatLngPoint, b: LatLngPoint) {
  const heading = (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180) / Math.PI;
  return Number.isFinite(heading) ? (heading + 360) % 360 : 0;
}

function pointAlongSegment(a: LatLngPoint, b: LatLngPoint, progress: number): LatLngPoint {
  return {
    lat: a.lat + (b.lat - a.lat) * progress,
    lng: a.lng + (b.lng - a.lng) * progress,
  };
}

function densifyRoute(controlPoints: LatLngPoint[], targetPointCount: number): DemoRoutePoint[] {
  if (controlPoints.length < 2) {
    return controlPoints.map((point) => ({
      ...point,
      speed: 18,
      heading: 0,
    }));
  }

  const segments = controlPoints.slice(0, -1).map((point, index) => {
    const next = controlPoints[index + 1] ?? point;
    return {
      start: point,
      end: next,
      length: distanceBetween(point, next),
    };
  });

  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0) || 1;

  const fallbackSegment = segments[segments.length - 1] ?? segments[0];
  if (!fallbackSegment) {
    return controlPoints.map((point) => ({
      ...point,
      speed: 18,
      heading: 0,
    }));
  }

  return Array.from({ length: targetPointCount }, (_, index) => {
    const routeProgress = targetPointCount === 1 ? 0 : index / (targetPointCount - 1);
    const targetDistance = totalLength * routeProgress;

    let coveredDistance = 0;
    let chosenSegment = fallbackSegment;
    let localProgress = 1;

    for (const segment of segments) {
      const nextCoveredDistance = coveredDistance + segment.length;
      if (targetDistance <= nextCoveredDistance) {
        chosenSegment = segment;
        const segmentLength = segment.length || 1;
        localProgress = (targetDistance - coveredDistance) / segmentLength;
        break;
      }
      coveredDistance = nextCoveredDistance;
    }

    const point = pointAlongSegment(chosenSegment.start, chosenSegment.end, localProgress);
    const heading = headingBetween(chosenSegment.start, chosenSegment.end);
    const speed = 16 + Math.round(Math.sin(routeProgress * Math.PI * 3) * 3) + (routeProgress > 0.35 && routeProgress < 0.75 ? 4 : 0);

    return {
      lat: point.lat,
      lng: point.lng,
      speed,
      heading,
    };
  });
}

export const vehicleDemoRoutes = {
  vehicle1: densifyRoute(vehicle1ControlPoints, TARGET_POINT_COUNT),
  vehicle2: densifyRoute(vehicle2ControlPoints, TARGET_POINT_COUNT),
};
