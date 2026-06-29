import { useEffect } from 'react';

import { useAdminAuth } from '../auth/AdminAuthContext';
import { StatusBadge } from '../components/StatusBadge';
import { AppShell, OperationButton, OperationPanel, SectionHeader } from '../components/ui';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { useI18n } from '../i18n';
import type { SystemStatusTone } from '../types';

type ControlCard = {
  title: string;
  body: string;
  variant: 'primary' | 'success' | 'accent' | 'warning';
  type: 'button' | 'link';
  onClick?: () => void;
  to?: string;
  adminOnly?: boolean;
};

export function ControlPage() {
  const { role } = useAdminAuth();
  const { t } = useI18n();
  const { demoMode } = useRuntimeConfig();
  const { data, connected } = useSystemStatus();
  const isAdmin = role === 'admin';
  const liveCameras = data?.cameras.filter((camera) => camera.status === 'LIVE').length ?? 0;
  const onlineVehicles = data?.gps.vehicles.filter((vehicle) => vehicle.status === 'ONLINE').length ?? 0;
  const hasLiveVehicleLocations = (data?.gps.vehicles.length ?? 0) > 0;
  const receiverBadgeStatus: SystemStatusTone =
    hasLiveVehicleLocations && data?.receiver.status === 'DISABLED'
      ? 'ACTIVE'
      : (data?.receiver.status ?? 'OFFLINE');
  const vehicleLocationSourceLabel =
    hasLiveVehicleLocations && data?.receiver.status !== 'ONLINE'
      ? 'SE220直接ポーリングから車両位置を受信中'
      : data
        ? `${data.receiver.mode.toUpperCase()} ${data.receiver.port}`
        : t('common.loading');

  useEffect(() => {
    console.info('[dashboard-status] live cameras', {
      liveCameras,
      totalCameras: data?.cameras.length ?? 0,
    });
  }, [data?.cameras.length, liveCameras]);

  const cards: ControlCard[] = [
    {
      type: 'button',
      title: t('control.videoWallTitle'),
      body: t('control.videoWallBody'),
      variant: 'primary',
      onClick: () => void window.electronAPI.openVideoWall(),
    },
    {
      type: 'button',
      title: t('control.mapTitle'),
      body: t('control.mapBody'),
      variant: 'success',
      onClick: () => void window.electronAPI.openMap(),
    },
    {
      type: 'link',
      title: t('control.statusTitle'),
      body: t('control.statusBody'),
      variant: 'accent',
      to: '/system-status',
      adminOnly: true,
    },
    {
      type: 'link',
      title: t('control.settingsTitle'),
      body: t('control.settingsBody'),
      variant: 'warning',
      to: '/settings',
      adminOnly: true,
    },
  ];

  const visibleCards = isAdmin ? cards : cards.filter((card) => !card.adminOnly);
  const actionGridClass = isAdmin
    ? 'mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4'
    : 'mt-6 grid max-w-4xl gap-6 md:grid-cols-2 mx-auto';
  const actionCardClass = isAdmin
    ? 'min-h-40 w-full flex-col items-start rounded-2xl px-6 py-6 text-left'
    : 'min-h-48 w-full max-w-xl flex-col items-start rounded-2xl px-8 py-8 text-left';

  return (
    <AppShell
      className="px-8 py-10"
      containerClassName="max-w-6xl gap-8"
      eyebrow={t('control.eyebrow')}
      title={t('control.title')}
      description={t('control.description')}
    >
      <section className="grid gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[16px] font-semibold tracking-[0.18em] text-slate-700">{t('common.appName')}</p>
            {demoMode ? (
              <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[12px] font-semibold text-amber-800">
                {t('common.demoMode')}
              </span>
            ) : null}
          </div>
        </div>

        <OperationPanel>
          <SectionHeader title={t('control.actions')} />
          <div className={actionGridClass}>
            {visibleCards.map((card) =>
              card.type === 'button' ? (
                <OperationButton
                  key={card.title}
                  type="button"
                  variant={card.variant}
                  onClick={card.onClick}
                  className={actionCardClass}
                >
                  <span className="block text-[14px] font-semibold">{t('control.eyebrow')}</span>
                  <span className="mt-3 block text-3xl font-semibold">{card.title}</span>
                  <span className="mt-2 block text-[16px] leading-7">{card.body}</span>
                </OperationButton>
              ) : (
                <OperationButton
                  key={card.title}
                  to={card.to!}
                  variant={card.variant}
                  className={actionCardClass}
                >
                  <span className="block text-[14px] font-semibold">{t('control.eyebrow')}</span>
                  <span className="mt-3 block text-3xl font-semibold">{card.title}</span>
                  <span className="mt-2 block text-[16px] leading-7">{card.body}</span>
                </OperationButton>
              ),
            )}
          </div>
        </OperationPanel>

        <OperationPanel>
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <h2 className="mt-3 text-2xl font-semibold text-slate-900">{t('control.guidance')}</h2>
              </div>
            </div>
            <StatusBadge status={receiverBadgeStatus} />
          </div>

          <div className="mt-5 grid gap-3 text-[16px] text-slate-700 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-4">
              <p className="text-slate-600">{t('control.liveCameras')}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {liveCameras} / {data?.cameras.length ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-4">
              <p className="text-slate-600">{t('control.onlineVehicles')}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">
                {onlineVehicles} / {data?.gps.vehicles.length ?? 0}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-4">
              <p className="text-slate-600">{t('control.receiver')}</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[16px] font-medium text-slate-900">{vehicleLocationSourceLabel}</span>
                <StatusBadge status={receiverBadgeStatus} />
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 text-[16px] text-slate-700 md:grid-cols-3">
            <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-4">
              <p className="text-slate-600">API状態</p>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-[16px] font-medium text-slate-900">{connected ? '接続中' : '再接続中'}</span>
                <StatusBadge status={connected ? 'ONLINE' : 'RECONNECTING'} />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-4">
              <p className="text-slate-600">mpv セッション数</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{data?.performance.mpvProcessCount ?? 0}</p>
            </div>
            <div className="rounded-2xl border border-slate-300 bg-slate-50 px-4 py-4">
              <p className="text-slate-600">GPU</p>
              <p className="mt-1 text-[16px] font-semibold text-slate-900">{data?.performance.gpuStatus ?? '確認中...'}</p>
            </div>
          </div>
        </OperationPanel>
      </section>
    </AppShell>
  );
}
