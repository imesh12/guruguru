import dgram from 'node:dgram';
import net from 'node:net';

import type { FastifyBaseLogger } from 'fastify';

import type { GpsStateService, VehicleGpsUpdate } from './gps-state.js';

type ReceiverMode = 'udp' | 'tcp';
type ReceiverRuntimeStatus = 'DISABLED' | 'ONLINE' | 'OFFLINE' | 'ERROR';

type VehicleMapConfig = Record<string, string>;

type VehicleLookup = Record<
  string,
  {
    vehicleId: string;
    vehicleName: string;
  }
>;

type ParsedNmeaRecord = {
  sentenceType: '$GPRMC' | '$GNRMC' | '$GPGGA' | '$GNGGA';
  lat?: number | undefined;
  lng?: number | undefined;
  speed?: number | undefined;
  heading?: number | undefined;
  receivedAt: string;
};

type ReceiverConfig = {
  enabled: boolean;
  mode: ReceiverMode;
  port: number;
  vehicleMap: VehicleMapConfig;
};

type ReceiverStatusListener = (status: ReceiverRuntimeStatus) => void;

const vehicleLookup: VehicleLookup = {
  'vehicle-1': {
    vehicleId: 'vehicle-1',
    vehicleName: 'Vehicle 1',
  },
  'vehicle-2': {
    vehicleId: 'vehicle-2',
    vehicleName: 'Vehicle 2',
  },
};

const KNOTS_TO_KMH = 1.852;

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) {
    return fallback;
  }

  return value.toLowerCase() === 'true';
};

const parseMode = (value: string | undefined): ReceiverMode => {
  if (!value) {
    return 'udp';
  }

  if (value === 'udp' || value === 'tcp') {
    return value;
  }

  throw new Error(`Invalid SE220_RECEIVER_MODE "${value}". Expected "udp" or "tcp".`);
};

const parsePort = (value: string | undefined) => {
  const port = Number(value ?? 5010);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid SE220_RECEIVER_PORT "${value}". Expected an integer between 1 and 65535.`);
  }

  return port;
};

const parseVehicleMap = (raw: string | undefined) => {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Value is not an object.');
    }

    const entries = Object.entries(parsed);
    for (const [source, vehicleId] of entries) {
      if (typeof vehicleId !== 'string' || vehicleId.length === 0) {
        throw new Error(`Vehicle mapping for "${source}" must be a non-empty string.`);
      }
    }

    return Object.fromEntries(entries) as VehicleMapConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid SE220_VEHICLE_MAP JSON. ${message}`);
  }
};

const parseDecimalCoordinate = (raw: string, hemisphere: string, degreesDigits: 2 | 3) => {
  if (!raw || !hemisphere) {
    return undefined;
  }

  const degreesPart = raw.slice(0, degreesDigits);
  const minutesPart = raw.slice(degreesDigits);
  const degrees = Number(degreesPart);
  const minutes = Number(minutesPart);

  if (!Number.isFinite(degrees) || !Number.isFinite(minutes)) {
    return undefined;
  }

  const decimal = degrees + minutes / 60;
  return hemisphere === 'S' || hemisphere === 'W' ? -decimal : decimal;
};

const parseEnvelope = (line: string) => {
  const trimmed = line.trim();
  const match = /^receiver=([^;]+);(.*)$/i.exec(trimmed);
  if (!match) {
    return {
      receiverId: undefined,
      nmeaLine: trimmed,
    };
  }

  return {
    receiverId: match[1]?.trim(),
    nmeaLine: match[2]?.trim() ?? '',
  };
};

const parseRmc = (parts: string[]): ParsedNmeaRecord | null => {
  if (parts.length < 10 || parts[2] !== 'A') {
    return null;
  }

  const lat = parseDecimalCoordinate(parts[3] ?? '', parts[4] ?? '', 2);
  const lng = parseDecimalCoordinate(parts[5] ?? '', parts[6] ?? '', 3);
  if (lat === undefined || lng === undefined) {
    return null;
  }

  const speedKnots = Number(parts[7] ?? '');
  const heading = Number(parts[8] ?? '');

  return {
    sentenceType: parts[0] as ParsedNmeaRecord['sentenceType'],
    lat,
    lng,
    speed: Number.isFinite(speedKnots) ? Number((speedKnots * KNOTS_TO_KMH).toFixed(2)) : undefined,
    heading: Number.isFinite(heading) ? heading : undefined,
    receivedAt: new Date().toISOString(),
  };
};

const parseGga = (parts: string[]): ParsedNmeaRecord | null => {
  if (parts.length < 7) {
    return null;
  }

  const quality = Number(parts[6] ?? '');
  if (!Number.isFinite(quality) || quality <= 0) {
    return null;
  }

  const lat = parseDecimalCoordinate(parts[2] ?? '', parts[3] ?? '', 2);
  const lng = parseDecimalCoordinate(parts[4] ?? '', parts[5] ?? '', 3);
  if (lat === undefined || lng === undefined) {
    return null;
  }

  return {
    sentenceType: parts[0] as ParsedNmeaRecord['sentenceType'],
    lat,
    lng,
    receivedAt: new Date().toISOString(),
  };
};

export class Se220Receiver {
  private readonly gpsState: GpsStateService;
  private readonly logger: FastifyBaseLogger;
  private readonly config: ReceiverConfig;
  private udpServer?: dgram.Socket | undefined;
  private tcpServer?: net.Server | undefined;
  private readonly lastFixBySource = new Map<string, Partial<VehicleGpsUpdate>>();
  private runtimeStatus: ReceiverRuntimeStatus;
  private readonly statusListeners = new Set<ReceiverStatusListener>();

  constructor(gpsState: GpsStateService, logger: FastifyBaseLogger) {
    this.gpsState = gpsState;
    this.logger = logger;
    this.config = {
      enabled: parseBoolean(process.env.SE220_RECEIVER_ENABLED, false),
      mode: parseMode(process.env.SE220_RECEIVER_MODE),
      port: parsePort(process.env.SE220_RECEIVER_PORT),
      vehicleMap: parseVehicleMap(process.env.SE220_VEHICLE_MAP),
    };
    this.runtimeStatus = this.config.enabled ? 'OFFLINE' : 'DISABLED';
  }

  getConfig() {
    return this.config;
  }

  getStatus() {
    return this.runtimeStatus;
  }

  onStatusChanged(listener: ReceiverStatusListener) {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  async start() {
    if (!this.config.enabled) {
      this.setRuntimeStatus('DISABLED');
      this.logger.info('SE220 receiver is disabled.');
      return;
    }

    this.logger.info({ mode: this.config.mode, port: this.config.port }, 'Starting SE220 receiver');

    try {
      if (this.config.mode === 'udp') {
        await this.startUdp();
        this.setRuntimeStatus('ONLINE');
        return;
      }

      await this.startTcp();
      this.setRuntimeStatus('ONLINE');
    } catch (error) {
      this.setRuntimeStatus('ERROR');
      throw error;
    }
  }

  async stop() {
    try {
      await Promise.all([
        this.udpServer
          ? new Promise<void>((resolve) => {
              this.udpServer?.close(() => resolve());
              this.udpServer = undefined;
            })
          : Promise.resolve(),
        this.tcpServer
          ? new Promise<void>((resolve, reject) => {
              this.tcpServer?.close((error) => {
                this.tcpServer = undefined;
                if (error) {
                  reject(error);
                  return;
                }
                resolve();
              });
            })
          : Promise.resolve(),
      ]);
      this.setRuntimeStatus(this.config.enabled ? 'OFFLINE' : 'DISABLED');
    } catch (error) {
      this.setRuntimeStatus('ERROR');
      throw error;
    }
  }

  parseNmeaLine(line: string): ParsedNmeaRecord | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith('$')) {
      return null;
    }

    const withoutChecksum = trimmed.split('*', 1)[0] ?? trimmed;
    const parts = withoutChecksum.split(',');
    const sentenceType = parts[0];

    switch (sentenceType) {
      case '$GPRMC':
      case '$GNRMC':
        return parseRmc(parts);
      case '$GPGGA':
      case '$GNGGA':
        return parseGga(parts);
      default:
        return null;
    }
  }

  async handleNmeaLine(line: string, sourceId: string) {
    try {
      const envelope = parseEnvelope(line);
      const parsed = this.parseNmeaLine(envelope.nmeaLine);
      if (!parsed) {
        return;
      }

      const vehicleId =
        (envelope.receiverId ? this.config.vehicleMap[`receiver:${envelope.receiverId}`] : undefined) ??
        this.config.vehicleMap[sourceId];
      if (!vehicleId) {
        this.logger.warn({ sourceId, receiverId: envelope.receiverId, line }, 'Received NMEA data from unknown source');
        return;
      }

      const vehicle = vehicleLookup[vehicleId];
      if (!vehicle) {
        this.logger.warn({ sourceId, vehicleId }, 'SE220 source mapped to unknown vehicle id');
        return;
      }

      const previous = this.lastFixBySource.get(sourceId) ?? {};
      const next: VehicleGpsUpdate = {
        vehicleId: vehicle.vehicleId,
        vehicleName: vehicle.vehicleName,
        lat: parsed.lat ?? previous.lat ?? 0,
        lng: parsed.lng ?? previous.lng ?? 0,
        speed: parsed.speed ?? previous.speed,
        heading: parsed.heading ?? previous.heading,
        receivedAt: parsed.receivedAt,
      };

      if (parsed.lat === undefined || parsed.lng === undefined) {
        return;
      }

      this.lastFixBySource.set(sourceId, next);
      await this.gpsState.ingest(next);
    } catch (error) {
      this.logger.warn({ error, sourceId, line }, 'Failed to process NMEA line');
    }
  }

  private async startUdp() {
    await new Promise<void>((resolve, reject) => {
      const server = dgram.createSocket('udp4');
      this.udpServer = server;

      server.on('error', (error) => {
        this.setRuntimeStatus('ERROR');
        this.logger.error({ error }, 'SE220 UDP receiver error');
      });

      server.on('message', (message, remoteInfo) => {
        const lines = message
          .toString('utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        for (const line of lines) {
          void this.handleNmeaLine(line, remoteInfo.address);
        }
      });

      server.once('listening', () => resolve());
      server.once('error', (error) => reject(error));
      server.bind(this.config.port, '0.0.0.0');
    });
  }

  private async startTcp() {
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => {
        let buffer = '';
        const sourceId = socket.remoteAddress?.replace('::ffff:', '') ?? 'unknown';

        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf8');
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() ?? '';

          for (const line of lines.map((entry) => entry.trim()).filter(Boolean)) {
            void this.handleNmeaLine(line, sourceId);
          }
        });

        socket.on('error', (error) => {
          this.logger.warn({ error, sourceId }, 'SE220 TCP client socket error');
        });
      });

      this.tcpServer = server;

      server.on('error', (error) => {
        this.setRuntimeStatus('ERROR');
        this.logger.error({ error }, 'SE220 TCP receiver error');
      });

      server.once('listening', () => resolve());
      server.once('error', (error) => reject(error));
      server.listen(this.config.port, '0.0.0.0');
    });
  }

  private setRuntimeStatus(status: ReceiverRuntimeStatus) {
    if (this.runtimeStatus === status) {
      return;
    }

    this.runtimeStatus = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }
}
