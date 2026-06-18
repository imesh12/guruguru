import type { LocationProviderStatusSnapshot } from './types.js';

/**
 * Contract for backend location providers.
 *
 * Implementations can poll hardware, receive push updates from agents, or read
 * from another source, but they must stay UI-independent.
 */
export interface LocationProvider {
  readonly id: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): LocationProviderStatusSnapshot;
}
