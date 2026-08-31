/**
 * The transition cover's opacity curve, as a pure function of elapsed time.
 *
 * Extracted from `TransitionCover` for one reason: the reverse cover (audit
 * P2 — "returning from dashboard to office remounts WebGL … the room is black
 * until the canvas is ready") reuses this component, and the forward
 * office-to-dashboard crossfade's timing must not move by a single
 * millisecond. A curve that is a pure function can be pinned by a unit test
 * with no DOM and no GPU, which is the only kind of proof available for it
 * here; a curve tangled up in a `requestAnimationFrame` loop cannot.
 *
 * `holdExtraMs` is the whole of the reverse cover's contribution. It is zero
 * on the forward path — by construction, not by convention: nothing but a
 * caller-supplied cap can raise it — so with it at zero every formula below is
 * the one that shipped.
 */

export const COVER_IN_MS = 380;
export const COVER_HOLD_MS = 90;
export const COVER_OUT_MS = 400;

/** Reduced motion still crosses the same three beats, just inside two frames. */
export const REDUCED_COVER = { in: 32, hold: 16, out: 32 } as const;

export interface CoverTimings {
  /** Fade to full opacity. */
  in: number;
  /** Minimum time held at full opacity. */
  hold: number;
  /** Fade back to nothing. */
  out: number;
}

export type CoverVariant = 'forward' | 'return';

export function easeIn(t: number): number {
  return t * t;
}

export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Office → dashboard. Unchanged, and pinned by `tests/unit/coverTimeline.test.ts`. */
export function forwardCoverTimings(reducedMotion: boolean): CoverTimings {
  return reducedMotion
    ? { in: REDUCED_COVER.in, hold: REDUCED_COVER.hold, out: REDUCED_COVER.out }
    : { in: COVER_IN_MS, hold: COVER_HOLD_MS, out: COVER_OUT_MS };
}

/**
 * Dashboard → office. No fade-in at all, deliberately.
 *
 * The office subtree and this cover are committed by React in the same pass,
 * so the browser's first paint of the returning office already carries the
 * cover. Fading *in* would mean rendering a partly transparent black over an
 * un-drawn WebGL canvas for the length of the fade — which is precisely the
 * black room the audit reported, just dimmer. There is nothing behind the
 * cover worth crossfading from: the dashboard has already been unmounted by
 * the time this mounts.
 */
export function returnCoverTimings(reducedMotion: boolean): CoverTimings {
  return { in: 0, hold: 0, out: reducedMotion ? REDUCED_COVER.out : COVER_OUT_MS };
}

export function coverTimings(variant: CoverVariant, reducedMotion: boolean): CoverTimings {
  return variant === 'return'
    ? returnCoverTimings(reducedMotion)
    : forwardCoverTimings(reducedMotion);
}

/**
 * Cover opacity at `elapsed` ms, clamped to 0..1.
 *
 * `holdExtraMs` extends the full-opacity hold and pushes the fade-out back by
 * the same amount; it never changes the shape of either fade.
 */
export function coverOpacity(
  elapsed: number,
  timings: CoverTimings,
  holdExtraMs = 0,
): number {
  const outStart = timings.in + timings.hold + holdExtraMs;

  let opacity: number;
  if (elapsed < timings.in) opacity = easeIn(elapsed / timings.in);
  else if (elapsed < outStart) opacity = 1;
  else opacity = 1 - easeOut(Math.min(1, (elapsed - outStart) / timings.out));

  return Math.min(1, Math.max(0, opacity));
}

/**
 * How long the cover has been held past its scheduled fade-out because the
 * destination has not reported itself drawn yet.
 *
 * Monotonic and capped, so a reveal can be late but never cancelled: when
 * `capMs` is 0 — every forward crossfade — this is always 0.
 */
export function heldExtra(
  elapsed: number,
  timings: CoverTimings,
  previousExtraMs: number,
  ready: boolean,
  capMs: number,
): number {
  if (capMs <= 0 || ready) return previousExtraMs;
  const scheduledOut = timings.in + timings.hold;
  return Math.min(capMs, Math.max(previousExtraMs, elapsed - scheduledOut));
}
