import type {
  CameraLayoutSync,
  CameraPlaybackConfig,
  CameraSessionState,
  CameraTestInput,
  CameraTestResult,
  MpvAvailability,
  RelativeBounds,
} from '../electron/camera-types';
import type { CameraAdmin, LayoutAdmin, VehicleAdmin } from './types';
import type { PlaceMarker, PlaceMarkerInput } from '../shared/place-markers';

type CameraType = 'FRONT' | 'INTERNAL';
type CameraVendor = 'AXIS' | 'HIKVISION' | 'CUSTOM';
type CameraQualityPreset = 'LOW' | 'STANDARD' | 'HIGH';
type CameraSurface = 'wall' | 'focus';

type VehicleInput = {
  name: string;
  displayColor: string;
  enabled: boolean;
};

type CameraInput = {
  vehicleId: string;
  name: string;
  type: CameraType;
  vendor: CameraVendor;
  host: string | null;
  rtspPort: number | null;
  customRtspUrl: string | null;
  qualityPreset: CameraQualityPreset;
  username: string | null;
  password: string | null;
  enabled: boolean;
  bitrateLimit: number | null;
};

type LayoutInput = {
  name: string;
  slots: Array<{
    slotIndex: number;
    cameraId: string | null;
  }>;
};

type ResolveRtspInput = {
  vendor: CameraVendor;
  host: string | null;
  rtspPort: number | null;
  customRtspUrl: string | null;
  qualityPreset: CameraQualityPreset;
  username: string | null;
  password: string | null;
};

type ResolveRtspResult = {
  rtspUrl: string | null;
  sanitizedRtspUrl: string | null;
  error: string | null;
  source: 'custom' | 'vendor';
};

type RuntimeConfig = {
  demoMode: boolean;
  apiBaseUrl: string;
  embeddedPlaybackPoc: boolean;
};

type RecoveryAction =
  | 'restart-api'
  | 'restart-desktop'
  | 'restart-mpv'
  | 'clear-stale-mpv'
  | 'reconnect-cameras'
  | 'export-diagnostics';

type LegacyMpvBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
  fullscreen?: boolean;
};

type WallBoundsSync = Array<
  {
    slotId: string;
  } & LegacyMpvBounds
>;

export type ElectronAPI = {
  openVideoWall: () => Promise<void>;
  openMap: () => Promise<void>;
  openSystemStatus: () => Promise<void>;
  openCameraWindow: (cameraId: string, title?: string) => Promise<void>;

  getCameraPlaybackConfig: (cameraId: string) => Promise<CameraPlaybackConfig>;
  getCameraRuntimePlaybackConfig: (cameraId: string) => Promise<CameraPlaybackConfig>;

  listVehicles: () => Promise<VehicleAdmin[]>;
  listPlaceMarkers: () => Promise<PlaceMarker[]>;
  createPlaceMarker: (placeMarker: PlaceMarkerInput) => Promise<PlaceMarker>;
  updatePlaceMarker: (placeMarker: PlaceMarkerInput & { id: string }) => Promise<PlaceMarker>;
  deletePlaceMarker: (placeMarkerId: string) => Promise<{ status: string }>;
  createVehicle: (vehicle: VehicleInput) => Promise<VehicleAdmin>;
  updateVehicle: (vehicle: VehicleInput & { id: string }) => Promise<VehicleAdmin>;
  deleteVehicle: (vehicleId: string) => Promise<{ status: string }>;

  listCameras: () => Promise<CameraAdmin[]>;
  createCamera: (camera: CameraInput) => Promise<CameraAdmin>;
  updateCamera: (camera: CameraInput & { id: string }) => Promise<CameraAdmin>;
  deleteCamera: (cameraId: string) => Promise<{ status: string }>;

  listLayouts: () => Promise<LayoutAdmin[]>;
  getActiveLayout: () => Promise<LayoutAdmin | null>;
  createLayout: (layout: LayoutInput) => Promise<LayoutAdmin>;
  updateLayout: (layout: LayoutInput & { id: string }) => Promise<LayoutAdmin>;
  deleteLayout: (layoutId: string) => Promise<{ status: string }>;
  activateLayout: (layoutId: string) => Promise<LayoutAdmin>;

  resolveRtsp: (payload: ResolveRtspInput) => Promise<ResolveRtspResult>;

  listCameraStatuses: () => Promise<CameraSessionState[]>;
  getMpvAvailability: () => Promise<MpvAvailability>;

  restartCamera: (cameraId: string) => Promise<CameraSessionState[]>;
  stopCamera: (cameraId: string) => Promise<CameraSessionState[]>;
  testCamera: (camera: CameraTestInput) => Promise<CameraTestResult>;

  getApiSecurityConfig: () => Promise<{ apiToken: string | null }>;
  getRuntimeConfig: () => Promise<RuntimeConfig>;

  runRecoveryAction: (
    action: RecoveryAction,
  ) => Promise<{
    success: boolean;
    message: string;
  }>;

  stopSession: (sessionId: string) => Promise<CameraSessionState[]>;
  hideSession: (sessionId: string) => Promise<CameraSessionState[]>;
  showSession: (sessionId: string) => Promise<CameraSessionState[]>;
  stopSurface: (surface: CameraSurface) => Promise<CameraSessionState[]>;
  reportCameraSessionState: (state: CameraSessionState) => Promise<CameraSessionState[]>;
  wallDebugLog: (message: string, details?: Record<string, unknown>) => void;

  updateMpvBounds: {
    (payload: CameraLayoutSync): Promise<CameraSessionState[]>;
    (slotId: string, bounds: RelativeBounds | LegacyMpvBounds): Promise<void> | void;
  };

  syncWallMpvBounds?: (bounds: WallBoundsSync) => Promise<void> | void;
  syncCameraLayout: (payload: CameraLayoutSync) => Promise<CameraSessionState[]>;

  onCameraStatusChanged: (listener: (states: CameraSessionState[]) => void) => () => void;
  onPlaceMarkersChanged: (listener: (placeMarkers: PlaceMarker[]) => void) => () => void;
};

declare global {
  interface ImportMetaEnv {
    readonly VITE_API_BASE_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
