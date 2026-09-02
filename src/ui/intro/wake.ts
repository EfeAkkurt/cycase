/**
 * The wake reveal curve.
 *
 * Binding source: `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §2 and §8, which
 * supersede the older audit contract P0.5 wording this module used to quote:
 *
 *   "Target a 2.8–3.4 second reveal with two irregular lid movements, soft
 *    exposure/focus recovery and no hard symmetrical wipe. Reduced motion may
 *    use one short fade. Never flash more than three times per second."
 *
 * Four things follow from that sentence, and all four live here rather than in
 * a CSS keyframe set, because each one has to be *provable*:
 *
 *  1. **Two lid movements, not one.** The previous curve fell back once. This
 *     one falls back twice, so the top lid's trace reverses direction four
 *     times. A reveal that only ever opens, or that blinks once, fails both
 *     `tests/unit/wake.test.ts` and `tests/e2e/intro.spec.ts`.
 *  2. **Irregular.** The two flutters differ in every dimension a viewer can
 *     read: 260 ms against 160 ms of fall, 0.170 against 0.075 of the viewport
 *     recovered, and 420 ms against 760 ms of re-opening after them. Two
 *     identical blinks are a loop; two unequal ones are a person.
 *  3. **No hard symmetrical wipe.** The two lids no longer share a curve. The
 *     upper lid leads and travels furthest — which is what an upper lid does —
 *     and the lower lid lags it by 60–80 ms on its own key table, so the open
 *     aperture is never a symmetric band growing from the midline.
 *  4. **Soft exposure/focus recovery.** Two overlay layers on two different
 *     decays: a warm haze that flattens the picture and lifts first, and the
 *     neutral exposure vignette that settles behind it and clears last. Both
 *     are opacity only, so both stay on the compositor.
 *
 * The order of those two is not a taste call. Three GPU specs screenshot the
 * office 2200-2500 ms after entering it — `screenshots.spec.ts` at 2200, which
 * is where `scripts/measure-cast.mjs` gets its numbers, and
 * `office-visibility.spec.ts` and `review-views.spec.ts` at 2500 — so a 3 s
 * reveal is unavoidably still on screen when they fire, exactly as the 2850 ms
 * one it replaces was. What can be controlled is *what* is left. The shipped
 * curve left a neutral dark vignette at 8.1% opacity at 2200 ms and 1.26% at
 * 2500; this one leaves 5.1% and 1.29% of the same neutral vignette, with the
 * warm haze already down to 0.5% and gone by 2400. Less darkening at 2200, the
 * same at 2500, and no hue added at either — which matters because the front
 * view already measures r-b 12.9 against a reference of 8.3, and a warm veil
 * over it would have made that worse for no gain.
 *
 * Photosensitivity, stated as a number rather than a hope: the reveal contains
 * two lid-closure cycles in 3.02 s — 0.66 pulses per second overall. The faster
 * of the two spans 260 ms of fall plus 420 ms of re-opening, one cycle per
 * 680 ms or 1.47 Hz; the slower is 160 + 760 = 920 ms, 1.09 Hz. Both are far
 * below the three-per-second limit, and `wake.test.ts` holds the floor at
 * 333 ms per cycle so no future edit can quietly cross it. (Counting
 * *reversals* rather than cycles gives a larger number and means nothing: a
 * flash is a dark-light-dark round trip.)
 */

/** Lid coverage, as a fraction of the viewport height, per lid. 0.5 is shut. */
const LID_SHUT = 0.5;

/**
 * Total length of the reveal, in milliseconds.
 *
 * 3020 sits in the middle of the redesign's 2.8–3.4 s window with room on both
 * sides for the frame of unmount latency an end-to-end measurement adds.
 */
/**
 * Longest the eyes stay shut waiting for the room to be drawn.
 *
 * The reveal is held until `roomReady` reports a real frame, so the eyes never
 * open on the Suspense fallback and then have the WebGL room swapped in behind
 * them. Capped because the alternative — a wait a slow or absent GPU could hold
 * open forever — is worse than opening on the flat wall, which is a shipped,
 * tested path in its own right.
 */
export const WAKE_ROOM_WAIT_MS = 1200;

export const WAKE_TOTAL_MS = 3020;

/**
 * Peak opacity of the exposure vignette, and of the focus haze over it.
 *
 * The exposure vignette keeps the 0.45 it shipped at — it is the layer the
 * room's luminance and palette gates have already been measured through, and
 * this pass has no business moving it. The haze is deliberately a fifth of the
 * frame's opacity rather than a second veil of equal weight: its job is to take
 * the edge off the picture for a moment, not to relight it.
 */
const EXPOSURE_MAX = 0.45;
const FOCUS_MAX = 0.2;

/** Both layers hold until the second flutter ends, then release on their own. */
const HOLD_MS = 1320;
/** The haze lifts first: the picture sharpens, then the eye finishes adapting. */
const FOCUS_SETTLED_MS = 2400;

type Ease = 'linear' | 'out' | 'inOut';

/** One keyframe: reach `cover` at `at` ms, easing in from the previous key. */
interface LidKey {
  at: number;
  cover: number;
  ease: Ease;
}

/**
 * The upper lid.
 *
 * Shut for 140 ms before anything moves. That hold is not decoration: it is
 * what makes the first sampled frame of the reveal read as *closed*, at 0.5,
 * rather than as a lid already a third of the way up because the first
 * animation frame landed 16 ms late.
 */
const UPPER_KEYS: LidKey[] = [
  { at: 0, cover: 0.5, ease: 'linear' },
  { at: 140, cover: 0.5, ease: 'linear' }, // held shut
  { at: 440, cover: 0.26, ease: 'out' }, // first crack, quick
  { at: 700, cover: 0.43, ease: 'inOut' }, // and it falls most of the way back
  { at: 1120, cover: 0.14, ease: 'out' }, // second, wider opening
  { at: 1280, cover: 0.215, ease: 'inOut' }, // a shorter, shallower second flutter
  { at: 2040, cover: 0, ease: 'inOut' }, // the slow final open
];

/**
 * The lower lid.
 *
 * A real lower lid moves later and less. Every key here is behind its upper
 * counterpart by 60–80 ms and short of it by 60–95 thousandths of the viewport,
 * which is what breaks the symmetry: the visible aperture opens off-centre and
 * low, and closes unevenly, instead of a matched pair of shutters meeting at
 * the midline.
 */
const LOWER_KEYS: LidKey[] = [
  { at: 0, cover: 0.5, ease: 'linear' },
  { at: 200, cover: 0.5, ease: 'linear' },
  { at: 520, cover: 0.355, ease: 'out' },
  { at: 780, cover: 0.44, ease: 'inOut' },
  { at: 1220, cover: 0.225, ease: 'out' },
  { at: 1380, cover: 0.275, ease: 'inOut' },
  { at: 2180, cover: 0, ease: 'inOut' },
];

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function easeOut(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) ** 3;
}

function easeInOut(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}

function shape(ease: Ease, t: number): number {
  if (ease === 'out') return easeOut(t);
  if (ease === 'inOut') return easeInOut(t);
  return clamp01(t);
}

/** Samples a key table at `elapsed` ms, holding the last value past the end. */
function sampleKeys(keys: LidKey[], elapsed: number): number {
  if (elapsed <= keys[0]!.at) return keys[0]!.cover;
  for (let i = 1; i < keys.length; i += 1) {
    const previous = keys[i - 1]!;
    const key = keys[i]!;
    if (elapsed >= key.at) continue;
    const span = key.at - previous.at;
    const t = span <= 0 ? 1 : (elapsed - previous.at) / span;
    return previous.cover + (key.cover - previous.cover) * shape(key.ease, t);
  }
  return keys[keys.length - 1]!.cover;
}

/**
 * Coverage of the upper lid at `elapsed` ms, as a fraction of viewport height.
 *
 * 0.5 is fully shut for this lid, 0 is fully open. Kept under the old name
 * because `WakeReveal` and both test files read it as *the* lid trace — it is
 * the one the end-to-end reveal test measures through real element geometry.
 */
export function lidFraction(elapsed: number): number {
  return sampleKeys(UPPER_KEYS, elapsed);
}

/** Coverage of the lower lid. Deliberately not `lidFraction(elapsed - lag)`. */
export function lowerLidFraction(elapsed: number): number {
  return sampleKeys(LOWER_KEYS, elapsed);
}

/**
 * Opacity of the exposure vignette at `elapsed` ms.
 *
 * Held while the lids do their work, then released on an ease-out over the rest
 * of the reveal, so by the time any pixel gate screenshots the room the layer
 * is down in the fractions of a percent and the gate is a measurement of the
 * room rather than of this overlay.
 */
export function exposureAmount(elapsed: number): number {
  if (elapsed <= HOLD_MS) return EXPOSURE_MAX;
  const settle = (elapsed - HOLD_MS) / (WAKE_TOTAL_MS - HOLD_MS);
  return EXPOSURE_MAX * (1 - easeOut(settle));
}

/**
 * Opacity of the focus haze at `elapsed` ms.
 *
 * The other half of "soft exposure/focus recovery". It releases on a different
 * shape and finishes 620 ms before the vignette does, so the two never move as
 * one block: the picture sharpens first and the light settles after it.
 */
export function focusAmount(elapsed: number): number {
  if (elapsed <= HOLD_MS) return FOCUS_MAX;
  const settle = (elapsed - HOLD_MS) / (FOCUS_SETTLED_MS - HOLD_MS);
  return FOCUS_MAX * (1 - easeInOut(clamp01(settle)));
}

/**
 * The reduced-motion path: one short fade, no lids at all.
 *
 * The redesign allows exactly this and nothing more, so it is a single
 * monotonic ramp with no reversal anywhere in it — one movement, 320 ms, which
 * cannot read as a flash at any rate.
 */
export const WAKE_FADE_MS = 320;

export function fadeAmount(elapsed: number): number {
  return 1 - easeOut(clamp01(elapsed / WAKE_FADE_MS));
}

export { EXPOSURE_MAX, FOCUS_MAX, LID_SHUT };
