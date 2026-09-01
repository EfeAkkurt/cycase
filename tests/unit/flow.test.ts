import { describe, expect, it } from 'vitest';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import { DECISION_BY_ID, RESPONSE_ACTIONS } from '../../src/game/fixtures/case001';
import {
  GUIDED_PLAN,
  INCIDENT_PHASES,
  commandReceipt,
  correctivePath,
  isDecisionUnlocked,
  nextRequiredStep,
  openDecisionId,
  pendingProposal,
  phaseProgress,
  unresolvedCriticalFindings,
} from '../../src/game/selectors';
import { computeScore } from '../../src/game/scoring';
import { tk } from '../../src/i18n';
import { en } from '../../src/i18n/en';
import type { GameCommand, GameContext } from '../../src/game/types';

/**
 * The task and evidence flow.
 *
 * Five properties this suite exists to hold, each of which the console got
 * wrong at least once:
 *
 *   1. one progress model, not two;
 *   2. one command per press, so a single control cannot apply five mutations;
 *   3. evidence is recorded as read by the surface that displays it, so the
 *      case cannot advance past a decision the player answered blind;
 *   4. a wrong decision keeps its cost and gains a way forward;
 *   5. every command produces a receipt at the control that issued it, and a
 *      refusal additionally says what did not change and offers one recovery.
 */

let key = 0;

function apply(ctx: GameContext, kind: string, input: Record<string, unknown>): GameContext {
  key += 1;
  return executeCommand(ctx, {
    kind,
    input: { ...input, stateVersion: ctx.stateVersion, idempotencyKey: `flow-${key}` },
    origin: 'human',
  } as unknown as GameCommand).context;
}

function narrate(
  ctx: GameContext,
  extra: Record<string, unknown>,
  version = ctx.stateVersion,
): GameContext {
  key += 1;
  return executeCommand(ctx, {
    kind: 'present_guidance',
    input: {
      basedOnStateVersion: version,
      idempotencyKey: `narr-${key}`,
      tone: 'teaching',
      language: 'en',
      message: 'Here is what the evidence shows.',
      ...extra,
    },
    origin: 'agent',
  } as unknown as GameCommand).context;
}

function stageInput(command: {
  kind: string;
  artifactId?: string;
  diagnosticId?: string;
  actionId?: string;
}): Record<string, unknown> {
  if (command.kind === 'inspect_artifact') return { artifactId: command.artifactId };
  if (command.kind === 'run_diagnostic') return { diagnosticId: command.diagnosticId };
  return { actionId: command.actionId };
}

/** Follows the guided path one stage at a time, choosing options by predicate. */
function play(
  pick: (decisionId: string, options: { id: string; correct: boolean }[]) => string,
  stop: (ctx: GameContext) => boolean = () => false,
): GameContext {
  let ctx = createInitialContext();

  for (let guard = 0; guard < 60; guard += 1) {
    if (stop(ctx)) break;
    const step = nextRequiredStep(ctx);
    if (!step) break;

    if (step.decision) {
      const decision = DECISION_BY_ID.get(step.decision.decisionId)!;
      const optionId = pick(
        decision.id,
        decision.options.map((option) => ({ id: option.id, correct: Boolean(option.correct) })),
      );
      ctx = apply(ctx, 'submit_decision', { decisionId: decision.id, optionId });
      continue;
    }

    ctx = apply(ctx, step.stage!.command.kind, stageInput(step.stage!.command));
  }

  return ctx;
}

const best = (_id: string, options: { id: string; correct: boolean }[]) =>
  options.find((option) => option.correct)!.id;

/** The run that takes the taught option everywhere except D3. */
const passwordOnlyAtD3 = (id: string, options: { id: string; correct: boolean }[]) =>
  id === 'D3' ? 'D3_password_only' : options.find((option) => option.correct)!.id;

/** Stop once the plan has walked past the containment operation. */
const atD5 = (current: GameContext) => {
  const step = nextRequiredStep(current);
  return step === null || step.id === 'd5';
};

/* ------------------------------------------------------------------ */

describe('one progress model', () => {
  it('gives every guided step a phase, and only the five named phases', () => {
    expect(INCIDENT_PHASES).toEqual(['triage', 'investigate', 'contain', 'scope', 'close']);
    for (const step of GUIDED_PLAN) {
      expect(INCIDENT_PHASES, `${step.id} has no phase`).toContain(step.phase);
    }
  });

  it('no longer offers a step-of-eleven or a decision-of-six count', () => {
    // The two rival claims are gone from the string table itself, which is
    // where they would otherwise quietly come back.
    expect('guide.progress' in en).toBe(false);
    expect(en['decision.progress']).not.toContain('Decision');
    expect(en['phase.progress']).toContain('{phase}');
  });

  it('walks Triage → Investigate → Contain → Scope → Close and never backwards', () => {
    let ctx = createInitialContext();
    const seen: string[] = [];

    for (let guard = 0; guard < 60; guard += 1) {
      const step = nextRequiredStep(ctx);
      if (!step) break;
      if (seen.at(-1) !== step.phase) seen.push(step.phase);

      if (step.decision) {
        const decision = DECISION_BY_ID.get(step.decision.decisionId)!;
        ctx = apply(ctx, 'submit_decision', {
          decisionId: decision.id,
          optionId: decision.options.find((option) => option.correct)!.id,
        });
      } else {
        ctx = apply(ctx, step.stage!.command.kind, stageInput(step.stage!.command));
      }
    }

    expect(seen).toEqual([...INCIDENT_PHASES]);
    expect(phaseProgress(ctx).complete).toBe(true);
  });

  it('counts stages inside the active phase, never past its own total', () => {
    let ctx = createInitialContext();

    for (let guard = 0; guard < 60; guard += 1) {
      const progress = phaseProgress(ctx);
      if (progress.complete) break;

      expect(progress.stageIndex).toBeGreaterThanOrEqual(1);
      expect(progress.stageIndex).toBeLessThanOrEqual(progress.stageTotal);
      expect(progress.index).toBeGreaterThanOrEqual(1);
      expect(progress.index).toBeLessThanOrEqual(progress.total);

      const active = progress.phases.filter((phase) => phase.state === 'active');
      expect(active, 'exactly one phase is active at a time').toHaveLength(1);

      const step = nextRequiredStep(ctx)!;
      if (step.decision) {
        const decision = DECISION_BY_ID.get(step.decision.decisionId)!;
        ctx = apply(ctx, 'submit_decision', {
          decisionId: decision.id,
          optionId: decision.options.find((option) => option.correct)!.id,
        });
      } else {
        ctx = apply(ctx, step.stage!.command.kind, stageInput(step.stage!.command));
      }
    }
  });
});

describe('one press, one action', () => {
  it('never offers a stage that stands for more than one command', () => {
    let ctx = createInitialContext();

    for (let guard = 0; guard < 60; guard += 1) {
      const step = nextRequiredStep(ctx);
      if (!step) break;

      if (step.decision) {
        const decision = DECISION_BY_ID.get(step.decision.decisionId)!;
        ctx = apply(ctx, 'submit_decision', {
          decisionId: decision.id,
          optionId: decision.options.find((option) => option.correct)!.id,
        });
        continue;
      }

      // The stage is the first pending command and nothing else; the rest are
      // named as upcoming, and running one is a separate press.
      expect(step.stage!.command).toEqual(step.pending[0]);
      expect(step.upcoming).toHaveLength(step.pending.length - 1);

      const before = ctx.stateVersion;
      const next = apply(ctx, step.stage!.command.kind, stageInput(step.stage!.command));
      // Exactly one version bump: five mutations behind one control is the
      // defect this whole shape exists to prevent.
      expect(next.stateVersion - before).toBeLessThanOrEqual(1);
      ctx = next;
    }
  });

  it('turns the containment operation into five separately authorised stages', () => {
    const contain = GUIDED_PLAN.find((step) => step.id === 'contain')!;
    expect(contain.kind).toBe('operation');
    expect(contain.kind === 'operation' && contain.commands).toHaveLength(5);

    // Reach the containment phase on the best route.
    let ctx = play(best, (current) => nextRequiredStep(current)?.id === 'contain');

    const presses: string[] = [];
    for (let guard = 0; guard < 10; guard += 1) {
      const step = nextRequiredStep(ctx);
      if (!step || step.id !== 'contain') break;
      presses.push(step.stage!.key);
      ctx = apply(ctx, step.stage!.command.kind, stageInput(step.stage!.command));
    }

    expect(presses).toEqual([
      'diagnostic:session_inventory',
      'action:revoke_sessions',
      'action:reset_credentials',
      'inspect:art_edr_001',
      'action:isolate_endpoint',
    ]);
  });

  it('asks for a confirmation only over the operation the fixture marked', () => {
    let ctx = createInitialContext();
    const confirmed: string[] = [];
    const seen: string[] = [];

    for (let guard = 0; guard < 60; guard += 1) {
      const step = nextRequiredStep(ctx);
      if (!step) break;
      if (step.decision) {
        const decision = DECISION_BY_ID.get(step.decision.decisionId)!;
        ctx = apply(ctx, 'submit_decision', {
          decisionId: decision.id,
          optionId: decision.options.find((option) => option.correct)!.id,
        });
        continue;
      }

      const stage = step.stage!;
      if (stage.requiresConfirmation) confirmed.push(stage.key);
      if (stage.kind !== 'take_response_action') {
        expect(stage.requiresConfirmation, `${stage.key} raised a dialog`).toBe(false);
        expect(stage.consequential, `${stage.key} claimed to be destructive`).toBe(false);
      }
      ctx = apply(ctx, stage.command.kind, stageInput(stage.command));
      seen.push(stage.key);
    }

    const expected = RESPONSE_ACTIONS.filter((action) => action.requiresConfirmation).map(
      (action) => `action:${action.id}`,
    );
    // Every consequential operation still confirms; nothing else does.
    expect(confirmed.sort()).toEqual(expected.sort());
    expect(seen.length).toBeGreaterThan(confirmed.length);
  });
});

describe('evidence cannot be read from somewhere that cannot show it', () => {
  it('makes the reported message a navigation, not a mutation', () => {
    let ctx = createInitialContext();
    ctx = apply(ctx, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
    });

    const step = nextRequiredStep(ctx)!;
    expect(step.id).toBe('read_report');
    expect(step.stage!.kind).toBe('inspect_artifact');
    // The stage says where it goes. The console navigates there and the
    // inspector records the read; the control itself applies nothing.
    expect(step.stage!.navigatesTo).toBe('evidence');
    expect(step.stage!.consequential).toBe(false);
  });

  it('keeps D2 locked until the message has actually been recorded as read', () => {
    let ctx = createInitialContext();
    ctx = apply(ctx, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
    });

    expect(ctx.inspectedArtifacts).not.toContain('art_email_001');
    expect(isDecisionUnlocked(ctx, 'D2')).toBe(false);
    expect(openDecisionId(ctx)).toBeNull();

    ctx = apply(ctx, 'inspect_artifact', { artifactId: 'art_email_001' });

    expect(ctx.inspectedArtifacts).toContain('art_email_001');
    expect(isDecisionUnlocked(ctx, 'D2')).toBe(true);
    expect(openDecisionId(ctx)).toBe('D2');
  });
});

describe('the corrective path', () => {
  it('offers nothing before anything has gone wrong', () => {
    expect(correctivePath(createInitialContext())).toEqual([]);
  });

  it('offers nothing on a run that took every taught option', () => {
    const ctx = play(best);
    expect(ctx.ending).toBe('contained');
    expect(correctivePath(ctx)).toEqual([]);
  });

  it('names the operation a wrong decision withheld, once the plan has passed it', () => {
    // D3_password_only recommends the reset and not the revocation, so the
    // guided path steps over `revoke_sessions` and the stolen session stays up.
    const ctx = play(passwordOnlyAtD3, atD5);

    expect(ctx.decisions.D3?.optionId).toBe('D3_password_only');
    expect(unresolvedCriticalFindings(ctx)).toContain('rogue_session_active');

    const corrective = correctivePath(ctx);
    expect(corrective.map((step) => step.actionId)).toContain('revoke_sessions');

    const revoke = corrective.find((step) => step.actionId === 'revoke_sessions')!;
    expect(revoke.findingId).toBe('rogue_session_active');
    expect(revoke.destructive).toBe(true);
    expect(revoke.requiresConfirmation).toBe(true);
    expect(revoke.why).toContain('still open');
  });

  it('is deterministic — the same case state always produces the same path', () => {
    expect(correctivePath(play(passwordOnlyAtD3, atD5))).toEqual(
      correctivePath(play(passwordOnlyAtD3, atD5)),
    );
  });

  it('does not rewrite what the wrong decision cost', () => {
    let ctx = play(passwordOnlyAtD3, atD5);

    const penalty = ctx.scoreEntries.filter((entry) => entry.source === 'decision:D3_password_only');
    const before = computeScore(ctx.scoreEntries).total;

    const corrective = correctivePath(ctx)[0]!;
    ctx = apply(ctx, 'take_response_action', { actionId: corrective.actionId });

    // The correction closes the finding and scores its own delta. What it does
    // not do is retroactively forgive the decision that made it necessary.
    expect(unresolvedCriticalFindings(ctx)).not.toContain('rogue_session_active');
    expect(
      ctx.scoreEntries.filter((entry) => entry.source === 'decision:D3_password_only'),
    ).toEqual(penalty);
    expect(computeScore(ctx.scoreEntries).total).toBeGreaterThan(before);
  });
});

describe('receipts', () => {
  it('anchors every receipt to the control that issued the command', () => {
    let ctx = createInitialContext();

    ctx = apply(ctx, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
    });
    expect(commandReceipt(ctx)).toMatchObject({ anchor: 'decision-D1', state: 'done' });

    ctx = apply(ctx, 'inspect_artifact', { artifactId: 'art_email_001' });
    expect(commandReceipt(ctx)).toMatchObject({ anchor: 'evidence-art_email_001' });

    ctx = apply(ctx, 'submit_decision', {
      decisionId: 'D2',
      optionId: 'D2_compare_signin_telemetry',
    });
    ctx = apply(ctx, 'run_diagnostic', { diagnosticId: 'auth_timeline' });
    expect(commandReceipt(ctx)).toMatchObject({ anchor: 'diagnostic-auth_timeline' });
  });

  it('answers what happened, what changed and why it mattered', () => {
    let ctx = createInitialContext();
    ctx = apply(ctx, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
    });

    const receipt = commandReceipt(ctx)!;
    expect(receipt.result.length).toBeGreaterThan(0);
    expect(receipt.why.length).toBeGreaterThan(0);
    expect(receipt.changed.some((line) => line.includes('Case state is now'))).toBe(true);
  });

  it('says what did not change after a refusal, and offers exactly one recovery', () => {
    let ctx = createInitialContext();
    // close_case before D6 is the case's own refusal, with its own recovery.
    ctx = apply(ctx, 'take_response_action', { actionId: 'close_case' });

    const receipt = commandReceipt(ctx)!;
    expect(receipt.state).toBe('failed');
    expect(receipt.anchor).toBe('action-close_case');
    expect(receipt.unchanged.some((line) => line.includes('still v'))).toBe(true);
    expect(receipt.recovery).not.toBeNull();
    // One. An error offering three recoveries has said it does not know which.
    expect(Object.keys(receipt.recovery!)).toContain('label');
    expect(ctx.caseClosed).toBe(false);
  });

  it('reports a weaker decision branch as partial, with a way forward', () => {
    let ctx = play(passwordOnlyAtD3, atD5);
    ctx = apply(ctx, 'submit_decision', { decisionId: 'D5', optionId: 'D5_assume_single_account' });

    const receipt = commandReceipt(ctx)!;
    expect(receipt.state).toBe('partial');
    expect(receipt.unchanged.length).toBeGreaterThan(0);
    expect(receipt.recovery).not.toBeNull();
  });

  it('produces no receipt for a pure read', () => {
    const ctx = apply(createInitialContext(), 'get_incident', {});
    expect(commandReceipt(ctx)).toBeNull();
  });
});

describe('the agent proposes, the player disposes', () => {
  it('surfaces a proposal without moving the case at all', () => {
    const before = createInitialContext();
    const ctx = narrate(before, {
      proposes: { kind: 'submit_decision', decisionId: 'D1', optionId: 'D1_preserve_and_inspect' },
    });

    expect(ctx.stateVersion).toBe(before.stateVersion);
    expect(ctx.scoreEntries).toEqual(before.scoreEntries);
    expect(ctx.decisions).toEqual(before.decisions);

    const proposal = pendingProposal(ctx)!;
    expect(proposal.proposal).toEqual({
      kind: 'submit_decision',
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
    });
    /*
     * The label is the case fixture's, resolved from the option id — never the
     * model's line. That is the whole safety property of a proposal: an agent
     * cannot dress one operation up as another, because the words beside the
     * Approve control are not words it wrote.
     */
    const option = DECISION_BY_ID.get('D1')!.options.find(
      (candidate) => candidate.id === 'D1_preserve_and_inspect',
    )!;
    expect(proposal.label).toBe(tk(option.labelKey));
    expect(proposal.message).toBe('Here is what the evidence shows.');
    expect(proposal.label).not.toBe(proposal.message);
  });

  it('refuses an option that does not belong to the decision it names', () => {
    const before = createInitialContext();
    const ctx = narrate(before, {
      proposes: { kind: 'submit_decision', decisionId: 'D1', optionId: 'D3_password_only' },
    });

    expect(ctx.lastResult?.ok).toBe(false);
    expect(ctx.lastResult?.error?.code).toBe('INVALID_INPUT');
    expect(pendingProposal(ctx)).toBeNull();
  });

  it('drops a proposal the case has already moved past', () => {
    let ctx = createInitialContext();
    ctx = narrate(ctx, {
      proposes: { kind: 'take_response_action', actionId: 'revoke_sessions' },
    });
    expect(pendingProposal(ctx)).not.toBeNull();

    ctx = apply(ctx, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
    });
    // Written about a state the player has left: no longer offered.
    expect(pendingProposal(ctx)).toBeNull();
  });

  it('does not offer a proposal for a move the case would refuse', () => {
    const ctx = narrate(createInitialContext(), {
      proposes: { kind: 'take_response_action', actionId: 'close_case' },
    });
    expect(pendingProposal(ctx)).toBeNull();
  });

  it('tells the agent when the next move needs the player, and when it does not', () => {
    let ctx = createInitialContext();
    // A decision is open from the start: that is the player's to make.
    expect(nextRequiredStep(ctx)!.decision).not.toBeNull();

    ctx = apply(ctx, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
    });
    // Reading the reported message is not.
    const step = nextRequiredStep(ctx)!;
    expect(step.stage!.kind).toBe('inspect_artifact');
    expect(step.consequential).toBe(false);
  });
});
