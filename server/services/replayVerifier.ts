import { executeCommand } from '../../src/game/engine';
import { replay } from '../../src/game/replay';
import type { GameCommand, GameContext, LoggedCommand } from '../../src/game/types';
import { canonicalRunSignature, hashRunSignature, stableStringify } from '../../shared/runSignature';
import type { AppendCommandRequest, PersistedCommand } from '../../shared/apiContract';

/**
 * Deterministic verification of a submitted command.
 *
 * The single most important property of this file is what it does *not* do: it
 * never produces a gameplay result of its own. It rebuilds the run from the
 * persisted command log using `src/game/replay.ts` — the same module the
 * browser tests use — re-executes the submitted command through the same
 * `executeCommand`, and then only *compares*. If the comparison fails the
 * server refuses the write; it does not substitute its own answer, and it does
 * not advance the run.
 *
 * That is why the browser stays the only rules engine even when persistence is
 * on: the server is a witness, not a referee.
 */

export type VerificationFailureReason =
  | 'STATE_VERSION_BEFORE_MISMATCH'
  | 'STATE_VERSION_AFTER_MISMATCH'
  | 'RESULT_MISMATCH'
  | 'STATE_HASH_MISMATCH'
  | 'ENGINE_REJECTED';

export interface VerificationSuccess {
  ok: true;
  /** The context after applying the submitted command. */
  context: GameContext;
  stateVersion: number;
  stateHash: string;
  caseClosed: boolean;
  ending: string | null;
  /** Milliseconds spent replaying + re-executing. Logged, never returned to the client. */
  durationMs: number;
}

export interface VerificationFailure {
  ok: false;
  reason: VerificationFailureReason;
  /** Short, non-leaking detail safe to log. Never includes artifact content. */
  detail: string;
  durationMs: number;
}

export type VerificationResult = VerificationSuccess | VerificationFailure;

/** Rebuilds the `LoggedCommand` seed from persisted rows. */
export function toLoggedCommands(rows: readonly PersistedCommand[]): LoggedCommand[] {
  return rows.map((row) => ({
    kind: row.kind as LoggedCommand['kind'],
    input: row.input,
    origin: row.origin,
    atSec: row.incidentAtSec,
  }));
}

/** Replays a persisted history to the context it must produce. */
export function replayHistory(rows: readonly PersistedCommand[]): GameContext {
  return replay(toLoggedCommands(rows));
}

export function signatureHash(context: GameContext): string {
  return hashRunSignature(canonicalRunSignature(context));
}

/**
 * Verifies one appended command against a prior context.
 *
 * `priorContext` is the replay of every already-persisted command, so callers
 * that append several commands in a row (the batch route) can thread the
 * verified context forward instead of replaying the whole history per command.
 */
export function verifyAppend(
  priorContext: GameContext,
  submission: AppendCommandRequest,
): VerificationResult {
  const startedAt = performance.now();
  const elapsed = () => performance.now() - startedAt;

  if (priorContext.stateVersion !== submission.stateVersionBefore) {
    return {
      ok: false,
      reason: 'STATE_VERSION_BEFORE_MISMATCH',
      detail: `server ${priorContext.stateVersion}, client ${submission.stateVersionBefore}`,
      durationMs: elapsed(),
    };
  }

  const command = {
    kind: submission.kind,
    input: submission.input,
    origin: submission.origin,
  } as GameCommand;

  const outcome = executeCommand(priorContext, command);
  const { seq: _seq, ...serverResult } = outcome.result;

  // A command that the client says succeeded but the shared engine rejects is
  // the loudest possible divergence: the client is not running this engine.
  if (submission.result.ok && !serverResult.ok) {
    return {
      ok: false,
      reason: 'ENGINE_REJECTED',
      detail: `engine returned ${serverResult.error?.code ?? 'error'} for a command the client accepted`,
      durationMs: elapsed(),
    };
  }

  if (stableStringify(serverResult) !== stableStringify(submission.result)) {
    return {
      ok: false,
      reason: 'RESULT_MISMATCH',
      detail: `${submission.kind} produced a different deterministic result`,
      durationMs: elapsed(),
    };
  }

  if (outcome.context.stateVersion !== submission.stateVersionAfter) {
    return {
      ok: false,
      reason: 'STATE_VERSION_AFTER_MISMATCH',
      detail: `server ${outcome.context.stateVersion}, client ${submission.stateVersionAfter}`,
      durationMs: elapsed(),
    };
  }

  const stateHash = signatureHash(outcome.context);
  if (stateHash !== submission.clientStateHash) {
    return {
      ok: false,
      reason: 'STATE_HASH_MISMATCH',
      detail: 'canonical run signature disagrees',
      durationMs: elapsed(),
    };
  }

  return {
    ok: true,
    context: outcome.context,
    stateVersion: outcome.context.stateVersion,
    stateHash,
    caseClosed: outcome.context.caseClosed,
    ending: outcome.context.ending,
    durationMs: elapsed(),
  };
}

/**
 * Verifies a contiguous batch against a prior context.
 *
 * Returns the final context only when every command verifies, which is what
 * lets the route persist the batch inside one transaction or not at all.
 */
export interface BatchVerification {
  ok: boolean;
  /** Index of the first command that failed, when `ok` is false. */
  failedIndex?: number;
  failure?: VerificationFailure;
  context?: GameContext;
  stateHash?: string;
  durationMs: number;
}

export function verifyBatch(
  priorContext: GameContext,
  submissions: readonly AppendCommandRequest[],
): BatchVerification {
  const startedAt = performance.now();
  let context = priorContext;

  for (const [index, submission] of submissions.entries()) {
    const outcome = verifyAppend(context, submission);
    if (!outcome.ok) {
      return {
        ok: false,
        failedIndex: index,
        failure: outcome,
        durationMs: performance.now() - startedAt,
      };
    }
    context = outcome.context;
  }

  return {
    ok: true,
    context,
    stateHash: signatureHash(context),
    durationMs: performance.now() - startedAt,
  };
}
