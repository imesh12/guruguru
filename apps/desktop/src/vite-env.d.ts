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
