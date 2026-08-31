import { describe, expect, it } from 'vitest';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import { caseLog, currentEgress, egressTimeline } from '../../src/game/live';
import { replay, replaySignature } from '../../src/game/replay';
import {
  blastRadius,
  credentialPosture,
  diagnosticRows,
  endpointPosture,
  networkPosture,
  sessionInventory,
  sourceSnapshot,
  stolenSession,
} from '../../src/game/sources';
import { assetStatus, identityStatuses } from '../../src/game/selectors';
import { topology } from '../../src/game/fixtures/telemetry';
import { RESULT_BUDGET, compactResult } from '../../src/webmcp/tools';
import type {
  DiagnosticView,
  GameCommand,
  GameContext,
  OperationEffect,
  ResponseActionView,
  ToolResult,
} from '../../src/game/types';

/**
 * Redesign §6 — "every simulated operation must have observable effects".
 *
 * The rule under test: "An operation is not complete when only the score or a
 * toast changes. Within 250 ms it must update every affected view and produce
 * an attributable timeline entry."
 *
 * Most of what follows is deliberately *negative*. Asserting that
 * `revoke_sessions` revokes a session would pass against a hand-written effect
 * list that also lied about three other things. The tests that matter are the
 * ones that pin what an operation must **not** claim: that `reset_credentials`
 * killed an issued token, that isolation cost the operator evidence, that any
 * operation can move a score without moving a view.
 */

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

interface Step {
  kind: string;
  input: Record<string, unknown>;
}

let keyCounter = 0;

function drive(steps: Step[], from?: GameContext): GameContext {
  let ctx = from ?? createInitialContext();
  for (const step of steps) {
    ctx = run(ctx, step).context;
  }
  return ctx;
}

function run(ctx: GameContext, step: Step) {
  const input: Record<string, unknown> = { ...step.input, stateVersion: ctx.stateVersion };
  if (step.kind === 'take_response_action' || step.kind === 'submit_decision') {
    keyCounter += 1;
    input.idempotencyKey = `k-${keyCounter}`;
  }
  return executeCommand(ctx, {
    kind: step.kind,
    input,
    origin: 'agent',
  } as unknown as GameCommand);
}

/** Applies one operation and returns the result view it produced. */
function apply<T>(ctx: GameContext, step: Step): { ctx: GameContext; view: T } {
  const outcome = run(ctx, step);
  expect(outcome.result.ok, `${step.kind} ${JSON.stringify(step.input)} was rejected`).toBe(true);
  return { ctx: outcome.context, view: outcome.result.data as T };
}

const action = (actionId: string): Step => ({
  kind: 'take_response_action',
  input: { actionId },
});
const diagnostic = (diagnosticId: string): Step => ({
  kind: 'run_diagnostic',
  input: { diagnosticId },
});
const inspect = (artifactId: string): Step => ({
  kind: 'inspect_artifact',
  input: { artifactId },
});
const decide = (decisionId: string, optionId: string): Step => ({
  kind: 'submit_decision',
  input: { decisionId, optionId },
});

/** Every decision of the perfect run, in order. Used to reach `close_case`. */
const GOLDEN: Step[] = [
  decide('D1', 'D1_preserve_and_inspect'),
  inspect('art_email_001'),
  decide('D2', 'D2_compare_signin_telemetry'),
  diagnostic('auth_timeline'),
  inspect('art_cookie_001'),
  decide('D3', 'D3_revoke_then_reset'),
  diagnostic('session_inventory'),
  action('revoke_sessions'),
  action('reset_credentials'),
  decide('D4', 'D4_collect_then_isolate'),
  inspect('art_edr_001'),
  action('isolate_endpoint'),
  decide('D5', 'D5_sweep_indicators'),
  diagnostic('indicator_scope'),
  action('block_indicator'),
  decide('D6', 'D6_verify_checklist'),
];

const keys = (effects: readonly OperationEffect[]) => effects.map((e) => e.key);
const find = (effects: readonly OperationEffect[], key: string) =>
  effects.find((e) => e.key === key);
const fact = (ctx: GameContext, key: string) =>
  sourceSnapshot(ctx).find((f) => f.key === key);

/* ------------------------------------------------------------------ *
 * The rule itself
 * ------------------------------------------------------------------ */

describe('every operation has an observable effect', () => {
  it('reports at least one before/after change for all five response actions', () => {
    let ctx = createInitialContext();
    const seen: Record<string, OperationEffect[]> = {};

    for (const step of GOLDEN) {
      const outcome = run(ctx, step);
      expect(outcome.result.ok).toBe(true);
      ctx = outcome.context;
      if (step.kind === 'take_response_action') {
        seen[String(step.input.actionId)] = (outcome.result.data as ResponseActionView).effects;
      }
    }

    const closed = apply<ResponseActionView>(ctx, action('close_case'));
    seen.close_case = closed.view.effects;

    expect(Object.keys(seen).sort()).toEqual([
      'block_indicator',
      'close_case',
      'isolate_endpoint',
      'reset_credentials',
      'revoke_sessions',
    ]);

    for (const [actionId, effects] of Object.entries(seen)) {
      expect(effects.length, `${actionId} changed no simulated source`).toBeGreaterThan(0);
      for (const effect of effects) {
        expect(effect.before, `${actionId}/${effect.key} reported an unchanged fact`).not.toBe(
          effect.after,
        );
      }
    }
  });

  it('reports an effect for each of the three diagnostics', () => {
    let ctx = drive([decide('D1', 'D1_preserve_and_inspect')]);

    for (const id of ['auth_timeline', 'session_inventory', 'indicator_scope']) {
      const applied = apply<DiagnosticView>(ctx, diagnostic(id));
      ctx = applied.ctx;
      expect(applied.view.effects.length, `${id} changed no simulated source`).toBeGreaterThan(0);
    }
  });

  it('never invents an effect: every reported change is visible in the snapshot', () => {
    let ctx = createInitialContext();

    for (const step of GOLDEN) {
      const before = sourceSnapshot(ctx);
      const outcome = run(ctx, step);
      ctx = outcome.context;
      const data = outcome.result.data as { effects?: OperationEffect[] };
      if (!data.effects) continue;

      for (const effect of data.effects) {
        const was = before.find((f) => f.source === effect.source && f.key === effect.key);
        const now = fact(ctx, effect.key);
        expect(was?.state, `${effect.key}: claimed before-state does not match`).toBe(
          effect.before,
        );
        expect(now?.state, `${effect.key}: claimed after-state does not match`).toBe(effect.after);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * D3 — the teaching point
 * ------------------------------------------------------------------ */

describe('reset_credentials does not revoke an already-issued token (D3)', () => {
  const beforeContainment = () =>
    drive([
      decide('D1', 'D1_preserve_and_inspect'),
      inspect('art_email_001'),
      decide('D2', 'D2_compare_signin_telemetry'),
      diagnostic('auth_timeline'),
      inspect('art_cookie_001'),
      decide('D3', 'D3_password_only'),
      diagnostic('session_inventory'),
    ]);

  it('changes credential state and nothing else', () => {
    const { view } = apply<ResponseActionView>(beforeContainment(), action('reset_credentials'));

    expect(keys(view.effects).sort()).toEqual(['d.arslan.mfa-policy', 'd.arslan.password']);
    expect(find(view.effects, 'd.arslan.password')).toEqual({
      source: 'identity',
      key: 'd.arslan.password',
      before: 'exposed',
      after: 'rotated',
    });
  });

  /*
   * The near miss this test exists for: an MFA effect reading "satisfied by
   * session claim" -> "re-enrolment required" is true of the account's policy
   * and false of the live session, and an agent reading it would conclude the
   * bypass was closed. The attacker never reaches a next sign-in — they are
   * still riding the claim they stole.
   */
  it('does not report the MFA bypass as closed while the stolen session lives', () => {
    const { ctx, view } = apply<ResponseActionView>(
      beforeContainment(),
      action('reset_credentials'),
    );

    expect(stolenSession(ctx).state).toBe('active');

    expect(find(view.effects, 'd.arslan.mfa-policy')?.after).toBe(
      're-enrolment forced at next sign-in',
    );
    for (const effect of view.effects) {
      const claim = `${effect.key} ${effect.after}`.toLowerCase();
      expect(claim, 'a reset must not speak about the live session claim').not.toContain(
        'session claim',
      );
      expect(claim).not.toContain('bypass');
    }

    expect(view.stillOpen.join(' | ')).toContain('SES-8842');
  });

  it('claims no session and no token effect', () => {
    const { view } = apply<ResponseActionView>(beforeContainment(), action('reset_credentials'));

    for (const effect of view.effects) {
      expect(effect.key, 'a password reset must not report a session change').not.toMatch(/^SES-/);
    }
    expect(
      find(view.effects, 'd.arslan.issued-tokens'),
      'a password reset must not report issued tokens as invalidated',
    ).toBeUndefined();
  });

  it('leaves the stolen session live, and says so in stillOpen', () => {
    const { ctx, view } = apply<ResponseActionView>(
      beforeContainment(),
      action('reset_credentials'),
    );

    expect(stolenSession(ctx).state).toBe('active');
    expect(credentialPosture(ctx).password).toBe('rotated');
    expect(credentialPosture(ctx).issuedTokensInvalidated).toBe(false);

    expect(view.stillOpen.join(' | ')).toContain('SES-8842');
    expect(view.stillOpen.join(' | ')).toContain('d.arslan.issued-tokens — valid');
  });

  it('leaves the session inventory reading ACTIVE, warning note included', () => {
    const { ctx } = apply<ResponseActionView>(beforeContainment(), action('reset_credentials'));
    const rows = diagnosticRows(ctx, 'session_inventory');

    expect(rows.find((r) => r.key === 'SES-8842')?.value).toContain('ACTIVE');
    expect(rows.find((r) => r.key === 'note')?.value).toContain(
      'does not terminate any of the above',
    );
  });

  it('and the identity view agrees: credentials reset, sessions not revoked', () => {
    const { ctx } = apply<ResponseActionView>(beforeContainment(), action('reset_credentials'));
    const statuses = identityStatuses(ctx, 'usr_dilara');

    expect(statuses).toContain('credentials_reset');
    expect(statuses).not.toContain('sessions_revoked');
  });
});

/* ------------------------------------------------------------------ *
 * revoke_sessions
 * ------------------------------------------------------------------ */

describe('revoke_sessions', () => {
  const ready = () =>
    drive([
      decide('D1', 'D1_preserve_and_inspect'),
      inspect('art_email_001'),
      decide('D2', 'D2_compare_signin_telemetry'),
      diagnostic('auth_timeline'),
      inspect('art_cookie_001'),
      decide('D3', 'D3_revoke_then_reset'),
      diagnostic('session_inventory'),
    ]);

  it('invalidates the stolen session in the identity view', () => {
    const { ctx, view } = apply<ResponseActionView>(ready(), action('revoke_sessions'));

    expect(stolenSession(ctx).state).toBe('revoked');
    expect(stolenSession(ctx).revokedBy).toBe('revoke_sessions');
    expect(find(view.effects, 'SES-8842')?.after).toBe('revoked');
    expect(identityStatuses(ctx, 'usr_dilara')).toContain('sessions_revoked');
    expect(diagnosticRows(ctx, 'session_inventory').find((r) => r.key === 'SES-8842')?.value).toContain(
      'REVOKED',
    );
  });

  it('signs the account out everywhere, exactly as its impact promises', () => {
    const { ctx } = apply<ResponseActionView>(ready(), action('revoke_sessions'));
    const sessions = sessionInventory(ctx);

    for (const session of sessions.filter((s) => s.principal === 'usr_dilara')) {
      expect(session.state, `${session.id} should be revoked with the account`).toBe('revoked');
    }
  });

  /*
   * The shipped impact text used to promise "all three active sessions for the
   * account", which the fixture cannot deliver: only two of the three sessions
   * belong to d.arslan and the third is a service principal whose activity is
   * expected. Narration that over-promises containment is the same class of
   * defect as a result that over-claims it, so the two are pinned together and
   * a future edit to either has to move both.
   */
  it('promises in narration exactly the number of sessions it terminates', () => {
    const before = ready();
    const { ctx, view } = apply<ResponseActionView>(before, action('revoke_sessions'));

    const terminated = sessionInventory(ctx).filter(
      (s) => s.state === 'revoked',
    ).length;
    const survived = sessionInventory(ctx).filter((s) => s.state === 'active').length;

    expect(terminated).toBe(2);
    expect(survived).toBe(1);
    expect(view.impact).toContain('both active sessions for the account');
    expect(view.impact).toContain('service-account session');
  });

  /*
   * `tests/e2e/webmcp.spec.ts` asserts on this exact substring to prove the
   * Playbook table re-renders in place after a revocation. That suite needs a
   * browser and a GPU and runs serially at the end; this runs in milliseconds,
   * so a change to the row format fails here first rather than in the gate.
   */
  it('renders the row text the browser gate matches on', () => {
    const before = ready();
    const { ctx } = apply<ResponseActionView>(before, action('revoke_sessions'));

    const text = (c: GameContext) =>
      diagnosticRows(c, 'session_inventory')
        .map((r) => `${r.key} ${r.value}`)
        .join('\n');

    expect(text(before)).toContain('ACTIVE — fp_9c2a41e0');
    expect(text(ctx)).toContain('REVOKED — fp_9c2a41e0');
    expect(text(ctx)).not.toContain('ACTIVE — fp_9c2a41e0');
    // The service session must keep the panel honest by staying ACTIVE.
    expect(text(ctx)).toContain('ACTIVE — service principal');
  });

  it('leaves the service principal alone — a different principal, expected activity', () => {
    const { ctx } = apply<ResponseActionView>(ready(), action('revoke_sessions'));
    const service = sessionInventory(ctx).find((s) => s.kind === 'service');

    expect(service?.principal).toBe('svc_backup');
    expect(service?.state).toBe('active');
  });

  it('stops session-backed access to the file service', () => {
    const before = ready();
    const { ctx, view } = apply<ResponseActionView>(before, action('revoke_sessions'));

    expect(find(view.effects, 'SRV-FILES-02')).toEqual({
      source: 'endpoint',
      key: 'SRV-FILES-02',
      before: 'session-backed access open',
      after: 'access closed',
    });

    const share = endpointPosture(ctx).connections.find((c) => c.purpose === 'file_share');
    expect(share?.state).toBe('severed');
    expect(share?.stoppedBy).toBe('revoke_sessions');
  });

  it('changes the topology', () => {
    const before = ready();
    const { ctx } = apply<ResponseActionView>(before, action('revoke_sessions'));

    const status = (c: GameContext, id: string) =>
      topology(c).nodes.find((n) => n.id === id)?.status;

    expect(status(before, 'idp')).toBe('Rogue session active');
    expect(status(ctx, 'idp')).toBe('Sessions revoked');
    expect(status(before, 'SRV-FILES-02')).not.toBe(status(ctx, 'SRV-FILES-02'));
  });

  it('does not report the password as rotated', () => {
    const { ctx, view } = apply<ResponseActionView>(ready(), action('revoke_sessions'));

    expect(find(view.effects, 'd.arslan.password')).toBeUndefined();
    expect(credentialPosture(ctx).password).toBe('exposed');
    expect(identityStatuses(ctx, 'usr_dilara')).not.toContain('credentials_reset');
  });
});

/* ------------------------------------------------------------------ *
 * isolate_endpoint
 * ------------------------------------------------------------------ */

describe('isolate_endpoint', () => {
  const ready = () =>
    drive([
      decide('D1', 'D1_preserve_and_inspect'),
      inspect('art_email_001'),
      decide('D2', 'D2_compare_signin_telemetry'),
      diagnostic('auth_timeline'),
      inspect('art_cookie_001'),
      decide('D3', 'D3_revoke_then_reset'),
      decide('D4', 'D4_collect_then_isolate'),
      inspect('art_edr_001'),
    ]);

  it('changes the EDR host state', () => {
    const before = ready();
    const { ctx, view } = apply<ResponseActionView>(before, action('isolate_endpoint'));

    expect(endpointPosture(before).containment).toBe('online');
    expect(endpointPosture(ctx).containment).toBe('isolated');
    expect(find(view.effects, 'WKS-114')).toEqual({
      source: 'endpoint',
      key: 'WKS-114',
      before: 'online',
      after: 'isolated',
    });
    expect(assetStatus(ctx, 'WKS-114')).toBe('isolated');
  });

  it('stops every network connection from the host', () => {
    const before = ready();
    const { ctx } = apply<ResponseActionView>(before, action('isolate_endpoint'));

    expect(endpointPosture(before).establishedCount).toBeGreaterThan(0);
    expect(endpointPosture(ctx).establishedCount).toBe(0);
    for (const conn of endpointPosture(ctx).connections) {
      expect(conn.state).toBe('severed');
      expect(conn.stoppedBy).toBe('isolate_endpoint');
    }
  });

  it('preserves evidence already collected from the host', () => {
    const before = ready();
    const { ctx } = apply<ResponseActionView>(before, action('isolate_endpoint'));

    expect(endpointPosture(before).collectedEvidence).toContain('art_edr_001');
    expect(endpointPosture(ctx).collectedEvidence).toEqual(
      endpointPosture(before).collectedEvidence,
    );
    expect(ctx.destroyedArtifacts).toEqual([]);
    expect(ctx.inspectedArtifacts).toContain('art_edr_001');
  });

  it('reports the extension as contained *and* preserved, never as removed', () => {
    const { ctx, view } = apply<ResponseActionView>(ready(), action('isolate_endpoint'));

    expect(endpointPosture(ctx).extension.state).toBe('contained_preserved');
    expect(find(view.effects, 'WKS-114.extension')?.after).toBe('contained, preserved');
  });

  it('does not claim the evidence count changed', () => {
    const { view } = apply<ResponseActionView>(ready(), action('isolate_endpoint'));
    expect(find(view.effects, 'WKS-114.evidence')).toBeUndefined();
  });

  /*
   * Isolation alone does not stop the exfiltration, and the simulation says so.
   * The attacker replayed the cookie onto their own device, `fp_9c2a41e0`, so
   * taking the user's laptop off the network cuts the extension's beacon and
   * leaves the session-backed transfer running. An analyst who isolates and
   * stops there should be able to see that on the egress chart.
   */
  it('does not stop egress on its own — the attacker is not on this host', () => {
    const { ctx, view } = apply<ResponseActionView>(ready(), action('isolate_endpoint'));

    expect(endpointPosture(ctx).containment).toBe('isolated');
    expect(currentEgress(ctx)).toBeGreaterThan(0);
    expect(networkPosture(ctx).every((r) => r.verdict === 'allow')).toBe(true);
    expect(fact(ctx, 'egress')).toMatchObject({ state: 'open', attention: true });

    /*
     * `stillOpen` is capped and orders the sources this operation touched
     * first, so the egress gap can fall off the end of it — as it does here,
     * behind four endpoint and identity gaps. That is why the cap is a
     * convenience and `unresolvedCriticalFindings` is the authority: the gap
     * has to survive there whatever the cap does.
     */
    expect(view.unresolvedCriticalFindings).toContain('indicators_unblocked');
    expect(view.stillOpen.length).toBeLessThanOrEqual(4);
  });
});

/* ------------------------------------------------------------------ *
 * block_indicator
 * ------------------------------------------------------------------ */

describe('block_indicator', () => {
  const ready = () =>
    drive([
      decide('D1', 'D1_preserve_and_inspect'),
      inspect('art_email_001'),
      decide('D2', 'D2_compare_signin_telemetry'),
      diagnostic('auth_timeline'),
      inspect('art_cookie_001'),
      decide('D3', 'D3_revoke_then_reset'),
      decide('D4', 'D4_collect_then_isolate'),
      decide('D5', 'D5_sweep_indicators'),
      diagnostic('indicator_scope'),
    ]);

  it('flips the proxy and mail-gateway verdicts', () => {
    const before = ready();
    const { ctx, view } = apply<ResponseActionView>(before, action('block_indicator'));

    expect(networkPosture(before).every((r) => r.verdict === 'allow')).toBe(true);
    expect(networkPosture(ctx).every((r) => r.verdict === 'deny')).toBe(true);
    expect(networkPosture(ctx).every((r) => r.appliedBy === 'block_indicator')).toBe(true);

    expect(find(view.effects, '203.0.113.47')?.after).toBe('deny at egress proxy');
    expect(find(view.effects, 'cy-case-secure-id.net')?.after).toBe('deny at mail gateway');
  });

  it('changes the egress timeline', () => {
    const before = ready();
    const { ctx } = apply<ResponseActionView>(before, action('block_indicator'));

    expect(currentEgress(before)).toBeGreaterThan(0);
    expect(currentEgress(ctx)).toBe(0);

    // Far enough out that the incident's transfer spikes have decayed to
    // nothing, so what is being cut here is the extension's sustained
    // beaconing rather than the tail of an event that was over anyway.
    const later = (c: GameContext) => ({ ...c, clockSec: c.clockSec + 900 });
    expect(egressTimeline(later(before)).at(-1)?.bytes).toBeGreaterThan(1000);
    expect(egressTimeline(later(ctx)).at(-1)?.bytes).toBe(0);
  });

  it('leaves the egress open when nothing has been blocked', () => {
    const ctx = ready();
    expect(egressTimeline(ctx).some((s) => s.bytes > 0)).toBe(true);
  });

  it('blocks the collector connection without isolating the host', () => {
    const { ctx } = apply<ResponseActionView>(ready(), action('block_indicator'));
    const posture = endpointPosture(ctx);

    expect(posture.containment).toBe('online');
    const collector = posture.connections.find((c) => c.purpose === 'collector');
    expect(collector?.state).toBe('blocked');
    expect(collector?.stoppedBy).toBe('block_indicator');
  });

  it('marks the blocked indicators in the scope diagnostic', () => {
    const before = ready();
    const { ctx } = apply<ResponseActionView>(before, action('block_indicator'));

    const row = (c: GameContext, key: string) =>
      diagnosticRows(c, 'indicator_scope').find((r) => r.key === key)?.value ?? '';

    expect(row(before, '203.0.113.47')).not.toContain('BLOCKED');
    expect(row(ctx, '203.0.113.47')).toContain('BLOCKED at egress proxy');
    expect(row(ctx, 'cy-case-secure-id.net')).toContain('BLOCKED at mail gateway');
  });
});

/* ------------------------------------------------------------------ *
 * Scope diagnostics
 * ------------------------------------------------------------------ */

describe('indicator_scope', () => {
  const ready = () =>
    drive([
      decide('D1', 'D1_preserve_and_inspect'),
      inspect('art_email_001'),
      decide('D2', 'D2_compare_signin_telemetry'),
    ]);

  it('adds the discovered identity and asset, and revises the blast radius', () => {
    const before = ready();
    const { ctx, view } = apply<DiagnosticView>(before, diagnostic('indicator_scope'));

    expect(blastRadius(before)).toMatchObject({ targeted: 1, verified: false });
    expect(blastRadius(ctx)).toMatchObject({ targeted: 2, verified: true });
    expect(blastRadius(ctx).assetsInScope).toBe(blastRadius(before).assetsInScope + 1);

    const effect = find(view.effects, 'blast-radius');
    expect(effect?.before).toContain('unverified');
    expect(effect?.after).toContain('verified');
    expect(effect?.after).toContain('2 targeted');
  });

  it('makes the second host visible in the topology', () => {
    const before = ready();
    const { ctx } = apply<DiagnosticView>(before, diagnostic('indicator_scope'));

    const node = (c: GameContext) => topology(c).nodes.find((n) => n.id === 'WKS-231');
    expect(node(before)?.hidden).toBe(true);
    expect(node(ctx)?.hidden).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * close_case
 * ------------------------------------------------------------------ */

describe('close_case', () => {
  it('is unavailable until the closing decision has been made', () => {
    const ctx = drive(GOLDEN.slice(0, GOLDEN.length - 1));
    expect(ctx.decisions.D6).toBeUndefined();

    const refused = run(ctx, action('close_case'));
    expect(refused.result.ok).toBe(false);
    expect(refused.result.error?.code).toBe('ACTION_NOT_ALLOWED');
    expect(refused.context.caseClosed).toBe(false);
  });

  it('closes the incident, and reports that as its effect', () => {
    const ctx = drive(GOLDEN);
    const { view } = apply<ResponseActionView>(ctx, action('close_case'));

    expect(view.ending).toBe('contained');
    expect(view.effects).toHaveLength(1);
    expect(view.effects[0]).toMatchObject({
      source: 'incident',
      key: 'INC-74219',
      after: 'closed (contained)',
    });
    expect(view.stillOpen).toEqual([]);
  });

  it('names what is still open when the case is closed early', () => {
    const ctx = drive([
      decide('D1', 'D1_preserve_and_inspect'),
      inspect('art_email_001'),
      decide('D2', 'D2_compare_signin_telemetry'),
      diagnostic('auth_timeline'),
      inspect('art_cookie_001'),
      decide('D3', 'D3_password_only'),
      decide('D4', 'D4_delete_email_and_close_alert'),
      decide('D5', 'D5_assume_single_account'),
      decide('D6', 'D6_close_without_verifying'),
    ]);

    const { view } = apply<ResponseActionView>(ctx, action('close_case'));

    expect(view.ending).toBe('partial');
    expect(view.effects.length).toBeGreaterThan(0);
    expect(view.stillOpen.length).toBeGreaterThan(0);
    expect(view.stillOpen.join(' | ')).toContain('SES-8842');
  });
});

/* ------------------------------------------------------------------ *
 * Attributable timeline
 * ------------------------------------------------------------------ */

describe('attributable timeline', () => {
  it('gives every operation exactly one row, attributed to who ran it', () => {
    let ctx = createInitialContext();
    for (const step of GOLDEN) {
      const input: Record<string, unknown> = { ...step.input, stateVersion: ctx.stateVersion };
      if (step.kind === 'take_response_action' || step.kind === 'submit_decision') {
        keyCounter += 1;
        input.idempotencyKey = `k-${keyCounter}`;
      }
      // Containment runs from the console, everything else from the agent, so
      // the two origins have to be distinguishable in one chronology.
      const origin = step.kind === 'take_response_action' ? 'human' : 'agent';
      ctx = executeCommand(ctx, {
        kind: step.kind,
        input,
        origin,
      } as unknown as GameCommand).context;
    }

    const log = caseLog(ctx);
    const actions = log.filter((row) => row.kind === 'action');

    expect(actions).toHaveLength(4);
    for (const row of actions) expect(row.origin).toBe('human');
    for (const row of log.filter((r) => r.kind === 'evidence' || r.kind === 'diagnostic')) {
      expect(row.origin).toBe('agent');
    }
    expect(log[0]?.origin).toBe('system');
  });
});

/* ------------------------------------------------------------------ *
 * Determinism and budget
 * ------------------------------------------------------------------ */

describe('effects change nothing the run signature depends on', () => {
  it('replays the golden run to a byte-identical signature', () => {
    const live = drive([...GOLDEN, action('close_case')]);
    const replayed = replay(live.commandLog);

    expect(JSON.stringify(replaySignature(replayed))).toBe(
      JSON.stringify(replaySignature(live)),
    );
    expect(replayed.ending).toBe('contained');
  });

  it('derives every source view without touching the state version', () => {
    const ctx = drive(GOLDEN);
    const version = ctx.stateVersion;

    sourceSnapshot(ctx);
    sessionInventory(ctx);
    endpointPosture(ctx);
    networkPosture(ctx);
    blastRadius(ctx);
    egressTimeline(ctx);
    diagnosticRows(ctx, 'session_inventory');

    expect(ctx.stateVersion).toBe(version);
  });

  it('produces identical snapshots for identical runs', () => {
    const a = drive([...GOLDEN, action('close_case')]);
    const b = drive([...GOLDEN, action('close_case')]);
    expect(sourceSnapshot(a)).toEqual(sourceSnapshot(b));
  });
});

describe('wire budget', () => {
  it('fits every operation result without truncating its effects', () => {
    let ctx = createInitialContext();
    const results: { label: string; result: ToolResult }[] = [];

    for (const step of [...GOLDEN, action('close_case')]) {
      const outcome = run(ctx, step);
      ctx = outcome.context;
      if (step.kind !== 'take_response_action' && step.kind !== 'run_diagnostic') continue;
      const { seq: _seq, ...result } = outcome.result;
      results.push({ label: String(Object.values(step.input)[0]), result });
    }

    expect(results).toHaveLength(8);

    for (const { label, result } of results) {
      const compact = compactResult(result);
      const size = JSON.stringify(compact).length;
      const data = compact.data as Record<string, unknown>;

      expect(size, `${label} exceeds the wire budget`).toBeLessThanOrEqual(RESULT_BUDGET);
      expect(data.effectsTruncated, `${label} lost effects to the compactor`).toBeUndefined();
      expect(data.stillOpenTruncated, `${label} lost stillOpen to the compactor`).toBeUndefined();
      expect(
        (data.effects as unknown[]).length,
        `${label} arrived with no effects`,
      ).toBeGreaterThan(0);
    }
  });
});
