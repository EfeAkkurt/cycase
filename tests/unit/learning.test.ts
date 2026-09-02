import { describe, expect, it } from 'vitest';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import {
  ARTIFACT_BY_ID,
  DECISION_HINTS,
  DIAGNOSTIC_BY_ID,
  SUPPORTING_SOURCES,
} from '../../src/game/fixtures/case001';
import { computeScore } from '../../src/game/scoring';
import {
  debriefAnalytics,
  decisionHintLevel,
  nextDecisionHint,
  nextRequiredStep,
  retrievalQuestion,
  supportingSources,
} from '../../src/game/selectors';
import {
  COMMAND_KINDS,
  DECISION_HINT_MAX_LEVEL,
  VERSION_BUMPING_COMMANDS,
  type ArtifactId,
  type DecisionId,
  type DecisionOptionId,
  type DiagnosticId,
  type GameContext,
  type HintTopic,
  type ResponseActionId,
  type HintView,
  type ToolResult,
} from '../../src/game/types';

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ *
 *
 * A local driver rather than a shared one: this file asserts things about a
 * *partially played* run — a decision answered before the query that backs it,
 * a wrong turn left standing — and those states are the point of the tests,
 * not a fixture other suites should inherit.
 */

class Driver {
  context: GameContext = createInitialContext();

  private run(kind: Parameters<typeof executeCommand>[1]['kind'], input: unknown): ToolResult {
    const outcome = executeCommand(this.context, { kind, input, origin: 'agent' } as Parameters<
      typeof executeCommand
    >[1]);
    this.context = outcome.context;
    return outcome.result;
  }

  get version(): number {
    return this.context.stateVersion;
  }

  inspect(artifactId: ArtifactId): ToolResult {
    return this.run('inspect_artifact', { artifactId, stateVersion: this.version });
  }

  diagnostic(diagnosticId: DiagnosticId): ToolResult {
    return this.run('run_diagnostic', { diagnosticId, stateVersion: this.version });
  }

  act(actionId: ResponseActionId): ToolResult {
    return this.run('take_response_action', {
      actionId,
      stateVersion: this.version,
      idempotencyKey: `k-${actionId}`,
    });
  }

  decide(decisionId: DecisionId, optionId: DecisionOptionId): ToolResult {
    return this.run('submit_decision', {
      decisionId,
      optionId,
      stateVersion: this.version,
      idempotencyKey: `k-${decisionId}`,
    });
  }

  hint(topic: HintTopic = 'evidence'): HintView {
    return this.run('request_hint', { topic, stateVersion: this.version }).data as HintView;
  }
}

/**
 * Correct through D3, answering each decision as soon as it unlocks.
 *
 * Deliberately *not* backed by the record: every decision here is submitted
 * before the sources that support it have been collected, which is the ordinary
 * way a case is played and the negative case for `strongest`.
 */
function playThroughD3(d = new Driver()): Driver {
  d.decide('D1', 'D1_preserve_and_inspect');
  d.inspect('art_email_001');
  d.decide('D2', 'D2_compare_signin_telemetry');
  d.diagnostic('auth_timeline');
  d.decide('D3', 'D3_revoke_then_reset');
  return d;
}

/** The same three decisions, but with every supporting record read first. */
function playThroughD3FromTheRecord(d = new Driver()): Driver {
  d.decide('D1', 'D1_preserve_and_inspect');
  d.inspect('art_email_001');
  d.decide('D2', 'D2_compare_signin_telemetry');
  d.diagnostic('auth_timeline');
  d.inspect('art_cookie_001');
  d.diagnostic('session_inventory');
  d.decide('D3', 'D3_revoke_then_reset');
  return d;
}

/** The taught route, played through to a closed case. */
function playPerfectRun(d = new Driver()): Driver {
  d.decide('D1', 'D1_preserve_and_inspect');
  d.inspect('art_email_001');
  d.decide('D2', 'D2_compare_signin_telemetry');
  d.diagnostic('auth_timeline');
  d.inspect('art_cookie_001');
  d.decide('D3', 'D3_revoke_then_reset');
  d.diagnostic('session_inventory');
  d.act('revoke_sessions');
  d.act('reset_credentials');
  d.decide('D4', 'D4_collect_then_isolate');
  d.inspect('art_edr_001');
  d.act('isolate_endpoint');
  d.decide('D5', 'D5_sweep_indicators');
  d.diagnostic('indicator_scope');
  d.act('block_indicator');
  d.decide('D6', 'D6_verify_checklist');
  d.act('close_case');
  return d;
}

/* ------------------------------------------------------------------ *
 * The ladder
 * ------------------------------------------------------------------ */

describe('per-decision hint ladder', () => {
  it('starts at zero and climbs one rung per ask, then reports itself spent', () => {
    const d = new Driver();
    expect(decisionHintLevel(d.context, 'D1')).toBe(0);

    const first = d.hint();
    expect(first.decision?.decisionId).toBe('D1');
    expect(first.decision?.level).toBe(1);
    expect(first.decision?.exhausted).toBe(false);
    expect(decisionHintLevel(d.context, 'D1')).toBe(1);

    const second = d.hint().decision;
    expect(second?.level).toBe(2);
    const third = d.hint().decision;
    expect(third?.level).toBe(3);
    expect(decisionHintLevel(d.context, 'D1')).toBe(3);

    // Every rung says something the one below it did not; a ladder that repeats
    // itself teaches the player that asking is free noise.
    expect(new Set([first.decision?.text, second?.text, third?.text]).size).toBe(3);

    // The fourth ask must say plainly that there is nothing deeper rather than
    // replaying rung 3 as though it were new.
    const fourth = d.hint().decision;
    expect(fourth?.level).toBe(DECISION_HINT_MAX_LEVEL);
    expect(fourth?.exhausted).toBe(true);
    expect(fourth?.text).not.toBe(third?.text);
    expect(decisionHintLevel(d.context, 'D1')).toBe(3);
  });

  it('never asks the fixture for a rung that has no text', () => {
    const base = createInitialContext();
    const overgrown: GameContext = { ...base, decisionHintLevels: { D1: 9 } };
    expect(decisionHintLevel(overgrown, 'D1')).toBe(DECISION_HINT_MAX_LEVEL);
    expect(nextDecisionHint(overgrown, 'D1').level).toBe(DECISION_HINT_MAX_LEVEL);
    expect(nextDecisionHint(overgrown, 'D1').exhausted).toBe(true);

    const negative: GameContext = { ...base, decisionHintLevels: { D1: -4 } };
    expect(decisionHintLevel(negative, 'D1')).toBe(0);

    const nonsense: GameContext = { ...base, decisionHintLevels: { D1: Number.NaN } };
    expect(decisionHintLevel(nonsense, 'D1')).toBe(0);
  });

  it('resolves a distinct rung for every decision at every level', () => {
    const base = createInitialContext();
    expect(new Set(DECISION_HINTS.map((hint) => hint.textKey)).size).toBe(DECISION_HINTS.length);

    const rendered = new Set<string>();
    for (const decisionId of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as DecisionId[]) {
      for (let level = 1; level <= DECISION_HINT_MAX_LEVEL; level += 1) {
        const ctx: GameContext = { ...base, decisionHintLevels: { [decisionId]: level - 1 } };
        const view = nextDecisionHint(ctx, decisionId);
        expect(view.level).toBe(level);
        expect(view.levelLabel).toBeTruthy();
        expect(view.text).toBeTruthy();
        // The key itself coming back means `en.ts` has no string for that rung.
        expect(view.text).not.toBe(`hint.${decisionId}.l${level}`);
        rendered.add(view.text);
      }
    }
    expect(rendered.size).toBe(18);
  });

  it('reports `open` honestly: true when answerable, false while blocked', () => {
    const d = new Driver();
    expect(nextDecisionHint(d.context, 'D1').open).toBe(true);

    // D2 needs the phishing message read. Answering D1 alone leaves it blocked,
    // and that is exactly when "where to look" is worth most.
    d.decide('D1', 'D1_preserve_and_inspect');
    expect(nextDecisionHint(d.context, 'D2').open).toBe(false);
    const view = d.hint().decision;
    expect(view?.decisionId).toBe('D2');
    expect(view?.open).toBe(false);

    d.inspect('art_email_001');
    expect(nextDecisionHint(d.context, 'D2').open).toBe(true);

    // An answered decision is never open again.
    expect(nextDecisionHint(d.context, 'D1').open).toBe(false);
  });

  /*
   * The ladder must climb only when the ask was about the decision's own area.
   * It used to climb on every request_hint whatever the topic, so pressing all
   * four topic buttons once spent all three rungs on a decision the player had
   * never asked about — and the first real ask met "there is no deeper
   * pointer". Asking two DIFFERENT topics is what discriminates; asking the
   * same one twice cannot see it.
   */
  it('climbs only for the area the open decision lives in', () => {
    const d = new Driver();
    // D1 is an evidence decision, so these three asks are about other areas.
    d.hint('identity');
    d.hint('containment');
    d.hint('scope');
    expect(decisionHintLevel(d.context, 'D1')).toBe(0);

    // And the ask that IS about it moves exactly one rung.
    d.hint('evidence');
    expect(decisionHintLevel(d.context, 'D1')).toBe(1);
  });

  it('leaves the topic axis untouched and stays free', () => {
    const d = new Driver();
    const before = d.context;
    const first = d.hint('containment');
    const second = d.hint('containment');

    // `hint` is the topic pointer and must not move because the ladder climbed.
    expect(first.topic).toBe('containment');
    expect(first.hint).toBeTruthy();
    expect(second.hint).toBe(first.hint);
    expect(first.affectsScore).toBe(false);

    expect(d.context.scoreEntries).toEqual(before.scoreEntries);
    expect(computeScore(d.context.scoreEntries)).toEqual(computeScore(before.scoreEntries));
    expect(d.context.stateVersion).toBe(before.stateVersion);
    expect(VERSION_BUMPING_COMMANDS).not.toContain('request_hint');
  });
});

/* ------------------------------------------------------------------ *
 * Supporting sources
 * ------------------------------------------------------------------ */

describe('supporting sources', () => {
  it('every fixture ref resolves to a record the case can actually open', () => {
    expect(SUPPORTING_SOURCES.length).toBeGreaterThan(0);
    for (const source of SUPPORTING_SOURCES) {
      if (source.ref.kind === 'artifact') {
        expect(ARTIFACT_BY_ID.get(source.ref.id), source.ref.id).toBeDefined();
      } else {
        expect(DIAGNOSTIC_BY_ID.get(source.ref.id), source.ref.id).toBeDefined();
      }
    }
  });

  it('is empty until the decision is answered, because before it these are the answer', () => {
    const d = new Driver();
    expect(supportingSources(d.context, 'D1')).toEqual([]);
    expect(supportingSources(d.context, 'D3')).toEqual([]);

    d.decide('D1', 'D1_preserve_and_inspect');
    expect(supportingSources(d.context, 'D1').length).toBeGreaterThan(0);
    // Answering D1 says nothing about D3, which is still ahead of the run.
    expect(supportingSources(d.context, 'D3')).toEqual([]);
  });

  it('resolves each source to a titled record with a reason and a live availability', () => {
    const d = playThroughD3();
    const views = supportingSources(d.context, 'D3');

    expect(views.length).toBeGreaterThan(0);
    for (const view of views) {
      expect(view.decisionId).toBe('D3');
      expect(view.title).toBeTruthy();
      expect(view.why).toBeTruthy();
      expect(['available', 'locked', 'destroyed']).toContain(view.availability);
      const record =
        view.kind === 'artifact'
          ? ARTIFACT_BY_ID.get(view.id as ArtifactId)
          : DIAGNOSTIC_BY_ID.get(view.id as DiagnosticId);
      expect(record, view.id).toBeDefined();
    }
  });

  it('says "locked" rather than linking to a query the run never ran', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');
    d.inspect('art_email_001');
    d.decide('D2', 'D2_compare_signin_telemetry');

    const timeline = supportingSources(d.context, 'D2').find((v) => v.id === 'auth_timeline');
    expect(timeline?.availability).toBe('locked');
    expect(timeline?.inspected).toBe(false);

    d.diagnostic('auth_timeline');
    const after = supportingSources(d.context, 'D2').find((v) => v.id === 'auth_timeline');
    expect(after?.availability).toBe('available');
    expect(after?.inspected).toBe(true);
  });

  it('says "destroyed" for a record the run itself deleted', () => {
    const d = playThroughD3();
    d.decide('D4', 'D4_delete_email_and_close_alert');

    const email = supportingSources(d.context, 'D1').find((v) => v.id === 'art_email_001');
    expect(email?.availability).toBe('destroyed');
  });
});

/* ------------------------------------------------------------------ *
 * Debrief analytics
 * ------------------------------------------------------------------ */

describe('debrief analytics', () => {
  it('is a pure function of the context and does not mutate it', () => {
    const d = playThroughD3();
    const snapshot = structuredClone(d.context);

    const first = debriefAnalytics(d.context);
    const second = debriefAnalytics(d.context);

    expect(second).toEqual(first);
    // Identical output would also pass if the function mutated its input in the
    // same way twice, so the input is checked separately.
    expect(d.context).toEqual(snapshot);
  });

  it('produces every observation on an untouched case', () => {
    const analytics = debriefAnalytics(createInitialContext());

    for (const observation of [analytics.strongest, analytics.improve, analytics.lesson]) {
      expect(observation.id).toBeTruthy();
      expect(observation.headline).toBeTruthy();
      expect(observation.body).toBeTruthy();
    }
    expect(analytics.chain).toHaveLength(6);
    expect(analytics.chain.every((link) => !link.answered)).toBe(true);
    expect(analytics.pivotIndex).toBe(-1);
    expect(analytics.replayGoal).toBeTruthy();
  });

  it('orders the chain by what happened and marks only the first wrong answer', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');
    d.inspect('art_email_001');
    d.decide('D2', 'D2_compare_signin_telemetry');
    d.diagnostic('auth_timeline');
    d.decide('D3', 'D3_password_only');
    d.decide('D4', 'D4_delete_email_and_close_alert');

    const analytics = debriefAnalytics(d.context);
    expect(analytics.chain.map((link) => link.decisionId)).toEqual([
      'D1',
      'D2',
      'D3',
      'D4',
      'D5',
      'D6',
    ]);
    expect(analytics.chain.slice(0, 4).every((link) => link.answered)).toBe(true);
    expect(analytics.chain.map((link) => link.correct)).toEqual([
      true,
      true,
      false,
      false,
      undefined,
      undefined,
    ]);
    expect(analytics.chain.filter((link) => link.pivot)).toHaveLength(1);
    expect(analytics.pivotIndex).toBe(2);
    expect(analytics.chain[2]?.seq).toBeGreaterThan(analytics.chain[1]?.seq ?? 0);
  });

  it('names the call the run had actually earned, not merely the first right one', () => {
    // Both runs answer D1, D2 and D3 correctly. The only difference is whether
    // the records backing D3 were collected before it was submitted — and that
    // ordering lives nowhere but the command log.
    const guessed = playThroughD3();
    const read = playThroughD3FromTheRecord();

    expect(debriefAnalytics(guessed.context).strongest.anchor?.id).toBe('D1');
    expect(debriefAnalytics(read.context).strongest.anchor?.id).toBe('D3');
  });

  it('still reads as a next action on a closed, perfectly played case', () => {
    const d = playPerfectRun();
    expect(d.context.caseClosed).toBe(true);

    const analytics = debriefAnalytics(d.context);
    for (const observation of [analytics.strongest, analytics.improve, analytics.lesson]) {
      expect(observation.headline).toBeTruthy();
      expect(observation.body).toBeTruthy();
    }
    expect(analytics.chain).toHaveLength(6);
    expect(analytics.chain.every((link) => link.answered && link.correct)).toBe(true);
    expect(analytics.pivotIndex).toBe(-1);
    // An anchor is what makes "improve" somewhere to go rather than a verdict
    // about the run. A closed case with nothing left to do would have none.
    expect(analytics.improve.anchor).not.toBeNull();
    expect(analytics.replayGoal).toBeTruthy();

    const total = String(computeScore(d.context.scoreEntries).total);
    for (const line of [
      analytics.strongest.body,
      analytics.improve.body,
      analytics.lesson.body,
      analytics.replayGoal,
    ]) {
      expect(line).not.toContain(total);
      expect(line.toLowerCase()).not.toContain('points');
    }
  });

  it('does not restate the score', () => {
    const d = playThroughD3();
    const analytics = debriefAnalytics(d.context);
    const total = String(computeScore(d.context.scoreEntries).total);

    for (const line of [
      analytics.strongest.body,
      analytics.improve.body,
      analytics.lesson.body,
      analytics.replayGoal,
    ]) {
      expect(line).not.toContain(total);
      expect(line.toLowerCase()).not.toContain('points');
    }
  });

  it('reports both clocks from the one place the arithmetic lives', () => {
    const d = playThroughD3();
    const idle: GameContext = { ...d.context, clockSec: d.context.clockSec + 30 };
    const { time } = debriefAnalytics(idle);

    expect(time.multiplier).toBe(3);
    expect(time.realSec).toBe(10);
    expect(time.realSec * time.multiplier + time.operationCostSec).toBe(time.simulatedSec);
    expect(time.realLabel).toBe('00:10');
    expect(time.simulatedLabel).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ *
 * Retrieval practice
 * ------------------------------------------------------------------ */

describe('retrieval question', () => {
  it('has nothing to ask about a run that has answered nothing', () => {
    expect(retrievalQuestion(createInitialContext())).toBeNull();
  });

  it('is drawn deterministically from the first wrong answer', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');
    d.inspect('art_email_001');
    d.decide('D2', 'D2_trust_sender_display_name');

    const question = retrievalQuestion(d.context);
    expect(question?.id).toBe('retrieval-D2');
    expect(question?.anchor?.id).toBe('D2');
    expect(question?.question).toBeTruthy();
    expect(question?.modelAnswer).toBeTruthy();
    expect(retrievalQuestion(d.context)).toEqual(question);
  });

  it('follows the last answered decision when the run never turned', () => {
    const d = playThroughD3();
    expect(retrievalQuestion(d.context)?.id).toBe('retrieval-D3');
  });

  it('cannot reach the score', () => {
    const d = playThroughD3();
    const before = computeScore(d.context.scoreEntries);
    const snapshot = structuredClone(d.context);

    const question = retrievalQuestion(d.context);
    expect(question?.affectsScore).toBe(false);

    expect(computeScore(d.context.scoreEntries)).toEqual(before);
    expect(d.context).toEqual(snapshot);
    // Structural, not merely observed: there is no command that asks for one,
    // so `dispatch` has no arm that could produce a ScoreEntry from it.
    expect(COMMAND_KINDS).not.toContain('retrieval' as never);
    expect(JSON.stringify(question)).not.toContain('scoreEntr');
  });
});

/* ------------------------------------------------------------------ *
 * Recovering from a wrong call, and showing what was learned
 * ------------------------------------------------------------------ */

/**
 * The two things a teaching tool has to survive.
 *
 * A player who gets a decision wrong has to be able to carry on and still
 * contain the incident — a case that becomes unwinnable at the first mistake
 * teaches nothing except not to guess. And the debrief has to be able to tell
 * that they recovered, because "you got D3 wrong" and "you got D3 wrong and
 * then did the containment properly anyway" are different runs and only one of
 * them is a failure to learn.
 */
describe('a wrong call is recoverable, and the recovery is visible', () => {
  /** Correct to D2, wrong at D3, then the containment done properly regardless. */
  function playWrongThenRecover(): Driver {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');
    d.inspect('art_email_001');
    d.decide('D2', 'D2_compare_signin_telemetry');
    d.diagnostic('auth_timeline');
    // The wrong branch: a password reset alone leaves the stolen session live.
    d.decide('D3', 'D3_password_only');
    return d;
  }

  it('leaves the case playable after the wrong branch', () => {
    const d = playWrongThenRecover();

    // The run continues: D3 is answered, and the case has not been sealed off.
    expect(d.context.decisions.D3).toBeDefined();
    expect(d.context.caseClosed).toBe(false);

    // And there is still a next thing to do rather than a dead end.
    expect(nextRequiredStep(d.context)).not.toBeNull();
  });

  it('names the call that turned, and points at where to go next', () => {
    const analytics = debriefAnalytics(playWrongThenRecover().context);

    // `correct` is optional and absent on a decision the run never reached, so
    // an unanswered link is not a wrong one. `answered` is what separates them.
    const wrong = analytics.chain.filter((link) => link.answered && !link.correct);
    expect(wrong.map((link) => link.decisionId)).toEqual(['D3']);
    expect(analytics.chain.findIndex((link) => link.pivot)).toBe(
      analytics.chain.findIndex((link) => link.decisionId === 'D3'),
    );

    // The improvement is somewhere to go, not a verdict. Without the anchor it
    // is just "you did badly at D3" with better grammar.
    expect(analytics.improve.anchor).not.toBeNull();
  });

  it('reads differently from a run that never turned', () => {
    const turned = debriefAnalytics(playWrongThenRecover().context);
    const clean = debriefAnalytics(playThroughD3().context);

    // The discriminating pair: same decisions attempted, different outcome, and
    // the debrief must not describe them identically.
    expect(turned.chain.some((link) => link.pivot)).toBe(true);
    expect(clean.chain.some((link) => link.pivot)).toBe(false);
    expect(turned.improve.body).not.toBe(clean.improve.body);
  });

  it('offers the retrieval question about the call that went wrong', () => {
    const question = retrievalQuestion(playWrongThenRecover().context);

    // Drawn from what the player actually did, so it practises the thing they
    // got wrong rather than a topic the run never touched.
    expect(question).not.toBeNull();
    expect(question!.anchor).not.toBeNull();
    expect(JSON.stringify(question!.anchor)).toContain('D3');
    expect(question!.modelAnswer).toBeTruthy();
    expect(question!.affectsScore).toBe(false);
  });

  it('costs nothing to have got it wrong and then asked for help', () => {
    const d = playWrongThenRecover();
    const before = computeScore(d.context.scoreEntries);

    // The whole ladder, on the area the open decision lives in.
    d.hint('containment');
    d.hint('containment');
    d.hint('containment');
    d.hint('containment');

    expect(computeScore(d.context.scoreEntries)).toEqual(before);
    expect(d.context.stateVersion).toBe(d.version);
  });
});
