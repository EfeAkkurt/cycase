import { expect, test, type Page } from '@playwright/test';

import { installModelContext, openDashboard } from './helpers';

/**
 * Dashboard shell visual contract, measured in headless Chromium.
 *
 * This is not the GPU screenshot set. It records the numbers a reviewer needs
 * for the console: fold, rail width, top-bar overflow and primary CTA contrast.
 */

const MIN_VISIBLE = 120;

const SIZES = [
  { label: '1280x720', width: 1280, height: 720 },
  { label: '1440x900', width: 1440, height: 900 },
];

test.beforeEach(async ({ page }) => {
  await installModelContext(page);
});

function parseRgb(value: string): [number, number, number] {
  const inner = value.replace(/^rgba?\(/i, '').replace(/\)$/, '');
  const parts = inner.split(/[\s,/]+/).filter((part) => part.length > 0 && part !== '/');
  if (parts.length < 3) throw new Error(`not an rgb colour: ${value}`);
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

async function ctaContrast(page: Page, selector: string) {
  const colors = await page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  return contrast(parseRgb(colors.color), parseRgb(colors.background));
}

test.describe('dashboard visual contract', () => {
  for (const size of SIZES) {
    test(`keeps the workspace readable at ${size.label}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openDashboard(page);

      const report = await page.evaluate(() => {
        const dest = document.querySelector('#destination-content')!.getBoundingClientRect();
        const bar = document.querySelector('.topbar')!.getBoundingClientRect();
        const rail = document.querySelector('.rail')!.getBoundingClientRect();
        return {
          destTop: dest.top,
          destWidth: dest.width,
          destHeight: dest.height,
          barHeight: bar.height,
          barRight: bar.right,
          railWidth: rail.width,
          viewport: document.documentElement.clientWidth,
        };
      });

      console.log(
        `${size.label}: dest top=${Math.round(report.destTop)} w=${Math.round(report.destWidth)} rail=${Math.round(report.railWidth)} bar=${Math.round(report.barHeight)}`,
      );

      expect(report.destTop + MIN_VISIBLE).toBeLessThanOrEqual(size.height);
      expect(report.destHeight).toBeGreaterThan(MIN_VISIBLE);
      expect(report.destWidth).toBeGreaterThan(240);
      expect(report.barHeight).toBeLessThanOrEqual(56);
      expect(report.barRight).toBeLessThanOrEqual(report.viewport + 1);
      expect(Math.round(report.railWidth)).toBe(44);
    });
  }

  test('primary CTA contrast clears 4.5:1 in rest, hover and disabled', async ({ page }) => {
    await openDashboard(page);

    await page.evaluate(() => {
      const mount = document.createElement('div');
      mount.id = 'cta-contrast-probe';
      mount.style.cssText = 'position:fixed;top:8px;left:8px;z-index:9999;display:flex;gap:8px';
      for (const [id, disabled] of [
        ['cta-rest', false],
        ['cta-hover', false],
        ['cta-disabled', true],
      ] as const) {
        const button = document.createElement('button');
        button.id = id;
        button.className = 'btn btn--primary';
        button.textContent = 'Continue';
        button.disabled = disabled;
        mount.appendChild(button);
      }
      document.body.appendChild(mount);
    });

    const rest = await ctaContrast(page, '#cta-rest');
    expect(rest, `rest ${rest}`).toBeGreaterThan(4.5);

    await page.locator('#cta-hover').hover();
    const hover = await ctaContrast(page, '#cta-hover');
    expect(hover, `hover ${hover}`).toBeGreaterThan(4.5);

    const disabled = await ctaContrast(page, '#cta-disabled');
    expect(disabled, `disabled ${disabled}`).toBeGreaterThan(4.5);
  });

  test('200% zoom keeps session controls reachable and does not scroll sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openDashboard(page);
    await page.evaluate(() => {
      document.documentElement.style.zoom = '2';
    });

    await expect(page.getByRole('button', { name: 'Pause simulation' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to office' })).toBeVisible();
    await expect(page.locator('#destination-content')).toBeVisible();

    const horizontal = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(horizontal).toBeLessThanOrEqual(1);
  });
});
