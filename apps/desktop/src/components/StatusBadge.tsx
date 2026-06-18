import type { SystemStatusTone } from '../types';
import { StatusIndicator } from './ui';

type StatusBadgeProps = {
  status: SystemStatusTone;
};

const toneMap: Record<SystemStatusTone, 'normal' | 'warning' | 'error' | 'offline'> = {
  ONLINE: 'normal',
  LIVE: 'normal',
  ACTIVE: 'normal',
  DELAYED: 'warning',
  RECONNECTING: 'warning',
  OFFLINE: 'error',
  ERROR: 'error',
  DISABLED: 'offline',
  PASSED: 'normal',
  FAILED: 'error',
};

export function StatusBadge({ status }: StatusBadgeProps) {
  return <StatusIndicator label={status} tone={toneMap[status]} />;
}
