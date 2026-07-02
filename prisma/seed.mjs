import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '../.env');
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const stripOptionalQuotes = (value) => value.replace(/^['"]+|['"]+$/g, '').trim();

if (fs.existsSync(rootEnvPath)) {
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
}

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? 'file:./data/kurukuru.db',
});

const prisma = new PrismaClient({ adapter });

const demoVehicleIds = ['vehicle-1', 'vehicle-2', 'vehicle-3'];
const demoCameraIds = [
  'vehicle-1-front',
  'vehicle-1-internal',
  'vehicle-2-front',
  'vehicle-2-internal',
  'camera-axis-190',
  'camera-axis-187',
  'camera-axis-175',
];
const defaultLayoutId = 'layout-default';

const vehicles = [
  {
    id: 'vehicle-1',
    name: 'Vehicle 1',
    displayColor: '#ef4444',
  },
  {
    id: 'vehicle-2',
    name: 'Vehicle 2',
    displayColor: '#22c55e',
  },
];

const cameras = [
  {
    id: 'vehicle-1-front',
    vehicleId: 'vehicle-1',
    name: 'Vehicle 1 Front',
    type: 'FRONT',
    vendor: 'AXIS',
    host: process.env.CAMERA_V1_FRONT_RTSP_URL ?? '<CAMERA_HOST>',
    rtspPort: 554,
    customRtspUrl: null,
    qualityPreset: 'STANDARD',
    rtspUrl: `rtsp://${process.env.CAMERA_V1_FRONT_RTSP_URL ?? '<CAMERA_HOST>'}:554/axis-media/media.amp?videocodec=h264&resolution=1024x576&fps=10&compression=35`,
    username: process.env.CAMERA_V1_FRONT_USERNAME ?? '<RTSP_USERNAME>',
    password: process.env.CAMERA_V1_FRONT_PASSWORD ?? '<RTSP_PASSWORD>',
    enabled: true,
  },
  {
    id: 'vehicle-1-internal',
    vehicleId: 'vehicle-1',
    name: 'Vehicle 1 Internal',
    type: 'INTERNAL',
    vendor: 'AXIS',
    host: process.env.CAMERA_V1_INTERNAL_RTSP_URL ?? '<CAMERA_HOST>',
    rtspPort: 554,
    customRtspUrl: null,
    qualityPreset: 'STANDARD',
    rtspUrl: `rtsp://${process.env.CAMERA_V1_INTERNAL_RTSP_URL ?? '<CAMERA_HOST>'}:554/axis-media/media.amp?videocodec=h264&resolution=1024x576&fps=10&compression=35`,
    username: process.env.CAMERA_V1_INTERNAL_USERNAME ?? '<RTSP_USERNAME>',
    password: process.env.CAMERA_V1_INTERNAL_PASSWORD ?? '<RTSP_PASSWORD>',
    enabled: true,
  },
  {
    id: 'vehicle-2-front',
    vehicleId: 'vehicle-2',
    name: 'Vehicle 2 Front',
    type: 'FRONT',
    vendor: 'AXIS',
    host: process.env.CAMERA_V2_FRONT_RTSP_URL ?? '<CAMERA_HOST>',
    rtspPort: 554,
    customRtspUrl: null,
    qualityPreset: 'STANDARD',
    rtspUrl: `rtsp://${process.env.CAMERA_V2_FRONT_RTSP_URL ?? '<CAMERA_HOST>'}:554/axis-media/media.amp?videocodec=h264&resolution=1024x576&fps=10&compression=35`,
    username: process.env.CAMERA_V2_FRONT_USERNAME ?? '<RTSP_USERNAME>',
    password: process.env.CAMERA_V2_FRONT_PASSWORD ?? '<RTSP_PASSWORD>',
    enabled: true,
  },
  {
    id: 'vehicle-2-internal',
    vehicleId: 'vehicle-2',
    name: 'Vehicle 2 Internal',
    type: 'INTERNAL',
    vendor: 'AXIS',
    host: process.env.CAMERA_V2_INTERNAL_RTSP_URL ?? '<CAMERA_HOST>',
    rtspPort: 554,
    customRtspUrl: null,
    qualityPreset: 'STANDARD',
    rtspUrl: `rtsp://${process.env.CAMERA_V2_INTERNAL_RTSP_URL ?? '<CAMERA_HOST>'}:554/axis-media/media.amp?videocodec=h264&resolution=1024x576&fps=10&compression=35`,
    username: process.env.CAMERA_V2_INTERNAL_USERNAME ?? '<RTSP_USERNAME>',
    password: process.env.CAMERA_V2_INTERNAL_PASSWORD ?? '<RTSP_PASSWORD>',
    enabled: true,
  },
];

const layouts = [
  {
    id: defaultLayoutId,
    name: 'Default 4-Up Layout',
    active: true,
    slots: [
      { slotIndex: 1, cameraId: 'vehicle-1-front' },
      { slotIndex: 2, cameraId: 'vehicle-1-internal' },
      { slotIndex: 3, cameraId: 'vehicle-2-front' },
      { slotIndex: 4, cameraId: 'vehicle-2-internal' },
    ],
  },
];

const run = async () => {
  await prisma.layoutSlot.deleteMany({});
  await prisma.layoutConfig.deleteMany({});

  await prisma.gpsPoint.deleteMany({
    where: {
      vehicleId: {
        in: demoVehicleIds,
      },
    },
  });

  await prisma.camera.deleteMany({
    where: {
      id: {
        in: demoCameraIds,
      },
    },
  });

  await prisma.vehicle.deleteMany({
    where: {
      id: {
        in: demoVehicleIds,
      },
    },
  });

  for (const vehicle of vehicles) {
    await prisma.vehicle.create({
      data: vehicle,
    });
  }

  for (const camera of cameras) {
    await prisma.camera.create({
      data: camera,
    });
  }

  for (const layout of layouts) {
    await prisma.layoutConfig.create({
      data: {
        id: layout.id,
        name: layout.name,
        active: layout.active,
        slots: {
          create: layout.slots,
        },
      },
    });
  }
};

run()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
