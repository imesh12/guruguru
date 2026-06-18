import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import type { CameraSessionState, CameraSummary, RelativeBounds } from '../../electron/camera-types';
import { StatusBadge } from '../components/StatusBadge';
import { AppShell, EmptyState, OperationButton, OperationPanel, SectionHeader } from '../components/ui';

const FOCUS_SYNC_INTERVAL = 1200;

export function CameraPlayerPage() {
  const { cameraId } = useParams<{ cameraId: string }>();
  const [camera, setCamera] = useState<CameraSummary | null>(null);
  const [statuses, setStatuses] = useState<CameraSessionState[]>([]);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!cameraId) {
      return;
    }

    let disposed = false;

    const syncCamera = async () => {
      try {
        const [cameraList, initialStatuses] = await Promise.all([window.electronAPI.listCameras(), window.electronAPI.listCameraStatuses()]);
        if (disposed) {
          return;
        }

        const nextCamera = cameraList.find((entry) => entry.id === cameraId) ?? null;
        setCamera(nextCamera);
        setStatuses(initialStatuses);
        if (!nextCamera || !nextCamera.enabled) {
          void window.electronAPI.stopSession(`focus:${cameraId}`);
        }
      } catch (err) {
        console.error('Failed to sync camera details', err);
      }
    };

    void syncCamera();

    const unsubscribe = window.electronAPI.onCameraStatusChanged((nextStatuses: CameraSessionState[]) => {
      if (!disposed) {
        setStatuses(nextStatuses);
      }
    });
    const refreshTimer = window.setInterval(() => {
      void syncCamera();
    }, 2000);

    return () => {
      disposed = true;
      unsubscribe();
      window.clearInterval(refreshTimer);
      void window.electronAPI.stopSession(`focus:${cameraId}`);
    };
  }, [cameraId]);

  useEffect(() => {
    if (!cameraId || !camera) {
      return;
    }

    const syncFocus = () => {
      const element = frameRef.current;
      if (!element) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const bounds: RelativeBounds = {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      };

      void window.electronAPI.syncCameraLayout({
        cameraId,
        surface: 'focus',
        bounds,
      });
    };

    const interval = window.setInterval(syncFocus, FOCUS_SYNC_INTERVAL);
    const timeout = window.setTimeout(syncFocus, 120);
    window.addEventListener('resize', syncFocus);

    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
      window.removeEventListener('resize', syncFocus);
    };
  }, [camera, cameraId]);

  const status = useMemo(
    () => statuses.find((entry) => entry.sessionId === `focus:${cameraId}`),
    [cameraId, statuses],
  );

  if (!cameraId || !camera) {
    return (
      <AppShell className="px-6 py-8" containerClassName="max-w-5xl" headerless>
        <EmptyState title="カメラ設定が見つかりません。" tone="error" />
      </AppShell>
    );
  }

  return (
    <AppShell
      className="px-6 py-6"
      containerClassName="flex h-[calc(100vh-3rem)] max-w-[1600px] flex-col gap-6"
      eyebrow={camera.vehicleName}
      title={camera.name}
      actions={
        <>
          <StatusBadge status={status?.status ?? 'OFFLINE'} />
          <OperationButton type="button" variant="primary" onClick={() => void window.electronAPI.restartCamera(camera.id)}>
            再接続
          </OperationButton>
          <OperationButton type="button" variant="danger" onClick={() => void window.electronAPI.stopSession(`focus:${camera.id}`)}>
            停止
          </OperationButton>
        </>
      }
    >
      <section className="grid flex-1 gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        <div
          ref={frameRef}
          className="relative min-h-[32rem] overflow-hidden rounded-[2rem] border border-slate-300 bg-white"
        >
          <div className="relative flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm tracking-[0.18em] text-slate-600">フォーカス表示</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">この領域にカメラ映像を表示します</p>
              <p className="mt-2 text-sm text-slate-700">
                {status?.message ? status.message : 'この画面では対象カメラを拡大表示します。'}
              </p>
            </div>
          </div>
        </div>

        <OperationPanel className="rounded-[2rem]">
          <SectionHeader title="カメラ情報" />
          <div className="mt-5 space-y-4 text-sm text-slate-700">
            <p>種別: {camera.type}</p>
            <p>ベンダー: {camera.vendor}</p>
            <p>RTSP URL: {camera.rtspUrl ?? '未設定'}</p>
            <p>最終更新: {status ? new Date(status.updatedAt).toLocaleTimeString() : '未開始'}</p>
          </div>
        </OperationPanel>
      </section>
    </AppShell>
  );
}
