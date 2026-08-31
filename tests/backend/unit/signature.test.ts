import { describe, expect, it } from 'vitest';

import { sha256Hex } from '../../../shared/sha256';
import {
  canonicalRunSignature,
  hashContext,
  stableStringify,
} from '../../../shared/runSignature';
import { replay, replaySignature } from '../../../src/game/replay';
import { bootRuntime, PERFECT_RUN, playRun } from '../helpers/run';

describe('sha256', () => {
  it('matches the published NIST vectors', () => {
    expect(sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('hashes multi-block and multi-byte input', () => {
    // 1,000,000 'a' is the third NIST vector; 100,000 keeps the test fast while
    // still crossing many block boundaries and the length-padding edge.
    expect(sha256Hex('a'.repeat(100_000))).toHaveLength(64);
    expect(sha256Hex('ünïcödé')).toBe(sha256Hex('ünïcödé'));
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });
});

describe('stableStringify', () => {
  it('is insensitive to key insertion order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('preserves array order, which is meaningful', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('drops undefined members so an optional field cannot change the hash', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe('canonical run signature', () => {
  it('reproduces itself from the command log', () => {
    const played = playRun();
    const replayed = replay(played.context.commandLog);
    expect(canonicalRunSignature(replayed)).toEqual(canonicalRunSignature(played.context));
    expect(hashContext(replayed)).toBe(hashContext(played.context));
  });

  /**
   * The test the whole wire protocol rests on.
   *
   * A live browser run ticks the incident clock and lets an agent poll
   * `get_incident`; a server-side replay does neither. `replaySignature` is
   * sensitive to both — it carries `decisions[].at` and per-entry `seq` — so
   * this asserts the *canonical* signature survives what the in-process one
   * cannot.
   */
  it('survives wall-clock ticks, polls and rejected commands that a replay never reproduces', () => {
    const runtime = bootRuntime();
    runtime.send({ type: 'SKIP_INTRO' });

    for (const [index, step] of PERFECT_RUN.entries()) {
      // A player reading the screen: the clock advances between commands.
      runtime.send({ type: 'TICK', seconds: 7 });
      // An agent polling for state, which is never written to the command log.
      runtime.getIncident('agent');
      // A stale call that the engine rejects, which is also never logged.
      runtime.execute(
        'inspect_artifact',
        { artifactId: 'art_email_001', stateVersion: 999 },
        'agent',
      );

      const input: Record<string, unknown> = {
        ...step.input,
        stateVersion: runtime.stateVersion,
      };
      if (step.kind === 'take_response_action' || step.kind === 'submit_decision') {
        input.idempotencyKey = `live:${index}`;
      }
      const result = runtime.execute(step.kind, input, 'human');
      expect(result.ok).toBe(true);
    }

    const live = runtime.context;
    expect(live.caseClosed).toBe(true);

    const replayed = replay(live.commandLog);

    // The in-process signature diverges, exactly as documented.
    expect(replaySignature(replayed)).not.toEqual(replaySignature(live));
    // The canonical one does not, which is what the server compares.
    expect(canonicalRunSignature(replayed)).toEqual(canonicalRunSignature(live));
    expect(hashContext(replayed)).toBe(hashContext(live));
  });

  it('changes when any case-relevant fact changes', () => {
    const good = playRun();
    const wrong = playRun([
      { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_disable_account_now' } },
    ]);
    expect(hashContext(wrong.context)).not.toBe(hashContext(good.context));
  });

  it('formats as sha256:<64 hex>', () => {
    expect(hashContext(playRun([]).context)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
