export type { PlaceMarker, PlaceMarkerIconId, PlaceMarkerInput } from '../shared/place-markers';

export type GpsQuality = 'GOOD' | 'FAIR' | 'POOR' | 'UNKNOWN';

export type VehicleGpsState = {
  vehicleId: string;
  vehicleName: string;
  lat: number;
  lng: number;
  locationStatus?: 'ONLINE' | 'STALE' | 'OFFLINE' | 'NO_FIX' | 'ERROR' | undefined;
  speed?: number | undefined;
  heading?: number | undefined;
  speedMps?: number | undefined;
  headingDegrees?: number | undefined;
  accuracyMeters?: number | undefined;
  gpsQuality?: GpsQuality | undefined;
  source?: string | undefined;
  receivedAt: string;
  investigation?: {
    localPollTime?: string | null;
    apiPollReceivedAt?: string | null;
    routerGnssTime?: string | null;
    routerSampleAgeMs?: number | null;
    coordinateChanged?: boolean | null;
    intervalSinceLastCoordinateChangeMs?: number | null;
    distanceFromPreviousMeters?: number | null;
    speedEstimateMps?: number | null;
    headingEstimateDeg?: number | null;
    suspiciousJump?: boolean | null;
    duplicateSample?: boolean | null;
    locationManagerReceivedAt?: string | null;
    locationManagerUpdatedAt?: string | null;
    locationManagerProcessingMs?: number | null;
    gpsStateIngestedAt?: string | null;
    backendProcessingMs?: number | null;
    websocketBroadcastAt?: string | null;
    websocketBroadcastLatencyMs?: number | null;
    latestApiResponseAt?: string | null;
    apiResponseGenerationMs?: number | null;
    frontendMessageReceivedAt?: string | null;
    frontendMessageReceivedPerfMs?: number | null;
    frontendMarkerUpdateAt?: string | null;
    frontendMarkerUpdatePerfMs?: number | null;
    frontendRenderCompleteAt?: string | null;
    frontendRenderCompletePerfMs?: number | null;
    frontendDisplayAt?: string | null;
    frontendDisplayPerfMs?: number | null;
    frontendSequence?: number | null;
  } | null;
};

export type VehicleMapStatus = 'ONLINE' | 'DELAYED' | 'OFFLINE';

export type VehicleMapViewModel = VehicleGpsState & {
  color: string;
  status: VehicleMapStatus;
  ageSeconds: number;
};

export type VehicleAdmin = {
  id: string;
  name: string;
  displayColor: string;
  enabled: boolean;
};

export type DailyRouteStop = {
  startAt: string;
  endAt: string;
  durationMinutes: number;
  latitude: number;
  longitude: number;
};

export type DailyRouteReport = {
  vehicleId: string;
  vehicleName: string;
  date: string;
  pointCount: number;
  firstReceivedAt: string | null;
  lastReceivedAt: string | null;
  operationMinutes: number;
  distanceKm: number;
  stopCount: number;
  longestStopMinutes: number;
  gpsGapMinutes: number;
  stops: DailyRouteStop[];
};

export type CameraAdmin = {
  id: string;
  vehicleId: string;
  vehicleName: string;
  name: string;
  type: 'FRONT' | 'INTERNAL';
  vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
  host: string | null;
  rtspPort: number | null;
  customRtspUrl: string | null;
  qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
  rtspUrl: string | null;
  username: string | null;
  hasSavedPassword: boolean;
  enabled: boolean;
  bitrateLimit: number | null;
};

export type LayoutSlotAdmin = {
  id: string;
  slotIndex: number;
  cameraId: string | null;
  cameraName: string | null;
  cameraType: 'FRONT' | 'INTERNAL' | null;
  vehicleName: string | null;
};

export type LayoutAdmin = {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
  slots: LayoutSlotAdmin[];
};

export type SystemStatusTone = 'ONLINE' | 'LIVE' | 'ACTIVE' | 'DELAYED' | 'RECONNECTING' | 'OFFLINE' | 'ERROR' | 'DISABLED' | 'PASSED' | 'FAILED';

export type SystemStatusSnapshot = {
  api: {
    status: 'ONLINE';
    uptimeSec: number;
  };
  gps: {
    vehicles: Array<{
      vehicleId: string;
      vehicleName: string;
      status: VehicleMapStatus;
      lastUpdateAt: string;
      ageSec: number;
    }>;
  };
  cameras: Array<{
    cameraId: string;
    cameraName: string;
    vehicleName: string;
    status: 'LIVE' | 'RECONNECTING' | 'OFFLINE';
    lastChangedAt: string;
  }>;
  receiver: {
    enabled: boolean;
    mode: 'udp' | 'tcp';
    port: number;
    status: 'ONLINE' | 'OFFLINE' | 'ERROR' | 'DISABLED';
  };
  database: {
    status: 'ONLINE' | 'ERROR';
    lastWriteAt: string | null;
    lastError: string | null;
  };
  watchdog: {
    api: {
      status: 'ONLINE' | 'DELAYED' | 'OFFLINE';
      lastSeenAt: string | null;
      ageSec: number | null;
      recoveryRecommendation: string | null;
    };
    desktop: {
      status: 'ONLINE' | 'DELAYED' | 'OFFLINE';
      lastSeenAt: string | null;
      ageSec: number | null;
      recoveryRecommendation: string | null;
    };
  };
  performance: {
    cpuUsagePct: number;
    memoryRssMb: number;
    memoryHeapMb: number;
    diskFreeMb: number | null;
    databaseSizeMb: number | null;
    gpuAvailable: boolean;
    gpuStatus: string;
    mpvProcessCount: number;
  };
  alerts: string[];
  maintenance: {
    gpsHistoryDays: number;
    lastCleanupAt: string | null;
  };
};

export type FieldTestItemStatus = 'PENDING' | 'PASSED' | 'FAILED';
export type FieldTestSessionStatus = 'RUNNING' | 'PASSED' | 'FAILED';

export type FieldTestItem = {
  id: string;
  category: string;
  label: string;
  status: FieldTestItemStatus;
  notes: string | null;
  checkedAt: string | null;
};

export type FieldTestSession = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  operatorName: string;
  notes: string | null;
  status: FieldTestSessionStatus;
  items: FieldTestItem[];
};
