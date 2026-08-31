import type { CallOrigin, CommandKind, ToolResult } from '../game/types';

/**
 * Browser-side backend types (contract §5 and §9).
 *
 * Nothing in `src/backend/` imports from `server/`. The only things that cross
 * the boundary are the Zod schemas and types in `shared/`, which is what makes
 * "no server-only module reaches the client bundle" checkable with a grep
 * rather than a promise.
 */

/* ------------------------------------------------------------------ *
 * Runtime modes
 * ------------------------------------------------------------------ */

export type RuntimeMode = 'local' | 'connected' | 'degraded' | 'replay';

/**
 * The exact strings contract §5 requires. `replay` has no mandated string, so
 * it reuses the local wording — a replay is a reconstruction, not a live link.
 *
 * "Never label fixture data as production or real infrastructure telemetry" is
 * why every one of these says *simulation*.
 */
export const RUNTIME_MODE_LABEL: Record<RuntimeMode, string> = {
  local: 'Local simulation',
  connected: 'Connected simulation',
  degraded: 'Offline, recording locally',
  replay: 'Local simulation',
};

/** Sync health, separate from the mode: a connected run can still be frozen. */
export type SyncState =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'queued'
  /** §9: replay signatures disagree. Gameplay continues; persistence stops. */
  | 'needs-review';

/** §9: the string the UI must show when signatures disagree. */
export const SYNC_REVIEW_LABEL = 'Run sync needs review';

export interface RuntimeStatus {
  mode: RuntimeMode;
  label: string;
  sync: SyncState;
  /** Commands written locally but not yet acknowledged by the server. */
  queuedCommands: number;
  lastAcknowledgedSeq: number;
  /** Set only in `needs-review`. */
  reviewReason: string | null;
}

/* ------------------------------------------------------------------ *
 * Queue records
 * ------------------------------------------------------------------ */

/**
 * One command awaiting acknowledgement.
 *
 * `seq` is the 1-based position in `GameContext.commandLog`, which is the same
 * number the API uses. It is not `GameContext.seq`.
 */
export interface QueuedCommand {
  seq: number;
  kind: CommandKind;
  origin: CallOrigin;
  input: unknown;
  incidentAtSec: number;
  stateVersionBefore: number;
  stateVersionAfter: number;
  result: ToolResult;
  clientStateHash: string;
  /** Transport retry key. Distinct from the engine's gameplay idempotency key. */
  idempotencyKey: string;
}

/** §9: never store the write token in a persisted command payload. */
export interface RunHandle {
  runId: string;
  expiresAt: string;
  initialStateHash: string;
}

/** The JSON offered for export when sync freezes (§9). */
export interface RunExport {
  exportedAt: string;
  runId: string | null;
  clientBuild: string;
  reason: string;
  localStateHash: string;
  serverStateHash: string | null;
  commands: QueuedCommand[];
}

export interface BackendClientError {
  code: string;
  message: string;
  recovery?: string;
  expectedSeq?: number;
  status: number;
}
