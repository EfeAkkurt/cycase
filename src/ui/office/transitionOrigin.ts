/**
 * Where the console came from.
 *
 * Activating a monitor takes the player from the room to the dashboard, and the
 * crossfade between them used to be spatially anonymous: black in, black out,
 * and the console arrives from nowhere in particular. The player pressed a
 * specific screen on a specific desk, and the destination is what was on that
 * screen — so the transition should look like it grew out of it.
 *
 * A module-level point rather than a prop, for the same reason `roomReady` is
 * one: the surface that knows the rectangle and the cover that needs it are
 * mounted by different parents.
 *
 * Stored in viewport fractions, not pixels. The cover is a fixed full-viewport
 * element and the office may be a different size by the time it renders — a
 * resize between the press and the reveal would otherwise put the origin
 * somewhere that was never on screen.
 */

export interface TransitionOrigin {
  /** 0..1 across the viewport. */
  x: number;
  /** 0..1 down the viewport. */
  y: number;
}

/** The middle, which is what a keyboard activation with no rectangle gets. */
export const CENTRE_ORIGIN: TransitionOrigin = { x: 0.5, y: 0.5 };

let origin: TransitionOrigin = CENTRE_ORIGIN;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Records the centre of the element the player actually activated. */
export function setTransitionOriginFrom(element: Element | null): void {
  if (!element || typeof window === 'undefined') {
    origin = CENTRE_ORIGIN;
    return;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    origin = CENTRE_ORIGIN;
    return;
  }
  origin = {
    x: clamp01((rect.left + rect.width / 2) / window.innerWidth),
    y: clamp01((rect.top + rect.height / 2) / window.innerHeight),
  };
}

export function transitionOrigin(): TransitionOrigin {
  return origin;
}

export function resetTransitionOrigin(): void {
  origin = CENTRE_ORIGIN;
}
