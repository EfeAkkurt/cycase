import type { GameCommand } from '../../../src/game/types';

/**
 * The canonical contained run, as engine commands.
 *
 * The same sequence exists in `tests/e2e/helpers.ts` as `PERFECT_RUN` for the browser
 * suites. Keeping one copy per layer is deliberate — the unit layer must not import from
 * the E2E layer — but they must stay in step, so `determinism.test.ts` asserts this
 * sequence reaches the same 100/100 contained ending the browser tests assert.
 */
export const PERFECT_COMMANDS: GameCommand[] = [
  { kind: 'submit_decision', origin: 'human', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect', stateVersion: 0, idempotencyKey: 'k1' } },
  { kind: 'inspect_artifact', origin: 'human', input: { artifactId: 'art_email_001', stateVersion: 1 } },
  { kind: 'submit_decision', origin: 'human', input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry', stateVersion: 2, idempotencyKey: 'k2' } },
  { kind: 'run_diagnostic', origin: 'human', input: { diagnosticId: 'auth_timeline', stateVersion: 3 } },
  { kind: 'inspect_artifact', origin: 'human', input: { artifactId: 'art_cookie_001', stateVersion: 4 } },
  { kind: 'submit_decision', origin: 'human', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset', stateVersion: 5, idempotencyKey: 'k3' } },
  { kind: 'run_diagnostic', origin: 'human', input: { diagnosticId: 'session_inventory', stateVersion: 6 } },
  { kind: 'take_response_action', origin: 'human', input: { actionId: 'revoke_sessions', stateVersion: 7, idempotencyKey: 'k4' } },
  { kind: 'take_response_action', origin: 'human', input: { actionId: 'reset_credentials', stateVersion: 8, idempotencyKey: 'k5' } },
  { kind: 'submit_decision', origin: 'human', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate', stateVersion: 9, idempotencyKey: 'k6' } },
  { kind: 'inspect_artifact', origin: 'human', input: { artifactId: 'art_edr_001', stateVersion: 10 } },
  { kind: 'take_response_action', origin: 'human', input: { actionId: 'isolate_endpoint', stateVersion: 11, idempotencyKey: 'k7' } },
  { kind: 'submit_decision', origin: 'human', input: { decisionId: 'D5', optionId: 'D5_sweep_indicators', stateVersion: 12, idempotencyKey: 'k8' } },
  { kind: 'run_diagnostic', origin: 'human', input: { diagnosticId: 'indicator_scope', stateVersion: 13 } },
  { kind: 'take_response_action', origin: 'human', input: { actionId: 'block_indicator', stateVersion: 14, idempotencyKey: 'k9' } },
  { kind: 'submit_decision', origin: 'human', input: { decisionId: 'D6', optionId: 'D6_verify_checklist', stateVersion: 15, idempotencyKey: 'k10' } },
  { kind: 'take_response_action', origin: 'human', input: { actionId: 'close_case', stateVersion: 16, idempotencyKey: 'k11' } },
];
