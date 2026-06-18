export const PLACE_MARKER_ICON_IDS = [
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

export type PlaceMarker = {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
  markerIconId: PlaceMarkerIconId;
  description?: string | undefined;
  createdAt: string;
  updatedAt: string;
};

export type PlaceMarkerInput = {
  title: string;
  latitude: number;
  longitude: number;
  markerIconId: PlaceMarkerIconId;
  description?: string | undefined;
};

export type PlaceMarkerDefinition = {
  id: PlaceMarkerIconId;
  label: string;
  symbol: string;
  color: string;
  backgroundColor: string;
  borderColor: string;
};

export const PLACE_MARKER_DEFINITIONS: PlaceMarkerDefinition[] = [
  { id: 'red-pin', label: '赤ピン', symbol: 'R', color: '#ffffff', backgroundColor: '#dc2626', borderColor: '#991b1b' },
  { id: 'blue-pin', label: '青ピン', symbol: 'B', color: '#ffffff', backgroundColor: '#2563eb', borderColor: '#1d4ed8' },
  { id: 'green-pin', label: '緑ピン', symbol: 'G', color: '#ffffff', backgroundColor: '#16a34a', borderColor: '#15803d' },
  { id: 'yellow-pin', label: '黄ピン', symbol: 'Y', color: '#713f12', backgroundColor: '#fde047', borderColor: '#eab308' },
  { id: 'warning', label: '注意', symbol: '!', color: '#ffffff', backgroundColor: '#f97316', borderColor: '#c2410c' },
  { id: 'camera', label: 'カメラ', symbol: 'CAM', color: '#ffffff', backgroundColor: '#0f766e', borderColor: '#115e59' },
  { id: 'facility', label: '施設', symbol: 'FAC', color: '#ffffff', backgroundColor: '#7c3aed', borderColor: '#6d28d9' },
  { id: 'parking', label: '駐車場', symbol: 'P', color: '#ffffff', backgroundColor: '#0891b2', borderColor: '#0e7490' },
  { id: 'office', label: '事務所', symbol: 'OFF', color: '#ffffff', backgroundColor: '#475569', borderColor: '#334155' },
  { id: 'work-area', label: '作業場', symbol: 'WK', color: '#ffffff', backgroundColor: '#be123c', borderColor: '#9f1239' },
];

export const DEFAULT_PLACE_MARKER_ICON_ID: PlaceMarkerIconId = 'red-pin';

export const isPlaceMarkerIconId = (value: string): value is PlaceMarkerIconId =>
  PLACE_MARKER_ICON_IDS.includes(value as PlaceMarkerIconId);

export const getPlaceMarkerDefinition = (markerIconId: PlaceMarkerIconId): PlaceMarkerDefinition => {
  const definition = PLACE_MARKER_DEFINITIONS.find((item) => item.id === markerIconId);
  if (definition) {
    return definition;
  }

  return PLACE_MARKER_DEFINITIONS[0]!;
};
