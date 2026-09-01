import { expect, test, type Page } from '@playwright/test';

import { installModelContext, openDashboard, runSequence } from './helpers';

/**
 * The operations-console shell.
 *
 * The workstream brief asks for one thing to be *measured* rather than
 * eyeballed: "At BOTH 1280x720 and 1440x900 the real content of the active
 * destination must be visible above the fold." So the workspace wraps every
 * route in `#destination-content`, and this file reads its box.
 *
 * The threshold is deliberately not "top < viewport height". That passes at
 * 719px on a 720px screen — a single row of pixels is not content anybody can
 * read. `MIN_VISIBLE` is the band of the destination that has to be on screen
 * before the player scrolls, and it is checked on Command *and* Investigate
 * because those two destinations start with completely different furniture: a
 * table with a header row, and a tablist over a query bar.
 *
 * Run:
 *   npx playwright test shell --project=desktop
 *
 * It belongs to the `desktop` project — no GPU, no WebGL, no headed browser.
 * `openDashboard` disables the 3D office before the app boots.
 */

/** How much of the destination must be above the fold, in CSS px. */
const MIN_VISIBLE = 120;

const SIZES = [
  { label: '1280x720', width: 1280, height: 720 },
  { label: '1440x900', width: 1440, height: 900 },
];

test.beforeEach(async ({ page }) => {
  await installModelContext(page);
});

async function box(page: Page, selector: string) {
  const rect = await page.locator(selector).evaluate((element) => {
    const b = element.getBoundingClientRect();
    return { top: b.top, left: b.left, width: b.width, height: b.height };
  });
  return rect;
}

test.describe('the destination is above the fold', () => {
  for (const size of SIZES) {
    test(`at ${size.label}, on Command and Investigate`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openDashboard(page);

      for (const route of ['Command', 'Investigate']) {
        await page
          .getByRole('navigation')
          .getByRole('button', { name: new RegExp(`^${route}`) })
          .click();

        const content = await box(page, '#destination-content');

        // The band starts on screen with room to read, not one pixel above the
        // fold. Logged so a reviewer sees the number, not just a green tick.
        console.log(
          `${size.label} ${route}: #destination-content top=${Math.round(content.top)} ` +
            `(${Math.round(size.height - content.top)}px visible)`,
        );
        expect(
          content.top + MIN_VISIBLE,
          `${route} at ${size.label} starts ${Math.round(content.top)}px down`,
        ).toBeLessThanOrEqual(size.height);

        // And it is a real box, not a collapsed one that trivially passes.
        expect(content.height).toBeGreaterThan(MIN_VISIBLE);
      }
    });
  }

  /**
   * The step that costs the most vertical space: the session revocation, which
   * is the first genuinely consequential stage on the guided path. It carries
   * the destructive chip, the checklist of the whole containment operation with
   * the current stage marked, the impact sentence, and — because the stage
   * before it has just run — a receipt above all of that. If the fold survives
   * this one it survives the rest.
   *
   * Note where the destructive chip is *not*: on the session inventory that
   * precedes it. That read used to inherit the revocation's warning and its
   * dialog because the card described the whole operation rather than the stage
   * about to run, which teaches a player to click through the warning that
   * matters.
   */
  test('still holds on the consequential containment stage', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await openDashboard(page);

    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      {
        tool: 'submit_decision',
        input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' },
      },
      { tool: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_cookie_001' } },
      { tool: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset' } },
      { tool: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate' } },
    ]);

    await expect(page.locator('#next-step-title')).toContainText(
      'Contain the identity and the endpoint',
    );
    // The inventory is an ordinary read: named, but not dressed as destructive.
    await expect(page.locator('#next-step')).toContainText('Session inventory');
    await expect(page.locator('#next-step').getByText('Consequential')).toHaveCount(0);

    await runSequence(page, [
      { tool: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
    ]);

    // Now the revocation is the stage, and it says so before it is pressed.
    // The impact is never behind a disclosure — hiding a consequence to save
    // height is the dark pattern the brief forbids by name.
    await expect(page.locator('#next-step')).toContainText('Revoke active sessions');
    await expect(page.locator('#next-step').getByText('Consequential')).toBeVisible();

    const content = await box(page, '#destination-content');
    console.log(`1280x720 containment stage: #destination-content top=${Math.round(content.top)}`);
    expect(content.top + MIN_VISIBLE).toBeLessThanOrEqual(720);
  });
});

test.describe('the shell frame', () => {
  test('never scrolls the page: main and the rail scroll on their own', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDashboard(page);

    const frame = await page.evaluate(() => {
      const main = document.querySelector('#main') as HTMLElement;
      return {
        documentScroll:
          document.documentElement.scrollHeight - document.documentElement.clientHeight,
        horizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        mainScrolls: main.scrollHeight > main.clientHeight,
        consoleHeight: Math.round(
          (document.querySelector('.console') as HTMLElement).getBoundingClientRect().height,
        ),
      };
    });

    expect(frame.horizontal).toBeLessThanOrEqual(1);
    expect(frame.documentScroll).toBeLessThanOrEqual(1);
    // The case is far taller than one screen, so if nothing scrolls internally
    // the frame is clipping content rather than containing it.
    expect(frame.mainScrolls).toBe(true);
    expect(frame.consoleHeight).toBe(900);
  });

  test('keeps the header and the sidebar in place while the case scrolls', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDashboard(page);

    const before = await box(page, '.topbar');
    await page.locator('#main').evaluate((element) => element.scrollTo(0, 800));
    const after = await box(page, '.topbar');
    const sidebar = await box(page, '.sidebar');

    expect(after.top).toBeCloseTo(before.top, 0);
    expect(Math.round(sidebar.top)).toBe(0);
    expect(Math.round(sidebar.height)).toBe(900);
  });

  test('puts only the page title and the session controls in the top bar', async ({ page }) => {
    await openDashboard(page);

    const header = page.getByRole('banner');
    await expect(header.getByRole('heading', { level: 1 })).toHaveText('Command');

    // The three global controls, and nothing that belongs to a destination.
    await expect(header.getByRole('button', { name: 'Pause simulation' })).toBeVisible();
    await expect(header.getByRole('button', { name: /Narration/ })).toBeVisible();
    await expect(header.getByRole('button', { name: 'Return to office' })).toBeVisible();

    // The metrics moved out of it, into the sidebar's status group.
    for (const id of ['#play-clock', '#incident-clock', '#state-version', '#feed-health']) {
      await expect(page.locator(`.topbar ${id}`)).toHaveCount(0);
      await expect(page.locator(`.sidebar ${id}`)).toBeVisible();
    }
  });

  test('names the active destination in the title as the route changes', async ({ page }) => {
    await openDashboard(page);

    for (const route of ['Investigate', 'Evidence', 'Respond', 'Timeline', 'Command']) {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: new RegExp(`^${route}`) })
        .click();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route);
    }
  });
});

test.describe('the sidebar collapses to a rail', () => {
  test('goes 240px to 72px and keeps every destination operable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDashboard(page);

    const nav = page.getByRole('navigation');
    const destinations = ['Command', 'Investigate', 'Evidence', 'Respond', 'Timeline', 'Debrief'];

    expect(Math.round((await box(page, '.sidebar')).width)).toBe(240);

    const toggle = page.getByRole('button', { name: 'Collapse the sidebar' });
    await expect(toggle).toBeVisible();
    await toggle.click();

    expect(Math.round((await box(page, '.sidebar')).width)).toBe(72);

    // Every destination is still a button, still in order, still named — and
    // the name still carries the count, as a sentence rather than "2/8".
    for (const route of destinations) {
      const item = nav.getByRole('button', { name: new RegExp(`^${route}`) });
      await expect(item, `${route} is missing from the rail`).toHaveCount(1);
      const size = await item.boundingBox();
      expect(size?.width, route).toBeGreaterThanOrEqual(24);
      expect(size?.height, route).toBeGreaterThanOrEqual(24);
    }
    await expect(nav.getByRole('button', { name: /^Evidence/ })).toHaveAccessibleName(
      /artifacts inspected/,
    );

    // Collapsed, a destination is still reachable by keyboard alone.
    await nav.getByRole('button', { name: /^Investigate/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Investigate');

    // The trade is stated, not silent: the status group is what the width buys.
    await expect(page.locator('.sidebar__status')).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand the sidebar' }).click();
    expect(Math.round((await box(page, '.sidebar')).width)).toBe(240);
    await expect(page.locator('#state-version')).toBeVisible();
  });

  test('shows a visible focus indicator on the collapsed rail', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDashboard(page);
    await page.getByRole('button', { name: 'Collapse the sidebar' }).click();

    const item = page.getByRole('navigation').getByRole('button', { name: /^Evidence/ });
    await item.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');

    const shadow = await item.evaluate((element) => getComputedStyle(element).boxShadow);
    // The system's focus ring is a 2px amber halo; anything is better than the
    // `none` a missing `:focus-visible` leaves behind.
    expect(shadow).not.toBe('none');
  });
});

test.describe('the incident status group', () => {
  test('announces a sentence, not a stream of numbers', async ({ page }) => {
    await openDashboard(page);

    const status = page.locator('.sidebar [role="status"]');
    await expect(status).toHaveCount(1);
    await expect(status).toContainText('INC-74219');
    await expect(status).toContainText('Critical');
    await expect(status).toContainText('v0');

    // The clocks are outside every live region. A polite region wrapped around
    // a per-second clock reads digits at a screen-reader user all session.
    const clocksAreLive = await page.evaluate(() =>
      ['#play-clock', '#incident-clock'].some((selector) =>
        (document.querySelector(selector) as HTMLElement).closest('[aria-live],[role="status"]'),
      ),
    );
    expect(clocksAreLive).toBe(false);
  });

  test('carries all eight values, each with a visible label', async ({ page }) => {
    await openDashboard(page);

    const group = page.locator('.sidebar__status');
    for (const label of [
      'Incident',
      'Severity',
      'Play time',
      'Incident time',
      'Events',
      'Feed',
      'State',
      'Agent',
    ]) {
      await expect(group.getByText(label, { exact: true })).toBeVisible();
    }
  });
});
