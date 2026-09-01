import { PNG } from 'pngjs';
import * as THREE from 'three';
import { expect, test, type Page } from '@playwright/test';

import { BACKDROP, CAMERA, ROOM } from '../../src/three/layout';
import { createCamera } from '../../src/three/projection';

/**
 * Audit contract P0.4 — room visibility.
 *
 * "At the seated front view, a tester must identify at least five room objects
 * without zooming. Target mean luminance ≥22 and pixels below luminance 20
 * ≤65% in the office reference capture."
 *
 * The audit measured the previous build at mean 10.8 with 91.2% of pixels
 * under luminance 20 — a room too dark to perceive its own assets. These
 * thresholds are the contract's numbers, measured the same way (Rec. 601 luma
 * over the office viewport), so the relight is a pass/fail fact rather than a
 * matter of taste.
 */

const MEAN_LUMA_MIN = 22;
const DARK_SHARE_MAX = 0.65;

async function measureOffice(page: Page) {
  const region = await page.locator('.office3d').boundingBox();
  expect(region).not.toBeNull();

  const buffer = await page.screenshot({
    clip: {
      x: region!.x,
      y: region!.y,
      width: region!.width,
      height: region!.height,
    },
  });
  const png = PNG.sync.read(buffer);

  let sum = 0;
  let dark = 0;
  let veryDark = 0;
  const total = png.width * png.height;

  for (let i = 0; i < png.data.length; i += 4) {
    const luma =
      0.299 * png.data[i]! + 0.587 * png.data[i + 1]! + 0.114 * png.data[i + 2]!;
    sum += luma;
    if (luma < 20) dark += 1;
    if (luma < 8) veryDark += 1;
  }

  return {
    mean: sum / total,
    darkShare: dark / total,
    veryDarkShare: veryDark / total,
  };
}

test.describe('office visibility gate', () => {
  test.slow();

  test('the seated front view meets the contract luminance thresholds', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();

    // Assets stream in; measure only once the projected panels exist and the
    // renderer has had frames to settle.
    await expect
      .poll(async () => page.locator('.office3d__screen').count(), { timeout: 15_000 })
      .toBe(3);
    await page.waitForTimeout(2500);

    const metrics = await measureOffice(page);
    const report = `mean=${metrics.mean.toFixed(1)} dark<20=${(metrics.darkShare * 100).toFixed(1)}% dark<8=${(metrics.veryDarkShare * 100).toFixed(1)}%`;
    console.log(`office visibility: ${report}`);

    expect(metrics.mean, `mean luminance too low: ${report}`).toBeGreaterThanOrEqual(
      MEAN_LUMA_MIN,
    );
    expect(metrics.darkShare, `too much of the frame is dark: ${report}`).toBeLessThanOrEqual(
      DARK_SHARE_MAX,
    );

    // Evidence for the review set.
    await page.screenshot({ path: 'docs/screenshots/office-visibility-front.png' });
  });

  /**
   * The views the widened head-look cone opened up, measured as composition
   * rather than as brightness.
   *
   * The brief for this pass was explicit: build foreground, midground and
   * background in the left, right and rear views, and do not leave a bare wall
   * or a bin-in-front-of-plaster showcase. Luminance cannot tell those apart —
   * an evenly lit empty wall passes the gate above comfortably — so this
   * asserts what "layered" actually means: that each view has something of its
   * own at each depth, projected with the camera the app itself uses.
   *
   * Two things it deliberately does not do. It does not assert *which* object
   * is in which band: the band is computed from the distance, so moving a piece
   * of dressing changes which layer it satisfies rather than breaking the test
   * for the wrong reason. And it does not take a screenshot: this is a claim
   * about what is in the frustum, and a pixel classifier cannot distinguish a
   * plant at 1.65 m from a lighter patch of wall behind it.
   *
   * The bands are distances from the seat:
   *   foreground below 1.7 m, midground 1.7–2.7 m, background beyond 2.7 m.
   */
  test('every view the cone reaches is composed in three depth layers', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
    await expect
      .poll(async () => page.locator('.office3d__screen').count(), { timeout: 20_000 })
      .toBe(3);
    await page.waitForTimeout(2000);

    const box = (await page.locator('.office3d').boundingBox())!;
    const seat = new THREE.Vector3(...CAMERA.position);
    const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    /**
     * The room's dressing, read from `layout.ts` rather than restated, so a
     * piece that is moved or deleted fails this test instead of leaving it
     * asserting a world that no longer exists.
     *
     * The y of each entry is the height the object actually *reads* at, not its
     * base: a 0.86 m cabinet is a mass centred near 0.43, and the seated
     * camera's −3.75° base pitch means the difference decides whether it is in
     * the frame at all.
     */
    const room: { name: string; at: THREE.Vector3 }[] = [
      { name: 'floor cabinet (left)', at: at(-1.42, 0.43, -0.92) },
      { name: 'open steel rack (left)', at: at(-2.16, 0.86, -1.4) },
      { name: 'blinded window', at: at(...BACKDROP.window.position) },
      { name: 'whiteboard', at: at(...BACKDROP.whiteboard.position) },
      { name: 'colleague doorway', at: at(...BACKDROP.door.position) },
      { name: 'left floor plant', at: at(BACKDROP.credenza.plant.position[0], 0.9, BACKDROP.credenza.plant.position[1]) },
      ...BACKDROP.credenza.units.map((unit, index) => ({
        name: `credenza ${index}`,
        at: at(unit.position[0], 0.43, unit.position[1]),
      })),
      ...BACKDROP.credenza.boxes.map((archive, index) => ({
        name: `archive box ${index}`,
        at: at(...archive.position),
      })),
      { name: 'pod desk', at: at(BACKDROP.pod.desk.position[0], 0.74, BACKDROP.pod.desk.position[1]) },
      { name: 'pod chair', at: at(BACKDROP.pod.chair.position[0], 0.48, BACKDROP.pod.chair.position[1]) },
      { name: 'pod display', at: at(...BACKDROP.pod.display.position) },
      { name: 'pod plant', at: at(BACKDROP.pod.plant.position[0], 0.46, BACKDROP.pod.plant.position[1]) },
      { name: 'breakout table', at: at(BACKDROP.rear.table.position[0], 0.74, BACKDROP.rear.table.position[1]) },
      { name: 'breakout chair', at: at(BACKDROP.rear.table.position[0] - 0.86, 0.48, BACKDROP.rear.table.position[1] + 0.5) },
      { name: 'coat stand', at: at(BACKDROP.rear.coatStand.position[0], 1.2, BACKDROP.rear.coatStand.position[1]) },
      { name: 'status board', at: at(BACKDROP.rear.board.position[0], BACKDROP.rear.board.position[1], ROOM.frontZ) },
      { name: 'rear doorway', at: at(BACKDROP.rear.door.x, 1.02, ROOM.frontZ) },
      { name: 'wall clock', at: at(BACKDROP.rear.clock.position[0], BACKDROP.rear.clock.position[1], ROOM.frontZ) },
    ];

    const band = (distance: number) =>
      distance < 1.7 ? 'foreground' : distance <= 2.7 ? 'midground' : 'background';

    /*
     * Square on to each side wall, and at both yaw clamps — which, at ±120°, is
     * the operator looking back past their own shoulder. The clamps are where
     * the room used to end in the renderer's clear colour, because nothing drew
     * a fourth wall.
     */
    const views = [
      { name: 'left wall', yaw: 70 },
      { name: 'right wall', yaw: -70 },
      { name: 'rear-left limit', yaw: 120 },
      { name: 'rear-right limit', yaw: -120 },
    ];

    for (const view of views) {
      const camera = createCamera(box.width, box.height, (view.yaw * Math.PI) / 180, 0);
      const layers = new Map<string, string[]>();

      for (const item of room) {
        const ndc = item.at.clone().project(camera);
        if (ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) continue;
        const distance = item.at.distanceTo(seat);
        const layer = band(distance);
        if (!layers.has(layer)) layers.set(layer, []);
        layers.get(layer)!.push(`${item.name} ${distance.toFixed(2)}m`);
      }

      console.log(
        `office ${view.name} (yaw ${view.yaw}°): ` +
          (['foreground', 'midground', 'background'] as const)
            .map((layer) => `${layer}=[${(layers.get(layer) ?? []).join(', ')}]`)
            .join(' '),
      );

      for (const layer of ['foreground', 'midground', 'background'] as const) {
        expect(
          layers.get(layer)?.length ?? 0,
          `the ${view.name} view has nothing in its ${layer} — it is a flat wall, ` +
            'which is exactly what this pass existed to fix',
        ).toBeGreaterThan(0);
      }
    }
  });
});
