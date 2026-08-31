import type { GameContext } from '../src/game/types';
import { sha256Hex } from './sha256';

/**
 * The replay-stable fingerprint of a run.
 *
 * `src/game/replay.ts` already exports `replaySignature`, and that stays the
 * in-process test oracle. It cannot be used across the wire, for two concrete
 * reasons visible in the engine:
 *
 * 1. `DecisionRecord.at` is `incidentClock(ctx)`. Live, `clockSec` advances one
 *    second per real second through the machine's `TICK`; in `replay()` it only
 *    advances by `COMMAND_CLOCK_COST`. A player who reads the screen for ten
 *    seconds already diverges.
 * 2. `DecisionRecord.seq` and `ScoreEntry.seq` are `ctx.seq`, which counts every
 *    command including `get_incident` polls and rejected calls. Neither of those
 *    is in `commandLog`, so a replay from the log renumbers them.
 *
 * Both are presentation/audit metadata, not case state. Everything else in the
 * signature — what was inspected, what ran, what was performed, which decisions
 * with which options, destroyed artifacts, disabled identities, unlocked
 * actions, findings, flags, the score ledger's *content*, closure and ending —
 * is a pure function of the command log, which is exactly what the server can
 * verify.
 *
 * This is the value hashed into `clientStateHash` and `state_hash`.
 */
export interface CanonicalRunSignature {
  stateVersion: number;
  inspectedArtifacts: string[];
  ranDiagnostics: string[];
  performedActions: string[];
  decisions: { decisionId: string; optionId: string; correct: boolean }[];
  destroyedArtifacts: string[];
  disabledIdentities: string[];
  unlockedActions: string[];
  findings: { id: string; resolved: boolean; resolvedBy: string | null }[];
  flags: string[];
  scoreEntries: { bucket: string; delta: number; reasonKey: string; source: string }[];
  caseClosed: boolean;
  ending: string | null;
}

export function canonicalRunSignature(context: GameContext): CanonicalRunSignature {
  return {
    stateVersion: context.stateVersion,
    inspectedArtifacts: [...context.inspectedArtifacts],
    ranDiagnostics: [...context.ranDiagnostics],
    performedActions: context.performedActions.map((action) => action.actionId),
    // Sorted by decision id, not by insertion order: `decisions` is a record and
    // key order is an implementation detail of whoever assigned it.
    decisions: Object.values(context.decisions)
      .filter((record): record is NonNullable<typeof record> => Boolean(record))
      .map((record) => ({
        decisionId: record.decisionId,
        optionId: record.optionId,
        correct: record.correct,
      }))
      .sort((a, b) => a.decisionId.localeCompare(b.decisionId)),
    destroyedArtifacts: [...context.destroyedArtifacts],
    disabledIdentities: [...context.disabledIdentities],
    unlockedActions: [...context.unlockedActions],
    findings: context.findings.map((finding) => ({
      id: finding.id,
      resolved: finding.resolved,
      resolvedBy: finding.resolvedBy ?? null,
    })),
    flags: Object.entries(context.flags)
      .filter(([, value]) => value === true)
      .map(([key]) => key)
      .sort(),
    scoreEntries: context.scoreEntries.map((entry) => ({
      bucket: entry.bucket,
      delta: entry.delta,
      reasonKey: entry.reasonKey,
      source: entry.source,
    })),
    caseClosed: context.caseClosed,
    ending: context.ending,
  };
}

/**
 * JSON with object keys emitted in sorted order.
 *
 * Two engines that agree on state must produce the same bytes, and
 * `JSON.stringify` preserves insertion order — which differs between a live run
 * and a replay for any object built by spreading.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/** `sha256:<hex>` over the canonical signature. Public integrity value, not a secret. */
export function hashRunSignature(signature: CanonicalRunSignature): string {
  return `sha256:${sha256Hex(stableStringify(signature))}`;
}

export function hashContext(context: GameContext): string {
  return hashRunSignature(canonicalRunSignature(context));
}
