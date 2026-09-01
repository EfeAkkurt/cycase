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

  test('a drag across the alarm looks around; it does not take the incident', async ({ page }) => {
    /*
     * The distinction the whole input layer exists to draw, measured with real
     * pointer events rather than by calling a handler.
     *
     * The drag surface covers the monitor panels — that is the fix for
     * head-look being unreachable over most of the frame — so the gesture that
     * turns the room now ends over the very control that acknowledges the
     * alarm. If the click that follows a drag is not swallowed, looking around
     * the room takes the incident, which is a state change the player never
     * asked for and cannot undo.
     *
     * The previous guard dropped itself on a `setTimeout(…, 0)`, which is a
     * race the click can win under load. It is cleared on the next
     * `pointerdown` now, which the event model orders rather than the scheduler.
     */
    await openOffice(page);
    await expect
      .poll(async () => page.locator('.office3d__screen').count(), { timeout: 20_000 })
      .toBe(3);
    await page.waitForTimeout(800);

    const centre = (await page.locator('.office3d__screen[data-monitor="center"]').boundingBox())!;
    const from = { x: centre.x + centre.width / 2, y: centre.y + centre.height / 2 };

    // A real drag: press on the alarm panel, travel well past the slop, release
    // still over it.
    await page.mouse.move(from.x - 90, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await page.mouse.move(from.x - 90 + step * 15, from.y);
    }
    await page.mouse.up();

    await page.waitForTimeout(700);
    await expect(
      page.locator('.office3d__surface--alarm'),
      'a drag that ended over the alarm acknowledged it',
    ).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Open response console' })).toHaveCount(0);

    // And the drag did what it was for.
    const yaw = await page
      .locator('.office3d')
      .evaluate((element) => Number((element as HTMLElement).dataset.yaw));
    expect(Math.abs(yaw), 'the drag did not turn the head either').toBeGreaterThan(5);

    /*
     * Now the other half: a plain click on the same control, with no travel,
     * still acknowledges. A guard that swallowed every click would pass the
     * assertion above and break the product.
     */
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(0, { timeout: 5_000 });
  });

  test('a click with no travel reaches the monitor it was aimed at', async ({ page }) => {
    /*
     * The complement of the test above, on the raycast path rather than the DOM
     * one: the physical bezel click must survive the drag layer sitting over it.
     * `pointerdown` deliberately never calls `preventDefault` for exactly this
     * reason — doing so would suppress the click the scene needs.
     */
    await openOffice(page);
    await expect
      .poll(async () => page.locator('.office3d__screen').count(), { timeout: 20_000 })
      .toBe(3);
    await page.waitForTimeout(800);

    const centre = (await page.locator('.office3d__screen[data-monitor="center"]').boundingBox())!;

    // Press and release on the same pixel: under the slop, so not a drag.
    await page.mouse.move(centre.x + centre.width / 2, centre.y - 8);
    await page.mouse.down();
    await page.mouse.up();

    await expect(
      page.locator('.office3d__surface--alarm'),
      'a stationary click on the bezel no longer acknowledges — the drag layer ate it',
    ).toHaveCount(0, { timeout: 5_000 });
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
