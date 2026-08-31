import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  chamferedBox,
  chamferedUnitBox,
  sharedChamferedBox,
  sharedChamferedBoxCount,
} from '../../src/three/bevelGeometry';
import { MONITORS, monitorStand } from '../../src/three/layout';
import { PLATE } from '../../src/three/workstationGeometry';

/**
 * The bevel pass, checked as arithmetic.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §8 asks for bevels on the hero
 * hard-surface objects "geometry only, and watch the draw-call and vertex
 * cost". Two of those three are numbers, and the third is a claim about what
 * the geometry does *not* touch — so all three are here rather than left to a
 * GPU run somebody else has to schedule.
 *
 * The load-bearing one is the footprint. `src/three/projection.ts` maps the DOM
 * monitor surfaces through `screen` and `bezel` and is held to 2 px of drift,
 * and `tests/e2e/headlook.spec.ts` measures the alarm's focal dominance inside
 * a quad derived from `screen/2 + bezel`. A chamfer that grew the bezel by a
 * millimetre would break both, on a real GPU, in someone else's run. It cannot:
 * `chamferedBox` cuts inward, and every size the room actually builds is
 * checked against the `BoxGeometry` it replaced.
 */

/** Every chamfered box the office builds, with the chamfer it is built at. */
function roomBoxes(): {
  label: string;
  size: [number, number, number];
  chamfer: number;
  axis: 'y' | 'z';
}[] {
  const boxes: ReturnType<typeof roomBoxes> = [];

  for (const monitor of MONITORS) {
    const outerWidth = monitor.screen.width + monitor.bezel * 2;
    const outerHeight = monitor.screen.height + monitor.bezel * 2;
    const stand = monitorStand(monitor);

    boxes.push(
      { label: `${monitor.id} bezel`, size: [outerWidth, outerHeight, 0.012], chamfer: 0.0012, axis: 'z' },
      {
        label: `${monitor.id} housing`,
        size: [outerWidth * 0.82, outerHeight * 0.74, 0.042],
        chamfer: 0.0012,
        axis: 'z',
      },
      {
        label: `${monitor.id} chin`,
        size: [outerWidth, stand.chinHeight, 0.014],
        chamfer: 0.0012,
        axis: 'z',
      },
      { label: `${monitor.id} power button`, size: [0.012, 0.005, 0.002], chamfer: 0.0006, axis: 'z' },
      {
        label: `${monitor.id} neck`,
        size: [stand.neckWidth, stand.neckHeight, stand.neckDepth],
        chamfer: 0.0015,
        axis: 'z',
      },
      {
        label: `${monitor.id} base`,
        size: [stand.baseWidth, stand.baseHeight, stand.baseDepth],
        chamfer: 0.0015,
        axis: 'y',
      },
      {
        label: `${monitor.id} base lip`,
        size: [stand.baseWidth * 0.84, 0.004, stand.baseDepth * 0.82],
        chamfer: 0.0006,
        axis: 'y',
      },
    );
  }

  boxes.push(
    { label: 'keyboard plate', size: [PLATE.width, PLATE.height, PLATE.depth], chamfer: 0.0012, axis: 'y' },
    { label: 'desk mat', size: [1.56, 0.002, 0.56], chamfer: 0.0006, axis: 'y' },
  );

  return boxes;
}

function bounds(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  return {
    size: box.getSize(new THREE.Vector3()),
    centre: box.getCenter(new THREE.Vector3()),
  };
}

describe('chamfered boxes keep the footprint they replaced', () => {
  it.each(roomBoxes())('$label', ({ size, chamfer, axis }) => {
    const [width, height, depth] = size;
    const chamfered = bounds(chamferedBox(width, height, depth, chamfer, axis));
    const plain = bounds(new THREE.BoxGeometry(width, height, depth));

    /*
     * Half a micrometre, on objects measured in centimetres. That is the
     * resolution of the `Float32Array` the positions live in, not a tolerance
     * chosen to make this pass: the 2 px projection budget and the
     * focal-dominance quad cannot see a difference five orders of magnitude
     * below the parts being compared.
     */
    expect(chamfered.size.x).toBeCloseTo(plain.size.x, 6);
    expect(chamfered.size.y).toBeCloseTo(plain.size.y, 6);
    expect(chamfered.size.z).toBeCloseTo(plain.size.z, 6);

    // Centred on its own origin, exactly like the geometry it replaces, so the
    // mesh `position` at every call site keeps its meaning.
    expect(chamfered.centre.x).toBeCloseTo(0, 6);
    expect(chamfered.centre.y).toBeCloseTo(0, 6);
    expect(chamfered.centre.z).toBeCloseTo(0, 6);
  });
});

describe('chamferedBox', () => {
  it('actually cuts the edge, rather than only claiming to', () => {
    const geometry = chamferedBox(0.6, 0.4, 0.02, 0.002);
    const normals = geometry.attributes.normal!;

    // A box has six face normals, all axis-aligned. A chamfered box has more,
    // and the extra ones point diagonally — which is the whole purpose: a
    // surface at 45 degrees to both neighbours is what catches the highlight.
    let diagonal = 0;
    const normal = new THREE.Vector3();
    for (let i = 0; i < normals.count; i += 1) {
      normal.fromBufferAttribute(normals, i);
      const axes = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)].filter(
        (value) => value > 0.1,
      );
      if (axes.length > 1) diagonal += 1;
    }
    expect(diagonal, 'no face is angled: this is still a box').toBeGreaterThan(0);
  });

  it('insets the capped face by exactly the chamfer', () => {
    const width = 0.6;
    const depth = 0.02;
    const chamfer = 0.002;
    const geometry = chamferedBox(width, 0.4, depth, chamfer);
    const position = geometry.attributes.position!;

    // The front face sits at +depth/2 and is narrower than the widest section
    // by one chamfer on each side.
    let widestAtFront = 0;
    for (let i = 0; i < position.count; i += 1) {
      if (Math.abs(position.getZ(i) - depth / 2) > 1e-9) continue;
      widestAtFront = Math.max(widestAtFront, Math.abs(position.getX(i)));
    }
    expect(widestAtFront * 2).toBeCloseTo(width - 2 * chamfer, 6);
  });

  it('clamps a chamfer that cannot fit, and degenerates to a box at zero', () => {
    // 4 mm thick, asked for a 3 mm chamfer: the most that fits is 2 mm, and the
    // footprint still has to come back exactly right.
    const clamped = bounds(chamferedBox(0.2, 0.004, 0.14, 0.003, 'y'));
    expect(clamped.size.y).toBeCloseTo(0.004, 6);
    expect(clamped.size.x).toBeCloseTo(0.2, 6);

    const none = chamferedBox(0.2, 0.1, 0.05, 0);
    expect(none).toBeInstanceOf(THREE.BoxGeometry);
  });

  it('stays inside the vertex budget it claims', () => {
    for (const { label, size, chamfer, axis } of roomBoxes()) {
      const geometry = chamferedBox(size[0], size[1], size[2], chamfer, axis);
      expect(geometry.attributes.position!.count, `${label} is heavier than budgeted`).toBeLessThanOrEqual(
        96,
      );
    }

    // The keycap batch is the one that multiplies: 104 instances of one shared
    // geometry, still one draw call.
    expect(chamferedUnitBox(0.06).attributes.position!.count).toBeLessThanOrEqual(96);
  });

  it('carries the UVs a roughness or normal map needs', () => {
    expect(chamferedBox(0.6, 0.4, 0.02, 0.002).attributes.uv).toBeTruthy();
  });
});

describe('sharedChamferedBox', () => {
  it('builds one geometry per distinct size and hands the same one back', () => {
    const before = sharedChamferedBoxCount();
    const first = sharedChamferedBox(0.31, 0.22, 0.011, 0.0009);
    const again = sharedChamferedBox(0.31, 0.22, 0.011, 0.0009);
    expect(again).toBe(first);
    expect(sharedChamferedBoxCount()).toBe(before + 1);

    // A different axis is a different solid, not a cache hit.
    expect(sharedChamferedBox(0.31, 0.22, 0.011, 0.0009, 'y')).not.toBe(first);
  });
});
