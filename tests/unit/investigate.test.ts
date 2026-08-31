import { describe, expect, it } from 'vitest';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import {
  ARTIFACT_BY_ID,
  BLOCKED_INDICATOR_VALUES,
  CONNECTION_RECORDS,
  DIAGNOSTIC_ROWS,
  EGRESS_RECORDS,
  EXTENSION_RECORDS,
  INDICATOR_RECORDS,
  MESSAGE_TRACE_RECORDS,
  SESSION_RECORDS,
} from '../../src/game/fixtures/case001';
import { incidentCounters } from '../../src/game/fixtures/telemetry';
import {
  INVESTIGATE_TAB_META,
  SIEM_SOURCE_TYPES,
  aggregateBy,
  credentialPosture,
  egressLedger,
  egressStoppedAt,
  egressTotals,
  endpointConnections,
  extensionInventory,
  hostInventory,
  indicatorInventory,
  matchesQuery,
  messageAuthentication,
  messageTrace,
  parseQuery,
  searchEvents,
  sessionInventory,
  siemEvents,
  sourceField,
  sourceRecord,
} from '../../src/game/investigate';
import {
  INVESTIGATE_TABS,
  RESPONSE_ACTION_IDS,
  type GameCommand,
  type GameContext,
} from '../../src/game/types';
import { hasKey, tk } from '../../src/i18n';

/**
 * The investigation layer's two promises, made checkable.
 *
 * 1. It invents nothing. Every identifier and volume the tools display also
 *    appears in the artifact or diagnostic the case already ships, so a fixture
 *    edit that contradicts a tool fails here rather than in a screenshot.
 * 2. It goes stale for nobody. A response action has to change the tool that
 *    action is about — the fixtures state the world as the alert found it, and
 *    a view that printed those strings back would still say ACTIVE after the
 *    session was revoked.
 */

const MUTATING = new Set(['take_response_action', 'submit_decision']);

/**
 * Idempotency keys have to be unique across *every* `drive` call in the file,
 * not just within one. Restarting the counter per call silently replays the
 * stored result of an unrelated earlier command instead of running the new one,
 * which looks exactly like a containment action that did nothing.
 */
let keySeq = 0;

function drive(
  steps: { kind: string; input: Record<string, unknown> }[],
  start = createInitialContext(),
): GameContext {
  let ctx = start;
  for (const step of steps) {
    const input: Record<string, unknown> = { ...step.input, stateVersion: ctx.stateVersion };
    if (MUTATING.has(step.kind)) {
      keySeq += 1;
      input.idempotencyKey = `inv-${keySeq}`;
    }
    ctx = executeCommand(ctx, {
      kind: step.kind,
      input,
      origin: 'agent',
    } as unknown as GameCommand).context;
  }
  return ctx;
}

/** Every field value of every artifact, plus every diagnostic row, as one blob. */
const CASE_TEXT = [
  ...[...ARTIFACT_BY_ID.values()].flatMap((artifact) => [
    artifact.source,
    artifact.timestamp,
    ...artifact.fields.map((field) => field.value),
  ]),
  ...Object.values(DIAGNOSTIC_ROWS).flatMap((rows) =>
    rows.flatMap((row) => [row.key, row.value]),
  ),
].join('\n');

/* ------------------------------------------------------------------ *
 * The records assert nothing new
 * ------------------------------------------------------------------ */

describe('structured records restate the case, they do not extend it', () => {
  it('names every session the session inventory lists, and no others', () => {
    for (const record of SESSION_RECORDS) {
      expect(CASE_TEXT, record.sessionId).toContain(record.sessionId);
      expect(CASE_TEXT, record.device).toContain(record.device);
    }
    // Three rows in, three sessions out — no fourth session invented.
    const listed = DIAGNOSTIC_ROWS.session_inventory ?? [];
    const sessionRows = listed.filter((row) => row.key.startsWith('SES-'));
    expect(sessionRows).toHaveLength(SESSION_RECORDS.length);
  });

  it('quotes the extension, its install times and its permissions verbatim', () => {
    for (const record of EXTENSION_RECORDS) {
      expect(CASE_TEXT).toContain(record.name);
      expect(CASE_TEXT).toContain(record.installedAt);
      if (record.version) expect(CASE_TEXT).toContain(record.version);
      if (record.permissions) expect(CASE_TEXT).toContain(record.permissions);
    }
  });

  it('quotes every egress volume and every connection destination', () => {
    for (const record of EGRESS_RECORDS) {
      expect(CASE_TEXT).toContain(String(record.totalMb));
      expect(CASE_TEXT).toContain(record.at);
    }
    for (const record of CONNECTION_RECORDS) {
      // Destinations may carry a parenthesised address; the host part must exist.
      expect(CASE_TEXT).toContain(record.destination.split(' ')[0]);
    }
  });

  it('quotes every indicator and every phishing recipient', () => {
    for (const record of INDICATOR_RECORDS) expect(CASE_TEXT).toContain(record.value);
    for (const record of MESSAGE_TRACE_RECORDS) expect(CASE_TEXT).toContain(record.recipient);
  });

  it('only reports as blocked the indicators the blocking action names', () => {
    // The result string is the contract; if it changes, this list has to.
    for (const value of BLOCKED_INDICATOR_VALUES) {
      expect(CASE_TEXT).toContain(value);
    }
    expect(BLOCKED_INDICATOR_VALUES).not.toContain('sso-cycase-verify[.]net');
  });

  it('offers a tool for every tab and a tab for every tool', () => {
    expect(INVESTIGATE_TAB_META.map((meta) => meta.id)).toEqual([...INVESTIGATE_TABS]);
  });

  /**
   * `t()` is key-checked by the compiler; `tk()` is not, because fixtures store
   * keys as plain strings. Every key a record hands to `tk()` is therefore
   * checked here instead — otherwise a typo ships as the key text rendered
   * literally in a table cell.
   */
  it('resolves every i18n key the records hand to tk()', () => {
    const keys = [
      ...SESSION_RECORDS.map((record) => record.noteKey),
      ...CONNECTION_RECORDS.map((record) => record.detailKey),
      ...EGRESS_RECORDS.map((record) => record.descriptionKey),
      ...SIEM_SOURCE_TYPES.map((type) => `investigate.type.${type}`),
      ...['critical', 'warn', 'info'].map((level) => `investigate.severity.${level}`),
      ...RESPONSE_ACTION_IDS.map((id) => `action.${id}.result`),
    ];

    for (const key of keys) {
      expect(hasKey(key), key).toBe(true);
      expect(tk(key), key).not.toBe(key);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Gating — nothing is visible before it is earned
 * ------------------------------------------------------------------ */

describe('a fresh case leaks nothing', () => {
  const fresh = createInitialContext();

  it('hides every value that a diagnostic is supposed to reveal', () => {
    const rendered = JSON.stringify({
      events: siemEvents(fresh),
      sessions: sessionInventory(fresh),
      extensions: extensionInventory(fresh),
      connections: endpointConnections(fresh),
      indicators: indicatorInventory(fresh),
      egress: egressLedger(fresh),
      trace: messageTrace(fresh),
      auth: messageAuthentication(fresh),
      hosts: hostInventory(fresh),
    });

    for (const secret of [
      'SES-8842',
      'fp_9c2a41e0',
      'b.yilmaz',
      'WKS-231',
      'Session Sync Helper',
      '203.0.113.47',
    ]) {
      expect(rendered, secret).not.toContain(secret);
    }
  });

  it('reports uncollected sources as uncollected rather than empty', () => {
    const record = sourceRecord(fresh, 'art_email_001');
    expect(record.state).toBe('uncollected');
    expect(record.fields).toEqual([]);
    expect(sourceField(record, 'field.subject')).toBeNull();
  });

  it('reports a source behind a diagnostic as locked, and names the diagnostic', () => {
    const record = sourceRecord(fresh, 'art_signin_001');
    expect(record.state).toBe('locked');
    expect(record.unlockedBy).toBe('auth_timeline');
    expect(record.fields).toEqual([]);
  });

  it('says the session store has not been queried', () => {
    expect(sessionInventory(fresh).ran).toBe(false);
    expect(sessionInventory(fresh).rows).toEqual([]);
  });
});

describe('earning a source opens exactly that source', () => {
  it('surfaces the sign-in and cookie records after the auth timeline', () => {
    const ctx = drive([{ kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } }]);
    expect(sourceRecord(ctx, 'art_signin_001').state).toBe('uncollected');
    expect(sourceRecord(ctx, 'art_session_001').state).toBe('locked');

    const inspected = drive(
      [{ kind: 'inspect_artifact', input: { artifactId: 'art_signin_001' } }],
      ctx,
    );
    const record = sourceRecord(inspected, 'art_signin_001');
    expect(record.state).toBe('ready');
    expect(sourceField(record, 'field.mfa')).toContain('existing session claim');
  });

  it('adds the second laptop and the second recipient only after the sweep', () => {
    const before = createInitialContext();
    expect(hostInventory(before).map((host) => host.assetId)).not.toContain('WKS-231');
    expect(messageTrace(before)).toHaveLength(0);

    const ctx = drive([{ kind: 'run_diagnostic', input: { diagnosticId: 'indicator_scope' } }]);
    expect(hostInventory(ctx).map((host) => host.assetId)).toContain('WKS-231');
    expect(messageTrace(ctx).map((row) => row.recipient)).toContain('b.yilmaz@cy-case.corp');
    expect(extensionInventory(ctx).map((row) => row.host)).toContain('WKS-231');
  });
});

/* ------------------------------------------------------------------ *
 * Live state — an operation changes the tool it is about
 * ------------------------------------------------------------------ */

describe('containment changes the identity tool', () => {
  const investigated = drive([
    { kind: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
  ]);

  it('lists the stolen session as valid before it is revoked', () => {
    const inventory = sessionInventory(investigated);
    expect(inventory.ran).toBe(true);
    const rogue = inventory.rows.find((row) => row.sessionId === 'SES-8842');
    expect(rogue?.state).toBe('active');
  });

  it('lists it as revoked afterwards, and leaves the service principal alone', () => {
    const ctx = drive(
      [{ kind: 'take_response_action', input: { actionId: 'revoke_sessions' } }],
      investigated,
    );
    const rows = sessionInventory(ctx).rows;
    expect(rows.find((row) => row.sessionId === 'SES-8842')?.state).toBe('revoked');
    expect(rows.find((row) => row.sessionId === 'SES-8811')?.state).toBe('revoked');
    expect(rows.find((row) => row.sessionId === 'SES-8790')?.state).toBe('active');
  });

  it('agrees with the incident counters about how many sessions are left', () => {
    expect(sessionInventory(investigated).activeCount).toBe(
      incidentCounters(investigated).activeSessions,
    );

    const contained = drive(
      [{ kind: 'take_response_action', input: { actionId: 'revoke_sessions' } }],
      investigated,
    );
    expect(sessionInventory(contained).activeCount).toBe(
      incidentCounters(contained).activeSessions,
    );
  });

  it('never claims a credential reset revoked an already-issued token', () => {
    const reset = drive([
      { kind: 'take_response_action', input: { actionId: 'reset_credentials' } },
    ]);
    const posture = credentialPosture(reset);
    expect(posture.state).toBe('reset');
    expect(posture.issuedTokensStillValid).toBe(true);

    const revoked = drive(
      [{ kind: 'take_response_action', input: { actionId: 'revoke_sessions' } }],
      reset,
    );
    expect(credentialPosture(revoked).issuedTokensStillValid).toBe(false);
  });
});

describe('containment changes the endpoint tool', () => {
  const collected = drive([{ kind: 'inspect_artifact', input: { artifactId: 'art_edr_001' } }]);

  it('shows the extension loose and the connection observed before isolation', () => {
    expect(extensionInventory(collected)[0]?.contained).toBe(false);
    expect(endpointConnections(collected)[0]?.state).toBe('observed');
    expect(hostInventory(collected).find((h) => h.assetId === 'WKS-114')?.status).toBe('affected');
  });

  it('shows it contained and the link severed afterwards', () => {
    const ctx = drive(
      [{ kind: 'take_response_action', input: { actionId: 'isolate_endpoint' } }],
      collected,
    );
    expect(extensionInventory(ctx)[0]?.contained).toBe(true);
    expect(endpointConnections(ctx)[0]?.state).toBe('severed');
    expect(hostInventory(ctx).find((h) => h.assetId === 'WKS-114')?.status).toBe('isolated');
  });

  it('does not claim the second laptop was isolated too', () => {
    const ctx = drive(
      [
        { kind: 'run_diagnostic', input: { diagnosticId: 'indicator_scope' } },
        { kind: 'take_response_action', input: { actionId: 'isolate_endpoint' } },
      ],
      collected,
    );
    expect(extensionInventory(ctx).find((row) => row.host === 'WKS-231')?.contained).toBe(false);
  });
});

describe('containment changes the network tool', () => {
  const collected = drive([
    { kind: 'inspect_artifact', input: { artifactId: 'art_dlp_001' } },
    { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
  ]);

  it('reports observed indicators as observed, never as allowed-by-a-firewall', () => {
    const states = new Set(indicatorInventory(collected).map((row) => row.state));
    expect(states).toEqual(new Set(['observed']));
  });

  it('blocks exactly the two indicators the action names', () => {
    const ctx = drive(
      [{ kind: 'take_response_action', input: { actionId: 'block_indicator' } }],
      collected,
    );
    const blocked = indicatorInventory(ctx)
      .filter((row) => row.state === 'blocked')
      .map((row) => row.value);
    expect(new Set(blocked)).toEqual(new Set(BLOCKED_INDICATOR_VALUES));
    expect(endpointConnections(ctx).find((row) => row.host === 'SRV-FILES-02')?.state).toBe(
      'blocked',
    );
  });

  it('records when egress stopped, and only once something stopped it', () => {
    expect(egressStoppedAt(collected)).toBeNull();
    const ctx = drive(
      [{ kind: 'take_response_action', input: { actionId: 'block_indicator' } }],
      collected,
    );
    expect(egressStoppedAt(ctx)).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});

/* ------------------------------------------------------------------ *
 * Egress arithmetic
 * ------------------------------------------------------------------ */

describe('the egress ledger', () => {
  const ctx = drive([
    { kind: 'inspect_artifact', input: { artifactId: 'art_fileops_001' } },
    { kind: 'inspect_artifact', input: { artifactId: 'art_dlp_001' } },
  ]);

  it('derives the partially transferred volume from the stated percentage', () => {
    const rows = egressLedger(ctx);
    const partial = rows.find((row) => row.partiallyBlocked);
    expect(partial?.totalMb).toBe(18.4);
    // "blocked at 62%" of 18.4 MB.
    expect(partial?.egressedMb).toBe(11.4);
  });

  it('reports a completed transfer as fully egressed', () => {
    const complete = egressLedger(ctx).find((row) => !row.partiallyBlocked);
    expect(complete?.totalMb).toBe(41.2);
    expect(complete?.egressedMb).toBe(41.2);
  });

  it('totals without floating-point drift', () => {
    expect(egressTotals(egressLedger(ctx))).toEqual({ totalMb: 59.6, egressedMb: 52.6 });
  });

  it('shows nothing at all before either record is collected', () => {
    expect(egressLedger(createInitialContext())).toEqual([]);
    expect(egressTotals([])).toEqual({ totalMb: 0, egressedMb: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * Destroyed evidence
 * ------------------------------------------------------------------ */

describe('deleting the phishing message', () => {
  const destroyed = drive([
    { kind: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
    {
      kind: 'submit_decision',
      input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' },
    },
    {
      kind: 'submit_decision',
      input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' },
    },
    { kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
    { kind: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset' } },
    {
      kind: 'submit_decision',
      input: { decisionId: 'D4', optionId: 'D4_delete_email_and_close_alert' },
    },
  ]);

  it('destroys the source rather than merely hiding it', () => {
    expect(destroyed.destroyedArtifacts).toContain('art_email_001');
    const record = sourceRecord(destroyed, 'art_email_001');
    expect(record.state).toBe('destroyed');
    expect(record.fields).toEqual([]);
  });

  it('exposes no header value through the email tool afterwards', () => {
    const rendered = JSON.stringify({
      trace: messageTrace(destroyed),
      auth: messageAuthentication(destroyed),
      source: sourceRecord(destroyed, 'art_email_001'),
    });
    expect(rendered).not.toContain('Mandatory session re-verification');
    expect(rendered).not.toContain('alerts@cy-case-secure-id.net');
    expect(rendered).not.toContain('CyCase IT Service Desk');
    expect(messageAuthentication(destroyed)).toEqual([]);
  });

  it('still records that a message was delivered, marked destroyed', () => {
    const row = messageTrace(destroyed).find((entry) => entry.identity === 'usr_dilara');
    expect(row?.disposition).toBe('destroyed');
    expect(row?.clickedAt).toBeNull();
    expect(row?.at).toBe('02:41:07');
  });
});

/* ------------------------------------------------------------------ *
 * Query language
 * ------------------------------------------------------------------ */

describe('the SIEM query parser', () => {
  it('splits bare words from field filters', () => {
    expect(parseQuery('severity:critical cookie')).toEqual({
      terms: ['cookie'],
      filters: [{ field: 'severity', value: 'critical' }],
    });
  });

  it('lower-cases filter values so a query is not case-sensitive', () => {
    expect(parseQuery('USER:D.Arslan').filters).toEqual([
      { field: 'user', value: 'd.arslan' },
    ]);
  });

  it('keeps an unknown prefix as a search term instead of dropping it', () => {
    // Silently ignoring half the query would teach trust in a filter that was
    // never applied.
    const query = parseQuery('proto:tcp');
    expect(query.filters).toEqual([]);
    expect(query.terms).toEqual(['proto:tcp']);
  });

  it('strips surrounding quotes from a value', () => {
    expect(parseQuery('source:"IDP-01"').filters).toEqual([
      { field: 'source', value: 'idp-01' },
    ]);
  });

  it('treats an empty query as matching everything', () => {
    const event = siemEvents(createInitialContext())[0];
    expect(event).toBeDefined();
    expect(matchesQuery(event!, parseQuery('   '))).toBe(true);
  });

  it('ANDs every filter and every term', () => {
    const event = siemEvents(createInitialContext()).find(
      (candidate) => candidate.user === 'd.arslan@cy-case.corp',
    );
    expect(event).toBeDefined();
    expect(matchesQuery(event!, parseQuery('user:d.arslan severity:info'))).toBe(
      event!.severity === 'info',
    );
    expect(matchesQuery(event!, parseQuery('user:nobody'))).toBe(false);
  });
});

describe('searching', () => {
  const ctx = drive([
    { kind: 'inspect_artifact', input: { artifactId: 'art_edr_001' } },
    { kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
  ]);

  it('narrows by time range', () => {
    const all = searchEvents(ctx, { query: '', range: 'all' });
    const recent = searchEvents(ctx, { query: '', range: 'last30' });
    expect(all.length).toBeGreaterThan(recent.length);
    // Everything in the narrow window really is inside it.
    for (const event of recent) {
      expect(event.atSec).toBeGreaterThanOrEqual(ctx.clockSec - 30 * 60);
      expect(event.atSec).toBeLessThanOrEqual(ctx.clockSec);
    }
  });

  it('returns results in clock order', () => {
    const results = searchEvents(ctx, { query: '', range: 'all' });
    const times = results.map((event) => event.atSec);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('indexes a response operation the moment it is performed', () => {
    const before = searchEvents(ctx, { query: 'type:response', range: 'all' });
    expect(before).toHaveLength(0);

    const after = drive(
      [{ kind: 'take_response_action', input: { actionId: 'isolate_endpoint' } }],
      ctx,
    );
    const indexed = searchEvents(after, { query: 'type:response', range: 'all' });
    expect(indexed).toHaveLength(1);
    expect(indexed[0]?.message).toContain('WKS-114 isolated');
  });
});

describe('aggregation', () => {
  it('orders severity buckets by severity, not by count', () => {
    const ctx = drive([{ kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } }]);
    const rows = aggregateBy(searchEvents(ctx, { query: '', range: 'all' }), 'severity');
    const order = rows.map((row) => row.key);
    expect(order).toEqual([...order].sort((a, b) => rank(a) - rank(b)));
  });

  it('counts every matched event exactly once', () => {
    const ctx = drive([{ kind: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } }]);
    const events = searchEvents(ctx, { query: '', range: 'all' });
    const total = aggregateBy(events, 'sourceType').reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(events.length);
  });

  it('omits buckets with nothing in them', () => {
    const rows = aggregateBy([], 'sourceType');
    expect(rows).toEqual([]);
  });
});

function rank(severity: string): number {
  return ['critical', 'warn', 'info'].indexOf(severity);
}
