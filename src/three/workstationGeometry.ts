/**
 * The pure geometry of the modelled workstation hardware.
 *
 * Split out of `Workstation.tsx` for the same reason `projection.ts` is split
 * out of the canvas: this is arithmetic, and arithmetic can be checked without a
 * browser. The defects this module was written to fix were all invisible to the
 * pixel gates — a monitor base cantilevered off the back of the desk, a neck
 * running down through the desk top, a key field covering 61% of its own plate,
 * three cable runs routed entirely out of shot. None of those change a
 * luminance histogram enough to trip anything, and all of them are obvious to
 * anyone who looks at the numbers.
 *
 * `tests/unit/workstation.test.ts` looks at the numbers.
 *
 * Nothing here reads `screen.width`, `screen.height` or `bezel` for placement:
 * the DOM projection, the alarm rim and the focal-hierarchy quad key off those,
 * and this module must never be able to move them.
 */
import * as THREE from 'three';

import { DESK, MONITORS, monitorStand, type MonitorSpec } from './layout';

export const SURFACE = DESK.height;

/**
 * Where every lead on this desk terminates. Drawn by `DeskClutter`, aimed at by
 * `Cables` — one constant, because a hub the cables miss is worse than no hub.
 *
 * Pulled in from x 0.90: the desk is 1.880 m wide, so its right edge is at
 * 0.940, and a 0.11 m box centred on 0.90 and yawed 0.2 rad reached 0.955.
 */
export const HUB: [number, number, number] = [0.86, SURFACE + 0.013, DESK.z - 0.04];

/** Key pitch, in metres. 19.05 mm, and it has been 19.05 mm since 1984. */
export const KEY_PITCH = 0.01905;
/** A 1u cap is 17.45 mm across a 19.05 mm cell; the rest is the gap you see. */
export const CAP_GAP = 0.0016;
/** Plate footprint. A full-size board is 440 x 145 mm, and so is this one. */
export const PLATE = { width: 0.44, depth: 0.145, height: 0.014 };
/** Left edge of the first key cell: 6 mm of bezel inside the plate. */
export const FIELD_X = -PLATE.width / 2 + 0.006;

/** A cell in a key row: `w` in units, `before` an empty gap in units. */
interface Cell {
  w: number;
  before?: number;
  /** Row span, for the numpad's tall `+` and `Enter`. */
  tall?: boolean;
  /** Worn legends read lighter than their neighbours. */
  accent?: boolean;
}

const oneU = (count: number): Cell[] => Array.from({ length: count }, () => ({ w: 1 }));

/**
 * The main block, ANSI 104. Every row is exactly 15u wide, which is what makes
 * a keyboard look like a keyboard: the modifiers on the left and right ends line
 * up down the board because their widths are chosen to make the row close.
 */
const MAIN_ROWS: Cell[][] = [
  // Esc, then the three groups of four function keys.
  [
    { w: 1, accent: true },
    { w: 1, before: 1 }, { w: 1 }, { w: 1 }, { w: 1 },
    { w: 1, before: 0.5 }, { w: 1 }, { w: 1 }, { w: 1 },
    { w: 1, before: 0.5 }, { w: 1 }, { w: 1 }, { w: 1 },
  ],
  [...oneU(13), { w: 2 }], // number row + Backspace
  [{ w: 1.5 }, ...oneU(12), { w: 1.5 }], // Tab .. backslash
  [{ w: 1.75 }, ...oneU(11), { w: 2.25, accent: true }], // Caps .. Enter
  [{ w: 2.25 }, ...oneU(10), { w: 2.75 }], // shift row
  [
    { w: 1.25 }, { w: 1.25 }, { w: 1.25 }, { w: 6.25 },
    { w: 1.25 }, { w: 1.25 }, { w: 1.25 }, { w: 1.25 },
  ],
];

/** The navigation island, 3u wide. Empty rows are empty on a real board too. */
const NAV_ROWS: (Cell[] | null)[] = [
  oneU(3), // PrtSc ScrLk Pause
  oneU(3), // Ins Home PgUp
  oneU(3), // Del End PgDn
  null,
  [{ w: 1, before: 1 }], // the up arrow, centred over the three below
  oneU(3), // left down right
];

/** The numpad, 4u wide. `tall` keys span this row and the one after it. */
const PAD_ROWS: (Cell[] | null)[] = [
  null,
  oneU(4), // NumLk / * -
  [{ w: 1 }, { w: 1 }, { w: 1 }, { w: 1, tall: true }], // 7 8 9 +
  oneU(3), // 4 5 6
  [{ w: 1 }, { w: 1 }, { w: 1 }, { w: 1, tall: true }], // 1 2 3 Enter
  [{ w: 2 }, { w: 1, before: 0 }], // 0 and the decimal point
];

export interface Cap {
  x: number;
  z: number;
  width: number;
  depth: number;
  accent: boolean;
}

/**
 * Lays a full-size key field onto the plate.
 *
 * The previous field was 59 caps on a 5-row grid that started at x −0.205 and
 * stopped at +0.051 — on a plate spanning ±0.22. The right-hand 39% of the board
 * had no keys on it at all, and what showed through instead was bare tiling
 * metal-plate texture, in the nearest and most-read band of the picture.
 *
 * The pitch was already right (19.05 mm, fixed in the previous pass). What was
 * missing was the rest of the keyboard: a function row, the navigation island
 * and the numpad. All three are here, and the row widths are the real ANSI ones,
 * so the modifier columns line up the way a viewer's memory expects.
 */
/**
 * Row centres, back to front: the function row, a 1.3u gap, then the five main
 * rows at one pitch each. The block sits 7 mm inside the plate's back edge and
 * leaves 18 mm of front lip, which is the proportion a real board has.
 */
const ROW_Z = [-0.0565, -0.031735, -0.012685, 0.006365, 0.025415, 0.044465];

export function buildKeyField(): Cap[] {
  const caps: Cap[] = [];
  const rowZ = ROW_Z;

  const layRow = (cells: Cell[] | null, originX: number, row: number) => {
    if (!cells) return;
    let cursor = originX;
    for (const cell of cells) {
      cursor += (cell.before ?? 0) * KEY_PITCH;
      const width = cell.w * KEY_PITCH - CAP_GAP;
      const depth = (cell.tall ? 2 : 1) * KEY_PITCH - CAP_GAP;
      const z = cell.tall ? (rowZ[row]! + rowZ[row + 1]!) / 2 : rowZ[row]!;
      caps.push({ x: cursor + (cell.w * KEY_PITCH) / 2, z, width, depth, accent: cell.accent === true });
      cursor += cell.w * KEY_PITCH;
    }
  };

  const navX = FIELD_X + 15.25 * KEY_PITCH;
  const padX = navX + 3.25 * KEY_PITCH;

  for (let row = 0; row < rowZ.length; row += 1) {
    layRow(MAIN_ROWS[row]!, FIELD_X, row);
    layRow(NAV_ROWS[row]!, navX, row);
    layRow(PAD_ROWS[row]!, padX, row);
  }

  return caps;
}

/**
 * Num / Caps / Scroll, in the numpad's empty function-row cell — the one place
 * on a full-size plate that has no key over it, and where a real board puts
 * them. Derived from the field rather than repeated beside it, so a change to
 * the layout cannot leave three indicators floating over the `7` key.
 */
export const KEYBOARD_INDICATORS: [number, number][] = [0, 1, 2].map((index) => [
  FIELD_X + 19.5 * KEY_PITCH + index * 0.009,
  ROW_Z[0]!,
]);

/** Where the mouse sits, and how far it is turned. Its lead starts at its nose. */
export const MOUSE_ORIGIN: [number, number, number] = [0.46, SURFACE + 0.0015, DESK.z + 0.19];
export const MOUSE_YAW = -0.12;

/** One cable: the path it takes, and how thick the jacket is. */
export interface CableRun {
  label: string;
  curve: THREE.CatmullRomCurve3;
  radius: number;
}

/**
 * Every lead on the desk, routed where the seated camera can see it.
 *
 * The previous runs were not missing; they were out of shot. All three passed
 * through `DESK.z - 0.44`, which is world z −0.560, and the shipped desk's back
 * edge is at −0.565 — so each one dropped over the back edge within 5 mm of
 * leaving the stand and spent the rest of its length behind an opaque desk, on a
 * floor the seated camera cannot see. Three tube meshes drawn every frame, of
 * which the frame contained almost nothing.
 *
 * So the routing changed rather than the idea. Each run leaves the back of its
 * own neck (`monitorStand().cableAnchor`, rather than a copied literal), drops
 * behind the base, comes out past its edge and crosses the strip of desk *in
 * front of* the bases — the band the seated camera looks straight down at
 * through the two gaps between the three panels — before converging on the hub.
 * `side` steers each run round its own base plate.
 *
 * The gauge is real too. A DisplayPort lead is about 6 mm across and a
 * peripheral lead about 4 mm, against the 15 mm these used to be; at this
 * distance 6 mm still subtends roughly 5 px, so the honest size is also a
 * visible one.
 */
export function cableRuns(): CableRun[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  /** Display leads and peripheral leads, in metres. */
  const DISPLAY_RADIUS = 0.0032;
  const PERIPHERAL_RADIUS = 0.0022;

  /**
   * A cable lying on the desk has its centre one radius above it, so its jacket
   * touches — the difference between a lead resting on a surface and one
   * hovering over it.
   *
   * Plus 1.5 mm, which is not a fudge but a measured allowance: even at tension
   * 0.25 the spline joining the flat sections still undershoots them by about a
   * millimetre, and a jacket that dips into the desk is a worse artefact than
   * one that rests half a millimetre proud of it. `workstation.test.ts` samples
   * 200 points per run and holds the jacket above the surface.
   */
  const resting = (radius: number) => SURFACE + radius + 0.0015;

  /**
   * Tension 0.25 rather than the default centripetal spline.
   *
   * A cable run is nearly taut between the points that hold it, and a
   * centripetal Catmull-Rom is not: sampled, it undershot the flat sections by
   * 4.7 mm, which put all three monitor leads 0.7 mm *inside* the desk. Lower
   * tension both looks more like cable and keeps the curve inside the hull of
   * the points that were chosen deliberately.
   */
  const path = (points: THREE.Vector3[]) =>
    new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.25);

  /*
   * Built in the monitor's own frame and taken into the room at the end.
   *
   * Worth being explicit about, because the first version of this was written in
   * world coordinates with hand-picked offsets and it was wrong twice: the
   * centre run passed through its own base plate at x 0.125 (the plate's
   * half-width is 0.1253), and its sag point overshot the desk's back edge by a
   * spline's worth of curvature. Both were found by
   * `tests/unit/workstation.test.ts` rather than by looking, which is the whole
   * argument for putting this arithmetic somewhere a test can reach it.
   *
   * Locally, "clear of the base" is one subtraction and it holds for a yawed
   * stand exactly as it does for a square-on one.
   */
  const fromMonitor = (monitor: MonitorSpec, side: number) => {
    const onDesk = resting(DISPLAY_RADIUS);
    const stand = monitorStand(monitor);
    const yaw = new THREE.Euler(0, monitor.rotationY, 0);
    const origin = v(...monitor.position);
    const local = (lx: number, ly: number, lz: number) =>
      new THREE.Vector3(lx, ly, lz).applyEuler(yaw).add(origin);

    /** Past the edge of the base plate, in the plate's own frame. */
    const clear = side * (stand.baseWidth / 2 + 0.03);
    const wide = side * (stand.baseWidth / 2 + 0.05);
    const onDeskLocal = stand.deskLocal + DISPLAY_RADIUS + 0.0015;

    return path([
      local(...stand.cableAnchor),
      // out from behind the neck and down past the edge of the base
      local(clear, stand.chinBottom - 0.09, stand.cableAnchor[2] + 0.004),
      // onto the desk, beside the base rather than through it
      local(clear, onDeskLocal, stand.baseZ - stand.baseDepth / 2 + 0.03),
      // forward into the strip the seated camera looks straight down at
      local(wide, onDeskLocal, stand.baseZ + stand.baseDepth / 2 + 0.05),
      v(0.62, onDesk, DESK.z - 0.14),
      v(HUB[0] - 0.02, HUB[1] - 0.004, HUB[2] - 0.02),
    ]);
  };

  const flat = resting(PERIPHERAL_RADIUS);

  const keyboard = path([
    v(0.02, SURFACE + 0.012, DESK.z + 0.19 - PLATE.depth / 2),
    v(0.16, flat, DESK.z + 0.09),
    v(0.44, flat, DESK.z + 0.02),
    v(0.72, flat, DESK.z - 0.05),
    v(HUB[0] - 0.03, HUB[1] - 0.006, HUB[2] + 0.01),
  ]);

  /*
   * The lead leaves the far end of the mouse, not the near one. It used to
   * anchor at +46 mm — the end under the player's palm — which is the wrong end
   * of a mouse and read as a tail.
   */
  const mouse = path([
    v(MOUSE_ORIGIN[0], SURFACE + 0.013, MOUSE_ORIGIN[2] - 0.046),
    v(MOUSE_ORIGIN[0] + 0.09, flat, MOUSE_ORIGIN[2] - 0.05),
    v(MOUSE_ORIGIN[0] + 0.24, flat, MOUSE_ORIGIN[2] - 0.03),
    v(HUB[0] + 0.02, flat, DESK.z + 0.02),
    v(HUB[0] + 0.01, HUB[1] - 0.006, HUB[2] + 0.02),
  ]);

  return [
    ...MONITORS.map((monitor, index) => ({
      label: `${monitor.id} monitor`,
      curve: fromMonitor(monitor, [1, 1, -1][index] ?? 1),
      radius: DISPLAY_RADIUS,
    })),
    { label: 'keyboard', curve: keyboard, radius: PERIPHERAL_RADIUS },
    { label: 'mouse', curve: mouse, radius: PERIPHERAL_RADIUS },
  ];
}

