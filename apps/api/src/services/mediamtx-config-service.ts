import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { decryptPassword } from './camera-credentials.js';
import { prisma } from './prisma.js';
import { resolveRtspUrl, sanitizeRtspUrl } from './rtsp-url.js';

type LoggerLike = {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
};

type MediaMtxPathConfig = {
  cameraId: string;
  source: string;
  sanitizedSource: string;
};

const CONFIG_DEBOUNCE_MS = 250;
const RESTART_DEBOUNCE_MS = 1500;
const RESTART_WAIT_AFTER_STOP_MS = 1000;

const isTruthy = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  return value.trim().toLowerCase() === 'true';
};

const toYamlScalar = (value: string) => `'${value.replace(/'/g, "''")}'`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MediaMtxConfigService {
  private configTimer: NodeJS.Timeout | null = null;
  private restartTimer: NodeJS.Timeout | null = null;
  private activeConfigRun: Promise<void> | null = null;
  private activeRestartRun: Promise<void> | null = null;
  private readonly pendingConfigReasons = new Set<string>();
  private readonly pendingRestartReasons = new Set<string>();

  constructor(private readonly logger: LoggerLike) {}

  isAutoRegenerateEnabled() {
    return isTruthy(process.env.MEDIAMTX_AUTO_REGENERATE, false);
  }

  private shouldRestartOnChange() {
    return isTruthy(process.env.MEDIAMTX_RESTART_ON_CHANGE, false);
  }

  private getServiceName() {
    return process.env.MEDIAMTX_SERVICE_NAME?.trim() || 'KurukuruMediaMTX';
  }

  private getConfigPath() {
    const explicit = process.env.MEDIAMTX_CONFIG_PATH?.trim();
    if (explicit) {
      return path.resolve(explicit);
    }

    const appDataDir = process.env.APP_DATA_DIR?.trim() || '.';
    return path.resolve(appDataDir, '..', 'mediamtx', 'mediamtx.yml');
  }

  private buildConfig(paths: MediaMtxPathConfig[]) {
    const lines = [
      'logLevel: info',
      'logDestinations: [stdout]',
      'logStructured: false',
      '',
      'rtsp: yes',
      'rtspAddress: :8554',
      '',
      'webrtc: yes',
      'webrtcAddress: :8889',
      '',
      'hls: yes',
      'hlsAddress: :8888',
      '',
      'pathDefaults:',
      '  rtspTransport: tcp',
      '  sourceOnDemand: yes',
      '  sourceOnDemandStartTimeout: 10s',
      '  sourceOnDemandCloseAfter: 10s',
      '',
    ];

    if (paths.length === 0) {
      lines.push('paths: {}');
      return `${lines.join('\n')}\n`;
    }

    lines.push('paths:');
    paths
      .slice()
      .sort((left, right) => left.cameraId.localeCompare(right.cameraId))
      .forEach((entry) => {
        lines.push(`  ${entry.cameraId}:`);
        lines.push(`    source: ${toYamlScalar(entry.source)}`);
      });

    return `${lines.join('\n')}\n`;
  }

  private async readCurrentConfig(configPath: string) {
    try {
      return await readFile(configPath, 'utf8');
    } catch {
      return null;
    }
  }

  private async collectEnabledCameraPaths() {
    const cameras = await prisma.camera.findMany({
      where: {
        enabled: true,
      },
      orderBy: [{ vehicleId: 'asc' }, { type: 'asc' }, { name: 'asc' }],
    });

    const configuredPaths: MediaMtxPathConfig[] = [];

    for (const camera of cameras) {
      const decryptedPassword = decryptPassword(camera.password);
      this.logger.info(
        {
          cameraId: camera.id,
          hasUsername: Boolean(camera.username?.trim()),
          hasPassword: Boolean(decryptedPassword),
        },
        '[mediamtx] credentials resolved',
      );

      if (camera.password && !decryptedPassword) {
        this.logger.warn(
          {
            cameraId: camera.id,
            vendor: camera.vendor,
            host: camera.host,
            reason: 'password-decrypt-failed',
          },
          '[mediamtx] camera skipped because password could not be decrypted',
        );
        continue;
      }

      const resolved = resolveRtspUrl({
        vendor: camera.vendor,
        host: camera.host,
        rtspPort: camera.rtspPort,
        username: camera.username,
        password: decryptedPassword,
        qualityPreset: camera.qualityPreset,
        customRtspUrl: camera.customRtspUrl,
        rtspUrl: camera.rtspUrl,
      });

      if (!resolved.rtspUrl || resolved.error) {
        this.logger.warn(
          {
            cameraId: camera.id,
            vendor: camera.vendor,
            host: camera.host,
            rtspPort: camera.rtspPort,
            error: resolved.error,
            sanitizedRtspUrl: resolved.sanitizedRtspUrl,
          },
          '[mediamtx] camera skipped because RTSP URL could not be resolved',
        );
        continue;
      }

      configuredPaths.push({
        cameraId: camera.id.trim(),
        source: resolved.rtspUrl,
        sanitizedSource: sanitizeRtspUrl(resolved.rtspUrl) ?? resolved.sanitizedRtspUrl ?? '[unavailable]',
      });

      this.logger.info(
        {
          cameraId: camera.id,
          pathName: camera.id.trim(),
          source: sanitizeRtspUrl(resolved.rtspUrl) ?? resolved.sanitizedRtspUrl ?? '[unavailable]',
        },
        '[mediamtx] path configured',
      );
    }

    return configuredPaths;
  }

  scheduleRegeneration(reason: string) {
    if (!this.isAutoRegenerateEnabled()) {
      return;
    }

    this.pendingConfigReasons.add(reason);
    if (this.configTimer) {
      clearTimeout(this.configTimer);
    }

    this.configTimer = setTimeout(() => {
      this.configTimer = null;
      void this.flushRegenerationQueue();
    }, CONFIG_DEBOUNCE_MS);
  }

  async regenerateNow(reason: string) {
    if (!this.isAutoRegenerateEnabled()) {
      return;
    }

    this.pendingConfigReasons.add(reason);
    if (this.configTimer) {
      clearTimeout(this.configTimer);
      this.configTimer = null;
    }

    await this.flushRegenerationQueue();
  }

  private async flushRegenerationQueue() {
    if (this.activeConfigRun) {
      await this.activeConfigRun;
      return;
    }

    const reasons = Array.from(this.pendingConfigReasons);
    this.pendingConfigReasons.clear();

    this.activeConfigRun = this.runRegeneration(reasons)
      .catch((error) => {
        this.logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            reasons,
          },
          '[mediamtx] config regeneration failed',
        );
      })
      .finally(() => {
        this.activeConfigRun = null;
      });

    await this.activeConfigRun;

    if (this.pendingConfigReasons.size > 0) {
      await this.flushRegenerationQueue();
    }
  }

  private async runRegeneration(reasons: string[]) {
    const configPath = this.getConfigPath();
    const configuredPaths = await this.collectEnabledCameraPaths();
    const nextConfig = this.buildConfig(configuredPaths);
    const currentConfig = await this.readCurrentConfig(configPath);

    if (currentConfig === nextConfig) {
      this.logger.info(
        {
          configPath,
          pathCount: configuredPaths.length,
          reasons,
        },
        '[mediamtx] config regenerated',
      );
      return;
    }

    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(configPath, nextConfig, 'utf8');

    this.logger.info(
      {
        configPath,
        pathCount: configuredPaths.length,
        reasons,
      },
      '[mediamtx] config regenerated',
    );

    if (this.shouldRestartOnChange()) {
      this.scheduleRestart(reasons);
    }
  }

  private scheduleRestart(reasons: string[]) {
    reasons.forEach((reason) => this.pendingRestartReasons.add(reason));

    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
    }

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.flushRestartQueue();
    }, RESTART_DEBOUNCE_MS);
  }

  private async flushRestartQueue() {
    if (this.activeRestartRun) {
      await this.activeRestartRun;
      return;
    }

    const reasons = Array.from(this.pendingRestartReasons);
    this.pendingRestartReasons.clear();

    this.activeRestartRun = this.restartService(reasons)
      .catch((error) => {
        this.logger.error(
          {
            error: error instanceof Error ? error.message : String(error),
            reasons,
          },
          '[mediamtx] restart failure',
        );
      })
      .finally(() => {
        this.activeRestartRun = null;
      });

    await this.activeRestartRun;

    if (this.pendingRestartReasons.size > 0) {
      await this.flushRestartQueue();
    }
  }

  private async runServiceCommand(args: string[]) {
    return await new Promise<{ code: number | null; stderr: string; stdout: string }>((resolve, reject) => {
      const child = spawn('sc', args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr?.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });

      child.once('error', reject);
      child.once('exit', (code) => {
        resolve({
          code,
          stderr: stderr.trim(),
          stdout: stdout.trim(),
        });
      });
    });
  }

  private async restartService(reasons: string[]) {
    const serviceName = this.getServiceName();

    this.logger.info(
      {
        serviceName,
        reasons,
      },
      '[mediamtx] restart requested',
    );

    if (process.platform !== 'win32') {
      this.logger.warn(
        {
          serviceName,
          reasons,
          platform: process.platform,
        },
        '[mediamtx] restart failure',
      );
      return;
    }

    const stopResult = await this.runServiceCommand(['stop', serviceName]);
    await delay(RESTART_WAIT_AFTER_STOP_MS);
    const startResult = await this.runServiceCommand(['start', serviceName]);

    if (startResult.code === 0) {
      this.logger.info(
        {
          serviceName,
          reasons,
          stopExitCode: stopResult.code,
          startExitCode: startResult.code,
        },
        '[mediamtx] restart success',
      );
      return;
    }

    this.logger.warn(
      {
        serviceName,
        reasons,
        stopExitCode: stopResult.code,
        stopStdout: stopResult.stdout,
        stopStderr: stopResult.stderr,
        startExitCode: startResult.code,
        startStdout: startResult.stdout,
        startStderr: startResult.stderr,
      },
      '[mediamtx] restart failure',
    );
  }
}
