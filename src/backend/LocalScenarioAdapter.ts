import { telemetryEventsAfter } from '../../shared/telemetryFixture';
import { INCIDENT_START_SEC } from '../game/fixtures/case001';
import {
  EventDeduplicator,
  type TelemetryAdapter,
  type TelemetryAdapterListener,
  type TelemetryConnectionState,
} from './TelemetryAdapter';

/**
 * The deterministic local telemetry source (contract §5).
 *
 * This is the adapter that makes local mode a first-class runtime rather than a
 * degraded one: it produces the same scripted events the SSE stream would, from
 * the same fixture, with no network involved. `local` and `degraded` both use
 * it, which is why losing the backend mid-case changes the badge and nothing
 * else on screen.
 *
 * It reads the *case* clock rather than wall time, so pausing the game pauses
 * telemetry — a feed that kept scrolling while the incident clock was frozen
 * would be telling the player something false about the simulation.
 */
export interface LocalScenarioAdapterOptions {
  /** Reads the current incident clock in seconds. */
  clockSec: () => number;
  /** Injectable for tests; defaults to `setInterval`. */
  scheduleMs?: number;
  setIntervalImpl?: typeof setInterval;
  clearIntervalImpl?: typeof clearInterval;
  incidentStartSec?: number;
}

export class LocalScenarioAdapter implements TelemetryAdapter {
  readonly kind = 'local' as const;

  private readonly options: LocalScenarioAdapterOptions;
  private readonly dedup = new EventDeduplicator();
  private timer: ReturnType<typeof setInterval> | null = null;
  private listener: TelemetryAdapterListener | null = null;
  private connectionState: TelemetryConnectionState = 'offline';

  constructor(options: LocalScenarioAdapterOptions) {
    this.options = options;
  }

  get state(): TelemetryConnectionState {
    return this.connectionState;
  }

  get lastSequence(): number {
    return this.dedup.lastSequence;
  }

  start(listener: TelemetryAdapterListener): void {
    this.listener = listener;
    // A local source is connected the moment it starts: there is nothing that
    // can go stale, so reporting anything else would be theatre.
    this.setState('connected');

    const tick = () => this.pump();
    const setIntervalImpl = this.options.setIntervalImpl ?? setInterval;
    this.timer = setIntervalImpl(tick, this.options.scheduleMs ?? 1000);
    this.pump();
  }

  stop(): void {
    if (this.timer !== null) {
      const clearIntervalImpl = this.options.clearIntervalImpl ?? clearInterval;
      clearIntervalImpl(this.timer);
      this.timer = null;
    }
    this.listener = null;
    this.setState('offline');
  }

  /** Emits whatever the fixture says has happened by now, once each. */
  pump(): void {
    if (!this.listener) return;
    const events = this.dedup.filter(
      telemetryEventsAfter(
        this.dedup.lastSequence,
        this.options.clockSec(),
        this.options.incidentStartSec ?? INCIDENT_START_SEC,
      ),
    );
    if (events.length > 0) this.listener.onEvents(events);
  }

  private setState(state: TelemetryConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.listener?.onStateChange(state);
  }
}
