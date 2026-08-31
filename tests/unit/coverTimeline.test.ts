import { describe, expect, it } from 'vitest';

import {
  COVER_HOLD_MS,
  COVER_IN_MS,
  COVER_OUT_MS,
  REDUCED_COVER,
  coverOpacity,
  coverTimings,
  forwardCoverTimings,
  heldExtra,
  returnCoverTimings,
} from '../../src/ui/intro/coverTimeline';

/**
 * The forward crossfade's timing is a fixed point of this work.
 *
 * The dashboard-return cover (audit P2) reuses `TransitionCover`, and the brief
 * is explicit that the office-to-dashboard transition's behaviour and timing
 * must not change. The component's opacity curve was therefore extracted into
 * `coverTimeline.ts` so it can be compared, here, against the formula that
 * shipped — with no DOM and no GPU, which is the only proof available in this
 * worktree.
 *
 * `shippedOpacity` below is a verbatim transcription of the arithmetic inside
 * `TransitionCover`'s `requestAnimationFrame` loop as of `a036baf`. It is
 * duplicated on purpose: a reference implementation that imported the code
 * under test would prove nothing.
 */

function shippedEaseIn(t: number): number {
  return t * t;
}

function shippedEaseOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function shippedOpacity(elapsed: number, reducedMotion: boolean): number {
  const inMs = reducedMotion ? 32 : 380;
  const holdMs = reducedMotion ? 16 : 90;
  const outMs = reducedMotion ? 32 : 400;

  let opacity: number;
  if (elapsed < inMs) opacity = shippedEaseIn(elapsed / inMs);
  else if (elapsed < inMs + holdMs) opacity = 1;
  else opacity = 1 - shippedEaseOut(Math.min(1, (elapsed - inMs - holdMs) / outMs));

  return Math.min(1, Math.max(0, opacity));
}

function shippedDuration(reducedMotion: boolean): number {
  return reducedMotion ? 32 + 16 + 32 : 380 + 90 + 400;
}

describe('forward cover timing is unchanged', () => {
  for (const reducedMotion of [false, true]) {
    const label = reducedMotion ? 'reduced motion' : 'full motion';

    it(`matches the shipped opacity curve at every millisecond (${label})`, () => {
      const timings = forwardCoverTimings(reducedMotion);
      const total = shippedDuration(reducedMotion);

      // Every whole millisecond of the fade, plus a margin past the end, plus
      // the sub-millisecond neighbourhood of each boundary — those are where an
      // off-by-one branch would hide.
      const samples: number[] = [];
      for (let ms = 0; ms <= total + 40; ms += 1) samples.push(ms);
      for (const edge of [timings.in, timings.in + timings.hold, total]) {
        samples.push(edge - 0.5, edge - 1e-9, edge, edge + 1e-9, edge + 0.5);
      }

      for (const elapsed of samples) {
        expect(
          coverOpacity(elapsed, timings, 0),
          `opacity diverged at ${elapsed} ms (${label})`,
        ).toBe(shippedOpacity(elapsed, reducedMotion));
      }
    });

    it(`ends after exactly the shipped duration (${label})`, () => {
      const timings = forwardCoverTimings(reducedMotion);
      expect(timings.in + timings.hold + timings.out).toBe(shippedDuration(reducedMotion));
    });

    it(`never extends its hold, whatever readiness reports (${label})`, () => {
      const timings = forwardCoverTimings(reducedMotion);
      // The forward call site passes no `maxHoldMs`, so the cap is 0. Even with
      // `ready` false for the whole run — the state the reverse cover waits in —
      // the extra hold has to stay at zero.
      let extra = 0;
      for (let ms = 0; ms <= 5_000; ms += 1) {
        extra = heldExtra(ms, timings, extra, false, 0);
        expect(extra).toBe(0);
      }
    });
  }

  it('keeps the published constants', () => {
    expect([COVER_IN_MS, COVER_HOLD_MS, COVER_OUT_MS]).toEqual([380, 90, 400]);
    expect(REDUCED_COVER).toEqual({ in: 32, hold: 16, out: 32 });
    expect(coverTimings('forward', false)).toEqual({ in: 380, hold: 90, out: 400 });
  });
});

describe('return cover', () => {
  it('is fully opaque from the first frame, so no un-drawn room is ever shown', () => {
    const timings = returnCoverTimings(false);
    expect(timings.in).toBe(0);
    expect(coverOpacity(0, timings, 0)).toBe(1);
  });

  it('holds while the room is undrawn and releases the moment it reports', () => {
    const timings = returnCoverTimings(false);
    const cap = 4_000;

    // Undrawn: opaque for as long as it takes.
    let extra = 0;
    for (let ms = 0; ms <= 2_500; ms += 10) {
      extra = heldExtra(ms, timings, extra, false, cap);
      expect(coverOpacity(ms, timings, extra)).toBe(1);
    }
    expect(extra).toBe(2_500);

    // Drawn at 2.5 s: the hold freezes there and the fade runs from that point,
    // so the room is revealed over the normal 400 ms rather than popping in.
    const frozen = heldExtra(3_000, timings, extra, true, cap);
    expect(frozen).toBe(2_500);
    expect(coverOpacity(2_500, timings, frozen)).toBe(1);
    expect(coverOpacity(2_700, timings, frozen)).toBeLessThan(1);
    expect(coverOpacity(2_900, timings, frozen)).toBe(0);
  });

  it('caps the wait, so a room that never draws degrades instead of locking', () => {
    const timings = returnCoverTimings(false);
    const cap = 4_000;

    let extra = 0;
    for (let ms = 0; ms <= 30_000; ms += 25) {
      extra = heldExtra(ms, timings, extra, false, cap);
    }
    expect(extra).toBe(cap);
    // Uncovered by cap + out, whatever the canvas is doing.
    expect(coverOpacity(cap + timings.out, timings, extra)).toBe(0);
  });

  it('never runs its hold backwards while frames arrive out of order', () => {
    const timings = returnCoverTimings(false);
    let extra = 0;
    let previous = 0;
    for (const ms of [0, 120, 90, 400, 380, 900, 850, 1_500]) {
      extra = heldExtra(ms, timings, extra, false, 4_000);
      expect(extra).toBeGreaterThanOrEqual(previous);
      previous = extra;
    }
  });

  it('still fades out under reduced motion, just inside two frames', () => {
    const timings = returnCoverTimings(true);
    expect(timings.in).toBe(0);
    expect(timings.out).toBe(REDUCED_COVER.out);
  });
});
