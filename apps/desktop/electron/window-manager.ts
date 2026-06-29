import { BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DesktopFileLogger } from './file-logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type WindowKey = 'control' | 'video-wall' | 'map' | 'system-status';

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const rendererFile = path.join(__dirname, '../../out/renderer/index.html');
const appIcon =
  process.platform === 'win32'
    ? path.join(__dirname, '../../resources/kurukuru-monitor-icon.ico')
    : path.join(__dirname, '../../resources/kurukuru-monitor-icon.png');

const buildFallbackHtml = (route: string, resolvedRendererFile: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Kurukuru Monitor</title>
    <style>
      body {
        margin: 0;
        font-family: "Segoe UI", sans-serif;
        background: #09111f;
        color: #e2e8f0;
        display: grid;
        place-items: center;
        min-height: 100vh;
      }
      main {
        max-width: 720px;
        padding: 32px;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 20px;
        background: rgba(15,23,42,0.92);
      }
      code {
        color: #7dd3fc;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Kurukuru Monitor renderer missing</h1>
      <p>The production renderer file could not be found, so Electron loaded this fallback screen instead of a black window.</p>
      <p>Route: <code>${route}</code></p>
      <p>Expected renderer: <code>${resolvedRendererFile}</code></p>
    </main>
  </body>
</html>`;

const loadWindowContent = async (
  window: BrowserWindow,
  route: string,
  logger?: DesktopFileLogger,
  openDevTools?: boolean,
) => {
  if (rendererUrl) {
    const target = `${rendererUrl}#${route}`;
    await logger?.info('Loading renderer URL.', { route, target });
    await window.loadURL(target);
  } else {
    const resolvedRendererFile = path.resolve(rendererFile);
    await logger?.info('Loading renderer file.', { route, rendererFile: resolvedRendererFile });

    if (fs.existsSync(resolvedRendererFile)) {
      await window.loadFile(resolvedRendererFile, {
        hash: route,
      });
    } else {
      await logger?.error('Renderer file missing. Loading fallback HTML.', { route, rendererFile: resolvedRendererFile });
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildFallbackHtml(route, resolvedRendererFile))}`);
    }
  }

  if (openDevTools) {
    window.webContents.openDevTools({ mode: 'detach' });
  }
};

const createAppWindow = (
  route: string,
  options: Electron.BrowserWindowConstructorOptions,
  logger?: DesktopFileLogger,
  openDevTools?: boolean,
) => {
  const window = new BrowserWindow({
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#09111f',
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
    icon: appIcon,
    ...options,
  });

  void loadWindowContent(window, route, logger, openDevTools);

  return window;
};

const waitForMainFrameLoad = (window: BrowserWindow, timeoutMs = 10000) =>
  new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      window.webContents.removeListener('did-finish-load', handleFinish);
      window.webContents.removeListener('did-fail-load', handleFail);
      clearTimeout(timer);
    };

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const handleFinish = () => {
      finish(() => resolve());
    };

    const handleFail = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      validatedUrl: string,
      isMainFrame: boolean,
    ) => {
      if (!isMainFrame) {
        return;
      }

      finish(() => reject(new Error(`Renderer load failed (${errorCode}) ${errorDescription} ${validatedUrl}`)));
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Renderer load timed out after ${timeoutMs}ms.`)));
    }, timeoutMs);

    window.webContents.once('did-finish-load', handleFinish);
    window.webContents.once('did-fail-load', handleFail);
  });

export const createWindowManager = (options?: {
  logger?: DesktopFileLogger;
  openDevTools?: boolean;
  onVideoWallClosing?: (window: BrowserWindow) => void | Promise<void>;
  onVideoWallClosed?: (webContentsId: number | null) => void | Promise<void>;
  onVideoWallMinimized?: () => void | Promise<void>;
  onVideoWallRestored?: () => void | Promise<void>;
  onCameraClosing?: (cameraId: string, webContentsId: number) => void | Promise<void>;
  onCameraClosed?: (cameraId: string, webContentsId: number) => void | Promise<void>;
}) => {
  const windows = new Map<WindowKey, BrowserWindow>();
  let cameraWindow: BrowserWindow | null = null;
  let activeCameraId: string | null = null;
  const windowRoutes = new Map<WindowKey, string>();

  const openWindow = (key: WindowKey, route: string, options: Electron.BrowserWindowConstructorOptions) => {
    const existing = windows.get(key);
    if (existing && !existing.isDestroyed()) {
      windowRoutes.set(key, route);
      existing.focus();
      return existing;
    }

    const next = createAppWindow(route, options, optionsArg.logger, optionsArg.openDevTools);
    windows.set(key, next);
    windowRoutes.set(key, route);
    const videoWallWebContentsId = key === 'video-wall' ? next.webContents.id : null;
    if (key === 'video-wall') {
      next.on('close', () => {
        void optionsArg.onVideoWallClosing?.(next);
      });
      next.on('minimize', () => {
        void optionsArg.onVideoWallMinimized?.();
      });
      next.on('restore', () => {
        void optionsArg.onVideoWallRestored?.();
      });
    }
    next.on('closed', () => {
      windows.delete(key);
      windowRoutes.delete(key);
      if (key === 'video-wall') {
        void optionsArg.onVideoWallClosed?.(videoWallWebContentsId);
      }
    });
    return next;
  };
  const navigateWindow = (window: BrowserWindow, route: string) => {
    const key = Array.from(windows.entries()).find(([, currentWindow]) => currentWindow === window)?.[0];
    if (key) {
      windowRoutes.set(key, route);
    }
    void loadWindowContent(window, route, optionsArg.logger, optionsArg.openDevTools);
    window.focus();
    return window;
  };
  const optionsArg = options ?? {};

  return {
    openControl() {
      return openWindow('control', '/', {
        title: 'Kurukuru Monitor Control',
        width: 1280,
        height: 840,
      });
    },
    openVideoWall() {
      return openWindow('video-wall', '/video-wall', {
        title: 'Kurukuru Video Wall',
        width: 1600,
        height: 920,
      });
    },
    openMap() {
      return openWindow('map', '/map', {
        title: 'Kurukuru Map',
        width: 1280,
        height: 900,
      });
    },
    openSystemStatus() {
      const controlWindow = windows.get('control');
      if (controlWindow && !controlWindow.isDestroyed()) {
        void optionsArg.logger?.info('[window-manager] system status opened in main window', {
          route: '/system-status',
        });
        return navigateWindow(controlWindow, '/system-status');
      }

      const next = openWindow('control', '/system-status', {
        title: 'Kurukuru Monitor Control',
        width: 1280,
        height: 840,
      });
      void optionsArg.logger?.info('[window-manager] system status opened in main window', {
        route: '/system-status',
        createdControlWindow: true,
      });
      return next;
    },
    openCameraWindow(cameraId: string, title: string) {
      const route = `/camera-popout/${cameraId}`;
      const existing = cameraWindow;

      if (existing && !existing.isDestroyed()) {
        const previousCameraId = activeCameraId;
        activeCameraId = cameraId;
        existing.setTitle(title);
        if (existing.isMinimized()) {
          existing.restore();
        }
        void optionsArg.logger?.info('[camera-popout] switching camera', {
          previousCameraId,
          cameraId,
        });
        void optionsArg.logger?.info('[window-manager] reusing camera window', {
          previousCameraId,
          cameraId,
          route,
          title,
        });
        void loadWindowContent(existing, route, optionsArg.logger, optionsArg.openDevTools);
        existing.show();
        existing.focus();
        return existing;
      }

      activeCameraId = cameraId;
      void optionsArg.logger?.info('[window-manager] creating camera window', {
        cameraId,
        route,
        title,
      });
      const next = createAppWindow(route, {
        title,
        width: 1440,
        height: 920,
      });

      cameraWindow = next;
      const cameraWebContentsId = next.webContents.id;
      next.on('close', () => {
        if (activeCameraId) {
          void optionsArg.onCameraClosing?.(activeCameraId, cameraWebContentsId);
        }
      });
      next.on('closed', () => {
        const closedCameraId = activeCameraId;
        void optionsArg.logger?.info('[window-manager] camera window closed', {
          cameraId: closedCameraId,
        });
        cameraWindow = null;
        activeCameraId = null;
        if (closedCameraId) {
          void optionsArg.onCameraClosed?.(closedCameraId, cameraWebContentsId);
        }
      });
      return next;
    },
    getActiveCameraId() {
      return activeCameraId;
    },
    hasOpenCameraWindow() {
      return Boolean(cameraWindow && !cameraWindow.isDestroyed());
    },
    getControlWindow() {
      const current = windows.get('control');
      return current && !current.isDestroyed() ? current : null;
    },
    async reloadControlWindow() {
      const controlWindow = windows.get('control') ?? openWindow('control', '/', {
        title: 'Kurukuru Monitor Control',
        width: 1280,
        height: 840,
      });
      const route = windowRoutes.get('control') ?? '/';

      await optionsArg.logger?.info('[window-manager] reloading control window', {
        route,
        rendererUrl: rendererUrl ?? null,
      });

      if (rendererUrl) {
        const loadPromise = waitForMainFrameLoad(controlWindow);
        controlWindow.webContents.reloadIgnoringCache();
        await loadPromise;
        controlWindow.focus();
        return controlWindow;
      }

      await loadWindowContent(controlWindow, route, optionsArg.logger, optionsArg.openDevTools);
      controlWindow.focus();
      return controlWindow;
    },
  };
};
