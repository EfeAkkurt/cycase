import type { TelemetryEvent } from '../../shared/apiContract';

/**
 * SSE bookkeeping (contract §6).
 *
 * The stream rules are easy to state and easy to get wrong, so they live in one
 * testable object rather than being scattered through a route handler:
 *
 * - deduplicate by `eventId`;
 * - preserve a monotonically increasing `sequence`;
 * - resume from `Last-Event-ID` without replaying what the client already has;
 * - heartbeat comments so a client can detect a stalled stream.
 *
 * None of it may touch game state — a reconnect delivers *display* events, and
 * an event that reached the browser twice must render once.
 */

export interface StreamAcceptance {
  accepted: TelemetryEvent[];
  duplicates: number;
  outOfOrder: number;
}

export class TelemetrySequencer {
  private readonly seenIds = new Set<string>();
  private lastSequence: number;

  constructor(lastSequence = 0) {
    this.lastSequence = lastSequence;
  }

  get sequence(): number {
    return this.lastSequence;
  }

  /**
   * Filters a batch down to what the client has not seen.
   *
   * An event whose `sequence` is not greater than the last delivered one is
   * dropped as out of order rather than reordered: the stream is a log, and
   * silently reshuffling it would let a delayed duplicate overwrite newer state.
   */
  accept(events: readonly TelemetryEvent[]): StreamAcceptance {
    const accepted: TelemetryEvent[] = [];
    let duplicates = 0;
    let outOfOrder = 0;

    for (const event of events) {
      if (this.seenIds.has(event.eventId)) {
        duplicates += 1;
        continue;
      }
      if (event.sequence <= this.lastSequence) {
        outOfOrder += 1;
        continue;
      }
      this.seenIds.add(event.eventId);
      this.lastSequence = event.sequence;
      accepted.push(event);
    }

    return { accepted, duplicates, outOfOrder };
  }

  reset(lastSequence = 0): void {
    this.seenIds.clear();
    this.lastSequence = lastSequence;
  }
}

/** Serialises one event as an SSE frame, including the `id:` line for resume. */
export function formatSseEvent(event: TelemetryEvent): string {
  return `id: ${event.eventId}\nevent: telemetry\ndata: ${JSON.stringify(event)}\n\n`;
}

/** §6: heartbeat comments every 15 seconds. */
export const SSE_HEARTBEAT_MS = 15_000;
/** §6: mark stale after 10 seconds without an event or heartbeat. */
export const SSE_STALE_AFTER_MS = 10_000;
/** §6: capped exponential reconnect delay, 500 ms to 10 s. */
export const SSE_RECONNECT_MIN_MS = 500;
export const SSE_RECONNECT_MAX_MS = 10_000;

export function formatSseHeartbeat(): string {
  return `: heartbeat\n\n`;
}

/** Capped exponential backoff. Attempt 0 is the first retry. */
export function reconnectDelayMs(attempt: number): number {
  const delay = SSE_RECONNECT_MIN_MS * 2 ** Math.max(0, attempt);
  return Math.min(SSE_RECONNECT_MAX_MS, delay);
}

/** `Last-Event-ID: evt_case001_0003` → 3. Returns 0 for anything unparseable. */
export function sequenceFromEventId(eventId: string | undefined): number {
  if (!eventId) return 0;
  const match = /_(\d+)$/.exec(eventId);
  if (!match) return 0;
  const parsed = Number.parseInt(match[1] ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}
