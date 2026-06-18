import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFilePath = path.join(repoRoot, '.env');
const require = createRequire(import.meta.url);
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { PrismaClient } = require('@prisma/client');

const stripOptionalQuotes = (value) => value.replace(/^['"]+|['"]+$/g, '').trim();

const applyEnvFileOverrides = (filePath) => {
  const raw = readFileSync(filePath, 'utf8');
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
    if (!key) {
      continue;
    }

    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = stripOptionalQuotes(rawValue);
  }
};

if (existsSync(envFilePath)) {
  process.loadEnvFile?.(envFilePath);
  applyEnvFileOverrides(envFilePath);
}

const apiBaseUrl = process.env.VITE_API_BASE_URL?.trim() || 'http://127.0.0.1:4000';
const apiToken = process.env.API_TOKEN?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim() || 'file:./data/kurukuru.db';

const callApiMaintenance = async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`${apiBaseUrl}/system/maintenance/prune-orphans`, {
      method: 'POST',
      headers: {
        ...(apiToken ? { authorization: `Bearer ${apiToken}` } : {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const pruneLocally = async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({
      url: databaseUrl,
      timeout: 5000,
    }),
  });

  try {
    await prisma.$executeRawUnsafe('PRAGMA foreign_keys = ON');
    await prisma.$executeRawUnsafe('PRAGMA busy_timeout = 5000');
    const [vehicles, cameras, slots, gpsVehicleIds] = await Promise.all([
      prisma.vehicle.findMany({
        select: {
          id: true,
        },
      }),
      prisma.camera.findMany({
        select: {
          id: true,
        },
      }),
      prisma.layoutSlot.findMany({
        where: {
          cameraId: {
            not: null,
          },
        },
        select: {
          id: true,
          cameraId: true,
        },
      }),
      prisma.gpsPoint.findMany({
        select: {
          vehicleId: true,
        },
      }),
    ]);

    const validVehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
    const validCameraIds = new Set(cameras.map((camera) => camera.id));
    const orphanLayoutSlotIds = slots.filter((slot) => slot.cameraId && !validCameraIds.has(slot.cameraId)).map((slot) => slot.id);
    const orphanVehicleIds = Array.from(new Set(gpsVehicleIds.map((entry) => entry.vehicleId).filter((vehicleId) => !validVehicleIds.has(vehicleId))));

    const clearedLayoutSlotCount =
      orphanLayoutSlotIds.length === 0
        ? 0
        : (
            await prisma.layoutSlot.updateMany({
              where: {
                id: {
                  in: orphanLayoutSlotIds,
                },
              },
              data: {
                cameraId: null,
              },
            })
          ).count;

    const deletedGpsPointCount =
      orphanVehicleIds.length === 0
        ? 0
        : (
            await prisma.gpsPoint.deleteMany({
              where: {
                vehicleId: {
                  in: orphanVehicleIds,
                },
              },
            })
          ).count;

    return {
      status: 'ok',
      mode: 'local-db',
      result: {
        activeVehicleCount: vehicles.length,
        activeCameraCount: cameras.length,
        clearedLayoutSlotCount,
        removedRuntimeVehicleCount: 0,
        deletedGpsPointCount,
        orphanVehicleIds,
      },
      note: 'Runtime camera and vehicle status maps are pruned automatically by the API on the next status or GPS request.',
    };
  } finally {
    await prisma.$disconnect();
  }
};

const main = async () => {
  try {
    const result = await callApiMaintenance();
    console.log(JSON.stringify({ mode: 'api', ...result }, null, 2));
    return;
  } catch (error) {
    console.warn(`[maintenance:prune-orphans] API maintenance unavailable, falling back to local DB cleanup: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = await pruneLocally();
  console.log(JSON.stringify(result, null, 2));
};

await main();
