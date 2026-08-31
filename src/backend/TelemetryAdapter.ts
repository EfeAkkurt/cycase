import type { TelemetryEvent } from '../../shared/apiContract';

/**
 * The telemetry boundary (contract §3 and §6).
 *
 * §3 is unambiguous: "No request may mutate the React/XState state directly. A
 * backend event enters through a typed adapter and is converted to an
 * allowlisted game event or display-only telemetry event."
 *
 * This interface is that adapter. Note what it cannot express: there is no way
 * for an implementation to hand back a `GameCommand`, a score, an ending or a
 * state version. Everything it produces is a `TelemetryEvent`, which the UI
 * renders and the engine never sees. A hostile or buggy stream can therefore
 * make the activity feed wrong — it can never make the case wrong.
 */

export type TelemetryConnectionState = 'connected' | 'reconnecting' | 'stale' | 'offline';

export interface TelemetryAdapterListener {
  /** Called with events already deduplicated and in increasing sequence order. */
  onEvents(events: TelemetryEvent[]): void;
  onStateChange(state: TelemetryConnectionState): void;
}

export interface TelemetryAdapter {
  readonly kind: 'local' | 'sse';
  /** Current connection state. `local` is always `connected`. */
  readonly state: TelemetryConnectionState;
  /** Highest sequence delivered so far. Survives a reconnect. */
  readonly lastSequence: number;
  start(listener: TelemetryAdapterListener): void;
  stop(): void;
}

/**
 * Shared dedup guard.
 *
 * Both adapters use it, which is how "deduplicate by `eventId` in both server
 * and client" stays true rather than being reimplemented per transport.
 */
export class EventDeduplicator {
  private readonly seen = new Set<string>();
  private highest: number;

  constructor(from = 0) {
    this.highest = from;
  }

  get lastSequence(): number {
    return this.highest;
  }

  /** Drops anything already seen or out of order, and advances the watermark. */
  filter(events: readonly TelemetryEvent[]): TelemetryEvent[] {
    const out: TelemetryEvent[] = [];
    for (const event of events) {
      if (this.seen.has(event.eventId)) continue;
      if (event.sequence <= this.highest) continue;
      this.seen.add(event.eventId);
      this.highest = event.sequence;
      out.push(event);
    }
    return out;
  }

  reset(from = 0): void {
    this.seen.clear();
    this.highest = from;
  }
}
