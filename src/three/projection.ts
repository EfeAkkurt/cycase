import * as THREE from 'three';

import { CAMERA, MONITORS, type MonitorSpec } from './layout';
import { isQuadUsable, quadToMatrix3d, type Quad } from './homography';

/**
 * Projects each monitor's screen plane into CSS pixels.
 *
 * Deliberately independent of React Three Fiber: it rebuilds the same fixed
 * camera from `layout.ts` and does the maths directly. The DOM overlay can
 * therefore position itself without waiting for the canvas, and the whole thing
 * is a pure function of viewport size — which makes it testable and means it
 * only has to run on resize, exactly as docs/PROJECT_CONTEXT.md §7 asks
 * ("calculate monitor screen corner projection once and update only during
 * scripted camera movement or resize").
 */

export interface MonitorPlacement {
  id: MonitorSpec['id'];
  /** CSS `matrix3d(...)`, applied with `transform-origin: 0 0`. */
  transform: string;
  /** Unscaled DOM surface size the transform maps from. */
  width: number;
  height: number;
  /** Rough depth order so the overlay can stack sensibly. */
  distance: number;
}

function screenCorners(monitor: MonitorSpec): THREE.Vector3[] {
  const halfWidth = monitor.screen.width / 2;
  const halfHeight = monitor.screen.height / 2;

  // Top-left, top-right, bottom-right, bottom-left in the screen's own plane.
  const local = [
    new THREE.Vector3(-halfWidth, halfHeight, 0),
    new THREE.Vector3(halfWidth, halfHeight, 0),
    new THREE.Vector3(halfWidth, -halfHeight, 0),
    new THREE.Vector3(-halfWidth, -halfHeight, 0),
  ];

  const rotation = new THREE.Euler(0, monitor.rotationY, 0);
  const origin = new THREE.Vector3(...monitor.position);

  return local.map((point) => point.clone().applyEuler(rotation).add(origin));
}

export function createCamera(
  width: number,
  height: number,
  yaw = 0,
  pitch = 0,
): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, width / height, 0.1, 40);
  camera.position.set(...CAMERA.position);
  camera.lookAt(new THREE.Vector3(...CAMERA.target));
  // Head-look on top of the seated base orientation. YXZ keeps yaw level with
  // the floor no matter the pitch — the order a neck actually moves in.
  camera.rotation.reorder('YXZ');
  camera.rotation.y += yaw;
  camera.rotation.x += pitch;
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

export function computeMonitorPlacements(
  width: number,
  height: number,
  yaw = 0,
  pitch = 0,
): MonitorPlacement[] {
  if (width <= 0 || height <= 0) return [];
  const camera = createCamera(width, height, yaw, pitch);
  const placements: MonitorPlacement[] = [];

  for (const monitor of MONITORS) {
    const corners = screenCorners(monitor);
    let behindCamera = false;
    let distance = 0;

    const quad = corners.map((corner) => {
      const projected = corner.clone().project(camera);
      if (projected.z > 1) behindCamera = true;
      distance += corner.distanceTo(camera.position);
      return {
        x: ((projected.x + 1) / 2) * width,
        y: ((1 - projected.y) / 2) * height,
      };
    }) as Quad;

    if (behindCamera || !isQuadUsable(quad)) continue;

    const transform = quadToMatrix3d(monitor.dom.width, monitor.dom.height, quad);
    if (!transform) continue;

    placements.push({
      id: monitor.id,
      transform,
      width: monitor.dom.width,
      height: monitor.dom.height,
      distance: distance / 4,
    });
  }

  return placements;
}

/**
 * Stable camera props for `<Canvas camera={...}>`.
 *
 * Two things matter here and both are easy to get wrong:
 *
 * 1. **`rotation` must be supplied.** React Three Fiber points the default
 *    camera at the world origin unless the camera options carry a rotation.
 *    Calling `lookAt` in `onCreated` is not enough, because R3F re-applies its
 *    own default whenever it reconfigures.
 * 2. **The object identity must be stable.** An inline literal is a new object
 *    on every render, which makes R3F reconfigure — and re-aim — continuously.
 *
 * When the render camera drifts from the camera this module projects with, the
 * DOM monitor surfaces float off their bezels, which is a confusing symptom for
 * a very mechanical cause.
 */
export const CAMERA_PROPS = (() => {
  const probe = createCamera(16, 9);
  return {
    position: CAMERA.position,
    rotation: [probe.rotation.x, probe.rotation.y, probe.rotation.z] as [number, number, number],
    fov: CAMERA.fov,
    near: 0.1,
    far: 40,
  };
})();
