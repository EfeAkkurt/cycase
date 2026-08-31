import { expect, test, type Page } from '@playwright/test';

import { openDashboard, readStateVersion } from './helpers';

/**
 * Audit P0.2 / P0.7 — the alarm interaction, the staged arrival sequence and
 * the dashboard-to-office return path.
 */

async function openOffice(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
}

test.describe('alarm acknowledgement', () => {
  test('the office opens unacknowledged: pulsing centre surface, no arrivals', async ({
    page,
  }) => {
    await openOffice(page);

    // Only the centre surface carries the alarm treatment.
    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(1);

    // Nobody has arrived: the two-choice moment is not offered yet.
    await expect(page.getByRole('button', { name: 'Open response console' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Explain the incident' })).toHaveCount(0);
  });

  test('keyboard acknowledgement drives the full arrival sequence', async ({ page }) => {
    await openOffice(page);

    // Enter on the projected panel's button — same event as the pointer path.
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().focus();
    await page.keyboard.press('Enter');

    // Alarm treatment stops immediately.
    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(0);

    // The colleague reports one concrete problem that matches the dashboard's
    // incident: unreachable identity services and the blocked export at 62%.
    await expect(page.getByText(/blocked an outbound customer export at 62%/)).toBeVisible({
      timeout: 15_000,
    });

    // Then — and only then — the briefing choice appears beneath her report,
    // offering exactly two actions.
    await expect(page.getByRole('button', { name: 'Open response console' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('button', { name: 'Explain the incident' })).toBeVisible();
    const primaryActions = await page.locator('.dialogue__actions button').count();
    expect(primaryActions).toBe(2);
  });

  test('clicking the physical monitor bezel acknowledges via raycast', async ({ page }) => {
    await openOffice(page);
    await expect
      .poll(async () => page.locator('.office3d__screen').count(), { timeout: 15_000 })
      .toBe(3);
    await page.waitForTimeout(800);

    // The DOM surface covers the glass; the bezel peeks out around it. Click
    // just above the projected centre panel — that lands on the 3D bezel.
    const surfaces = page.locator('.office3d__screen');
    const centre = await surfaces.nth(1).boundingBox();
    expect(centre).not.toBeNull();
    await page.mouse.click(centre!.x + centre!.width / 2, centre!.y - 8);

    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(0, { timeout: 5_000 });
  });

  test('reduced motion reaches learn-or-solve without animation waits', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();

    await openOffice(page);
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    // Timers replace the animation events; the machine's `after` guards cap the
    // stage lengths, so the choice appears in bounded time with zero frames.
    await expect(page.getByRole('button', { name: 'Open response console' })).toBeVisible({
      timeout: 12_000,
    });
    await context.close();
  });
});

test.describe('dashboard return path (P0.7)', () => {
  test('returns to the settled office and back without losing case state', async ({ page }) => {
    await openDashboard(page);

    // Make some case state worth preserving.
    await page.locator('#decision-option-D1_preserve_and_inspect').click();
    const version = await readStateVersion(page);
    expect(version).toBe(1);

    await page.getByRole('button', { name: 'Return to office' }).click();

    // Settled office: neither the entrance nor the opening report is replayed,
    // the alarm does not come back, and the only next action resumes the
    // console.
    await expect(page.getByText('Your investigation is exactly where you left it.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return to dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open response console' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Explain the incident' })).toHaveCount(0);
    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' })).toHaveCount(0);

    // The office monitors show the live containment state from the same store.
    await expect(page.locator('#incident-brief')).toContainText('0/5');

    // Back to the dashboard: same case, same version, tools still registered.
    await page.getByRole('button', { name: 'Return to dashboard' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
    expect(await readStateVersion(page)).toBe(version);
    await expect(page.locator('#decision-D1')).toContainText('Preserve the reported message');
  });
});
