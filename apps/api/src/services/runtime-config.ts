import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const rootEnvPath = path.join(workspaceRoot, '.env');
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const stripOptionalQuotes = (value: string) => value.replace(/^['"]+|['"]+$/g, '').trim();

let rootEnvLoaded = false;

const loadRootEnvFile = () => {
  if (rootEnvLoaded) {
    return;
  }

  rootEnvLoaded = true;

  if (!fs.existsSync(rootEnvPath)) {
    return;
  }

  const raw = fs.readFileSync(rootEnvPath, 'utf8');
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!ENV_KEY_PATTERN.test(key) || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = stripOptionalQuotes(trimmed.slice(separatorIndex + 1).trim());
  }
};

loadRootEnvFile();

export const resolveAppDataDir = () => {
  const value = process.env.APP_DATA_DIR ?? './data';
  return path.isAbsolute(value) ? value : path.resolve(workspaceRoot, value);
};

export const resolveLogsDir = () => path.resolve(resolveAppDataDir(), 'logs');

export const resolveDiagnosticsDir = () => path.resolve(resolveAppDataDir(), 'diagnostics');

export const getGpsHistoryDays = () => {
  const days = Number(process.env.GPS_HISTORY_DAYS ?? 30);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;
};

export const getGpsRouteHistoryRetentionDays = () => {
  const days = Number(process.env.GPS_ROUTE_HISTORY_RETENTION_DAYS ?? 7);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 7;
};

export const getLogRetentionDays = () => {
  const days = Number(process.env.LOG_RETENTION_DAYS ?? 14);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : 14;
};

export const resolveDatabaseUrl = () => {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) {
    if (!fromEnv.startsWith('file:./')) {
      return fromEnv;
    }

    const relativePath = fromEnv.slice('file:'.length);
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    return `file:${absolutePath.replace(/\\/g, '/')}`;
  }

  return `file:${path.resolve(workspaceRoot, 'data', 'kurukuru.db').replace(/\\/g, '/')}`;
};
