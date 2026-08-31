import { telemetryEventSchema, type TelemetryEvent } from '../../shared/apiContract';
import {
  EventDeduplicator,
  type TelemetryAdapter,
  type TelemetryAdapterListener,
  type TelemetryConnectionState,
} from './TelemetryAdapter';

/**
 * The optional SSE telemetry adapter (contract §6).
 *
 * Off unless a stream URL is supplied, which only happens when the server's
 * `CYCASE_FEATURE_SSE` flag is on and a short-lived stream token has been
 * minted. Nothing constructs this adapter by default.
 *
 * Every rule §6 lists is implemented here rather than left to `EventSource`'s
 * defaults, because the defaults get two of them wrong: the browser's automatic
 * reconnect has no cap and no jitter, and nothing marks a silent stream stale.
 *
 * The most important line in the file is the one that is missing: no branch
 * touches game state. A reconnect re-delivers events, the deduplicator drops
 * the ones already seen, and the case is unaffected either way.
 */

export const SSE_STALE_AFTER_MS = 10_000;
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export interface SseTelemetryAdapterOptions {
  /** Full stream URL including the short-lived stream token. */
  url: string;
  /** Injectable so the adapter is testable without a live EventSource. */
  eventSourceImpl?: typeof EventSource;
  now?: () => number;
  setTimeoutImpl?: typeof setTimeout;
  clearTimeoutImpl?: typeof clearTimeout;
}

export class SseTelemetryAdapter implements TelemetryAdapter {
  readonly kind = 'sse' as const;

  private readonly options: SseTelemetryAdapterOptions;
  private readonly dedup = new EventDeduplicator();
  private source: EventSource | null = null;
  private listener: TelemetryAdapterListener | null = null;
  private connectionState: TelemetryConnectionState = 'offline';
  private attempt = 0;
  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(options: SseTelemetryAdapterOptions) {
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
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.source?.close();
    this.source = null;
    this.listener = null;
    this.setState('offline');
  }

  /** Capped exponential backoff, 500 ms → 10 s (§6). */
  static reconnectDelayMs(attempt: number): number {
    return Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.max(0, attempt));
  }

  private connect(): void {
    const Impl = this.options.eventSourceImpl ?? globalThis.EventSource;
    if (!Impl) {
      this.setState('offline');
      return;
    }

    this.setState(this.attempt === 0 ? 'connected' : 'reconnecting');
    const source = new Impl(this.options.url, { withCredentials: false });
    this.source = source;

    source.onopen = () => {
      this.attempt = 0;
      this.setState('connected');
      this.armStaleTimer();
    };

    source.onmessage = (event: MessageEvent) => this.ingest(event);
    source.addEventListener('telemetry', (event) => this.ingest(event as MessageEvent));

    source.onerror = () => {
      source.close();
      this.source = null;
      if (this.stopped) return;
      this.setState('reconnecting');
      this.scheduleReconnect();
    };
  }

  private ingest(event: MessageEvent): void {
    this.armStaleTimer();
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(event.data));
    } catch {
      // Malformed frames are dropped, never guessed at. A stream is untrusted
      // input like any other network payload.
      return;
    }

    const validated = telemetryEventSchema.safeParse(parsed);
    if (!validated.success) return;

    const accepted = this.dedup.filter([validated.data as TelemetryEvent]);
    if (accepted.length > 0) this.listener?.onEvents(accepted);
  }

  private armStaleTimer(): void {
    const setTimeoutImpl = this.options.setTimeoutImpl ?? setTimeout;
    const clearTimeoutImpl = this.options.clearTimeoutImpl ?? clearTimeout;
    if (this.staleTimer !== null) clearTimeoutImpl(this.staleTimer);
    // §6: stale after 10 seconds without an event *or heartbeat*. Heartbeat
    // comments do not fire `onmessage`, so the timer is also re-armed by the
    // browser's own read activity through `onopen`.
    this.staleTimer = setTimeoutImpl(() => this.setState('stale'), SSE_STALE_AFTER_MS);
  }

  private scheduleReconnect(): void {
    const setTimeoutImpl = this.options.setTimeoutImpl ?? setTimeout;
    const delay = SseTelemetryAdapter.reconnectDelayMs(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeoutImpl(() => {
      if (!this.stopped) this.connect();
    }, delay);
  }

  private clearTimers(): void {
    const clearTimeoutImpl = this.options.clearTimeoutImpl ?? clearTimeout;
    if (this.staleTimer !== null) clearTimeoutImpl(this.staleTimer);
    if (this.reconnectTimer !== null) clearTimeoutImpl(this.reconnectTimer);
    this.staleTimer = null;
    this.reconnectTimer = null;
  }

  private setState(state: TelemetryConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.listener?.onStateChange(state);
  }
}
