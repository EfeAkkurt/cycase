import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { DESK, MONITORS, monitorStand } from '../../src/three/layout';
import {
  FIELD_X,
  HUB,
  KEYBOARD_INDICATORS,
  KEY_PITCH,
  PLATE,
  SURFACE,
  buildKeyField,
  cableRuns,
} from '../../src/three/workstationGeometry';

/**
 * The modelled workstation hardware, checked as geometry.
 *
 * Every visual gate in this repository classifies pixels: luminance means, dark
 * shares, cool hues, focal hierarchy. All of them were green on a workstation
 * that had, simultaneously,
 *
 * - a monitor base cantilevered 71% of its depth off the back of the desk,
 * - a stand neck running 148 mm down through the desk top,
 * - a base plate floating 12 mm above the surface it stands on,
 * - a key field covering 61% of its own plate, the rest bare,
 * - and three cable runs that left the visible frame 5 mm after leaving the
 *   stand and spent their whole length behind an opaque desk.
 *
 * None of those moves a histogram far enough to fail anything. Each of them is
 * obvious the moment someone reads the numbers. This is the file that reads the
 * numbers, and it runs in `vitest` rather than in a browser, because none of it
 * needs one.
 *
 * The desk footprint below comes from the *measured* model rather than an
 * assumed one; `scripts/measure-models.mjs` prints it from the shipped .glb.
 */

const LEFT = -DESK.width / 2;
const RIGHT = DESK.width / 2;
const BACK = DESK.z - DESK.depth / 2;
const FRONT = DESK.z + DESK.depth / 2;

/** Floating-point slack. Everything here is authored to the millimetre. */
const EPSILON = 1e-6;

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

const empty = (): Bounds => ({
  minX: Infinity,
  maxX: -Infinity,
  minY: Infinity,
  maxY: -Infinity,
  minZ: Infinity,
  maxZ: -Infinity,
});

function include(bounds: Bounds, x: number, y: number, z: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

/**
 * World bounds of a box given in a monitor's own local frame.
 *
 * All eight corners, because a yawed box is a different box: the side monitors
 * toe in 0.42 rad, so their bases reach further in x and z than their own
 * dimensions suggest, and that is exactly where a desk-edge overrun hides.
 */
function monitorPartBounds(
  index: number,
  centre: [number, number, number],
  size: [number, number, number],
): Bounds {
  const monitor = MONITORS[index]!;
  const [ox, oy, oz] = monitor.position;
  const cos = Math.cos(monitor.rotationY);
  const sin = Math.sin(monitor.rotationY);
  const bounds = empty();

  for (let corner = 0; corner < 8; corner += 1) {
    const lx = centre[0] + (corner & 1 ? 0.5 : -0.5) * size[0];
    const ly = centre[1] + (corner & 2 ? 0.5 : -0.5) * size[1];
    const lz = centre[2] + (corner & 4 ? 0.5 : -0.5) * size[2];
    include(bounds, ox + lx * cos + lz * sin, oy + ly, oz - lx * sin + lz * cos);
  }

  return bounds;
}

function onTheDesk(bounds: Bounds): boolean {
  return (
    bounds.minX >= LEFT - EPSILON &&
    bounds.maxX <= RIGHT + EPSILON &&
    bounds.minZ >= BACK - EPSILON &&
    bounds.maxZ <= FRONT + EPSILON
  );
}

describe('the desk is the desk that ships', () => {
  it('matches the measured size of metal_office_desk.glb after the height fit', () => {
    /*
     * The GLB is 2.000 x 0.787 x 0.947 m (normalised int16 POSITION, identity
     * node scale), and `<Prop targetHeight>` scales it by 0.74 / 0.787.
     * `scripts/measure-models.mjs` prints exactly this.
     *
     * `DESK.width` and `DESK.depth` were 2.34 and 0.78 and were read by nothing,
     * so nothing caught them. The monitor stands were placed against the back
     * edge they implied, which is 9 cm behind the real one.
     */
    const native = { width: 2.0, height: 0.787, depth: 0.947 };
    const fit = DESK.height / native.height;

    expect(DESK.width).toBeCloseTo(native.width * fit, 2);
    expect(DESK.depth).toBeCloseTo(native.depth * fit, 2);
  });
});

describe('every modelled part stands on the desk', () => {
  for (const [index, monitor] of MONITORS.entries()) {
    const stand = monitorStand(monitor);

    const parts: { label: string; centre: [number, number, number]; size: [number, number, number] }[] =
      [
        {
          label: 'base plate',
          centre: [0, stand.deskLocal + stand.baseHeight / 2, stand.baseZ],
          size: [stand.baseWidth, stand.baseHeight, stand.baseDepth],
        },
        {
          label: 'neck',
          centre: [0, stand.baseTop + stand.neckHeight / 2, stand.neckZ],
          size: [stand.neckWidth, stand.neckHeight, stand.neckDepth],
        },
      ];

    for (const part of parts) {
      it(`${monitor.id} monitor ${part.label} is inside the desk footprint`, () => {
        const bounds = monitorPartBounds(index, part.centre, part.size);
        expect(
          onTheDesk(bounds),
          `x ${bounds.minX.toFixed(3)}..${bounds.maxX.toFixed(3)}, ` +
            `z ${bounds.minZ.toFixed(3)}..${bounds.maxZ.toFixed(3)} ` +
            `against a desk of x ${LEFT.toFixed(3)}..${RIGHT.toFixed(3)}, ` +
            `z ${BACK.toFixed(3)}..${FRONT.toFixed(3)}`,
        ).toBe(true);
      });

      it(`${monitor.id} monitor ${part.label} does not sink through the desk top`, () => {
        const bounds = monitorPartBounds(index, part.centre, part.size);
        expect(bounds.minY).toBeGreaterThanOrEqual(DESK.height - EPSILON);
      });
    }

    it(`${monitor.id} monitor stand joins the base to the panel with no gap`, () => {
      // A neck of zero or negative length is a panel resting on its own base;
      // the previous stand solved this by being 148 mm too long instead.
      expect(stand.neckHeight).toBeGreaterThan(0.05);
      expect(stand.baseTop).toBeCloseTo(DESK.height - monitor.position[1] + stand.baseHeight, 9);
      // The base sits exactly on the surface rather than 12 mm above it.
      expect(monitor.position[1] + stand.deskLocal).toBeCloseTo(DESK.height, 9);
    });
  }
});

describe('the keyboard is a full-size keyboard', () => {
  const caps = buildKeyField();

  it('lays a 104-key ANSI field', () => {
    expect(caps.length).toBe(104);
  });

  it('fills the plate instead of the left half of it', () => {
    const minX = Math.min(...caps.map((cap) => cap.x - cap.width / 2));
    const maxX = Math.max(...caps.map((cap) => cap.x + cap.width / 2));

    // The stunted field reached +0.051 on a plate whose right edge is +0.220:
    // 39% of the board carried no keys. The field now runs to within 6 mm of
    // both edges, which is the bezel a real board has.
    expect(minX).toBeGreaterThanOrEqual(-PLATE.width / 2);
    expect(maxX).toBeLessThanOrEqual(PLATE.width / 2);
    expect(maxX - minX).toBeGreaterThan(PLATE.width * 0.95);
  });

  it('keeps every cap on the plate', () => {
    const off = caps.filter(
      (cap) =>
        cap.x - cap.width / 2 < -PLATE.width / 2 - EPSILON ||
        cap.x + cap.width / 2 > PLATE.width / 2 + EPSILON ||
        cap.z - cap.depth / 2 < -PLATE.depth / 2 - EPSILON ||
        cap.z + cap.depth / 2 > PLATE.depth / 2 + EPSILON,
    );
    expect(off.map((cap) => `${cap.x.toFixed(4)},${cap.z.toFixed(4)}`)).toEqual([]);
  });

  it('never overlaps two caps', () => {
    // 104 boxes placed from hand-written row data. One wrong width and two keys
    // occupy the same cell, which renders as z-fighting rather than as an error.
    const overlaps: string[] = [];
    for (let a = 0; a < caps.length; a += 1) {
      for (let b = a + 1; b < caps.length; b += 1) {
        const first = caps[a]!;
        const second = caps[b]!;
        const dx = Math.abs(first.x - second.x) - (first.width + second.width) / 2;
        const dz = Math.abs(first.z - second.z) - (first.depth + second.depth) / 2;
        if (dx < -EPSILON && dz < -EPSILON) {
          overlaps.push(`${a} and ${b} at ${first.x.toFixed(4)},${first.z.toFixed(4)}`);
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('keeps the real 19.05 mm pitch', () => {
    // The one dimension in the room a viewer knows by heart. It was 40.5 mm two
    // passes ago, which is 2.1x life size.
    expect(KEY_PITCH).toBeCloseTo(0.01905, 5);
    // A 1u cap is a cap, not a cell: the gap between caps has to be real.
    const unitCaps = caps.filter((cap) => Math.abs(cap.width - (KEY_PITCH - 0.0016)) < EPSILON);
    expect(unitCaps.length).toBeGreaterThan(70);
  });

  it('starts the field inside the plate bezel', () => {
    expect(FIELD_X).toBeCloseTo(-PLATE.width / 2 + 0.006, 9);
  });

  it('puts the three indicators on bare plate, not under a keycap', () => {
    // A full-size board has exactly one empty cell: the numpad's function row.
    // That is where Num/Caps/Scroll go, and an indicator under a keycap is a
    // light nobody can see.
    const buried = KEYBOARD_INDICATORS.filter(([x, z]) =>
      caps.some(
        (cap) =>
          Math.abs(cap.x - x) <= cap.width / 2 && Math.abs(cap.z - z) <= cap.depth / 2,
      ),
    );
    expect(buried).toEqual([]);

    // And on the plate rather than off its edge.
    for (const [x, z] of KEYBOARD_INDICATORS) {
      expect(Math.abs(x)).toBeLessThanOrEqual(PLATE.width / 2);
      expect(Math.abs(z)).toBeLessThanOrEqual(PLATE.depth / 2);
    }
  });
});

describe('the cable runs are where the camera can see them', () => {
  const runs = cableRuns();

  it('routes every lead on this desk', () => {
    // Three monitors, a keyboard and a mouse. The reference's desk is full of
    // cable and ours had three that were never in shot.
    expect(runs.map((run) => run.label)).toEqual([
      'left monitor',
      'center monitor',
      'right monitor',
      'keyboard',
      'mouse',
    ]);
  });

  it('uses a real cable gauge', () => {
    // 15 mm across was a garden hose. A display lead is ~6 mm, a peripheral
    // lead ~4 mm, and at ~1.3 m a 6 mm cable still subtends about 5 px.
    for (const run of runs) {
      expect(run.radius).toBeLessThanOrEqual(0.0035);
      expect(run.radius).toBeGreaterThanOrEqual(0.002);
    }
  });

  it('keeps the whole of every run over the desk', () => {
    /*
     * The regression this replaces: every previous run passed through
     * `DESK.z - 0.44` = −0.560, five millimetres in front of a back edge at
     * −0.565, and then dropped to the floor. Sampling the curve rather than its
     * control points is the point — a Catmull-Rom spline overshoots its own
     * handles, and an overshoot past the back edge is a cable hanging in space.
     */
    const strayed: string[] = [];
    for (const run of runs) {
      for (const point of run.curve.getPoints(120)) {
        if (
          point.x < LEFT - EPSILON ||
          point.x > RIGHT + EPSILON ||
          point.z < BACK - EPSILON ||
          point.z > FRONT + EPSILON
        ) {
          strayed.push(
            `${run.label} at ${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}`,
          );
          break;
        }
      }
    }
    expect(strayed).toEqual([]);
  });

  it('never lets a jacket sink into the desk surface', () => {
    /*
     * The jacket, not the centre line. A cable resting on a desk has its centre
     * one radius above it, and a spline that undershoots by more than a radius
     * puts the visible surface of the cable inside the furniture. The first
     * routing did exactly that — a centripetal Catmull-Rom undershot its flat
     * sections by 4.7 mm and buried all three monitor leads.
     *
     * No slack: the jacket is either above the desk top or it is inside it.
     */
    const sunk: string[] = [];
    for (const run of runs) {
      for (const point of run.curve.getPoints(200)) {
        if (point.y - run.radius < SURFACE) {
          sunk.push(
            `${run.label} jacket at y ${(point.y - run.radius).toFixed(4)} ` +
              `against a desk top of ${SURFACE.toFixed(3)}`,
          );
          break;
        }
      }
    }
    expect(sunk).toEqual([]);
  });

  it('terminates every run in the hub rather than near it', () => {
    // The hub box is 0.11 x 0.024 x 0.07, yawed 0.2 rad, centred on HUB. A lead
    // that stops 3 cm short reads as a lead that is not plugged into anything.
    const hub = new THREE.Vector3(...HUB);
    for (const run of runs) {
      const end = run.curve.getPoint(1);
      expect(
        end.distanceTo(hub),
        `${run.label} ends ${end.distanceTo(hub).toFixed(3)} m from the hub`,
      ).toBeLessThan(0.045);
    }
  });

  it('does not pass any lead through any monitor base plate', () => {
    /*
     * Each run has to get from the back of a neck to the front of the desk, and
     * three base plates are in the way. Every run is checked against every base,
     * not just its own: the left monitor's lead crosses the middle of the desk
     * to reach the hub, so the plate it is most likely to clip is not the one it
     * started from.
     *
     * The containment test is done in each base's own rotated frame. An
     * axis-aligned box would quietly pass a yawed monitor — the side stands toe
     * in 0.42 rad, and their world AABBs are 25% wider than the plates are.
     */
    const through: string[] = [];

    for (const run of runs) {
      const points = run.curve.getPoints(200);

      for (const monitor of MONITORS) {
        const stand = monitorStand(monitor);
        const cos = Math.cos(monitor.rotationY);
        const sin = Math.sin(monitor.rotationY);
        const [ox, oy, oz] = monitor.position;

        for (const point of points) {
          const dx = point.x - ox;
          const dz = point.z - oz;
          // Inverse yaw, back into the monitor's local frame.
          const lx = dx * cos - dz * sin;
          const lz = dx * sin + dz * cos;
          const ly = point.y - oy;

          const insideX = Math.abs(lx) <= stand.baseWidth / 2;
          const insideZ =
            lz >= stand.baseZ - stand.baseDepth / 2 && lz <= stand.baseZ + stand.baseDepth / 2;
          const insideY = ly >= stand.deskLocal && ly <= stand.deskLocal + stand.baseHeight;

          if (insideX && insideZ && insideY) {
            through.push(
              `${run.label} enters the ${monitor.id} base at ` +
                `${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)}`,
            );
            break;
          }
        }
      }
    }

    expect(through).toEqual([]);
  });
});
