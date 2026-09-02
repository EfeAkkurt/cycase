import { PNG } from 'pngjs';
import { expect, test, type Page } from '@playwright/test';

import { PERFECT_RUN, continueToDebrief, installModelContext, runSequence } from './helpers';

/**
 * Audit contract P0.4: "Restore the warm-neutral, red-for-incident
 * direction. No decorative blue."
 *
 * That is a measurable claim, so it is measured rather than eyeballed. Every
 * state named below is rendered, screenshotted, and every pixel classified.
 * This gate was retired during the blue-accent detour and is reinstated by the
 * product owner's acceptance of the audit as a binding contract.
 */

/**
 * A pixel is "cool" when blue outruns red, or when blue *and* green both
 * outrun red — the second clause is what catches cyan and teal, where red is
 * the suppressed channel rather than blue being the loud one.
 *
 * Warm neutrals, bone text, amber and red all have r >= b and pass trivially.
 */
const COOL_MARGIN = 18;

function isCool(r: number, g: number, b: number): boolean {
  if (b - r > COOL_MARGIN) return true;
  if (Math.min(g, b) - r > COOL_MARGIN) return true;
  return false;
}

/**
 * Photographic CC0 textures carry a little incidental cool in their shadows,
 * and antialiasing blends edges. Two bounds rather than one: a small share of
 * the frame overall, and a hard cap on any *single* colour — 0.3% of a
 * 1440x900 frame is ~3,900 pixels, which is more than enough to hide a fully
 * cyan chip behind an aggregate that still reads as passing.
 */
const TOLERANCE = 0.001;
const MAX_SINGLE_COLOUR = 400;

interface Offender {
  x: number;
  y: number;
  hex: string;
  count: number;
}

async function reviewPixels(page: Page, label: string) {
  const buffer = await page.screenshot();
  const png = PNG.sync.read(buffer);

  let cool = 0;
  const byColour = new Map<string, Offender>();

  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const index = (png.width * y + x) << 2;
      const r = png.data[index]!;
      const g = png.data[index + 1]!;
      const b = png.data[index + 2]!;
      const a = png.data[index + 3]!;
      if (a < 8) continue;
      if (!isCool(r, g, b)) continue;

      cool += 1;
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      const existing = byColour.get(hex);
      if (existing) existing.count += 1;
      else byColour.set(hex, { x, y, hex, count: 1 });
    }
  }

  const total = png.width * png.height;
  const ratio = cool / total;
  const worst = [...byColour.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((entry) => `${entry.hex} x${entry.count} @${entry.x},${entry.y}`)
    .join('  ');

  const worstCount = Math.max(0, ...[...byColour.values()].map((entry) => entry.count));

  expect(
    ratio,
    `${label}: ${(ratio * 100).toFixed(3)}% cool pixels (${cool}/${total}). Worst: ${worst}`,
  ).toBeLessThanOrEqual(TOLERANCE);

  expect(
    worstCount,
    `${label}: a single cool colour covers ${worstCount} pixels. Worst: ${worst}`,
  ).toBeLessThanOrEqual(MAX_SINGLE_COLOUR);
}

const REVIEW_SIZES = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '1280x720', width: 1280, height: 720 },
];

test.describe('palette gate', () => {
  test.slow();

  for (const size of REVIEW_SIZES) {
  test(`no cool hues survive anywhere in the played flow at ${size.label}`, async ({ page }) => {
    // Boots 3D, plays the entire case, and classifies every pixel of eleven
    // screenshots. The longest test in the suite by a wide margin.
    test.setTimeout(180_000);
    await installModelContext(page);
    await page.setViewportSize({ width: size.width, height: size.height });

    await page.goto('/');
    await reviewPixels(page, `${size.label} opening`);

    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.locator('#incident-brief')).toBeVisible();
    await page.waitForTimeout(2500);
    await reviewPixels(page, `${size.label} office + critical alert`);

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.getByRole('button', { name: 'Explain the incident' }).click({ timeout: 30_000 });
    await expect(page.getByText(/blocked an outbound file transfer|shape of a stolen session/)).toBeVisible();
    await reviewPixels(page, `${size.label} incident explained`);

    await page.getByRole('button', { name: 'Open response console' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
    await reviewPixels(page, `${size.label} dashboard command`);

    await runSequence(page, PERFECT_RUN.slice(0, 2));
    await page.getByRole('navigation').getByRole('button', { name: /^Evidence/ }).click();
    await reviewPixels(page, `${size.label} evidence`);

    for (const route of ['Investigate', 'Respond', 'Timeline']) {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: new RegExp(`^${route}`) })
        .click();
      await reviewPixels(page, `${size.label} route ${route}`);
    }

    await runSequence(page, PERFECT_RUN.slice(2));
    await continueToDebrief(page);
    await reviewPixels(page, `${size.label} debrief`);
  });
  }
});
