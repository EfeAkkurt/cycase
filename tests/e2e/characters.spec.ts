import * as THREE from 'three';
import { expect, test, type Page } from '@playwright/test';

import {
  COLLEAGUE_POINT_END,
  COLLEAGUE_POINT_MAX_OFFSET,
} from '../../src/three/Colleague';
import { CHARACTER_ANCHORS, MONITORS, type MonitorSpec } from '../../src/three/layout';
import { createCamera } from '../../src/three/projection';

/**
 * Audit contract P0.3 — the one character in the room.
 *
 * The contract was written for two, the colleague and the robot companion; the
 * robot is gone, so every claim below is now about her alone. Three of them,
 * measured rather than eyeballed:
 *
 * 1. Nobody arrives before the alarm is acknowledged. Presence is measured off
 *    the rendered pixels, not off the state machine — the machine already has
 *    its own coverage in `alarm-flow.spec.ts`, and the audit's complaint was
 *    about what is on screen.
 * 2. She stays clear of the projected monitor DOM at 1440x900 and 1280x720.
 *    The clearance is computed with `createCamera` — the very function the app
 *    projects its monitor surfaces with — and the test first proves that camera
 *    agrees with the live page before trusting it.
 * 3. The evidence captures land in `docs/screenshots/`.
 */

/**
 * The framing her report is measured in is *read*, never assumed.
 *
 * This file used to carry `const REPORT_YAW = -((38 * Math.PI) / 180) * 0.45`
 * — a copy of a number in `src/ui/office/Office.tsx`, kept in sync by hand,
 * because the office held a 17.1° turn toward the doorway for the whole of her
 * report and she was staged against that turn. Two files agreeing on a magic
 * number by hand is the smaller problem. The larger one is what it hid: a
 * player who pressed Home, or came back from the dashboard, was looking at the
 * *centred* frame, and in the centred frame she was entirely off the right-hand
 * edge — while every assertion here passed, because they all projected with the
 * turned camera she was staged for.
 *
 * The office frames her report at yaw 0 now, and this reads the live
 * `data-yaw` the page publishes rather than reproducing the choreography. If
 * the office ever changes its framing again, these assertions follow it instead
 * of quietly describing a shot nobody sees.
 */
async function liveFraming(page: Page): Promise<{ yaw: number; pitch: number }> {
  const pose = await page.locator('.office3d').evaluate((element) => {
    const host = element as HTMLElement;
    return { yaw: Number(host.dataset.yaw), pitch: Number(host.dataset.pitch) };
  });
  expect(Number.isFinite(pose.yaw), 'the office is not publishing data-yaw').toBe(true);
  expect(Number.isFinite(pose.pitch), 'the office is not publishing data-pitch').toBe(true);
  // Degrees on the wire, radians in the projection.
  return { yaw: (pose.yaw * Math.PI) / 180, pitch: (pose.pitch * Math.PI) / 180 };
}

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

function describe(rect: Rect): string {
  return `x[${rect.x0.toFixed(0)},${rect.x1.toFixed(0)}] y[${rect.y0.toFixed(0)},${rect.y1.toFixed(0)}]`;
}

/** The four screen-plane corners of one monitor, in world space. */
function screenCorners(monitor: MonitorSpec): THREE.Vector3[] {
  const halfWidth = monitor.screen.width / 2;
  const halfHeight = monitor.screen.height / 2;
  const rotation = new THREE.Euler(0, monitor.rotationY, 0);
  const origin = new THREE.Vector3(...monitor.position);
  return (
    [
      [-halfWidth, halfHeight],
      [halfWidth, halfHeight],
      [halfWidth, -halfHeight],
      [-halfWidth, -halfHeight],
    ] as const
  ).map(([x, y]) => new THREE.Vector3(x, y, 0).applyEuler(rotation).add(origin));
}

function project(
  camera: THREE.PerspectiveCamera,
  point: THREE.Vector3,
  width: number,
  height: number,
): { x: number; y: number } {
  const ndc = point.clone().project(camera);
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
}

function monitorRect(
  camera: THREE.PerspectiveCamera,
  monitor: MonitorSpec,
  width: number,
  height: number,
): Rect & { id: string } {
  const points = screenCorners(monitor).map((corner) => project(camera, corner, width, height));
  return {
    id: monitor.id,
    x0: Math.min(...points.map((p) => p.x)),
    x1: Math.max(...points.map((p) => p.x)),
    y0: Math.min(...points.map((p) => p.y)),
    y1: Math.max(...points.map((p) => p.y)),
  };
}

/**
 * Projects a world-space sphere to a screen-aligned box.
 *
 * The radius is measured along the camera's own right and up axes, so the box
 * covers the sphere at any position in a wide-angle frame rather than assuming
 * the projection is uniform across it.
 */
function anchorRect(
  camera: THREE.PerspectiveCamera,
  anchor: { position: readonly [number, number, number]; radius: number },
  width: number,
  height: number,
): Rect {
  const centre = new THREE.Vector3(...anchor.position);
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());

  const middle = project(camera, centre, width, height);
  const side = project(camera, centre.clone().addScaledVector(right, anchor.radius), width, height);
  const top = project(camera, centre.clone().addScaledVector(up, anchor.radius), width, height);
  const radius = Math.max(Math.abs(side.x - middle.x), Math.abs(top.y - middle.y));

  return {
    x0: middle.x - radius,
    x1: middle.x + radius,
    y0: middle.y - radius,
    y1: middle.y + radius,
  };
}

/** The office viewport, in page coordinates. */
async function officeBox(page: Page) {
  const box = await page.locator('.office3d').boundingBox();
  expect(box, 'the 3D office did not mount').not.toBeNull();
  return box!;
}


/**
 * Share of pixels whose luma moved by more than a just-noticeable amount.
 *
 * A share, not a mean: a figure walking into a patch changes a large fraction
 * of it a lot, while a lighting change nudges all of it a little.
 */
/** Mean Rec. 601 luma over a patch. */

/**
 * Waits until the head-look rig has stopped moving.
 *
 * The office eases the camera to the doorway while the colleague walks in and
 * eases it back once she has reported, and a measurement taken mid-glance is a
 * measurement of the glance. This is not a convenience: the presence test below
 * compares two patches, and while the camera is turning *every* patch changes,
 * which is enough to sink a differential assertion that is otherwise sound.
 */
async function settled(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.locator('.office3d').evaluate((element) => {
          const host = element as HTMLElement;
          return `${host.dataset.settled}/${Number(host.dataset.yaw).toFixed(1)}/${Number(host.dataset.pitch).toFixed(1)}`;
        }),
      { timeout: 20_000 },
    )
    .toBe('true/0.0/0.0');
}




async function openOffice(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
  // The office streams ten glTF props plus the character; wait for the
  // projected surfaces before measuring anything.
  await expect
    .poll(async () => page.locator('.office3d__screen').count(), { timeout: 20_000 })
    .toBe(3);
  await page.waitForTimeout(2000);
}

const REVIEW_SIZES = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '1280x720', width: 1280, height: 720 },
];

test.describe('characters (P0.3)', () => {
  test.slow();

  test('the colleague is absent before acknowledgement and settled for her report after', async ({
    page,
  }) => {
    await openOffice(page);

    /*
     * This asserts the product rule and captures the evidence for the part it
     * cannot assert.
     *
     * Four framings of a pixel gate on her were tried, and each measured
     * something other than her. A before/after diff of her patch measured the
     * camera glancing at the doorway (her 2.3%, the control 65.9%). Recentring
     * fixed that and left the alarm's red spill going out, which moves the
     * entire frame — measured, 314,923 pixels change between the two moments,
     * with a bounding box of the whole viewport. Comparing her patch against the
     * wall beside it in one frame measured the rack's indicator LEDs, which
     * differ from a wall by 77% with nobody standing there. And the lit band on
     * her — face and collar — is narrow enough that moving the sample 5 cm up
     * lands on dark hair and reads 2%.
     *
     * A threshold lowered until it passes is not evidence, so there is none
     * here. What there is: the state machine's own account, asserted exactly,
     * and a capture written for the human review the audit requires
     * ("a human visual review explicitly signs off composition, material
     * quality, scale and animation; luminance/pixel classifiers alone cannot
     * close this gate").
     */
    expect(
      await page.locator('.office3d').getAttribute('data-colleague-phase'),
      'someone is on stage before the alarm was acknowledged',
    ).toBe('hidden');

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.getByRole('button', { name: 'Open response console' }).waitFor({ timeout: 30_000 });
    await settled(page);

    expect(
      await page.locator('.office3d').getAttribute('data-colleague-phase'),
      'she never settled into her report pose',
    ).toBe('settled');

    // Turned toward her, so the review capture shows the whole figure rather
    // than the sliver the seated forward view leaves at the frame edge.
    await page.locator('.office3d__canvas').focus();
    for (let press = 0; press < 9; press += 1) {
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(90);
    }
    // `settled()` also requires the centred pose, which is exactly what we have
    // just left; wait for the easing alone.
    await expect
      .poll(
        async () =>
          page
            .locator('.office3d')
            .evaluate((element) => (element as HTMLElement).dataset.settled ?? 'missing'),
        { timeout: 15_000 },
      )
      .toBe('true');
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'docs/screenshots/review-colleague-report.png' });
  });

  for (const size of REVIEW_SIZES) {
    test(`characters stay clear of the monitor surfaces at ${size.label}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: size.width, height: size.height });
      await openOffice(page);

      await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
      await page.getByRole('button', { name: 'Open response console' }).waitFor({ timeout: 30_000 });
      // The head-look rig eases back to centre once she has settled; the
      // projection below assumes it has arrived there.
      await page.waitForTimeout(2500);

      const box = await officeBox(page);
      const camera = createCamera(box.width, box.height);

      /*
       * Before trusting this camera to say where a character renders, prove it
       * is the page's camera: project the three monitor quads and compare with
       * the surfaces the app actually laid out. Both sides are axis-aligned
       * boxes — the DOM ones carry a `matrix3d`, so `boundingBox()` already
       * hands back the AABB of the transformed element.
       */
      const surfaces = page.locator('.office3d__screen');
      await expect(surfaces).toHaveCount(3);

      const domRects: Rect[] = [];
      for (let index = 0; index < 3; index += 1) {
        const rect = await surfaces.nth(index).boundingBox();
        expect(rect).not.toBeNull();
        domRects.push({
          x0: rect!.x - box.x,
          y0: rect!.y - box.y,
          x1: rect!.x - box.x + rect!.width,
          y1: rect!.y - box.y + rect!.height,
        });
      }

      const projected = MONITORS.map((monitor) => monitorRect(camera, monitor, box.width, box.height));
      // Both lists are left-to-right; the overlay renders in `MONITORS` order.
      for (const [index, expected] of projected.entries()) {
        const actual = domRects[index]!;
        for (const edge of ['x0', 'y0', 'x1', 'y1'] as const) {
          expect(
            Math.abs(actual[edge] - expected[edge]),
            `${expected.id} ${edge}: test camera ${expected[edge].toFixed(1)} vs page ${actual[edge].toFixed(1)} — ` +
              'the projection in this spec is not the projection the app used',
          ).toBeLessThanOrEqual(3);
        }
      }

      /*
       * Now the actual claim, at the centred pose.
       *
       * The office frames her report at yaw 0, so this and the report framing
       * below are normally the same shot — which is the point. They were
       * different shots before, she was staged only for the turned one, and the
       * centred one had her off the edge of the screen.
       */
      const characters = {
        colleagueCrown: anchorRect(camera, CHARACTER_ANCHORS.colleagueCrown, box.width, box.height),
        colleagueHead: anchorRect(camera, CHARACTER_ANCHORS.colleagueHead, box.width, box.height),
      };

      for (const [name, rect] of Object.entries(characters)) {
        // Readable means on screen at all, first.
        expect(rect.x0, `${name} is off the left edge: ${describe(rect)}`).toBeGreaterThan(0);
        expect(rect.x1, `${name} is off the right edge: ${describe(rect)}`).toBeLessThan(box.width);
        expect(rect.y0, `${name} is above the frame: ${describe(rect)}`).toBeGreaterThan(0);
        expect(rect.y1, `${name} is below the frame: ${describe(rect)}`).toBeLessThan(box.height);

        for (const surface of domRects) {
          expect(
            intersects(rect, surface),
            `${name} ${describe(rect)} overlaps a monitor surface ${describe(surface)} at ${size.label}`,
          ).toBe(false);
        }
      }

      /*
       * And again at the framing the player is actually looking at while she
       * speaks — read off the page rather than reproduced from the office's
       * choreography. See `liveFraming` for what that hard-coded copy hid.
       */
      const framing = await liveFraming(page);
      const reportCamera = createCamera(box.width, box.height, framing.yaw, framing.pitch);
      const reportMonitors = MONITORS.map((monitor) =>
        monitorRect(reportCamera, monitor, box.width, box.height),
      );

      /*
       * Everything the report beat needs the player to see.
       *
       * `colleagueBust` is checked for *frame* only and not for monitor
       * clearance, and that asymmetry is the honest form of the claim rather
       * than a relaxation of it. She is a 1.7 m person standing behind a desk
       * with three panels on it: her shoulder joint is at world y 1.017 and the
       * interface stops occluding her only above y≈1.29, so her lower torso is
       * behind the glass at every position in this room. What is promised, and
       * asserted here, is her crown, her face, her raised hand — and that all
       * three are inside the picture at both review sizes.
       */
      const mustClear = ['colleagueCrown', 'colleagueHead', 'colleaguePoint'] as const;
      const mustBeInFrame = [...mustClear, 'colleagueBust'] as const;

      for (const key of mustBeInFrame) {
        const rect = anchorRect(reportCamera, CHARACTER_ANCHORS[key], box.width, box.height);
        expect(rect.x0, `report framing: ${key} off the left edge ${describe(rect)}`).toBeGreaterThan(0);
        expect(rect.x1, `report framing: ${key} off the right edge ${describe(rect)}`).toBeLessThan(box.width);
        expect(rect.y0, `report framing: ${key} above the frame ${describe(rect)}`).toBeGreaterThan(0);
        expect(rect.y1, `report framing: ${key} below the frame ${describe(rect)}`).toBeLessThan(box.height);
      }

      for (const key of mustClear) {
        const rect = anchorRect(reportCamera, CHARACTER_ANCHORS[key], box.width, box.height);
        for (const surface of reportMonitors) {
          expect(
            intersects(rect, surface),
            `at the report framing (yaw ${((framing.yaw * 180) / Math.PI).toFixed(1)}°) ` +
              `${key} ${describe(rect)} is behind the ${surface.id} monitor ` +
              `${describe(surface)} at ${size.label}`,
          ).toBe(false);
        }
      }

      await page.screenshot({ path: `docs/screenshots/characters-${size.label}.png` });
    });
  }
});

/**
 * The rig itself, not the pixels it lights.
 *
 * A player reported the colleague tumbling, her torso rotating and her bones
 * deforming. Every character test above measures pixels — is she visible, does
 * she overlap a monitor, is her patch lit — and not one of them could see it,
 * because a figure rotated through two full turns lights the same pixels as a
 * figure standing still.
 *
 * So this measures the invariant where it lives. The additive posture layer
 * multiplies a bounded offset onto whatever the mixer has just written. If that
 * is genuinely an offset, each bone stays within a few tenths of a radian of
 * its rest pose forever. If the mixer is not writing a bone the layer touches,
 * the same multiply lands on its own previous result and compounds at frame
 * rate, without bound. The two cases are trivially separable by watching one
 * number over time, and indistinguishable by looking at a screenshot.
 */
test.describe('the colleague is posed, not accumulated (report of tumbling)', () => {
  /*
   * The posture layer's own declared amplitudes add to well under a third of a
   * radian: 0.18 lean + 0.044 breath + 0.02 sway on the torso, 0.16 on the
   * neck, 0.45*point on the head. A third of a radian is generous headroom over
   * that and still an order of magnitude below the full turns the accumulation
   * bug produced.
   */
  const OFFSET_LIMIT = 0.6;

  async function worstDeviation(page: Page): Promise<number> {
    return page.evaluate(() => window.__CYCASE_CHARACTER__?.worstDeviation() ?? -1);
  }

  test('the additive posture layer stays an offset and never accumulates', async ({ page }) => {
    test.setTimeout(120_000);
    await openOffice(page);

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await expect
      .poll(async () => page.locator('.office3d').getAttribute('data-colleague-phase'), {
        timeout: 40_000,
      })
      .toBe('settled');

    /*
     * The pointing beat first, on its own bound.
     *
     * She raises an arm when she settles, and `POINT_POSE.lift` is 2.45 radians
     * — a deliberate offset an order of magnitude past anything standing
     * produces. Sampling straight after `settled` caught the arm mid-gesture and
     * read 2.438 as accumulation, which is the one thing it is not: it is the
     * pose the animation was written to reach, it is bounded by the pose's own
     * values, and it returns. Raising OFFSET_LIMIT to cover it would have blinded
     * the test to the defect it exists for, so the gesture gets its own bound
     * instead and stays under test rather than being waited out silently.
     */
    const duringGesture: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      duringGesture.push(await worstDeviation(page));
      await page.waitForTimeout(1200);
    }
    const gestureReport = duringGesture.map((value) => value.toFixed(3)).join(' -> ');
    console.log(`colleague offset during the pointing beat (rad): ${gestureReport}`);
    for (const [index, value] of duringGesture.entries()) {
      expect(
        value,
        `gesture sample ${index} exceeds what POINT_POSE can apply: ${gestureReport}`,
      ).toBeLessThan(COLLEAGUE_POINT_MAX_OFFSET);
    }

    // Then wait the beat out, so what follows is genuinely her standing there.
    await page.waitForTimeout(COLLEAGUE_POINT_END * 1000);

    // Sampled over twelve seconds of her standing there. Accumulation at frame
    // rate is obvious within one of these gaps; a bounded offset is flat.
    const samples: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      samples.push(await worstDeviation(page));
      await page.waitForTimeout(2000);
    }

    const report = samples.map((value) => value.toFixed(3)).join(' -> ');
    console.log(`colleague worst posture offset (rad): ${report}`);

    expect(samples[0], 'the character diagnostics surface was not published').toBeGreaterThanOrEqual(
      0,
    );

    // Bounded: no sample may reach a pose a person could not hold.
    for (const [index, value] of samples.entries()) {
      expect(
        value,
        `sample ${index} is a larger offset than the posture layer can produce: ${report}`,
      ).toBeLessThan(OFFSET_LIMIT);
    }

    /*
     * And not merely bounded — not trending. A slow accumulation that has not
     * yet passed the limit is the same defect caught earlier, so the last
     * sample may not sit meaningfully above the first. The tolerance is the
     * breathing amplitude, which is real motion and must not fail this.
     */
    const drift = samples[samples.length - 1]! - samples[0]!;
    expect(drift, `deviation is trending upward over time: ${report}`).toBeLessThan(0.12);
  });

  /**
   * The anatomical check, which is the one that actually caught this.
   *
   * The per-frame offset above stayed a flat 0.237 rad on the torso the entire
   * time the character was folding double, because a constant offset applied to
   * its own previous result is still a constant offset — it is the *pose* that
   * runs away, not the increment. So the invariant that matters is measured on
   * the skeleton in world space: a head stays above its hips, and a fist stays
   * within arm's reach of its shoulder, or the rig is broken however small the
   * increments look.
   *
   * Sampled inside the page at animation-frame rate rather than over the wire.
   * The failure was a fast oscillation — 599 bad frames out of 961 — and a
   * poll every few hundred milliseconds walks straight past most of it.
   */
  test('the skeleton stays anatomically possible for eight seconds', async ({ page }) => {
    test.setTimeout(180_000);
    await openOffice(page);

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await expect
      .poll(async () => page.locator('.office3d').getAttribute('data-colleague-phase'), {
        timeout: 40_000,
      })
      .toBe('settled');

    const trace = await page.evaluate(async () => {
      const out: { t: number; headAboveHips: number; reach: number }[] = [];
      const start = performance.now();
      while (performance.now() - start < 8000) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        const bones = window.__CYCASE_CHARACTER__?.bonePlacements() ?? [];
        const pick = (name: string) => bones.find((bone) => bone.name === name);
        const head = pick('Head');
        const hips = pick('Hips');
        const fist = pick('FistR');
        const shoulder = pick('ShoulderR');
        if (!head || !hips || !fist || !shoulder) continue;
        out.push({
          t: Math.round(performance.now() - start),
          headAboveHips: head.world[1] - hips.world[1],
          reach: Math.hypot(
            fist.world[0] - shoulder.world[0],
            fist.world[1] - shoulder.world[1],
            fist.world[2] - shoulder.world[2],
          ),
        });
      }
      return out;
    });

    expect(trace.length, 'no frames were sampled').toBeGreaterThan(200);

    const heights = trace.map((sample) => sample.headAboveHips);
    const reaches = trace.map((sample) => sample.reach);
    const report =
      `frames=${trace.length} ` +
      `headAboveHips ${Math.min(...heights).toFixed(3)}..${Math.max(...heights).toFixed(3)} ` +
      `reach ${Math.min(...reaches).toFixed(3)}..${Math.max(...reaches).toFixed(3)}`;
    console.log(`colleague skeleton: ${report}`);

    /*
     * Her head sits 0.68 m above her hips standing. Half of that is already a
     * pose no one holds while delivering a sentence, and the failure took it to
     * 0.013 — so this is nowhere near a tight bound, and it separates the two
     * states completely.
     */
    const bad = trace.filter((sample) => sample.headAboveHips < 0.5 || sample.reach > 0.8);
    expect(
      bad.length,
      `${bad.length} of ${trace.length} frames are anatomically impossible: ${report}`,
    ).toBe(0);
  });

  /**
   * She walks in and stops. She does not drift, hover or sink.
   *
   * This docblock used to describe a monitor-mounted robot and the flight it
   * was caught doing; that character is gone, and the test underneath it was
   * always about the colleague. What survives the removal is the sampling
   * shape — arrival and steady state are read separately, because a regression
   * that only samples the settled pose can pass while the walk is broken.
   */
  test('she stands on the floor and stays there', async ({ page }) => {
    test.setTimeout(120_000);
    await openOffice(page);

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await expect
      .poll(async () => page.locator('.office3d').getAttribute('data-colleague-phase'), {
        timeout: 40_000,
      })
      .toBe('settled');

    const first = await page.evaluate(() => window.__CYCASE_CHARACTER__?.rootPosition() ?? null);
    await page.waitForTimeout(5000);
    const later = await page.evaluate(() => window.__CYCASE_CHARACTER__?.rootPosition() ?? null);

    expect(first, 'no root position was reported').not.toBeNull();
    console.log(`colleague root: ${JSON.stringify(first)} -> ${JSON.stringify(later)}`);

    // Feet on the floor: the rig is fitted so its base sits at y = 0, and the
    // walk curve only ever writes x and z. A non-zero y here means a clip's
    // root translation is being applied on top of the curve.
    expect(Math.abs(first![1]), 'she is not standing on the floor').toBeLessThan(0.01);
    expect(Math.abs(later![1]), 'she left the floor while standing still').toBeLessThan(0.01);

    // And she does not wander once settled.
    expect(Math.abs(later![0] - first![0])).toBeLessThan(0.01);
    expect(Math.abs(later![2] - first![2])).toBeLessThan(0.01);
  });

  /**
   * She settles where the layout says she settles.
   *
   * The complement to the projection assertions above, and the one that would
   * have caught the defect this pass fixes. `CHARACTER_ANCHORS` used to describe
   * (1.62, −1.75) while `COLLEAGUE_PATH` ended at (2.15, −0.95): the anchors
   * were measured at a waypoint she walks through rather than the point she
   * stops at, so every clearance assertion proved a claim about a position she
   * does not occupy — and she stood off the edge of the frame with the suite
   * green.
   *
   * Comparing the two directly is cheap and closes that hole permanently.
   */
  test('the clearance anchors describe the place she actually stops', async ({ page }) => {
    test.setTimeout(120_000);
    await openOffice(page);

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await expect
      .poll(async () => page.locator('.office3d').getAttribute('data-colleague-phase'), {
        timeout: 40_000,
      })
      .toBe('settled');
    await page.waitForTimeout(1500);

    const root = await page.evaluate(() => window.__CYCASE_CHARACTER__?.rootPosition() ?? null);
    expect(root, 'no root position was reported').not.toBeNull();

    for (const key of ['colleagueCrown', 'colleagueHead', 'colleagueBust'] as const) {
      const anchor = CHARACTER_ANCHORS[key];
      const drift = Math.hypot(anchor.position[0] - root![0], anchor.position[2] - root![2]);
      console.log(
        `${key} anchor (${anchor.position[0]}, ${anchor.position[2]}) vs root ` +
          `(${root![0].toFixed(3)}, ${root![2].toFixed(3)}) — ${drift.toFixed(3)} m apart`,
      );
      expect(
        drift,
        `${key} is anchored ${drift.toFixed(2)} m from where she actually stands, so every ` +
          'clearance assertion using it is about a position she does not occupy',
      ).toBeLessThan(0.05);
    }
  });

  /**
   * The point gesture actually reaches the glass.
   *
   * `POINT_POSE` in `Colleague.tsx` is four joint angles solved offline against
   * this rig — the GLB posed headlessly, placed at the settle point, and the
   * angles searched for a hand above the height at which the monitor interface
   * stops occluding her. Solved offline, it has to be confirmed on the real
   * renderer, because the solve assumed the mixer writes the pose this test can
   * only observe.
   *
   * Read from `FistR`'s live world position, not from a screenshot: the hand is
   * about 25 px across at this distance and against a dark rack, which is not a
   * thing a pixel classifier can honestly assert.
   */
  test('her pointing hand clears the monitor interface', async ({ page }) => {
    test.setTimeout(120_000);
    await openOffice(page);

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await expect
      .poll(async () => page.locator('.office3d').getAttribute('data-colleague-phase'), {
        timeout: 40_000,
      })
      .toBe('settled');

    /*
     * The gesture is a beat, not a pose: it eases in over 0.8 s from 1.3 s
     * after she settles, holds for 1.9 s, and comes back down. Sample the
     * highest the hand reaches rather than one instant, so the assertion does
     * not depend on catching the hold window exactly.
     */
    let highest: [number, number, number] | null = null;
    for (let sample = 0; sample < 40; sample += 1) {
      const fist = await page.evaluate(
        () =>
          window.__CYCASE_CHARACTER__
            ?.bonePlacements()
            .find((bone) => bone.name === 'FistR')?.world ?? null,
      );
      if (fist && (!highest || fist[1] > highest[1])) highest = fist as [number, number, number];
      await page.waitForTimeout(150);
    }

    expect(highest, 'the FistR bone was never reported — has the rig been renamed?').not.toBeNull();

    /*
     * The assertion is made in *screen* space, not on world height, and the
     * difference is the whole point.
     *
     * A first version of this checked `world y > 1.26` — the height her body
     * needs at the settle depth to clear the panels — and a pose passed it with
     * the hand still drawn behind the right monitor, because her hand is 0.15 m
     * closer to the camera than her body is and therefore needs to be higher,
     * not the same. "Above a height" is a proxy. "Outside the rectangle the
     * interface occupies" is the claim.
     */
    const box = await officeBox(page);
    const framing = await liveFraming(page);
    const camera = createCamera(box.width, box.height, framing.yaw, framing.pitch);
    const monitors = MONITORS.map((monitor) => monitorRect(camera, monitor, box.width, box.height));
    const hand = anchorRect(
      camera,
      { position: highest as [number, number, number], radius: CHARACTER_ANCHORS.colleaguePoint.radius },
      box.width,
      box.height,
    );

    const target = CHARACTER_ANCHORS.colleaguePoint.position;
    const miss = Math.hypot(
      highest![0] - target[0],
      highest![1] - target[1],
      highest![2] - target[2],
    );
    console.log(
      `pointing hand peaked at (${highest!.map((n) => n.toFixed(3)).join(', ')}) -> ` +
        `${describe(hand)}; target (${target.join(', ')}), ${miss.toFixed(3)} m away`,
    );

    expect(hand.x0, `the pointing hand is off the left edge: ${describe(hand)}`).toBeGreaterThan(0);
    expect(hand.x1, `the pointing hand is off the right edge: ${describe(hand)}`).toBeLessThan(box.width);
    expect(hand.y0, `the pointing hand is above the frame: ${describe(hand)}`).toBeGreaterThan(0);

    for (const surface of monitors) {
      expect(
        intersects(hand, surface),
        `her pointing hand ${describe(hand)} is drawn behind the ${surface.id} monitor ` +
          `${describe(surface)}, so the gesture the report beat is built on is invisible`,
      ).toBe(false);
    }

    /*
     * And the live rig really is doing the pose that was solved for. Checked
     * loosely on purpose: the solve poses the rig on `Idle` frame 0 and the
     * live rig is somewhere else in that clip, so the two are not expected to
     * agree to the centimetre — only to be the same gesture.
     */
    expect(miss, 'the pointing hand is nowhere near the pose it was solved for').toBeLessThan(0.35);
  });
});