import { useEffect, useRef } from 'react';

import { isRoomReady, subscribeRoomReady } from '../office/roomReady';
import {
  EXPOSURE_MAX,
  FOCUS_MAX,
  LID_SHUT,
  WAKE_FADE_MS,
  WAKE_ROOM_WAIT_MS,
  WAKE_TOTAL_MS,
  exposureAmount,
  fadeAmount,
  focusAmount,
  lidFraction,
  lowerLidFraction,
} from './wake';

/**
 * The wake reveal — eyes opening on the room.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §2: a 2.8–3.4 s reveal with two
 * irregular lid movements, soft exposure/focus recovery, and no hard
 * symmetrical wipe. The curve that delivers all four is in `wake.ts`; this file
 * is only the surface it is written onto.
 *
 * Driven by `requestAnimationFrame` writing transforms, not by a keyframe set.
 * Three reasons, in order of weight:
 *
 *  1. the re-closes have to be observable as real geometry, and `scaleY` on a
 *     fixed half-viewport block makes `getBoundingClientRect().height` the
 *     honest measurement a test can fail;
 *  2. `transform` and `opacity` stay on the compositor, so a 3 s overlay over
 *     a live WebGL room costs no layout;
 *  3. the elapsed clock is the same clock the test reads, so "how long did the
 *     reveal last" has one answer rather than two.
 *
 * The two lids are written from two different functions on purpose. Sharing one
 * would put the aperture back on the midline, which is the "hard symmetrical
 * wipe" the redesign names as the thing to avoid.
 *
 * The layer is `aria-hidden` and `pointer-events: none` — the eye overlay must
 * never be able to trap input.
 */
export function WakeReveal({ onDone }: { onDone: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const settleRef = useRef<HTMLDivElement>(null);
  const focusRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(performance.now());

  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const mounted = startRef.current;
    let raf = 0;
    /*
     * The reveal is held shut until the room behind it is real.
     *
     * Opening on the Suspense fallback and then having the WebGL room swapped
     * in underneath is the bare 2D-to-3D cut this beat exists to avoid. So the
     * clock does not start at mount: it starts when the room reports drawn, or
     * when the wait runs out — capped, because a reveal a slow GPU could hold
     * open forever is worse than one that opens on the flat wall.
     *
     * `start` stays `null` for the whole hold, and every frame of that hold
     * draws the reveal at elapsed 0, which is lids shut. Nothing flickers, and
     * a player who is waiting is looking at closed eyes rather than at a room
     * being assembled.
     */
    let start: number | null = isRoomReady() ? mounted : null;

    const unsubscribe = subscribeRoomReady(() => {
      if (start === null) start = performance.now();
    });

    const frame = () => {
      const now = performance.now();
      if (start === null) {
        if (now - mounted >= WAKE_ROOM_WAIT_MS) start = now;
        else {
          raf = requestAnimationFrame(frame);
          return;
        }
      }
      const elapsed = now - start;
      const upper = lidFraction(elapsed);
      const lower = lowerLidFraction(elapsed);

      // A lid box is half the viewport; the scale is the fraction of that half.
      if (topRef.current) topRef.current.style.transform = `scaleY(${upper / LID_SHUT})`;
      if (bottomRef.current) bottomRef.current.style.transform = `scaleY(${lower / LID_SHUT})`;
      if (settleRef.current) settleRef.current.style.opacity = String(exposureAmount(elapsed));
      if (focusRef.current) focusRef.current.style.opacity = String(focusAmount(elapsed));
      if (rootRef.current) {
        // The upper lid is the trace the reveal is measured through; the lower
        // one is published beside it so the asymmetry is inspectable too.
        rootRef.current.dataset.wakeLid = upper.toFixed(4);
        rootRef.current.dataset.wakeLower = lower.toFixed(4);
      }

      if (elapsed >= WAKE_TOTAL_MS) {
        doneRef.current();
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, []);

  return (
    <div
      className="wake"
      data-testid="wake-reveal"
      data-wake-start={String(startRef.current)}
      data-wake-lid={LID_SHUT.toFixed(4)}
      data-wake-lower={LID_SHUT.toFixed(4)}
      aria-hidden="true"
      ref={rootRef}
    >
      <div className="wake__lid wake__lid--top" style={{ transform: 'scaleY(1)' }} ref={topRef} />
      <div
        className="wake__lid wake__lid--bottom"
        style={{ transform: 'scaleY(1)' }}
        ref={bottomRef}
      />
      {/*
        Both veils sit over the lids, as the shipped exposure layer already did —
        the shut eye reads as light through a lid rather than as a cut to black.
        The warm haze lifts first and the neutral vignette settles behind it:
        two layers, two decays, so the room resolves rather than simply being
        uncovered — and what is still on screen when the pixel gates capture it
        is the neutral one. See `wake.ts` for the numbers.
      */}
      <div className="wake__settle" style={{ opacity: EXPOSURE_MAX }} ref={settleRef} />
      <div className="wake__focus" style={{ opacity: FOCUS_MAX }} ref={focusRef} />
    </div>
  );
}

/**
 * The reduced-motion path: one short fade.
 *
 * The redesign permits exactly this in place of the lid reveal, and the
 * distinction is load-bearing rather than cosmetic — `intro.spec.ts` asserts
 * that the lid overlay never mounts under reduced motion, and it still never
 * does. What mounts instead is a single monotonic 320 ms ramp with no lids, no
 * reversal and no second layer, so there is nothing in it that can read as a
 * flash or as motion.
 */
export function WakeFade({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const startRef = useRef(performance.now());

  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const mounted = startRef.current;
    let raf = 0;
    /*
     * The reveal is held shut until the room behind it is real.
     *
     * Opening on the Suspense fallback and then having the WebGL room swapped
     * in underneath is the bare 2D-to-3D cut this beat exists to avoid. So the
     * clock does not start at mount: it starts when the room reports drawn, or
     * when the wait runs out — capped, because a reveal a slow GPU could hold
     * open forever is worse than one that opens on the flat wall.
     *
     * `start` stays `null` for the whole hold, and every frame of that hold
     * draws the reveal at elapsed 0, which is lids shut. Nothing flickers, and
     * a player who is waiting is looking at closed eyes rather than at a room
     * being assembled.
     */
    let start: number | null = isRoomReady() ? mounted : null;

    const unsubscribe = subscribeRoomReady(() => {
      if (start === null) start = performance.now();
    });

    const frame = () => {
      const now = performance.now();
      if (start === null) {
        if (now - mounted >= WAKE_ROOM_WAIT_MS) start = now;
        else {
          raf = requestAnimationFrame(frame);
          return;
        }
      }
      const elapsed = now - start;
      if (ref.current) ref.current.style.opacity = String(fadeAmount(elapsed));
      if (elapsed >= WAKE_FADE_MS) {
        doneRef.current();
        return;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, []);

  return (
    <div
      className="wake-fade"
      data-testid="wake-fade"
      data-wake-start={String(startRef.current)}
      style={{ opacity: 1 }}
      aria-hidden="true"
      ref={ref}
    />
  );
}
