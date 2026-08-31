import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NarrativeEntry } from '../../src/game/types';

/**
 * The narration channel, tested without a browser.
 *
 * There was no unit test for this module until the deadlock below was found,
 * and the reason it had none is worth writing down: `narrationStore` schedules
 * its hold with `window.setTimeout`, and the unit project runs in vitest's
 * `node` environment, where there is no `window`. So the channel was only ever
 * exercised through the Playwright suite — which drives it in real time and
 * therefore only ever proved the timings a browser test has the patience to
 * wait for. Shimming `window` onto `globalThis` and using fake timers costs
 * three lines and buys the ability to sit on the far side of a 2.6 second hold
 * in a millisecond, which is exactly where the defect lived.
 *
 * The defect: when a line's hold expired with an empty queue, the timer
 * returned early and left `active` set forever. `advance()` refuses to start a
 * line while one is active, so every later line was appended to `pending` and
 * never shown. The E2E suite missed it because its three-line test queues all
 * three inside the first line's hold, so `pending` was never empty at the
 * moment the timer fired and the release path always ran.
 */

let narrationChannel: typeof import('../../src/ui/narration/narrationStore').narrationChannel;

/** Short enough that every hold below is `MIN_HOLD_MS`, not a reading-pace one. */
const SHORT = 'A short line.';
/** Comfortably past `MIN_HOLD_MS` (2600) for a message this length. */
const PAST_THE_HOLD = 4000;

function entry(sequence: number, overrides: Partial<NarrativeEntry> = {}): NarrativeEntry {
  return {
    narrativeSequence: sequence,
    tone: 'teaching',
    language: 'en',
    message: SHORT,
    basedOnStateVersion: 0,
    at: '09:00:00',
    ...overrides,
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  (globalThis as never as { window: unknown }).window = globalThis;
  vi.resetModules();
  ({ narrationChannel } = await import('../../src/ui/narration/narrationStore'));
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as never as { window?: unknown }).window;
});

describe('a line arriving after the channel has fallen quiet', () => {
  it('is shown, not left waiting behind the line before it', () => {
    // The whole log every time, because that is what `NarrationDriver` hands
    // over: it re-offers the append-only `narrativeLog` on each append.
    const first = entry(1, { message: 'The identity servers stopped answering.' });
    narrationChannel.ingest([first]);
    expect(narrationChannel.getState().active).toBe(first);

    // Nothing is queued behind it, so the hold expires against an empty queue —
    // the exact situation that used to wedge the channel shut.
    vi.advanceTimersByTime(PAST_THE_HOLD);

    const second = entry(2, { message: 'The sweep found a second signed-in device.' });
    narrationChannel.ingest([first, second]);

    const state = narrationChannel.getState();
    expect(state.active, 'the second line never reached the caption').toBe(second);
    expect(state.pending).toEqual([]);
    expect(narrationChannel.placementOf(2)).toBe('active');
  });

  it('stays on screen until something replaces it', () => {
    const only = entry(1);
    narrationChannel.ingest([only]);
    vi.advanceTimersByTime(PAST_THE_HOLD);

    // Releasing the channel is not the same as blanking the caption. A player
    // who is still reading the last thing they were told keeps it in front of
    // them; what the expired hold gives up is the right to be the next line.
    expect(narrationChannel.getState().active).toBe(only);
    expect(narrationChannel.getState().speaking).toBe(false);
  });

  it('still makes the line after it wait its own turn', () => {
    /*
     * The regression that the fix itself can introduce.
     *
     * Once a hold has expired, the channel is releasable. If that releasable
     * mark is not cleared when the next line takes over, the replacement is
     * born already expired: a third line arriving a millisecond later displaces
     * it, and the player sees a sentence for one frame. Cold-starting three
     * rapid lines does not catch this, because the first line of a run is never
     * born from an expired hold. This is the case that does.
     */
    const first = entry(1);
    narrationChannel.ingest([first]);
    vi.advanceTimersByTime(PAST_THE_HOLD);

    const second = entry(2, { message: 'The second line, after the quiet.' });
    narrationChannel.ingest([first, second]);
    expect(narrationChannel.getState().active).toBe(second);

    const third = entry(3, { message: 'The third line, hard on its heels.' });
    narrationChannel.ingest([first, second, third]);

    expect(narrationChannel.getState().active, 'the new line was cut off mid-sentence').toBe(
      second,
    );
    expect(narrationChannel.placementOf(3)).toBe('pending');

    // And it is a real hold, not a missing one: the third line arrives on time.
    vi.advanceTimersByTime(PAST_THE_HOLD);
    expect(narrationChannel.getState().active).toBe(third);
  });
});

describe('lines that arrive together', () => {
  it('play in sequence with none lost', () => {
    const log = [
      entry(1, { message: 'First line about the session.' }),
      entry(2, { message: 'Second line about the endpoint.' }),
      entry(3, { message: 'Third line about the sweep.' }),
    ];
    narrationChannel.ingest(log);

    expect(narrationChannel.getState().active).toBe(log[0]);
    expect(narrationChannel.getState().pending).toEqual([log[1], log[2]]);

    vi.advanceTimersByTime(PAST_THE_HOLD);
    expect(narrationChannel.getState().active).toBe(log[1]);
    expect(narrationChannel.getState().pending).toEqual([log[2]]);

    vi.advanceTimersByTime(PAST_THE_HOLD);
    expect(narrationChannel.getState().active).toBe(log[2]);
    expect(narrationChannel.getState().pending).toEqual([]);
    expect(narrationChannel.getState().deliveredSequence).toBe(3);
  });

  it('are offered out of order and still play in order', () => {
    const one = entry(1, { message: 'The line written first.' });
    const two = entry(2, { message: 'The line written second.' });
    narrationChannel.ingest([two, one]);

    expect(narrationChannel.getState().active).toBe(one);
    expect(narrationChannel.getState().pending).toEqual([two]);
  });
});

describe('a duplicate line', () => {
  it('does not re-queue when the log is offered again', () => {
    const log = [entry(1), entry(2, { message: 'The one still waiting.' })];
    narrationChannel.ingest(log);
    expect(narrationChannel.getState().pending).toHaveLength(1);

    // The log is append-only and re-offered on every append, so the channel
    // sees each entry many times. A replayed idempotency key reaches it the
    // same way, and neither may produce a second copy of the same sentence.
    narrationChannel.ingest(log);
    narrationChannel.ingest([...log, entry(2, { message: 'The one still waiting.' })]);

    expect(narrationChannel.getState().pending).toHaveLength(1);
    expect(narrationChannel.getState().active).toBe(log[0]);
  });

  it('does not surface again once it has been delivered', () => {
    const one = entry(1);
    narrationChannel.ingest([one]);
    vi.advanceTimersByTime(PAST_THE_HOLD);

    // Delivered, and the channel is now releasable — the state in which the
    // deadlock hid. A re-offer of the same entry must still be ignored.
    narrationChannel.ingest([one]);
    expect(narrationChannel.getState().pending).toEqual([]);
    expect(narrationChannel.placementOf(1)).toBe('active');
  });
});

describe('a line about a state the case has left', () => {
  it('is dropped from the queue rather than shown late', () => {
    const log = [
      entry(1, { message: 'Written about the opening state.' }),
      entry(2, { message: 'Also written about the opening state.' }),
    ];
    narrationChannel.ingest(log);
    expect(narrationChannel.getState().pending).toHaveLength(1);

    narrationChannel.setStateVersion(1);

    const state = narrationChannel.getState();
    expect(state.active, 'a retired line stayed on screen').toBeNull();
    expect(state.pending).toEqual([]);
    expect(state.speaking).toBe(false);

    // And it cannot creep back when the hold that was running expires.
    vi.advanceTimersByTime(PAST_THE_HOLD);
    expect(narrationChannel.getState().active).toBeNull();
  });

  it('is refused on ingest, so a stale log replay cannot surface it', () => {
    narrationChannel.setStateVersion(2);
    narrationChannel.ingest([entry(1, { basedOnStateVersion: 1 })]);

    expect(narrationChannel.getState().active).toBeNull();
    expect(narrationChannel.getState().pending).toEqual([]);
  });

  it('leaves a line written about where the case actually is', () => {
    narrationChannel.setStateVersion(1);
    const current = entry(1, { basedOnStateVersion: 1 });
    narrationChannel.ingest([current]);

    // Retirement is about the version the line was written for, not about age:
    // re-asserting the same version must not sweep away a line that holds.
    narrationChannel.setStateVersion(1);
    expect(narrationChannel.getState().active).toBe(current);
  });
});

describe('skipping', () => {
  it('hands the channel to the next line immediately', () => {
    const log = [entry(1), entry(2, { message: 'The next one along.' })];
    narrationChannel.ingest(log);

    narrationChannel.skip();
    expect(narrationChannel.getState().active).toBe(log[1]);

    // The skipped line's hold must not fire against the new one and cut it
    // short — the replacement gets its own full hold.
    vi.advanceTimersByTime(PAST_THE_HOLD - 1);
    expect(narrationChannel.getState().active).toBe(log[1]);
  });

  it('clears the caption when nothing is waiting', () => {
    narrationChannel.ingest([entry(1)]);
    narrationChannel.skip();

    // Skip is the player asking for the line to go away, which is the one case
    // where an empty channel is the correct answer.
    expect(narrationChannel.getState().active).toBeNull();
  });
});
