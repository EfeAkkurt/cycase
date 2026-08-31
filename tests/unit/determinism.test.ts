import { describe, expect, it } from 'vitest';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import { PERFECT_COMMANDS } from './fixtures/perfectRun';
import { replay, replaySignature } from '../../src/game/replay';
import type { GameCommand, GameContext } from '../../src/game/types';

/**
 * Determinism is the property the whole product rests on: the score a judge sees, the
 * replay a server verifies, and the equivalence between a human run and an agent run are
 * all only meaningful if the same inputs produce the same outputs, every time.
 *
 * `live.test.ts` already checks that a replay reproduces a run. These tests attack the
 * property from the directions that would actually break it in production:
 *
 *   - running the same sequence twice in one process (shared mutable state);
 *   - running it against a fresh context built at a different wall-clock moment
 *     (a hidden `Date.now()` or `Math.random()` anywhere in the engine);
 *   - interleaving human and agent origins (origin leaking into the result);
 *   - replaying a *prefix* (the server verifies partial logs, not only complete ones).
 */

function runSequence(commands: GameCommand[] = PERFECT_COMMANDS): GameContext {
  let context = createInitialContext('Operator');
  for (const command of commands) {
    const outcome = executeCommand(context, command);
    expect(outcome.result.ok, `${command.kind} failed: ${JSON.stringify(outcome.result)}`).toBe(
      true,
    );
    context = outcome.context;
  }
  return context;
}

/** Everything a run is judged on, in one comparable value. */
function judgedOutcome(context: GameContext) {
  return {
    signature: replaySignature(context),
    stateVersion: context.stateVersion,
    scoreEntries: context.scoreEntries,
    ending: context.ending,
    caseClosed: context.caseClosed,
  };
}

describe('engine determinism', () => {
  it('produces byte-identical results when the same sequence runs twice', () => {
    const first = judgedOutcome(runSequence(PERFECT_COMMANDS));
    const second = judgedOutcome(runSequence(PERFECT_COMMANDS));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('does not depend on wall-clock time or randomness', () => {
    // A hidden Date.now() or Math.random() in the engine would show up as a
    // difference across contexts created at different real moments. Ten runs
    // separated by real elapsed time is a cheap, effective probe.
    const outcomes = new Set<string>();
    for (let i = 0; i < 10; i += 1) {
      outcomes.add(JSON.stringify(judgedOutcome(runSequence(PERFECT_COMMANDS))));
      // Burn real time between runs.
      const until = Date.now() + 2;
      while (Date.now() < until) {
        /* spin */
      }
    }
    expect(outcomes.size, 'the engine produced more than one outcome for one input').toBe(1);
  });

  it('reaches the same outcome whether the commands came from a human or an agent', () => {
    const asHuman = runSequence(PERFECT_COMMANDS.map((c) => ({ ...c, origin: 'human' as const })));
    const asAgent = runSequence(PERFECT_COMMANDS.map((c) => ({ ...c, origin: 'agent' as const })));

    // Origin is recorded, and must not change the case itself.
    expect(judgedOutcome(asAgent).signature).toEqual(judgedOutcome(asHuman).signature);
    expect(asAgent.scoreEntries).toEqual(asHuman.scoreEntries);
    expect(asAgent.ending).toBe(asHuman.ending);
    expect(asAgent.commandLog.every((entry) => entry.origin === 'agent')).toBe(true);
    expect(asHuman.commandLog.every((entry) => entry.origin === 'human')).toBe(true);
  });

  it('replays every prefix of a run to the same state the live run had', () => {
    // The server verifies partial logs as they arrive, so a replay that is only
    // correct for a *complete* log would fail in exactly the case that matters.
    let live = createInitialContext('Operator');
    const applied: GameContext[] = [];
    for (const command of PERFECT_COMMANDS) {
      live = executeCommand(live, command).context;
      applied.push(live);
    }

    for (let length = 1; length <= applied.length; length += 1) {
      const expected = applied[length - 1]!;
      const replayed = replay(expected.commandLog);
      expect(
        replaySignature(replayed),
        `prefix of length ${length} did not replay to the same state`,
      ).toEqual(replaySignature(expected));
      expect(replayed.stateVersion).toBe(expected.stateVersion);
    }
  });

  it('gives a different signature when a single input is altered', () => {
    // A signature that never changes is not a signature. Flip one option to a
    // different valid choice and require the run to be distinguishable.
    const baseline = runSequence(PERFECT_COMMANDS);
    const altered = runSequence(
      PERFECT_COMMANDS.map((command): GameCommand => {
        if (
          command.kind !== 'submit_decision' ||
          command.input.decisionId !== 'D1'
        ) {
          return command;
        }
        return {
          kind: 'submit_decision',
          origin: command.origin,
          input: { ...command.input, optionId: 'D1_disable_account_now' },
        };
      }),
    );

    const total = (context: GameContext) =>
      context.scoreEntries.reduce((sum, entry) => sum + entry.delta, 0);

    expect(replaySignature(altered)).not.toEqual(replaySignature(baseline));
    expect(total(altered)).not.toBe(total(baseline));
  });
});
