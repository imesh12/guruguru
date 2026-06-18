import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Language = 'ja' | 'en';
type DictionaryTree = { [key: string]: string | DictionaryTree };

const STORAGE_KEY = 'kurukuru-monitor-language';

const dictionary: Record<Language, DictionaryTree> = {
  ja: {
    common: {
      appName: 'くるくるモニター',
      demoMode: 'デモモード',
      loading: '読み込み中...',
      backToControl: '操作画面へ戻る',
      apiUnavailable: 'ローカルAPIに接続できません',
      language: '表示言語',
      japanese: '日本語',
      english: 'English',
    },
    control: {
      eyebrow: '監視操作画面',
      title: '車両監視システム 操作メニュー',
      description: '映像監視、地図監視、状態確認、設定変更、現地試験をここから分かりやすく操作できます。',
      actions: '操作メニュー',
      videoWallTitle: '映像ウォール',
      videoWallBody: '4画面監視を開く',
      mapTitle: '地図画面',
      mapBody: '車両位置を確認する',
      statusTitle: 'システム状態',
      statusBody: '異常有無を確認する',
      settingsTitle: '設定',
      settingsBody: '車両・カメラ設定',
      fieldTestTitle: '現地試験',
      fieldTestBody: '受入確認を開始',
      //summary: '現在の運用状況',
      liveCameras: 'ライブ映像',
      onlineVehicles: 'GPS受信中',
      receiver: '受信機状態',
      guidance: '現在の運用状況',
    },
    wall: {
      eyebrow: '映像ウォール',
      title: '4画面監視レイアウト',
      mpvReady: 'mpvで外部再生ウィンドウを各タイル付近に配置しています。',
      mpvMissing: 'mpvが見つかりません。RTSP再生にはmpvの導入が必要です。',
      noCameras: '有効なカメラが未設定です。設定画面からカメラを追加または有効化してください。',
      demoHint: 'デモモードでは、RTSP未接続時でも画面構成を確認できます。',
    },
    map: {
      eyebrow: '地図画面',
      title: '車両位置監視',
      description: 'GPS状態をリアルタイム表示し、遅延や受信停止も分かるようにしています。',
      wsOnline: '受信中',
      wsReconnect: '再接続中',
      noGps: 'GPSデータを受信していません。受信機またはデモモード設定を確認してください。',
      missingMapbox: 'Mapboxトークン未設定のため簡易地図表示です。',
      demoHint: 'デモモードでは模擬走行ルートを表示しています。',
      updatedAgo: '{seconds}秒前更新',
    },
    status: {
      eyebrow: 'システム状態',
      title: '運用状態ダッシュボード',
      description: 'カメラ、GPS、受信機、データベースの状態を定期更新で確認できます。',
    },
  },
  en: {
    common: {
      appName: 'Kurukuru Monitor',
      demoMode: 'Demo Mode',
      loading: 'Loading...',
      backToControl: 'Back to control',
      apiUnavailable: 'Local API unavailable',
      language: 'Language',
      japanese: 'Japanese',
      english: 'English',
    },
    control: {
      eyebrow: 'Control Menu',
      title: 'Municipal Vehicle Monitoring Control Menu',
      description: 'Open video monitoring, live maps, system health, settings, and field testing from one clear operator screen.',
      actions: 'Actions',
      videoWallTitle: 'Video Wall',
      videoWallBody: 'Open 4-camera wall',
      mapTitle: 'Map',
      mapBody: 'View vehicle positions',
      statusTitle: 'System Status',
      statusBody: 'Check alarms and health',
      settingsTitle: 'Settings',
      settingsBody: 'Vehicle and camera setup',
      fieldTestTitle: 'Field Test',
      fieldTestBody: 'Start acceptance checks',
      //summary: 'Current system summary',
      liveCameras: 'Live cameras',
      onlineVehicles: 'Vehicles online',
      receiver: 'Receiver',
      guidance: 'Current operational status',
    },
    wall: {
      eyebrow: 'Video Wall',
      title: '4-camera monitoring layout',
      mpvReady: 'External mpv windows are aligned near each camera tile.',
      mpvMissing: 'mpv was not found. Install mpv to enable RTSP playback.',
      noCameras: 'No enabled cameras are configured yet. Add or enable cameras in Settings.',
      demoHint: 'In Demo Mode, the wall layout remains visible even when RTSP is unavailable.',
    },
    map: {
      eyebrow: 'Map Window',
      title: 'Vehicle location monitoring',
      description: 'Live GPS status is shown in real time so operators can see movement, delay, and offline conditions.',
      wsOnline: 'Receiving',
      wsReconnect: 'Reconnecting',
      noGps: 'No GPS data is being received. Check the receiver or Demo Mode settings.',
      missingMapbox: 'Mapbox token missing, so the simplified map panel is being shown.',
      demoHint: 'Demo Mode is showing a mock route for client demonstration.',
      updatedAgo: 'Updated {seconds}s ago',
    },
    status: {
      eyebrow: 'System Status',
      title: 'Operations dashboard',
      description: 'Camera, GPS, receiver, and database health are refreshed so operators can quickly spot issues.',
    },
  },
};

type I18nContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const resolveKey = (tree: DictionaryTree, key: string): string | undefined => {
  const parts = key.split('.');
  let current: string | DictionaryTree | undefined = tree;
  for (const part of parts) {
    if (!current || typeof current === 'string') {
      return undefined;
    }
    current = current[part];
  }
  return typeof current === 'string' ? current : undefined;
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('ja');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ja' || stored === 'en') {
      setLanguage(stored);
    }
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage: (nextLanguage) => {
        setLanguage(nextLanguage);
        window.localStorage.setItem(STORAGE_KEY, nextLanguage);
      },
      t: (key, variables) => {
        const template = resolveKey(dictionary[language], key) ?? resolveKey(dictionary.en, key) ?? key;
        return Object.entries(variables ?? {}).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          template,
        );
      },
    }),
    [language],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return context;
}
