/**
 * The geometry the alarm is heard through.
 *
 * The alarm is not "a sound the page plays"; it is a sound the *centre monitor*
 * makes. Everything in this module is pure maths against `three/layout.ts`, so
 * the emitter can never drift away from the mesh it is supposed to be coming
 * out of, and so the sign convention can be tested without a Web Audio
 * implementation present (the unit suite runs in Node).
 *
 * Web Audio's listener defaults to forward `(0, 0, -1)`, up `(0, 1, 0)` — the
 * same convention three.js uses for a camera. `OfficeScene` drives the camera
 * with `camera.rotation.reorder('YXZ'); rotation.y += yaw; rotation.x += pitch`,
 * so the listener is derived exactly the same way and the two can never
 * disagree about which way the head is pointing.
 */

import { CAMERA, MONITOR_BY_ID } from '../three/layout';

export type Vec3 = [number, number, number];

/** Where the alarm physically comes from: the centre monitor's screen plane. */
export const ALARM_EMITTER: Vec3 = (() => {
  const centre = MONITOR_BY_ID.get('center');
  if (!centre) throw new Error('layout has no centre monitor');
  return [...centre.position] as Vec3;
})();

/** Where the operator's head is. The seat does not move (audit P0.1). */
export const LISTENER_POSITION: Vec3 = [...CAMERA.position] as Vec3;

/**
 * The seated base orientation, before any head-look. The camera is aimed at
 * `CAMERA.target`, which is very slightly below eye level, so the listener
 * starts with the same small downward tilt rather than dead level.
 */
export const BASE_ORIENTATION = (() => {
  const [px, py, pz] = CAMERA.position;
  const [tx, ty, tz] = CAMERA.target;
  const dx = tx - px;
  const dy = ty - py;
  const dz = tz - pz;
  const length = Math.hypot(dx, dy, dz) || 1;
  const ny = dy / length;
  return {
    // Camera convention: a camera with rotation.y = θ looks along
    // (-sin θ, 0, -cos θ). Solve that for the base aim.
    yaw: Math.atan2(-dx, -dz),
    pitch: Math.asin(Math.min(1, Math.max(-1, ny))),
  };
})();

export interface ListenerOrientation {
  forward: Vec3;
  up: Vec3;
}

/**
 * The listener's forward and up vectors for a head-look pose.
 *
 * `yaw` and `pitch` are the rig's, in radians, in exactly the units
 * `cameraRig` publishes: positive yaw turns left, positive pitch looks up.
 *
 * The identity worth remembering when reading a test: at yaw `-38°` (the
 * scripted doorway glance) forward's x is **positive**, because the door is on
 * the right-hand wall and `COLLEAGUE_PATH` starts at x = +2.5.
 */
export function listenerOrientation(yaw: number, pitch: number): ListenerOrientation {
  const y = BASE_ORIENTATION.yaw + yaw;
  const p = BASE_ORIENTATION.pitch + pitch;

  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cp = Math.cos(p);
  const sp = Math.sin(p);

  return {
    forward: [-sy * cp, sp, -cy * cp],
    up: [sy * sp, cp, cy * sp],
  };
}

/**
 * Straight-line distance from the seat to the emitter. Used to pick the
 * panner's reference distance so the alarm is loud but not in-your-ear.
 */
export function emitterDistance(): number {
  const [ex, ey, ez] = ALARM_EMITTER;
  const [lx, ly, lz] = LISTENER_POSITION;
  return Math.hypot(ex - lx, ey - ly, ez - lz);
}
