import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type VehicleAgentConfig = {
  vehicleId: string;
  routeId: string | null;
  mockGnss: boolean;
  mockLatitude: number | null;
  mockLongitude: number | null;
  se220BaseUrl: string | null;
  se220Token: string | null;
  se220AllowSelfSigned: boolean;
  adminApiUrl: string;
  agentToken: string;
  pollIntervalMs: number;
  requestTimeoutMs: number;
};

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const stripOptionalQuotes = (value: string) => value.replace(/^['"]+|['"]+$/g, '').trim();

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  return value.trim().toLowerCase() === 'true';
};

const parsePositiveInteger = (key: string, value: string | undefined, fallback: number) => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key}. Expected a positive integer.`);
  }

  return parsed;
};

const parseCoordinate = (key: string, value: string | undefined, min: number, max: number) => {
  if (value === undefined || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${key}. Expected a number between ${min} and ${max}.`);
  }

  return parsed;
};

const readEnvFile = (filepath: string) => {
  if (!fs.existsSync(filepath)) {
    return;
  }

  const raw = fs.readFileSync(filepath, 'utf8');
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

const loadEnv = () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const candidatePaths = [path.resolve(process.cwd(), '.env'), path.join(packageRoot, '.env')];
  for (const filepath of candidatePaths) {
    readEnvFile(filepath);
  }
};

const requireNonEmpty = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${key}.`);
  }

  return value;
};

export const loadConfig = (): VehicleAgentConfig => {
  loadEnv();

  const vehicleId = requireNonEmpty('VEHICLE_ID');
  const routeId = process.env.ROUTE_ID?.trim() ? process.env.ROUTE_ID.trim() : null;
  const adminApiUrl = requireNonEmpty('ADMIN_API_URL').replace(/\/+$/u, '');
  const agentToken = requireNonEmpty('AGENT_TOKEN');
  const mockGnss = parseBoolean(process.env.MOCK_GNSS, false);
  const mockLatitude = parseCoordinate('MOCK_LATITUDE', process.env.MOCK_LATITUDE, -90, 90);
  const mockLongitude = parseCoordinate('MOCK_LONGITUDE', process.env.MOCK_LONGITUDE, -180, 180);
  const se220BaseUrl = mockGnss ? process.env.SE220_BASE_URL?.trim()?.replace(/\/+$/u, '') ?? null : requireNonEmpty('SE220_BASE_URL').replace(/\/+$/u, '');
  const se220Token = mockGnss ? process.env.SE220_TOKEN?.trim() ?? null : requireNonEmpty('SE220_TOKEN');

  if (mockGnss && (mockLatitude === null || mockLongitude === null)) {
    throw new Error('MOCK_LATITUDE and MOCK_LONGITUDE are required when MOCK_GNSS=true.');
  }

  return {
    vehicleId,
    routeId,
    mockGnss,
    mockLatitude,
    mockLongitude,
    se220BaseUrl,
    se220Token,
    se220AllowSelfSigned: parseBoolean(process.env.SE220_ALLOW_SELF_SIGNED, false),
    adminApiUrl,
    agentToken,
    pollIntervalMs: parsePositiveInteger('POLL_INTERVAL_MS', process.env.POLL_INTERVAL_MS, 1000),
    requestTimeoutMs: parsePositiveInteger('REQUEST_TIMEOUT_MS', process.env.REQUEST_TIMEOUT_MS, 3000),
  };
};
