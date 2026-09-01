import { useCallback, useEffect, useRef, useState } from 'react';

import { cameraRig } from './cameraRig';

/**
 * Seated head-look input (audit P0.1).
 *
 * The operator never walks. Every gesture here nudges the shared `cameraRig`,
 * which the WebGL camera and the DOM monitor projection both read — so the
 * interface stays glued to the glass no matter which input moved the head.
 *
 * Three input paths, because the contract names three:
 *
 * - **pointer/touch drag** anywhere in the office;
 * - **mouse-look**, opt-in through Pointer Lock, released by Escape;
 * - **keyboard**, arrows and A/D/W/S, so the room is explorable with no mouse
 *   at all.
 *
 * Two conventions live here on purpose, because each matches what its own
 * gesture means everywhere else. A **drag** grabs the room and pulls it, the
 * way Street View and every model viewer behave — pull right, the room slides
 * right and you end up looking left. **Mouse-look and the keys** move the head,
 * the way a first-person camera behaves — push right, you look right.
 *
 * ## Why the listeners moved off the canvas
 *
 * They used to be bound to the element that *contains* the canvas, one layer
 * below `.office3d__overlay`. That reads as the careful choice — pointer events
 * still reach React Three Fiber, so the physical alarm monitor keeps its
 * raycast click — and it produced a bug that looked like flaky input: the three
 * projected monitor surfaces are `pointer-events: auto` and they cover most of
 * the picture, so a drag that started on a monitor never reached the drag
 * listener at all. The room simply did not move, and which part of the frame you
 * happened to grab decided whether the gesture worked.
 *
 * The listeners are on the whole office region now, above the overlay, and the
 * click-versus-drag question is answered explicitly rather than by which element
 * happened to be on top:
 *
 * - `pointerdown` never calls `preventDefault`, so the click the alarm monitor
 *   needs is still generated;
 * - a gesture that travels further than `DRAG_SLOP` sets `suppressNextClick`,
 *   and a permanently-installed capture-phase listener eats exactly the one
 *   click that follows it. A drag that ends over the alarm can no longer
 *   acknowledge it;
 * - a gesture that does not travel that far is not a drag, the flag is never
 *   set, and the click reaches whichever monitor it was aimed at untouched.
 *
 * The previous version dropped that guard on a `setTimeout(…, 0)`, which is a
 * race: under load the timeout can win and the swallow is gone before the click
 * arrives. The flag is cleared on the *next* `pointerdown` instead, which is
 * ordered after the click by the event model rather than by the scheduler.
 */

/** Radians per pixel of drag. A full ±120° sweep is roughly 1680 px. */
export const DRAG_SENSITIVITY = 0.0025;

/** Radians per unit of locked mouse movement. */
export const POINTER_LOCK_SENSITIVITY = 0.0018;

/** One key press turns the head 4°, so ~30 presses reach either yaw clamp. */
export const KEY_STEP = (4 * Math.PI) / 180;

/**
 * Pointer travel, in CSS pixels, above which a gesture counts as a drag rather
 * than a click. Below it the click falls through to the scene untouched.
 */
export const DRAG_SLOP = 6;

/**
 * Elements a camera gesture must never steal from.
 *
 * Both halves of the contract's task list depend on this list being explicit.
 * A pointer gesture starting on one of these is that control's gesture — a
 * volume slider must drag its thumb, not the room — and a key press while one
 * of them has focus belongs to the control, so ArrowLeft on the mute button or
 * on a select never turns the head.
 *
 * `[tabindex]` is deliberately *not* in here. The look surface itself carries
 * `tabIndex={0}` so that keyboard users can reach the room at all, and a generic
 * tabindex selector would therefore match the very element the drag has to work
 * on — which is the one-line way to disable this whole feature by accident.
 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="switch"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="tab"]',
  '[role="textbox"]',
].join(',');

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_SELECTOR) !== null;
}

/** Why the last Pointer Lock request did not take. Never silent. */
export type PointerLockFailure = 'denied' | 'unsupported';

export interface HeadLook {
  /** True while the browser actually holds pointer capture. */
  pointerLocked: boolean;
  /** What the visible mouse-look toggle calls. Opt-in, never automatic. */
  togglePointerLook: () => void;
  /** False in browsers with no Pointer Lock API; hide the toggle then. */
  pointerLockSupported: boolean;
  /**
   * Set when a request failed, cleared when one succeeds or the player
   * dismisses it. The office renders it; a refusal that shows nothing is
   * indistinguishable from a dead button.
   */
  pointerLockFailure: PointerLockFailure | null;
  dismissPointerLockFailure: () => void;
  /** True between `pointerdown` and the end of a gesture that became a drag. */
  dragging: boolean;
  /**
   * True once the player has actually turned the head, by any of the three
   * paths. The first-run help watches this so it can stand down.
   */
  hasLooked: boolean;
}

/**
 * Wires the head-look gestures onto `region` — the whole office area.
 *
 * `focusTarget` is the element that takes keyboard focus and carries the ARIA
 * telling a keyboard user the room can be looked around; `Office3D` supplies
 * both, and they are different elements on purpose: the region is the surface
 * you can grab, the focus target is the thing a screen reader announces.
 */
export function useHeadLook(
  /*
   * The nodes themselves, not refs to them.
   *
   * With a ref object these effects captured `ref.current` at first run and
   * kept their listeners on that node forever. The office remounts — Suspense
   * resolving, the 3D toggle — and React replaces the elements, after which
   * every listener was attached to a node no longer in the document. Measured:
   * nine arrow presses moved the head by four steps, and a 300 px drag turned it
   * 4.6 degrees instead of 43, because only the events before the remount
   * landed. Passing the nodes means the effects re-run when they change.
   */
  region: HTMLElement | null,
  focusTarget: HTMLElement | null,
  { enabled = true }: { enabled?: boolean } = {},
): HeadLook {
  const [pointerLocked, setPointerLocked] = useState(false);
  const [pointerLockSupported] = useState(
    () => typeof document !== 'undefined' && 'exitPointerLock' in document,
  );
  const [pointerLockFailure, setPointerLockFailure] = useState<PointerLockFailure | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hasLooked, setHasLooked] = useState(false);

  // Read inside listeners that are attached once; avoids re-binding on lock.
  const lockedRef = useRef(false);
  lockedRef.current = pointerLocked;

  const markLooked = useCallback(() => {
    setHasLooked((already) => already || true);
  }, []);

  /* ---------------- pointer and touch drag ---------------- */

  useEffect(() => {
    if (!region || !enabled) return;

    let active = false;
    let lastX = 0;
    let lastY = 0;
    let travelled = 0;
    let suppressNextClick = false;

    /*
     * Installed for the lifetime of the effect rather than armed per gesture.
     *
     * A `once: true` listener added at the end of a drag and removed on a
     * timeout is a race against the click it is meant to catch. This one is
     * always listening and does nothing at all unless the flag is set, so the
     * only ordering it depends on is the event model's own: the click that
     * follows a `pointerup` is dispatched before any subsequent `pointerdown`.
     */
    const onClickCapture = (event: MouseEvent) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      event.stopPropagation();
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!active) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);

      if (travelled > DRAG_SLOP) {
        // Only now is this a drag. Announcing it earlier would put the
        // grabbing cursor and the text-selection lock on every click.
        setDragging(true);
        markLooked();
      }

      // Grab-the-room: pulling right slides the room right, so the head turns
      // left — and positive yaw *is* left (the camera looks down -Z).
      cameraRig.lookBy(dx * DRAG_SENSITIVITY, dy * DRAG_SENSITIVITY);
    };

    const endDrag = () => {
      if (!active) return;
      active = false;
      setDragging(false);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);

      /*
       * A drag that happens to end over the alarm monitor would otherwise be
       * delivered as a click and acknowledge the alarm — the incident taken by
       * a gesture that was looking around the room. Swallow exactly the one
       * click this gesture produces.
       */
      if (travelled > DRAG_SLOP) suppressNextClick = true;
    };

    const onPointerDown = (event: PointerEvent) => {
      /*
       * Clear first, and unconditionally.
       *
       * A gesture cancelled by the OS (a touch turned into a system swipe, a
       * dragged window) produces `pointercancel` and no click, which would
       * leave the flag armed for whatever the player clicked next. Clearing it
       * here bounds the guard to the gesture that set it.
       */
      suppressNextClick = false;

      // Secondary mouse buttons belong to the browser, and while the pointer is
      // locked the mouse-look path already owns the movement.
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (lockedRef.current) return;
      // A control's gesture is the control's. This is what lets the volume
      // slider, the acknowledge button and every panel control keep working
      // even though the drag surface now sits over the whole office.
      if (isInteractive(event.target)) return;

      active = true;
      lastX = event.clientX;
      lastY = event.clientY;
      travelled = 0;

      /*
       * Looking around should leave the keyboard able to carry on looking.
       *
       * Still no `preventDefault`: that would cancel the click the 3D alarm
       * monitor's raycast needs, which is the behaviour the contract asks for
       * in the same breath as the drag.
       */
      focusTarget?.focus({ preventScroll: true });

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    };

    region.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('blur', endDrag);

    return () => {
      region.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('blur', endDrag);
      endDrag();
    };
  }, [region, focusTarget, enabled, markLooked]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    if (!region || !enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      /*
       * The contract's second half: camera keys must not fire while a button,
       * input or select has focus.
       *
       * The listener is on the region rather than on the focusable canvas
       * because the projected monitor panels are inside the region and are full
       * of real controls — so the key event genuinely can originate on one of
       * them. Without this, tabbing to a panel's button and pressing ArrowDown
       * both scrolled that panel and pitched the room.
       */
      if (isInteractive(event.target)) return;

      let yaw = 0;
      let pitch = 0;
      switch (event.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          yaw = KEY_STEP;
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          yaw = -KEY_STEP;
          break;
        case 'ArrowUp':
        case 'w':
        case 'W':
          pitch = KEY_STEP;
          break;
        case 'ArrowDown':
        case 's':
        case 'S':
          pitch = -KEY_STEP;
          break;
        case 'Home':
          event.preventDefault();
          cameraRig.recenter();
          markLooked();
          return;
        default:
          return;
      }

      // Arrow keys scroll the page by default, which would slide the room out
      // from under the projection.
      event.preventDefault();
      cameraRig.lookBy(yaw, pitch);
      markLooked();
    };

    region.addEventListener('keydown', onKeyDown);
    return () => region.removeEventListener('keydown', onKeyDown);
  }, [region, enabled, markLooked]);

  /* ---------------- opt-in mouse-look ---------------- */

  useEffect(() => {
    if (!focusTarget || !enabled || !pointerLockSupported) return;

    const syncLock = () => {
      const held = document.pointerLockElement === focusTarget;
      setPointerLocked(held);
      if (held) setPointerLockFailure(null);
    };

    /*
     * The browser refused. This is the path a permissions policy, a sandboxed
     * frame or a too-soon second request takes, and it used to be routed into
     * `syncLock` — which set `pointerLocked` to false and said nothing, so the
     * button looked broken. It is surfaced now.
     */
    const onLockError = () => {
      setPointerLocked(false);
      setPointerLockFailure('denied');
    };

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== focusTarget) return;
      // First-person: push the mouse right, look right. Yaw is positive to the
      // left, so both axes invert.
      cameraRig.lookBy(
        -event.movementX * POINTER_LOCK_SENSITIVITY,
        -event.movementY * POINTER_LOCK_SENSITIVITY,
      );
      markLooked();
    };

    /*
     * Chrome already exits pointer lock on Escape, but only for a real key
     * press it recognises as the user's. Releasing it ourselves as well makes
     * the contract's "Escape releases pointer capture" true in every path,
     * including a synthesised one.
     */
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (!document.pointerLockElement) return;
      event.preventDefault();
      document.exitPointerLock();
    };

    document.addEventListener('pointerlockchange', syncLock);
    document.addEventListener('pointerlockerror', onLockError);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onEscape, true);

    return () => {
      document.removeEventListener('pointerlockchange', syncLock);
      document.removeEventListener('pointerlockerror', onLockError);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onEscape, true);
      if (document.pointerLockElement === focusTarget) document.exitPointerLock();
    };
  }, [focusTarget, enabled, pointerLockSupported, markLooked]);

  /*
   * Called straight from the toggle's `onClick`, and nowhere else.
   *
   * Pointer Lock is only granted inside a real user gesture, so this must stay
   * one synchronous step from the click: no `await`, no timer, no effect. That
   * is also why it is not fired automatically on entering the office — a
   * request made outside a gesture is refused, and a refusal the player did not
   * ask for is the worst version of this feature.
   */
  const togglePointerLook = useCallback(() => {
    if (!focusTarget) return;
    if (!pointerLockSupported) {
      setPointerLockFailure('unsupported');
      return;
    }

    if (document.pointerLockElement === focusTarget) {
      document.exitPointerLock();
      return;
    }

    setPointerLockFailure(null);
    focusTarget.focus({ preventScroll: true });

    let request: unknown;
    try {
      // Newer Chrome returns a promise here; older signatures return void.
      request = focusTarget.requestPointerLock();
    } catch {
      setPointerLockFailure('denied');
      return;
    }

    if (request instanceof Promise) {
      request.then(
        () => {
          setPointerLocked(document.pointerLockElement === focusTarget);
          setPointerLockFailure(null);
        },
        () => {
          setPointerLocked(false);
          setPointerLockFailure('denied');
        },
      );
      return;
    }

    /*
     * The void signature resolves through `pointerlockchange` /
     * `pointerlockerror`, which the effect above is already listening for — so
     * nothing is reported here. Reporting a failure synchronously would be
     * wrong: the lock has not been refused yet, it has not been decided.
     */
    setPointerLocked(document.pointerLockElement === focusTarget);
  }, [focusTarget, pointerLockSupported]);

  const dismissPointerLockFailure = useCallback(() => setPointerLockFailure(null), []);

  return {
    pointerLocked,
    togglePointerLook,
    pointerLockSupported,
    pointerLockFailure,
    dismissPointerLockFailure,
    dragging,
    hasLooked,
  };
}
