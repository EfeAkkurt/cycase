import { createInitialContext } from './context';
import { executeCommand } from './engine';
import type { GameContext, LoggedCommand } from './types';

/**
 * Rebuilds a run from its command log.
 *
 * `docs/VISUAL_RESET.md` asks for "pause/replay from the same seed for
 * deterministic tests". The seed here is not a random number — the engine has
 * no randomness — it is the opening context plus the ordered commands. Feeding
 * those back through the same pure executor has to land on the same state, and
 * `replay.test.ts` asserts exactly that.
 */
export function replay(
  commands: readonly LoggedCommand[],
  operatorName?: string,
): GameContext {
  let context = createInitialContext(operatorName);

  for (const command of commands) {
    // The clock advances with the commands themselves; a replay does not
    // reproduce wall-clock ticks, so it lands on the same *case* state rather
    // than the same displayed time.
    const outcome = executeCommand(context, {
      kind: command.kind,
      input: command.input,
      origin: command.origin,
    } as Parameters<typeof executeCommand>[1]);
    context = outcome.context;
  }

  return context;
}

/** The parts of a run that a replay must reproduce exactly. */
export function replaySignature(context: GameContext) {
  return {
    stateVersion: context.stateVersion,
    inspectedArtifacts: context.inspectedArtifacts,
    ranDiagnostics: context.ranDiagnostics,
    performedActions: context.performedActions.map((action) => action.actionId),
    decisions: context.decisions,
    destroyedArtifacts: context.destroyedArtifacts,
    disabledIdentities: context.disabledIdentities,
    unlockedActions: context.unlockedActions,
    findings: context.findings,
    flags: context.flags,
    scoreEntries: context.scoreEntries,
    caseClosed: context.caseClosed,
    ending: context.ending,
  };
}
