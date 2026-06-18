import { useEffect, useState } from 'react';

import { AppShell, EmptyState, OperationButton, OperationPanel, SectionHeader } from '../components/ui';
import { apiRequest, getReadableApiError } from '../lib/api';
import type { DailyRouteReport, VehicleAdmin } from '../types';

const japanDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const formatJapanDateKey = (date: Date) => {
  const parts = japanDateFormatter.formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
};

const formatLocalTimestamp = (value: string | null) => {
  if (!value) {
    return '-';
  }

  return new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
};

const formatMinutes = (minutes: number) => `${minutes} 分`;

const summaryCards = (report: DailyRouteReport) => [
  { label: '走行距離', value: `${report.distanceKm.toFixed(2)} km` },
  { label: '稼働時間', value: formatMinutes(report.operationMinutes) },
  { label: '停止回数', value: `${report.stopCount} 回` },
  { label: '最長停止', value: formatMinutes(report.longestStopMinutes) },
  { label: 'GPS欠損時間', value: formatMinutes(report.gpsGapMinutes) },
];

export function DailyReportPage() {
  const [vehicles, setVehicles] = useState<VehicleAdmin[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState(() => formatJapanDateKey(new Date()));
  const [reports, setReports] = useState<DailyRouteReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadVehicles = async () => {
      try {
        const list = await window.electronAPI.listVehicles();
        if (!cancelled) {
          setVehicles(list.filter((vehicle) => vehicle.enabled));
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(getReadableApiError(nextError));
        }
      }
    };

    void loadVehicles();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadReports = async () => {
      setLoading(true);
      setError(null);

      try {
        if (selectedVehicleId === 'all') {
          const body = await apiRequest<{ date: string; reports: DailyRouteReport[] }>(`/api/vehicles/daily-reports?date=${selectedDate}`);
          if (!cancelled) {
            setReports(body.reports);
          }
          return;
        }

        const body = await apiRequest<{ report: DailyRouteReport }>(`/api/vehicles/${selectedVehicleId}/daily-report?date=${selectedDate}`);
        if (!cancelled) {
          setReports([body.report]);
        }
      } catch (nextError) {
        if (!cancelled) {
          setReports([]);
          setError(getReadableApiError(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadReports();
    return () => {
      cancelled = true;
    };
  }, [selectedDate, selectedVehicleId]);

  return (
    <AppShell
      eyebrow="Daily GPS Report"
      title="日次車両レポート"
      description="2台運用向けに、日別の走行距離・稼働時間・停止情報をすぐ確認できるシンプルな画面です。"
      actions={<OperationButton to="/">ダッシュボードへ戻る</OperationButton>}
    >
      <OperationPanel>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
              日付
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-700">
              車両
              <select
                value={selectedVehicleId}
                onChange={(event) => setSelectedVehicleId(event.target.value)}
                className="rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
              >
                <option value="all">全車両</option>
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            レポート日: <span className="font-semibold text-slate-900">{selectedDate}</span>
          </div>
        </div>
      </OperationPanel>

      {error ? <OperationPanel><p className="text-sm font-medium text-rose-700">{error}</p></OperationPanel> : null}

      {loading ? (
        <OperationPanel>
          <p className="text-sm text-slate-600">レポートを読み込み中です...</p>
        </OperationPanel>
      ) : null}

      {!loading && reports.length === 0 ? (
        <OperationPanel>
          <EmptyState title="該当日のGPSデータがありません" description="日付または車両を変更して確認してください。" />
        </OperationPanel>
      ) : null}

      {!loading
        ? reports.map((report) => (
            <OperationPanel key={report.vehicleId}>
              <SectionHeader
                title={report.vehicleName}
                actions={<span className="text-sm text-slate-500">{report.pointCount} 点</span>}
              />

              <div className="mt-5 grid gap-3 md:grid-cols-5">
                {summaryCards(report).map((card) => (
                  <div key={card.label} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <p className="text-sm text-slate-600">{card.label}</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-900">{card.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                  <p className="text-slate-600">最初の受信</p>
                  <p className="mt-1 font-semibold text-slate-900">{formatLocalTimestamp(report.firstReceivedAt)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                  <p className="text-slate-600">最後の受信</p>
                  <p className="mt-1 font-semibold text-slate-900">{formatLocalTimestamp(report.lastReceivedAt)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                  <p className="text-slate-600">停止一覧</p>
                  <p className="mt-1 font-semibold text-slate-900">{report.stops.length} 件</p>
                </div>
              </div>

              <div className="mt-5">
                <SectionHeader title="停止一覧" />
                {report.stops.length === 0 ? (
                  <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                    条件を満たす停止はありませんでした。
                  </div>
                ) : (
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {report.stops.map((stop, index) => (
                      <div key={`${stop.startAt}-${stop.endAt}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-semibold text-slate-900">停止 {index + 1}</p>
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">{formatMinutes(stop.durationMinutes)}</span>
                        </div>
                        <p className="mt-2">開始: <span className="font-medium text-slate-900">{formatLocalTimestamp(stop.startAt)}</span></p>
                        <p>終了: <span className="font-medium text-slate-900">{formatLocalTimestamp(stop.endAt)}</span></p>
                        <p className="mt-2 text-xs text-slate-500">
                          {stop.latitude.toFixed(6)}, {stop.longitude.toFixed(6)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </OperationPanel>
          ))
        : null}
    </AppShell>
  );
}
