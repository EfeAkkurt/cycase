import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import { DECISION_BY_ID } from '../../src/game/fixtures/case001';
import {
  COMMAND_INCIDENT_COST,
  INCIDENT_SECONDS_PER_PLAY_SECOND,
  SAMPLE_SECONDS,
  WINDOW_SAMPLES,
  caseLog,
  clocks,
  currentRate,
  eventWindow,
  feedHealth,
  formatAge,
  incidentSeconds,
  operationCostSeconds,
  playSeconds,
  streamPulse,
} from '../../src/game/live';
import { gameMachine, type GameEvent } from '../../src/game/machine';
import { replay, replaySignature } from '../../src/game/replay';
import { computeScore } from '../../src/game/scoring';
import {
  explorations,
  lastCompletedStep,
  nextRequiredStep,
  unresolvedCriticalFindings,
} from '../../src/game/selectors';
import type { GameCommand, GameContext } from '../../src/game/types';

/**
 * `docs/VISUAL_RESET.md`: "Do not animate random numbers… every value must be
 * explainable from case state." These tests are what make that claim checkable
 * rather than aspirational.
 */

const MUTATING = new Set(['take_response_action', 'submit_decision']);

function drive(
  steps: { kind: string; input: Record<string, unknown> }[],
  start = createInitialContext(),
): GameContext {
  let ctx = start;
  for (const [index, step] of steps.entries()) {
    const input: Record<string, unknown> = { ...step.input, stateVersion: ctx.stateVersion };
    if (MUTATING.has(step.kind)) input.idempotencyKey = `live-${index}`;
    ctx = executeCommand(ctx, {
      kind: step.kind,
      input,
      origin: 'agent',
    } as unknown as GameCommand).context;
  }
  return ctx;
}

function tick(ctx: GameContext, seconds: number): GameContext {
  return { ...ctx, clockSec: ctx.clockSec + seconds };
}

describe('event window', () => {
  it('advances with the simulation clock rather than standing still', () => {
    const start = createInitialContext();
    const later = tick(start, SAMPLE_SECONDS * 5);

    const first = eventWindow(start);
    const second = eventWindow(later);

    expect(second[second.length - 1]!.atSec - first[first.length - 1]!.atSec).toBe(
      SAMPLE_SECONDS * 5,
    );
    expect(second[second.length - 1]!.label).not.toBe(first[first.length - 1]!.label);
  });

  it('ends on the current clock and holds the window length', () => {
    const ctx = tick(createInitialContext(), 600);
    const window = eventWindow(ctx);

    expect(window).toHaveLength(WINDOW_SAMPLES);
    expect(window[window.length - 1]!.atSec).toBeLessThanOrEqual(ctx.clockSec);
    expect(ctx.clockSec - window[window.length - 1]!.atSec).toBeLessThan(SAMPLE_SECONDS);
  });

  it('is a pure function of the clock and the case — same input, same numbers', () => {
    const a = tick(createInitialContext(), 300);
    const b = tick(createInitialContext(), 300);
    expect(eventWindow(b)).toEqual(eventWindow(a));

    // And re-reading the same context never changes it either.
    expect(eventWindow(a)).toEqual(eventWindow(a));
  });

  it('collapses attacker activity once sessions are revoked', () => {
    const before = drive([
      { kind: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
    ]);
    const after = drive([
      { kind: 'take_response_action', input: { actionId: 'revoke_sessions' } },
    ], before);

    const laterBefore = tick(before, 600);
    const laterAfter = tick(after, 600);

    const peak = (ctx: GameContext) =>
      Math.max(...eventWindow(ctx).map((sample) => sample.anomaly));

    expect(peak(laterAfter)).toBeLessThan(peak(laterBefore));
  });

  it('reaches zero anomalous traffic once the endpoint is isolated too', () => {
    const ctx = drive([
      { kind: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
      { kind: 'take_response_action', input: { actionId: 'revoke_sessions' } },
      { kind: 'take_response_action', input: { actionId: 'isolate_endpoint' } },
    ]);

    const later = tick(ctx, 900);
    expect(currentRate(later).anomalous).toBe(0);
  });

  it('never emits a negative or fractional sample', () => {
    for (const offset of [0, 120, 600, 3600]) {
      for (const sample of eventWindow(tick(createInitialContext(), offset))) {
        expect(Number.isInteger(sample.baseline)).toBe(true);
        expect(Number.isInteger(sample.anomaly)).toBe(true);
        expect(sample.baseline).toBeGreaterThanOrEqual(0);
        expect(sample.anomaly).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * The live edge
 * ------------------------------------------------------------------ */

describe('the stream pulse', () => {
  /**
   * The claim the UI makes is a compound one — "the readouts move every second,
   * the data does not" — and it is only worth making if both halves are
   * checkable. These are the checks.
   */

  /**
   * The case opens at 03:17:42, which is not on a bucket boundary — the
   * incident did not consult the sampling interval. Tests about crossing a
   * boundary have to walk to one first rather than assume the start is aligned.
   */
  function atBoundary(): GameContext {
    const start = createInitialContext();
    return tick(start, (SAMPLE_SECONDS - (start.clockSec % SAMPLE_SECONDS)) % SAMPLE_SECONDS);
  }

  it('moves its readouts every play second without producing a new sample', () => {
    // One real second of play advances the incident clock by the documented
    // multiplier. Nine of those still sit inside a 30-second bucket.
    let ctx = atBoundary();
    const settled = streamPulse(ctx);
    const seen = new Set<string>();

    for (let second = 0; second < 9; second += 1) {
      ctx = tick(ctx, INCIDENT_SECONDS_PER_PLAY_SECOND);
      const pulse = streamPulse(ctx);

      // Something visible changed …
      seen.add(`${pulse.ageSec}/${pulse.nextInSec}`);
      // … and it was not the data.
      expect(pulse.bucket).toBe(settled.bucket);
      expect(pulse.atSec).toBe(settled.atSec);
      expect(pulse.total).toBe(settled.total);
      expect(pulse.anomalous).toBe(settled.anomalous);
    }

    // A distinct readout for every second that passed: nine ticks, nine values.
    expect(seen.size).toBe(9);
    // And the chart itself is untouched for the whole of that.
    expect(eventWindow(ctx)).toEqual(eventWindow(atBoundary()));
  });

  it('lands a new sample only when the clock crosses a bucket boundary', () => {
    const start = atBoundary();
    const before = tick(start, SAMPLE_SECONDS - 1);
    const after = tick(start, SAMPLE_SECONDS);

    expect(streamPulse(before).bucket).toBe(streamPulse(start).bucket);
    expect(streamPulse(after).bucket).toBe(streamPulse(before).bucket + 1);
    expect(streamPulse(after).atSec - streamPulse(before).atSec).toBe(SAMPLE_SECONDS);
    // And the freshness readout resets rather than continuing to climb.
    expect(streamPulse(after).ageSec).toBe(0);
    expect(streamPulse(before).ageSec).toBe(SAMPLE_SECONDS - 1);
  });

  it('agrees with the window it labels, sample for sample', () => {
    // The chip must never report a different newest reading than the chart
    // draws — that is the failure mode a separate "live" widget invites.
    for (const offset of [0, 47, 600, 3607]) {
      const ctx = tick(createInitialContext(), offset);
      const window = eventWindow(ctx);
      const last = window[window.length - 1]!;
      const pulse = streamPulse(ctx);

      expect(pulse.atSec).toBe(last.atSec);
      expect(pulse.total).toBe(last.baseline + last.anomaly);
      expect(pulse.anomalous).toBe(last.anomaly);
      expect(pulse.total).toBe(currentRate(ctx).total);
      expect(pulse.anomalous).toBe(currentRate(ctx).anomalous);
    }
  });

  it('counts down to the next sample and never reports zero seconds away', () => {
    for (let offset = 0; offset < SAMPLE_SECONDS * 3; offset += 1) {
      const pulse = streamPulse(tick(createInitialContext(), offset));
      expect(pulse.ageSec).toBeGreaterThanOrEqual(0);
      expect(pulse.ageSec).toBeLessThan(SAMPLE_SECONDS);
      expect(pulse.ageSec + pulse.nextInSec).toBe(SAMPLE_SECONDS);
      expect(pulse.nextInSec).toBeGreaterThan(0);
    }
  });
});

describe('pausing the feed', () => {
  /**
   * "Pause must genuinely freeze the stream, not just hide it."
   *
   * The only way to make that checkable is to drive the real machine rather
   * than to hand-edit a context: the guarantee lives in `TICK` being ignored
   * while `paused`, and a test that mutates `clockSec` itself would prove
   * nothing about the machine that owns it.
   */
  function boot(): { send: (event: GameEvent) => void; read: () => GameContext } {
    const actor = createActor(gameMachine, { input: {} });
    actor.start();
    return {
      send: (event) => actor.send(event),
      read: () => actor.getSnapshot().context,
    };
  }

  const beat = { type: 'TICK', seconds: INCIDENT_SECONDS_PER_PLAY_SECOND } as const;

  it('stops the clock, the window and the freshness readout together', () => {
    const game = boot();
    // Run far enough in to be mid-bucket, where a stalled readout is visible.
    for (let i = 0; i < 4; i += 1) game.send(beat);

    game.send({ type: 'SET_PAUSED', paused: true });
    const frozen = game.read();
    const frozenPulse = streamPulse(frozen);
    const frozenWindow = eventWindow(frozen);

    expect(frozenPulse.frozen).toBe(true);

    // A minute of ticks against a paused feed.
    for (let i = 0; i < 20; i += 1) game.send(beat);

    const later = game.read();
    expect(later.clockSec).toBe(frozen.clockSec);
    expect(streamPulse(later)).toEqual(frozenPulse);
    expect(eventWindow(later)).toEqual(frozenWindow);
  });

  it('resumes where it stopped rather than jumping forward', () => {
    /*
     * The failure this forbids is the usual one: a paused view that hides the
     * stream while something keeps counting behind it, so resuming skips the
     * interval the operator spent reading. There is no second timer here — the
     * incident clock is the only clock — so resuming continues.
     */
    const game = boot();
    for (let i = 0; i < 3; i += 1) game.send(beat);
    const beforePause = game.read().clockSec;

    game.send({ type: 'SET_PAUSED', paused: true });
    for (let i = 0; i < 30; i += 1) game.send(beat);
    game.send({ type: 'SET_PAUSED', paused: false });

    expect(game.read().clockSec).toBe(beforePause);

    game.send(beat);
    expect(game.read().clockSec).toBe(beforePause + INCIDENT_SECONDS_PER_PLAY_SECOND);
  });

  it('reports frozen without changing a single number', () => {
    const game = boot();
    for (let i = 0; i < 5; i += 1) game.send(beat);
    const running = streamPulse(game.read());

    game.send({ type: 'SET_PAUSED', paused: true });
    const paused = streamPulse(game.read());

    // Pause is a label on the same reading, not a different reading.
    expect(paused).toEqual({ ...running, frozen: true });
  });
});

describe('case log', () => {
  it('opens with the incident and appends one row per real event', () => {
    const ctx = drive([
      { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      { kind: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
    ]);

    const log = caseLog(ctx);
    expect(log[0]?.kind).toBe('incident');
    expect(log.map((entry) => entry.kind)).toContain('decision');
    expect(log.map((entry) => entry.kind)).toContain('evidence');
    expect(log.map((entry) => entry.kind)).toContain('diagnostic');
  });

  it('is append-only: earlier rows never change as the case continues', () => {
    const early = drive([
      { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
    ]);
    const earlyLog = caseLog(early);

    const later = drive([{ kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } }], early);
    const laterLog = caseLog(later);

    expect(laterLog.slice(0, earlyLog.length)).toEqual(earlyLog);
    expect(laterLog.length).toBeGreaterThan(earlyLog.length);
  });

  it('records a resolved finding alongside the action that resolved it', () => {
    const ctx = drive([
      { kind: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
      { kind: 'take_response_action', input: { actionId: 'revoke_sessions' } },
    ]);

    const texts = caseLog(ctx).map((entry) => entry.text);
    expect(texts.some((text) => text.includes('Response applied'))).toBe(true);
    expect(texts.some((text) => text.includes('Finding resolved'))).toBe(true);
  });

  it('records rejections rather than hiding them', () => {
    const ctx = drive([
      { kind: 'take_response_action', input: { actionId: 'close_case' } },
    ]);
    expect(caseLog(ctx).some((entry) => entry.text.includes('rejected'))).toBe(true);
  });

  it('timestamps every row on the simulation clock', () => {
    const ctx = drive([
      { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
    ]);
    for (const entry of caseLog(ctx)) {
      expect(entry.at).toMatch(/^\d{2}:\d{2}:\d{2}$/);
      expect(entry.atSec).toBeGreaterThanOrEqual(ctx.caseOpenedAtSec);
    }
  });
});

describe('feed health', () => {
  it('reports how stale the last case event is', () => {
    const ctx = drive([
      { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
    ]);
    expect(feedHealth(ctx).ageSec).toBe(0);
    expect(feedHealth(tick(ctx, 45)).ageSec).toBe(45);
  });

  it('tracks the last agent call separately, and reports none before one happens', () => {
    const fresh = createInitialContext();
    expect(feedHealth(fresh).lastAgentAtSec).toBeNull();

    const ctx = drive([{ kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } }]);
    expect(feedHealth(ctx).lastAgentAt).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('formats an age a person can read', () => {
    expect(formatAge(0)).toBe('just now');
    expect(formatAge(59)).toBe('59s ago');
    expect(formatAge(60)).toBe('1m 00s ago');
    expect(formatAge(260)).toBe('4m 20s ago');
  });
});

describe('replay', () => {
  it('reproduces a full run from its command log alone', () => {
    const live = drive([
      { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      { kind: 'submit_decision', input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' } },
      { kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      { kind: 'inspect_artifact', input: { artifactId: 'art_cookie_001' } },
      { kind: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset' } },
      { kind: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
      { kind: 'take_response_action', input: { actionId: 'revoke_sessions' } },
      { kind: 'take_response_action', input: { actionId: 'reset_credentials' } },
    ]);

    const replayed = replay(live.commandLog);
    expect(replaySignature(replayed)).toEqual(replaySignature(live));
  });

  it('reproduces a wrong-branch run, consequences included', () => {
    const live = drive([
      { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_disable_account_now' } },
      { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      { kind: 'submit_decision', input: { decisionId: 'D2', optionId: 'D2_trust_sender_display_name' } },
      { kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      { kind: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_password_only' } },
      { kind: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_delete_email_and_close_alert' } },
    ]);

    const replayed = replay(live.commandLog);
    expect(replayed.destroyedArtifacts).toEqual(['art_email_001']);
    expect(replaySignature(replayed)).toEqual(replaySignature(live));
  });

  it('does not record pure reads, so replay stays the minimal seed', () => {
    const ctx = drive([
      { kind: 'get_incident', input: {} },
      { kind: 'get_incident', input: {} },
      { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
    ]);

    expect(ctx.commandLog).toHaveLength(1);
    expect(ctx.commandLog[0]?.kind).toBe('inspect_artifact');
  });

  it('stamps each command with the clock it was issued on', () => {
    const ctx = drive([
      { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      { kind: 'inspect_artifact', input: { artifactId: 'art_url_001' } },
    ]);

    const [first, second] = ctx.commandLog;
    expect(first!.atSec).toBe(ctx.caseOpenedAtSec);
    expect(second!.atSec).toBeGreaterThan(first!.atSec);
  });
});

describe('pause', () => {
  it('is a context flag only — it can never move the state version', () => {
    const ctx = createInitialContext();
    const paused: GameContext = { ...ctx, paused: true };
    expect(paused.stateVersion).toBe(ctx.stateVersion);
  });
});

/* ------------------------------------------------------------------ *
 * The two clocks (audit contract P0.6)
 * ------------------------------------------------------------------ */

describe('play time and incident time', () => {
  /**
   * `COMMAND_INCIDENT_COST` is a copy of a table the engine keeps private. If
   * the engine ever charges something different, the clocks would quietly
   * start lying about how long the player has been at the desk — so measure
   * the engine instead of trusting the copy.
   */
  it('mirrors the clock cost the engine actually charges, per command kind', () => {
    const cases: { kind: string; input: Record<string, unknown> }[] = [
      { kind: 'get_incident', input: {} },
      { kind: 'request_hint', input: { topic: 'evidence' } },
      { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      { kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { kind: 'take_response_action', input: { actionId: 'revoke_sessions' } },
    ];

    for (const step of cases) {
      const before = createInitialContext();
      const after = drive([step], before);
      expect(after.lastResult?.ok, `${step.kind} was rejected`).toBe(true);
      expect(after.clockSec - before.clockSec, step.kind).toBe(
        COMMAND_INCIDENT_COST[step.kind as keyof typeof COMMAND_INCIDENT_COST],
      );
    }
  });

  it('charges operation cost to the incident clock and never to play time', () => {
    const before = createInitialContext();
    const after = drive([{ kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } }], before);

    // A 45-second diagnostic is 45 seconds of the incident, and zero seconds
    // of the player's life. That distinction is the whole point of the split.
    expect(incidentSeconds(after) - incidentSeconds(before)).toBe(45);
    expect(operationCostSeconds(after)).toBe(45);
    expect(playSeconds(after)).toBe(playSeconds(before));
    expect(playSeconds(after)).toBe(0);
  });

  it('advances the incident clock at exactly 3x the play clock while investigating', () => {
    const start = createInitialContext();
    // Ninety real seconds of looking at the dashboard: the tick contributes
    // `INCIDENT_SECONDS_PER_PLAY_SECOND` per real second and nothing else.
    const later = tick(start, 90 * INCIDENT_SECONDS_PER_PLAY_SECOND);

    const playDelta = playSeconds(later) - playSeconds(start);
    const incidentDelta = incidentSeconds(later) - incidentSeconds(start);

    expect(playDelta).toBe(90);
    expect(incidentDelta / playDelta).toBe(INCIDENT_SECONDS_PER_PLAY_SECOND);
    expect(INCIDENT_SECONDS_PER_PLAY_SECOND).toBe(3);
  });

  it('keeps the ratio exact across a run that mixes ticking and operations', () => {
    const opened = tick(createInitialContext(), 60 * INCIDENT_SECONDS_PER_PLAY_SECOND);
    const worked = drive(
      [
        { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
        { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      ],
      opened,
    );
    const idled = tick(worked, 30 * INCIDENT_SECONDS_PER_PLAY_SECOND);

    // Play time counts only the ticks: 60 + 30.
    expect(playSeconds(idled)).toBe(90);
    // The incident clock carries the same 90 real seconds at 3x, plus the two
    // operations the player actually issued.
    expect(operationCostSeconds(idled)).toBe(15 + 20);
    expect(incidentSeconds(idled)).toBe(90 * INCIDENT_SECONDS_PER_PLAY_SECOND + 35);

    // And the ratio over the idle stretch alone is still exactly 3.
    expect(
      (incidentSeconds(idled) - incidentSeconds(worked)) /
        (playSeconds(idled) - playSeconds(worked)),
    ).toBe(INCIDENT_SECONDS_PER_PLAY_SECOND);
  });

  it('reports both clocks and the operation cost together', () => {
    const ctx = drive(
      [{ kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } }],
      tick(createInitialContext(), 30 * INCIDENT_SECONDS_PER_PLAY_SECOND),
    );
    const readout = clocks(ctx);

    expect(readout.playSec).toBe(30);
    expect(readout.operationCostSec).toBe(20);
    expect(readout.incidentSec).toBe(readout.playSec * readout.multiplier + readout.operationCostSec);
  });
});

/* ------------------------------------------------------------------ *
 * The guided path (audit contract P0.6)
 * ------------------------------------------------------------------ */

/**
 * One command, with an idempotency key unique to this call.
 *
 * `drive()` keys by position in its own array, which is exactly right for a
 * scripted sequence and exactly wrong for a loop that issues one command at a
 * time: every call would reuse `live-0` and be replayed instead of applied.
 */
let guidedKey = 0;
function apply(
  ctx: GameContext,
  kind: string,
  input: Record<string, unknown>,
): GameContext {
  guidedKey += 1;
  return executeCommand(ctx, {
    kind,
    input: { ...input, stateVersion: ctx.stateVersion, idempotencyKey: `guided-${guidedKey}` },
    origin: 'human',
  } as unknown as GameCommand).context;
}

/** The input shape each guided command kind expects. */
function guidedInput(command: {
  kind: string;
  artifactId?: string;
  diagnosticId?: string;
  actionId?: string;
}): Record<string, unknown> {
  if (command.kind === 'inspect_artifact') return { artifactId: command.artifactId };
  if (command.kind === 'run_diagnostic') return { diagnosticId: command.diagnosticId };
  return { actionId: command.actionId };
}

/** Follows `nextRequiredStep` and nothing else, counting the interactions. */
function driveGuidedPath(): { ctx: GameContext; interactions: number; steps: string[] } {
  let ctx = createInitialContext();
  const steps: string[] = [];
  let interactions = 0;

  for (let guard = 0; guard < 40; guard += 1) {
    const step = nextRequiredStep(ctx);
    if (!step) break;

    interactions += 1;
    steps.push(step.id);

    if (step.decision) {
      const decision = DECISION_BY_ID.get(step.decision.decisionId);
      const correct = decision?.options.find((option) => option.correct);
      expect(correct, `no correct option for ${step.decision.decisionId}`).toBeDefined();
      ctx = apply(ctx, 'submit_decision', {
        decisionId: step.decision.decisionId,
        optionId: correct!.id,
      });
      expect(ctx.lastResult?.ok, `${step.decision.decisionId} was rejected`).toBe(true);
      continue;
    }

    // One interaction, several commands — but each one is still an ordinary
    // engine command, issued in plan order.
    for (const command of step.pending) {
      ctx = apply(ctx, command.kind, guidedInput(command));
      expect(ctx.lastResult?.ok, `${command.kind} was rejected inside ${step.id}`).toBe(true);
    }
  }

  return { ctx, interactions, steps };
}

describe('guided path', () => {
  it('reaches the contained ending with a perfect score', () => {
    const { ctx } = driveGuidedPath();

    expect(ctx.caseClosed).toBe(true);
    expect(ctx.ending).toBe('contained');
    expect(computeScore(ctx.scoreEntries).total).toBe(100);
    expect(unresolvedCriticalFindings(ctx)).toEqual([]);
  });

  it('costs between 10 and 14 interactions, the contract band', () => {
    const { interactions, steps } = driveGuidedPath();

    expect(interactions).toBeGreaterThanOrEqual(10);
    expect(interactions).toBeLessThanOrEqual(14);
    // Eleven today: six decisions plus five grouped operations.
    expect(interactions).toBe(11);
    expect(new Set(steps).size).toBe(steps.length); // no step is ever revisited
  });

  it('offers exactly one required step at every stage until the case closes', () => {
    let ctx = createInitialContext();
    for (let guard = 0; guard < 40; guard += 1) {
      const step = nextRequiredStep(ctx);
      if (!step) break;

      // A step always names something: either a decision to answer or at
      // least one outstanding command.
      expect(step.title.length).toBeGreaterThan(0);
      expect(Boolean(step.decision) || step.pending.length > 0).toBe(true);
      expect(step.index).toBeGreaterThanOrEqual(1);
      expect(step.index).toBeLessThanOrEqual(step.total);

      if (step.decision) {
        const decision = DECISION_BY_ID.get(step.decision.decisionId)!;
        ctx = apply(ctx, 'submit_decision', {
          decisionId: decision.id,
          optionId: decision.options.find((o) => o.correct)!.id,
        });
      } else {
        for (const command of step.pending) {
          ctx = apply(ctx, command.kind, guidedInput(command));
        }
      }
    }
    expect(ctx.caseClosed).toBe(true);
    expect(nextRequiredStep(ctx)).toBeNull();
  });

  it('never issues a rejected command, so efficiency stays whole', () => {
    const { ctx } = driveGuidedPath();
    expect(ctx.toolLog.filter((entry) => !entry.ok)).toEqual([]);
    expect(computeScore(ctx.scoreEntries).buckets.efficiency.earned).toBe(15);
  });

  it('is satisfied by work done elsewhere rather than tracking its own cursor', () => {
    // A player who ran the sweep early from the Playbook route must not be
    // asked to run it again when the guide reaches that step.
    const early = drive([{ kind: 'run_diagnostic', input: { diagnosticId: 'indicator_scope' } }]);
    const step = nextRequiredStep(early);
    expect(step?.id).toBe('d1'); // the guide is still where the case is
    expect(early.ranDiagnostics).toContain('indicator_scope');
  });

  it('keeps optional evidence out of the required path', () => {
    const ctx = createInitialContext();
    const optional = explorations(ctx).map((item) => item.id);

    // Available from the first frame, and never needed to contain the case.
    expect(optional).toContain('art_fileops_001');
    expect(optional).toContain('art_dlp_001');
    // The three scored artifacts the guide collects itself are never listed
    // as optional — they would compete with the required step.
    expect(optional).not.toContain('art_email_001');
    expect(optional).not.toContain('art_cookie_001');
    expect(optional).not.toContain('art_edr_001');
    expect(explorations(ctx).some((item) => item.kind === 'run_diagnostic')).toBe(false);
  });

  it('explains every completed step: result, what changed and why it mattered', () => {
    let ctx = createInitialContext();
    expect(lastCompletedStep(ctx)).toBeNull();

    ctx = drive([
      { kind: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
    ]);
    const afterDecision = lastCompletedStep(ctx);
    expect(afterDecision?.stepId).toBe('d1');
    expect(afterDecision?.result.length).toBeGreaterThan(0);
    expect(afterDecision?.why.length).toBeGreaterThan(0);
    expect(afterDecision?.changed.some((line) => line.includes('+6'))).toBe(true);
    expect(afterDecision?.changed.some((line) => line.includes('v1'))).toBe(true);

    ctx = drive([{ kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } }], ctx);
    const afterRead = lastCompletedStep(ctx);
    expect(afterRead?.stepId).toBe('read_report');
    expect(afterRead?.result.length).toBeGreaterThan(0);

    ctx = apply(ctx, 'submit_decision', {
      decisionId: 'D2',
      optionId: 'D2_compare_signin_telemetry',
    });
    ctx = apply(ctx, 'run_diagnostic', { diagnosticId: 'auth_timeline' });
    ctx = apply(ctx, 'inspect_artifact', { artifactId: 'art_cookie_001' });
    const afterTimeline = lastCompletedStep(ctx);
    expect(afterTimeline?.stepId).toBe('rebuild_timeline');
    // The grouped operation reports the points the whole group earned.
    expect(afterTimeline?.changed.some((line) => line.includes('+7'))).toBe(true);
  });
});
