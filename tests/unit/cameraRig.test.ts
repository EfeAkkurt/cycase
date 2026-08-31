import { beforeEach, describe, expect, it } from 'vitest';

import {
  cameraRig,
  PITCH_DOWN_LIMIT,
  PITCH_UP_LIMIT,
  YAW_LIMIT,
} from '../../src/three/cameraRig';
import { DRAG_SENSITIVITY } from '../../src/three/HeadLookControls';
import { computeMonitorPlacements } from '../../src/three/projection';

/**
 * The seated head-look rig (audit P0.1).
 *
 * The rig is the single source of camera orientation: the WebGL camera reads
 * it in `useFrame`, the DOM monitor homography reads it on every emit, and the
 * scripted glances write to it. Everything the contract promises about the
 * office — the clamps that keep the player in the chair, the easing, the
 * reduced-motion path, `Recenter` — is decided in this file, so it is tested
 * here rather than only through a browser.
 */

const DEGREE = Math.PI / 180;

/** Runs the easing forward in 60 Hz steps until it settles or gives up. */
function settle(maxSteps = 600): number {
  let steps = 0;
  while (cameraRig.update(1 / 60)) {
    steps += 1;
    if (steps > maxSteps) throw new Error('rig never settled');
  }
  return steps;
}

beforeEach(() => {
  cameraRig.setInstant(false);
  cameraRig.reset();
});

describe('clamps', () => {
  it('holds yaw at both extremes however far it is driven', () => {
    cameraRig.setInstant(true);

    cameraRig.lookBy(4 * YAW_LIMIT, 0);
    expect(cameraRig.state.yaw).toBeCloseTo(YAW_LIMIT, 10);

    // And the clamp is not a one-way ratchet: driving back past the other
    // extreme has to stop there too.
    cameraRig.lookBy(-40 * YAW_LIMIT, 0);
    expect(cameraRig.state.yaw).toBeCloseTo(-YAW_LIMIT, 10);
  });

  it('holds the asymmetric pitch limits: +25 up, -20 down', () => {
    cameraRig.setInstant(true);

    cameraRig.lookAt(0, 10);
    expect(cameraRig.state.pitch).toBeCloseTo(PITCH_UP_LIMIT, 10);
    expect(PITCH_UP_LIMIT / DEGREE).toBeCloseTo(25, 6);

    cameraRig.lookAt(0, -10);
    expect(cameraRig.state.pitch).toBeCloseTo(-PITCH_DOWN_LIMIT, 10);
    expect(PITCH_DOWN_LIMIT / DEGREE).toBeCloseTo(20, 6);
  });

  it('is the contract cone: ±55° of yaw', () => {
    expect(YAW_LIMIT / DEGREE).toBeCloseTo(55, 6);
  });

  it('clamps the eased target too, not just the instant one', () => {
    cameraRig.lookBy(9, 9);
    settle();
    expect(cameraRig.state.yaw).toBeCloseTo(YAW_LIMIT, 10);
    expect(cameraRig.state.pitch).toBeCloseTo(PITCH_UP_LIMIT, 10);
  });
});

describe('easing', () => {
  it('converges on the target and then reports settled', () => {
    cameraRig.lookAt(YAW_LIMIT, PITCH_UP_LIMIT);
    expect(cameraRig.state.moving).toBe(true);

    const steps = settle();

    expect(steps).toBeGreaterThan(1); // it eased; it did not jump
    expect(cameraRig.state.moving).toBe(false);
    // Settling snaps exactly onto the target rather than leaving a residue
    // that would keep the demand-render loop awake forever.
    expect(cameraRig.state.yaw).toBe(YAW_LIMIT);
    expect(cameraRig.state.pitch).toBe(PITCH_UP_LIMIT);
  });

  it('moves monotonically toward the target without overshooting', () => {
    cameraRig.lookAt(YAW_LIMIT, 0);

    let previous = cameraRig.state.yaw;
    for (let step = 0; step < 200 && cameraRig.update(1 / 60); step += 1) {
      const { yaw } = cameraRig.state;
      expect(yaw).toBeGreaterThanOrEqual(previous);
      expect(yaw).toBeLessThanOrEqual(YAW_LIMIT);
      previous = yaw;
    }
  });

  it('takes the same wall-clock time whatever the frame rate', () => {
    // Exponential decay, not a per-frame fraction: a 30 Hz machine and a
    // 120 Hz one have to finish the same glance at the same moment, or the
    // scripted door glance lands late on a slow laptop.
    cameraRig.lookAt(YAW_LIMIT, 0);
    for (let step = 0; step < 30; step += 1) cameraRig.update(1 / 30);
    const slow = cameraRig.state.yaw;

    cameraRig.reset();
    cameraRig.lookAt(YAW_LIMIT, 0);
    for (let step = 0; step < 120; step += 1) cameraRig.update(1 / 120);
    const fast = cameraRig.state.yaw;

    expect(slow).toBeCloseTo(fast, 3);
  });

  it('does nothing and reports settled when already on target', () => {
    expect(cameraRig.update(1 / 60)).toBe(false);
    expect(cameraRig.state).toEqual({ yaw: 0, pitch: 0, moving: false });
  });
});

describe('instant mode (reduced motion)', () => {
  it('tracks the target exactly, with no intermediate frames', () => {
    cameraRig.setInstant(true);
    cameraRig.lookAt(0.4, 0.2);

    expect(cameraRig.state.yaw).toBe(0.4);
    expect(cameraRig.state.pitch).toBe(0.2);
    // Nothing left to animate — reduced motion must not schedule frames.
    expect(cameraRig.state.moving).toBe(false);
    expect(cameraRig.update(1 / 60)).toBe(false);
  });

  it('still accumulates relative looks, so head-look works without easing', () => {
    cameraRig.setInstant(true);
    cameraRig.lookBy(0.1, 0);
    cameraRig.lookBy(0.1, 0);
    expect(cameraRig.state.yaw).toBeCloseTo(0.2, 10);
  });

  it('finishes an in-flight eased glance the moment it is switched on', () => {
    cameraRig.lookAt(YAW_LIMIT, 0);
    cameraRig.update(1 / 60);
    expect(cameraRig.state.yaw).toBeLessThan(YAW_LIMIT);

    cameraRig.setInstant(true);
    cameraRig.update(1 / 60);
    expect(cameraRig.state.yaw).toBe(YAW_LIMIT);
    expect(cameraRig.state.moving).toBe(false);
  });
});

describe('recenter and reset', () => {
  it('recenter eases back to dead centre', () => {
    cameraRig.lookAt(YAW_LIMIT, PITCH_UP_LIMIT);
    settle();

    cameraRig.recenter();
    expect(cameraRig.state.moving).toBe(true);
    settle();

    expect(cameraRig.state.yaw).toBe(0);
    expect(cameraRig.state.pitch).toBe(0);
  });

  it('recenter is instant under reduced motion', () => {
    cameraRig.setInstant(true);
    cameraRig.lookAt(YAW_LIMIT, -PITCH_DOWN_LIMIT);
    cameraRig.recenter();
    expect(cameraRig.state).toEqual({ yaw: 0, pitch: 0, moving: false });
  });

  it('reset drops an in-flight glance rather than finishing it', () => {
    cameraRig.lookAt(YAW_LIMIT, PITCH_UP_LIMIT);
    cameraRig.update(1 / 60);
    cameraRig.reset();

    // Both the pose *and* the target are cleared: a scene that remounts must
    // not resume a glance the previous scene started.
    expect(cameraRig.state).toEqual({ yaw: 0, pitch: 0, moving: false });
    expect(cameraRig.update(1 / 60)).toBe(false);
  });
});

describe('subscribers', () => {
  it('delivers the current pose immediately on subscribe', () => {
    cameraRig.setInstant(true);
    cameraRig.lookAt(0.3, 0.1);

    let seen: { yaw: number; pitch: number } | null = null;
    const stop = cameraRig.subscribe((state) => {
      seen = { yaw: state.yaw, pitch: state.pitch };
    });
    stop();

    expect(seen).toEqual({ yaw: 0.3, pitch: 0.1 });
  });

  it('emits every eased step, so the DOM projection is never left behind', () => {
    const seen: number[] = [];
    const stop = cameraRig.subscribe((state) => seen.push(state.yaw));
    seen.length = 0; // discard the immediate replay

    cameraRig.lookAt(YAW_LIMIT, 0);
    const steps = settle();
    stop();

    // At least one emit per eased step — the overlay gets every intermediate
    // pose, not just the start and the end.
    expect(seen.length).toBeGreaterThanOrEqual(steps);
    expect(new Set(seen).size).toBeGreaterThan(20);
    expect(seen.at(-1)).toBe(YAW_LIMIT);
  });

  it('hands a subscriber exactly the pose update() just committed', () => {
    /*
     * This is the invariant the contract's 2 px alignment rests on. The WebGL
     * camera reads `cameraRig.state` immediately after `update()` returns; the
     * DOM homography reads the state handed to the subscriber *inside* that
     * same call. If those two could ever differ, the interface would sit a
     * frame behind the glass it is painted on.
     */
    cameraRig.lookAt(YAW_LIMIT, PITCH_UP_LIMIT);
    let delivered: { yaw: number; pitch: number } | null = null;
    const stop = cameraRig.subscribe((state) => {
      delivered = { yaw: state.yaw, pitch: state.pitch };
    });

    for (let step = 0; step < 10; step += 1) {
      cameraRig.update(1 / 60);
      const committed = cameraRig.state;
      expect(delivered).toEqual({ yaw: committed.yaw, pitch: committed.pitch });
    }

    stop();
  });

  it('stops delivering once unsubscribed', () => {
    let emits = 0;
    const stop = cameraRig.subscribe(() => {
      emits += 1;
    });
    stop();
    const after = emits;

    cameraRig.lookAt(0.2, 0);
    expect(emits).toBe(after);
  });
});

/**
 * The DOM overlay and the render camera are two consumers of one rig sample.
 * These check the half of that contract that lives in pure maths: the same
 * sample always projects to the same pixels, and the tolerance the contract
 * sets is tight enough to matter.
 */
describe('the monitor projection follows the rig', () => {
  const WIDTH = 1440;
  const HEIGHT = 900;

  /** Where the centre of a projected panel lands, in CSS pixels. */
  function panelCentre(yaw: number, pitch: number): { x: number; y: number } {
    const placement = computeMonitorPlacements(WIDTH, HEIGHT, yaw, pitch).find(
      (entry) => entry.id === 'center',
    );
    if (!placement) throw new Error('centre monitor was not projected');

    const values = placement.transform.slice('matrix3d('.length, -1).split(',').map(Number);
    const [m0, m1, , m3, m4, m5, , m7, , , , , m12, m13, , m15] = values as number[];
    const x = placement.width / 2;
    const y = placement.height / 2;
    const w = m3! * x + m7! * y + m15!;
    return { x: (m0! * x + m4! * y + m12!) / w, y: (m1! * x + m5! * y + m13!) / w };
  }

  it('is a pure function of the sample: the same pose gives the same pixels', () => {
    const yaw = 0.21;
    const pitch = -0.07;
    expect(computeMonitorPlacements(WIDTH, HEIGHT, yaw, pitch)).toEqual(
      computeMonitorPlacements(WIDTH, HEIGHT, yaw, pitch),
    );
    expect(panelCentre(yaw, pitch)).toEqual(panelCentre(yaw, pitch));
  });

  it('moves the monitors the way a turning head would', () => {
    // Positive yaw is a look to the *left*, so the monitors slide right.
    expect(panelCentre(0.15, 0).x).toBeGreaterThan(panelCentre(0, 0).x);
    expect(panelCentre(-0.15, 0).x).toBeLessThan(panelCentre(0, 0).x);
    // Looking up slides them down the screen.
    expect(panelCentre(0, 0.1).y).toBeGreaterThan(panelCentre(0, 0).y);
  });

  it('costs 2 px for every 0.13° the overlay is behind the camera', () => {
    /*
     * The contract allows 2 px of drift between the DOM surface and the bezel
     * it sits on, at 1440x900. This is what that budget is worth in angle: the
     * centre panel moves ~15 px per degree of yaw, so the whole allowance is
     * spent by 0.13° of staleness.
     */
    const centred = panelCentre(0, 0);
    const pixelsPerDegree = Math.hypot(
      panelCentre(DEGREE, 0).x - centred.x,
      panelCentre(DEGREE, 0).y - centred.y,
    );
    expect(2 / pixelsPerDegree).toBeLessThan(0.2);

    /*
     * And this is what a *single frame* of lag would cost. An unhurried drag
     * moves the pointer ~12 px per frame, which the drag sensitivity turns
     * into 1.7° — an order of magnitude outside tolerance. That is why the
     * render camera and the homography read one rig sample instead of
     * sampling the rig independently.
     */
    const oneFrameOfDrag = 12 * DRAG_SENSITIVITY;
    const stale = panelCentre(oneFrameOfDrag, 0);
    expect(Math.hypot(stale.x - centred.x, stale.y - centred.y)).toBeGreaterThan(20);

    // Same sample, same pixels: the drift the app actually incurs is zero.
    expect(panelCentre(oneFrameOfDrag, 0)).toEqual(stale);
  });

  it('keeps the centre monitor projected right across the head-look cone', () => {
    /*
     * At the yaw clamp the far side monitor has swung past 90° off the view
     * axis and is dropped rather than projected to nonsense — that is the
     * `behindCamera` guard doing its job. The centre monitor, which carries the
     * alarm and the acknowledge control, has to survive every pose in the cone.
     */
    for (const yaw of [-YAW_LIMIT, -0.5, 0, 0.5, YAW_LIMIT]) {
      for (const pitch of [-PITCH_DOWN_LIMIT, 0, PITCH_UP_LIMIT]) {
        const placements = computeMonitorPlacements(WIDTH, HEIGHT, yaw, pitch);
        expect(
          placements.map((entry) => entry.id),
          `yaw ${yaw} pitch ${pitch}`,
        ).toContain('center');
        for (const placement of placements) {
          expect(placement.transform).not.toMatch(/NaN|Infinity/);
        }
      }
    }
  });
});
