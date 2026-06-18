import { useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_PLACE_MARKER_ICON_ID,
  type PlaceMarkerInput,
} from '../../shared/place-markers';
import { PLACE_MARKER_ICONS, getPlaceMarkerIcon } from '../lib/place-marker-icons';
import type { PlaceMarker } from '../types';
import { EmptyState, OperationButton, OperationPanel, SectionHeader } from './ui';

type PlaceMarkerFormState = {
  id?: string;
  title: string;
  latitude: string;
  longitude: string;
  markerIconId: string;
  description: string;
};

type EditModalState =
  | { mode: 'create' }
  | { mode: 'edit' }
  | null;

const emptyForm: PlaceMarkerFormState = {
  title: '',
  latitude: '',
  longitude: '',
  markerIconId: DEFAULT_PLACE_MARKER_ICON_ID,
  description: '',
};

const parseError = (error: unknown) =>
  error instanceof Error ? error.message : '場所マーカーの処理に失敗しました。';

const formatCoordinate = (value: number) => value.toFixed(6);

function PlaceMarkerPreview({
  markerIconId,
  title,
}: {
  markerIconId: string;
  title?: string | undefined;
}) {
  const icon = getPlaceMarkerIcon(markerIconId);

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <img src={icon.src} alt={icon.label} className="h-12 w-12 rounded-2xl object-contain shadow-sm" />
      <div>
        <p className="text-sm font-semibold text-slate-900">{icon.label}</p>
        <p className="text-xs text-slate-500">{title?.trim() || 'プレビュー'}</p>
      </div>
    </div>
  );
}

export function PlaceMarkerManagerSection() {
  const [placeMarkers, setPlaceMarkers] = useState<PlaceMarker[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<EditModalState>(null);
  const [markerPoolOpen, setMarkerPoolOpen] = useState(false);
  const [form, setForm] = useState<PlaceMarkerFormState>(emptyForm);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [markerPickerValue, setMarkerPickerValue] = useState<string>(DEFAULT_PLACE_MARKER_ICON_ID);

  const refresh = async () => {
    const nextPlaceMarkers = await window.electronAPI.listPlaceMarkers();
    setPlaceMarkers(nextPlaceMarkers);
  };

  useEffect(() => {
    let disposed = false;

    const boot = async () => {
      try {
        const nextPlaceMarkers = await window.electronAPI.listPlaceMarkers();
        if (!disposed) {
          setPlaceMarkers(nextPlaceMarkers);
          setError(null);
        }
      } catch (loadError) {
        if (!disposed) {
          setError(parseError(loadError));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void boot();

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

  const sortedPlaceMarkers = useMemo(
    () =>
      placeMarkers
        .slice()
        .sort((left, right) => left.title.localeCompare(right.title, 'ja')),
    [placeMarkers],
  );

  const openCreateModal = () => {
    setError(null);
    setNotice(null);
    setValidationError(null);
    setForm(emptyForm);
    setMarkerPickerValue(DEFAULT_PLACE_MARKER_ICON_ID);
    setModal({ mode: 'create' });
  };

  const openEditModal = (placeMarker: PlaceMarker) => {
    setError(null);
    setNotice(null);
    setValidationError(null);
    setForm({
      id: placeMarker.id,
      title: placeMarker.title,
      latitude: String(placeMarker.latitude),
      longitude: String(placeMarker.longitude),
      markerIconId: placeMarker.markerIconId,
      description: placeMarker.description ?? '',
    });
    setMarkerPickerValue(placeMarker.markerIconId);
    setModal({ mode: 'edit' });
  };

  const closeModal = () => {
    setModal(null);
    setMarkerPoolOpen(false);
    setValidationError(null);
    setForm(emptyForm);
    setMarkerPickerValue(DEFAULT_PLACE_MARKER_ICON_ID);
  };

  const validateForm = () => {
    const title = form.title.trim();
    if (!title) {
      return '場所名を入力してください。';
    }

    const latitude = Number(form.latitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return '緯度は -90 から 90 の範囲で入力してください。';
    }

    const longitude = Number(form.longitude);
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return '経度は -180 から 180 の範囲で入力してください。';
    }

    if (!PLACE_MARKER_ICONS.some((item) => item.id === form.markerIconId)) {
      return 'マーカーを選択してください。';
    }

    return null;
  };

  const savePlaceMarker = async () => {
    const validationMessage = validateForm();
    if (validationMessage) {
      setValidationError(validationMessage);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    setValidationError(null);

    const payload: PlaceMarkerInput = {
      title: form.title.trim(),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      markerIconId: getPlaceMarkerIcon(form.markerIconId).id,
      description: form.description.trim() ? form.description.trim() : undefined,
    };

    try {
      if (form.id) {
        await window.electronAPI.updatePlaceMarker({
          id: form.id,
          ...payload,
        });
        setNotice('場所マーカーを更新しました。');
      } else {
        await window.electronAPI.createPlaceMarker(payload);
        setNotice('場所マーカーを登録しました。');
      }

      await refresh();
      closeModal();
    } catch (saveError) {
      setError(parseError(saveError));
    } finally {
      setSaving(false);
    }
  };

  const deletePlaceMarker = async (placeMarker: PlaceMarker) => {
    const confirmed = window.confirm(`「${placeMarker.title}」を削除しますか？`);
    if (!confirmed) {
      return;
    }

    setDeletingId(placeMarker.id);
    setError(null);
    setNotice(null);

    try {
      await window.electronAPI.deletePlaceMarker(placeMarker.id);
      await refresh();
      setNotice('場所マーカーを削除しました。');
    } catch (deleteError) {
      setError(parseError(deleteError));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <>
      <OperationPanel className="rounded-[2rem] p-5">
        <div className="flex items-center justify-between gap-4">
          <SectionHeader
            title="場所マーカー管理"
            actions={<span className="text-sm text-slate-500">{sortedPlaceMarkers.length} 件</span>}
          />
          <OperationButton
            type="button"
            variant="primary"
            onClick={openCreateModal}
            className="min-h-10 px-4 py-2 text-sm"
          >
            + 新しい場所を追加
          </OperationButton>
        </div>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          地図上に表示する場所マーカーを登録・編集します。
        </p>

        {error ? (
          <div className="mt-4">
            <EmptyState title={error} tone="error" className="px-4 py-3" />
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4">
            <EmptyState title={notice} tone="no-data" className="px-4 py-3" />
          </div>
        ) : null}

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50">
          <div className="hidden grid-cols-[1.3fr_0.9fr_0.9fr_0.8fr_auto] gap-3 border-b border-slate-200 px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 lg:grid">
            <span>場所名</span>
            <span>緯度</span>
            <span>経度</span>
            <span>マーカー</span>
            <span>操作</span>
          </div>

          {loading ? (
            <div className="p-6">
              <EmptyState title="場所マーカーを読み込んでいます..." tone="loading" />
            </div>
          ) : sortedPlaceMarkers.length === 0 ? (
            <div className="p-6">
              <EmptyState title="まだ場所マーカーは登録されていません。" tone="no-data" />
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {sortedPlaceMarkers.map((placeMarker) => {
                const icon = getPlaceMarkerIcon(placeMarker.markerIconId);
                return (
                  <div
                    key={placeMarker.id}
                    className="grid gap-3 px-4 py-4 lg:grid-cols-[1.3fr_0.9fr_0.9fr_0.8fr_auto] lg:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{placeMarker.title}</p>
                      {placeMarker.description ? (
                        <p className="mt-1 truncate text-xs text-slate-500">{placeMarker.description}</p>
                      ) : null}
                    </div>
                    <p className="text-sm text-slate-700">{formatCoordinate(placeMarker.latitude)}</p>
                    <p className="text-sm text-slate-700">{formatCoordinate(placeMarker.longitude)}</p>
                    <div className="flex items-center gap-3">
                      <img src={icon.src} alt={icon.label} className="h-10 w-10 rounded-2xl object-contain shadow-sm" />
                      <span className="text-sm text-slate-700">{icon.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <OperationButton
                        type="button"
                        variant="secondary"
                        onClick={() => openEditModal(placeMarker)}
                        className="min-h-9 px-3 py-2 text-sm"
                      >
                        編集
                      </OperationButton>
                      <OperationButton
                        type="button"
                        variant="danger"
                        onClick={() => void deletePlaceMarker(placeMarker)}
                        disabled={deletingId === placeMarker.id}
                        className="min-h-9 px-3 py-2 text-sm"
                      >
                        削除
                      </OperationButton>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </OperationPanel>

      <OverlayModal
        open={modal !== null}
        title={modal?.mode === 'edit' ? '場所マーカーを編集' : '新しい場所マーカー'}
        description="地図上に表示する場所名・座標・マーカーを設定します。"
        onClose={closeModal}
        footer={
          <>
            <OperationButton type="button" onClick={closeModal} variant="secondary">
              キャンセル
            </OperationButton>
            <OperationButton type="button" onClick={() => void savePlaceMarker()} disabled={saving} variant="primary">
              {saving ? '保存中...' : '保存'}
            </OperationButton>
          </>
        }
      >
        {validationError ? <EmptyState title={validationError} tone="error" className="px-4 py-3" /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">場所名</span>
            <input
              value={form.title}
              onChange={(event) => {
                setValidationError(null);
                setForm((current) => ({ ...current, title: event.target.value }));
              }}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
            />
          </label>

          <div className="block">
            <span className="mb-2 block text-sm text-slate-300">マーカー</span>
            <div className="space-y-3">
              <PlaceMarkerPreview markerIconId={form.markerIconId} title={form.title} />
              <OperationButton
                type="button"
                variant="secondary"
                onClick={() => {
                  setMarkerPickerValue(getPlaceMarkerIcon(form.markerIconId).id);
                  setMarkerPoolOpen(true);
                }}
                className="min-h-10 px-4 py-2 text-sm"
              >
                マーカーを選択
              </OperationButton>
            </div>
          </div>

          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">緯度</span>
            <input
              value={form.latitude}
              onChange={(event) => {
                setValidationError(null);
                setForm((current) => ({ ...current, latitude: event.target.value }));
              }}
              placeholder="35.000000"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">経度</span>
            <input
              value={form.longitude}
              onChange={(event) => {
                setValidationError(null);
                setForm((current) => ({ ...current, longitude: event.target.value }));
              }}
              placeholder="139.000000"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-2 block text-sm text-slate-300">メモ</span>
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              rows={4}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
            />
          </label>
        </div>
      </OverlayModal>

      <OverlayModal
        open={markerPoolOpen}
        title="マーカーを選択"
        description="地図上に表示するマーカーを選んでください。"
        onClose={() => setMarkerPoolOpen(false)}
        footer={
          <>
            <OperationButton type="button" onClick={() => setMarkerPoolOpen(false)} variant="secondary">
              キャンセル
            </OperationButton>
            <OperationButton
              type="button"
              onClick={() => {
                setValidationError(null);
                setForm((current) => ({ ...current, markerIconId: getPlaceMarkerIcon(markerPickerValue).id }));
                setMarkerPoolOpen(false);
              }}
              variant="primary"
            >
              決定
            </OperationButton>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLACE_MARKER_ICONS.map((icon) => {
            const selected = markerPickerValue === icon.id;
            return (
              <button
                key={icon.id}
                type="button"
                onClick={() => setMarkerPickerValue(icon.id)}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  selected ? 'border-sky-500 bg-sky-50 ring-2 ring-sky-200' : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <img src={icon.src} alt={icon.label} className="h-12 w-12 rounded-2xl object-contain shadow-sm" />
                  <div>
                    <p className="font-semibold text-slate-900">{icon.label}</p>
                    <p className="text-xs text-slate-500">{icon.id}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </OverlayModal>
    </>
  );
}

function OverlayModal({
  open,
  title,
  description,
  children,
  footer,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 px-4 py-6" onClick={onClose}>
      <div className="w-full max-w-3xl" onClick={(event) => event.stopPropagation()}>
        <OperationPanel className="rounded-[2rem] border border-slate-700 bg-slate-900 p-0 text-slate-100 shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-300">設定</p>
              <h2 className="mt-2 text-2xl font-semibold text-white">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-700"
            >
              閉じる
            </button>
          </div>
          <div className="max-h-[min(78vh,52rem)] overflow-y-auto px-6 py-5">{children}</div>
          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-800 px-6 py-5">{footer}</div>
        </OperationPanel>
      </div>
    </div>
  );
}
