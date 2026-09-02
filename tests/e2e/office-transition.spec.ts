import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';

/*
 * The office-to-dashboard transition, on its own, in the GPU project.
 *
 * It boots the real WebGL room and plays the whole arrival choreography, which
 * makes it the heaviest test in the suite. In the headless project — where
 * Chromium rasterises WebGL in software at about 3 FPS — it exceeded even a
 * three-minute budget whenever three other workers were booting their own
 * offices. It asserts navigation state rather than a rendered measurement, so it
 * does not belong with the pixel gates; it belongs wherever the office actually
 * runs at a usable speed.
 *
 * The reverse direction lives here for the same reason, and for one more: the
 * only existing return-path test (`alarm-flow.spec.ts`, "returns to the settled
 * office and back without losing case state") reaches the dashboard through
 * `openDashboard`, which sets `cycase.office3d = 'false'`. That test therefore
 * returns to the **flat monitor wall** and never touches WebGL — which is
 * exactly how the black-room defect survived a green suite.
 */

/**
 * The floor these return tests hold the revealed room to.
 *
 * It is the same *number* as the P0.4 front-view contract floor in
 * `office-visibility.spec.ts`, and deliberately not the same *claim*. That gate
 * measures the seated, alarm-unacknowledged front view, which is the frame the
 * contract is written about; the resume beat is a different scene state and has
 * never had a threshold negotiated for it.
 *
 * What these tests actually need to separate is "a lit room" from "a black
 * canvas behind the projected monitor panels", which is the defect. A black
 * canvas measures about 2. Reusing 22 gives an order of magnitude of margin
 * over the failure it is looking for, so it is a safe floor for that question
 * without being evidence about the composition of this beat.
 */
const MEAN_LUMA_MIN = 22;

/** Rec. 601 luma over the office viewport — the same measurement as the P0.4 gate. */
async function measureOffice(page: Page) {
  const region = await page.locator('.office3d').boundingBox();
  expect(region).not.toBeNull();

  const png = PNG.sync.read(
    await page.screenshot({
      clip: {
        x: region!.x,
        y: region!.y,
        width: region!.width,
        height: region!.height,
      },
    }),
  );

  let sum = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    sum += 0.299 * png.data[i]! + 0.587 * png.data[i + 1]! + 0.114 * png.data[i + 2]!;
  }
  return sum / (png.width * png.height);
}

interface ReturnSamples {
  /** Was an opaque cover already over the room in the first frame it existed? */
  firstOfficeFrameCovered: boolean | null;
  /**
   * Frames in which the room was on screen before any opaque cover had ever
   * been seen — i.e. frames of the black room. Zero is the whole point; it
   * does not count the legitimate frames after the reveal.
   */
  uncoveredBeforeAnyCover: number;
  frames: number;
}

/**
 * Watches the return from inside the page, starting *before* the click.
 *
 * A Playwright-side `toHaveCount` poll cannot answer "was the room covered in
 * the frame it appeared?" — on a fast GPU the whole reveal can be over between
 * two polls. This runs on every animation frame, so the first frame of the
 * returning office is always sampled.
 */
async function watchReturn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = {
      firstOfficeFrameCovered: null as boolean | null,
      uncoveredBeforeAnyCover: 0,
      frames: 0,
      sawCover: false,
      settled: 0,
    };
    (window as unknown as { __cycaseReturn: typeof state }).__cycaseReturn = state;

    const tick = () => {
      const office = document.querySelector('.office3d');
      const cover = document.querySelector(
        '[data-testid="transition-cover"][data-direction="return"]',
      );
      const opaque = cover !== null && getComputedStyle(cover).opacity === '1';
      if (opaque) state.sawCover = true;

      if (office) {
        if (state.firstOfficeFrameCovered === null) state.firstOfficeFrameCovered = opaque;
        if (!opaque && !state.sawCover) state.uncoveredBeforeAnyCover += 1;
      }

      state.frames += 1;
      // Stop once the room has been uncovered and stable for a second, so the
      // loop cannot outlive the measurement it exists for.
      state.settled = office && !cover ? state.settled + 1 : 0;
      if (state.settled < 60) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  });
}

function readReturn(page: Page): Promise<ReturnSamples> {
  return page.evaluate(
    () => (window as unknown as { __cycaseReturn: ReturnSamples }).__cycaseReturn,
  );
}

/** Boots the real 3D office and skips straight through to the dashboard. */
async function reachDashboardVia3DOffice(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  // The room has to have actually drawn before we leave it, or the return is
  // measuring a first load rather than a remount.
  await expect(page.locator('.office3d')).toBeVisible();
  await expect
    .poll(async () => page.locator('.office3d__screen').count(), { timeout: 30_000 })
    .toBe(3);
  await page.waitForTimeout(2_500);

  await page.getByRole('button', { name: 'Skip to console' }).click();
  await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
  // The forward cover keeps fading for 400 ms after the dashboard is visible.
  await expect(page.locator('[data-testid="transition-cover"]')).toHaveCount(0, {
    timeout: 15_000,
  });
}

test('the office preserves case state across the transition, with no reload', async ({ page }) => {
  // Boots the real 3D office and plays the whole arrival choreography. Headless
  // Chromium rasterises WebGL in software, so this needs a real budget — but it
  // asserts navigation state, not a rendered measurement, so it stays here.
  test.setTimeout(180_000);
  await page.goto('/');
  await page.evaluate(() => {
    (window as never as { __navigations: number }).__navigations = 1;
  });

  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
  await page.getByRole('button', { name: 'Explain the incident' }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open response console' }).click();

  await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();

  // A reload would have wiped this marker.
  const stillLoaded = await page.evaluate(
    () => (window as never as { __navigations?: number }).__navigations,
  );
  expect(stillLoaded).toBe(1);
});

test.describe('dashboard → office return (audit P2)', () => {
  test('the room is never on screen before it has been drawn', async ({ page }) => {
    test.setTimeout(180_000);
    await reachDashboardVia3DOffice(page);

    await watchReturn(page);
    await page.getByRole('button', { name: 'Return to office' }).click();

    // The resume beat is the destination, and it is there straight away —
    // covered, but mounted and complete, with no opening report replayed.
    await expect(page.getByText('Your investigation is exactly where you left it.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open response console' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Explain the incident' })).toHaveCount(0);

    // The reveal is gated on the room, so the cover goes away on its own.
    await expect(
      page.locator('[data-testid="transition-cover"][data-direction="return"]'),
    ).toHaveCount(0, { timeout: 30_000 });

    /*
     * The defect, stated as a fact rather than a screenshot: before this work
     * there was no reverse cover at all, so the first frame of the returning
     * office was the un-drawn one and this is `false`.
     */
    const samples = await readReturn(page);
    console.log(`return: ${JSON.stringify(samples)}`);
    expect(
      samples.firstOfficeFrameCovered,
      'the office was on screen uncovered in the frame it mounted',
    ).toBe(true);
    expect(
      samples.uncoveredBeforeAnyCover,
      'frames showing the room before any cover existed',
    ).toBe(0);

    // And what is revealed is a lit room rather than a black canvas behind the
    // projected panels. See MEAN_LUMA_MIN for why this number, and for what it
    // is and is not evidence of.
    const mean = await measureOffice(page);
    console.log(`return reveal: mean=${mean.toFixed(1)}`);
    expect(mean, `the revealed room was too dark: mean=${mean.toFixed(1)}`).toBeGreaterThanOrEqual(
      MEAN_LUMA_MIN,
    );

    // Focus is on the one action the resume beat offers, not lost to `body`.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('office-resume-cta');
  });

  test('reduced motion completes the return and still reveals a drawn room', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    await reachDashboardVia3DOffice(page);
    const clickedAt = Date.now();
    await page.getByRole('button', { name: 'Return to office' }).click();

    /*
     * Reduced motion is the path that would hang a naive readiness probe:
     * `AnimationDriver` runs no pump at all on a settled beat, so `ReadyProbe`
     * drives its own frames instead of riding one.
     *
     * The elapsed time below is logged rather than asserted, deliberately. Both
     * a working probe and an expired 4 s cap end with a lit room, so no
     * threshold here separates them without inventing a GPU-speed assumption —
     * but the two are far apart in the log: the probe path finishes at roughly
     * the room's draw time plus this variant's 32 ms fade, and the cap path
     * cannot finish before 4032 ms. A number near 4 s means the probe never
     * reported and only the safety net revealed the room.
     */
    await expect(
      page.locator('[data-testid="transition-cover"][data-direction="return"]'),
    ).toHaveCount(0, { timeout: 30_000 });
    const revealMs = Date.now() - clickedAt;
    await expect(page.getByRole('button', { name: 'Return to dashboard' })).toBeVisible();

    const mean = await measureOffice(page);
    console.log(`reduced-motion return reveal: ${revealMs} ms, mean=${mean.toFixed(1)}`);
    expect(mean).toBeGreaterThanOrEqual(MEAN_LUMA_MIN);

    await context.close();
  });

  test('the 2D monitor wall returns with no cover of its own', async ({ page }) => {
    /*
     * The 3D-off and narrow-viewport paths never had a black gap: the monitor
     * wall is synchronous DOM. They must not acquire a fade they do not need,
     * so the cover is gated on the WebGL path. This is also the configuration
     * `alarm-flow.spec.ts`'s return test runs in, which is why that test is
     * untouched by the reverse cover.
     */
    await page.addInitScript(() => {
      window.localStorage.setItem('cycase.office3d', 'false');
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await page.getByRole('button', { name: 'Skip to console' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
    // The heading goes live at the cover's swap, 400 ms before the cover ends.
    await expect(page.locator('[data-testid="transition-cover"]')).toHaveCount(0, {
      timeout: 15_000,
    });

    /*
     * Watch for the cover from before the click, not after the return has
     * settled.
     *
     * `toHaveCount(0)` asked once the room is already back cannot tell "no
     * cover was ever created" from "a cover appeared and has since been
     * removed" — both leave zero elements on the page at the moment it looks,
     * and the second is exactly the regression this test exists to catch. A
     * MutationObserver armed beforehand records any appearance, however brief.
     */
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __coverSeen: string[] }).__coverSeen = seen;
      const record = (node: Node) => {
        if (!(node instanceof HTMLElement)) return;
        const cover = node.matches?.('[data-testid="transition-cover"]')
          ? node
          : node.querySelector?.('[data-testid="transition-cover"]');
        if (cover) seen.push((cover as HTMLElement).dataset.direction ?? 'unknown');
      };
      new MutationObserver((records) => {
        for (const record_ of records) record_.addedNodes.forEach(record);
      }).observe(document.body, { childList: true, subtree: true });
      document.querySelectorAll('[data-testid="transition-cover"]').forEach(record);
    });

    await page.getByRole('button', { name: 'Return to office' }).click();

    await expect(page.getByText('Your investigation is exactly where you left it.')).toBeVisible();
    // The monitor wall is up immediately, with the live case state on it.
    await expect(page.locator('#incident-brief')).toBeVisible();

    const covers = await page.evaluate(
      () => (window as unknown as { __coverSeen: string[] }).__coverSeen,
    );
    expect(covers, `a cover was mounted on the 2D return path: ${covers.join(', ')}`).toEqual([]);
  });
});
