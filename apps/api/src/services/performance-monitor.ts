import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RuntimeWatchdogService } from './runtime-watchdog.js';
import { resolveAppDataDir, resolveDatabaseUrl } from './runtime-config.js';

export type PerformanceSnapshot = {
  cpuUsagePct: number;
  memoryRssMb: number;
  memoryHeapMb: number;
  diskFreeMb: number | null;
  databaseSizeMb: number | null;
  gpuAvailable: boolean;
  gpuStatus: string;
  mpvProcessCount: number;
};

const round = (value: number) => Number(value.toFixed(1));

export class PerformanceMonitor {
  private lastCpuUsage = process.cpuUsage();
  private lastCpuSampleAt = process.hrtime.bigint();

  constructor(private readonly watchdog: RuntimeWatchdogService) {}

  async getSnapshot(): Promise<PerformanceSnapshot> {
    const nowCpuUsage = process.cpuUsage();
    const nowSampleAt = process.hrtime.bigint();
    const elapsedMicros = Number(nowSampleAt - this.lastCpuSampleAt) / 1000;
    const usageMicros =
      nowCpuUsage.user -
      this.lastCpuUsage.user +
      (nowCpuUsage.system - this.lastCpuUsage.system);

    const cpuUsagePct = elapsedMicros > 0 ? round((usageMicros / elapsedMicros / Math.max(1, os.cpus().length)) * 100) : 0;
    this.lastCpuUsage = nowCpuUsage;
    this.lastCpuSampleAt = nowSampleAt;

    const memory = process.memoryUsage();
    const diskFreeMb = await this.getDiskFreeMb();
    const databaseSizeMb = await this.getDatabaseSizeMb();
    const desktopDetails = this.watchdog.getDesktopDetails();

    return {
      cpuUsagePct,
      memoryRssMb: round(memory.rss / 1024 / 1024),
      memoryHeapMb: round(memory.heapUsed / 1024 / 1024),
      diskFreeMb,
      databaseSizeMb,
      gpuAvailable: desktopDetails?.gpuAvailable ?? false,
      gpuStatus: desktopDetails?.gpuStatus ?? 'Unavailable',
      mpvProcessCount: desktopDetails?.mpvProcessCount ?? 0,
    };
  }

  private async getDiskFreeMb() {
    try {
      const stats = await fs.statfs(resolveAppDataDir());
      return round((stats.bavail * stats.bsize) / 1024 / 1024);
    } catch {
      return null;
    }
  }

  private async getDatabaseSizeMb() {
    const databaseUrl = resolveDatabaseUrl();
    if (!databaseUrl.startsWith('file:')) {
      return null;
    }

    try {
      const databasePath = databaseUrl.replace(/^file:/, '').replace(/\//g, path.sep);
      const stats = await fs.stat(databasePath);
      return round(stats.size / 1024 / 1024);
    } catch {
      return null;
    }
  }
}
