import * as z from 'zod';

import { COMMAND_KINDS, SCORE_BUCKET_MAX } from '../src/game/types';
import type { ScoreBucket } from '../src/game/types';

/**
 * The wire contract, shared verbatim by the Fastify routes and the browser
 * client so neither side can drift from `docs/BACKEND_RUNTIME_CONTRACT.md` §6.
 *
 * Two sequence numbers exist in this system and confusing them is the easiest
 * way to break replay, so it is stated once here:
 *
 * - `GameContext.seq` counts *every* command the engine sees, including
 *   `get_incident` polls, rejected calls and idempotency-cache hits. It is
 *   local audit metadata and is never sent.
 * - The API's `seq` is the 1-based position of a command in
 *   `GameContext.commandLog`, which the engine appends to only when a command
 *   commits. That log is the entire replay seed, so mirroring its growth is
 *   what the backend persists and verifies.
 */

/* ------------------------------------------------------------------ *
 * Limits
 * ------------------------------------------------------------------ */

export const API_LIMITS = {
  /** §10: cap JSON body size at 256 KB. */
  maxBodyBytes: 256 * 1024,
  /** §6: scenario generation input at 16 KB. */
  maxGenerationBodyBytes: 16 * 1024,
  /** §6: maximum 50 commands per batch. */
  maxBatchCommands: 50,
  /** §6: default 100, maximum 500. */
  defaultCommandPageSize: 100,
  maxCommandPageSize: 500,
  /** §6: anonymous runs expire after seven days. */
  runTtlMs: 7 * 24 * 60 * 60 * 1000,
  /** Bounded so a hostile client cannot store an unbounded blob per command. */
  maxCommandJsonBytes: 32 * 1024,
  maxIdempotencyKeyLength: 128,
  maxClientBuildLength: 120,
} as const;

export const API_BASE_PATH = '/api/v1';

/* ------------------------------------------------------------------ *
 * Envelope
 * ------------------------------------------------------------------ */

export const API_ERROR_CODES = [
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'REPLAY_MISMATCH',
  'INTERNAL',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiSuccess<T> {
  ok: true;
  requestId: string;
  data: T;
}

export interface ApiFailure {
  ok: false;
  requestId: string;
  error: {
    code: ApiErrorCode;
    message: string;
    recovery?: string;
    /** Only ever set for a CONFLICT on a skipped sequence. */
    expectedSeq?: number;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/** HTTP status for each error code. One table, so routes cannot disagree. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  REPLAY_MISMATCH: 409,
  INTERNAL: 500,
};

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** 128 bits of randomness, base64url encoded: 22 characters. */
export const idSchema = z
  .string()
  .min(16)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url');

export const runIdSchema = z
  .string()
  .regex(/^run_[A-Za-z0-9_-]{16,64}$/, 'must be a run id');

export const stateHashSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, 'must be sha256:<hex>');

export const commandKindSchema = z.enum(
  COMMAND_KINDS as unknown as [string, ...string[]],
);

export const originSchema = z.enum(['human', 'agent']);

export const toolErrorSchema = z.object({
  code: z.enum(['INVALID_INPUT', 'STALE_STATE', 'ACTION_NOT_ALLOWED', 'NOT_FOUND']),
  message: z.string().max(2000),
  recovery: z.string().max(2000).optional(),
});

export const toolResultSchema = z.object({
  ok: z.boolean(),
  stateVersion: z.number().int().min(0),
  data: z.unknown().optional(),
  error: toolErrorSchema.optional(),
});

/* ------------------------------------------------------------------ *
 * GET /health
 * ------------------------------------------------------------------ */

export interface HealthData {
  status: 'ready' | 'degraded';
  version: string;
  database: 'ready' | 'unavailable';
  scenarioSchemaVersion: number;
}

/* ------------------------------------------------------------------ *
 * POST /runs
 * ------------------------------------------------------------------ */

export const createRunRequestSchema = z
  .object({
    scenarioId: z.literal('CASE-001'),
    scenarioVersion: z.literal(1),
    clientBuild: z.string().min(1).max(API_LIMITS.maxClientBuildLength),
  })
  .strict();

export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export interface CreateRunData {
  runId: string;
  /** Returned once. Store in sessionStorage; never log it, never persist it. */
  writeToken: string;
  expiresAt: string;
  initialStateHash: string;
}

/* ------------------------------------------------------------------ *
 * POST /runs/:runId/commands
 * ------------------------------------------------------------------ */

export const appendCommandRequestSchema = z
  .object({
    /** 1-based position in `GameContext.commandLog`. */
    seq: z.number().int().min(1),
    kind: commandKindSchema,
    origin: originSchema,
    input: z.unknown(),
    incidentAtSec: z.number().int().min(0).max(86_400 * 7),
    stateVersionBefore: z.number().int().min(0),
    stateVersionAfter: z.number().int().min(0),
    result: toolResultSchema,
    /**
     * Transport-level retry key, deliberately distinct from the engine's
     * gameplay `input.idempotencyKey` (which is stable by design — the UI sends
     * `ui:action:revoke_sessions` every time). This one must be unique per
     * intended append.
     */
    idempotencyKey: z
      .string()
      .min(1)
      .max(API_LIMITS.maxIdempotencyKeyLength)
      .regex(/^[A-Za-z0-9._:-]+$/)
      .optional(),
    clientStateHash: stateHashSchema,
  })
  .strict()
  .refine((value) => value.stateVersionAfter >= value.stateVersionBefore, {
    message: 'stateVersionAfter cannot go backwards',
    path: ['stateVersionAfter'],
  });

export type AppendCommandRequest = z.infer<typeof appendCommandRequestSchema>;

export interface AppendCommandData {
  runId: string;
  seq: number;
  /** True when this exact append was already acknowledged. */
  duplicate: boolean;
  lastSeq: number;
  stateVersion: number;
  stateHash: string;
  status: RunStatus;
  ending: string | null;
}

/* ------------------------------------------------------------------ *
 * POST /runs/:runId/commands/batch
 * ------------------------------------------------------------------ */

export const appendBatchRequestSchema = z
  .object({
    commands: z
      .array(appendCommandRequestSchema)
      .min(1)
      .max(API_LIMITS.maxBatchCommands),
  })
  .strict();

export type AppendBatchRequest = z.infer<typeof appendBatchRequestSchema>;

export interface AppendBatchData {
  runId: string;
  accepted: number;
  duplicates: number;
  lastSeq: number;
  stateVersion: number;
  stateHash: string;
  status: RunStatus;
  ending: string | null;
}

/* ------------------------------------------------------------------ *
 * GET /runs/:runId
 * ------------------------------------------------------------------ */

export type RunStatus = 'active' | 'closed' | 'expired';

export interface RunSummaryData {
  runId: string;
  scenarioId: string;
  scenarioVersion: number;
  status: RunStatus;
  lastSeq: number;
  stateVersion: number;
  /** The canonical replay signature hash the server verified. */
  replaySignature: string;
  ending: string | null;
  score: { total: number; max: number; buckets: Record<ScoreBucket, number> } | null;
  clientBuild: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export const MAX_SCORE = Object.values(SCORE_BUCKET_MAX).reduce((a, b) => a + b, 0);

/* ------------------------------------------------------------------ *
 * GET /runs/:runId/commands?after=<seq>
 * ------------------------------------------------------------------ */

export const listCommandsQuerySchema = z
  .object({
    after: z.coerce.number().int().min(0).default(0),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(API_LIMITS.maxCommandPageSize)
      .default(API_LIMITS.defaultCommandPageSize),
  })
  .strict();

export interface PersistedCommand {
  seq: number;
  kind: string;
  origin: 'human' | 'agent';
  input: unknown;
  incidentAtSec: number;
  stateVersionBefore: number;
  stateVersionAfter: number;
  result: unknown;
  createdAt: string;
}

export interface ListCommandsData {
  runId: string;
  commands: PersistedCommand[];
  lastSeq: number;
  /** Hash of the canonical signature after the last returned command. */
  stateHash: string;
  hasMore: boolean;
}

/* ------------------------------------------------------------------ *
 * SSE stream token (optional feature)
 * ------------------------------------------------------------------ */

export interface StreamTokenData {
  streamToken: string;
  expiresAt: string;
}

export const telemetryEventSchema = z.object({
  eventId: z.string().min(1).max(128),
  sequence: z.number().int().min(0),
  scenarioTimeSec: z.number().int().min(0),
  source: z.enum(['identity', 'endpoint', 'network', 'data', 'system']),
  severity: z.enum(['info', 'low', 'medium', 'high', 'critical']),
  entityIds: z.array(z.string().max(64)).max(16),
  kind: z.string().min(1).max(64),
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
  emittedAt: z.string(),
});

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

/**
 * Per-command size guard.
 *
 * The 256 KB body cap is a transport limit; this is a *content* limit. Without
 * it a single `input` blob could consume the whole body allowance and be stored
 * forever, and the replay of a run would grow without bound.
 */
export function withinCommandSizeLimit(command: unknown): boolean {
  try {
    return JSON.stringify(command ?? null).length <= API_LIMITS.maxCommandJsonBytes;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Route helpers
 * ------------------------------------------------------------------ */

export const ROUTES = {
  health: `${API_BASE_PATH}/health`,
  runs: `${API_BASE_PATH}/runs`,
  run: (runId: string) => `${API_BASE_PATH}/runs/${encodeURIComponent(runId)}`,
  commands: (runId: string) => `${API_BASE_PATH}/runs/${encodeURIComponent(runId)}/commands`,
  commandsBatch: (runId: string) =>
    `${API_BASE_PATH}/runs/${encodeURIComponent(runId)}/commands/batch`,
  events: (runId: string) => `${API_BASE_PATH}/runs/${encodeURIComponent(runId)}/events`,
  streamToken: (runId: string) =>
    `${API_BASE_PATH}/runs/${encodeURIComponent(runId)}/stream-token`,
} as const;
