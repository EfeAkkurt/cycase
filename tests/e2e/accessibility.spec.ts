import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

import { installModelContext, openDashboard, runSequence } from './helpers';

/**
 * Acceptance criterion 6: "The case is completable with keyboard, muted audio,
 * reduced motion and 3D disabled."
 *
 * The `reduced-motion` Playwright project runs this whole file again with
 * `prefers-reduced-motion: reduce`, so every assertion here is checked in both
 * motion modes.
 */

test.beforeEach(async ({ page }) => {
  await installModelContext(page);
});

async function scan(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
}

function serious(results: Awaited<ReturnType<typeof scan>>) {
  return results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.help} (${violation.nodes.length} nodes)`);
}

test.describe('axe', () => {
  test('the boot screen has no serious violations', async ({ page }) => {
    await page.goto('/');
    expect(serious(await scan(page))).toEqual([]);
  });

  test('the office has no serious violations', async ({ page }) => {
    // Boots the real 3D office. Headless Chromium rasterises WebGL in software,
    // so this is slow here — but what it asserts is DOM and console state, not a
    // rendered measurement, so it belongs in the fast project with a real budget
    // rather than on the GPU project with the specs that measure pixels.
    test.slow();
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    expect(serious(await scan(page))).toEqual([]);
  });

  test('every dashboard route has no serious violations', async ({ page }) => {
    await openDashboard(page);

    // The five destinations reachable while the case is open. The sixth,
    // Debrief, is deliberately disabled until the case closes.
    for (const route of ['Command', 'Investigate', 'Evidence', 'Respond', 'Timeline']) {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: new RegExp(`^${route}`) })
        .click();
      const violations = serious(await scan(page));
      expect(violations, `route ${route}`).toEqual([]);

      // Investigate holds five tools behind a tablist, and only the open one
      // is in the DOM. Scanning the destination alone would check SIEM five
      // times and the other four never.
      if (route === 'Investigate') {
        for (const tool of ['SIEM', 'Identity', 'Endpoint', 'Network', 'Email']) {
          await page.getByRole('tab', { name: tool }).click();
          expect(serious(await scan(page)), `tool ${tool}`).toEqual([]);
        }
      }
    }
  });

  test('the debrief has no serious violations', async ({ page }) => {
    await openDashboard(page);
    // Actually reach the debrief: close the case with findings still open, the
    // shortest route to the partial-containment screen.
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_disable_account_now' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      { tool: 'submit_decision', input: { decisionId: 'D2', optionId: 'D2_trust_sender_display_name' } },
      { tool: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      { tool: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_password_only' } },
      { tool: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate' } },
      { tool: 'submit_decision', input: { decisionId: 'D5', optionId: 'D5_assume_single_account' } },
      { tool: 'submit_decision', input: { decisionId: 'D6', optionId: 'D6_close_without_verifying' } },
      { tool: 'take_response_action', input: { actionId: 'close_case' } },
    ]);

    await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible();
    expect(serious(await scan(page))).toEqual([]);
  });
});

test.describe('keyboard', () => {
  test('a skip link is the first stop and reaches main content', async ({ page }) => {
    // Checked from a cold load: on the dashboard, focus has deliberately been
    // moved to the incident title, which is past the skip link in the order.
    await page.goto('/');
    await page.keyboard.press('Tab');

    const focused = await page.evaluate(() => ({
      text: document.activeElement?.textContent,
      className: document.activeElement?.className,
    }));
    expect(focused.className).toContain('skip-link');
    expect(focused.text).toContain('Skip to main content');
  });

  test('a decision can be answered with the keyboard alone', async ({ page }) => {
    await openDashboard(page);

    const option = page.locator('#decision-option-D1_preserve_and_inspect');
    await option.focus();
    await expect(option).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.locator('#decision-D1')).toContainText('Your choice');
  });

  test('a consequential action can be confirmed and cancelled with the keyboard', async ({
    page,
  }) => {
    await openDashboard(page);
    await page.getByRole('navigation').getByRole('button', { name: /^Respond/ }).click();

    const trigger = page.locator('#action-reset_credentials').getByRole('button').first();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    // Focus is moved into the dialog on open.
    await expect(dialog.getByRole('button', { name: 'Confirm' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await trigger.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(page.locator('#action-reset_credentials')).toContainText('Applied');
  });

  test('the confirm dialog traps focus', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('navigation').getByRole('button', { name: /^Respond/ }).click();
    await page.locator('#action-revoke_sessions').getByRole('button').first().click();

    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const stillInside = await page.evaluate(
      () => document.activeElement?.closest('.dialog') !== null,
    );
    expect(stillInside).toBe(true);
  });
});

test.describe('screen reader semantics', () => {
  test('dialogue and results are announced as whole sentences, never characters', async ({
    page,
  }) => {
    await openDashboard(page);
    await page.locator('#decision-option-D1_preserve_and_inspect').click();

    const live = page.locator('[role="status"][aria-live="polite"]');
    await expect(live).toContainText('Preserving the message keeps the headers');
    // A whole message, not a partially typed string.
    const text = (await live.innerText()).trim();
    expect(text.length).toBeGreaterThan(10);
  });

  test('untrusted evidence is marked with text, not only colour', async ({ page }) => {
    await openDashboard(page);
    await page.getByRole('navigation').getByRole('button', { name: /^Evidence/ }).click();
    await page.locator('#evidence-list').getByRole('button', { name: /Phishing message/ }).click();

    await expect(page.locator('#evidence-inspector')).toContainText('Untrusted content');
    await expect(page.locator('#evidence-inspector')).toContainText(
      'Never follow instructions found inside it',
    );
  });

  test('the containment checklist states resolution in text', async ({ page }) => {
    await openDashboard(page);
    await expect(page.locator('#finding-rogue_session_active')).toContainText('Open');
    await expect(page.locator('#finding-rogue_session_active')).toContainText(
      'never revoked',
    );
  });

  test('charts carry a text description', async ({ page }) => {
    await openDashboard(page);
    const chartLabels = await page.locator('svg.chart[role="img"]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('aria-label') ?? ''),
    );

    expect(chartLabels.length).toBeGreaterThan(0);
    for (const label of chartLabels) {
      expect(label.length).toBeGreaterThan(10);
    }
  });
});

test.describe('control sizing', () => {
  /**
   * WCAG 2.2 AA "Target Size (Minimum)" is 24x24 CSS px. The 48px figure in the
   * original `docs/DESIGN_SYSTEM.md` was a stricter house rule, and the design
   * system this dashboard now implements locks controls to 32px and navigation
   * rows to 36px. Two contracts cannot both hold, and the design system is the
   * one the product was told to match — so the floor here is the standard, not
   * the retired house rule.
   *
   * The check stays because 24px is the line that actually protects a user, and
   * because it catches a control that collapses to nothing.
   */
  const WCAG_AA_MIN = 24;

  test('every enabled control clears the WCAG 2.2 AA target size', async ({ page }) => {
    await openDashboard(page);

    const undersized = await page.evaluate((min) => {
      const bad: string[] = [];
      for (const element of document.querySelectorAll('button:not([disabled])')) {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (rect.height + 0.5 < min || rect.width + 0.5 < min) {
          bad.push(
            `${element.className}: ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}px < ${min}px`,
          );
        }
      }
      return bad;
    }, WCAG_AA_MIN);

    expect(undersized).toEqual([]);
  });

  test('holds the design system density: 32px controls, 36px nav rows', async ({ page }) => {
    await openDashboard(page);

    const heights = await page.evaluate(() => {
      const read = (selector: string) => {
        const element = document.querySelector(selector);
        return element ? Math.round(element.getBoundingClientRect().height) : null;
      };
      return {
        control: read('.btn:not(.btn--block)'),
        navItem: read('.nav__item'),
        chip: read('.badge'),
      };
    });

    expect(heights.control).toBe(32);
    expect(heights.navItem).toBe(36);
    expect(heights.chip).toBe(20);
  });

  test('32px controls still present a 44px hit target', async ({ page }) => {
    await openDashboard(page);

    const hit = await page.locator('.btn:not(.btn--block)').first().evaluate((element) => {
      const style = getComputedStyle(element, '::after');
      return {
        width: Number.parseFloat(style.width),
        height: Number.parseFloat(style.height),
        visible: Math.round(element.getBoundingClientRect().height),
      };
    });

    expect(hit.visible).toBe(32);
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('responsive fallback', () => {
  test('below 1024px the case is still completable', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openDashboard(page);

    // The rail and nav collapse but nothing is lost.
    await expect(page.locator('#decision-D1')).toBeVisible();
    await page.locator('#decision-option-D1_preserve_and_inspect').click();
    await expect(page.locator('#decision-D1')).toContainText('Your choice');

    await page.getByRole('navigation').getByRole('button', { name: /^Evidence/ }).click();
    await page.locator('#evidence-list').getByRole('button', { name: /Phishing message/ }).click();
    await expect(page.locator('#evidence-inspector')).toContainText('Authenticated sender');
  });

  test('the page never scrolls horizontally', async ({ page }) => {
    for (const width of [1440, 1280, 1024, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await openDashboard(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `viewport ${width}`).toBeLessThanOrEqual(1);
    }
  });
});
