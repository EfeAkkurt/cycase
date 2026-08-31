import { createActor } from 'xstate';

import { createInitialContext } from '../../../src/game/context';
import { executeCommand } from '../../../src/game/engine';
import { gameMachine } from '../../../src/game/machine';
import { GameRuntime } from '../../../src/game/runtime';
import type { GameCommand, GameContext, LoggedCommand } from '../../../src/game/types';
import type { AppendCommandRequest } from '../../../shared/apiContract';
import { hashContext } from '../../../shared/runSignature';

/**
 * Shared test harness for the backend suite.
 *
 * It deliberately builds submissions the way `src/backend/runSync.ts` does —
 * from the command log, through the real engine — so an integration test that
 * passes here is testing the path the browser actually takes rather than a
 * hand-written payload that happens to satisfy the schema.
 */

/** A real `GameRuntime` on a started actor, so `TICK` and scene events work. */
export function bootRuntime(): GameRuntime {
  const actor = createActor(gameMachine, { input: {} });
  actor.start();
  return new GameRuntime(actor);
}

/** The full correct path, expressed as engine commands. */
export const PERFECT_RUN: readonly { kind: GameCommand['kind']; input: Record<string, unknown> }[] =
  [
    { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
    { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
    { kind: 'submit_decision', input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' } },
    { kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
    { kind: 'inspect_artifact', input: { artifactId: 'art_cookie_001' } },
    { kind: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset' } },
    { kind: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
    { kind: 'take_response_action', input: { actionId: 'revoke_sessions' } },
    { kind: 'take_response_action', input: { actionId: 'reset_credentials' } },
    { kind: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate' } },
    { kind: 'inspect_artifact', input: { artifactId: 'art_edr_001' } },
    { kind: 'take_response_action', input: { actionId: 'isolate_endpoint' } },
    { kind: 'submit_decision', input: { decisionId: 'D5', optionId: 'D5_sweep_indicators' } },
    { kind: 'run_diagnostic', input: { diagnosticId: 'indicator_scope' } },
    { kind: 'take_response_action', input: { actionId: 'block_indicator' } },
    { kind: 'submit_decision', input: { decisionId: 'D6', optionId: 'D6_verify_checklist' } },
    { kind: 'take_response_action', input: { actionId: 'close_case' } },
  ];

/** Fills in the version/idempotency fields the engine requires at call time. */
function completeInput(
  context: GameContext,
  step: { kind: GameCommand['kind']; input: Record<string, unknown> },
  index: number,
): Record<string, unknown> {
  const input: Record<string, unknown> = { ...step.input };
  if (step.kind !== 'get_incident') input.stateVersion = context.stateVersion;
  if (step.kind === 'take_response_action' || step.kind === 'submit_decision') {
    input.idempotencyKey = `test:${index}`;
  }
  return input;
}

export interface PlayedRun {
  context: GameContext;
  submissions: AppendCommandRequest[];
}

/**
 * Plays a script through the pure engine and captures what the sync layer would
 * upload for each committed command.
 */
export function playRun(
  script: readonly { kind: GameCommand['kind']; input: Record<string, unknown> }[] = PERFECT_RUN,
  origin: 'human' | 'agent' = 'human',
): PlayedRun {
  let context = createInitialContext();
  const submissions: AppendCommandRequest[] = [];

  for (const [index, step] of script.entries()) {
    const before = context.stateVersion;
    const logLengthBefore = context.commandLog.length;
    const outcome = executeCommand(context, {
      kind: step.kind,
      input: completeInput(context, step, index),
      origin,
    } as GameCommand);
    context = outcome.context;

    // `get_incident` and rejections are not in the log and are never uploaded.
    if (context.commandLog.length === logLengthBefore) continue;

    const entry = context.commandLog[context.commandLog.length - 1]!;
    const { seq: _seq, ...result } = outcome.result;
    submissions.push({
      seq: context.commandLog.length,
      kind: entry.kind,
      origin: entry.origin,
      input: entry.input,
      incidentAtSec: entry.atSec,
      stateVersionBefore: before,
      stateVersionAfter: context.stateVersion,
      result,
      clientStateHash: hashContext(context),
      idempotencyKey: `append.${context.commandLog.length}`,
    });
  }

  return { context, submissions };
}

export function toLogged(context: GameContext): LoggedCommand[] {
  return [...context.commandLog];
}
