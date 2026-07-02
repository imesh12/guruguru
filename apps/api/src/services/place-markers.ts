import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { resolveAppDataDir } from './runtime-config.js';

const PLACE_MARKER_ICON_IDS = [
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
] as const;

export type PlaceMarkerIconId = (typeof PLACE_MARKER_ICON_IDS)[number];

export type PlaceMarkerRecord = {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
  markerIconId: PlaceMarkerIconId;
  description?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

const sharedPlaceMarkersFilePath = path.join(resolveAppDataDir(), 'place-markers.json');
const legacyElectronPlaceMarkersFilePath = path.join(resolveAppDataDir(), 'electron-user-data', 'place-markers.json');

const isPlaceMarkerIconId = (value: string): value is PlaceMarkerIconId =>
  PLACE_MARKER_ICON_IDS.includes(value as PlaceMarkerIconId);

const isValidPlaceMarker = (value: unknown): value is PlaceMarkerRecord => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.latitude === 'number' &&
    Number.isFinite(candidate.latitude) &&
    candidate.latitude >= -90 &&
    candidate.latitude <= 90 &&
    typeof candidate.longitude === 'number' &&
    Number.isFinite(candidate.longitude) &&
    candidate.longitude >= -180 &&
    candidate.longitude <= 180 &&
    typeof candidate.markerIconId === 'string' &&
    isPlaceMarkerIconId(candidate.markerIconId) &&
    (typeof candidate.description === 'string' || typeof candidate.description === 'undefined') &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
};

const readPlaceMarkersFile = (filePath: string) => {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [] as PlaceMarkerRecord[];
    }

    return parsed.filter(isValidPlaceMarker).sort((left, right) => left.title.localeCompare(right.title, 'ja'));
  } catch {
    return [] as PlaceMarkerRecord[];
  }
};

export const listPlaceMarkers = () => {
  return readPlaceMarkersFile(sharedPlaceMarkersFilePath) ?? readPlaceMarkersFile(legacyElectronPlaceMarkersFilePath) ?? [];
};

export const savePlaceMarkers = (placeMarkers: PlaceMarkerRecord[]) => {
  mkdirSync(path.dirname(sharedPlaceMarkersFilePath), { recursive: true });
  writeFileSync(sharedPlaceMarkersFilePath, `${JSON.stringify(placeMarkers, null, 2)}\n`, 'utf8');
};

export const getPlaceMarkersStoragePaths = () => ({
  sharedPlaceMarkersFilePath,
  legacyElectronPlaceMarkersFilePath,
});
