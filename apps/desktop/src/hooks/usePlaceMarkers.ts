import { useEffect, useState } from 'react';

import type { PlaceMarker } from '../types';

export function usePlaceMarkers() {
  const [placeMarkers, setPlaceMarkers] = useState<PlaceMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.listPlaceMarkers || !window.electronAPI?.onPlaceMarkersChanged) {
      setPlaceMarkers([]);
      setError(null);
      setLoading(false);
      return () => undefined;
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
