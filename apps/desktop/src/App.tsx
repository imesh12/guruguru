import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';

import { ErrorBoundary } from './components/ErrorBoundary';
import { municipalFontStack } from './components/ui';
import { I18nProvider } from './i18n';

const ControlPage = lazy(() => import('./pages/ControlPage').then((module) => ({ default: module.ControlPage })));
const VideoWallPage = lazy(() => import('./pages/VideoWallPage').then((module) => ({ default: module.VideoWallPage })));
const MapPage = lazy(() => import('./pages/MapPage').then((module) => ({ default: module.MapPage })));
const DailyReportPage = lazy(() => import('./pages/DailyReportPage').then((module) => ({ default: module.DailyReportPage })));
const CameraPlayerPage = lazy(() => import('./pages/CameraPlayerPage').then((module) => ({ default: module.CameraPlayerPage })));
const SystemStatusPage = lazy(() => import('./pages/SystemStatusPage').then((module) => ({ default: module.SystemStatusPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const FieldTestPage = lazy(() => import('./pages/FieldTestPage').then((module) => ({ default: module.FieldTestPage })));

export default function App() {
  return (
    <I18nProvider>
      <ErrorBoundary>
        <Suspense
          fallback={
            <div
              className="flex min-h-screen items-center justify-center bg-slate-100 px-6 text-[16px] font-medium text-slate-700"
              style={{ fontFamily: municipalFontStack }}
            >
              画面を読み込んでいます...
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<ControlPage />} />
            <Route path="/dashboard" element={<ControlPage />} />
            <Route path="/video-wall" element={<VideoWallPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/daily-report" element={<DailyReportPage />} />
            <Route path="/camera/:cameraId" element={<CameraPlayerPage />} />
            <Route path="/system-status" element={<SystemStatusPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/field-test" element={<FieldTestPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </I18nProvider>
  );
}
