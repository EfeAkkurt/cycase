import * as THREE from 'three';
import { expect, test, type Page } from '@playwright/test';

import { MONITORS } from '../../src/three/layout';
import { createCamera } from '../../src/three/projection';
import { installModelContext } from './helpers';

/**
 * Measured performance gates (delivery plan §7).
 *
 * Every number here is measured in a real browser and printed, because the contract is
 * explicit that these must be measured rather than inferred from framework choice. A
 * budget test that never prints its measurement is indistinguishable from one that never
 * measured anything.
 *
 * Budgets, verbatim from the plan:
 *   - desktop average >= 55 FPS at 1440x900
 *   - no sustained interval below 45 FPS during head-look / arrival
 *   - camera-to-monitor DOM projection alignment <= 2 px after movement settles
 *   - WebMCP mutation visible <= 250 ms after handler return
 *   - no main-thread task > 200 ms during the demo path after asset loading
 *   - office chunk <= 8 MB compressed, first load <= 12 MB
 */

const AVG_FPS_MIN = 55;
const SUSTAINED_FPS_MIN = 45;
const ALIGNMENT_MAX_PX = 2;
const MUTATION_VISIBLE_MS = 250;
const LONG_TASK_MAX_MS = 200;

/** Samples frames for `durationMs`, returning average and worst 250 ms window. */
async function sampleFrameRate(page: Page, durationMs: number) {
  return page.evaluate(async (duration) => {
    const stamps: number[] = [];
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        stamps.push(now);
        if (now - start < duration) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });

    if (stamps.length < 3) return { average: 0, worstWindow: 0, frames: stamps.length };

    const elapsed = (stamps[stamps.length - 1]! - stamps[0]!) / 1000;
    const average = (stamps.length - 1) / elapsed;

    // Worst sustained rate: the lowest FPS across any rolling 250 ms window. A
    // single dropped frame is not a stutter; a quarter-second of them is.
    let worstWindow = Number.POSITIVE_INFINITY;
    for (let i = 0; i < stamps.length; i += 1) {
      let j = i;
      while (j < stamps.length && stamps[j]! - stamps[i]! < 250) j += 1;
      if (j >= stamps.length) break;
      const windowSeconds = (stamps[j]! - stamps[i]!) / 1000;
      worstWindow = Math.min(worstWindow, (j - i) / windowSeconds);
    }

    return {
      average,
      worstWindow: Number.isFinite(worstWindow) ? worstWindow : average,
      frames: stamps.length,
    };
  }, durationMs);
}

/** Records long tasks for the duration of the callback. */
async function withLongTaskObserver<T>(page: Page, body: () => Promise<T>): Promise<{ result: T; longest: number; tasks: number[] }> {
  await page.evaluate(() => {
    const store: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = store;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) store.push(entry.duration);
      }).observe({ entryTypes: ['longtask'] });
    } catch {
      // Long-task timing is unavailable in some contexts; the assertion below
      // reports that rather than silently passing.
      (window as unknown as { __longTaskUnsupported: boolean }).__longTaskUnsupported = true;
    }
  });

  const result = await body();

  const tasks = await page.evaluate(() => {
    const unsupported = (window as unknown as { __longTaskUnsupported?: boolean }).__longTaskUnsupported;
    if (unsupported) return null;
    return (window as unknown as { __longTasks: number[] }).__longTasks;
  });

  expect(tasks, 'PerformanceObserver longtask is unavailable — this gate cannot be proven here').not.toBeNull();
  return { result, longest: Math.max(0, ...tasks!), tasks: tasks! };
}

/**
 * The overlay as it currently sits: each projected surface's rectangle in the
 * office container's own coordinates, plus the pose the office publishes.
 *
 * Container-relative, not viewport-relative, because that is the space the
 * projection works in — `Office3D` measures `.office3d` and maps the monitor
 * quads into it. Comparing viewport rectangles against container-space quads
 * would report the page chrome's height as drift.
 */
async function overlayGeometry(page: Page) {
  return page.evaluate(() => {
    const container = document.querySelector('.office3d');
    if (!container) return null;
    const box = container.getBoundingClientRect();
    const screens = [...document.querySelectorAll<HTMLElement>('.office3d__screen')].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        id: node.dataset.monitor ?? '',
        x: rect.x - box.x,
        y: rect.y - box.y,
        w: rect.width,
        h: rect.height,
      };
    });
    const pose = container as HTMLElement;
    return {
      width: box.width,
      height: box.height,
      yaw: Number(pose.dataset.yaw),
      pitch: Number(pose.dataset.pitch),
      settled: pose.dataset.settled === 'true',
      screens,
    };
  });
}

/**
 * Where a monitor's screen plane lands in container pixels, computed from the
 * layout and the camera rather than read back from the page.
 *
 * The CSS `matrix3d` maps the surface's rectangle onto the four projected
 * corners, and a projective transform takes edges to edges — so the element's
 * bounding rectangle is the bounding box of those corners. Same corners, same
 * order and same NDC-to-pixel mapping as `computeMonitorPlacements`.
 */
function projectedBounds(
  monitor: (typeof MONITORS)[number],
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
) {
  const halfWidth = monitor.screen.width / 2;
  const halfHeight = monitor.screen.height / 2;
  const rotation = new THREE.Euler(0, monitor.rotationY, 0);
  const origin = new THREE.Vector3(...monitor.position);

  const points = (
    [
      [-halfWidth, halfHeight],
      [halfWidth, halfHeight],
      [halfWidth, -halfHeight],
      [-halfWidth, -halfHeight],
    ] as const
  ).map(([x, y]) => {
    const ndc = new THREE.Vector3(x, y, 0).applyEuler(rotation).add(origin).project(camera);
    return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height };
  });

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}

async function openOffice3D(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
  await expect
    .poll(async () => page.locator('.office3d__screen').count(), { timeout: 20_000 })
    .toBe(3);
  // Let asset streaming and the first PMREM bake finish; the budget explicitly
  // excludes initial asset loading.
  await page.waitForTimeout(3000);
}

test.describe('performance budgets', () => {
  test.slow();

  test('the idle office holds the frame-rate budget at 1440x900', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOffice3D(page);

    const rate = await sampleFrameRate(page, 3000);
    console.log(
      `office idle: avg=${rate.average.toFixed(1)} FPS, worst 250ms window=${rate.worstWindow.toFixed(1)} FPS, ${rate.frames} frames`,
    );

    expect(rate.frames, 'no frames were produced at all').toBeGreaterThan(30);
    expect(rate.average).toBeGreaterThanOrEqual(AVG_FPS_MIN);
    expect(rate.worstWindow).toBeGreaterThanOrEqual(SUSTAINED_FPS_MIN);
  });

  test('the character arrival never drops below the sustained floor', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOffice3D(page);

    // Acknowledge, then sample across her walk-in and settle — the heaviest
    // animation window in the product.
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    const rate = await sampleFrameRate(page, 5000);
    console.log(
      `arrival: avg=${rate.average.toFixed(1)} FPS, worst 250ms window=${rate.worstWindow.toFixed(1)} FPS, ${rate.frames} frames`,
    );

    expect(rate.average).toBeGreaterThanOrEqual(AVG_FPS_MIN);
    expect(rate.worstWindow).toBeGreaterThanOrEqual(SUSTAINED_FPS_MIN);
  });

  test('no main-thread task exceeds the budget on the demo path', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOffice3D(page);

    const { longest, tasks } = await withLongTaskObserver(page, async () => {
      await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
      await page.getByRole('button', { name: 'Open response console' }).click({ timeout: 30_000 });
      await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
      await page.waitForTimeout(1500);
    });

    console.log(
      `long tasks after asset load: ${tasks.length} recorded, longest ${longest.toFixed(0)} ms`,
    );
    expect(longest).toBeLessThanOrEqual(LONG_TASK_MAX_MS);
  });

  test('a WebMCP mutation is visible within the latency budget', async ({ page }) => {
    // Measured through the public tool surface only: the clock starts when the
    // tool handler's promise resolves and stops when the DOM shows the new
    // version. That is exactly the quantity the contract bounds, and it needs
    // no test-only hook into the runtime — a hook would measure a code path the
    // product does not have.
    await installModelContext(page);
    await page.addInitScript(() => {
      window.localStorage.setItem('cycase.office3d', 'false');
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await page.getByRole('button', { name: 'Skip intro' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();

    const elapsed = await page.evaluate(async () => {
      const tools = (await document.modelContext!.getTools!()) ?? [];
      const tool = tools.find((candidate) => candidate.name === 'submit_decision');
      if (!tool) return null;

      await document.modelContext!.executeTool!(
        tool,
        JSON.stringify({
          decisionId: 'D1',
          optionId: 'D1_preserve_and_inspect',
          stateVersion: 0,
          idempotencyKey: 'perf-latency',
        }),
      );
      const handlerReturned = performance.now();

      await new Promise<void>((resolve) => {
        const check = () => {
          if ((document.querySelector('#state-version')?.textContent ?? '').includes('1')) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      return performance.now() - handlerReturned;
    });

    expect(elapsed, 'submit_decision was not discoverable through the tool surface').not.toBeNull();
    console.log(`WebMCP mutation visible ${elapsed!.toFixed(1)} ms after the handler returned`);
    expect(elapsed!).toBeLessThanOrEqual(MUTATION_VISIBLE_MS);
  });

  test('the monitor overlay stays on its bezel after the head turns', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOffice3D(page);

    /*
     * This test used to dispatch a `resize` event and diff the overlay against
     * itself. Re-projecting from an unchanged camera is idempotent by
     * construction: same viewport, same rig, same matrices, so the second
     * reading could only be the first one again and the measurement could only
     * come out at zero. The budget it claims to hold is "<= 2 px after movement
     * settles", and there was no movement anywhere in it — it was a green light
     * wired to nothing.
     *
     * So the head turns first, driven through the keyboard exactly as
     * `headlook.spec.ts` drives it, and the overlay is then measured against the
     * screen quads projected *here*, in the test process, from `MONITORS` and
     * `createCamera` at the pose the office reports. That is the same
     * comparison `headlook.spec.ts` makes for the focal-hierarchy gate, and it
     * is a real one: it fails if a transform is stale, if a surface was left on
     * a previous frame's matrix, or if the overlay is projecting against a
     * container size that is not the one it is laid out in.
     *
     * What it does not isolate: whether React Three Fiber's render camera
     * agrees with the projection camera. Both sides of this measurement come
     * from `src/three/projection.ts`, so a room drawn through a camera that has
     * drifted from that one would be visibly wrong on screen and still measure
     * clean here. The office visual gates own that half.
     */
    const before = await overlayGeometry(page);
    expect(before, 'the office overlay never mounted').not.toBeNull();

    // Four presses is 16 degrees of yaw, two more is 8 degrees of pitch — well
    // inside the +-55 / +25/-20 cone, and far enough that no surface can sit
    // still through it: running the projection maths over the three monitors at
    // container heights from 640 to 900 px, the smallest horizontal
    // displacement of the turn is about 180 px, two orders above the budget.
    // One animation frame between presses because head-look coalesces input per
    // frame; a burst delivered faster than the compositor runs is genuinely
    // collapsed.
    await page.locator('.office3d__canvas').focus();
    const presses = ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'ArrowDown'];
    for (const key of presses) {
      await page.keyboard.press(key);
      await page.evaluate(
        () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
    }

    // The rig eases toward its target rather than snapping, so the measurement
    // waits for the pose to stop moving. Reading it mid-flight would measure
    // the easing, not the alignment.
    await expect
      .poll(async () => (await overlayGeometry(page))?.settled, { timeout: 10_000 })
      .toBe(true);

    const after = (await overlayGeometry(page))!;

    // NaN would sail past `not.toBe(0)`, and NaN is what a missing `data-yaw`
    // reads as — which is the shape this office has failed in before, when the
    // projection stayed bound to a container React had already replaced.
    expect(Number.isFinite(after.yaw) && Number.isFinite(after.pitch)).toBe(true);
    expect(after.yaw, 'the arrow keys did not turn the head at all').not.toBe(0);
    expect(after.pitch, 'the arrow keys did not tilt the head at all').not.toBe(0);
    // Every monitor the overlay had before the turn is still there: a shortened
    // list is how the original defect passed, and a comparison over an empty
    // intersection would pass just as quietly.
    expect(after.screens.map((screen) => screen.id).sort()).toEqual(
      before!.screens.map((screen) => screen.id).sort(),
    );
    expect(after.screens).toHaveLength(3);

    // And they moved. Without this the test would still pass with the camera
    // frozen, which is the exact failure being repaired.
    const travelled = Math.max(
      ...after.screens.map((screen) => {
        const was = before!.screens.find((entry) => entry.id === screen.id)!;
        return Math.max(Math.abs(screen.x - was.x), Math.abs(screen.y - was.y));
      }),
    );
    expect(travelled, 'the overlay did not move, so nothing was re-projected').toBeGreaterThan(
      ALIGNMENT_MAX_PX,
    );

    /*
     * The pose comes back as degrees rounded to two decimals, which is at most
     * 0.005 degrees of error — under 0.1 px at this focal length, and the rig
     * snaps exactly onto its target once it settles anyway.
     */
    const yaw = (after.yaw * Math.PI) / 180;
    const pitch = (after.pitch * Math.PI) / 180;
    const camera = createCamera(after.width, after.height, yaw, pitch);

    let worst = 0;
    const report: string[] = [];
    for (const screen of after.screens) {
      const monitor = MONITORS.find((candidate) => candidate.id === screen.id);
      expect(monitor, `no layout entry for monitor ${screen.id}`).toBeTruthy();
      const expected = projectedBounds(monitor!, camera, after.width, after.height);
      const drift = Math.max(
        Math.abs(screen.x - expected.x),
        Math.abs(screen.y - expected.y),
        Math.abs(screen.w - expected.w),
        Math.abs(screen.h - expected.h),
      );
      report.push(`${screen.id} ${drift.toFixed(2)} px`);
      worst = Math.max(worst, drift);
    }

    console.log(
      `monitor overlay drift at yaw ${after.yaw}, pitch ${after.pitch}: ` +
        `${report.join(', ')} (moved ${travelled.toFixed(0)} px)`,
    );
    expect(worst).toBeLessThanOrEqual(ALIGNMENT_MAX_PX);
  });

  test('the first-load transfer and office chunk stay inside budget', async ({ page }) => {
    const bytesByType = new Map<string, number>();
    page.on('response', async (response) => {
      const url = response.url();
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost')) return;
      const length = Number(response.headers()['content-length'] ?? 0);
      const key = url.includes('Office3D') ? 'office' : 'first-load';
      bytesByType.set(key, (bytesByType.get(key) ?? 0) + length);
    });

    await openOffice3D(page);

    const firstLoad = bytesByType.get('first-load') ?? 0;
    const office = bytesByType.get('office') ?? 0;
    console.log(
      `transfer: first-load ${(firstLoad / 1e6).toFixed(2)} MB, office chunk ${(office / 1e6).toFixed(2)} MB`,
    );

    expect(firstLoad + office).toBeLessThanOrEqual(12e6);
    expect(office).toBeLessThanOrEqual(8e6);
  });
});
