import net from 'node:net';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { DesktopFileLogger } from './file-logger.js';

type MediaMtxPathConfig = {
  cameraId: string;
  streamPath: string;
  webrtcUrl: string;
};

export class MediaMtxManager {
  private processHandle: ChildProcess | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private trackedPaths: MediaMtxPathConfig[] = [];
  private readonly localApiUrl = 'http://127.0.0.1:9997/v3/paths/list';
  private lastWhepReachable: boolean | null = null;
  private readonly whepBaseUrl = process.env.MEDIAMTX_WEBRTC_BASE?.trim() || 'http://127.0.0.1:8889';

  private async fetchWithTimeout(input: string, timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(input, {
        method: 'GET',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  constructor(
    private readonly logger?: DesktopFileLogger,
    private readonly repoRoot?: string,
    private readonly configPath?: string,
  ) {}

  setTrackedPaths(paths: MediaMtxPathConfig[]) {
    this.trackedPaths = paths.slice();
  }

  getTrackedPaths() {
    return this.trackedPaths.slice();
  }

  isRunning() {
    return Boolean(this.processHandle && this.processHandle.exitCode === null && !this.processHandle.killed);
  }

  async start(reason: string) {
    if (this.isRunning()) {
      return true;
    }

    const binaryPath = this.resolveBinaryPath();
    if (!binaryPath || !this.configPath) {
      await this.logger?.warn('[mediamtx] source failed', {
        reason,
        binaryPath: binaryPath ?? null,
        configPath: this.configPath ?? null,
        error: 'MediaMTX binary or config path is unavailable.',
      });
      return false;
    }

    await this.logger?.info('[mediamtx] starting', {
      reason,
      binaryPath,
      configPath: this.configPath,
    });

    const child = spawn(binaryPath, [this.configPath], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.processHandle = child;
    await this.logger?.info('[mediamtx] started', {
      reason,
      pid: child.pid ?? null,
      binaryPath,
      configPath: this.configPath,
    });
    child.stdout?.on('data', (chunk) => {
      const message = chunk.toString('utf8').trim();
      if (message) {
        void this.logger?.info('[mediamtx] stdout', { message });
      }
    });
    child.stderr?.on('data', (chunk) => {
      const message = chunk.toString('utf8').trim();
      if (message) {
        void this.logger?.warn('[mediamtx] stderr', { message });
      }
    });
    child.once('error', (error) => {
      this.processHandle = null;
      void this.logger?.error('[mediamtx] source failed', {
        reason,
        binaryPath,
        configPath: this.configPath,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    child.once('exit', (code, signal) => {
      this.processHandle = null;
      this.stopHealthChecks();
      void this.logger?.warn('[mediamtx] exited', {
        code,
        signal,
      });
    });

    this.startHealthChecks();
    return true;
  }

  async stop(reason: string) {
    this.stopHealthChecks();
    const child = this.processHandle;
    this.processHandle = null;
    if (!child || child.exitCode !== null || child.killed) {
      return;
    }

    await this.logger?.info('[mediamtx] stopping', {
      reason,
      pid: child.pid ?? null,
    });

    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return;
    }

    child.kill('SIGKILL');
  }

  async restart(reason: string) {
    await this.stop(`restart:${reason}`);
    return this.start(reason);
  }

  async waitForConfiguredPaths(timeoutMs: number) {
    const startedAt = Date.now();
    const trackedPaths = this.getTrackedPaths();
    const whepUrl = new URL(this.whepBaseUrl);
    const whepHost = whepUrl.hostname || '127.0.0.1';
    const whepPort = whepUrl.port ? Number(whepUrl.port) : 80;

    while (Date.now() - startedAt < timeoutMs) {
      const whepReachable = await this.checkWhepPortReachable(whepHost, whepPort, 1500);

      try {
        const response = await this.fetchWithTimeout(this.localApiUrl, 2000);
        if (response.ok) {
          const body = (await response.json()) as { items?: Array<{ name?: string | undefined }> };
          const configuredPaths = new Set(
            Array.isArray(body.items) ? body.items.map((item) => item.name).filter((name): name is string => Boolean(name)) : [],
          );
          const allPresent = trackedPaths.every((pathConfig) => configuredPaths.has(pathConfig.streamPath));
          if (allPresent) {
            await this.logger?.info('[mediamtx] path sync confirmed', {
              pathCount: trackedPaths.length,
            });
            return true;
          }
        }
      } catch {
        if (trackedPaths.length === 0 && whepReachable) {
          return true;
        }
      }

      if (trackedPaths.length === 0 && whepReachable) {
        return true;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    await this.logger?.warn('[mediamtx] path sync wait timed out', {
      pathCount: trackedPaths.length,
      timeoutMs,
    });
    return false;
  }

  private startHealthChecks() {
    this.stopHealthChecks();
    this.healthTimer = setInterval(() => {
      void this.checkHealth();
    }, 10000);
  }

  private stopHealthChecks() {
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  private async checkHealth() {
    if (!this.isRunning()) {
      return;
    }

    const whepUrl = new URL(this.whepBaseUrl);
    const whepHost = whepUrl.hostname || '127.0.0.1';
    const whepPort = whepUrl.port ? Number(whepUrl.port) : 80;
    const whepReachable = await this.checkWhepPortReachable(whepHost, whepPort, 1500);
    if (this.lastWhepReachable !== whepReachable && !whepReachable) {
      await this.logger?.warn('[mediamtx] WHEP port unreachable', {
        baseUrl: this.whepBaseUrl,
        host: whepHost,
        port: whepPort,
      });
    } else if (this.lastWhepReachable !== whepReachable && whepReachable) {
      await this.logger?.info('[mediamtx] WHEP port reachable', {
        baseUrl: this.whepBaseUrl,
        host: whepHost,
        port: whepPort,
      });
    }
    this.lastWhepReachable = whepReachable;

    try {
      const response = await this.fetchWithTimeout(this.localApiUrl, 2000);
      const rawBody = await response.text();
      if (!response.ok) {
        await this.logger?.warn('[mediamtx] source failed', {
          status: response.status,
          apiUrl: this.localApiUrl,
          body: rawBody.slice(0, 500),
        });
        return;
      }

      const parsed = JSON.parse(rawBody) as { items?: Array<{ name?: string; sourceReady?: boolean | undefined }> };
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      for (const pathConfig of this.trackedPaths) {
        const match = items.find((item) => item.name === pathConfig.streamPath);
        if (match) {
          await this.logger?.info('[mediamtx] source ready', {
            cameraId: pathConfig.cameraId,
            streamPath: pathConfig.streamPath,
            sourceReady: match.sourceReady ?? null,
            whepUrl: pathConfig.webrtcUrl,
          });
        } else {
          await this.logger?.warn('[mediamtx] source failed', {
            cameraId: pathConfig.cameraId,
            streamPath: pathConfig.streamPath,
            whepUrl: pathConfig.webrtcUrl,
            error: 'Path missing from MediaMTX API list.',
          });
        }
      }
    } catch (error) {
      await this.logger?.warn('[mediamtx] source failed', {
        apiUrl: this.localApiUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async checkWhepPortReachable(host: string, port: number, timeoutMs: number) {
    return await new Promise<boolean>((resolve) => {
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
  }

  private resolveBinaryPath() {
    const candidates = new Set<string>();
    if (process.env.MEDIAMTX_BIN) {
      candidates.add(process.env.MEDIAMTX_BIN);
    }

    let current = this.repoRoot ? path.resolve(this.repoRoot) : process.cwd();
    while (true) {
      candidates.add(path.join(current, 'mediamtx', 'mediamtx.exe'));
      candidates.add(path.join(current, 'tools', 'mediamtx', 'mediamtx.exe'));
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    if (process.platform === 'win32') {
      const whereResult = spawnSync('where', ['mediamtx.exe'], {
        windowsHide: true,
        encoding: 'utf8',
      });
      const firstMatch = whereResult.stdout
        ?.split(/\r?\n/u)
        .map((entry) => entry.trim())
        .find(Boolean);
      if (firstMatch) {
        return firstMatch;
      }
    }

    return undefined;
  }
}
