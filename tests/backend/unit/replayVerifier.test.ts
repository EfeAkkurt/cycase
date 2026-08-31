import { describe, expect, it } from 'vitest';

import { createInitialContext } from '../../../src/game/context';
import type { AppendCommandRequest, PersistedCommand } from '../../../shared/apiContract';
import {
  replayHistory,
  signatureHash,
  toLoggedCommands,
  verifyAppend,
  verifyBatch,
} from '../../../server/services/replayVerifier';
import { playRun } from '../helpers/run';

/**
 * The verifier's negative tests.
 *
 * A verifier that never rejects is worse than no verifier: it converts an
 * unchecked write path into one that looks checked. Each of the four
 * submission fields the contract names — input, result, sequence and state hash
 * — gets its own test, and each asserts the *specific* rejection reason so a
 * future refactor cannot make them all pass by rejecting everything.
 */

function persisted(submissions: readonly AppendCommandRequest[]): PersistedCommand[] {
  return submissions.map((submission) => ({
    seq: submission.seq,
    kind: submission.kind,
    origin: submission.origin,
    input: submission.input,
    incidentAtSec: submission.incidentAtSec,
    stateVersionBefore: submission.stateVersionBefore,
    stateVersionAfter: submission.stateVersionAfter,
    result: submission.result,
    createdAt: '2026-08-29T00:00:00.000Z',
  }));
}

describe('replay verifier — the happy path', () => {
  it('accepts every command of a real run, one at a time', () => {
    const played = playRun();
    let context = createInitialContext();

    for (const submission of played.submissions) {
      const outcome = verifyAppend(context, submission);
      expect(outcome.ok, `seq ${submission.seq} (${submission.kind})`).toBe(true);
      if (!outcome.ok) return;
      context = outcome.context;
    }

    expect(signatureHash(context)).toBe(
      played.submissions[played.submissions.length - 1]!.clientStateHash,
    );
    expect(context.caseClosed).toBe(true);
    expect(context.ending).toBe('contained');
  });

  it('rebuilds the same context from persisted rows as from the live run', () => {
    const played = playRun();
    const rebuilt = replayHistory(persisted(played.submissions));
    expect(signatureHash(rebuilt)).toBe(signatureHash(played.context));
    expect(toLoggedCommands(persisted(played.submissions))).toHaveLength(
      played.context.commandLog.length,
    );
  });

  it('accepts a contiguous batch and threads the context through it', () => {
    const played = playRun();
    const outcome = verifyBatch(createInitialContext(), played.submissions);
    expect(outcome.ok).toBe(true);
    expect(outcome.stateHash).toBe(signatureHash(played.context));
  });
});

describe('replay verifier — rejections', () => {
  it('detects an ALTERED INPUT', () => {
    const played = playRun();
    const [first, ...rest] = played.submissions;
    const prior = replayHistory(persisted([]));

    // The client claims it inspected the phishing email; the payload says it
    // inspected the sign-in log. The engine's result no longer matches.
    const tampered: AppendCommandRequest = {
      ...first!,
      input: { ...(first!.input as Record<string, unknown>), decisionId: 'D1', optionId: 'D1_disable_account_now' },
    };

    const outcome = verifyAppend(prior, tampered);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('RESULT_MISMATCH');
    expect(rest.length).toBeGreaterThan(0);
  });

  it('detects an ALTERED RESULT', () => {
    const played = playRun();
    const first = played.submissions[0]!;

    // A client that lies about the outcome of a decision it really made.
    const tampered: AppendCommandRequest = {
      ...first,
      result: {
        ...first.result,
        data: { ...(first.result.data as Record<string, unknown>), correct: false },
      },
    };

    const outcome = verifyAppend(createInitialContext(), tampered);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('RESULT_MISMATCH');
  });

  it('detects a WRONG SEQUENCE by way of the state version it implies', () => {
    const played = playRun();
    const second = played.submissions[1]!;

    // Submitting seq 2 against an empty history: the engine at stateVersion 0
    // cannot have produced a command that claims to start from version 1.
    const outcome = verifyAppend(createInitialContext(), second);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('STATE_VERSION_BEFORE_MISMATCH');
    expect(outcome.detail).toContain('server 0');
  });

  it('detects a WRONG STATE HASH', () => {
    const played = playRun();
    const first = played.submissions[0]!;

    const tampered: AppendCommandRequest = {
      ...first,
      clientStateHash: `sha256:${'0'.repeat(64)}`,
    };

    const outcome = verifyAppend(createInitialContext(), tampered);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('STATE_HASH_MISMATCH');
  });

  it('detects a forged stateVersionAfter', () => {
    const played = playRun();
    const first = played.submissions[0]!;
    const outcome = verifyAppend(createInitialContext(), {
      ...first,
      stateVersionAfter: first.stateVersionAfter + 5,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('STATE_VERSION_AFTER_MISMATCH');
  });

  it('detects a command the shared engine refuses but the client claims succeeded', () => {
    const played = playRun();
    const first = played.submissions[0]!;

    // `close_case` before D6 is `ACTION_NOT_ALLOWED` in the engine. A client
    // reporting ok:true for it is running different rules.
    const forged: AppendCommandRequest = {
      ...first,
      kind: 'take_response_action',
      input: { actionId: 'close_case', stateVersion: 0, idempotencyKey: 'forge' },
    };

    const outcome = verifyAppend(createInitialContext(), forged);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('ENGINE_REJECTED');
  });

  it('reports which command of a batch failed and refuses the whole batch', () => {
    const played = playRun();
    const submissions = played.submissions.map((submission, index) =>
      index === 3 ? { ...submission, clientStateHash: `sha256:${'1'.repeat(64)}` } : submission,
    );

    const outcome = verifyBatch(createInitialContext(), submissions);
    expect(outcome.ok).toBe(false);
    expect(outcome.failedIndex).toBe(3);
    expect(outcome.failure?.reason).toBe('STATE_HASH_MISMATCH');
    expect(outcome.context).toBeUndefined();
  });

  it('never leaks artifact content in a rejection detail', () => {
    const played = playRun();
    const first = played.submissions[0]!;
    const outcome = verifyAppend(createInitialContext(), {
      ...first,
      clientStateHash: `sha256:${'2'.repeat(64)}`,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.detail).toBe('canonical run signature disagrees');
    expect(outcome.detail).not.toMatch(/cy-case|dilara|cookie|session/i);
  });
});
