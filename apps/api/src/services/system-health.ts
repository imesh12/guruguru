import type { FastifyBaseLogger } from 'fastify';

import { exportDiagnosticsBundle } from './diagnostics.js';
import { FileLogger } from './file-logger.js';
import { PerformanceMonitor, type PerformanceSnapshot } from './performance-monitor.js';
import { prisma } from './prisma.js';
import { RuntimeWatchdogService, type DesktopHeartbeatPayload } from './runtime-watchdog.js';
import { sanitizeForLogs } from './redaction.js';
import type { GpsStateService } from './gps-state.js';
import type { Se220Receiver } from './se220-receiver.js';

type VehicleHealthStatus = 'ONLINE' | 'DELAYED' | 'OFFLINE';
type CameraHealthStatus = 'LIVE' | 'RECONNECTING' | 'OFFLINE';
type ReceiverHealthStatus = 'ONLINE' | 'OFFLINE' | 'ERROR' | 'DISABLED';
type DatabaseHealthStatus = 'ONLINE' | 'ERROR';
type ApiHealthStatus = 'ONLINE';
type EventLevel = 'INFO' | 'WARNING' | 'ERROR';

type CameraCatalogEntry = {
  cameraId: string;
  cameraName: string;
  vehicleId: string;
  vehicleName: string;
};

type CameraRuntimeState = CameraCatalogEntry & {
  status: CameraHealthStatus;
  lastChangedAt: string;
  message?: string | undefined;
};

type VehicleRuntimeState = {
  status: VehicleHealthStatus;
};

type DatabaseRuntimeState = {
  status: DatabaseHealthStatus;
  lastWriteAt: string | null;
  lastError: string | null;
};

export type SystemStatusSnapshot = {
  api: {
    status: ApiHealthStatus;
    uptimeSec: number;
  };
  gps: {
    vehicles: Array<{
      vehicleId: string;
      vehicleName: string;
      status: VehicleHealthStatus;
      lastUpdateAt: string;
      ageSec: number;
    }>;
  };
  cameras: Array<{
    cameraId: string;
    cameraName: string;
    vehicleName: string;
    status: CameraHealthStatus;
    lastChangedAt: string;
  }>;
  receiver: {
    enabled: boolean;
    mode: 'udp' | 'tcp';
    port: number;
    status: ReceiverHealthStatus;
  };
  database: DatabaseRuntimeState;
  watchdog: {
    api: {
      status: 'ONLINE' | 'DELAYED' | 'OFFLINE';
      lastSeenAt: string | null;
      ageSec: number | null;
      recoveryRecommendation: string | null;
    };
    desktop: {
      status: 'ONLINE' | 'DELAYED' | 'OFFLINE';
      lastSeenAt: string | null;
      ageSec: number | null;
      recoveryRecommendation: string | null;
    };
  };
  performance: PerformanceSnapshot;
  alerts: string[];
  maintenance: {
    gpsHistoryDays: number;
    lastCleanupAt: string | null;
  };
};

const toVehicleStatus = (ageSec: number): VehicleHealthStatus => {
  if (ageSec <= 5) {
    return 'ONLINE';
  }
  if (ageSec <= 15) {
    return 'DELAYED';
  }
  return 'OFFLINE';
};

const toDatabaseEventLevel = (status: DatabaseHealthStatus): EventLevel => (status === 'ERROR' ? 'ERROR' : 'INFO');

export class SystemHealthService {
  private readonly startedAt = Date.now();
  private readonly gpsStatuses = new Map<string, VehicleRuntimeState>();
  private readonly cameraStatuses = new Map<string, CameraRuntimeState>();
  private readonly cameraCatalog = new Map<string, CameraCatalogEntry>();
  private databaseState: DatabaseRuntimeState = {
    status: 'ONLINE',
    lastWriteAt: null,
    lastError: null,
  };
  private receiverStatus: ReceiverHealthStatus;
  private readonly watchdog = new RuntimeWatchdogService();
  private readonly performanceMonitor = new PerformanceMonitor(this.watchdog);
  private readonly apiLog = new FileLogger('api');
  private readonly gpsLog = new FileLogger('gps');
  private readonly fieldTestLog = new FileLogger('field-test');
  private heartbeatTimer?: NodeJS.Timeout | undefined;
  private activeVehicleIds = new Set<string>();

  constructor(
    private readonly gpsState: GpsStateService,
    private readonly receiver: Se220Receiver,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.receiverStatus = receiver.getStatus();

    this.receiver.onStatusChanged((status) => {
      void this.handleReceiverStatus(status);
    });
  }

  async initialize() {
    await this.refreshCameraCatalog();
    this.databaseState = this.gpsState.getDatabaseWriteStatus();
    this.watchdog.beatApi();
    this.heartbeatTimer = setInterval(() => {
      this.watchdog.beatApi();
    }, 5000);
    await this.apiLog.info('System health service initialized.');
  }

  async getSnapshot(): Promise<SystemStatusSnapshot> {
    await this.refreshCameraCatalog();
    await this.updateDatabaseStatus();

    const now = Date.now();
    const gpsVehicles = this.gpsState
      .listLatestForVehicleIds(this.activeVehicleIds)
      .map((vehicle) => {
        const ageSec = Math.max(0, Math.floor((now - new Date(vehicle.receivedAt).getTime()) / 1000));
        const status = toVehicleStatus(ageSec);
        void this.handleVehicleStatusTransition(vehicle.vehicleId, vehicle.vehicleName, status, vehicle.receivedAt);

        return {
          vehicleId: vehicle.vehicleId,
          vehicleName: vehicle.vehicleName,
          status,
          lastUpdateAt: vehicle.receivedAt,
          ageSec,
        };
      })
      .sort((left, right) => left.vehicleId.localeCompare(right.vehicleId));

    const cameras = Array.from(this.cameraStatuses.values())
      .map((camera) => ({
        cameraId: camera.cameraId,
        cameraName: camera.cameraName,
        vehicleName: camera.vehicleName,
        status: camera.status,
        lastChangedAt: camera.lastChangedAt,
      }))
      .sort((left, right) => left.cameraId.localeCompare(right.cameraId));

    const performance = await this.performanceMonitor.getSnapshot();
    const apiHeartbeat = this.watchdog.getSnapshot('api');
    const desktopHeartbeat = this.watchdog.getSnapshot('desktop');
    const maintenance = this.gpsState.getMaintenanceStatus();
    const alerts = this.buildAlerts(gpsVehicles, cameras);

    return {
      api: {
        status: 'ONLINE',
        uptimeSec: Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)),
      },
      gps: {
        vehicles: gpsVehicles,
      },
      cameras,
      receiver: {
        enabled: this.receiver.getConfig().enabled,
        mode: this.receiver.getConfig().mode,
        port: this.receiver.getConfig().port,
        status: this.receiverStatus,
      },
      database: this.databaseState,
      watchdog: {
        api: apiHeartbeat,
        desktop: desktopHeartbeat,
      },
      performance,
      alerts,
      maintenance: {
        gpsHistoryDays: maintenance.retentionDays,
        lastCleanupAt: maintenance.lastMaintenanceAt,
      },
    };
  }

  async reportDesktopHeartbeat(payload: DesktopHeartbeatPayload) {
    this.watchdog.beatDesktop(payload);
  }

  async exportDiagnostics() {
    const snapshot = await this.getSnapshot();
    const bundle = await exportDiagnosticsBundle(snapshot);
    await this.apiLog.info('Diagnostics bundle exported.', bundle);
    return bundle;
  }

  async logRecoveryAttempt(action: string, outcome: 'started' | 'completed' | 'failed', details?: string) {
    const message = `Recovery action ${action} ${outcome}${details ? `: ${details}` : ''}`;
    await this.apiLog.warn(message);
    await this.recordEvent(
      outcome === 'failed' ? 'ERROR' : 'WARNING',
      `recovery.${action}.${outcome}`,
      message,
    );
  }

  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  async reportCameraStatus(input: {
    cameraId: string;
    status: CameraHealthStatus;
    message?: string | undefined;
    timestamp: string;
  }) {
    await this.ensureCameraCatalog();
    const metadata = this.cameraCatalog.get(input.cameraId);
    if (!metadata) {
      this.logger.warn({ cameraId: input.cameraId }, 'Received camera status for unknown camera');
      return;
    }

    const previous = this.cameraStatuses.get(input.cameraId);
    if (previous?.status === input.status) {
      return;
    }

    const nextState: CameraRuntimeState = {
      ...metadata,
      status: input.status,
      lastChangedAt: input.timestamp,
      message: input.message,
    };

    this.cameraStatuses.set(input.cameraId, nextState);

    if (input.status === 'LIVE' && previous && previous.status !== 'LIVE') {
      await this.recordEvent('INFO', 'camera.recovered', `${metadata.cameraName} for ${metadata.vehicleName} recovered to LIVE.`);
      await this.apiLog.info('Camera recovered.', { cameraId: metadata.cameraId, cameraName: metadata.cameraName, vehicleName: metadata.vehicleName });
      return;
    }

    if (input.status !== 'LIVE') {
      const detail = input.message ? ` ${input.message}` : '';
      await this.recordEvent('WARNING', 'camera.offline', `${metadata.cameraName} for ${metadata.vehicleName} is ${input.status}.${detail}`.trim());
      await this.apiLog.warn('Camera degraded.', { cameraId: metadata.cameraId, status: input.status, message: input.message });
    }
  }

  private async ensureCameraCatalog() {
    await this.refreshCameraCatalog();
  }

  private async refreshCameraCatalog() {
    const [vehicles, cameras] = await Promise.all([
      prisma.vehicle.findMany({
        where: {
          enabled: true,
        },
        select: {
          id: true,
          name: true,
        },
        orderBy: {
          id: 'asc',
        },
      }),
      prisma.camera.findMany({
        where: {
          enabled: true,
          vehicle: {
            enabled: true,
          },
        },
        include: {
          vehicle: true,
        },
        orderBy: {
          id: 'asc',
        },
      }),
    ]);

    this.activeVehicleIds = new Set<string>(vehicles.map((vehicle: { id: string }) => vehicle.id));
    const activeCameraIds = new Set<string>(cameras.map((camera: { id: string }) => camera.id));

    this.gpsState.pruneOrphanVehicles(this.activeVehicleIds);
    for (const vehicleId of Array.from(this.gpsStatuses.keys())) {
      if (!this.activeVehicleIds.has(vehicleId)) {
        this.gpsStatuses.delete(vehicleId);
      }
    }

    for (const cameraId of Array.from(this.cameraStatuses.keys())) {
      if (!activeCameraIds.has(cameraId)) {
        this.cameraStatuses.delete(cameraId);
      }
    }

    this.cameraCatalog.clear();
    for (const camera of cameras) {
      const catalogEntry: CameraCatalogEntry = {
        cameraId: camera.id,
        cameraName: camera.name,
        vehicleId: camera.vehicleId,
        vehicleName: camera.vehicle.name,
      };
      this.cameraCatalog.set(camera.id, catalogEntry);

      const existing = this.cameraStatuses.get(camera.id);
      if (!existing) {
        this.cameraStatuses.set(camera.id, {
          ...catalogEntry,
          status: 'OFFLINE',
          lastChangedAt: new Date(this.startedAt).toISOString(),
        });
        continue;
      }

      this.cameraStatuses.set(camera.id, {
        ...existing,
        ...catalogEntry,
      });
    }
  }

  async pruneOrphanRuntimeState() {
    await this.refreshCameraCatalog();
    const allCameraIds = new Set(
      (
        await prisma.camera.findMany({
          select: {
            id: true,
          },
        })
      ).map((camera: { id: string }) => camera.id),
    );
    const orphanLayoutSlots = (
      await prisma.layoutSlot.findMany({
        where: {
          cameraId: {
            not: null,
          },
        },
        select: {
          id: true,
          cameraId: true,
        },
      })
    ).filter((slot: { id: string; cameraId: string | null }) => slot.cameraId && !allCameraIds.has(slot.cameraId));

    const clearedLayoutSlotCount =
      orphanLayoutSlots.length === 0
        ? 0
        : (
            await prisma.layoutSlot.updateMany({
              where: {
                id: {
                  in: orphanLayoutSlots.map((slot: { id: string }) => slot.id),
                },
              },
              data: {
                cameraId: null,
              },
            })
          ).count;

    const gpsPrune = await this.gpsState.pruneOrphanGpsHistory();

    return {
      activeVehicleCount: this.activeVehicleIds.size,
      activeCameraCount: this.cameraCatalog.size,
      clearedLayoutSlotCount,
      removedRuntimeVehicleCount: gpsPrune.removedRuntimeCount,
      deletedGpsPointCount: gpsPrune.deletedGpsPointCount,
      orphanVehicleIds: gpsPrune.orphanVehicleIds,
    };
  }

  private async handleVehicleStatusTransition(vehicleId: string, vehicleName: string, status: VehicleHealthStatus, lastUpdateAt: string) {
    const previous = this.gpsStatuses.get(vehicleId);
    if (previous?.status === status) {
      return;
    }

    this.gpsStatuses.set(vehicleId, { status });
    if (status === 'OFFLINE') {
      await this.recordEvent('WARNING', 'gps.offline', `${vehicleName} GPS is OFFLINE. Last update at ${lastUpdateAt}.`);
      await this.gpsLog.warn('Vehicle GPS offline.', { vehicleId, vehicleName, lastUpdateAt });
      return;
    }

    if (previous?.status === 'OFFLINE') {
      await this.recordEvent('INFO', 'gps.recovered', `${vehicleName} GPS recovered to ${status}.`);
      await this.gpsLog.info('Vehicle GPS recovered.', { vehicleId, vehicleName, status });
    }
  }

  private async updateDatabaseStatus() {
    const nextState = this.gpsState.getDatabaseWriteStatus();
    if (
      nextState.status === this.databaseState.status &&
      nextState.lastWriteAt === this.databaseState.lastWriteAt &&
      nextState.lastError === this.databaseState.lastError
    ) {
      return;
    }

    const previous = this.databaseState;
    this.databaseState = nextState;

    if (previous.status !== nextState.status) {
      if (nextState.status === 'ERROR') {
        await this.recordEvent(toDatabaseEventLevel(nextState.status), 'database.write-error', `Database writes are failing. ${nextState.lastError ?? 'Unknown error'}`);
        await this.apiLog.error('Database write error.', { lastError: nextState.lastError });
        return;
      }

      await this.recordEvent('INFO', 'database.recovered', 'Database writes recovered.');
      await this.apiLog.info('Database write status recovered.');
    }
  }

  private async handleReceiverStatus(status: ReceiverHealthStatus) {
    const previous = this.receiverStatus;
    if (previous === status) {
      return;
    }

    this.receiverStatus = status;

    if (status === 'ONLINE') {
      await this.recordEvent('INFO', 'receiver.started', `SE220 receiver started in ${this.receiver.getConfig().mode.toUpperCase()} mode on port ${this.receiver.getConfig().port}.`);
      await this.apiLog.info('Receiver online.', this.receiver.getConfig() as unknown as Record<string, unknown>);
      return;
    }

    if (status === 'OFFLINE') {
      await this.recordEvent('WARNING', 'receiver.stopped', 'SE220 receiver stopped.');
      await this.apiLog.warn('Receiver offline.');
      return;
    }

    if (status === 'ERROR') {
      await this.recordEvent('ERROR', 'receiver.error', 'SE220 receiver encountered an error.');
      await this.apiLog.error('Receiver error.');
    }
  }

  private async recordEvent(level: EventLevel, type: string, message: string) {
    try {
      await prisma.systemEvent.create({
        data: {
          level,
          type,
          message,
        },
      });
    } catch (error) {
      this.logger.error(sanitizeForLogs({ error, type, message }) as Record<string, unknown>, 'Failed to persist system event');
    }
  }

  getFieldTestLogger() {
    return this.fieldTestLog;
  }

  private buildAlerts(
    vehicles: Array<{ status: VehicleHealthStatus }>,
    cameras: Array<{ status: CameraHealthStatus }>,
  ) {
    const alerts: string[] = [];
    if (this.watchdog.getSnapshot('desktop').status === 'OFFLINE') {
      alerts.push('Desktop heartbeat is offline.');
    }
    if (this.receiverStatus !== 'ONLINE' && this.receiver.getConfig().enabled) {
      alerts.push('GPS receiver is not currently online.');
    }
    if (cameras.length > 0 && cameras.every((camera) => camera.status === 'OFFLINE')) {
      alerts.push('All configured camera sessions are offline.');
    }
    if (vehicles.length > 0 && vehicles.every((vehicle) => vehicle.status === 'OFFLINE')) {
      alerts.push('All vehicles are currently offline on GPS.');
    }
    if (this.databaseState.status === 'ERROR') {
      alerts.push('Database writes are failing.');
    }
    return alerts;
  }
}
