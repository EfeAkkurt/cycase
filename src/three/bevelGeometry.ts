/**
 * Chamfered boxes for the hero hard-surface objects.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §8, immediate correction pass:
 * "add bevels to hero hard-surface objects". Every edge in the room was a
 * perfect 90 degrees, and a perfect 90-degree edge is the one thing no
 * manufactured object has. A moulded bezel, a stamped base plate and an
 * injection-moulded keycap all carry a chamfer or a radius of half a millimetre
 * to a millimetre and a half, and that chamfer is what catches a highlight —
 * the thin bright line down an edge that separates "a photograph of a monitor"
 * from "a box with a monitor material on it". No amount of texture work
 * substitutes for it, because the missing signal is a specular one and there is
 * nothing there to be specular.
 *
 * Geometry only. Nothing here reads or writes a monitor's `screen`, `bezel`,
 * `position` or `dom` — `src/three/projection.ts` owns the DOM projection and
 * its 2 px drift budget, and `tests/e2e/headlook.spec.ts` measures the alarm's
 * focal dominance inside a quad derived from `screen/2 + bezel`. A chamfer that
 * moved either would be a rendering improvement bought with a gate, so the
 * contract of this module is deliberately narrow: **the chamfer is cut inward
 * from the box you asked for**. `chamferedBox(w, h, d, c)` has exactly the
 * bounding box of `BoxGeometry(w, h, d)`, to floating-point tolerance, and
 * `tests/unit/bevelGeometry.test.ts` asserts that for every size the room uses.
 *
 * Cost. Built on `ExtrudeGeometry` with one bevel segment, which chamfers the
 * eight edges of the two capped faces and leaves the four edges parallel to the
 * extrusion axis square. That is the right trade for these shapes: the visible
 * highlight on a bezel, a chin, a base plate or a keycap runs along the front
 * or top face, and buying the other four edges would roughly double the
 * triangle count for an edge the seated camera sees at a grazing angle or not
 * at all. Measured, a chamfered box is 84 vertices against a `BoxGeometry`'s
 * 24, and the geometries are module-scope singletons rather than per-render
 * `useMemo` results, so three monitors share one of each. Draw calls do not
 * change at all: the keycaps stay a single instanced mesh.
 */
import * as THREE from 'three';

/** Which way the box is extruded, and therefore which two faces get chamfered. */
export type ChamferAxis = 'z' | 'y';

/**
 * A box of `width` x `height` x `depth` with a `chamfer`-wide 45-degree cut
 * around both capped faces.
 *
 * `axis` picks the extrusion direction: `'z'` for a panel facing the camera (a
 * bezel, a chin, a base lip), `'y'` for something read from above (a keycap, a
 * desk mat). The returned geometry is centred on its own origin, like
 * `BoxGeometry`, so it is a drop-in replacement at the same `position`.
 */
export function chamferedBox(
  width: number,
  height: number,
  depth: number,
  chamfer: number,
  axis: ChamferAxis = 'z',
): THREE.BufferGeometry {
  /*
   * The chamfer has to fit in all three dimensions. Clamping rather than
   * throwing is deliberate: a caller that asks for a 1 mm chamfer on a 1.4 mm
   * plate should get the largest chamfer that fits, not a crash in a scene
   * graph — and `bevelGeometry.test.ts` pins the clamp so the silence is
   * checked rather than assumed.
   */
  const limit = Math.min(width, height, depth) / 2 - 1e-6;
  const cut = Math.max(0, Math.min(chamfer, limit));

  if (cut <= 0) return new THREE.BoxGeometry(width, height, depth);

  /*
   * `ExtrudeGeometry` treats the shape as the *capped face* and grows the bevel
   * outward from it — the widest cross-section of the solid is the shape plus
   * `bevelSize` on every side, and the total run along the extrusion axis is
   * the body plus `bevelThickness` at each end. So each of the three requested
   * dimensions loses two chamfers before it is handed over, and what comes back
   * has the bounding box that was asked for.
   *
   * For `axis: 'y'` the profile is the box's *plan* rather than its front, and
   * the solid is turned a quarter-turn afterwards; the two swapped dimensions
   * are resolved here rather than at the call site.
   */
  const profileWidth = width - 2 * cut;
  const profileHeight = (axis === 'y' ? depth : height) - 2 * cut;
  const run = (axis === 'y' ? height : depth) - 2 * cut;

  const shape = new THREE.Shape();
  const halfWidth = profileWidth / 2;
  const halfHeight = profileHeight / 2;
  shape.moveTo(-halfWidth, -halfHeight);
  shape.lineTo(halfWidth, -halfHeight);
  shape.lineTo(halfWidth, halfHeight);
  shape.lineTo(-halfWidth, halfHeight);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: run,
    bevelEnabled: true,
    bevelThickness: cut,
    bevelSize: cut,
    bevelOffset: 0,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 1,
  });

  /*
   * Extrusion starts at the profile plane, not at the centre of the solid. Recentre
   * from the measured bounds rather than from a formula: the offset then stays
   * correct if three.js ever changes where it puts the first bevel ring, which
   * is exactly the kind of silent 1 mm shift the projection budget would eat.
   */
  geometry.computeBoundingBox();
  const centre = geometry.boundingBox!.getCenter(new THREE.Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);

  if (axis === 'y') {
    // Extruded along +Z, turned so the capped faces are the top and the bottom.
    geometry.rotateX(-Math.PI / 2);
  }

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * A chamfered unit cube, for instanced meshes that scale it per instance.
 *
 * The keycaps are one `InstancedMesh` scaled to `(capWidth, 8 mm, capDepth)`,
 * so a uniform chamfer on the unit cube arrives at the eye as an *anisotropic*
 * one: 0.06 of a unit becomes 1.05 mm across a 17.45 mm cap and 0.48 mm up its
 * 8 mm height. Both of those are inside the half-to-one-and-a-half millimetre a
 * real moulded cap carries, which is why one shared geometry is honest here
 * rather than a compromise.
 */
export function chamferedUnitBox(chamfer: number, axis: ChamferAxis = 'y'): THREE.BufferGeometry {
  return chamferedBox(1, 1, 1, chamfer, axis);
}

/**
 * The same box, built once per distinct size for the lifetime of the module.
 *
 * `<boxGeometry>` as JSX is disposed by React Three Fiber when its mesh
 * unmounts; a `BufferGeometry` built in a component is not, and `Monitor`
 * renders three times over and re-renders on every alarm frame. The scene uses
 * a handful of distinct sizes — two bezels, two chins, two base plates and so
 * on — so a module-scope cache is both the cheapest and the least error-prone
 * lifetime available, and it is the same choice `Workstation.tsx` already makes
 * for the shared keycap geometry.
 */
const SHARED = new Map<string, THREE.BufferGeometry>();

export function sharedChamferedBox(
  width: number,
  height: number,
  depth: number,
  chamfer: number,
  axis: ChamferAxis = 'z',
): THREE.BufferGeometry {
  const key = `${width}:${height}:${depth}:${chamfer}:${axis}`;
  const cached = SHARED.get(key);
  if (cached) return cached;
  const geometry = chamferedBox(width, height, depth, chamfer, axis);
  SHARED.set(key, geometry);
  return geometry;
}

/** Distinct geometries built so far. Read by `tests/unit/bevelGeometry.test.ts`. */
export function sharedChamferedBoxCount(): number {
  return SHARED.size;
}
