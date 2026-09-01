/**
 * The one element that owns head-look, named once.
 *
 * Two files need to agree on it and neither can import the other: `Office3D`
 * renders it, and `Office` — which renders `Office3D` behind `React.lazy` —
 * has to hand focus back to it after the Recenter control in the chrome is
 * activated. Importing the id from `Office3D` would pull three.js into the
 * dashboard's bundle, which is the whole reason that import is lazy.
 *
 * The focus hand-back is not a courtesy. Camera keys are deliberately ignored
 * while a button, input or select has focus — otherwise ArrowLeft on the volume
 * slider would turn the room — so a Recenter click that left focus on its own
 * button would silently kill arrow and WASD look until the player clicked the
 * room again. That was the reported bug; this is the seam it is fixed at.
 */
export const LOOK_SURFACE_ID = 'office-look-surface';

/** Moves keyboard focus back to the room, if the room is on screen. */
export function focusLookSurface(): void {
  if (typeof document === 'undefined') return;
  const surface = document.getElementById(LOOK_SURFACE_ID);
  // `preventScroll`, because the office is a fixed-height flex column and
  // scrolling it would slide the canvas out from under the DOM projection.
  surface?.focus({ preventScroll: true });
}
