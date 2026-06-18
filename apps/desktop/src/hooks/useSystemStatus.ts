import { useEffect, useState } from 'react';

import { apiRequest, fetchSystemStatus, getReadableApiError } from '../lib/api';
import type { SystemStatusSnapshot, VehicleGpsState } from '../types';

type UseSystemStatusResult = {
  data: SystemStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  refresh: () => Promise<void>;
};

const toVehicleStatus = (ageSec: number): SystemStatusSnapshot['gps']['vehicles'][number]['status'] => {
  if (ageSec <= 5) {
    return 'ONLINE';
  }
  if (ageSec <= 15) {
    return 'DELAYED';
  }
  return 'OFFLINE';
};

const toGpsVehicleSummary = (vehicles: VehicleGpsState[]): SystemStatusSnapshot['gps']['vehicles'] => {
  const now = Date.now();
  return vehicles
    .map((vehicle) => {
      const ageSec = Math.max(0, Math.floor((now - new Date(vehicle.receivedAt).getTime()) / 1000));

      return {
        vehicleId: vehicle.vehicleId,
        vehicleName: vehicle.vehicleName,
        status: toVehicleStatus(ageSec),
        lastUpdateAt: vehicle.receivedAt,
        ageSec,
      };
    })
    .sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));
};

export function useSystemStatus(): UseSystemStatusResult {
  const [data, setData] = useState<SystemStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let disposed = false;
    let timer = 0;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const body = await fetchSystemStatus<SystemStatusSnapshot>(controller.signal);
        let gpsVehicles = body.gps.vehicles;

        try {
          const latest = await apiRequest<{ vehicles: VehicleGpsState[] }>('/gps/latest', {
            signal: controller.signal,
          });
          gpsVehicles = toGpsVehicleSummary(latest.vehicles);
        } catch {
          // Keep the dashboard usable even if the dedicated GPS summary refresh fails transiently.
        }

        if (!disposed) {
          setData({
            ...body,
            gps: {
              ...body.gps,
              vehicles: gpsVehicles,
            },
          });
          setError(null);
          setLoading(false);
          setConnected(true);
        }
      } catch (fetchError) {
        if (!disposed) {
          setError(getReadableApiError(fetchError) || 'API starting / reconnecting.');
          setLoading(false);
          setConnected(false);
        }
      } finally {
        if (!disposed) {
          timer = window.setTimeout(() => {
            void poll();
          }, 2000);
        }
      }
    };

    void poll();

    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [refreshToken]);

  const refresh = async () => {
    setRefreshToken((current) => current + 1);
  };

  return {
    data,
    loading,
    error,
    connected,
    refresh,
  };
}
