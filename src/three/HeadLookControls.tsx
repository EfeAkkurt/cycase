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
 * - **pointer/touch drag** on the room itself;
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
 * Nothing in here covers the canvas. The listeners are attached to the element
 * that *contains* the canvas, so pointer events still reach React Three Fiber
 * and the physical alarm monitor keeps its raycast click target (P0.2).
 */

/** Radians per pixel of drag. A full ±55° sweep is roughly 380 px. */
export const DRAG_SENSITIVITY = 0.0025;

/** Radians per unit of locked mouse movement. */
export const POINTER_LOCK_SENSITIVITY = 0.0018;

/** One key press turns the head 4°, so ~14 presses reach either yaw clamp. */
export const KEY_STEP = (4 * Math.PI) / 180;

/**
 * Pointer travel, in CSS pixels, above which a gesture counts as a drag rather
 * than a click. Below it the click falls through to the 3D scene untouched.
 */
const DRAG_SLOP = 6;

export interface HeadLook {
  /** True while the browser actually holds pointer capture. */
  pointerLocked: boolean;
  /** What the visible mouse-look toggle calls. Opt-in, never automatic. */
  togglePointerLook: () => void;
  /** False in browsers with no Pointer Lock API; hide the toggle then. */
  pointerLockSupported: boolean;
}

/**
 * Wires the head-look gestures onto `host` — the element wrapping the canvas.
 *
 * `host` must be focusable and carry the ARIA that tells a keyboard user the
 * room can be looked around; `Office3D` supplies both.
 */
export function useHeadLook(
  /*
   * The node itself, not a ref to it.
   *
   * With a ref object these effects captured `hostRef.current` at first run and
   * kept their listeners on that node forever. The office remounts — Suspense
   * resolving, the 3D toggle — and React replaces the canvas host, after which
   * every listener was attached to a node no longer in the document. Measured:
   * nine arrow presses moved the head by four steps, and a 300 px drag turned it
   * 4.6 degrees instead of 43, because only the events before the remount landed.
   * Passing the node means the effects re-run when it changes.
   */
  host: HTMLElement | null,
  { enabled = true }: { enabled?: boolean } = {},
): HeadLook {
  const [pointerLocked, setPointerLocked] = useState(false);
  const [pointerLockSupported] = useState(
    () => typeof document !== 'undefined' && 'exitPointerLock' in document,
  );
  // Read inside listeners that are attached once; avoids re-binding on lock.
  const lockedRef = useRef(false);
  lockedRef.current = pointerLocked;

  /* ---------------- pointer and touch drag ---------------- */

  useEffect(() => {
    if (!host || !enabled) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let travelled = 0;

    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      travelled += Math.abs(dx) + Math.abs(dy);
      // Grab-the-room: pulling right slides the room right, so the head turns
      // left — and positive yaw *is* left (the camera looks down -Z).
      cameraRig.lookBy(dx * DRAG_SENSITIVITY, dy * DRAG_SENSITIVITY);
    };

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);

      if (travelled <= DRAG_SLOP) return;
      /*
       * A drag that happens to end over the alarm monitor would otherwise be
       * delivered as a click and acknowledge the alarm. Swallow exactly one
       * click, in the capture phase, before it reaches the scene — and drop the
       * guard on the next task if no click arrives at all.
       */
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, { capture: true, once: true });
      window.setTimeout(() => {
        window.removeEventListener('click', swallow, { capture: true });
      }, 0);
    };

    const onPointerDown = (event: PointerEvent) => {
      // Secondary mouse buttons belong to the browser, and while the pointer is
      // locked the mouse-look path already owns the movement.
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (lockedRef.current) return;

      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      travelled = 0;

      // Looking around should leave the keyboard able to carry on looking.
      // No `preventDefault` here: that would cancel the click the 3D alarm
      // monitor needs.
      host.focus({ preventScroll: true });

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('pointercancel', endDrag);
    };

    host.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('blur', endDrag);

    return () => {
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('blur', endDrag);
      endDrag();
    };
  }, [host, enabled]);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    if (!host || !enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

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
          return;
        default:
          return;
      }

      // Arrow keys scroll the page by default, which would slide the room out
      // from under the projection.
      event.preventDefault();
      cameraRig.lookBy(yaw, pitch);
    };

    host.addEventListener('keydown', onKeyDown);
    return () => host.removeEventListener('keydown', onKeyDown);
  }, [host, enabled]);

  /* ---------------- opt-in mouse-look ---------------- */

  useEffect(() => {
    if (!host || !enabled || !pointerLockSupported) return;

    const syncLock = () => setPointerLocked(document.pointerLockElement === host);

    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== host) return;
      // First-person: push the mouse right, look right. Yaw is positive to the
      // left, so both axes invert.
      cameraRig.lookBy(
        -event.movementX * POINTER_LOCK_SENSITIVITY,
        -event.movementY * POINTER_LOCK_SENSITIVITY,
      );
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
    document.addEventListener('pointerlockerror', syncLock);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('keydown', onEscape, true);

    return () => {
      document.removeEventListener('pointerlockchange', syncLock);
      document.removeEventListener('pointerlockerror', syncLock);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onEscape, true);
      if (document.pointerLockElement === host) document.exitPointerLock();
    };
  }, [host, enabled, pointerLockSupported]);

  const togglePointerLook = useCallback(() => {
    if (!host || !pointerLockSupported) return;

    if (document.pointerLockElement === host) {
      document.exitPointerLock();
      return;
    }

    host.focus({ preventScroll: true });
    // Newer Chrome returns a promise here; older signatures return void.
    const request = host.requestPointerLock() as unknown;
    if (request instanceof Promise) {
      request.then(
        () => setPointerLocked(document.pointerLockElement === host),
        () => setPointerLocked(false),
      );
    } else {
      setPointerLocked(document.pointerLockElement === host);
    }
  }, [host, pointerLockSupported]);

  return { pointerLocked, togglePointerLook, pointerLockSupported };
}
