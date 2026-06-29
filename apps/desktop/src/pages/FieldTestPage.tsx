import { useEffect, useMemo, useState } from 'react';

import type { CameraSummary } from '../../electron/camera-types';
import { StatusBadge } from '../components/StatusBadge';
import { AppShell, EmptyState, OperationButton, OperationPanel, SectionHeader } from '../components/ui';
import { apiRequest } from '../lib/api';
import type { FieldTestItem, FieldTestItemStatus, FieldTestSession, SystemStatusSnapshot } from '../types';

type HistoryResponse = {
  sessions: FieldTestSession[];
};

type CurrentResponse = {
  session: FieldTestSession | null;
};

const checklistDescriptions: Record<string, string> = {
  Cameras: 'Confirm all configured RTSP feeds are live and visible to the operator.',
  GPS: 'Confirm GNSS updates are flowing and each vehicle is online.',
  Map: 'Confirm the live map is updating smoothly without large jumps or stalls.',
  'System Health': 'Confirm the health dashboard is clear and services recover cleanly.',
  'Operator Workflow': 'Confirm the operator can perform the core monitoring actions unaided.',
  Network: 'Confirm VPN/LTE connectivity is healthy at the field site.',
  Operator: 'Capture operator acceptance and handover notes.',
};

const formatTime = (value: string | null) => (value ? new Date(value).toLocaleString() : '未記録');

export function FieldTestPage() {
  const [currentSession, setCurrentSession] = useState<FieldTestSession | null>(null);
  const [history, setHistory] = useState<FieldTestSession[]>([]);
  const [systemStatus, setSystemStatus] = useState<SystemStatusSnapshot | null>(null);
  const [operatorName, setOperatorName] = useState('');
  const [sessionNotes, setSessionNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cameras, setCameras] = useState<CameraSummary[]>([]);

  const refresh = async () => {
    const [current, historyResult, status, cameraList] = await Promise.all([
      apiRequest<CurrentResponse>('/field-tests/current'),
      apiRequest<HistoryResponse>('/field-tests/history'),
      apiRequest<SystemStatusSnapshot>('/system/status'),
      window.electronAPI.listCameras(),
    ]);

    setCurrentSession(current.session);
    setHistory(historyResult.sessions);
    setSystemStatus(status);
    setCameras(cameraList);
    if (current.session) {
      setOperatorName(current.session.operatorName);
      setSessionNotes(current.session.notes ?? '');
    }
  };

  useEffect(() => {
    let disposed = false;

    const boot = async () => {
      try {
        await refresh();
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load field test state');
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void boot();
    const timer = window.setInterval(() => {
      void refresh().catch(() => {
        // Keep the page usable even if a refresh fails.
      });
    }, 3000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const groupedItems = useMemo(() => {
    if (!currentSession) {
      return [];
    }

    return Array.from(
      currentSession.items.reduce((map, item) => {
        const list = map.get(item.category) ?? [];
        list.push(item);
        map.set(item.category, list);
        return map;
      }, new Map<string, FieldTestItem[]>()),
    );
  }, [currentSession]);

  const startSession = async () => {
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<{ session: FieldTestSession }>('/field-tests/start', {
        method: 'POST',
        body: JSON.stringify({
          operatorName,
          notes: sessionNotes,
        }),
      });
      setCurrentSession(response.session);
      setNotice('現地試験セッションを開始しました。');
      await refresh();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Unable to start field test');
    }
  };

  const updateItem = async (itemId: string, status: FieldTestItemStatus, notes: string | null) => {
    setError(null);
    try {
      const response = await apiRequest<{ session: FieldTestSession }>(`/field-tests/items/${itemId}`, {
        method: 'PUT',
        body: JSON.stringify({
          status,
          notes: notes ?? undefined,
        }),
      });
      setCurrentSession(response.session);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Unable to update field test item');
    }
  };

  const finishSession = async (status: 'PASSED' | 'FAILED') => {
    if (!currentSession) {
      return;
    }

    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<{ session: FieldTestSession; reportPath: string }>('/field-tests/finish', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: currentSession.id,
          status,
          notes: sessionNotes,
        }),
      });
      setCurrentSession(response.session);
      setNotice(`現地試験を終了し、レポートを保存しました: ${response.reportPath}`);
      await refresh();
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : 'Unable to finish field test');
    }
  };

  const exportReport = async (sessionId: string) => {
    setError(null);
    setNotice(null);
    try {
      const response = await apiRequest<{ reportPath: string }>(`/field-tests/${sessionId}/export`, {
        method: 'POST',
      });
      setNotice(`現地試験レポートを出力しました: ${response.reportPath}`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Unable to export report');
    }
  };

  const firstCamera = cameras.find((camera) => camera.enabled);
  const redIssuesPresent =
    (systemStatus?.cameras.some((camera) => camera.status === 'OFFLINE') ?? false) ||
    (systemStatus?.gps.vehicles.some((vehicle) => vehicle.status === 'OFFLINE') ?? false) ||
    systemStatus?.receiver.status === 'ERROR' ||
    systemStatus?.database.status === 'ERROR';

  if (loading) {
    return (
      <AppShell className="px-6 py-8" containerClassName="max-w-5xl" headerless>
        <EmptyState title="現地試験画面を読み込んでいます..." tone="loading" />
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="現地試験"
      title="導入前の確認・引き渡しフロー"
      description="現地試験時に、カメラ、GPS、地図表示、システム状態、通信状況、運用引き継ぎを確認するための画面です。"
      actions={
        <>
          <OperationButton to="/" variant="secondary">操作画面へ戻る</OperationButton>
          <OperationButton to="/system-status" variant="secondary">システム状態</OperationButton>
        </>
      }
    >
      {error ? <EmptyState title={error} tone="error" /> : null}
      {notice ? <EmptyState title={notice} tone="no-data" /> : null}

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <OperationPanel className="rounded-[2rem]">
          <SectionHeader title="試験セッション" />
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm text-slate-700">担当者名</span>
              <input value={operatorName} onChange={(event) => setOperatorName(event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-700">メモ</span>
              <textarea value={sessionNotes} onChange={(event) => setSessionNotes(event.target.value)} rows={5} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600" />
            </label>
            <div className="flex flex-wrap gap-3">
              <OperationButton type="button" variant="primary" onClick={() => void startSession()} disabled={!operatorName.trim() || Boolean(currentSession?.status === 'RUNNING')}>
                {currentSession?.status === 'RUNNING' ? '実行中' : '現地試験を開始'}
              </OperationButton>
              {currentSession ? (
                <OperationButton type="button" variant="secondary" onClick={() => void exportReport(currentSession.id)}>
                  試験レポートを出力
                </OperationButton>
              ) : null}
            </div>
          </div>

          <OperationPanel className="mt-6 bg-slate-50 p-5 shadow-none">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm tracking-[0.18em] text-slate-600">現在状態</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">{currentSession ? currentSession.operatorName : '実行中のセッションはありません'}</p>
              </div>
              <StatusBadge status={currentSession?.status === 'RUNNING' ? 'DELAYED' : currentSession?.status ?? 'OFFLINE'} />
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-700">
              <p>開始: {formatTime(currentSession?.startedAt ?? null)}</p>
              <p>終了: {formatTime(currentSession?.endedAt ?? null)}</p>
              <p>状態: {redIssuesPresent ? '要確認の項目があります' : '重大な警告はありません'}</p>
            </div>
          </OperationPanel>

          <OperationPanel className="mt-6 bg-slate-50 p-5 shadow-none">
            <SectionHeader title="主要操作" />
            <div className="mt-4 flex flex-wrap gap-3">
              <OperationButton type="button" variant="primary" onClick={() => void window.electronAPI.openVideoWall()}>映像ウォール</OperationButton>
              <OperationButton type="button" variant="success" onClick={() => void window.electronAPI.openMap()}>地図</OperationButton>
              <OperationButton to="/system-status" variant="secondary">システム状態</OperationButton>
              <OperationButton
                type="button"
                variant="secondary"
                onClick={() => {
                  if (firstCamera) {
                    void window.electronAPI.openCameraWindow(firstCamera.id, `${firstCamera.vehicleName} / ${firstCamera.name}`);
                  }
                }}
                disabled={!firstCamera}
              >
                カメラ拡大表示
              </OperationButton>
            </div>
          </OperationPanel>

          <OperationPanel className="mt-6 bg-slate-50 p-5 shadow-none">
            <SectionHeader title="通信・運用確認" />
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              <p>VPN や現地回線が正常か、API へ接続できるか、LTE 品質が変動しても主要操作が継続できるかを確認します。</p>
              <p>担当者自身に映像ウォール、地図、拡大画面を操作してもらい、使い勝手の所見を記録します。</p>
              <p>現在の状態: API は {systemStatus?.api.status ?? 'OFFLINE'}、受信機は {systemStatus?.receiver.status ?? 'OFFLINE'}、警告は {redIssuesPresent ? 'あり' : 'なし'} です。</p>
            </div>
          </OperationPanel>
        </OperationPanel>

        <OperationPanel className="rounded-[2rem]">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-semibold text-slate-900">確認項目</h2>
            {currentSession ? (
              <div className="flex gap-3">
                <OperationButton type="button" variant="success" onClick={() => void finishSession('PASSED')}>合格で終了</OperationButton>
                <OperationButton type="button" variant="danger" onClick={() => void finishSession('FAILED')}>不合格で終了</OperationButton>
              </div>
            ) : null}
          </div>

          {currentSession ? (
            <div className="mt-5 space-y-5">
              {groupedItems.map(([category, items]) => (
                <OperationPanel key={category} className="bg-slate-50 p-5 shadow-none">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-semibold text-slate-900">{category}</h3>
                      <p className="mt-1 text-sm text-slate-700">{checklistDescriptions[category] ?? 'Acceptance item group'}</p>
                    </div>
                    <span className="text-xs tracking-[0.18em] text-slate-500">{items.length} 件</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {items.map((item) => (
                      <FieldTestItemCard key={item.id} item={item} onUpdate={updateItem} />
                    ))}
                  </div>
                </OperationPanel>
              ))}
            </div>
          ) : (
            <EmptyState title="現地試験を開始すると、既定の確認項目が作成されます。" className="mt-5 bg-slate-50" />
          )}
        </OperationPanel>
      </section>

      <OperationPanel className="rounded-[2rem]">
        <SectionHeader title="最近の履歴" actions={<OperationButton to="/settings" variant="secondary">設定</OperationButton>} />
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {history.map((session) => (
            <OperationPanel key={session.id} className="bg-slate-50 p-5 shadow-none">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-semibold text-slate-900">{session.operatorName}</p>
                  <p className="text-sm text-slate-700">{formatTime(session.startedAt)}</p>
                </div>
                <StatusBadge status={session.status === 'RUNNING' ? 'DELAYED' : session.status} />
              </div>
              <p className="mt-3 text-sm text-slate-700">{session.notes || '記録はありません。'}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>{session.items.filter((item) => item.status === 'PASSED').length} 件合格</span>
                <OperationButton type="button" variant="secondary" onClick={() => void exportReport(session.id)} className="min-h-10 px-3 py-2 text-sm">出力</OperationButton>
              </div>
            </OperationPanel>
          ))}
        </div>
      </OperationPanel>
    </AppShell>
  );
}

function FieldTestItemCard({
  item,
  onUpdate,
}: {
  item: FieldTestItem;
  onUpdate: (itemId: string, status: FieldTestItemStatus, notes: string | null) => Promise<void>;
}) {
  const [notes, setNotes] = useState(item.notes ?? '');

  useEffect(() => {
    setNotes(item.notes ?? '');
  }, [item.notes]);

  return (
    <OperationPanel className="bg-slate-50 p-4 shadow-none">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="font-medium text-slate-900">{item.label}</p>
          <p className="mt-1 text-xs text-slate-500">確認時刻: {formatTime(item.checkedAt)}</p>
        </div>
        <StatusBadge status={item.status === 'PENDING' ? 'DELAYED' : item.status} />
      </div>
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        rows={2}
        placeholder="メモ、LTE遅延、GPS遅延、担当者コメントなど"
        className="mt-3 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-sky-600"
      />
      <div className="mt-3 flex flex-wrap gap-3">
        <OperationButton type="button" variant="success" onClick={() => void onUpdate(item.id, 'PASSED', notes || null)} className="min-h-10 px-4 py-2 text-sm">合格</OperationButton>
        <OperationButton type="button" variant="danger" onClick={() => void onUpdate(item.id, 'FAILED', notes || null)} className="min-h-10 px-4 py-2 text-sm">不合格</OperationButton>
        <OperationButton type="button" variant="secondary" onClick={() => void onUpdate(item.id, 'PENDING', notes || null)} className="min-h-10 px-4 py-2 text-sm">保留</OperationButton>
      </div>
    </OperationPanel>
  );
}
