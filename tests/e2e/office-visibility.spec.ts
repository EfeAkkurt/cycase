import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';

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
});
