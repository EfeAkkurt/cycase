import { describe, expect, it } from 'vitest';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import {
  clockWithinRange,
  correlation,
  correlatableRows,
  custodyRecord,
  egressHiddenByRange,
  egressLedger,
  hiddenByRange,
  matchesFocus,
  messageTrace,
  pivotTargets,
  queryNotes,
  rangeBounds,
  searchEvents,
  sessionInventory,
  siemEvents,
  sourceHealth,
  tabRowCount,
  traceHiddenByRange,
} from '../../src/game/investigate';
import {
  CHRONOLOGY_ORIGINS,
  chronology,
  chronologyCounts,
  filterChronology,
} from '../../src/game/live';
import { replaySignature } from '../../src/game/replay';
import { previewEffects, verifyAction } from '../../src/game/sources';
import { RESPONSE_ACTION_IDS } from '../../src/game/types';
import type {
  GameCommand,
  GameContext,
  ResponseActionId,
  ResponseActionView,
} from '../../src/game/types';
import { hashContext } from '../../shared/runSignature';

/**
 * The console-wide behaviour: one time range, one selection, one chronology,
 * and a consequence preview that cannot promise what the engine will not do.
 *
 * The tests that matter here are the negative ones. "Following an identity
 * highlights rows" passes against almost any implementation; "the time range
 * must not filter the session inventory" is the assertion that catches the
 * version of this feature which quietly deletes the case's central lesson from
 * the table that teaches it.
 */

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

interface Step {
  kind: string;
  input: Record<string, unknown>;
}

const MUTATING = new Set(['take_response_action', 'submit_decision']);
let keySeq = 0;

function step(ctx: GameContext, next: Step) {
  const input: Record<string, unknown> = { ...next.input, stateVersion: ctx.stateVersion };
  if (MUTATING.has(next.kind)) {
    keySeq += 1;
    input.idempotencyKey = `con-${keySeq}`;
  }
  return executeCommand(ctx, {
    kind: next.kind,
    input,
    origin: 'agent',
  } as unknown as GameCommand);
}

function drive(steps: Step[], start = createInitialContext()): GameContext {
  let ctx = start;
  for (const next of steps) ctx = step(ctx, next).context;
  return ctx;
}

const action = (actionId: string): Step => ({ kind: 'take_response_action', input: { actionId } });
const diagnostic = (diagnosticId: string): Step => ({
  kind: 'run_diagnostic',
  input: { diagnosticId },
});
const inspect = (artifactId: string): Step => ({ kind: 'inspect_artifact', input: { artifactId } });
const decide = (decisionId: string, optionId: string): Step => ({
  kind: 'submit_decision',
  input: { decisionId, optionId },
});

/** Every step of the perfect run, in order — the same sequence as `sources.test.ts`. */
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

/** Enough of the run to have collected most sources, before any containment. */
const COLLECTED: Step[] = [
  decide('D1', 'D1_preserve_and_inspect'),
  inspect('art_email_001'),
  inspect('art_url_001'),
  decide('D2', 'D2_compare_signin_telemetry'),
  diagnostic('auth_timeline'),
  inspect('art_signin_001'),
  inspect('art_cookie_001'),
  inspect('art_edr_001'),
  inspect('art_dlp_001'),
  inspect('art_fileops_001'),
  diagnostic('session_inventory'),
  diagnostic('indicator_scope'),
];

const withRange = (ctx: GameContext, range: GameContext['timeRange']): GameContext => ({
  ...ctx,
  timeRange: range,
});

/* ------------------------------------------------------------------ *
 * The consequence preview
 * ------------------------------------------------------------------ */

describe('the consequence preview is the operation, run against a copy', () => {
  /**
   * The single assertion this whole feature stands on.
   *
   * A preview that is written by hand is free to promise anything. This one is
   * a diff of the same snapshot the engine diffs, so if it ever disagrees with
   * what the engine actually did, that is a defect and this fails.
   */
  it('predicts exactly the effects the engine goes on to report, for every action', () => {
    let ctx = createInitialContext();

    for (const next of GOLDEN) {
      if (next.kind === 'take_response_action') {
        const actionId = next.input.actionId as ResponseActionId;
        const predicted = previewEffects(ctx, actionId);

        const outcome = step(ctx, next);
        expect(outcome.result.ok, actionId).toBe(true);
        const view = outcome.result.data as ResponseActionView;

        expect(predicted, `preview of ${actionId}`).toEqual(view.effects);
        ctx = outcome.context;
        continue;
      }
      ctx = step(ctx, next).context;
    }
  });

  it('covers close_case too, including the ending it would produce', () => {
    const ctx = drive(GOLDEN);
    const predicted = previewEffects(ctx, 'close_case');

    const outcome = step(ctx, action('close_case'));
    expect(outcome.result.ok).toBe(true);
    expect(predicted).toEqual((outcome.result.data as ResponseActionView).effects);
    // A fully-contained run closes as contained; the preview said so first.
    expect(predicted.some((effect) => effect.after.includes('contained'))).toBe(true);
  });

  /**
   * Decision D3's lesson, checked one step earlier than the engine checks it.
   *
   * The preview is where an operator finds out that a password reset leaves the
   * stolen cookie alive. If this ever starts listing `d.arslan.issued-tokens`,
   * the preview is teaching the mistake the case exists to correct.
   */
  it('never claims a password reset invalidates an already-issued token', () => {
    const ctx = drive([...COLLECTED]);
    const predicted = previewEffects(ctx, 'reset_credentials');

    expect(predicted.map((effect) => effect.key)).toContain('d.arslan.password');
    expect(predicted.map((effect) => effect.key)).not.toContain('d.arslan.issued-tokens');
    expect(predicted.map((effect) => effect.key)).not.toContain('SES-8842');
  });

  it('leaves the case untouched — a preview is a read', () => {
    const before = drive(COLLECTED);
    const signature = JSON.stringify(replaySignature(before));

    for (const actionId of RESPONSE_ACTION_IDS) previewEffects(before, actionId);

    expect(JSON.stringify(replaySignature(before))).toBe(signature);
  });

  it('reports at least one moved fact for every response action', () => {
    let ctx = createInitialContext();
    for (const next of GOLDEN) {
      if (next.kind === 'take_response_action') {
        const actionId = next.input.actionId as ResponseActionId;
        expect(previewEffects(ctx, actionId).length, actionId).toBeGreaterThan(0);
      }
      ctx = step(ctx, next).context;
    }
  });
});

describe('verification reads the live sources, not a receipt', () => {
  it('is pending before the operation and verified after it', () => {
    const before = drive(COLLECTED);
    expect(verifyAction(before, 'revoke_sessions')).toMatchObject({
      state: 'pending',
      confirmed: [],
    });

    const after = drive([action('revoke_sessions')], before);
    const verification = verifyAction(after, 'revoke_sessions');
    expect(verification.state).toBe('verified');
    expect(verification.outstanding).toEqual([]);
    expect(verification.confirmed.map((fact) => fact.key)).toContain('SES-8842');
  });

  it('confirms exactly the facts the preview promised', () => {
    const before = drive(COLLECTED);
    const promised = previewEffects(before, 'isolate_endpoint').map((effect) => effect.key);
    const after = drive([action('isolate_endpoint')], before);

    expect(verifyAction(after, 'isolate_endpoint').confirmed.map((fact) => fact.key)).toEqual(
      promised,
    );
  });

  /**
   * Overlapping ownership, pinned rather than papered over.
   *
   * `conn_collector` is blocked by `block_indicator` and severed by
   * `isolate_endpoint`, and isolation is the stronger cut. Once the host is
   * isolated, the block is no longer what is stopping that connection — so it
   * drops out of the block's confirmed set. That is the honest answer, and it
   * is here as a test so nobody later reads `verified` as "everything this
   * once moved" and widens the mechanism to make it true.
   */
  it('credits a shared fact to the operation that is actually holding it', () => {
    const isolatedFirst = drive([
      ...COLLECTED,
      action('isolate_endpoint'),
      action('block_indicator'),
    ]);

    const block = verifyAction(isolatedFirst, 'block_indicator');
    expect(block.state).toBe('verified');
    expect(block.outstanding).toEqual([]);
    // The mail-gateway and proxy rules are the block's alone, and stay credited.
    expect(block.confirmed.map((fact) => fact.key)).toContain('cy-case-secure-id.net');
    // The host connection count is isolation's now, not the block's.
    expect(block.confirmed.map((fact) => fact.key)).not.toContain('WKS-114.connections');

    const isolate = verifyAction(isolatedFirst, 'isolate_endpoint');
    expect(isolate.confirmed.map((fact) => fact.key)).toContain('WKS-114.connections');
  });
});

/* ------------------------------------------------------------------ *
 * The console-wide time range
 * ------------------------------------------------------------------ */

describe('the time range filters observations and reports itself to inventories', () => {
  it('defaults to the night the incident happened on', () => {
    expect(createInitialContext().timeRange).toBe('night');
  });

  it('narrows the event index and says how much it is holding back', () => {
    const ctx = drive(COLLECTED);
    const whole = searchEvents(withRange(ctx, 'all'), { query: '' });
    const recent = searchEvents(withRange(ctx, 'last30'), { query: '' });

    expect(recent.length).toBeLessThan(whole.length);
    expect(hiddenByRange(withRange(ctx, 'last30'))).toBe(whole.length - recent.length);
    expect(hiddenByRange(withRange(ctx, 'all'))).toBe(0);
  });

  /**
   * The assertion that protects the case from its own feature.
   *
   * SES-8811 was issued at 02:12:40. A 30-minute window would drop it, and with
   * it the row that proves revoking the account's sessions kills the legitimate
   * one too while leaving the service principal alone. Sessions are state, not
   * observations, so no range may touch them.
   */
  it('never filters the session inventory, whatever the range', () => {
    const ctx = drive(COLLECTED);
    const ids = (range: GameContext['timeRange']) =>
      sessionInventory(withRange(ctx, range)).rows.map((row) => row.sessionId);

    expect(ids('night')).toEqual(['SES-8811', 'SES-8842', 'SES-8790']);
    expect(ids('last30')).toEqual(ids('night'));
    expect(ids('all')).toEqual(ids('night'));
  });

  it('keeps a revoked session visible under the narrowest range', () => {
    const ctx = drive([...COLLECTED, action('revoke_sessions')]);
    const rogue = sessionInventory(withRange(ctx, 'last30')).rows.find(
      (row) => row.sessionId === 'SES-8842',
    );
    // The operation has to be visible in the view it is about (§6), and a range
    // that hid the row would make containment look like it did nothing.
    expect(rogue?.state).toBe('revoked');
  });

  it('filters the message trace, which is a search over deliveries', () => {
    const ctx = drive(COLLECTED);
    expect(messageTrace(withRange(ctx, 'night'))).toHaveLength(2);

    const narrow = withRange(ctx, 'last30');
    // Both deliveries land at 02:41, well outside the last half hour.
    expect(messageTrace(narrow)).toHaveLength(0);
    expect(traceHiddenByRange(narrow)).toBe(2);
  });

  it('filters the egress ledger and counts what it hid', () => {
    const ctx = drive(COLLECTED);
    expect(egressLedger(withRange(ctx, 'all'))).toHaveLength(2);

    // 02:00 is before both transfers only if the range starts later; `all`
    // keeps them and a narrow window keeps only the two after 02:47.
    expect(egressHiddenByRange(withRange(ctx, 'all'))).toBe(0);
    expect(
      egressLedger(withRange(ctx, 'last30')).length + egressHiddenByRange(withRange(ctx, 'last30')),
    ).toBe(2);
  });

  it('bounds the night at 02:00 and the last-30 window at the incident clock', () => {
    const ctx = createInitialContext();
    expect(rangeBounds(ctx, 'night').fromSec).toBe(2 * 3600);
    expect(rangeBounds(ctx, 'last30').fromSec).toBe(ctx.clockSec - 30 * 60);
    expect(clockWithinRange('02:41:07', rangeBounds(ctx, 'night'))).toBe(true);
    expect(clockWithinRange('02:41:07', rangeBounds(ctx, 'last30'))).toBe(false);
  });

  it('is console state and never enters the run signature', () => {
    const ctx = drive(COLLECTED);
    const moved: GameContext = { ...ctx, timeRange: 'all', focus: { kind: 'host', value: 'WKS-114' } };

    expect(replaySignature(moved)).toEqual(replaySignature(ctx));
    expect(hashContext(moved)).toBe(hashContext(ctx));
  });
});

/* ------------------------------------------------------------------ *
 * Cross-tool correlation
 * ------------------------------------------------------------------ */

describe('a focus carries across the tools', () => {
  it('matches on a substring, because the same value is written several ways', () => {
    const focus = { kind: 'identity' as const, value: 'd.arslan' };
    expect(matchesFocus(focus, 'd.arslan@cy-case.corp')).toBe(true);
    expect(matchesFocus(focus, 'fp_1a77bd93 (WKS-114)')).toBe(false);
    expect(matchesFocus(null, 'd.arslan@cy-case.corp')).toBe(false);
    expect(matchesFocus({ kind: 'host', value: '' }, 'WKS-114')).toBe(false);
  });

  it('finds an identity in the SIEM, in Identity and in Email', () => {
    const ctx = drive(COLLECTED);
    const found = correlation(ctx, { kind: 'identity', value: 'd.arslan' });
    const by = new Map(found.map((entry) => [entry.tab, entry.matches]));

    expect(by.get('siem')).toBeGreaterThan(0);
    expect(by.get('identity')).toBeGreaterThan(0);
    expect(by.get('email')).toBeGreaterThan(0);
  });

  it('finds a host in Endpoint and in the SIEM', () => {
    const ctx = drive(COLLECTED);
    const by = new Map(
      correlation(ctx, { kind: 'host', value: 'WKS-114' }).map((e) => [e.tab, e.matches]),
    );

    expect(by.get('endpoint')).toBeGreaterThan(0);
    expect(by.get('siem')).toBeGreaterThan(0);
  });

  it('finds the attacker address in Network, Endpoint and the SIEM', () => {
    const ctx = drive(COLLECTED);
    const by = new Map(
      correlation(ctx, { kind: 'indicator', value: '203.0.113.47' }).map((e) => [e.tab, e.matches]),
    );

    expect(by.get('network')).toBeGreaterThan(0);
    expect(by.get('endpoint')).toBeGreaterThan(0);
    expect(by.get('siem')).toBeGreaterThan(0);
  });

  /**
   * The counts on the pivot controls have to be the counts in the tables.
   *
   * Both read `correlatableRows`, so this pins the one definition rather than
   * two that could drift — a control promising three matches and landing on a
   * table that highlights two is worse than no control at all.
   */
  it('counts exactly the rows that would be highlighted', () => {
    const ctx = drive(COLLECTED);
    const focus = { kind: 'host' as const, value: 'WKS-114' };

    for (const entry of correlation(ctx, focus)) {
      const highlighted = correlatableRows(ctx, entry.tab).filter((row) =>
        matchesFocus(focus, ...row.values),
      );
      expect(highlighted.length, entry.tab).toBe(entry.matches);
      if (entry.tab !== 'siem') {
        expect(correlatableRows(ctx, entry.tab).length, entry.tab).toBe(tabRowCount(ctx, entry.tab));
      }
    }
  });

  /**
   * The tab badge and the navigation spine must agree.
   *
   * `SideNav` labels Investigate with the size of the whole event index, so the
   * SIEM badge counts the same thing. Two numbers labelled alike and differing
   * on one screen is worse than a badge that ignores a filter the table beneath
   * it already reports.
   */
  it('counts the whole index in the SIEM badge, whatever the range', () => {
    const ctx = drive(COLLECTED);
    const indexed = siemEvents(ctx).length;

    for (const range of ['last30', 'night', 'all'] as const) {
      expect(tabRowCount(withRange(ctx, range), 'siem'), range).toBe(indexed);
    }
    // Correlation still answers the other question: what is on screen now.
    expect(
      correlatableRows(withRange(ctx, 'last30'), 'siem').length,
    ).toBeLessThan(indexed);
  });

  /**
   * The rows themselves, named.
   *
   * The count assertions above compare one function with itself, which would
   * survive a matcher that quietly stopped matching anything. These pin the
   * actual pivot the case is built around: the compromised host appears in the
   * EDR inventory, in its extension row, on its connection to the collector,
   * and in the identity session bound to its registered fingerprint.
   */
  it('names the rows a host reaches, across four tools', () => {
    const ctx = drive(COLLECTED);
    const focus = { kind: 'host' as const, value: 'WKS-114' };
    const matched = (tab: Parameters<typeof correlatableRows>[1]) =>
      correlatableRows(ctx, tab)
        .filter((row) => matchesFocus(focus, ...row.values))
        .map((row) => row.id);

    expect(matched('endpoint')).toEqual(['WKS-114', 'ext-WKS-114', 'conn-WKS-114-sso-cycase-verify[.]net']);
    // The legitimate session is bound to fp_1a77bd93 (WKS-114) — following the
    // host reaches it without the operator retyping the fingerprint.
    expect(matched('identity')).toEqual(['SES-8811']);
    expect(matched('siem').length).toBeGreaterThan(0);
    expect(matched('email')).toEqual([]);
  });

  it('names the rows the attacker address reaches', () => {
    const ctx = drive(COLLECTED);
    const focus = { kind: 'indicator' as const, value: '203.0.113.47' };
    const matched = (tab: Parameters<typeof correlatableRows>[1]) =>
      correlatableRows(ctx, tab)
        .filter((row) => matchesFocus(focus, ...row.values))
        .map((row) => row.id);

    expect(matched('network')).toEqual(['203.0.113.47', 'egress-03:16:58']);
    expect(matched('endpoint')).toEqual(['conn-SRV-FILES-02-files.cy-case-secure-id.net (203.0.113.47)']);
  });

  it('offers a pivot only where there is something to see', () => {
    const ctx = drive(COLLECTED);
    const targets = pivotTargets(ctx, { kind: 'indicator', value: 'no-such-indicator' });
    expect(targets).toEqual([]);

    for (const entry of pivotTargets(ctx, { kind: 'host', value: 'WKS-114' })) {
      expect(entry.matches).toBeGreaterThan(0);
    }
  });

  it('never hides a row: a focus narrows nothing', () => {
    const ctx = drive(COLLECTED);
    const focused: GameContext = { ...ctx, focus: { kind: 'host', value: 'WKS-114' } };

    // Arriving in a tool to find an empty table teaches nothing — the operator
    // cannot tell a failed pivot from an absent host.
    for (const entry of correlation(ctx, null)) {
      expect(correlatableRows(focused, entry.tab).length, entry.tab).toBe(entry.rows);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The attributed chronology
 * ------------------------------------------------------------------ */

describe('one chronology, every row attributed', () => {
  it('merges the incident chain with what the console did about it', () => {
    const ctx = drive(COLLECTED);
    const rows = chronology(ctx);

    expect(rows.some((row) => row.origin === 'system')).toBe(true);
    expect(rows.some((row) => row.origin === 'agent')).toBe(true);
    for (const row of rows) expect(['system', 'human', 'agent']).toContain(row.origin);
  });

  it('stays in clock order', () => {
    const rows = chronology(drive(GOLDEN));
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i]!.atSec).toBeGreaterThanOrEqual(rows[i - 1]!.atSec);
    }
  });

  it('does not print the alert twice', () => {
    const rows = chronology(drive(COLLECTED));
    expect(rows.filter((row) => row.id === 'open')).toHaveLength(0);
    expect(rows.filter((row) => row.text.includes('INC-74219'))).toHaveLength(0);
  });

  it('counts each origin, and the filter returns exactly that many', () => {
    const rows = chronology(drive(GOLDEN));
    const counts = chronologyCounts(rows);

    for (const origin of CHRONOLOGY_ORIGINS) {
      expect(filterChronology(rows, origin).length, origin).toBe(counts[origin]);
    }
    expect(counts.system + counts.human + counts.agent).toBe(counts.all);
  });

  it('grows as the operator works', () => {
    const early = chronology(createInitialContext()).length;
    expect(chronology(drive(GOLDEN)).length).toBeGreaterThan(early);
  });
});

/* ------------------------------------------------------------------ *
 * Provenance
 * ------------------------------------------------------------------ */

describe('chain of custody separates when a source recorded it from when we read it', () => {
  it('starts with the source, before anything is collected', () => {
    const custody = custodyRecord(createInitialContext(), 'art_email_001');

    expect(custody.state).toBe('uncollected');
    expect(custody.steps).toHaveLength(1);
    expect(custody.steps[0]).toMatchObject({ kind: 'emitted', by: 'system', at: '02:41:07' });
    expect(custody.source).toBe('Mail Gateway / MG-EU-1');
  });

  it('records who collected it and when, and keeps the source timestamp distinct', () => {
    const ctx = drive([decide('D1', 'D1_preserve_and_inspect'), inspect('art_email_001')]);
    const custody = custodyRecord(ctx, 'art_email_001');

    expect(custody.emittedAt).toBe('02:41:07');
    const collected = custody.steps.find((s) => s.kind === 'collected');
    expect(collected?.by).toBe('agent');
    // Collection happens on the incident clock, after the alert fired at
    // 03:17:42 — never at the source's own timestamp.
    expect(collected?.at.localeCompare(custody.emittedAt)).toBeGreaterThan(0);
  });

  it('records a destruction without losing the earlier steps', () => {
    const ctx = drive([
      decide('D1', 'D1_preserve_and_inspect'),
      inspect('art_email_001'),
      decide('D2', 'D2_compare_signin_telemetry'),
      diagnostic('auth_timeline'),
      decide('D3', 'D3_revoke_then_reset'),
      decide('D4', 'D4_delete_email_and_close_alert'),
    ]);
    const custody = custodyRecord(ctx, 'art_email_001');

    expect(custody.state).toBe('destroyed');
    expect(custody.steps.map((s) => s.kind)).toEqual(['emitted', 'collected', 'destroyed']);
    // The harness drives everything as the agent, so the destruction is the
    // agent's. Hard-coding "you" here would quietly reassign the blame.
    expect(custody.steps.at(-1)?.by).toBe('agent');
  });
});

/* ------------------------------------------------------------------ *
 * Source health
 * ------------------------------------------------------------------ */

describe('source health tells an empty source from an absent one', () => {
  it('lists every source type, including the ones with nothing in them', () => {
    const rows = sourceHealth(createInitialContext());
    expect(rows).toHaveLength(8);
    expect(rows.filter((row) => row.state === 'quiet').length).toBeGreaterThan(0);
    for (const row of rows.filter((r) => r.state === 'quiet')) {
      expect(row.events).toBe(0);
      expect(row.lastEventAt).toBeNull();
    }
  });

  it('moves a source to feeding once the case produces an event for it', () => {
    const before = sourceHealth(createInitialContext()).find((r) => r.sourceType === 'response');
    expect(before?.state).toBe('quiet');

    const ctx = drive([...COLLECTED, action('revoke_sessions')]);
    const after = sourceHealth(ctx).find((r) => r.sourceType === 'response');
    expect(after?.state).toBe('feeding');
    expect(after?.systems).toContain('CYCASE / response console');
  });
});

/* ------------------------------------------------------------------ *
 * Query diagnostics
 * ------------------------------------------------------------------ */

describe('the query bar explains itself instead of saying "invalid"', () => {
  it('says nothing about a query it understood', () => {
    expect(queryNotes('severity:critical cookie')).toEqual([]);
    expect(queryNotes('')).toEqual([]);
  });

  it('names the missing value and shows an example', () => {
    const [note] = queryNotes('user:');
    expect(note?.message).toContain('needs a value after "user:"');
    expect(note?.message).toContain('user:d.arslan');
    expect(note?.tone).toBe('warn');
  });

  it('says what an unknown prefix was searched as, and lists the real fields', () => {
    const [note] = queryNotes('proto:tcp');
    expect(note?.message).toContain('as free text');
    expect(note?.message).toContain('proto');
    expect(note?.message).toContain('severity');
    // The parse itself is unchanged: the token is still a search term.
    expect(searchEvents(createInitialContext(), { query: 'proto:tcp' })).toEqual([]);
  });

  it('names the values a severity or a type can actually take', () => {
    expect(queryNotes('severity:banana')[0]?.message).toContain('critical, warn, info');
    expect(queryNotes('type:kubernetes')[0]?.message).toContain('identity, email, proxy');
  });

  it('never returns a bare rejection', () => {
    for (const query of ['user:', 'proto:tcp', 'severity:banana', 'type:nope']) {
      for (const note of queryNotes(query)) {
        expect(note.message.length, query).toBeGreaterThan(20);
        expect(note.message.toLowerCase()).not.toContain('invalid input');
      }
    }
  });
});
