import net from 'node:net';

import type { FastifyPluginAsync } from 'fastify';

import { checkDatabaseReachable, CRITICAL_TABLES, getExistingTables } from '../services/prisma.js';
import { resolveDatabaseUrl } from '../services/runtime-config.js';

const withTimeout = async <T>(operation: Promise<T>, timeoutMs: number) =>
  await Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);

const checkTcpPort = async (host: string, port: number, timeoutMs: number) =>
  await new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => ({
    status: 'ok',
    service: 'api',
    timestamp: new Date().toISOString(),
  }));

  app.get('/deep', async () => {
    const databaseUrl = resolveDatabaseUrl();
    const mediamtxEnabled = process.env.MEDIAMTX_ENABLED !== 'false';
    const mediamtxApiUrl = 'http://127.0.0.1:9997/v3/paths/list';
    const mediamtxWhepBase = process.env.MEDIAMTX_WEBRTC_BASE?.trim() || 'http://127.0.0.1:8889';
    const mediamtxWhepUrl = new URL(mediamtxWhepBase);
    const mediamtxWhepHost = mediamtxWhepUrl.hostname || '127.0.0.1';
    const mediamtxWhepPort = mediamtxWhepUrl.port ? Number(mediamtxWhepUrl.port) : 80;

    let dbReachable = false;
    let dbError: string | null = null;
    let existingTables: string[] = [];

    try {
      await checkDatabaseReachable();
      existingTables = await getExistingTables();
      dbReachable = true;
    } catch (error) {
      dbError = error instanceof Error ? error.message : String(error);
    }

    const missingTables = CRITICAL_TABLES.filter((tableName) => !existingTables.includes(tableName));

    let mediaMtxApiReachable: boolean | null = null;
    let mediaMtxApiStatus: number | null = null;
    let mediaMtxApiError: string | null = null;

    if (mediamtxEnabled) {
      try {
        const response = await withTimeout(fetch(mediamtxApiUrl), 2000);
        mediaMtxApiReachable = response.ok;
        mediaMtxApiStatus = response.status;
      } catch (error) {
        mediaMtxApiReachable = false;
        mediaMtxApiError = error instanceof Error ? error.message : String(error);
      }
    }

    const mediaMtxWhepReachable = mediamtxEnabled
      ? await checkTcpPort(mediamtxWhepHost, mediamtxWhepPort, 1500)
      : null;

    return {
      status: dbReachable && missingTables.length === 0 ? 'ok' : 'degraded',
      service: 'api',
      timestamp: new Date().toISOString(),
      database: {
        reachable: dbReachable,
        url: databaseUrl,
        error: dbError,
        criticalTables: [...CRITICAL_TABLES],
        existingTables,
        missingTables,
      },
      mediamtx: {
        enabled: mediamtxEnabled,
        apiUrl: mediamtxApiUrl,
        apiReachable: mediaMtxApiReachable,
        apiStatus: mediaMtxApiStatus,
        apiError: mediaMtxApiError,
        whepBaseUrl: mediamtxWhepBase,
        whepHost: mediamtxWhepHost,
        whepPort: mediamtxWhepPort,
        whepReachable: mediaMtxWhepReachable,
      },
    };
  });
};
