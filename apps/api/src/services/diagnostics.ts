import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import type { SystemStatusSnapshot } from './system-health.js';
import { sanitizeForLogs } from './redaction.js';
import { resolveAppDataDir, resolveDiagnosticsDir, resolveLogsDir } from './runtime-config.js';

const safeConfig = () => {
  const allowedKeys = [
    'APP_DATA_DIR',
    'API_HOST',
    'API_PORT',
    'DEMO_MODE',
    'GPS_HISTORY_DAYS',
    'GPS_ROUTE_HISTORY_RETENTION_DAYS',
    'LOG_RETENTION_DAYS',
    'SE220_RECEIVER_ENABLED',
    'SE220_RECEIVER_MODE',
    'SE220_RECEIVER_PORT',
    'VITE_MAPBOX_ACCESS_TOKEN',
  ] as const;

  return Object.fromEntries(
    allowedKeys.map((key) => [
      key,
      key === 'VITE_MAPBOX_ACCESS_TOKEN'
        ? process.env[key]
          ? '[SET]'
          : '[MISSING]'
        : process.env[key] ?? null,
    ]),
  );
};

const runCommand = async (command: string, args: string[], cwd?: string) =>
  new Promise<string>((resolve) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    child.once('error', () => resolve(`${command} unavailable`));
    child.once('exit', () => resolve(output.trim() || `${command} returned no output`));
  });

const copyRecentFiles = async (sourceDir: string, targetDir: string, prefix = '', take = 5) => {
  try {
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const fullPath = path.join(sourceDir, entry.name);
          const stats = await fs.stat(fullPath);
          return { fullPath, name: entry.name, mtimeMs: stats.mtimeMs };
        }),
    );

    await Promise.all(
      files
        .sort((left, right) => right.mtimeMs - left.mtimeMs)
        .slice(0, take)
        .map((file) => fs.copyFile(file.fullPath, path.join(targetDir, `${prefix}${file.name}`))),
    );
  } catch {
    // Best effort diagnostics export.
  }
};

const createZipArchive = async (directory: string, destinationPath: string) => {
  const parent = path.dirname(directory);
  const baseName = path.basename(directory);

  if (process.platform === 'win32') {
    const script = `Compress-Archive -Path "${path.join(directory, '*')}" -DestinationPath "${destinationPath}" -Force`;
    const result = await runCommand('powershell', ['-NoProfile', '-Command', script]);
    return result.includes('unavailable') ? null : destinationPath;
  }

  const result = await runCommand('zip', ['-r', destinationPath, baseName], parent);
  return result.includes('unavailable') ? null : destinationPath;
};

export const exportDiagnosticsBundle = async (snapshot: SystemStatusSnapshot) => {
  const diagnosticsDir = resolveDiagnosticsDir();
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const stagingDir = path.join(diagnosticsDir, `bundle-${timestamp}`);
  const zipPath = path.join(diagnosticsDir, `kurukuru-monitor-diagnostics-${timestamp}.zip`);
  const reportsDir = path.join(resolveAppDataDir(), 'reports');

  await fs.mkdir(stagingDir, { recursive: true });
  await fs.mkdir(path.join(stagingDir, 'logs'), { recursive: true });
  await fs.mkdir(path.join(stagingDir, 'reports'), { recursive: true });

  await fs.writeFile(path.join(stagingDir, 'system-status.json'), JSON.stringify(snapshot, null, 2), 'utf8');
  await fs.writeFile(path.join(stagingDir, 'config-safe.json'), JSON.stringify(sanitizeForLogs(safeConfig()), null, 2), 'utf8');

  const serviceStatus =
    process.platform === 'linux'
      ? await runCommand('systemctl', ['status', '--no-pager', 'kurukuru-api.service', 'kurukuru-desktop.service'])
      : 'Service status collection is only available on Linux.';
  await fs.writeFile(path.join(stagingDir, 'service-status.txt'), serviceStatus, 'utf8');

  await copyRecentFiles(resolveLogsDir(), path.join(stagingDir, 'logs'));
  await copyRecentFiles(reportsDir, path.join(stagingDir, 'reports'));

  await fs.mkdir(diagnosticsDir, { recursive: true });
  const zipped = await createZipArchive(stagingDir, zipPath);

  return {
    directoryPath: stagingDir,
    bundlePath: zipped ?? stagingDir,
    zipped: Boolean(zipped),
  };
};
