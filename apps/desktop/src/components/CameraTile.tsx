import type { ReactNode } from 'react';

import type { CameraSessionState, CameraSummary } from '../../electron/camera-types';

type CameraTileProps = {
  slotIndex: number;
  camera: CameraSummary | null;
  status: CameraSessionState | undefined;
  isFullscreen: boolean;
  onToggleFullscreen: (cameraId: string | null) => void;
  onReconnect: (cameraId: string) => void;
  videoContainerRef?: ((node: HTMLDivElement | null) => void) | undefined;
  videoContent?: ReactNode;
  debugOverlay?: string | null | undefined;
};

const statusToneClasses = {
  live: 'bg-emerald-500',
  offline: 'bg-rose-500',
  connecting: 'bg-amber-500',
  disabled: 'bg-slate-400',
} as const;

function getStatusMeta(camera: CameraSummary | null, status: CameraSessionState | undefined) {
  if (!camera) {
    return {
      indicatorClassName: statusToneClasses.disabled,
      label: '未設定',
      overlayTitle: 'カメラ未設定',
      overlayMessage: null as string | null,
      showReconnect: false,
    };
  }

  if (!camera.enabled) {
    return {
      indicatorClassName: statusToneClasses.disabled,
      label: '停止中',
      overlayTitle: '停止中',
      overlayMessage: null as string | null,
      showReconnect: false,
    };
  }

  const effectiveStatus =
    status?.processState === 'running'
      ? 'LIVE'
      : status?.processState === 'starting'
        ? 'RECONNECTING'
        : status?.status;

  switch (effectiveStatus) {
    case 'LIVE':
      return {
        indicatorClassName: statusToneClasses.live,
        label: 'LIVE',
        overlayTitle: null as string | null,
        overlayMessage: null as string | null,
        showReconnect: false,
      };
    case 'RECONNECTING':
      return {
        indicatorClassName: statusToneClasses.connecting,
        label: '接続中',
        overlayTitle: '接続中',
        overlayMessage: status?.message ?? (status?.processState === 'starting' ? 'Connecting to RTSP stream...' : null),
        showReconnect: false,
      };
    case 'OFFLINE':
    default:
      return {
        indicatorClassName: statusToneClasses.offline,
        label: '通信エラー',
        overlayTitle: '通信エラー',
        overlayMessage: status?.message ?? null,
        showReconnect: true,
      };
  }
}

export function CameraTile({
  slotIndex,
  camera,
  status,
  isFullscreen,
  onToggleFullscreen,
  onReconnect,
  videoContainerRef,
  videoContent,
  debugOverlay,
}: CameraTileProps) {
  const statusMeta = getStatusMeta(camera, status);
  const canToggle = Boolean(camera?.enabled);
  const cameraLabel = camera ? `${camera.vehicleName} > ${camera.name}` : `スロット ${slotIndex}`;

  return (
    <article
      onDoubleClick={() => {
        if (canToggle) {
          onToggleFullscreen(camera?.id ?? null);
        }
      }}
      className={`relative flex h-full min-h-0 flex-col overflow-hidden border border-slate-400 bg-slate-700 ${canToggle ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
        {videoContent ? videoContent : <div ref={videoContainerRef} className="absolute inset-0 h-full w-full overflow-hidden" />}

        {!camera || statusMeta.overlayTitle ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-500 text-slate-50">
            <div className="px-6 text-center">
              <p className="text-3xl font-bold tracking-wide">{statusMeta.overlayTitle ?? 'カメラ未設定'}</p>
              {statusMeta.overlayMessage ? (
                <p className="mt-3 text-sm font-medium text-slate-100">{statusMeta.overlayMessage}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {debugOverlay ? (
          <div className="pointer-events-none absolute left-2 top-2 z-20 rounded border border-slate-300 bg-white px-2 py-1 text-[10px] text-slate-700">
            {debugOverlay}
          </div>
        ) : null}
      </div>

      <div className="flex h-8 items-center justify-between gap-2 border-t border-slate-500 bg-slate-800 px-2 text-[13px] text-white">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-3 w-3 flex-none rounded-full ${statusMeta.indicatorClassName}`} />
          <span className="flex-none font-semibold">{statusMeta.label}</span>
          <span className="truncate">{cameraLabel}</span>
        </div>

        <div className="flex flex-none items-center gap-1">
          {camera && statusMeta.showReconnect ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onReconnect(camera.id);
              }}
              className="inline-flex min-h-7 items-center justify-center rounded border border-rose-300 bg-white px-2 text-[12px] font-semibold text-rose-700"
            >
              再接続
            </button>
          ) : null}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (canToggle) {
                onToggleFullscreen(camera?.id ?? null);
              }
            }}
            disabled={!canToggle}
            className="inline-flex min-h-7 items-center justify-center rounded border border-slate-300 bg-white px-2 text-[12px] font-semibold text-slate-900 disabled:cursor-default disabled:opacity-50"
          >
            {isFullscreen ? '戻る' : '拡大'}
          </button>
        </div>
      </div>
    </article>
  );
}
