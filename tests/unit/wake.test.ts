import { describe, expect, it } from 'vitest';

import {
  EXPOSURE_MAX,
  FOCUS_MAX,
  LID_SHUT,
  WAKE_FADE_MS,
  WAKE_TOTAL_MS,
  exposureAmount,
  fadeAmount,
  focusAmount,
  lidFraction,
  lowerLidFraction,
} from '../../src/ui/intro/wake';

/**
 * The first-person wake reveal, checked where it can actually be run.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §2 states the contract:
 *
 *   "Target a 2.8–3.4 second reveal with two irregular lid movements, soft
 *    exposure/focus recovery and no hard symmetrical wipe. Reduced motion may
 *    use one short fade. Never flash more than three times per second."
 *
 * `tests/e2e/intro.spec.ts` measures the same curve through real element
 * geometry in a browser, which is the proof that the DOM carries what this
 * module computes. This file is the proof that what it computes is the
 * contract — five separate claims, none of which needs a GPU, a browser or a
 * free port to check.
 *
 * The reversal counter below is deliberately the same algorithm, with the same
 * epsilon, that the end-to-end test runs over sampled lid geometry. If the two
 * ever disagree, the disagreement is about the DOM rather than about the shape.
 */

/** Matches `tests/e2e/intro.spec.ts`: a move under this is not a direction. */
const EPSILON = 0.005;

/** A sampled turning point: where the lid stopped and which way it then went. */
interface Turn {
  at: number;
  cover: number;
  /** +1 when the lid started closing again, -1 when it started opening. */
  direction: number;
}

function sample(curve: (t: number) => number, stepMs = 4): { at: number; cover: number }[] {
  const out: { at: number; cover: number }[] = [];
  for (let t = 0; t <= WAKE_TOTAL_MS; t += stepMs) out.push({ at: t, cover: curve(t) });
  return out;
}

/**
 * Direction changes, and where they happened.
 *
 * `reference` only advances on an accepted move, so a slow drift accumulates
 * rather than being filtered out — the same hysteresis-free accumulation the
 * browser test relies on to avoid inventing reversals out of sub-pixel noise.
 */
function turns(samples: { at: number; cover: number }[]): Turn[] {
  const found: Turn[] = [];
  let direction = 0;
  let reference = samples[0]!.cover;
  let referenceAt = samples[0]!.at;

  for (const point of samples) {
    const delta = point.cover - reference;
    if (Math.abs(delta) < EPSILON) continue;
    const next = delta > 0 ? 1 : -1;
    if (direction !== 0 && next !== direction) {
      found.push({ at: referenceAt, cover: reference, direction: next });
    }
    direction = next;
    reference = point.cover;
    referenceAt = point.at;
  }

  return found;
}

describe('wake reveal curve', () => {
  it('lasts 2.8–3.4 s, the window the redesign asks for', () => {
    expect(WAKE_TOTAL_MS).toBeGreaterThanOrEqual(2800);
    expect(WAKE_TOTAL_MS).toBeLessThanOrEqual(3400);
  });

  it('starts shut and ends fully open, on both lids', () => {
    expect(lidFraction(0)).toBe(LID_SHUT);
    expect(lowerLidFraction(0)).toBe(LID_SHUT);
    // Still shut on the first animation frame, whenever it lands.
    expect(lidFraction(16)).toBe(LID_SHUT);
    expect(lidFraction(WAKE_TOTAL_MS)).toBe(0);
    expect(lowerLidFraction(WAKE_TOTAL_MS)).toBe(0);
    // And open well before the reveal ends, so the room is seen, not glimpsed.
    expect(lidFraction(WAKE_TOTAL_MS - 700)).toBe(0);
    expect(lowerLidFraction(WAKE_TOTAL_MS - 700)).toBe(0);
  });

  it('makes two lid movements — the upper lid reverses exactly four times', () => {
    const found = turns(sample(lidFraction));
    expect(
      found.length,
      `upper lid reversed ${found.length} times; two re-closes is four reversals`,
    ).toBe(4);

    // Down, up, down, up, down: the reversals alternate, starting with a close.
    expect(found.map((turn) => turn.direction)).toEqual([1, -1, 1, -1]);
  });

  it('makes those two movements irregular rather than a repeated loop', () => {
    const found = turns(sample(lidFraction));
    const [firstClose, firstOpen, secondClose, secondOpen] = found;

    const firstRebound = firstOpen!.cover - firstClose!.cover;
    const secondRebound = secondOpen!.cover - secondClose!.cover;

    // Both re-closes read as a blink rather than as jitter...
    expect(firstRebound).toBeGreaterThanOrEqual(0.05);
    expect(secondRebound).toBeGreaterThanOrEqual(0.05);
    // ...and they are not the same blink twice.
    expect(
      Math.abs(firstRebound - secondRebound),
      `rebounds ${firstRebound.toFixed(3)} and ${secondRebound.toFixed(3)} are too alike`,
    ).toBeGreaterThanOrEqual(0.04);

    const firstFall = firstOpen!.at - firstClose!.at;
    const secondFall = secondOpen!.at - secondClose!.at;
    expect(
      Math.abs(firstFall - secondFall),
      `falls of ${firstFall} ms and ${secondFall} ms are too alike`,
    ).toBeGreaterThanOrEqual(40);
  });

  it('never flashes faster than three times a second', () => {
    const found = turns(sample(lidFraction));
    const samples = sample(lidFraction);

    /*
     * A flash is a dark→light→dark round trip, not a single reversal. One
     * closure cycle therefore runs from the moment the lid starts falling to
     * the moment it has finished re-opening — the next closure for the first
     * flutter, and the lid reaching zero for the second.
     */
    const openAt = samples.find((point) => point.cover === 0)!.at;
    const boundaries = [...found.map((turn) => turn.at), openAt];
    const cycles: number[] = [];
    for (let i = 0; i + 2 < boundaries.length; i += 2) {
      cycles.push(boundaries[i + 2]! - boundaries[i]!);
    }

    expect(cycles).toHaveLength(2);
    for (const cycle of cycles) {
      expect(cycle, `a lid cycle took only ${cycle} ms (${(1000 / cycle).toFixed(2)} Hz)`,
      ).toBeGreaterThanOrEqual(333);
    }

    // And the whole reveal contains two closures, not a train of them.
    const closures = found.filter((turn) => turn.direction === 1);
    expect(closures).toHaveLength(2);
    expect(
      (closures.length * 1000) / WAKE_TOTAL_MS,
      'the reveal averages more than three pulses a second',
    ).toBeLessThan(3);
  });

  it('is not a symmetrical wipe: the lids run different curves', () => {
    let widest = 0;
    let widestAt = 0;
    for (let t = 0; t <= WAKE_TOTAL_MS; t += 4) {
      const gap = Math.abs(lidFraction(t) - lowerLidFraction(t));
      if (gap > widest) {
        widest = gap;
        widestAt = t;
      }
    }
    expect(
      widest,
      `the lids never differ by more than ${widest.toFixed(3)} (at ${widestAt} ms)`,
    ).toBeGreaterThanOrEqual(0.05);

    /*
     * Nor is the lower lid the upper one on a delay, which would still read as
     * a matched pair. For every lag a viewer could perceive as a lag, the two
     * traces stay materially apart.
     */
    for (let lag = 0; lag <= 500; lag += 10) {
      let apart = 0;
      for (let t = 0; t <= WAKE_TOTAL_MS; t += 8) {
        apart = Math.max(apart, Math.abs(lidFraction(t - lag) - lowerLidFraction(t)));
      }
      expect(apart, `the lower lid is the upper one delayed by ${lag} ms`).toBeGreaterThanOrEqual(
        0.03,
      );
    }

    // The upper lid does more of the work: it opens further and finishes first.
    const window = (curve: (t: number) => number) => {
      let lowest = Number.POSITIVE_INFINITY;
      for (let t = 400; t <= 1800; t += 4) lowest = Math.min(lowest, curve(t));
      return lowest;
    };
    expect(window(lidFraction)).toBeLessThan(window(lowerLidFraction));

    const settles = (curve: (t: number) => number) => {
      for (let t = 0; t <= WAKE_TOTAL_MS; t += 4) if (curve(t) === 0) return t;
      return Number.POSITIVE_INFINITY;
    };
    expect(settles(lidFraction)).toBeLessThan(settles(lowerLidFraction));
  });

  it('never asks the two lids to cover more than the viewport', () => {
    for (let t = 0; t <= WAKE_TOTAL_MS; t += 4) {
      const covered = lidFraction(t) + lowerLidFraction(t);
      expect(covered, `lids cover ${covered.toFixed(3)} of the viewport at ${t} ms`).toBeLessThanOrEqual(
        1 + 1e-9,
      );
    }
  });

  it('recovers exposure and focus on two different decays', () => {
    expect(exposureAmount(0)).toBe(EXPOSURE_MAX);
    expect(focusAmount(0)).toBe(FOCUS_MAX);

    // Neither layer ever gets darker again.
    let previousExposure = Number.POSITIVE_INFINITY;
    let previousFocus = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= WAKE_TOTAL_MS; t += 4) {
      const exposure = exposureAmount(t);
      const focus = focusAmount(t);
      expect(exposure).toBeLessThanOrEqual(previousExposure + 1e-9);
      expect(focus).toBeLessThanOrEqual(previousFocus + 1e-9);
      previousExposure = exposure;
      previousFocus = focus;
    }

    // Both are gone by the end, and the neutral vignette is the one that lingers.
    expect(exposureAmount(WAKE_TOTAL_MS)).toBeCloseTo(0, 6);
    expect(focusAmount(WAKE_TOTAL_MS)).toBeCloseTo(0, 6);

    const clearedAt = (layer: (t: number) => number) => {
      for (let t = 0; t <= WAKE_TOTAL_MS; t += 4) if (layer(t) < 1e-6) return t;
      return Number.POSITIVE_INFINITY;
    };
    const exposureCleared = clearedAt(exposureAmount);
    const focusCleared = clearedAt(focusAmount);
    expect(
      focusCleared,
      `haze cleared at ${focusCleared} ms, exposure at ${exposureCleared} ms`,
    ).toBeLessThan(exposureCleared);
    expect(exposureAmount(focusCleared)).toBeGreaterThan(0);

    /*
     * And the tail is small where it is actually measured. Three GPU specs
     * screenshot the office 2200-2500 ms after entry, so the reveal is still
     * mounted when they fire — as the 2850 ms curve this replaces also was. The
     * warm haze must be effectively gone by then, because the front view
     * already measures r-b 12.9 against a reference of 8.3 and a warm veil over
     * it would push that further out; the neutral vignette left behind is held
     * at or below what shipped.
     */
    expect(focusAmount(2200), 'warm haze still tinting the 2200 ms capture').toBeLessThan(0.01);
    expect(focusAmount(2500)).toBe(0);
    expect(exposureAmount(2200), 'darker at 2200 ms than the curve it replaces').toBeLessThan(
      0.081,
    );
    expect(exposureAmount(2500)).toBeLessThan(0.015);

    // The exposure starts releasing while the lids are still settling, so the
    // reveal is one movement rather than "lids, then brightness".
    expect(exposureAmount(1600)).toBeLessThan(EXPOSURE_MAX);
    expect(lidFraction(1600)).toBeGreaterThan(0);
  });
});

describe('reduced-motion wake fade', () => {
  it('is one short movement, with no reversal in it', () => {
    expect(WAKE_FADE_MS).toBeGreaterThan(0);
    expect(WAKE_FADE_MS).toBeLessThanOrEqual(600);
    expect(fadeAmount(0)).toBe(1);
    expect(fadeAmount(WAKE_FADE_MS)).toBe(0);
    expect(fadeAmount(WAKE_FADE_MS * 4)).toBe(0);

    let previous = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= WAKE_FADE_MS; t += 2) {
      const value = fadeAmount(t);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });
});
