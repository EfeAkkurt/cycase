import { describe, expect, it } from 'vitest';

import { telemetryEventSchema, type TelemetryEvent } from '../../../shared/apiContract';
import {
  telemetryEventsAfter,
  telemetryEventsUpTo,
  telemetryFixtureLength,
  TELEMETRY_FIXTURE_DURATION_SEC,
} from '../../../shared/telemetryFixture';
import {
  formatSseEvent,
  formatSseHeartbeat,
  reconnectDelayMs,
  sequenceFromEventId,
  SSE_HEARTBEAT_MS,
  SSE_RECONNECT_MAX_MS,
  SSE_RECONNECT_MIN_MS,
  SSE_STALE_AFTER_MS,
  TelemetrySequencer,
} from '../../../server/services/telemetryStream';
import { EventDeduplicator } from '../../../src/backend/TelemetryAdapter';
import { LocalScenarioAdapter } from '../../../src/backend/LocalScenarioAdapter';
import { INCIDENT_START_SEC } from '../../../src/game/fixtures/case001';

describe('deterministic telemetry fixture', () => {
  it('is a pure function of the clock', () => {
    const a = telemetryEventsUpTo(INCIDENT_START_SEC + 100);
    const b = telemetryEventsUpTo(INCIDENT_START_SEC + 100);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('emits nothing before the incident opens and everything by the end', () => {
    expect(telemetryEventsUpTo(INCIDENT_START_SEC - 1)).toEqual([]);
    expect(
      telemetryEventsUpTo(INCIDENT_START_SEC + TELEMETRY_FIXTURE_DURATION_SEC),
    ).toHaveLength(telemetryFixtureLength());
  });

  it('numbers sequences monotonically from 1 with stable event ids', () => {
    const events = telemetryEventsUpTo(INCIDENT_START_SEC + 10_000);
    events.forEach((event, index) => {
      expect(event.sequence).toBe(index + 1);
      expect(event.eventId).toBe(`evt_case001_${String(index + 1).padStart(4, '0')}`);
    });
  });

  it('produces events that validate against the shared schema', () => {
    for (const event of telemetryEventsUpTo(INCIDENT_START_SEC + 10_000)) {
      expect(telemetryEventSchema.safeParse(event).success).toBe(true);
    }
  });

  it('derives emittedAt from the scenario clock, not from Date.now()', () => {
    const first = telemetryEventsUpTo(INCIDENT_START_SEC + 10_000)[0]!;
    const again = telemetryEventsUpTo(INCIDENT_START_SEC + 10_000)[0]!;
    expect(first.emittedAt).toBe(again.emittedAt);
  });

  it('returns only what a resuming client has not seen', () => {
    const all = telemetryEventsUpTo(INCIDENT_START_SEC + 10_000);
    const after = telemetryEventsAfter(2, INCIDENT_START_SEC + 10_000);
    expect(after).toHaveLength(all.length - 2);
    expect(after[0]!.sequence).toBe(3);
  });
});

describe('event deduplication and sequence checks', () => {
  const event = (sequence: number, id = `evt_${sequence}`): TelemetryEvent => ({
    eventId: id,
    sequence,
    scenarioTimeSec: 0,
    source: 'system',
    severity: 'info',
    entityIds: [],
    kind: 'test',
    payload: {},
    emittedAt: '2026-08-29T00:00:00.000Z',
  });

  it('drops a repeated eventId', () => {
    const sequencer = new TelemetrySequencer();
    expect(sequencer.accept([event(1), event(2)]).accepted).toHaveLength(2);
    const second = sequencer.accept([event(1), event(2), event(3)]);
    expect(second.accepted.map((e) => e.sequence)).toEqual([3]);
    expect(second.duplicates).toBe(2);
  });

  it('drops an out-of-order event rather than reordering the log', () => {
    const sequencer = new TelemetrySequencer();
    sequencer.accept([event(5)]);
    const late = sequencer.accept([event(3, 'evt_late')]);
    expect(late.accepted).toEqual([]);
    expect(late.outOfOrder).toBe(1);
    expect(sequencer.sequence).toBe(5);
  });

  it('resumes from a supplied sequence without re-delivering the prefix', () => {
    const sequencer = new TelemetrySequencer(3);
    const accepted = sequencer.accept([event(1), event(2), event(3), event(4)]);
    expect(accepted.accepted.map((e) => e.sequence)).toEqual([4]);
  });

  it('applies the same rules on the client', () => {
    const dedup = new EventDeduplicator();
    expect(dedup.filter([event(1), event(1), event(2)])).toHaveLength(2);
    expect(dedup.filter([event(2), event(1)])).toEqual([]);
    expect(dedup.lastSequence).toBe(2);
  });
});

describe('SSE framing and reconnect policy (§6)', () => {
  it('emits an id line so Last-Event-ID resume works', () => {
    const frame = formatSseEvent(telemetryEventsUpTo(INCIDENT_START_SEC + 10_000)[0]!);
    expect(frame.startsWith('id: evt_case001_0001\n')).toBe(true);
    expect(frame).toContain('event: telemetry\n');
    expect(frame.endsWith('\n\n')).toBe(true);
  });

  it('sends heartbeats as comments, which cannot be mistaken for data', () => {
    expect(formatSseHeartbeat().startsWith(':')).toBe(true);
    expect(SSE_HEARTBEAT_MS).toBe(15_000);
    expect(SSE_STALE_AFTER_MS).toBe(10_000);
  });

  it('caps exponential reconnect between 500 ms and 10 s', () => {
    expect(reconnectDelayMs(0)).toBe(SSE_RECONNECT_MIN_MS);
    expect(reconnectDelayMs(1)).toBe(1000);
    expect(reconnectDelayMs(4)).toBe(8000);
    expect(reconnectDelayMs(50)).toBe(SSE_RECONNECT_MAX_MS);
  });

  it('parses a resume position out of an event id and never throws on junk', () => {
    expect(sequenceFromEventId('evt_case001_0007')).toBe(7);
    expect(sequenceFromEventId(undefined)).toBe(0);
    expect(sequenceFromEventId('nonsense')).toBe(0);
    expect(sequenceFromEventId('evt_x_')).toBe(0);
  });
});

describe('LocalScenarioAdapter', () => {
  it('delivers each fixture event exactly once as the case clock advances', () => {
    let clock = INCIDENT_START_SEC;
    const received: TelemetryEvent[] = [];
    const adapter = new LocalScenarioAdapter({
      clockSec: () => clock,
      // Do not schedule anything; the test pumps manually.
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
      clearIntervalImpl: (() => {}) as unknown as typeof clearInterval,
    });

    adapter.start({
      onEvents: (events) => received.push(...events),
      onStateChange: () => {},
    });

    expect(adapter.state).toBe('connected');
    expect(received).toHaveLength(1);

    clock = INCIDENT_START_SEC + 50;
    adapter.pump();
    adapter.pump();
    adapter.pump();

    const ids = received.map((event) => event.eventId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(received.length).toBeGreaterThan(1);
    expect(adapter.lastSequence).toBe(received[received.length - 1]!.sequence);

    adapter.stop();
    expect(adapter.state).toBe('offline');
  });

  it('emits nothing while the case clock is frozen', () => {
    const received: TelemetryEvent[] = [];
    const adapter = new LocalScenarioAdapter({
      clockSec: () => INCIDENT_START_SEC,
      setIntervalImpl: (() => 0) as unknown as typeof setInterval,
      clearIntervalImpl: (() => {}) as unknown as typeof clearInterval,
    });
    adapter.start({ onEvents: (e) => received.push(...e), onStateChange: () => {} });
    const afterStart = received.length;
    adapter.pump();
    adapter.pump();
    expect(received).toHaveLength(afterStart);
  });
});
