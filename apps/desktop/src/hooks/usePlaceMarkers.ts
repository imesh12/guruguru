import { useEffect, useState } from 'react';

import { apiRequest } from '../lib/api';
import type { PlaceMarker } from '../types';

const BROWSER_PLACE_MARKER_REFRESH_MS = 5000;

export function usePlaceMarkers() {
  const [placeMarkers, setPlaceMarkers] = useState<PlaceMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.listPlaceMarkers || !window.electronAPI?.onPlaceMarkersChanged) {
      let disposed = false;

      const loadFromApi = async () => {
        try {
          const response = await apiRequest<{ placeMarkers: PlaceMarker[] }>('/api/place-markers');
          if (!disposed) {
            setPlaceMarkers(response.placeMarkers);
            setError(null);
          }
        } catch (loadError) {
          if (!disposed) {
            setError(loadError instanceof Error ? loadError.message : '場所マーカーを読み込めませんでした。');
          }
        } finally {
          if (!disposed) {
            setLoading(false);
          }
        }
      };

      void loadFromApi();
      const timer = window.setInterval(() => {
        void loadFromApi();
      }, BROWSER_PLACE_MARKER_REFRESH_MS);

      return () => {
        disposed = true;
        window.clearInterval(timer);
      };
    }

    let disposed = false;

    const load = async () => {
      try {
        const nextPlaceMarkers = await window.electronAPI.listPlaceMarkers();
        if (!disposed) {
          setPlaceMarkers(nextPlaceMarkers);
          setError(null);
        }
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : '場所マーカーを読み込めませんでした。');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void load();

    const unsubscribe = window.electronAPI.onPlaceMarkersChanged((nextPlaceMarkers) => {
      if (disposed) {
        return;
      }

      setPlaceMarkers(nextPlaceMarkers);
      setError(null);
      setLoading(false);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  return {
    placeMarkers,
    loading,
    error,
  };
}
