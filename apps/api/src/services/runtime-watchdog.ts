type HeartbeatSource = 'api' | 'desktop';
type HeartbeatStatus = 'ONLINE' | 'DELAYED' | 'OFFLINE';

export type HeartbeatSnapshot = {
  source: HeartbeatSource;
  status: HeartbeatStatus;
  lastSeenAt: string | null;
  ageSec: number | null;
  recoveryRecommendation: string | null;
};

export type DesktopHeartbeatPayload = {
  timestamp: string;
  mpvProcessCount: number;
  gpuAvailable: boolean;
  gpuStatus: string;
};

const WATCHDOG_DELAYED_SEC = Number(process.env.WATCHDOG_DELAYED_SEC ?? 15);
const WATCHDOG_OFFLINE_SEC = Number(process.env.WATCHDOG_OFFLINE_SEC ?? 45);

const toStatus = (ageSec: number | null): HeartbeatStatus => {
  if (ageSec === null) {
    return 'OFFLINE';
  }
  if (ageSec <= WATCHDOG_DELAYED_SEC) {
    return 'ONLINE';
  }
  if (ageSec <= WATCHDOG_OFFLINE_SEC) {
    return 'DELAYED';
  }
  return 'OFFLINE';
};

export class RuntimeWatchdogService {
  private apiHeartbeatAt = new Date().toISOString();
  private desktopHeartbeatAt: string | null = null;
  private desktopDetails: DesktopHeartbeatPayload | null = null;

  beatApi(timestamp = new Date().toISOString()) {
    this.apiHeartbeatAt = timestamp;
  }

  beatDesktop(payload: DesktopHeartbeatPayload) {
    this.desktopHeartbeatAt = payload.timestamp;
    this.desktopDetails = payload;
  }

  getDesktopDetails() {
    return this.desktopDetails;
  }

  getSnapshot(source: HeartbeatSource): HeartbeatSnapshot {
    const lastSeenAt = source === 'api' ? this.apiHeartbeatAt : this.desktopHeartbeatAt;
    const ageSec = lastSeenAt ? Math.max(0, Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / 1000)) : null;
    const status = toStatus(ageSec);

    return {
      source,
      status,
      lastSeenAt,
      ageSec,
      recoveryRecommendation:
        status === 'OFFLINE'
          ? source === 'desktop'
            ? 'Consider restarting the desktop service or checking the graphical session.'
            : 'Consider restarting the local API service.'
          : status === 'DELAYED'
            ? `Investigate ${source} responsiveness before a full restart.`
            : null,
    };
  }
}
