import { describe, expect, it } from 'vitest';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import { RESULT_BUDGET, compactResult } from '../../src/webmcp/tools';
import { describePage, pageReserve, withPageContext } from '../../src/webmcp/pageContext';
import type { GameCommand, GameContext, ToolResult } from '../../src/game/types';

/**
 * docs/WEBMCP_CONTRACT.md budgets tool results at ~1,500 characters. This runs
 * every command the agent can issue during a full case and asserts the wire
 * payload actually fits — the e2e suite checks it in a browser, this catches it
 * in milliseconds.
 */

const MUTATING = new Set(['take_response_action', 'submit_decision']);

function drive(steps: { kind: string; input: Record<string, unknown> }[]): {
  step: string;
  result: ToolResult;
}[] {
  let ctx: GameContext = createInitialContext();
  const out: { step: string; result: ToolResult }[] = [];

  for (const [index, step] of steps.entries()) {
    const input: Record<string, unknown> = { ...step.input, stateVersion: ctx.stateVersion };
    if (MUTATING.has(step.kind)) input.idempotencyKey = `k-${index}`;
    const outcome = executeCommand(ctx, {
      kind: step.kind,
      input,
      origin: 'agent',
    } as unknown as GameCommand);
    ctx = outcome.context;
    const { seq: _seq, ...result } = outcome.result;
    out.push({ step: `${index}:${step.kind}:${JSON.stringify(step.input)}`, result });
  }

  return out;
}

const FULL_CASE = [
  { kind: 'get_incident', input: {} },
  { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
  { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
  { kind: 'get_incident', input: {} },
  { kind: 'submit_decision', input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' } },
  { kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
  { kind: 'inspect_artifact', input: { artifactId: 'art_signin_001' } },
  { kind: 'inspect_artifact', input: { artifactId: 'art_cookie_001' } },
  { kind: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset' } },
  { kind: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
  { kind: 'inspect_artifact', input: { artifactId: 'art_session_001' } },
  { kind: 'take_response_action', input: { actionId: 'revoke_sessions' } },
  { kind: 'take_response_action', input: { actionId: 'reset_credentials' } },
  { kind: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate' } },
  { kind: 'inspect_artifact', input: { artifactId: 'art_edr_001' } },
  { kind: 'inspect_artifact', input: { artifactId: 'art_dlp_001' } },
  { kind: 'inspect_artifact', input: { artifactId: 'art_fileops_001' } },
  { kind: 'inspect_artifact', input: { artifactId: 'art_url_001' } },
  { kind: 'take_response_action', input: { actionId: 'isolate_endpoint' } },
  { kind: 'submit_decision', input: { decisionId: 'D5', optionId: 'D5_sweep_indicators' } },
  { kind: 'run_diagnostic', input: { diagnosticId: 'indicator_scope' } },
  { kind: 'take_response_action', input: { actionId: 'block_indicator' } },
  { kind: 'get_incident', input: {} },
  { kind: 'request_hint', input: { topic: 'containment' } },
  { kind: 'submit_decision', input: { decisionId: 'D6', optionId: 'D6_verify_checklist' } },
  { kind: 'take_response_action', input: { actionId: 'close_case' } },
];

describe('tool result budget', () => {
  it('keeps every result of a full case inside the wire budget', () => {
    const oversized = drive(FULL_CASE)
      .map(({ step, result }) => ({ step, size: JSON.stringify(compactResult(result)).length }))
      .filter((entry) => entry.size > RESULT_BUDGET);

    expect(oversized).toEqual([]);
  });

  it('never drops the fields an agent needs to recover', () => {
    for (const { result } of drive(FULL_CASE)) {
      const compact = compactResult(result);
      expect(compact.ok).toBe(result.ok);
      expect(compact.stateVersion).toBe(result.stateVersion);
      expect(compact.error).toEqual(result.error);
    }
  });

  it('keeps decisive artifact fields even when it has to trim', () => {
    const results = drive([
      { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
    ]);
    const compact = compactResult(results[0]!.result);
    const fields = (compact.data as { fields: { label: string; decisive: boolean }[] }).fields;

    // The email has three decisive tells; none of them may be trimmed away.
    expect(fields.filter((field) => field.decisive)).toHaveLength(3);
  });

  it('marks a truncated list rather than silently shortening it', () => {
    const long: ToolResult = {
      ok: true,
      stateVersion: 3,
      data: {
        knownFacts: Array.from({ length: 40 }, (_, i) => `Fact number ${i} ${'x'.repeat(80)}`),
      },
    };
    const compact = compactResult(long);
    const data = compact.data as { knownFacts: string[]; knownFactsTruncated?: number };

    expect(JSON.stringify(compact).length).toBeLessThanOrEqual(RESULT_BUDGET);
    expect(data.knownFactsTruncated).toBeGreaterThan(0);
  });
});

/**
 * The property that actually ships.
 *
 * `get_incident` is not sent as the engine returns it: the tool layer reserves
 * room for the page token, compacts against the smaller budget, then merges the
 * token in (`useWebMcpTools.ts`). Asserting the un-merged size leaves the real
 * wire payload untested, and the margin it relies on is thin.
 */
describe('the merged get_incident wire payload', () => {
  const SCENES = [
    ['boot', null],
    ['intro', null],
    ['office', 'alarmUnacknowledged'],
    ['office', 'acknowledged'],
    ['office', 'assistantReporting'],
    ['office', 'briefingChoice'],
    ['office', 'explained'],
    ['office', 'resume'],
    ['transition', null],
    ['dashboard', null],
    ['debrief', null],
  ] as const;

  it('fits the budget at every step of a full case, in every scene', () => {
    const oversized: string[] = [];

    for (const { step, result } of drive(FULL_CASE)) {
      if (!step.includes(':get_incident:')) continue;
      for (const [scene, sub] of SCENES) {
        const page = describePage(scene, sub);
        const wire = withPageContext(compactResult(result, pageReserve(page)), page);
        const size = JSON.stringify(wire).length;
        if (size > RESULT_BUDGET) oversized.push(`${step} @ ${scene}/${sub}: ${size}`);
      }
    }

    expect(oversized).toEqual([]);
  });

  it('adds the page token rather than dropping it', () => {
    const result = drive([{ kind: 'get_incident', input: {} }])[0]!.result;
    const page = describePage('office', 'briefingChoice');
    const wire = withPageContext(compactResult(result, pageReserve(page)), page);
    expect((wire.data as Record<string, unknown>).page).toBe('briefing_choice');
  });
});
