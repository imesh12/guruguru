/**
 * Runtime status for location providers and normalized vehicle locations.
 */
export enum LocationStatus {
  ONLINE = 'ONLINE',
  STALE = 'STALE',
  OFFLINE = 'OFFLINE',
  NO_FIX = 'NO_FIX',
  ERROR = 'ERROR',
}

export type GpsQuality = 'GOOD' | 'FAIR' | 'POOR' | 'UNKNOWN';

export type LocationInvestigationTelemetry = {
  localPollTime?: string | null;
  apiPollReceivedAt?: string | null;
  routerGnssTime?: string | null;
  routerSampleAgeMs?: number | null;
  gnssStaleThresholdMs?: number | null;
  gnssStale?: boolean | null;
  communicationFresh?: boolean | null;
  positionFresh?: boolean | null;
  coordinateChanged?: boolean | null;
  intervalSinceLastCoordinateChangeMs?: number | null;
  distanceFromPreviousMeters?: number | null;
  speedEstimateMps?: number | null;
  headingEstimateDeg?: number | null;
  suspiciousJump?: boolean | null;
  duplicateSample?: boolean | null;
  requestDurationMs?: number | null;
  effectiveUpdateIntervalMs?: number | null;
  lastPollStartedAt?: string | null;
  lastPollCompletedAt?: string | null;
  locationManagerReceivedAt?: string | null;
  locationManagerUpdatedAt?: string | null;
  locationManagerProcessingMs?: number | null;
  gpsStateIngestedAt?: string | null;
  backendProcessingMs?: number | null;
  websocketBroadcastAt?: string | null;
  websocketBroadcastLatencyMs?: number | null;
  latestApiResponseAt?: string | null;
  apiResponseGenerationMs?: number | null;
};

/**
 * Latest normalized location for a vehicle.
 *
 * `routeId` is included from the start because vehicle separation is handled by
 * vehicle identity and route identity rather than by local router IP.
 */
export type VehicleLocation = {
  vehicleId: string;
  routeId: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters?: number | null;
  headingDegrees?: number | null;
  speedMps?: number | null;
  gpsQuality?: GpsQuality | null;
  gnssTime: string | null;
  receivedAt: string;
  source: string;
  status: LocationStatus;
  error: string | null;
  rawJson?: string | null;
  investigation?: LocationInvestigationTelemetry | null;
};

/**
 * Chronological route history point stored for later date-based route review.
 */
export type VehicleRouteHistoryPoint = {
  id: string;
  vehicleId: string;
  routeId: string | null;
  latitude: number;
  longitude: number;
  gnssTime: string | null;
  receivedAt: string;
  dateKey: string;
  weekKey: string;
  source: string;
  status: LocationStatus;
  rawJson: string | null;
};

/**
 * Minimal runtime status returned by a provider implementation.
 */
export type LocationProviderStatusSnapshot = {
  providerId: string;
  status: LocationStatus;
  lastUpdateAt: string | null;
  error: string | null;
};

/**
 * Internal callback used by the backend location foundation.
 */
export type LocationUpdateSubscriber = (location: VehicleLocation, snapshot: VehicleLocation[]) => void;

const JAPAN_TIME_ZONE = 'Asia/Tokyo';

const japaneseDatePartFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: JAPAN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const japaneseWeekdayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: JAPAN_TIME_ZONE,
  weekday: 'short',
});

const formatPart = (date: Date, type: 'year' | 'month' | 'day') => {
  const part = japaneseDatePartFormatter.formatToParts(date).find((entry) => entry.type === type)?.value;
  if (!part) {
    throw new Error(`Failed to format Japan date ${type}.`);
  }

  return part;
};

const formatDateKey = (date: Date) => `${formatPart(date, 'year')}-${formatPart(date, 'month')}-${formatPart(date, 'day')}`;

const getJapanWeekdayIndex = (date: Date) => {
  const weekday = japaneseWeekdayFormatter.format(date);
  const weekdayToIndex: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  const index = weekdayToIndex[weekday];
  if (!index) {
    throw new Error(`Unsupported weekday "${weekday}" while calculating Japan week key.`);
  }

  return index;
};

const addDaysToDateKey = (dateKey: string, days: number) => {
  const [yearRaw, monthRaw, dayRaw] = dateKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const next = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0));

  return formatDateKey(next);
};

/**
 * Returns `YYYY-MM-DD` in Japan time.
 */
export const toJapanDateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp "${String(value)}" while calculating Japan date key.`);
  }

  return formatDateKey(date);
};

/**
 * Returns the Monday date key for the containing Japan local week.
 */
export const toJapanWeekStartDateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp "${String(value)}" while calculating Japan week start.`);
  }

  const dateKey = toJapanDateKey(date);
  const weekdayIndex = getJapanWeekdayIndex(date);
  return addDaysToDateKey(dateKey, -(weekdayIndex - 1));
};

/**
 * Returns `YYYY-WW`, where `WW` is a Monday-start week number within the year.
 *
 * This is designed for operational retention rather than strict ISO week-year
 * semantics. The number is derived from the Monday date that starts the Japan
 * local week and remains stable for the retention behavior in this project.
 */
export const toJapanWeekKey = (value: string | Date) => {
  const weekStartDateKey = toJapanWeekStartDateKey(value);
  const [yearRaw, monthRaw, dayRaw] = weekStartDateKey.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  const firstDayOfYear = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
  const firstWeekStartDateKey = toJapanWeekStartDateKey(firstDayOfYear);
  const [firstYearRaw, firstMonthRaw, firstDayRaw] = firstWeekStartDateKey.split('-');
  const firstWeekStartUtc = Date.UTC(Number(firstYearRaw), Number(firstMonthRaw) - 1, Number(firstDayRaw), 0, 0, 0);
  const targetWeekStartUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  const elapsedDays = Math.floor((targetWeekStartUtc - firstWeekStartUtc) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.floor(elapsedDays / 7) + 1;

  return `${year}-${String(weekNumber).padStart(2, '0')}`;
};

/**
 * Sort helper for chronological route playback.
 *
 * Ordering is:
 * 1. GNSS time, when available
 * 2. Received time
 * 3. Vehicle id
 * 4. Point id
 */
export const compareRouteHistoryPoints = (left: VehicleRouteHistoryPoint, right: VehicleRouteHistoryPoint) => {
  const leftPrimary = Date.parse(left.gnssTime ?? left.receivedAt);
  const rightPrimary = Date.parse(right.gnssTime ?? right.receivedAt);
  if (leftPrimary !== rightPrimary) {
    return leftPrimary - rightPrimary;
  }

  const leftReceived = Date.parse(left.receivedAt);
  const rightReceived = Date.parse(right.receivedAt);
  if (leftReceived !== rightReceived) {
    return leftReceived - rightReceived;
  }

  const vehicleCompare = left.vehicleId.localeCompare(right.vehicleId);
  if (vehicleCompare !== 0) {
    return vehicleCompare;
  }

  return left.id.localeCompare(right.id);
};

/**
 * Returns true when the update has coordinates that are valid for route history.
 */
export const hasUsableCoordinates = (
  location: VehicleLocation,
): location is VehicleLocation & { latitude: number; longitude: number } =>
  typeof location.latitude === 'number' &&
  Number.isFinite(location.latitude) &&
  typeof location.longitude === 'number' &&
  Number.isFinite(location.longitude);
