import { contextBridge, ipcRenderer } from 'electron';

import { CAMERA_STATUS_CHANGED, PLACE_MARKERS_CHANGED } from './ipc.js';
import type { CameraLayoutSync, CameraSessionState, CameraSummary, CameraTestInput, CameraTestResult, MpvAvailability } from './camera-types.js';
import type { PlaceMarker, PlaceMarkerInput } from '../shared/place-markers.js';

const api = {
  openVideoWall: () => ipcRenderer.invoke('window:open-video-wall'),
  openMap: () => ipcRenderer.invoke('window:open-map'),
  openSystemStatus: () => ipcRenderer.invoke('window:open-system-status'),
  openCameraWindow: (cameraId: string, title?: string) => ipcRenderer.invoke('window:open-camera-window', { cameraId, title }),
  getCameraPlaybackConfig: (cameraId: string) => ipcRenderer.invoke('camera:get-playback-config', cameraId),
  getCameraRuntimePlaybackConfig: (cameraId: string) => ipcRenderer.invoke('camera:get-runtime-playback-config', cameraId),
  listVehicles: () => ipcRenderer.invoke('vehicle:list') as Promise<Array<{ id: string; name: string; displayColor: string; enabled: boolean }>>,
  listPlaceMarkers: () => ipcRenderer.invoke('place-marker:list') as Promise<PlaceMarker[]>,
  createPlaceMarker: (placeMarker: PlaceMarkerInput) => ipcRenderer.invoke('place-marker:create', placeMarker) as Promise<PlaceMarker>,
  updatePlaceMarker: (placeMarker: PlaceMarkerInput & { id: string }) => ipcRenderer.invoke('place-marker:update', placeMarker) as Promise<PlaceMarker>,
  deletePlaceMarker: (placeMarkerId: string) => ipcRenderer.invoke('place-marker:delete', placeMarkerId) as Promise<{ status: string }>,
  createVehicle: (vehicle: { name: string; displayColor: string; enabled: boolean }) =>
    ipcRenderer.invoke('vehicle:create', vehicle) as Promise<{ id: string; name: string; displayColor: string; enabled: boolean }>,
  updateVehicle: (vehicle: { id: string; name: string; displayColor: string; enabled: boolean }) =>
    ipcRenderer.invoke('vehicle:update', vehicle) as Promise<{ id: string; name: string; displayColor: string; enabled: boolean }>,
  deleteVehicle: (vehicleId: string) => ipcRenderer.invoke('vehicle:delete', vehicleId) as Promise<{ status: string }>,
  listCameras: () =>
    ipcRenderer.invoke('camera:list') as Promise<
      Array<{
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
      }>
    >,
  listLayouts: () =>
    ipcRenderer.invoke('layout:list') as Promise<
      Array<{
        id: string;
        name: string;
        active: boolean;
        updatedAt: string;
        slots: Array<{
          id: string;
          slotIndex: number;
          cameraId: string | null;
          cameraName: string | null;
          cameraType: 'FRONT' | 'INTERNAL' | null;
          vehicleName: string | null;
        }>;
      }>
    >,
  getActiveLayout: () =>
    ipcRenderer.invoke('layout:get-active') as Promise<{
      id: string;
      name: string;
      active: boolean;
      updatedAt: string;
      slots: Array<{
        id: string;
        slotIndex: number;
        cameraId: string | null;
        cameraName: string | null;
        cameraType: 'FRONT' | 'INTERNAL' | null;
        vehicleName: string | null;
      }>;
    } | null>,
  createLayout: (layout: { name: string; slots: Array<{ slotIndex: number; cameraId: string | null }> }) =>
    ipcRenderer.invoke('layout:create', layout),
  updateLayout: (layout: { id: string; name: string; slots: Array<{ slotIndex: number; cameraId: string | null }> }) =>
    ipcRenderer.invoke('layout:update', layout),
  deleteLayout: (layoutId: string) => ipcRenderer.invoke('layout:delete', layoutId) as Promise<{ status: string }>,
  activateLayout: (layoutId: string) => ipcRenderer.invoke('layout:activate', layoutId),
  createCamera: (camera: {
    vehicleId: string;
    name: string;
    type: 'FRONT' | 'INTERNAL';
    vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
    host: string | null;
    rtspPort: number | null;
    customRtspUrl: string | null;
    qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
    username: string | null;
    password: string | null;
    enabled: boolean;
    bitrateLimit: number | null;
  }) => ipcRenderer.invoke('camera:create', camera),
  updateCamera: (camera: {
    id: string;
    vehicleId: string;
    name: string;
    type: 'FRONT' | 'INTERNAL';
    vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
    host: string | null;
    rtspPort: number | null;
    customRtspUrl: string | null;
    qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
    username: string | null;
    password: string | null;
    enabled: boolean;
    bitrateLimit: number | null;
  }) => ipcRenderer.invoke('camera:update', camera),
  deleteCamera: (cameraId: string) => ipcRenderer.invoke('camera:delete', cameraId) as Promise<{ status: string }>,
  resolveRtsp: (payload: {
    vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
    host: string | null;
    rtspPort: number | null;
    customRtspUrl: string | null;
    qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
    username: string | null;
    password: string | null;
  }) =>
    ipcRenderer.invoke('camera:resolve-rtsp', payload) as Promise<{ rtspUrl: string | null; sanitizedRtspUrl: string | null; error: string | null; source: 'custom' | 'vendor' }>,
  listCameraStatuses: () => ipcRenderer.invoke('camera:status:list') as Promise<CameraSessionState[]>,
  getMpvAvailability: () => ipcRenderer.invoke('mpv:get-availability') as Promise<MpvAvailability>,
  restartCamera: (cameraId: string) => ipcRenderer.invoke('mpv:restart-camera', cameraId) as Promise<CameraSessionState[]>,
  stopCamera: (cameraId: string) => ipcRenderer.invoke('mpv:stop-camera', cameraId) as Promise<CameraSessionState[]>,
  testCamera: (camera: CameraTestInput) => ipcRenderer.invoke('mpv:test-camera', camera) as Promise<CameraTestResult>,
  getApiSecurityConfig: () => ipcRenderer.invoke('system:get-api-security-config') as Promise<{ apiToken: string | null }>,
  getRuntimeConfig: () => ipcRenderer.invoke('system:get-runtime-config') as Promise<{ demoMode: boolean; apiBaseUrl: string; embeddedPlaybackPoc: boolean }>,
  runRecoveryAction: (action: 'restart-api' | 'restart-desktop' | 'restart-mpv' | 'clear-stale-mpv' | 'reconnect-cameras' | 'export-diagnostics') =>
    ipcRenderer.invoke('system:run-recovery-action', action) as Promise<{ success: boolean; message: string }>,
  stopSession: (sessionId: string) => ipcRenderer.invoke('mpv:stop-session', sessionId) as Promise<CameraSessionState[]>,
  hideSession: (sessionId: string) => ipcRenderer.invoke('mpv:hide-session', sessionId) as Promise<CameraSessionState[]>,
  showSession: (sessionId: string) => ipcRenderer.invoke('mpv:show-session', sessionId) as Promise<CameraSessionState[]>,
  stopSurface: (surface: 'wall' | 'focus') => ipcRenderer.invoke('mpv:stop-surface', surface) as Promise<CameraSessionState[]>,
  reportCameraSessionState: (state: CameraSessionState) => ipcRenderer.invoke('camera:report-session-state', state) as Promise<CameraSessionState[]>,
  wallDebugLog: (message: string, details?: Record<string, unknown>) => {
    try {
      ipcRenderer.send('wall:debug-log', {
        message,
        details: details ?? {},
      });
    } catch (error) {
      console.error('[wall-debug] preload wallDebugLog failed', {
        message,
        details: details ?? {},
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
  updateMpvBounds: (payload: CameraLayoutSync) => {
    console.info('[wall-debug] preload updateMpvBounds invoke', {
      cameraId: payload.cameraId,
      surface: payload.surface,
      bounds: payload.bounds,
    });
    return ipcRenderer.invoke('mpv:sync-layout', payload) as Promise<CameraSessionState[]>;
  },
  syncCameraLayout: (payload: CameraLayoutSync) => ipcRenderer.invoke('mpv:sync-layout', payload) as Promise<CameraSessionState[]>,
  onCameraStatusChanged: (listener: (states: CameraSessionState[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, states: CameraSessionState[]) => listener(states);
    ipcRenderer.on(CAMERA_STATUS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(CAMERA_STATUS_CHANGED, handler);
    };
  },
  onPlaceMarkersChanged: (listener: (placeMarkers: PlaceMarker[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, placeMarkers: PlaceMarker[]) => listener(placeMarkers);
    ipcRenderer.on(PLACE_MARKERS_CHANGED, handler);
    return () => {
      ipcRenderer.removeListener(PLACE_MARKERS_CHANGED, handler);
    };
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);

export type ElectronApi = typeof api;
