import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { resolveDatabaseUrl } from './runtime-config.js';

const require = createRequire(import.meta.url);
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3') as {
  PrismaBetterSqlite3: typeof import('@prisma/adapter-better-sqlite3').PrismaBetterSqlite3;
};
const { PrismaClient } = require('@prisma/client') as {
  PrismaClient: new (options: { adapter: unknown }) => any;
};

const dbUrl = resolveDatabaseUrl();
const dbPath = dbUrl.replace(/^file:/, "");
if (dbPath !== ':memory:') {
  const dbDir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

const adapter = new PrismaBetterSqlite3({
  url: dbUrl,
  timeout: 5000,
});

export const prisma = new PrismaClient({ adapter });
export const CRITICAL_TABLES = ['Vehicle', 'Camera', 'LayoutConfig', 'LayoutSlot', 'GpsPoint', 'VehicleRoutePoint', 'SystemEvent', 'AppSetting'] as const;

let pragmasInitialized = false;

export const initializeSqlitePragmas = async () => {
  if (pragmasInitialized) {
    return;
  }

  await prisma.$executeRawUnsafe('PRAGMA journal_mode = WAL');
  await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000');
  await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  pragmasInitialized = true;
};

export const checkDatabaseReachable = async () => {
  await prisma.$queryRawUnsafe('SELECT 1');
  return true;
};

export const getExistingTables = async () => {
  const rows = (await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
  )) as Array<{ name: string }>;

  return rows.map((row) => row.name);
};
