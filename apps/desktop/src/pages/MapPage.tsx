import { useEffect } from 'react';

import { MapPanel } from '../components/MapPanel';
import { EmptyState, OperationPanel, SectionHeader } from '../components/ui';
import { useDemoVehicleLocations } from '../hooks/useDemoVehicleLocations';
import { useI18n } from '../i18n';
import { usePlaceMarkers } from '../hooks/usePlaceMarkers';
import { useVehicleGpsFeed } from '../hooks/useVehicleGpsFeed';

export function MapPage() {
  const { t } = useI18n();
  const demoGpsLoopEnabled = import.meta.env.VITE_DEMO_GPS_LOOP === 'true';
  const liveFeed = useVehicleGpsFeed(!demoGpsLoopEnabled);
  const demoFeed = useDemoVehicleLocations(demoGpsLoopEnabled);
  const { vehicles, connected, demoMode, error } = demoGpsLoopEnabled ? demoFeed : liveFeed;
  const { placeMarkers } = usePlaceMarkers();

  const getVehicleBadges = (vehicle: (typeof vehicles)[number]) => {
    const badges: Array<{ label: 'ONLINE' | 'OFFLINE' | 'MOVING'; className: string }> = [];

    if (vehicle.status === 'OFFLINE') {
      badges.push({
        label: 'OFFLINE',
        className: 'bg-rose-500/12 text-rose-700 ring-1 ring-rose-500/15',
      });
      return badges;
    }

    badges.push({
      label: 'ONLINE',
      className: 'bg-emerald-500/12 text-emerald-700 ring-1 ring-emerald-500/15',
    });

    if ((vehicle.speed ?? 0) > 1) {
      badges.push({
        label: 'MOVING',
        className: 'bg-sky-500/12 text-sky-700 ring-1 ring-sky-500/15',
      });
    }

    return badges;
  };

  useEffect(() => {
    const elements = [document.documentElement, document.body, document.getElementById('root')].filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    const previousOverflow = elements.map((element) => element.style.overflow);

    elements.forEach((element) => {
      element.style.overflow = 'hidden';
    });

    return () => {
      elements.forEach((element, index) => {
        element.style.overflow = previousOverflow[index] ?? '';
      });
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-100 text-slate-950">
      <MapPanel vehicles={vehicles} placeMarkers={placeMarkers} demoMode={demoMode} />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <OperationPanel className="pointer-events-auto absolute left-3 top-3 flex max-w-[min(26rem,calc(100vw-1.5rem))] flex-col gap-1 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">{t('map.eyebrow')}</p>
            {demoMode ? <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] text-amber-800">{t('common.demoMode')}</span> : null}
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.18em] ${connected ? 'border-emerald-300 bg-emerald-100 text-emerald-800' : 'border-amber-300 bg-amber-100 text-amber-800'}`}>
              {connected ? t('map.wsOnline') : t('map.wsReconnect')}
            </span>
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-slate-950">{t('map.title')}</h1>
            <p className="mt-0.5 text-sm leading-5 text-slate-700">{t('map.description')}</p>
          </div>
          {error && !demoMode ? <p className="text-sm font-medium text-rose-700">{t('common.apiUnavailable')}</p> : null}
        </OperationPanel>

        <OperationPanel className="pointer-events-auto absolute bottom-3 right-3 flex max-h-[min(46vh,28rem)] w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden p-0">
          <div className="px-3 py-2.5">
            <SectionHeader title={t('map.title')} actions={<span className="text-sm text-slate-500">{vehicles.length}</span>} />
          </div>
          <div className="overflow-y-auto px-2.5 py-2.5">
            {vehicles.length === 0 ? <EmptyState title={t('map.noGps')} /> : null}
            <div className="space-y-1.5">
              {vehicles.map((vehicle) => (
                <div key={vehicle.vehicleId} className="flex items-start justify-between gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 px-2.5 py-2.5">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full ring-2 ring-white/80" style={{ backgroundColor: vehicle.color }} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{vehicle.vehicleName}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {vehicle.lat.toFixed(6)}, {vehicle.lng.toFixed(6)}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">{t('map.updatedAgo', { seconds: vehicle.ageSeconds })}</p>
                      {typeof vehicle.investigation?.routerSampleAgeMs === 'number' ? (
                        <p className="mt-1 text-[10px] text-slate-400">GNSS age {(vehicle.investigation.routerSampleAgeMs / 1000).toFixed(1)}s</p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {getVehicleBadges(vehicle).map((badge) => (
                      <span key={badge.label} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${badge.className}`}>
                        {badge.label}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </OperationPanel>
      </div>
    </main>
  );
}
