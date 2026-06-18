import { useEffect, useState } from 'react';

import { StatusBadge } from '../components/StatusBadge';
import { AppShell, EmptyState, OperationButton, OperationPanel, SectionHeader } from '../components/ui';
import { useRuntimeConfig } from '../hooks/useRuntimeConfig';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { useI18n } from '../i18n';

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return '未記録';
  }

  return new Date(value).toLocaleString();
};

const formatUptime = (uptimeSec: number) => {
  const hours = Math.floor(uptimeSec / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);
  const seconds = uptimeSec % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
};

const recoveryActions = [
  {
    action: 'restart-api' as const,
    label: 'Restart API',
    description: 'APIサービスを再起動します',
    marker: '●',
    cardClassName: 'border-amber-200 bg-amber-50/70 hover:border-amber-300 hover:bg-amber-50',
    markerClassName: 'bg-amber-100 text-amber-700',
  },
  {
    action: 'restart-desktop' as const,
    label: 'Restart Desktop',
    description: 'デスクトップ画面を再起動します',
    marker: '●',
    cardClassName: 'border-orange-200 bg-orange-50/70 hover:border-orange-300 hover:bg-orange-50',
    markerClassName: 'bg-orange-100 text-orange-700',
  },
  {
    action: 'restart-mpv' as const,
    label: 'Restart mpv sessions',
    description: '再生プロセスを再起動します',
    marker: '●',
    cardClassName: 'border-sky-200 bg-sky-50/70 hover:border-sky-300 hover:bg-sky-50',
    markerClassName: 'bg-sky-100 text-sky-700',
  },
  {
    action: 'clear-stale-mpv' as const,
    label: 'Clear stale mpv sessions',
    description: '古い再生セッションを削除します',
    marker: '●',
    cardClassName: 'border-indigo-200 bg-indigo-50/70 hover:border-indigo-300 hover:bg-indigo-50',
    markerClassName: 'bg-indigo-100 text-indigo-700',
  },
  {
    action: 'reconnect-cameras' as const,
    label: 'Reconnect all cameras',
    description: '全カメラへ再接続します',
    marker: '●',
    cardClassName: 'border-emerald-200 bg-emerald-50/70 hover:border-emerald-300 hover:bg-emerald-50',
    markerClassName: 'bg-emerald-100 text-emerald-700',
  },
  {
    action: 'export-diagnostics' as const,
    label: 'Export Diagnostics Bundle',
    description: '診断ログを出力します',
    marker: '●',
    cardClassName: 'border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-slate-50',
    markerClassName: 'bg-slate-200 text-slate-700',
  },
] as const;

export function SystemStatusPage() {
  const { t } = useI18n();
  const { demoMode } = useRuntimeConfig();
  const { data, loading, error, connected, refresh } = useSystemStatus();
  const cameras = data?.cameras ?? [];
  const vehicles = data?.gps.vehicles ?? [];
  useEffect(() => {
    console.info('[system-status] using webrtc status', {
      liveCameras: cameras.filter((camera) => camera.status === 'LIVE').length,
      totalCameras: cameras.length,
    });
  }, [cameras]);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runRecoveryAction = async (
    action: 'restart-api' | 'restart-desktop' | 'restart-mpv' | 'clear-stale-mpv' | 'reconnect-cameras' | 'export-diagnostics',
  ) => {
    if (actionBusy !== null) {
      return;
    }

    setActionBusy(action);
    setActionNotice(null);
    setActionError(null);

    try {
      const result = await window.electronAPI.runRecoveryAction(action);
      if (result.success) {
        setActionNotice(result.message);
        if (action !== 'restart-desktop') {
          await refresh();
        }
      } else {
        setActionError(result.message);
      }
    } catch (recoveryError) {
      setActionError(recoveryError instanceof Error ? recoveryError.message : '復旧操作に失敗しました。');
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <AppShell
      eyebrow={
        <span className="flex flex-wrap items-center gap-3">
          <span>{t('status.eyebrow')}</span>
          {demoMode ? <span className="rounded-full border border-amber-300 bg-amber-100 px-3 py-1 text-[12px] font-semibold text-amber-800">{t('common.demoMode')}</span> : null}
        </span>
      }
      title={t('status.title')}
      description={t('status.description')}
      actions={<OperationButton to="/" variant="secondary">{t('common.backToControl')}</OperationButton>}
    >
      {error ? (
        <EmptyState
          title="API 起動中 / 再接続中"
          description={error}
          tone="error"
        />
      ) : null}

      {data?.alerts.length ? (
        <EmptyState
          title="警告"
          description={
            <div className="space-y-1">
              {data.alerts.map((alert) => (
                <p key={alert}>{alert}</p>
              ))}
            </div>
          }
          tone="disconnected"
        />
      ) : null}

      {actionNotice ? <EmptyState title={actionNotice} tone="no-data" /> : null}
      {actionError ? <EmptyState title={actionError} tone="error" /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: 'API',
            status: data?.api.status ?? 'OFFLINE',
            value: data ? formatUptime(data.api.uptimeSec) : '読込中...',
          },
          {
            label: '受信機',
            status: data?.receiver.status ?? 'OFFLINE',
            value: data ? `${data.receiver.mode.toUpperCase()} ${data.receiver.port}` : '読込中...',
          },
          {
            label: 'データベース',
            status: data?.database.status ?? 'OFFLINE',
            value: formatTimestamp(data?.database.lastWriteAt ?? null),
          },
          {
            label: 'ポーリング',
            status: connected ? 'ONLINE' : loading ? 'DELAYED' : 'RECONNECTING',
            value: connected ? '2秒間隔で更新' : 'APIへ再接続中',
          },
        ].map((item) => (
          <OperationPanel key={item.label} className="p-5">
            <p className="text-[16px] font-medium text-slate-700">{item.label}</p>
            <div className="mt-3 flex items-center justify-between">
              <StatusBadge status={item.status as Parameters<typeof StatusBadge>[0]['status']} />
              <span className="text-[16px] text-slate-700">{item.value}</span>
            </div>
          </OperationPanel>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <OperationPanel className="p-5">
          <SectionHeader title="性能" />
          <div className="mt-3 grid gap-2 text-sm text-slate-700">
            <p>CPU {data?.performance.cpuUsagePct ?? 0}%</p>
            <p>Memory RSS {data?.performance.memoryRssMb ?? 0} MB</p>
            <p>Heap {data?.performance.memoryHeapMb ?? 0} MB</p>
            <p>Disk free {data?.performance.diskFreeMb ?? 'Unknown'} MB</p>
            <p>DB size {data?.performance.databaseSizeMb ?? 'Unknown'} MB</p>
            <p>mpv processes {data?.performance.mpvProcessCount ?? 0}</p>
            <p>GPU {data?.performance.gpuStatus ?? 'Unavailable'}</p>
          </div>
        </OperationPanel>

        <OperationPanel className="p-5">
          <SectionHeader title="監視状態" />
          <div className="mt-3 space-y-4 text-sm text-slate-700">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-slate-900">API ハートビート</p>
                <p>{formatTimestamp(data?.watchdog.api.lastSeenAt ?? null)}</p>
              </div>
              <StatusBadge status={data?.watchdog.api.status ?? 'OFFLINE'} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium text-slate-900">デスクトップ ハートビート</p>
                <p>{formatTimestamp(data?.watchdog.desktop.lastSeenAt ?? null)}</p>
              </div>
              <StatusBadge status={data?.watchdog.desktop.status ?? 'OFFLINE'} />
            </div>
            {data?.watchdog.desktop.recoveryRecommendation ? (
              <EmptyState title={data.watchdog.desktop.recoveryRecommendation} tone="no-data" className="py-3" />
            ) : null}
            {data?.watchdog.api.recoveryRecommendation ? (
              <EmptyState title={data.watchdog.api.recoveryRecommendation} tone="no-data" className="py-3" />
            ) : null}
          </div>
        </OperationPanel>

        <OperationPanel className="p-5">
          <SectionHeader title="保守情報" />
          <div className="mt-3 grid gap-2 text-sm text-slate-700">
            <p>GPS retention {data?.maintenance.gpsHistoryDays ?? 30} days</p>
            <p>Last cleanup {formatTimestamp(data?.maintenance.lastCleanupAt ?? null)}</p>
            <p>Diagnostics export writes under APP_DATA_DIR/diagnostics.</p>
          </div>
        </OperationPanel>
      </section>

      <OperationPanel>
        <SectionHeader title="復旧操作" description="サービスやカメラ再生を復旧する際に使用します。" />
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {recoveryActions.map((item) => (
            <OperationButton
              key={item.action}
              type="button"
              variant="secondary"
              onClick={() => void runRecoveryAction(item.action)}
              disabled={actionBusy !== null}
              className={`h-full min-h-[104px] justify-start rounded-2xl border p-0 text-left shadow-none transition-all duration-150 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60 ${item.cardClassName}`}
            >
              <div className="flex h-full w-full min-w-0 items-start gap-3 p-4">
                <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${item.markerClassName}`}>
                  {item.marker}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {actionBusy === item.action ? '実行中...' : item.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {item.description}
                  </p>
                </div>
              </div>
            </OperationButton>
          ))}
        </div>
      </OperationPanel>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_1.1fr_0.8fr]">
        <OperationPanel>
          <SectionHeader title="カメラ再生" actions={<span className="text-sm text-slate-600">{cameras.length} 台</span>} />
          <div className="mt-5 space-y-3">
            {cameras.length > 0 ? (
              cameras.map((camera) => (
                <div key={camera.cameraId} className="flex items-center justify-between rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-900">{camera.cameraName}</p>
                    <p className="text-sm text-slate-700">{camera.vehicleName}</p>
                    <p className="text-xs text-slate-500">Changed {formatTimestamp(camera.lastChangedAt)}</p>
                  </div>
                  <StatusBadge status={camera.status} />
                </div>
              ))
            ) : (
              <EmptyState title="カメラ状態はまだ記録されていません。" />
            )}
          </div>
        </OperationPanel>

        <OperationPanel>
          <SectionHeader title="車両 GPS" actions={<span className="text-sm text-slate-600">{vehicles.length} 台</span>} />
          <div className="mt-5 space-y-3">
            {vehicles.length > 0 ? (
              vehicles.map((vehicle) => (
                <div key={vehicle.vehicleId} className="flex items-center justify-between rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3">
                  <div>
                    <p className="font-medium text-slate-900">{vehicle.vehicleName}</p>
                    <p className="text-sm text-slate-700">{vehicle.ageSec}s old</p>
                    <p className="text-xs text-slate-500">Last update {formatTimestamp(vehicle.lastUpdateAt)}</p>
                  </div>
                  <StatusBadge status={vehicle.status} />
                </div>
              ))
            ) : (
              <EmptyState title="GPS データはまだ受信されていません。" />
            )}
          </div>
        </OperationPanel>

        <OperationPanel>
          <SectionHeader title="運用メモ" />
          <div className="mt-5 space-y-4 text-sm leading-6 text-slate-700">
            <p>この画面では、カメラ再生や GPS の状態変化を手動更新なしで確認できます。</p>
            <p>GPS は一定時間更新が止まると遅延・オフラインへ遷移し、地図の鮮度を知らせます。</p>
            <p>SQLite の保存状態も併せて確認できるため、保存障害の早期把握に役立ちます。</p>
            <p>API が一時停止しても画面は閉じず、再接続状態を維持します。</p>
            {data?.database.lastError ? <EmptyState title={data.database.lastError} tone="error" /> : null}
          </div>
        </OperationPanel>
      </section>
    </AppShell>
  );
}
