/**
 * The browser-side backend surface.
 *
 * A UI pass should only ever need this module. In particular
 * `useRuntimeStatus`/`statusLabel` give the §5 indicator everything it needs
 * without importing a client, so adding the badge cannot accidentally turn on
 * networking.
 */

export { BackendClient, BackendRequestError, createBackendClient } from './client';
export type { BackendClientOptions } from './client';

export {
  contiguousSuffix,
  createIndexedDbQueue,
  createMemoryQueue,
  type OfflineQueue,
} from './offlineQueue';

export {
  RunSyncController,
  createSessionTokenStore,
  type RunSyncOptions,
  type RuntimeLike,
  type TokenStore,
} from './runSync';

export {
  RuntimeModeStore,
  runtimeModeStore,
  statusLabel,
  useRuntimeMode,
  useRuntimeStatus,
} from './runtimeMode';

export {
  EventDeduplicator,
  type TelemetryAdapter,
  type TelemetryAdapterListener,
  type TelemetryConnectionState,
} from './TelemetryAdapter';

export { LocalScenarioAdapter } from './LocalScenarioAdapter';
export { SseTelemetryAdapter } from './SseTelemetryAdapter';

export {
  RUNTIME_MODE_LABEL,
  SYNC_REVIEW_LABEL,
  type QueuedCommand,
  type RunExport,
  type RunHandle,
  type RuntimeMode,
  type RuntimeStatus,
  type SyncState,
} from './types';
