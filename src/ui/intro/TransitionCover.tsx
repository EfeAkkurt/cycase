import { useEffect, useRef, type CSSProperties } from 'react';

import { CENTRE_ORIGIN, transitionOrigin } from '../office/transitionOrigin';
import {
  coverOpacity,
  coverTimings,
  heldExtra,
  type CoverVariant,
} from './coverTimeline';

export {
  COVER_HOLD_MS,
  COVER_IN_MS,
  COVER_OUT_MS,
  type CoverVariant,
} from './coverTimeline';

/**
 * The scene cover, in both directions.
 *
 * **Forward — office to dashboard.** Audit contract P0.5: "Mount office and
 * dashboard concurrently during the transition. Fade to near-black, swap
 * focus/scene under the cover, then reveal the real dashboard. No status-text
 * interstitial." So this renders nothing but the cover. The swap it announces
 * at full opacity is the machine's `TRANSITION_DONE` plus the focus move —
 * both happen while the screen is black, which is what makes them a cut rather
 * than a jump.
 *
 * **Reverse — dashboard to office** (`variant="return"`). Audit P2: returning
 * remounts WebGL, and the room was black behind the projected monitor panels
 * until the canvas had drawn — about 2.5 seconds of a room that looks broken
 * rather than a transition that looks deliberate. The reverse cover starts
 * fully opaque and *stays* opaque until the caller sets `ready`, so the room is
 * revealed already drawn or not at all.
 *
 * The reverse variant is additive. `ready` defaults to true and `maxHoldMs` to
 * zero, which makes `heldExtra` return zero for every forward crossfade, which
 * makes every formula below the one that shipped. `coverTimeline.test.ts` pins
 * that equivalence rather than leaving it as a claim.
 */

export function TransitionCover({
  reducedMotion,
  onSwap,
  onEnd,
  variant = 'forward',
  ready = true,
  maxHoldMs = 0,
}: {
  reducedMotion: boolean;
  /** Fired once at full opacity. The forward path advances the machine here. */
  onSwap?: () => void;
  onEnd: () => void;
  variant?: CoverVariant;
  /** `variant="return"`: false holds the cover up. Ignored when `maxHoldMs` is 0. */
  ready?: boolean;
  /** Longest the reveal may be held waiting for `ready`. 0 disables the wait. */
  maxHoldMs?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const swapRef = useRef(onSwap);
  const endRef = useRef(onEnd);

  /*
   * `ready` flips mid-flight, and the loop must not be torn down and restarted
   * when it does — that would reset `start` and replay the fade from the top.
   * It is read through a ref for the same reason `onSwap` is.
   */
  const readyRef = useRef(ready);

  useEffect(() => {
    swapRef.current = onSwap;
    endRef.current = onEnd;
    readyRef.current = ready;
  }, [onSwap, onEnd, ready]);

  useEffect(() => {
    const timings = coverTimings(variant, reducedMotion);

    const start = performance.now();
    let extra = 0;
    let swapped = false;
    let raf = 0;

    const frame = () => {
      const elapsed = performance.now() - start;

      // Zero on every forward crossfade, because `maxHoldMs` is zero there.
      extra = heldExtra(elapsed, timings, extra, readyRef.current, maxHoldMs);

      const opacity = coverOpacity(elapsed, timings, extra);
      if (ref.current) ref.current.style.opacity = String(opacity);

      if (!swapped && elapsed >= timings.in) {
        swapped = true;
        // Fully opaque. Everything the player must not see happens here.
        swapRef.current?.();
      }

      if (elapsed >= timings.in + timings.hold + extra + timings.out) {
        endRef.current();
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion, variant, maxHoldMs]);

  /*
   * Where the cover opens from.
   *
   * The forward crossfade used to be spatially anonymous — black in, black out,
   * and the console arrived from nowhere. The player pressed one specific
   * screen, and the destination is what was on it, so the reveal is a radial
   * wipe centred on that screen: the dashboard grows out of the monitor that
   * was activated. `transitionOrigin` is in viewport fractions, so a resize
   * between the press and the reveal cannot put it somewhere off screen.
   *
   * Reduced motion gets the centre and the plain fade the `--cover-spread`
   * rule below collapses to — no travelling edge, nothing sweeping across.
   */
  const origin = variant === 'forward' && !reducedMotion ? transitionOrigin() : CENTRE_ORIGIN;

  return (
    <div
      className="transition-cover"
      data-testid="transition-cover"
      data-direction={variant}
      data-origin-x={origin.x.toFixed(3)}
      data-origin-y={origin.y.toFixed(3)}
      aria-hidden="true"
      /*
       * The reverse cover is opaque in the very first painted frame, not one
       * `requestAnimationFrame` later. React commits the returning office and
       * this element together, so an initial 0 here would show one frame of the
       * un-drawn room — the exact defect this variant exists to remove.
       */
      style={
        {
          opacity: variant === 'return' ? 1 : 0,
          '--cover-origin-x': `${(origin.x * 100).toFixed(2)}%`,
          '--cover-origin-y': `${(origin.y * 100).toFixed(2)}%`,
        } as CSSProperties
      }
      ref={ref}
    />
  );
}
