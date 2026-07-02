import { useEffect, useMemo, useRef, useState } from 'react';
import type mapboxgl from 'mapbox-gl';

import { getPlaceMarkerIcon } from '../lib/place-marker-icons';
import type { PlaceMarker, VehicleMapViewModel } from '../types';
import followIcon from '../../resources/follow.png';

type MapPanelProps = {
  vehicles: VehicleMapViewModel[];
  placeMarkers: PlaceMarker[];
  demoMode?: boolean | undefined;
};

type GoogleMapMarkerState = {
  overlay: google.maps.OverlayView;
  element: HTMLDivElement;
  position: google.maps.LatLngLiteral;
  cleanupClick: (() => void) | null;
};

type GooglePlaceMarkerState = {
  overlay: google.maps.OverlayView;
  element: HTMLButtonElement;
  position: google.maps.LatLngLiteral;
  placeMarkerId: string;
  popupContent: string;
  title: string;
};

type PerspectiveMode = 'normal' | '3d';

type CenterVehicleOptions = {
  force?: boolean | undefined;
  preserveHeading?: boolean | undefined;
  preserveBearing?: boolean | undefined;
};

type CenterComparison = {
  centerLat: number;
  centerLng: number;
  deltaLat: number;
  deltaLng: number;
};

const DEFAULT_MAP_CENTER: [number, number] = [135.55603190299396, 34.428826764162736];
const GOOGLE_MAP_ID = 'kurukuru-google-map-script';
const MAPBOX_NORMAL_STYLE = 'mapbox://styles/mapbox/streets-v12';
const MAPBOX_3D_STYLE = 'mapbox://styles/mapbox/satellite-streets-v12';
const CAMERA_MUTING_MS = 900;
const MARKER_SELECTION_MUTING_MS = 180;
const MAP_MIN_ZOOM = 8;
const MAP_MAX_ZOOM = 19;
const JAPAN_BOUNDS_SW: [number, number] = [122.0, 24.0];
const JAPAN_BOUNDS_NE: [number, number] = [154.0, 46.5];

const statusClasses: Record<VehicleMapViewModel['status'], string> = {
  ONLINE: 'text-emerald-700',
  DELAYED: 'text-amber-700',
  OFFLINE: 'text-rose-700',
};

const INITIAL_MULTI_VEHICLE_PADDING_PX = 72;
const INITIAL_VIEWPORT_FALLBACK_DELAY_MS = 1800;


function getMapProvider() {
  return String(import.meta.env.VITE_MAP_PROVIDER ?? 'mapbox')
    .trim()
    .toLowerCase();
}

function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (window.google?.maps) {
    return Promise.resolve(window.google);
  }

  return new Promise((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_MAP_ID) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.google));
      existingScript.addEventListener('error', () => reject(new Error('Google Maps script failed to load')));
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_MAP_ID;
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error('Google Maps script failed to load'));

    document.head.appendChild(script);
  });
}

function createGoogleVehicleOverlay(
  googleApi: typeof google,
  map: google.maps.Map,
  vehicle: VehicleMapViewModel,
  onClick: (vehicleId: string) => void,
): GoogleMapMarkerState {
  const element = document.createElement('div');
  element.className = 'vehicle-marker-card';
  element.style.position = 'absolute';
  element.style.transform = 'translate(0, -100%)';
  element.style.cursor = 'pointer';

  const overlay = new googleApi.maps.OverlayView();
  const handleClick = () => {
    onClick(vehicle.vehicleId);
  };

  const state: GoogleMapMarkerState = {
    overlay,
    element,
    position: { lat: vehicle.lat, lng: vehicle.lng },
    cleanupClick: null,
  };

  overlay.onAdd = () => {
    const panes = overlay.getPanes();
    panes?.overlayMouseTarget.appendChild(element);
    element.addEventListener('click', handleClick);
    state.cleanupClick = () => {
      element.removeEventListener('click', handleClick);
      state.cleanupClick = null;
    };
  };

  overlay.draw = () => {
    const projection = overlay.getProjection();

    if (!projection) {
      return;
    }

    const point = projection.fromLatLngToDivPixel(
      new googleApi.maps.LatLng(state.position.lat, state.position.lng),
    );

    if (!point) {
      return;
    }

    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
  };

  overlay.onRemove = () => {
    state.cleanupClick?.();
    element.remove();
  };

  overlay.setMap(map);

  return state;
}



function buildVehicleMeta(vehicle: VehicleMapViewModel) {
  return vehicle.status;
  /*

  const parts = [`${vehicle.status} | ${vehicle.ageSeconds}s ago`];

  if (typeof vehicle.accuracyMeters === 'number' && Number.isFinite(vehicle.accuracyMeters)) {
    parts.push(`±${Math.round(vehicle.accuracyMeters)}m`);
  }

  const resolvedLocationStatus =
    typeof vehicle.locationStatus === 'string' && vehicle.locationStatus.trim().length > 0
      ? vehicle.locationStatus
      : typeof vehicle.gpsQuality === 'string' && vehicle.gpsQuality.trim().length > 0
        ? vehicle.gpsQuality
        : 'UNKNOWN';

  parts.push(resolvedLocationStatus);

  if (import.meta.env.DEV) {
    console.debug('[vehicle-status-debug]', {
      vehicleId: vehicle.vehicleId,
      status: vehicle.status,
      locationStatus: vehicle.locationStatus ?? null,
      rawVehicle: vehicle,
    });
  }

  return parts.join(' | ');
  */
}

function setGoogleVehicleMarkerContent(marker: GoogleMapMarkerState, vehicle: VehicleMapViewModel) {
  marker.position = { lat: vehicle.lat, lng: vehicle.lng };

  marker.element.innerHTML = `
    <div class="vehicle-marker-card__dot" style="background:${vehicle.color}"></div>
    <div class="vehicle-marker-card__label">
      <div class="vehicle-marker-card__title">${vehicle.vehicleName}</div>
      <div class="vehicle-marker-card__meta ${vehicle.status.toLowerCase()}">${buildVehicleMeta(vehicle)}</div>
    </div>
  `;

  marker.overlay.draw();
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildPlaceMarkerBadge(placeMarker: PlaceMarker) {
  const icon = getPlaceMarkerIcon(placeMarker.markerIconId);
  return `
    <div class="place-map-marker" style="width:72px;display:flex;flex-direction:column;align-items:center;pointer-events:auto;overflow:visible;">
      <div class="pin" style="background-color:#2563eb;width:42px;height:42px;border-radius:50% 50% 50% 0;padding:4px;transform:rotate(-45deg);box-shadow:0 2px 5px rgba(0,0,0,.16);box-sizing:border-box;">
        <div class="pin-circle" style="background-color:#fdfdfd;border-radius:50%;width:34px;height:34px;padding:3px;transform:rotate(45deg);overflow:hidden;box-sizing:border-box;">
          <img class="pin-image" src="${icon.src}" alt="${escapeHtml(icon.label)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;display:block;" />
        </div>
      </div>
      <div class="title" style="width:72px;margin-top:5px;padding:3px 6px;background:#fff;border-radius:14px;text-align:center;font-size:10px;font-weight:700;color:#444;box-shadow:0 2px 6px rgba(0,0,0,.14);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
        ${escapeHtml(placeMarker.title)}
      </div>
    </div>
  `;
}

function buildPlaceMarkerPopupContent(placeMarker: PlaceMarker) {
  return `
    <div style="min-width:220px;padding:4px 2px;color:#0f172a;">
      <div style="font-size:16px;font-weight:700;">${escapeHtml(placeMarker.title)}</div>
      <div style="margin-top:8px;font-size:12px;color:#475569;">緯度</div>
      <div style="font-size:14px;">${placeMarker.latitude.toFixed(6)}</div>
      <div style="margin-top:8px;font-size:12px;color:#475569;">経度</div>
      <div style="font-size:14px;">${placeMarker.longitude.toFixed(6)}</div>
      ${placeMarker.description ? `<div style="margin-top:8px;font-size:12px;color:#475569;">メモ</div><div style="font-size:14px;line-height:1.5;">${escapeHtml(placeMarker.description)}</div>` : ''}
    </div>
  `;
}

function createGooglePlaceMarkerOverlay(
  googleApi: typeof google,
  map: google.maps.Map,
  infoWindow: google.maps.InfoWindow,
  placeMarker: PlaceMarker,
): GooglePlaceMarkerState {
  const element = document.createElement('button');
  element.type = 'button';
  element.style.position = 'absolute';
  element.style.transform = 'translate(-50%, -100%)';
  element.style.background = 'transparent';
  element.style.border = '0';
  element.style.padding = '0';
  element.style.cursor = 'pointer';
  element.title = placeMarker.title;

  const overlay = new googleApi.maps.OverlayView();

  const state: GooglePlaceMarkerState = {
    overlay,
    element,
    position: { lat: placeMarker.latitude, lng: placeMarker.longitude },
    placeMarkerId: placeMarker.id,
    popupContent: buildPlaceMarkerPopupContent(placeMarker),
    title: placeMarker.title,
  };

  overlay.onAdd = () => {
    const panes = overlay.getPanes();
    panes?.overlayMouseTarget.appendChild(element);
  };

  overlay.draw = () => {
    const projection = overlay.getProjection();

    if (!projection) {
      return;
    }

    const point = projection.fromLatLngToDivPixel(
      new googleApi.maps.LatLng(state.position.lat, state.position.lng),
    );

    if (!point) {
      return;
    }

    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
  };

  overlay.onRemove = () => {
    element.remove();
  };

  element.addEventListener('click', () => {
    infoWindow.setContent(state.popupContent);
    infoWindow.setPosition(state.position);
    infoWindow.open({ map });
  });

  overlay.setMap(map);

  return state;
}

function setGooglePlaceMarkerContent(marker: GooglePlaceMarkerState, placeMarker: PlaceMarker) {
  marker.position = { lat: placeMarker.latitude, lng: placeMarker.longitude };
  marker.popupContent = buildPlaceMarkerPopupContent(placeMarker);
  marker.title = placeMarker.title;
  marker.element.innerHTML = buildPlaceMarkerBadge(placeMarker);
  marker.element.title = marker.title;
  marker.overlay.draw();
}

function normalizeHeading(value: number) {
  return ((value % 360) + 360) % 360;
}

function getCenterComparison(
  currentCenter: { lat: number; lng: number },
  targetCenter: { lat: number; lng: number },
): CenterComparison {
  return {
    centerLat: currentCenter.lat,
    centerLng: currentCenter.lng,
    deltaLat: Math.abs(currentCenter.lat - targetCenter.lat),
    deltaLng: Math.abs(currentCenter.lng - targetCenter.lng),
  };
}

export function MapPanel({ vehicles, placeMarkers, demoMode = false }: MapPanelProps) {
  const [perspectiveMode, setPerspectiveMode] = useState<PerspectiveMode>('normal');
  const [cameraAngleDeg, setCameraAngleDeg] = useState(0);
  const [followVehicleEnabled, setFollowVehicleEnabled] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const vehiclesRef = useRef(vehicles);
  const followVehicleEnabledRef = useRef(followVehicleEnabled);
  const selectedVehicleIdRef = useRef<string | null>(selectedVehicleId);
  const lastFollowSignatureRef = useRef<string | null>(null);

  const mapboxMapRef = useRef<mapboxgl.Map | null>(null);
  const mapboxMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const mapboxPlaceMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const mapboxStyleModeRef = useRef<PerspectiveMode>('normal');

  const googleMapRef = useRef<google.maps.Map | null>(null);
  const googleMarkersRef = useRef<Map<string, GoogleMapMarkerState>>(new Map());
  const googlePlaceMarkersRef = useRef<Map<string, GooglePlaceMarkerState>>(new Map());
  const googlePlaceInfoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  const userHasInteractedRef = useRef(false);
  const hasAutoCenteredRef = useRef(false);
  const lastLoggedSequenceRef = useRef<Map<string, number>>(new Map());
  const suppressUserInteractionRef = useRef(false);
  const interactionMuteTimerRef = useRef<number | null>(null);
  const markerSelectionMuteTimerRef = useRef<number | null>(null);
  const suppressMapClickClearRef = useRef(false);
  const initialViewportFallbackTimerRef = useRef<number | null>(null);

  const mapProvider = getMapProvider();

  const useGoogleMap =
    mapProvider === 'google' &&
    Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);

  const useMapbox =
    mapProvider === 'mapbox' &&
    Boolean(import.meta.env.VITE_MAPBOX_ACCESS_TOKEN);

  useEffect(() => {
    vehiclesRef.current = vehicles;
  }, [vehicles]);

  useEffect(() => {
    followVehicleEnabledRef.current = followVehicleEnabled;
  }, [followVehicleEnabled]);

  useEffect(() => {
    selectedVehicleIdRef.current = selectedVehicleId;
  }, [selectedVehicleId]);

  const muteUserInteraction = (durationMs = CAMERA_MUTING_MS) => {
    suppressUserInteractionRef.current = true;
    if (interactionMuteTimerRef.current !== null) {
      window.clearTimeout(interactionMuteTimerRef.current);
    }
    interactionMuteTimerRef.current = window.setTimeout(() => {
      suppressUserInteractionRef.current = false;
      interactionMuteTimerRef.current = null;
    }, durationMs);
  };

  const clearInitialViewportFallbackTimer = () => {
    if (initialViewportFallbackTimerRef.current !== null) {
      window.clearTimeout(initialViewportFallbackTimerRef.current);
      initialViewportFallbackTimerRef.current = null;
    }
  };

  const disableFollowVehicle = () => {
    if (!followVehicleEnabledRef.current) {
      return;
    }

    followVehicleEnabledRef.current = false;
    setFollowVehicleEnabled(false);
    console.info('[map-follow] follow disabled');
  };

  const enableFollowVehicle = () => {
    if (!followVehicleEnabledRef.current) {
      console.info('[map-follow] follow enabled');
    }
    followVehicleEnabledRef.current = true;
    setFollowVehicleEnabled(true);
  };

  const markUserDragInteraction = () => {
    if (suppressUserInteractionRef.current) {
      return;
    }

    userHasInteractedRef.current = true;
    disableFollowVehicle();
  };

  const clearFollowVehicle = () => {
    if (suppressMapClickClearRef.current) {
      return;
    }

    disableFollowVehicle();
  };

  const muteMapClickClear = (durationMs = MARKER_SELECTION_MUTING_MS) => {
    suppressMapClickClearRef.current = true;
    if (markerSelectionMuteTimerRef.current !== null) {
      window.clearTimeout(markerSelectionMuteTimerRef.current);
    }

    markerSelectionMuteTimerRef.current = window.setTimeout(() => {
      suppressMapClickClearRef.current = false;
      markerSelectionMuteTimerRef.current = null;
    }, durationMs);
  };

  const handleVehicleSelection = (vehicleId: string) => {
    const vehicle = vehiclesRef.current.find((candidate) => candidate.vehicleId === vehicleId) ?? null;
    if (!vehicle) {
      return;
    }

    muteMapClickClear();
    selectedVehicleIdRef.current = vehicleId;
    setSelectedVehicleId(vehicleId);
    enableFollowVehicle();
    centerVehicle(vehicle, {
      force: true,
      preserveHeading: perspectiveMode === '3d',
      preserveBearing: perspectiveMode === '3d',
    });
  };

  const getPrimaryLiveVehicle = () =>
    vehiclesRef.current.find((vehicle) => vehicle.status !== 'OFFLINE') ?? null;

  const getInitialPositionVehicles = () =>
    vehiclesRef.current.filter((vehicle) => vehicle.status === 'ONLINE' || vehicle.status === 'DELAYED');

  const getPrimaryVehicleCenter = () => {
    const vehicle = getInitialPositionVehicles()[0] ?? getPrimaryLiveVehicle();
    if (!vehicle) {
      return null;
    }

    return {
      google: { lat: vehicle.lat, lng: vehicle.lng },
      mapbox: [vehicle.lng, vehicle.lat] as [number, number],
    };
  };

  const applyInitialGooglePosition = (map: google.maps.Map) => {
    if (hasAutoCenteredRef.current) {
      return false;
    }

    const vehiclesForPosition = getInitialPositionVehicles();

    if (vehiclesForPosition.length === 0) {
      return false;
    }

    muteUserInteraction();

    if (vehiclesForPosition.length === 1) {
      const vehicle = vehiclesForPosition[0];
      if (!vehicle) {
        return false;
      }

      map.setCenter({
        lat: vehicle.lat,
        lng: vehicle.lng,
      });
      map.setZoom(Math.max(map.getZoom() ?? 18, 18));
      hasAutoCenteredRef.current = true;
      return true;
    }

    const bounds = new google.maps.LatLngBounds();
    vehiclesForPosition.forEach((vehicle) => {
      bounds.extend({ lat: vehicle.lat, lng: vehicle.lng });
    });
    map.fitBounds(bounds, INITIAL_MULTI_VEHICLE_PADDING_PX);
    hasAutoCenteredRef.current = true;
    return true;
  };

  const applyDefaultGooglePosition = (map: google.maps.Map) => {
    if (hasAutoCenteredRef.current) {
      return false;
    }

    muteUserInteraction();
    map.setCenter({
      lat: DEFAULT_MAP_CENTER[1],
      lng: DEFAULT_MAP_CENTER[0],
    });
    map.setZoom(18);
    hasAutoCenteredRef.current = true;
    return true;
  };

  const applyInitialMapboxPosition = (map: mapboxgl.Map) => {
    if (hasAutoCenteredRef.current) {
      return false;
    }

    const vehiclesForPosition = getInitialPositionVehicles();

    if (vehiclesForPosition.length === 0) {
      return false;
    }

    muteUserInteraction();

    if (vehiclesForPosition.length === 1) {
      const vehicle = vehiclesForPosition[0];
      if (!vehicle) {
        return false;
      }

      map.setCenter([vehicle.lng, vehicle.lat]);
      map.setZoom(Math.max(map.getZoom(), 18));
      hasAutoCenteredRef.current = true;
      return true;
    }

    const lngValues = vehiclesForPosition.map((vehicle) => vehicle.lng);
    const latValues = vehiclesForPosition.map((vehicle) => vehicle.lat);
    const minLng = Math.min(...lngValues);
    const maxLng = Math.max(...lngValues);
    const minLat = Math.min(...latValues);
    const maxLat = Math.max(...latValues);

    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
      padding: INITIAL_MULTI_VEHICLE_PADDING_PX,
      maxZoom: 18,
      duration: 0,
    });
    hasAutoCenteredRef.current = true;
    return true;
  };

  const applyDefaultMapboxPosition = (map: mapboxgl.Map) => {
    if (hasAutoCenteredRef.current) {
      return false;
    }

    muteUserInteraction();
    map.setCenter(DEFAULT_MAP_CENTER);
    map.setZoom(18);
    hasAutoCenteredRef.current = true;
    return true;
  };

  const getFollowVehicle = () => {
    const selectedId = selectedVehicleIdRef.current;
    if (!selectedId) {
      return null;
    }

    return (
      vehiclesRef.current.find((vehicle) => vehicle.vehicleId === selectedId && vehicle.status !== 'OFFLINE') ?? null
    );
  };

  const centerVehicle = (vehicle: VehicleMapViewModel | null, options?: CenterVehicleOptions) => {
    if (!vehicle) {
      return;
    }

    if (useGoogleMap && googleMapRef.current) {
      const map = googleMapRef.current;
      const targetCenter = { lat: vehicle.lat, lng: vehicle.lng };
      const currentCenter = map.getCenter()?.toJSON();

      if (!options?.force && currentCenter) {
        const comparison = getCenterComparison(currentCenter, targetCenter);
        if (comparison.deltaLat < 0.00005 && comparison.deltaLng < 0.00005) {
          return;
        }
      }

      muteUserInteraction();
      map.panTo(targetCenter);
      map.setZoom(Math.max(map.getZoom() ?? 18, 18));
      if (!options?.preserveHeading) {
        map.setHeading(0);
      }
      return;
    }

    if (useMapbox && mapboxMapRef.current) {
      const map = mapboxMapRef.current;
      const currentCenter = map.getCenter();
      if (!options?.force) {
        const comparison = getCenterComparison(
          { lat: currentCenter.lat, lng: currentCenter.lng },
          { lat: vehicle.lat, lng: vehicle.lng },
        );
        if (comparison.deltaLat < 0.00005 && comparison.deltaLng < 0.00005) {
          return;
        }
      }

      muteUserInteraction();
      map.easeTo({
        center: [vehicle.lng, vehicle.lat],
        zoom: Math.max(map.getZoom(), 18),
        bearing: options?.preserveBearing ? map.getBearing() : 0,
        duration: options?.force ? 700 : 500,
      });
    }
  };

  const keepVehicleInView = (options?: CenterVehicleOptions) => {
    centerVehicle(getFollowVehicle(), options);
  };

  const applyGooglePerspective = (mode: PerspectiveMode) => {
    const map = googleMapRef.current;
    const googleApi = window.google;

    if (!map || !googleApi?.maps) {
      return;
    }

    muteUserInteraction();

    if (mode === 'normal') {
      map.setMapTypeId(googleApi.maps.MapTypeId.ROADMAP);
      map.setTilt(0);
      map.setHeading(0);
      keepVehicleInView();
      return;
    }

    map.setMapTypeId(googleApi.maps.MapTypeId.HYBRID);
    map.setTilt(45);
    map.setZoom(Math.max(map.getZoom() ?? 18, 18));
    keepVehicleInView({ preserveHeading: true });
  };

  const applyMapboxPerspective = (mode: PerspectiveMode) => {
  const map = mapboxMapRef.current;
  if (!map) {
    return;
  }

  const targetStyle = mode === '3d' ? MAPBOX_3D_STYLE : MAPBOX_NORMAL_STYLE;
  const styleChanged = mapboxStyleModeRef.current !== mode;

  muteUserInteraction();

  if (styleChanged) {
    mapboxStyleModeRef.current = mode;

    const center = map.getCenter();
    const zoom = map.getZoom();
    const bearing = map.getBearing();

    map.once('style.load', () => {
      map.easeTo({
        center,
        zoom: mode === '3d' ? Math.max(zoom, 18) : zoom,
        bearing: mode === '3d' ? bearing : 0,
        pitch: 0,
        duration: 0,
      });

      keepVehicleInView({ preserveBearing: mode === '3d' });
    });

    map.setStyle(targetStyle);
    return;
  }

  map.easeTo({
    pitch: 0,
    bearing: mode === '3d' ? map.getBearing() : 0,
    zoom: mode === '3d' ? Math.max(map.getZoom(), 18) : map.getZoom(),
    duration: 500,
  });

  keepVehicleInView({ preserveBearing: mode === '3d' });
};

  const togglePerspective = () => {
    setPerspectiveMode((current) => (current === 'normal' ? '3d' : 'normal'));
  };

  const handleResetNorth = () => {
    if (useGoogleMap && googleMapRef.current) {
      muteUserInteraction();
      googleMapRef.current.setHeading(0);
      keepVehicleInView();
      return;
    }

    if (useMapbox && mapboxMapRef.current) {
      muteUserInteraction();
      mapboxMapRef.current.easeTo({
        bearing: 0,
        duration: 500,
      });
      keepVehicleInView();
    }
  };

  const handleZoomIn = () => {
    if (useGoogleMap && googleMapRef.current) {
      muteUserInteraction();
      googleMapRef.current.setZoom((googleMapRef.current.getZoom() ?? 18) + 1);
      return;
    }

    if (useMapbox && mapboxMapRef.current) {
      muteUserInteraction();
      mapboxMapRef.current.zoomIn();
    }
  };

  const handleZoomOut = () => {
    if (useGoogleMap && googleMapRef.current) {
      muteUserInteraction();
      googleMapRef.current.setZoom((googleMapRef.current.getZoom() ?? 18) - 1);
      return;
    }

    if (useMapbox && mapboxMapRef.current) {
      muteUserInteraction();
      mapboxMapRef.current.zoomOut();
    }
  };

  const toggleFollowVehicle = () => {
    if (followVehicleEnabledRef.current) {
      disableFollowVehicle();
      return;
    }

    const vehicle = getFollowVehicle();
    if (!vehicle) {
      return;
    }

    enableFollowVehicle();
    centerVehicle(vehicle, {
      force: true,
      preserveHeading: perspectiveMode === '3d',
      preserveBearing: perspectiveMode === '3d',
    });
  };

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    if (useGoogleMap) {
      if (googleMapRef.current) {
        return;
      }

      let mounted = true;
      let dragListener: google.maps.MapsEventListener | null = null;
      let headingListener: google.maps.MapsEventListener | null = null;
      let clickListener: google.maps.MapsEventListener | null = null;
      const googleMapsApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

      if (!googleMapsApiKey) {
        return;
      }

      void loadGoogleMaps(googleMapsApiKey)
        .then((googleApi) => {
          console.info('[google-map] loaded', {
            hasContainer: Boolean(containerRef.current),
            googleLoaded: Boolean(window.google?.maps),
          });

          if (!mounted || !containerRef.current) {
            return;
          }

          const initialCenter = getPrimaryVehicleCenter()?.google ?? {
            lat: DEFAULT_MAP_CENTER[1],
            lng: DEFAULT_MAP_CENTER[0],
          };

          const map = new googleApi.maps.Map(containerRef.current, {
            center: initialCenter,
            zoom: 18,
            minZoom: MAP_MIN_ZOOM,
            maxZoom: MAP_MAX_ZOOM,
            mapTypeId: googleApi.maps.MapTypeId.ROADMAP,
            tilt: 0,
            heading: 0,
            fullscreenControl: false,
            streetViewControl: false,
            mapTypeControl: false,
            zoomControl: false,
            clickableIcons: false,
            restriction: {
              latLngBounds: {
                north: JAPAN_BOUNDS_NE[1],
                south: JAPAN_BOUNDS_SW[1],
                west: JAPAN_BOUNDS_SW[0],
                east: JAPAN_BOUNDS_NE[0],
              },
              strictBounds: false,
            },
          });

          googleMapRef.current = map;
          googlePlaceInfoWindowRef.current = new googleApi.maps.InfoWindow();
          hasAutoCenteredRef.current = false;
          setCameraAngleDeg(map.getHeading() ?? 0);

          dragListener = map.addListener('dragstart', markUserDragInteraction);
          clickListener = map.addListener('click', clearFollowVehicle);
          headingListener = map.addListener('heading_changed', () => {
            setCameraAngleDeg(normalizeHeading(map.getHeading() ?? 0));
          });
        })
        .catch((error) => {
          console.error('[google-map] failed', error);
        });

      return () => {
        mounted = false;
        dragListener?.remove();
        clickListener?.remove();
        headingListener?.remove();

        googleMarkersRef.current.forEach((marker) => marker.overlay.setMap(null));
        googleMarkersRef.current.clear();
        googlePlaceMarkersRef.current.forEach((marker) => marker.overlay.setMap(null));
        googlePlaceMarkersRef.current.clear();
        googlePlaceInfoWindowRef.current?.close();
        googlePlaceInfoWindowRef.current = null;

        googleMapRef.current = null;
      };
    }

    if (useMapbox) {
      if (mapboxMapRef.current) {
        return;
      }

      let mounted = true;

      void import('mapbox-gl').then(({ default: mapboxgl }) => {
        if (!mounted || !containerRef.current) {
          return;
        }

        mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

        const initialCenter = getPrimaryVehicleCenter()?.mapbox ?? DEFAULT_MAP_CENTER;

        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: MAPBOX_NORMAL_STYLE,
          center: initialCenter,
          zoom: 18,
          minZoom: MAP_MIN_ZOOM,
          maxZoom: MAP_MAX_ZOOM,
          maxBounds: [JAPAN_BOUNDS_SW, JAPAN_BOUNDS_NE],
          pitch: 0,
          bearing: 0,
          antialias: true,
        });

        mapboxMapRef.current = map;
        mapboxStyleModeRef.current = 'normal';
        hasAutoCenteredRef.current = false;

        const handleResize = () => {
          map.resize();
        };

        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(containerRef.current);

        map.on('load', () => {
          handleResize();
          setCameraAngleDeg(normalizeHeading(map.getBearing()));
        });
        window.addEventListener('resize', handleResize);

        map.on('dragstart', markUserDragInteraction);
        map.on('click', clearFollowVehicle);
        map.on('rotate', () => {
          setCameraAngleDeg(normalizeHeading(map.getBearing()));
        });

        const cleanup = () => {
          resizeObserver.disconnect();
          window.removeEventListener('resize', handleResize);
          map.off('dragstart', markUserDragInteraction);
          map.off('click', clearFollowVehicle);
        };

        map.on('remove', cleanup);
      });

      return () => {
        mounted = false;

        mapboxMarkersRef.current.forEach((marker) => marker.remove());
        mapboxMarkersRef.current.clear();
        mapboxPlaceMarkersRef.current.forEach((marker) => marker.remove());
        mapboxPlaceMarkersRef.current.clear();

        mapboxMapRef.current?.remove();
        mapboxMapRef.current = null;
      };
    }

    return undefined;
  }, [useGoogleMap, useMapbox]);

  useEffect(() => {
    if (hasAutoCenteredRef.current) {
      clearInitialViewportFallbackTimer();
      return;
    }

    const hasInitialPositionVehicles = getInitialPositionVehicles().length > 0;

    if (useGoogleMap && googleMapRef.current) {
      if (hasInitialPositionVehicles && applyInitialGooglePosition(googleMapRef.current)) {
        clearInitialViewportFallbackTimer();
        return;
      }

      if (initialViewportFallbackTimerRef.current === null) {
        initialViewportFallbackTimerRef.current = window.setTimeout(() => {
          if (!hasAutoCenteredRef.current && useGoogleMap && googleMapRef.current) {
            applyDefaultGooglePosition(googleMapRef.current);
          }
          initialViewportFallbackTimerRef.current = null;
        }, INITIAL_VIEWPORT_FALLBACK_DELAY_MS);
      }
      return;
    }

    if (useMapbox && mapboxMapRef.current) {
      if (hasInitialPositionVehicles && applyInitialMapboxPosition(mapboxMapRef.current)) {
        clearInitialViewportFallbackTimer();
        return;
      }

      if (initialViewportFallbackTimerRef.current === null) {
        initialViewportFallbackTimerRef.current = window.setTimeout(() => {
          if (!hasAutoCenteredRef.current && useMapbox && mapboxMapRef.current) {
            applyDefaultMapboxPosition(mapboxMapRef.current);
          }
          initialViewportFallbackTimerRef.current = null;
        }, INITIAL_VIEWPORT_FALLBACK_DELAY_MS);
      }
    }
  }, [useGoogleMap, useMapbox, vehicles]);

  useEffect(() => {
    if (useGoogleMap) {
      applyGooglePerspective(perspectiveMode);
      return;
    }

    if (useMapbox) {
      applyMapboxPerspective(perspectiveMode);
    }
  }, [perspectiveMode, useGoogleMap, useMapbox]);

  useEffect(() => {
    if (selectedVehicleId && !vehicles.some((vehicle) => vehicle.vehicleId === selectedVehicleId && vehicle.status !== 'OFFLINE')) {
      selectedVehicleIdRef.current = null;
      setSelectedVehicleId(null);
      disableFollowVehicle();
    }
  }, [selectedVehicleId, vehicles]);

  useEffect(() => {
    const followVehicle = getFollowVehicle();
    const followSignature = followVehicle ? `${followVehicle.vehicleId}:${followVehicle.receivedAt}` : null;

    if (!followVehicleEnabled || !followVehicle || followSignature === null) {
      return;
    }

    if (lastFollowSignatureRef.current === followSignature) {
      return;
    }

    lastFollowSignatureRef.current = followSignature;
    centerVehicle(followVehicle, {
      preserveHeading: perspectiveMode === '3d',
      preserveBearing: perspectiveMode === '3d',
    });
  }, [followVehicleEnabled, perspectiveMode, vehicles]);

  useEffect(() => {
    return () => {
      if (interactionMuteTimerRef.current !== null) {
        window.clearTimeout(interactionMuteTimerRef.current);
      }
      if (markerSelectionMuteTimerRef.current !== null) {
        window.clearTimeout(markerSelectionMuteTimerRef.current);
      }
      clearInitialViewportFallbackTimer();
    };
  }, []);

  useEffect(() => {
    const logMapInvestigation = (
      phase: 'rendered' | 'displayed',
      details: Record<string, unknown>,
    ) => {
      console.info('[map-investigation]', JSON.stringify({ phase, ...details }));
    };

    const logVehicleRender = (vehicle: VehicleMapViewModel) => {
      const frontendSequence = vehicle.investigation?.frontendSequence ?? null;

      if (
        frontendSequence === null ||
        lastLoggedSequenceRef.current.get(vehicle.vehicleId) === frontendSequence
      ) {
        return;
      }

      lastLoggedSequenceRef.current.set(vehicle.vehicleId, frontendSequence);

      const renderedPerfMs = performance.now();
      const renderedAt = new Date().toISOString();

      const frontendRenderMs =
        vehicle.investigation?.frontendMessageReceivedPerfMs !== undefined &&
        vehicle.investigation?.frontendMessageReceivedPerfMs !== null
          ? Math.max(0, renderedPerfMs - vehicle.investigation.frontendMessageReceivedPerfMs)
          : null;

      const totalDelayMs = vehicle.investigation?.routerGnssTime
        ? Math.max(0, Date.parse(renderedAt) - Date.parse(vehicle.investigation.routerGnssTime))
        : null;

      vehicle.investigation = {
        ...(vehicle.investigation ?? {}),
        frontendMarkerUpdateAt: renderedAt,
        frontendMarkerUpdatePerfMs: renderedPerfMs,
        frontendRenderCompleteAt: renderedAt,
        frontendRenderCompletePerfMs: renderedPerfMs,
      };

      logMapInvestigation('rendered', {
        vehicleId: vehicle.vehicleId,
        vehicleName: vehicle.vehicleName,
        latitude: vehicle.lat,
        longitude: vehicle.lng,
        routerSampleAgeMs: vehicle.investigation?.routerSampleAgeMs ?? null,
        backendProcessingMs: vehicle.investigation?.backendProcessingMs ?? null,
        websocketMs: vehicle.investigation?.websocketBroadcastAt
          ? Math.max(0, Date.parse(renderedAt) - Date.parse(vehicle.investigation.websocketBroadcastAt))
          : null,
        frontendRenderMs,
        totalDelayMs,
      });

      window.requestAnimationFrame(() => {
        const displayedPerfMs = performance.now();
        const displayedAt = new Date().toISOString();

        const frontendRenderVisibleMs =
          vehicle.investigation?.frontendMessageReceivedPerfMs !== undefined &&
          vehicle.investigation?.frontendMessageReceivedPerfMs !== null
            ? Math.max(0, displayedPerfMs - vehicle.investigation.frontendMessageReceivedPerfMs)
            : null;

        const displayTotalDelayMs = vehicle.investigation?.routerGnssTime
          ? Math.max(0, Date.parse(displayedAt) - Date.parse(vehicle.investigation.routerGnssTime))
          : null;

        vehicle.investigation = {
          ...(vehicle.investigation ?? {}),
          frontendDisplayAt: displayedAt,
          frontendDisplayPerfMs: displayedPerfMs,
        };

        logMapInvestigation('displayed', {
          vehicleId: vehicle.vehicleId,
          vehicleName: vehicle.vehicleName,
          metrics: {
            routerSampleAgeMs: vehicle.investigation?.routerSampleAgeMs ?? null,
            backendProcessingMs: vehicle.investigation?.backendProcessingMs ?? null,
            websocketMs: vehicle.investigation?.websocketBroadcastAt
              ? Math.max(0, Date.parse(displayedAt) - Date.parse(vehicle.investigation.websocketBroadcastAt))
              : null,
            frontendRenderMs: frontendRenderVisibleMs,
            totalDelayMs: displayTotalDelayMs,
          },
        });
      });
    };

    const seen = new Set<string>();

    if (useGoogleMap && googleMapRef.current && window.google?.maps) {
      const map = googleMapRef.current;
      const infoWindow = googlePlaceInfoWindowRef.current ?? new window.google.maps.InfoWindow();
      googlePlaceInfoWindowRef.current = infoWindow;

      vehicles.forEach((vehicle) => {
        seen.add(vehicle.vehicleId);

        let marker = googleMarkersRef.current.get(vehicle.vehicleId);

        if (!marker) {
          marker = createGoogleVehicleOverlay(window.google, map, vehicle, handleVehicleSelection);
          googleMarkersRef.current.set(vehicle.vehicleId, marker);
        }

        setGoogleVehicleMarkerContent(marker, vehicle);
        logVehicleRender(vehicle);
      });

      googleMarkersRef.current.forEach((marker, vehicleId) => {
          if (!seen.has(vehicleId)) {
            marker.overlay.setMap(null);
            googleMarkersRef.current.delete(vehicleId);
            lastLoggedSequenceRef.current.delete(vehicleId);
          }
      });

      const seenPlaceMarkers = new Set<string>();
      placeMarkers.forEach((placeMarker) => {
        seenPlaceMarkers.add(placeMarker.id);

        let marker = googlePlaceMarkersRef.current.get(placeMarker.id);
        if (!marker) {
          marker = createGooglePlaceMarkerOverlay(window.google, map, infoWindow, placeMarker);
          googlePlaceMarkersRef.current.set(placeMarker.id, marker);
        }

        setGooglePlaceMarkerContent(marker, placeMarker);
      });

      googlePlaceMarkersRef.current.forEach((marker, placeMarkerId) => {
        if (!seenPlaceMarkers.has(placeMarkerId)) {
          marker.overlay.setMap(null);
          googlePlaceMarkersRef.current.delete(placeMarkerId);
        }
      });

      return;
    }

    if (useMapbox && mapboxMapRef.current && import.meta.env.VITE_MAPBOX_ACCESS_TOKEN) {
      void import('mapbox-gl').then(({ default: mapboxgl }) => {
        vehicles.forEach((vehicle) => {
          seen.add(vehicle.vehicleId);

          let marker = mapboxMarkersRef.current.get(vehicle.vehicleId);

          if (!marker) {
            const markerNode = document.createElement('div');
            markerNode.className = 'vehicle-marker-card';
            markerNode.style.cursor = 'pointer';
            markerNode.addEventListener('click', () => {
              handleVehicleSelection(vehicle.vehicleId);
            });

            marker = new mapboxgl.Marker({
              element: markerNode,
              anchor: 'bottom-left',
            })
              .setLngLat([vehicle.lng, vehicle.lat])
              .addTo(mapboxMapRef.current!);

            mapboxMarkersRef.current.set(vehicle.vehicleId, marker);
          }

          marker.setLngLat([vehicle.lng, vehicle.lat]);

          marker.getElement().innerHTML = `
            <div class="vehicle-marker-card__dot" style="background:${vehicle.color}"></div>
            <div class="vehicle-marker-card__label">
              <div class="vehicle-marker-card__title">${vehicle.vehicleName}</div>
              <div class="vehicle-marker-card__meta ${vehicle.status.toLowerCase()}">${buildVehicleMeta(vehicle)}</div>
            </div>
          `;

          logVehicleRender(vehicle);
        });

        mapboxMarkersRef.current.forEach((marker, vehicleId) => {
          if (!seen.has(vehicleId)) {
            marker.remove();
            mapboxMarkersRef.current.delete(vehicleId);
            lastLoggedSequenceRef.current.delete(vehicleId);
          }
        });

        const seenPlaceMarkers = new Set<string>();
        placeMarkers.forEach((placeMarker) => {
          seenPlaceMarkers.add(placeMarker.id);

          let marker = mapboxPlaceMarkersRef.current.get(placeMarker.id);
          if (!marker) {
            const markerNode = document.createElement('button');
            markerNode.type = 'button';
            markerNode.style.background = 'transparent';
            markerNode.style.border = '0';
            markerNode.style.padding = '0';
            markerNode.style.cursor = 'pointer';
            markerNode.innerHTML = buildPlaceMarkerBadge(placeMarker);

            marker = new mapboxgl.Marker({
              element: markerNode,
              anchor: 'bottom',
            })
              .setLngLat([placeMarker.longitude, placeMarker.latitude])
              .setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(buildPlaceMarkerPopupContent(placeMarker)))
              .addTo(mapboxMapRef.current!);

            mapboxPlaceMarkersRef.current.set(placeMarker.id, marker);
          }

          marker.setLngLat([placeMarker.longitude, placeMarker.latitude]);
          marker.getElement().innerHTML = buildPlaceMarkerBadge(placeMarker);
          marker.setPopup(new mapboxgl.Popup({ offset: 18 }).setHTML(buildPlaceMarkerPopupContent(placeMarker)));
        });

        mapboxPlaceMarkersRef.current.forEach((marker, placeMarkerId) => {
          if (!seenPlaceMarkers.has(placeMarkerId)) {
            marker.remove();
            mapboxPlaceMarkersRef.current.delete(placeMarkerId);
          }
        });
      });
    }
  }, [placeMarkers, vehicles, useGoogleMap, useMapbox]);

  const fallbackVehicles = useMemo(() => vehicles, [vehicles]);
  const controlButtonBase =
    'flex h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200/80 bg-white/90 px-3 text-[11px] font-semibold tracking-[0.08em] text-slate-700 shadow-[0_14px_28px_-18px_rgba(15,23,42,0.35)] backdrop-blur transition-all duration-150 hover:border-slate-300 hover:bg-slate-50 active:translate-y-px active:bg-slate-100 active:shadow-[0_10px_24px_-18px_rgba(15,23,42,0.35)] disabled:cursor-not-allowed disabled:border-slate-200/70 disabled:bg-slate-100/90 disabled:text-slate-400';
  const followButtonActive = followVehicleEnabled && selectedVehicleId !== null;
  const canToggleFollow = selectedVehicleId !== null;

  if (!useGoogleMap && !useMapbox) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.12),_transparent_30%),linear-gradient(180deg,#e2e8f0,#cbd5e1)]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.06)_1px,transparent_1px)] bg-[size:32px_32px]" />

        <div className="relative flex h-full flex-col p-6">
          <div>
            <p className="text-sm uppercase tracking-[0.3em] text-sky-700">Fallback map mode</p>
            <h3 className="mt-3 text-2xl font-semibold text-slate-900">Realtime feed without map provider</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Set <code>VITE_MAP_PROVIDER=google</code> with <code>VITE_GOOGLE_MAPS_API_KEY</code>,
              or set <code>VITE_MAP_PROVIDER=mapbox</code> with <code>VITE_MAPBOX_ACCESS_TOKEN</code>.
            </p>

            {demoMode ? (
              <p className="mt-2 text-sm text-amber-700">
                Demo Mode is enabled, so mock vehicle movement can be demonstrated even without a live GNSS feed.
              </p>
            ) : null}
          </div>

          <div className="mt-6 grid flex-1 gap-4 md:grid-cols-2">
            {fallbackVehicles.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-white/60 p-5 text-sm text-slate-500">
                No GPS data is available yet.
              </div>
            ) : null}

            {fallbackVehicles.map((vehicle) => (
              <div key={vehicle.vehicleId} className="rounded-3xl border border-slate-200 bg-white/70 p-5 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="h-4 w-4 rounded-full" style={{ backgroundColor: vehicle.color }} />
                  <div>
                    <p className="font-semibold text-slate-900">{vehicle.vehicleName}</p>
                    <p className={`text-xs uppercase tracking-[0.24em] ${statusClasses[vehicle.status]}`}>
                      {vehicle.status}
                    </p>
                  </div>
                </div>

                <p className="mt-4 text-sm text-slate-600">
                  {vehicle.lat.toFixed(6)}, {vehicle.lng.toFixed(6)}
                </p>

                <p className="mt-2 text-sm text-slate-500">{buildVehicleMeta(vehicle)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={containerRef} className="h-full w-full overflow-hidden" />

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 sm:inset-x-auto sm:right-3 sm:top-3 sm:bottom-auto">
        <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-end gap-2 rounded-2xl border border-slate-200/80 bg-white/90 p-2 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.28)] backdrop-blur">
          <button
            type="button"
            className={`${controlButtonBase} ${followButtonActive ? 'border-emerald-600 bg-emerald-600 text-white hover:border-emerald-700 hover:bg-emerald-700 active:bg-emerald-800' : 'border-slate-200/80 bg-white/90 text-slate-700'}`}
            onClick={toggleFollowVehicle}
            title={followButtonActive ? 'Disable vehicle follow' : 'Enable vehicle follow'}
            disabled={!canToggleFollow}
          >
            <img
              src={followIcon}
              alt="Follow vehicle"
              className="h-4 w-4 select-none"
              draggable={false}
            />
          </button>
          <button
            type="button"
            className={`${controlButtonBase} ${perspectiveMode === '3d' ? 'border-emerald-600 bg-emerald-600 text-white hover:border-emerald-700 hover:bg-emerald-700 active:bg-emerald-800' : 'border-slate-200/80 bg-white/90 text-slate-700'}`}
            onClick={togglePerspective}
            title="3D view"
          >
            3D
          </button>
          <button type="button" className={controlButtonBase} onClick={handleResetNorth} title="Reset north">
            <span
              className="inline-flex h-5 w-5 items-center justify-center transition-transform"
              style={{ transform: `rotate(${-cameraAngleDeg}deg)` }}
            >
              N
            </span>
          </button>
          <button type="button" className={controlButtonBase} onClick={handleZoomIn} title="Zoom in">
            +
          </button>
          <button type="button" className={controlButtonBase} onClick={handleZoomOut} title="Zoom out">
            -
          </button>
        </div>
      </div>
    </div>
  );
}
