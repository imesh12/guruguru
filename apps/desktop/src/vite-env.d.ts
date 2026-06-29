/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_MAPBOX_ACCESS_TOKEN?: string;
  readonly VITE_MAP_PROVIDER?: 'google' | 'mapbox';
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_WALL_DEBUG?: string;
  readonly VITE_WALL_PLAYBACK_PROVIDER?: string;
  readonly VITE_DEMO_GPS_LOOP?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  electronAPI: {
    openVideoWall: () => Promise<void>;
    openMap: () => Promise<void>;
    openSystemStatus: () => Promise<void>;
    openSettings?: () => Promise<void>;
    openCameraWindow: (cameraId: string, title?: string) => Promise<void>;

    listVehicles: () => Promise<unknown[]>;
    listCameras: () => Promise<unknown[]>;
    listCameraStatuses: () => Promise<unknown[]>;
    getActiveLayout: () => Promise<unknown>;
    getCameraPlaybackConfig: (cameraId: string) => Promise<unknown>;
    getApiSecurityConfig?: () => Promise<unknown>;

    stopSurface?: (surface: string) => Promise<void>;
    checkMpvAvailability?: () => Promise<unknown>;
    reportCameraStatus?: (...args: unknown[]) => Promise<void>;
  };
}
