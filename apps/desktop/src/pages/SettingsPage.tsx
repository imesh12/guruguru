import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { PlaceMarkerManagerSection } from '../components/PlaceMarkerManagerSection';
import { AppShell, EmptyState, OperationButton, OperationPanel, SectionHeader } from '../components/ui';
import type { CameraAdmin, LayoutAdmin, VehicleAdmin } from '../types';

type VehicleFormState = {
  id?: string;
  name: string;
  displayColor: string;
  enabled: boolean;
};

type CameraFormState = {
  id?: string;
  vehicleId: string;
  name: string;
  type: 'FRONT' | 'INTERNAL';
  vendor: 'AXIS' | 'HIKVISION' | 'CUSTOM';
  host: string;
  rtspPort: string;
  customRtspUrl: string;
  qualityPreset: 'LOW' | 'STANDARD' | 'HIGH';
  username: string;
  password: string;
  hasSavedPassword: boolean;
  enabled: boolean;
  bitrateLimit: string;
};

type CameraTestState = {
  success: boolean;
  message: string;
} | null;

type ResolvedRtspPreview = {
  rtspUrl: string | null;
  sanitizedRtspUrl: string | null;
  error: string | null;
  source: 'custom' | 'vendor';
};

type LayoutFormState = {
  id?: string;
  name: string;
  slots: Array<{
    slotIndex: number;
    cameraId: string;
  }>;
};

type SettingsModalState =
  | { kind: 'vehicle'; mode: 'create' | 'edit' }
  | { kind: 'camera'; mode: 'create' | 'edit' }
  | { kind: 'layout'; mode: 'create' | 'edit' }
  | null;

const emptyVehicleForm: VehicleFormState = {
  name: '',
  displayColor: '#ef4444',
  enabled: true,
};

const emptyCameraForm: CameraFormState = {
  vehicleId: '',
  name: '',
  type: 'FRONT',
  vendor: 'AXIS',
  host: '',
  rtspPort: '554',
  customRtspUrl: '',
  qualityPreset: 'STANDARD',
  username: '',
  password: '',
  hasSavedPassword: false,
  enabled: true,
  bitrateLimit: '',
};

const emptyLayoutForm = (): LayoutFormState => ({
  name: '',
  slots: [1, 2, 3, 4].map((slotIndex) => ({
    slotIndex,
    cameraId: '',
  })),
});

const qualityPresetDescriptions: Record<CameraFormState['qualityPreset'], string> = {
  LOW: '640x360 / 8fps / compression 45',
  STANDARD: '1024x576 / 10fps / compression 35',
  HIGH: '1280x720 / 15fps / compression 30',
};

const trimToNull = (value: string) => {
  const normalized = value.trim();
  return normalized ? normalized : null;
};

const parseError = (error: unknown) => {
  return error instanceof Error ? error.message : 'Unexpected settings error.';
};

const buildLayoutForm = (layout: LayoutAdmin): LayoutFormState => ({
  id: layout.id,
  name: layout.name,
  slots: [1, 2, 3, 4].map((slotIndex) => ({
    slotIndex,
    cameraId: layout.slots.find((slot) => slot.slotIndex === slotIndex)?.cameraId ?? '',
  })),
});

const formatLayoutSlotSummary = (layout: LayoutAdmin) =>
  layout.slots
    .slice()
    .sort((left, right) => left.slotIndex - right.slotIndex)
    .map((slot) => `S${slot.slotIndex}: ${slot.vehicleName ? `${slot.vehicleName} / ${slot.cameraType} / ${slot.cameraName}` : '未設定'}`)
    .join('  ');

export function SettingsPage() {
  const [vehicles, setVehicles] = useState<VehicleAdmin[]>([]);
  const [cameras, setCameras] = useState<CameraAdmin[]>([]);
  const [layouts, setLayouts] = useState<LayoutAdmin[]>([]);
  const [activeLayoutId, setActiveLayoutId] = useState<string | null>(null);
  const [vehicleForm, setVehicleForm] = useState<VehicleFormState>(emptyVehicleForm);
  const [cameraForm, setCameraForm] = useState<CameraFormState>(emptyCameraForm);
  const [layoutForm, setLayoutForm] = useState<LayoutFormState>(emptyLayoutForm);
  const [modal, setModal] = useState<SettingsModalState>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [cameraTest, setCameraTest] = useState<CameraTestState>(null);
  const [rtspPreview, setRtspPreview] = useState<ResolvedRtspPreview | null>(null);
  const [savingVehicle, setSavingVehicle] = useState(false);
  const [savingCamera, setSavingCamera] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [activatingLayout, setActivatingLayout] = useState(false);
  const [testingCamera, setTestingCamera] = useState(false);
  const [vehicleValidationError, setVehicleValidationError] = useState<string | null>(null);
  const [cameraValidationError, setCameraValidationError] = useState<string | null>(null);
  const [layoutValidationError, setLayoutValidationError] = useState<string | null>(null);

  const refresh = async () => {
    const [vehicleList, cameraList, layoutList, activeLayout] = await Promise.all([
      window.electronAPI.listVehicles(),
      window.electronAPI.listCameras(),
      window.electronAPI.listLayouts(),
      window.electronAPI.getActiveLayout(),
    ]);
    setVehicles(vehicleList);
    setCameras(cameraList);
    setLayouts(layoutList);
    setActiveLayoutId(activeLayout?.id ?? null);
  };

  useEffect(() => {
    let disposed = false;

    const boot = async () => {
      try {
        await refresh();
        if (!disposed) {
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

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (modal?.kind !== 'camera') {
      return;
    }

    const host = cameraForm.vendor === 'CUSTOM' ? null : trimToNull(cameraForm.host);
    const customRtspUrl = cameraForm.vendor === 'CUSTOM' ? trimToNull(cameraForm.customRtspUrl) : null;

    if (!host && !customRtspUrl) {
      setRtspPreview(null);
      return;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      void window.electronAPI
        .resolveRtsp({
          vendor: cameraForm.vendor,
          host,
          rtspPort: cameraForm.vendor === 'CUSTOM' ? null : (cameraForm.rtspPort.trim() ? Number(cameraForm.rtspPort) : null),
          customRtspUrl,
          qualityPreset: cameraForm.qualityPreset,
          username: trimToNull(cameraForm.username),
          password: trimToNull(cameraForm.password),
        })
        .then((preview) => {
          if (!disposed) {
            setRtspPreview(preview);
          }
        })
        .catch(() => {
          if (!disposed) {
            setRtspPreview(null);
          }
        });
    }, 200);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [cameraForm, modal]);

  const activeLayout = useMemo(
    () => layouts.find((layout) => layout.id === activeLayoutId) ?? null,
    [activeLayoutId, layouts],
  );

  const vehicleNameTrimmed = vehicleForm.name.trim();
  const cameraNameTrimmed = cameraForm.name.trim();
  const layoutNameTrimmed = layoutForm.name.trim();
  const hasCameraRtspInput =
    cameraForm.vendor === 'CUSTOM' ? cameraForm.customRtspUrl.trim().length > 0 : cameraForm.host.trim().length > 0;
  const isVehicleFormValid = vehicleNameTrimmed.length > 0;
  const isCameraFormValid = cameraNameTrimmed.length > 0 && cameraForm.vehicleId.length > 0 && hasCameraRtspInput;
  const isLayoutFormValid = layoutNameTrimmed.length > 0;
  const cameraVehicleName = useMemo(
    () => vehicles.find((vehicle) => vehicle.id === cameraForm.vehicleId)?.name ?? '車両を選択してください',
    [cameraForm.vehicleId, vehicles],
  );

  const closeModal = () => {
    setModal(null);
    setVehicleValidationError(null);
    setCameraValidationError(null);
    setLayoutValidationError(null);
    setCameraTest(null);
  };

  const openCreateVehicleModal = () => {
    setError(null);
    setVehicleForm(emptyVehicleForm);
    setVehicleValidationError(null);
    setModal({ kind: 'vehicle', mode: 'create' });
  };

  const openEditVehicleModal = (vehicle: VehicleAdmin) => {
    setError(null);
    setVehicleValidationError(null);
    setVehicleForm({
      id: vehicle.id,
      name: vehicle.name,
      displayColor: vehicle.displayColor,
      enabled: vehicle.enabled,
    });
    setModal({ kind: 'vehicle', mode: 'edit' });
  };

  const openCreateCameraModal = () => {
    setError(null);
    setCameraForm({
      ...emptyCameraForm,
      vehicleId: vehicles[0]?.id ?? '',
    });
    setShowPassword(false);
    setCameraTest(null);
    setRtspPreview(null);
    setCameraValidationError(null);
    setModal({ kind: 'camera', mode: 'create' });
  };

  const openEditCameraModal = (camera: CameraAdmin) => {
    setError(null);
    setCameraValidationError(null);
    setCameraForm({
      id: camera.id,
      vehicleId: camera.vehicleId,
      name: camera.name,
      type: camera.type,
      vendor: camera.vendor,
      host: camera.host ?? '',
      rtspPort: camera.rtspPort ? String(camera.rtspPort) : '554',
      customRtspUrl: camera.customRtspUrl ?? '',
      qualityPreset: camera.qualityPreset,
      username: camera.username ?? '',
      password: '',
      hasSavedPassword: camera.hasSavedPassword,
      enabled: camera.enabled,
      bitrateLimit: camera.bitrateLimit ? String(camera.bitrateLimit) : '',
    });
    setShowPassword(false);
    setCameraTest(null);
    setRtspPreview(null);
    setModal({ kind: 'camera', mode: 'edit' });
  };

  const openCreateLayoutModal = () => {
    setError(null);
    setLayoutValidationError(null);
    setLayoutForm(emptyLayoutForm());
    setModal({ kind: 'layout', mode: 'create' });
  };

  const openEditLayoutModal = (layout: LayoutAdmin) => {
    setError(null);
    setLayoutValidationError(null);
    setLayoutForm(buildLayoutForm(layout));
    setModal({ kind: 'layout', mode: 'edit' });
  };

  const saveVehicle = async () => {
    if (!isVehicleFormValid) {
      setVehicleValidationError('車両名を入力してください。');
      return;
    }

    setSavingVehicle(true);
    setNotice(null);
    setError(null);
    setVehicleValidationError(null);

    try {
      if (vehicleForm.id) {
        await window.electronAPI.updateVehicle({
          id: vehicleForm.id,
          name: vehicleNameTrimmed,
          displayColor: vehicleForm.displayColor,
          enabled: vehicleForm.enabled,
        });
      } else {
        await window.electronAPI.createVehicle({
          name: vehicleNameTrimmed,
          displayColor: vehicleForm.displayColor,
          enabled: vehicleForm.enabled,
        });
      }

      await refresh();
      closeModal();
      setVehicleForm(emptyVehicleForm);
      setNotice('車両設定を保存しました。');
    } catch (saveError) {
      setError(parseError(saveError));
    } finally {
      setSavingVehicle(false);
    }
  };

  const saveCamera = async () => {
    if (!isCameraFormValid) {
      setCameraValidationError(cameraForm.vehicleId ? 'カメラ名と RTSP 接続先を入力してください。' : '車両を選択し、カメラ名と RTSP 接続先を入力してください。');
      return;
    }

    setSavingCamera(true);
    setNotice(null);
    setError(null);
    setCameraValidationError(null);

    try {
      if (cameraTest && !cameraTest.success) {
        const confirmed = window.confirm(`直前の接続確認は失敗しています: ${cameraTest.message}\n\nこのまま保存しますか？`);
        if (!confirmed) {
          return;
        }
      }

      if (cameraForm.id && !cameraForm.enabled) {
        const activeStatuses = await window.electronAPI.listCameraStatuses();
        const isActive = activeStatuses.some((status) => status.cameraId === cameraForm.id && status.status !== 'OFFLINE');
        if (isActive) {
          const confirmed = window.confirm('このカメラは現在再生中です。無効化して再生を停止しますか？');
          if (!confirmed) {
            return;
          }
        }
      }

      const payload = {
        vehicleId: cameraForm.vehicleId,
        name: cameraNameTrimmed,
        type: cameraForm.type,
        vendor: cameraForm.vendor,
        host: cameraForm.vendor === 'CUSTOM' ? null : cameraForm.host.trim() || null,
        rtspPort: cameraForm.vendor === 'CUSTOM' ? null : (cameraForm.rtspPort.trim() ? Number(cameraForm.rtspPort) : null),
        customRtspUrl: cameraForm.vendor === 'CUSTOM' ? cameraForm.customRtspUrl.trim() || null : null,
        qualityPreset: cameraForm.qualityPreset,
        username: cameraForm.username.trim() || null,
        password: cameraForm.password || null,
        enabled: cameraForm.enabled,
        bitrateLimit: cameraForm.bitrateLimit.trim() ? Number(cameraForm.bitrateLimit) : null,
      };

      if (cameraForm.id) {
        await window.electronAPI.updateCamera({
          id: cameraForm.id,
          ...payload,
        });
      } else {
        await window.electronAPI.createCamera(payload);
      }

      if (cameraForm.id && !cameraForm.enabled) {
        await window.electronAPI.stopCamera(cameraForm.id);
      }

      await refresh();
      closeModal();
      setCameraForm({
        ...emptyCameraForm,
        vehicleId: vehicles[0]?.id ?? '',
      });
      setNotice('カメラ設定を保存しました。');
    } catch (saveError) {
      setError(parseError(saveError));
    } finally {
      setSavingCamera(false);
    }
  };

  const testCamera = async () => {
    if (!cameraNameTrimmed) {
      setCameraValidationError('カメラ名を入力してから接続確認してください。');
      return;
    }

    if (!hasCameraRtspInput) {
      setCameraValidationError(cameraForm.vendor === 'CUSTOM' ? '接続確認の前に Custom RTSP URL を入力してください。' : '接続確認の前に Host/DDNS と RTSP ポートを入力してください。');
      return;
    }

    setTestingCamera(true);
    setError(null);
    setNotice(null);
    setCameraValidationError(null);

    try {
      const resolved = await window.electronAPI.resolveRtsp({
        vendor: cameraForm.vendor,
        host: cameraForm.vendor === 'CUSTOM' ? null : cameraForm.host.trim() || null,
        rtspPort: cameraForm.vendor === 'CUSTOM' ? null : (cameraForm.rtspPort.trim() ? Number(cameraForm.rtspPort) : null),
        customRtspUrl: cameraForm.vendor === 'CUSTOM' ? cameraForm.customRtspUrl.trim() || null : null,
        qualityPreset: cameraForm.qualityPreset,
        username: cameraForm.username.trim() || null,
        password: cameraForm.password || null,
      });

      if (!resolved.rtspUrl) {
        const message = resolved.error ?? 'RTSP URL を解決できませんでした。';
        setCameraTest({
          success: false,
          message,
        });
        setError(message);
        return;
      }

      const result = await window.electronAPI.testCamera({
        name: cameraNameTrimmed,
        cameraId: cameraForm.id,
        rtspUrl: resolved.rtspUrl,
        username: null,
        password: null,
      });
      setCameraTest(result);
      setNotice(result.message);
    } catch (testError) {
      const message = parseError(testError);
      setCameraTest({
        success: false,
        message,
      });
      setError(message);
    } finally {
      setTestingCamera(false);
    }
  };

  const deleteCamera = async (camera: CameraAdmin) => {
    const statuses = await window.electronAPI.listCameraStatuses();
    const isActive = statuses.some((status) => status.cameraId === camera.id && status.status !== 'OFFLINE');
    const confirmed = window.confirm(
      isActive ? `${camera.name} を削除して現在の再生も停止しますか？` : `${camera.name} を削除しますか？この操作は元に戻せません。`,
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await window.electronAPI.deleteCamera(camera.id);
      await window.electronAPI.stopCamera(camera.id);
      await refresh();
      if (cameraForm.id === camera.id) {
        closeModal();
      }
      setNotice('カメラを削除しました。');
    } catch (deleteError) {
      setError(parseError(deleteError));
    }
  };

  const deleteVehicle = async (vehicle: VehicleAdmin) => {
    const confirmed = window.confirm(`${vehicle.name} を削除しますか？この操作は元に戻せません。`);
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await window.electronAPI.deleteVehicle(vehicle.id);
      await refresh();
      if (vehicleForm.id === vehicle.id) {
        closeModal();
      }
      setNotice('車両を削除しました。');
    } catch (deleteError) {
      setError(parseError(deleteError));
    }
  };

  const saveLayout = async () => {
    if (!isLayoutFormValid) {
      setLayoutValidationError('レイアウト名を入力してください。');
      return;
    }

    const selectedIds = layoutForm.slots.map((slot) => slot.cameraId).filter(Boolean);
    if (new Set(selectedIds).size !== selectedIds.length) {
      setLayoutValidationError('同じカメラは 4 画面内で 1 回だけ選択できます。');
      return;
    }

    setSavingLayout(true);
    setError(null);
    setNotice(null);
    setLayoutValidationError(null);

    try {
      const payload = {
        name: layoutNameTrimmed,
        slots: layoutForm.slots.map((slot) => ({
          slotIndex: slot.slotIndex,
          cameraId: slot.cameraId || null,
        })),
      };

      await (layoutForm.id
        ? window.electronAPI.updateLayout({ id: layoutForm.id, ...payload })
        : window.electronAPI.createLayout(payload));

      await refresh();
      closeModal();
      setLayoutForm(emptyLayoutForm());
      setNotice('レイアウトを保存しました。');
    } catch (saveError) {
      setError(parseError(saveError));
    } finally {
      setSavingLayout(false);
    }
  };

  const activateLayout = async (layoutId: string) => {
    setActivatingLayout(true);
    setError(null);
    setNotice(null);

    try {
      await window.electronAPI.activateLayout(layoutId);
      await refresh();
      setNotice('レイアウトを有効化しました。');
    } catch (activateError) {
      setError(parseError(activateError));
    } finally {
      setActivatingLayout(false);
    }
  };

  const deleteLayout = async (layout: LayoutAdmin) => {
    const confirmed = window.confirm(`レイアウト「${layout.name}」を削除しますか？`);
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await window.electronAPI.deleteLayout(layout.id);
      await refresh();
      if (layoutForm.id === layout.id) {
        closeModal();
      }
      setNotice('レイアウトを削除しました。');
    } catch (deleteError) {
      setError(parseError(deleteError));
    }
  };

  const isCameraTakenByOtherSlot = (slotIndex: number, cameraId: string) => {
    if (!cameraId) {
      return false;
    }
    return layoutForm.slots.some((slot) => slot.slotIndex !== slotIndex && slot.cameraId === cameraId);
  };

  if (loading) {
    return (
      <AppShell className="px-6 py-8" containerClassName="max-w-5xl" headerless>
        <EmptyState title="設定画面を読み込み中です..." tone="loading" />
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="設定"
      title="車両・カメラ設定"
      description="車両、RTSP カメラ、4画面ウォール構成を一覧中心の画面で管理します。"
      actions={
        <>
          <OperationButton to="/" variant="secondary">操作画面へ戻る</OperationButton>
          <OperationButton to="/system-status" variant="secondary">システム状態</OperationButton>
        </>
      }
      className="px-6 py-8 text-[16px] text-slate-900 [&_button]:min-h-11 [&_a]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11 [&_textarea]:text-[16px]"
      containerClassName="max-w-7xl gap-6"
    >
      {error ? <EmptyState title={error} tone="error" /> : null}
      {notice ? <EmptyState title={notice} tone="no-data" /> : null}

      <section className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
        <OperationPanel className="rounded-[2rem] p-5">
          <SectionHeader title="クイック操作" />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <OperationButton type="button" variant="primary" onClick={openCreateVehicleModal} className="justify-center rounded-2xl text-sm">
              新規車両
            </OperationButton>
            <OperationButton type="button" variant="success" onClick={openCreateCameraModal} className="justify-center rounded-2xl text-sm">
              新規カメラ
            </OperationButton>
            <OperationButton type="button" variant="primary" onClick={openCreateLayoutModal} className="justify-center rounded-2xl text-sm">
              新規レイアウト
            </OperationButton>
          </div>
        </OperationPanel>

        <OperationPanel className="rounded-[2rem] p-5">
          <SectionHeader title="現在の構成" />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <SummaryCard label="車両" value={String(vehicles.length)} helper={`${vehicles.filter((vehicle) => vehicle.enabled).length} 台が有効`} />
            <SummaryCard label="カメラ" value={String(cameras.length)} helper={`${cameras.filter((camera) => camera.enabled).length} 台が有効`} />
            <SummaryCard label="有効レイアウト" value={activeLayout?.name ?? '未設定'} helper={activeLayout ? '現在の映像ウォール構成' : 'まだありません'} />
          </div>
        </OperationPanel>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <OperationPanel className="rounded-[2rem] p-5">
          <div className="flex items-center justify-between gap-4">
            <SectionHeader title="車両一覧" actions={<span className="text-sm text-slate-500">{vehicles.length} 件</span>} />
          </div>
          <div className="mt-4 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {vehicles.length === 0 ? (
              <EmptyState title="登録済みの車両はありません。" tone="no-data" />
            ) : (
              vehicles.map((vehicle) => (
                <div key={vehicle.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="h-3.5 w-3.5 rounded-full ring-2 ring-white" style={{ backgroundColor: vehicle.displayColor }} />
                        <p className="truncate font-semibold text-slate-900">{vehicle.name}</p>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{vehicle.enabled ? '有効' : '無効'} / ID: {vehicle.id}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <OperationButton type="button" onClick={() => openEditVehicleModal(vehicle)} variant="secondary" className="min-h-9 px-3 py-2 text-sm">
                        編集
                      </OperationButton>
                      <OperationButton type="button" onClick={() => void deleteVehicle(vehicle)} variant="danger" className="min-h-9 px-3 py-2 text-sm">
                        削除
                      </OperationButton>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </OperationPanel>

        <OperationPanel className="rounded-[2rem] p-5">
          <div className="flex items-center justify-between gap-4">
            <SectionHeader title="レイアウト一覧" actions={<span className="text-sm text-slate-500">{layouts.length} 件</span>} />
          </div>
          <div className="mt-4 max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {layouts.length === 0 ? (
              <EmptyState title="保存済みレイアウトはありません。" tone="no-data" />
            ) : (
              layouts.map((layout) => (
                <div key={layout.id} className={`rounded-2xl border px-4 py-4 ${layout.id === activeLayoutId ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">{layout.name}</p>
                        {layout.id === activeLayoutId ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">ACTIVE</span> : null}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">更新: {new Date(layout.updatedAt).toLocaleString()}</p>
                      <p className="mt-3 text-xs leading-6 text-slate-600">{formatLayoutSlotSummary(layout)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      <OperationButton type="button" onClick={() => openEditLayoutModal(layout)} variant="secondary" className="min-h-9 px-3 py-2 text-sm">
                        編集
                      </OperationButton>
                      <OperationButton type="button" onClick={() => void activateLayout(layout.id)} disabled={activatingLayout || layout.id === activeLayoutId} variant="success" className="min-h-9 px-3 py-2 text-sm disabled:opacity-50">
                        有効化
                      </OperationButton>
                      <OperationButton type="button" onClick={() => void deleteLayout(layout)} variant="danger" className="min-h-9 px-3 py-2 text-sm">
                        削除
                      </OperationButton>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </OperationPanel>
      </section>

      <OperationPanel className="rounded-[2rem] p-5">
        <div className="flex items-center justify-between gap-4">
          <SectionHeader title="カメラ一覧" actions={<span className="text-sm text-slate-500">{cameras.length} 件</span>} />
        </div>
        <div className="mt-4 max-h-[32rem] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50">
          {cameras.length === 0 ? (
            <div className="p-6">
              <EmptyState title="登録済みカメラはありません。" tone="no-data" />
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {cameras.map((camera) => (
                <div key={camera.id} className="grid gap-3 px-4 py-4 xl:grid-cols-[1.2fr_1fr_0.8fr_auto] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-slate-900">{camera.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${camera.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {camera.enabled ? '有効' : '無効'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{camera.vehicleName} / {camera.vendor} / {camera.type}</p>
                  </div>
                  <div className="min-w-0 text-xs text-slate-600">
                    <p className="truncate" title={camera.vendor === 'CUSTOM' ? (camera.customRtspUrl ?? '未設定') : `${camera.host ?? '未設定'}:${camera.rtspPort ?? 554}`}>
                      接続先: {camera.vendor === 'CUSTOM' ? (camera.customRtspUrl ?? '未設定') : `${camera.host ?? '未設定'}:${camera.rtspPort ?? 554}`}
                    </p>
                    <p className="mt-1 truncate" title={camera.rtspUrl ?? 'No generated RTSP URL configured'}>
                      RTSP: {camera.rtspUrl ?? '未生成'}
                    </p>
                  </div>
                  <div className="text-xs text-slate-600">
                    <p>ユーザー: {camera.username || '未設定'}</p>
                    <p className="mt-1">帯域制限: {camera.bitrateLimit ? `${camera.bitrateLimit} kbps` : '未設定'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <OperationButton type="button" onClick={() => openEditCameraModal(camera)} variant="secondary" className="min-h-9 px-3 py-2 text-sm">
                      編集
                    </OperationButton>
                    <OperationButton type="button" onClick={() => void deleteCamera(camera)} variant="danger" className="min-h-9 px-3 py-2 text-sm">
                      削除
                    </OperationButton>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </OperationPanel>

      <PlaceMarkerManagerSection />

      <SettingsModal
        open={modal?.kind === 'vehicle'}
        title={modal?.mode === 'edit' ? '車両編集' : '新規車両'}
        description="車両名と表示色を設定します。地図のマーカー色にも反映されます。"
        onClose={closeModal}
        footer={
          <>
            <OperationButton type="button" onClick={closeModal} variant="secondary">
              キャンセル
            </OperationButton>
            <OperationButton type="button" onClick={() => void saveVehicle()} disabled={savingVehicle || !isVehicleFormValid} variant="primary">
              {savingVehicle ? '保存中...' : '保存'}
            </OperationButton>
          </>
        }
      >
        {error ? <EmptyState title={error} tone="error" className="px-4 py-3" /> : null}
        <div className="grid gap-4">
          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">車両名</span>
            <input
              value={vehicleForm.name}
              onChange={(event) => {
                setVehicleValidationError(null);
                setVehicleForm((current) => ({ ...current, name: event.target.value }));
              }}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
            />
            {vehicleValidationError ? <p className="mt-2 text-xs text-rose-300">{vehicleValidationError}</p> : null}
          </label>
          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">表示色</span>
            <div className="flex gap-3">
              <input
                type="color"
                value={vehicleForm.displayColor}
                onChange={(event) => setVehicleForm((current) => ({ ...current, displayColor: event.target.value }))}
                className="h-11 w-16 rounded-xl border border-slate-300 bg-white"
              />
              <input
                value={vehicleForm.displayColor}
                onChange={(event) => setVehicleForm((current) => ({ ...current, displayColor: event.target.value }))}
                className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
              />
            </div>
          </label>
          <label className="flex items-center gap-3 text-sm text-slate-200">
            <input type="checkbox" checked={vehicleForm.enabled} onChange={(event) => setVehicleForm((current) => ({ ...current, enabled: event.target.checked }))} />
            車両を有効にする
          </label>
        </div>
      </SettingsModal>

      <SettingsModal
        open={modal?.kind === 'camera'}
        title={modal?.mode === 'edit' ? 'カメラ編集' : '新規カメラ'}
        description="現在の新規カメラ popup の設計意図を引き継ぎつつ、入力を compact にまとめています。"
        onClose={closeModal}
        footer={
          <>
            <OperationButton type="button" onClick={closeModal} variant="secondary">
              キャンセル
            </OperationButton>
            <OperationButton type="button" onClick={() => void saveCamera()} disabled={savingCamera || vehicles.length === 0 || !isCameraFormValid} variant="primary">
              {savingCamera ? '保存中...' : '保存'}
            </OperationButton>
          </>
        }
      >
        {error ? <EmptyState title={error} tone="error" className="px-4 py-3" /> : null}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-400">{cameraVehicleName}</p>
              <p className="mt-1 text-xs text-slate-500">保存前に接続確認できます。</p>
            </div>
            <OperationButton type="button" onClick={() => void testCamera()} disabled={testingCamera} variant="success" className="min-h-10 px-3 py-2 text-sm">
              {testingCamera ? '接続確認中...' : '接続確認'}
            </OperationButton>
          </div>

          {cameraTest ? (
            <EmptyState title={cameraTest.message} tone={cameraTest.success ? 'no-data' : 'disconnected'} className="px-4 py-3 text-sm" />
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">車両</span>
              <select value={cameraForm.vehicleId} onChange={(event) => setCameraForm((current) => ({ ...current, vehicleId: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600">
                {vehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">カメラ名</span>
              <input
                value={cameraForm.name}
                onChange={(event) => {
                  setCameraValidationError(null);
                  setCameraForm((current) => ({ ...current, name: event.target.value }));
                }}
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
              />
              {cameraValidationError ? <p className="mt-2 text-xs text-rose-300">{cameraValidationError}</p> : null}
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">種別</span>
              <select value={cameraForm.type} onChange={(event) => setCameraForm((current) => ({ ...current, type: event.target.value as CameraFormState['type'] }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600">
                <option value="FRONT">FRONT</option>
                <option value="INTERNAL">INTERNAL</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">ベンダー</span>
              <select value={cameraForm.vendor} onChange={(event) => setCameraForm((current) => ({ ...current, vendor: event.target.value as CameraFormState['vendor'] }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600">
                <option value="AXIS">AXIS</option>
                <option value="HIKVISION">HIKVISION</option>
                <option value="CUSTOM">CUSTOM</option>
              </select>
            </label>
          </div>

          {cameraForm.vendor === 'CUSTOM' ? (
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Custom RTSP URL</span>
              <input
                value={cameraForm.customRtspUrl}
                onChange={(event) => setCameraForm((current) => ({ ...current, customRtspUrl: event.target.value }))}
                placeholder="rtsp://example/stream"
                className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
              />
              <p className="mt-2 text-xs text-slate-400">特殊な RTSP パスが必要な現場向けです。</p>
            </label>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm text-slate-300">Host / DDNS</span>
                <input
                  value={cameraForm.host}
                  onChange={(event) => setCameraForm((current) => ({ ...current, host: event.target.value }))}
                  placeholder="203.0.113.10 or site.example.net"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm text-slate-300">RTSP Port</span>
                <input
                  value={cameraForm.rtspPort}
                  onChange={(event) => setCameraForm((current) => ({ ...current, rtspPort: event.target.value }))}
                  placeholder="554"
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
                />
              </label>
            </div>
          )}

          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">Quality preset</span>
            <select
              value={cameraForm.qualityPreset}
              onChange={(event) => setCameraForm((current) => ({ ...current, qualityPreset: event.target.value as CameraFormState['qualityPreset'] }))}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
            >
              <option value="LOW">LOW - {qualityPresetDescriptions.LOW}</option>
              <option value="STANDARD">STANDARD - {qualityPresetDescriptions.STANDARD}</option>
              <option value="HIGH">HIGH - {qualityPresetDescriptions.HIGH}</option>
            </select>
            <p className="mt-2 text-xs text-slate-400">6Mbps 回線で 2 台運用なら STANDARD 推奨です。</p>
          </label>

          <div className="rounded-2xl border border-slate-300 bg-white p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">生成 RTSP プレビュー</p>
            <p className="mt-2 text-xs text-slate-500">このプレビューではパスワードを伏せて表示します。</p>
            <p className="mt-2 break-all text-xs text-slate-700">
              <code>{rtspPreview?.sanitizedRtspUrl ?? 'まだ RTSP プレビューはありません。'}</code>
            </p>
            {rtspPreview?.error ? <p className="mt-2 text-xs text-amber-700">{rtspPreview.error}</p> : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Username</span>
              <input value={cameraForm.username} onChange={(event) => setCameraForm((current) => ({ ...current, username: event.target.value }))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600" />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Password</span>
              <div className="flex gap-3">
                <input type={showPassword ? 'text' : 'password'} value={cameraForm.password} onChange={(event) => setCameraForm((current) => ({ ...current, password: event.target.value }))} className="flex-1 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600" />
                <button type="button" onClick={() => setShowPassword((current) => !current)} className="rounded-xl border border-slate-400 bg-white px-4 py-3 text-sm text-slate-900">
                  {showPassword ? '非表示' : '表示'}
                </button>
              </div>
              {cameraForm.hasSavedPassword && !cameraForm.password ? <p className="mt-2 text-xs text-slate-500">保存済みパスワードがあります。空欄のまま保存すると現在の認証情報を維持します。</p> : null}
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-slate-300">Bitrate limit (kbps)</span>
              <input value={cameraForm.bitrateLimit} onChange={(event) => setCameraForm((current) => ({ ...current, bitrateLimit: event.target.value }))} placeholder="任意" className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600" />
            </label>
            <label className="flex items-center gap-3 pt-8 text-sm text-slate-200">
              <input type="checkbox" checked={cameraForm.enabled} onChange={(event) => setCameraForm((current) => ({ ...current, enabled: event.target.checked }))} />
              カメラを有効にする
            </label>
          </div>

          <div className="rounded-2xl border border-slate-300 bg-white p-4 text-sm text-slate-700">
            <p className="font-semibold text-slate-900">RTSP 設定例</p>
            <p className="mt-2">Axis with port forwarding: <code>203.0.113.10 / 8551</code></p>
            <p>Second camera on same IP: <code>203.0.113.10 / 8552</code></p>
            <p>Custom advanced URL: <code>rtsp://username:password@example.local:554/live/main</code></p>
          </div>
        </div>
      </SettingsModal>

      <SettingsModal
        open={modal?.kind === 'layout'}
        title={modal?.mode === 'edit' ? 'レイアウト編集' : '新規レイアウト'}
        description="4画面ウォールに表示するカメラ構成を compact に設定します。"
        onClose={closeModal}
        footer={
          <>
            <OperationButton type="button" onClick={closeModal} variant="secondary">
              キャンセル
            </OperationButton>
            <OperationButton type="button" onClick={() => void saveLayout()} disabled={savingLayout || !isLayoutFormValid} variant="primary">
              {savingLayout ? '保存中...' : '保存'}
            </OperationButton>
          </>
        }
      >
        {error ? <EmptyState title={error} tone="error" className="px-4 py-3" /> : null}
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-slate-500">{layoutForm.id === activeLayoutId ? '現在有効なレイアウトです。' : '保存後に有効化できます。'}</p>
            </div>
            {layoutForm.id ? (
              <OperationButton
                type="button"
                onClick={() => void activateLayout(layoutForm.id!)}
                disabled={activatingLayout || layoutForm.id === activeLayoutId}
                variant="success"
                className="min-h-10 px-3 py-2 text-sm disabled:opacity-50"
              >
                {activatingLayout ? '有効化中...' : '有効化'}
              </OperationButton>
            ) : null}
          </div>

          <label className="block">
            <span className="mb-2 block text-sm text-slate-300">レイアウト名</span>
            <input
              value={layoutForm.name}
              onChange={(event) => {
                setLayoutValidationError(null);
                setLayoutForm((current) => ({ ...current, name: event.target.value }));
              }}
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
            />
            {layoutValidationError ? <p className="mt-2 text-xs text-rose-300">{layoutValidationError}</p> : null}
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            {layoutForm.slots.map((slot) => (
              <label key={slot.slotIndex} className="block">
                <span className="mb-2 block text-sm text-slate-300">Slot {slot.slotIndex}</span>
                <select
                  value={slot.cameraId}
                  onChange={(event) => {
                    setLayoutValidationError(null);
                    const nextCameraId = event.target.value;
                    setLayoutForm((current) => ({
                      ...current,
                      slots: current.slots.map((entry) => (entry.slotIndex === slot.slotIndex ? { ...entry, cameraId: nextCameraId } : entry)),
                    }));
                  }}
                  className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-slate-900 outline-none focus:border-sky-600"
                >
                  <option value="">No camera selected</option>
                  {cameras.map((camera) => (
                    <option key={camera.id} value={camera.id} disabled={isCameraTakenByOtherSlot(slot.slotIndex, camera.id)}>
                      {camera.vehicleName} / {camera.type} / {camera.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      </SettingsModal>
    </AppShell>
  );
}

function SummaryCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 truncate text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{helper}</p>
    </div>
  );
}

function SettingsModal({
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
            <button type="button" onClick={onClose} className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 transition hover:border-slate-500 hover:bg-slate-700">
              閉じる
            </button>
          </div>
          <div className="max-h-[min(78vh,52rem)] overflow-y-auto px-6 py-5">
            {children}
          </div>
          <div className="flex flex-wrap justify-end gap-3 border-t border-slate-800 px-6 py-5">
            {footer}
          </div>
        </OperationPanel>
      </div>
    </div>
  );
}
