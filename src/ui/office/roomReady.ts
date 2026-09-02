/**
 * Whether the room on screen is the drawn one.
 *
 * The eye-opening reveal used to start the moment the office mounted, and the
 * office mounts long before the WebGL room has anything in it: the GLBs are
 * still loading, the Suspense fallback is the flat monitor wall, and what a
 * player actually saw was their eyes opening on a 2D wall which was then
 * replaced by a 3D room a second or so later. A bare swap, in the middle of the
 * one beat the whole opening is built around.
 *
 * So the reveal waits for this. A module-level observable rather than a prop,
 * for the same reason `cameraRig` is one: the two components that need to agree
 * are mounted by different parents, and threading a flag between them would
 * mean editing the shell that owns neither of them.
 *
 * Capped by the caller, always. A reveal that could be held indefinitely by a
 * GPU that never finishes is worse than one that opens on a flat wall.
 */

type Listener = () => void;

let ready = false;
const listeners = new Set<Listener>();

/** The room has drawn at least one real frame — or there is no room to wait for. */
export function markRoomReady(): void {
  if (ready) return;
  ready = true;
  for (const listener of listeners) listener();
}

export function isRoomReady(): boolean {
  return ready;
}

/** A new office, a new wait. Called when the office unmounts. */
export function resetRoomReady(): void {
  ready = false;
}

export function subscribeRoomReady(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
