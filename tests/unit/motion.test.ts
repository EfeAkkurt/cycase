import { describe, expect, it } from 'vitest';

import {
  ALARM_PULSE_HELD,
  ALARM_PULSE_MS,
  alarmPhase,
  alarmRange,
  nextAlarmPeakMs,
  phaseSkewMs,
} from '../../src/three/alarmPulse';
import {
  AMBIENT_INTERVAL_MS,
  CONTINUOUS_MAX_INTERVAL_MS,
  frameIntervalMs,
  officeFrameMode,
} from '../../src/three/officeFrames';
import {
  ACK_HOLD_MS,
  ACK_PRESS_MS,
  ACK_SETTLE_END_MS,
  ACK_SPILL_DECAY_MS,
  ACK_TOTAL_MS,
  ackIsRunning,
  ackSpillFactor,
  ackStageAt,
} from '../../src/ui/office/acknowledgeBundle';
import {
  GLYPH_MS,
  WORD_PAUSE_MS,
  planTypewriter,
  typewriterDuration,
} from '../../src/ui/intro/typewriter';
import {
  COVER_HOLD_MS,
  COVER_IN_MS,
  COVER_OUT_MS,
  coverOpacity,
  forwardCoverTimings,
} from '../../src/ui/intro/coverTimeline';
import {
  CENTRE_ORIGIN,
  resetTransitionOrigin,
  setTransitionOriginFrom,
  transitionOrigin,
} from '../../src/ui/office/transitionOrigin';
import { WAKE_ROOM_WAIT_MS, WAKE_TOTAL_MS } from '../../src/ui/intro/wake';
import { filterVoices, localeRank, rankVoices } from '../../src/audio/voiceList';
import { utteranceBudgetMs } from '../../src/audio/speech';
import type { VoiceOption } from '../../src/audio/speech';
import { readFileSync } from 'node:fs';

/**
 * The motion contract, as arithmetic.
 *
 * Everything here is a pure function on purpose. Frame cadence and pixel
 * brightness need a real GPU — the Playwright config says so itself and keeps
 * the 3D specs in their own project — but the *rules* that decide them are
 * ordinary logic, and every defect this phase fixed lived in the rule rather
 * than in the renderer.
 */

/* ------------------------------------------------------------------ */

describe('one alarm clock', () => {
  it('is a raised cosine: dimmest at the start of the cycle, brightest halfway', () => {
    expect(alarmPhase(0)).toBeCloseTo(0, 6);
    expect(alarmPhase(ALARM_PULSE_MS / 2)).toBeCloseTo(1, 6);
    expect(alarmPhase(ALARM_PULSE_MS)).toBeCloseTo(0, 6);
    // Symmetric about the peak, which is what makes it read as a lamp rather
    // than as a ramp with a corner in it.
    expect(alarmPhase(400)).toBeCloseTo(alarmPhase(1200), 6);
  });

  it('repeats exactly, however far from the time origin the page has run', () => {
    for (const t of [0, 37, 512.5, 1599.9]) {
      for (const cycles of [1, 10, 1000]) {
        expect(alarmPhase(t + cycles * ALARM_PULSE_MS)).toBeCloseTo(alarmPhase(t), 6);
      }
    }
  });

  it('holds the midpoint under reduced motion, on every surface', () => {
    // The CSS rule freezes the border at the same 0.5 by writing the midpoint
    // alpha directly; if this value moves, that rule has to move with it.
    expect(ALARM_PULSE_HELD).toBe(0.5);
    for (const t of [0, 250, 800, 1599]) {
      expect(alarmPhase(t, true)).toBe(0.5);
    }
  });

  it('drives a range without letting the shape live in two places', () => {
    const range = { min: 0.36, max: 0.82 };
    expect(alarmRange(0, range)).toBeCloseTo(range.min, 6);
    expect(alarmRange(ALARM_PULSE_MS / 2, range)).toBeCloseTo(range.max, 6);
    expect(alarmRange(123, range, true)).toBeCloseTo((range.min + range.max) / 2, 6);
  });

  /**
   * The heart of it.
   *
   * The DOM border is a CSS keyframe anchored to the document timeline's origin
   * and the room's rim is a cosine evaluated per frame off `performance.now()`.
   * The two share a time origin, so the keyframe's local time at instant `t` is
   * `t` — and both surfaces are therefore at the same point in the same cycle
   * by construction rather than by tuning. The browser half of this is measured
   * in `tests/e2e/motion.spec.ts`, which reads the animation's own painted
   * phase; this is the arithmetic it relies on.
   */
  it('puts an origin-anchored keyframe on the same phase the room is drawing', () => {
    for (const now of [0, 1, 400, 800, 1599.4, 12_345.6, 3_600_000 + 77]) {
      // Local time of an animation started at timeline 0, as a fraction.
      const cssProgress = ((now % ALARM_PULSE_MS) + ALARM_PULSE_MS) % ALARM_PULSE_MS;
      const roomProgress = ((now % ALARM_PULSE_MS) + ALARM_PULSE_MS) % ALARM_PULSE_MS;

      expect(phaseSkewMs(cssProgress / ALARM_PULSE_MS, roomProgress / ALARM_PULSE_MS)).toBe(0);
      // And the phase the room actually applies is a function of that fraction
      // alone, so there is nothing else for the two to disagree about.
      expect(alarmPhase(now)).toBeCloseTo(alarmPhase(cssProgress), 9);
    }
  });

  it('measures skew the short way round the cycle', () => {
    // 0.98 and 0.02 are two hundredths apart, not ninety-six.
    expect(phaseSkewMs(0.98, 0.02)).toBeCloseTo(0.04 * ALARM_PULSE_MS, 6);
    expect(phaseSkewMs(0.5, 0.5)).toBe(0);
  });

  it('agrees on when the next peak is, from any starting point', () => {
    for (const now of [0, 100, 799, 800, 801, 5_000.5]) {
      const peak = nextAlarmPeakMs(now);
      expect(peak).toBeGreaterThanOrEqual(now);
      expect(peak - now).toBeLessThanOrEqual(ALARM_PULSE_MS);
      expect(alarmPhase(peak)).toBeCloseTo(1, 6);
    }
  });

  it('pulses far below the photosensitivity threshold', () => {
    // One full brighten-and-dim per period. WCAG 2.3.1's general threshold is
    // three flashes a second; this is well under one.
    const hz = 1000 / ALARM_PULSE_MS;
    expect(hz).toBeLessThan(3);
    expect(hz).toBeLessThan(1);
  });
});

/* ------------------------------------------------------------------ */

describe('how hard the room is drawn', () => {
  const idle = {
    alarm: false,
    entering: false,
    gesturing: false,
    colleagueVisible: false,
    reducedMotion: false,
  };

  it('draws continuously while the alarm is pulsing', () => {
    // This is the defect: the driver keyed on the walk alone, so a pulsing
    // alarm was redrawn ten times a second next to a DOM border running at the
    // display's rate.
    expect(officeFrameMode({ ...idle, alarm: true })).toBe('continuous');
    expect(frameIntervalMs('continuous')).toBeLessThanOrEqual(33);
    expect(CONTINUOUS_MAX_INTERVAL_MS).toBeLessThanOrEqual(33);
  });

  it('draws continuously for the walk and for the gesture', () => {
    expect(officeFrameMode({ ...idle, entering: true })).toBe('continuous');
    expect(officeFrameMode({ ...idle, gesturing: true })).toBe('continuous');
  });

  /*
   * Presence is not movement, and the difference is the whole ambient budget.
   *
   * `colleagueVisible` used to force continuous frames on its own. She never
   * leaves the room, so the office rendered at display rate for the entire
   * time a player spent in it: §7's ambient cadence was unreachable in the
   * played flow, and the rAF-versus-render guard had nowhere left to measure a
   * parked room. What the eye tracks is the walk and the gesture, and both end.
   */
  it('goes back to ambient once she is settled and still', () => {
    expect(officeFrameMode({ ...idle, colleagueVisible: true })).toBe('ambient');
    expect(
      officeFrameMode({ ...idle, colleagueVisible: true, gesturing: false, entering: false }),
    ).toBe('ambient');
  });

  it('still draws hard for her while anything about her is moving', () => {
    expect(officeFrameMode({ ...idle, colleagueVisible: true, entering: true })).toBe('continuous');
    expect(officeFrameMode({ ...idle, colleagueVisible: true, gesturing: true })).toBe('continuous');
    expect(officeFrameMode({ ...idle, colleagueVisible: true, alarm: true })).toBe('continuous');
  });

  it('keeps demand rendering for an empty, quiet room', () => {
    expect(officeFrameMode(idle)).toBe('ambient');
    expect(frameIntervalMs('ambient')).toBe(AMBIENT_INTERVAL_MS);
    // §7's ambient budget: 5–10 FPS, not 60.
    expect(1000 / AMBIENT_INTERVAL_MS).toBeLessThanOrEqual(10);
  });

  it('draws once and stops under reduced motion, whatever else is happening', () => {
    for (const motion of [
      { ...idle, reducedMotion: true },
      { ...idle, reducedMotion: true, alarm: true },
      { ...idle, reducedMotion: true, entering: true, colleagueVisible: true },
    ]) {
      expect(officeFrameMode(motion)).toBe('static');
    }
    expect(frameIntervalMs('static')).toBe(Infinity);
  });
});

/* ------------------------------------------------------------------ */

describe('the acknowledge bundle', () => {
  it('meets every budget the contract states', () => {
    expect(ACK_PRESS_MS).toBeLessThanOrEqual(100);
    expect(ACK_SPILL_DECAY_MS).toBeGreaterThanOrEqual(150);
    expect(ACK_SPILL_DECAY_MS).toBeLessThanOrEqual(220);
    expect(ACK_HOLD_MS).toBeGreaterThanOrEqual(600);
    expect(ACK_HOLD_MS).toBeLessThanOrEqual(900);
  });

  it('runs press, then settle, then a short acknowledged state', () => {
    expect(ackStageAt(-1)).toBe('idle');
    expect(ackStageAt(0)).toBe('pressed');
    expect(ackStageAt(ACK_PRESS_MS - 1)).toBe('pressed');
    expect(ackStageAt(ACK_PRESS_MS)).toBe('settling');
    expect(ackStageAt(ACK_SETTLE_END_MS - 1)).toBe('settling');
    expect(ackStageAt(ACK_SETTLE_END_MS)).toBe('acknowledged');
    expect(ackStageAt(ACK_TOTAL_MS - 1)).toBe('acknowledged');
    // And then it is over. A bundle that never ends is a state the room can
    // never leave.
    expect(ackStageAt(ACK_TOTAL_MS)).toBe('idle');
    expect(ackIsRunning(ACK_TOTAL_MS)).toBe(false);
  });

  it('lands the whole bundle inside a second', () => {
    expect(ACK_TOTAL_MS).toBeLessThanOrEqual(1000);
  });

  it('lets the spill fall rather than cutting it', () => {
    // Held through the press: the light does not start dying before the player
    // has seen their own press land.
    expect(ackSpillFactor(0)).toBe(1);
    expect(ackSpillFactor(ACK_PRESS_MS - 1)).toBe(1);

    // Monotonically down across the decay, and actually gone at the end.
    let previous = 1;
    for (let t = ACK_PRESS_MS; t < ACK_SETTLE_END_MS; t += 10) {
      const value = ackSpillFactor(t);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
    expect(ackSpillFactor(ACK_SETTLE_END_MS)).toBe(0);
    expect(ackSpillFactor(ACK_TOTAL_MS)).toBe(0);
  });

  it('has no ramp at all under reduced motion', () => {
    for (const t of [0, ACK_PRESS_MS, ACK_SETTLE_END_MS - 1]) {
      expect(ackSpillFactor(t, true)).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------ */

describe('the intro typewriter', () => {
  const LINES = ['03:17:42', 'Unauthorized session detected in the identity layer.', 'Ada, wake up.'];

  it('holds the contracted per-glyph rate once the rests are taken out', () => {
    const steps = planTypewriter(LINES);
    for (let index = 1; index < steps.length; index += 1) {
      const step = steps[index]!;
      const previous = steps[index - 1]!;
      // `at` is `glyph * GLYPH_MS + pause`, so removing the pause delta leaves
      // exactly the glyph time. That is what makes the cadence measurable
      // instead of an average polluted by the punctuation rests.
      const glyphTime = step.at - previous.at - (step.pause - previous.pause);
      expect(glyphTime).toBeCloseTo(GLYPH_MS, 6);
    }
  });

  it('rests longer after a question than after a comma', () => {
    const comma = planTypewriter(['a, b']);
    const question = planTypewriter(['a? b']);
    const commaRest = comma[2]!.pause - comma[1]!.pause;
    const questionRest = question[2]!.pause - question[1]!.pause;
    expect(questionRest).toBeGreaterThan(commaRest);
  });

  it('gives a long word a small rest and a short one none', () => {
    // "session " earns one; "in " does not — a rest after every two-letter word
    // reads as hesitation rather than as rhythm.
    const long = planTypewriter(['session x']);
    const short = planTypewriter(['in x']);
    expect(long.at(-1)!.pause).toBe(WORD_PAUSE_MS);
    expect(short.at(-1)!.pause).toBe(0);
  });

  it('never rests inside the clock', () => {
    // A pause between the digits of `03:17:42` reads as a stutter.
    const clock = planTypewriter(['03:17:42']);
    expect(clock.at(-1)!.pause).toBe(0);
  });

  it('clusters key clicks around words instead of firing every third glyph', () => {
    const steps = planTypewriter(['Unauthorized session detected']);
    const clicks = steps.filter((step) => step.sound).length;
    // Fewer clicks than glyphs, and more than one per word: the density follows
    // the text rather than a fixed counter.
    expect(clicks).toBeLessThan(steps.length);
    expect(clicks).toBeGreaterThan(3);
  });

  it('stays short enough that skipping it is a choice rather than a rescue', () => {
    expect(typewriterDuration(planTypewriter(LINES))).toBeLessThan(6_000);
  });
});

/* ------------------------------------------------------------------ */

describe('the voice list', () => {
  const voice = (name: string, lang: string, localService = true): VoiceOption => ({
    uri: `${name}-${lang}`,
    name,
    lang,
    localService,
  });

  const OS_ORDER = [
    voice('Amelie', 'fr-FR'),
    voice('Google UK English', 'en-GB', false),
    voice('Yelda', 'tr-TR'),
    voice('Daniel', 'en-GB'),
    voice('Alex', 'en-US'),
    voice('Zosia', 'pl-PL'),
  ];

  it('ranks a voice by how well it matches the copy on screen', () => {
    expect(localeRank(voice('Alex', 'en-US'), 'en')).toBe(0);
    expect(localeRank(voice('Daniel', 'en-GB'), 'en')).toBe(1);
    expect(localeRank(voice('Amelie', 'fr-FR'), 'en')).toBe(-1);
    expect(localeRank(voice('Yelda', 'tr-TR'), 'tr')).toBe(0);
  });

  it('puts the voices that can read this copy first, local before online', () => {
    const { recommended, other } = rankVoices(OS_ORDER, 'en');

    expect(recommended.map((entry) => entry.name)).toEqual([
      'Alex', // en-US, local — exactly what the automatic pick would choose
      'Daniel', // en-GB, local
      'Google UK English', // en-GB, but online
    ]);
    // Nothing is hidden: everything else is still there, and navigable.
    expect(other.map((entry) => entry.lang)).toEqual(['fr-FR', 'pl-PL', 'tr-TR']);
    expect(recommended.length + other.length).toBe(OS_ORDER.length);
  });

  it('recommends the Turkish voices when the copy is Turkish', () => {
    const { recommended } = rankVoices(OS_ORDER, 'tr');
    expect(recommended.map((entry) => entry.name)).toEqual(['Yelda']);
  });

  it('matches a search on either the name or the language tag', () => {
    expect(filterVoices(OS_ORDER, 'daniel').map((entry) => entry.name)).toEqual(['Daniel']);
    expect(filterVoices(OS_ORDER, 'EN-GB').map((entry) => entry.name)).toEqual([
      'Google UK English',
      'Daniel',
    ]);
    // An empty query is not a filter.
    expect(filterVoices(OS_ORDER, '   ')).toHaveLength(OS_ORDER.length);
  });
});

/* ------------------------------------------------------------------ */

describe('the utterance watchdog', () => {
  it('allows far longer than any engine would really take', () => {
    const line = 'The account behind it signed in twenty minutes ago from a new location.';
    const budget = utteranceBudgetMs(line);
    // A system voice lands near 14 characters a second; this assumes 7, so the
    // budget is roughly double the real thing plus a fixed floor.
    expect(budget).toBeGreaterThan((line.length / 14) * 1000 * 1.8);
  });

  it('grows with the line and shrinks with the rate, and never collapses', () => {
    expect(utteranceBudgetMs('a'.repeat(200))).toBeGreaterThan(utteranceBudgetMs('a'.repeat(20)));
    expect(utteranceBudgetMs('a'.repeat(100), 0.5)).toBeGreaterThan(
      utteranceBudgetMs('a'.repeat(100), 2),
    );
    // A pathological rate must not produce a watchdog that fires immediately.
    expect(utteranceBudgetMs('', 100)).toBeGreaterThanOrEqual(4_000);
  });
});

/* ------------------------------------------------------------------ */

describe('the stylesheet and the clock do not drift apart', () => {
  const css = readFileSync(new URL('../../src/styles/global.css', import.meta.url), 'utf8');

  it('animates the alarm border for exactly one pulse period', () => {
    // The duration exists twice — once as a TypeScript constant the room reads
    // per frame, once as a CSS custom property the keyframe reads. There is no
    // way to make CSS import the first, so this is the guard instead.
    const match = css.match(/--alarm-pulse-duration:\s*(\d+)ms/);
    expect(match, '--alarm-pulse-duration is missing from global.css').not.toBeNull();
    expect(Number(match![1])).toBe(ALARM_PULSE_MS);
  });

  it('shapes the keyframe like the cosine, dim at 0% and bright at 50%', () => {
    // If these were the other way round the border would run exactly half a
    // cycle out of phase with the room while passing every timing assertion.
    const frames = css.slice(css.indexOf('@keyframes alarm-border'));
    const zero = frames.indexOf('0.25');
    const half = frames.indexOf('0.9');
    expect(zero).toBeGreaterThan(-1);
    expect(half).toBeGreaterThan(-1);
    expect(zero).toBeLessThan(half);
  });

  it('holds the border at the same midpoint the room holds', () => {
    // 0.25 + (0.9 - 0.25) * 0.5 = 0.575.
    const held = 0.25 + (0.9 - 0.25) * ALARM_PULSE_HELD;
    expect(css).toContain(`rgb(226 96 78 / ${held})`);
  });

  it('never blocks input with a full-viewport layer', () => {
    // Every fixed, inset-0 overlay in the opening and the transition. A cover
    // that swallows a click is the "input blocked" defect, and it is one line
    // of CSS away at all times.
    for (const selector of ['.transition-cover', '.wake', '.fade-layer', '.eyelid']) {
      const rule = css.slice(css.indexOf(`${selector} {`));
      expect(rule.slice(0, rule.indexOf('}')), selector).toContain('pointer-events: none');
    }
  });
});

describe('office to dashboard', () => {
  it('crosses inside the 900 ms the contract allows', () => {
    const timings = forwardCoverTimings(false);
    const total = timings.in + timings.hold + timings.out;
    expect(total).toBe(COVER_IN_MS + COVER_HOLD_MS + COVER_OUT_MS);
    expect(total).toBeLessThanOrEqual(900);
  });

  it('is over in two frames under reduced motion', () => {
    const timings = forwardCoverTimings(true);
    expect(timings.in + timings.hold + timings.out).toBeLessThanOrEqual(100);
  });

  it('is fully opaque when the swap happens, so the cut is never seen', () => {
    const timings = forwardCoverTimings(false);
    expect(coverOpacity(timings.in, timings)).toBeCloseTo(1, 6);
    expect(coverOpacity(timings.in + timings.hold, timings)).toBeCloseTo(1, 6);
    expect(coverOpacity(timings.in + timings.hold + timings.out, timings)).toBeCloseTo(0, 6);
  });

  it('opens from the monitor that was activated', () => {
    resetTransitionOrigin();
    expect(transitionOrigin()).toEqual(CENTRE_ORIGIN);

    // A right-hand monitor, half way down a 1000x800 viewport.
    const stub = {
      getBoundingClientRect: () => ({ left: 700, top: 300, width: 200, height: 200 }),
    } as unknown as Element;
    const originalWidth = globalThis.window?.innerWidth;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { innerWidth: 1000, innerHeight: 800 },
    });

    setTransitionOriginFrom(stub);
    expect(transitionOrigin().x).toBeCloseTo(0.8, 6);
    expect(transitionOrigin().y).toBeCloseTo(0.5, 6);

    // A keyboard activation has no rectangle, and gets the middle rather than
    // a corner.
    setTransitionOriginFrom(null);
    expect(transitionOrigin()).toEqual(CENTRE_ORIGIN);

    if (originalWidth === undefined) delete (globalThis as { window?: unknown }).window;
    resetTransitionOrigin();
  });

  it('never holds the eyes shut longer than the reveal itself', () => {
    // A wait that outlasts the reveal would read as a hang rather than as a
    // beat, and the flat wall is a shipped path worth opening on.
    expect(WAKE_ROOM_WAIT_MS).toBeLessThan(WAKE_TOTAL_MS);
  });
});
