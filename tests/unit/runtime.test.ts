import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';

import { gameMachine } from '../../src/game/machine';
import { GameRuntime } from '../../src/game/runtime';

function boot(): GameRuntime {
  const actor = createActor(gameMachine, { input: {} });
  actor.start();
  return new GameRuntime(actor);
}

describe('scene machine', () => {
  it('starts on a black boot screen so audio never autoplays', () => {
    const runtime = boot();
    expect(runtime.scene).toBe('boot');
  });

  it('walks boot -> intro -> office -> transition -> dashboard', () => {
    const runtime = boot();
    runtime.send({ type: 'ENTER' });
    expect(runtime.scene).toBe('intro');

    runtime.send({ type: 'INTRO_ADVANCE' });
    expect(runtime.scene).toBe('office');

    runtime.send({ type: 'DEBUG' });
    expect(runtime.scene).toBe('transition');

    runtime.send({ type: 'TRANSITION_DONE' });
    expect(runtime.scene).toBe('dashboard');
  });

  it('lets the intro be skipped from any point', () => {
    const a = boot();
    a.send({ type: 'SKIP_INTRO' });
    expect(a.scene).toBe('office');

    const b = boot();
    b.send({ type: 'ENTER' });
    b.send({ type: 'SKIP_INTRO' });
    expect(b.scene).toBe('office');
  });

  it('preserves case state across the office-to-dashboard transition', () => {
    const runtime = boot();
    runtime.send({ type: 'SKIP_INTRO' });

    runtime.submitDecision('D1', 'D1_preserve_and_inspect');
    runtime.inspectArtifact('art_email_001');
    const versionInOffice = runtime.stateVersion;
    const inspectedInOffice = [...runtime.context.inspectedArtifacts];

    runtime.send({ type: 'DEBUG' });
    runtime.send({ type: 'TRANSITION_DONE' });

    expect(runtime.scene).toBe('dashboard');
    expect(runtime.stateVersion).toBe(versionInOffice);
    expect(runtime.context.inspectedArtifacts).toEqual(inspectedInOffice);
    expect(runtime.context.decisions.D1?.optionId).toBe('D1_preserve_and_inspect');
  });

  it('returns from the dashboard to the resume beat, not the opening report', () => {
    const runtime = boot();
    runtime.send({ type: 'SKIP_INTRO' });
    runtime.send({ type: 'DEBUG' });
    runtime.send({ type: 'TRANSITION_DONE' });

    runtime.send({ type: 'RETURN_TO_OFFICE' });

    expect(runtime.actor.getSnapshot().matches({ office: 'resume' })).toBe(true);
  });

  it('accepts tool calls in every scene, including before the dashboard exists', () => {
    const runtime = boot();
    expect(runtime.scene).toBe('boot');

    const result = runtime.getIncident('agent');
    expect(result.ok).toBe(true);
  });
});

/**
 * The office beat that the redesign singles out.
 *
 * §2 and §10 of `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` forbid essential
 * dialogue that disappears before the player has acted on it, and this is the
 * only beat in the product where that was still happening: `assistantReporting`
 * carried a six-second `after` that walked past VERA's report whether or not
 * anybody had read it. These tests hold the line from the machine's side, where
 * it cannot be re-introduced by a component's `setTimeout`.
 */
describe('the assistant report', () => {
  beforeEach(() => {
    // Installed before `boot()` because XState schedules an `after` delay when
    // the state carrying it is entered, and the entrances under test happen
    // inside the test body.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * The harness check, and a guard in its own right.
   *
   * If the fake clock did not actually drive XState's scheduler, every "it did
   * not advance" assertion below would pass for the wrong reason and prove
   * nothing. So this asserts a delayed transition that is *supposed* to fire —
   * the 4500 ms entrance safety net, which exists so a lost WebGL context or a
   * hidden tab cannot deadlock the story before anyone has spoken.
   */
  it('still advances on the entrance safety net, which is what proves the clock runs', () => {
    const runtime = boot();
    runtime.send({ type: 'SKIP_INTRO' });
    runtime.send({ type: 'ACKNOWLEDGE_ALARM' });
    expect(runtime.actor.getSnapshot().matches({ office: 'acknowledged' })).toBe(true);

    vi.advanceTimersByTime(4500);

    expect(runtime.actor.getSnapshot().matches({ office: 'assistantReporting' })).toBe(true);
  });

  it('stays on screen for as long as the player leaves it there', () => {
    const runtime = boot();
    runtime.send({ type: 'SKIP_INTRO' });
    runtime.send({ type: 'ACKNOWLEDGE_ALARM' });
    runtime.send({ type: 'COLLEAGUE_ARRIVED' });
    expect(runtime.actor.getSnapshot().matches({ office: 'assistantReporting' })).toBe(true);

    // A minute is ten times the timer that used to live here; nothing else in
    // the office schedules anything at this beat.
    vi.advanceTimersByTime(60_000);

    expect(runtime.actor.getSnapshot().matches({ office: 'assistantReporting' })).toBe(true);
  });

  it('advances when the player asks for the explanation', () => {
    const runtime = boot();
    runtime.send({ type: 'SKIP_INTRO' });
    runtime.send({ type: 'ACKNOWLEDGE_ALARM' });
    runtime.send({ type: 'COLLEAGUE_ARRIVED' });
    vi.advanceTimersByTime(60_000);

    runtime.send({ type: 'EXPLAIN' });

    expect(runtime.actor.getSnapshot().matches({ office: 'explained' })).toBe(true);
  });

  it('advances when the player opens the response console', () => {
    const runtime = boot();
    runtime.send({ type: 'SKIP_INTRO' });
    runtime.send({ type: 'ACKNOWLEDGE_ALARM' });
    runtime.send({ type: 'COLLEAGUE_ARRIVED' });
    vi.advanceTimersByTime(60_000);

    runtime.send({ type: 'DEBUG' });

    expect(runtime.scene).toBe('transition');
  });
});

describe('live clock', () => {
  it('advances the incident clock without invalidating an agent version', () => {
    const runtime = boot();
    const version = runtime.stateVersion;

    runtime.send({ type: 'TICK', seconds: 1 });
    runtime.send({ type: 'TICK', seconds: 1 });

    expect(runtime.stateVersion).toBe(version);
    // A call prepared before the ticks still succeeds.
    expect(runtime.execute('request_hint', { topic: 'evidence', stateVersion: version }, 'agent').ok).toBe(
      true,
    );
  });
});

describe('runtime convenience wrappers', () => {
  it('fills in the current stateVersion for human UI calls', () => {
    const runtime = boot();
    runtime.submitDecision('D1', 'D1_preserve_and_inspect');
    expect(runtime.stateVersion).toBe(1);

    // No stale error even though the caller never mentioned a version.
    const result = runtime.inspectArtifact('art_email_001');
    expect(result.ok).toBe(true);
  });

  it('makes a double-clicked control idempotent', () => {
    const runtime = boot();
    runtime.runDiagnostic('session_inventory');

    const first = runtime.takeResponseAction('revoke_sessions');
    const second = runtime.takeResponseAction('revoke_sessions');

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second).toEqual(first);
    expect(runtime.context.performedActions).toHaveLength(1);
  });

  it('tags human calls and agent calls differently in the log', () => {
    const runtime = boot();
    runtime.getIncident('human');
    runtime.getIncident('agent');

    const origins = runtime.context.toolLog.map((e) => e.origin);
    expect(origins).toEqual(['human', 'agent']);
  });
});

describe('restart', () => {
  it('resets the case to its opening state but keeps the operator name', () => {
    const runtime = boot();
    runtime.send({ type: 'SET_OPERATOR_NAME', name: 'Efe' });
    runtime.send({ type: 'SKIP_INTRO' });
    runtime.submitDecision('D1', 'D1_disable_account_now');
    expect(runtime.stateVersion).toBe(1);

    runtime.send({ type: 'RESTART' });

    expect(runtime.scene).toBe('boot');
    expect(runtime.stateVersion).toBe(0);
    expect(runtime.context.decisions.D1).toBeUndefined();
    expect(runtime.context.operatorName).toBe('Efe');
  });
});

/**
 * Closing the case is a beat, not a cut.
 *
 * The dashboard used to carry `always: { target: 'debrief', guard: 'caseClosed'
 * }`, which took the console away in the same frame the case closed — so the
 * player never saw the result of the last thing they did, and the sources they
 * had spent the case verifying left the screen at the moment they were finally
 * complete. The transition is gone; the guarded `OPEN_DEBRIEF` that the nav row
 * and the close beat both send is what moves the scene now, and only a person
 * can send it.
 *
 * Two claims, because either one alone can pass while the beat is broken: that
 * the console survives the close, and that the debrief is still one press away.
 */
describe('closing the case', () => {
  /** A complete run, closed. The options are the fast ones, not the good ones —
   *  what is under test is where the console ends up, not what it scores. */
  function closedRun(): GameRuntime {
    const runtime = boot();
    runtime.send({ type: 'SKIP_INTRO' });
    runtime.send({ type: 'DEBUG' });
    runtime.send({ type: 'TRANSITION_DONE' });
    expect(runtime.scene).toBe('dashboard');

    runtime.submitDecision('D1', 'D1_preserve_and_inspect');
    runtime.inspectArtifact('art_email_001');
    runtime.submitDecision('D2', 'D2_compare_signin_telemetry');
    runtime.runDiagnostic('auth_timeline');
    runtime.submitDecision('D3', 'D3_revoke_then_reset');
    runtime.submitDecision('D4', 'D4_collect_then_isolate');
    runtime.submitDecision('D5', 'D5_assume_single_account');
    runtime.submitDecision('D6', 'D6_close_without_verifying');
    runtime.takeResponseAction('close_case');

    expect(runtime.context.caseClosed).toBe(true);
    return runtime;
  }

  it('leaves the console on the dashboard', () => {
    const runtime = closedRun();

    // The whole point: the closing receipt, the outcome under it and the
    // verified sources are all still on the surface the player is looking at.
    expect(runtime.scene).toBe('dashboard');
  });

  it('opens the debrief when the player asks for it', () => {
    const runtime = closedRun();

    runtime.send({ type: 'OPEN_DEBRIEF' });

    expect(runtime.scene).toBe('debrief');
  });
});
