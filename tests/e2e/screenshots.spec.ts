import { expect, test, type Page } from '@playwright/test';

import { PERFECT_RUN, continueToDebrief, installModelContext, runSequence } from './helpers';

/**
 * The eight captures, at both review sizes.
 *
 * Run with `npx playwright test screenshots --project=desktop-3d`. They are
 * written to `docs/screenshots/` and are review artefacts, not assertions —
 * the suite fails only if a step cannot be reached at all.
 *
 * The project name in that command is load-bearing, and it used to say
 * `desktop`. `playwright.config.ts` lists `screenshots` in `desktop`'s
 * `testIgnore` and in `desktop-3d`'s `testMatch`, so the documented command
 * selected zero tests and exited green — a review set that silently stopped
 * being regenerated looks exactly like one that has not changed. Two of these
 * eight frames are the 3D office, which is the reason the file lives in the GPU
 * project at all: headless Chromium rasterises WebGL in software, and a review
 * capture taken there is a picture of the software rasteriser.
 */

const SIZES = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '1280x720', width: 1280, height: 720 },
];

async function shot(page: Page, size: string, name: string) {
  // Scene changes keep the previous scroll offset, so a capture taken straight
  // after one lands mid-page. Every review shot starts at the top.
  await page.evaluate(() => window.scrollTo(0, 0));

  /*
   * Charts are lazy-loaded, so a capture taken the instant a route mounts shows
   * an empty panel where a chart belongs — the debrief breakdown shipped into
   * the review set as a blank grey box for exactly this reason. Wait for every
   * skeleton to resolve, and for at least one chart to have drawn if the route
   * has any.
   */
  await expect
    .poll(async () => page.locator('.viz__skeleton').count(), { timeout: 15_000 })
    .toBe(0);

  // Park the pointer out of the way. Wherever the last click left it, a chart
  // under it holds its tooltip open and the tooltip lands in the review set.
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `docs/screenshots/${size}-${name}.png` });
}

for (const size of SIZES) {
  test(`captures the review set at ${size.label}`, async ({ page }) => {
    test.slow();
    await installModelContext(page);
    await page.setViewportSize({ width: size.width, height: size.height });

    // 1 — black/typewriter opening
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();
    await expect(page.getByText('Unauthorized session detected')).toBeVisible();
    await shot(page, size.label, '01-opening');

    await page.getByRole('button', { name: /Investigate the incident|Skip intro/ }).first().click();

    // 2 — first fully revealed office, 3 — critical centre-monitor alert
    await expect(page.locator('#incident-brief')).toBeVisible();
    await page.waitForTimeout(2200);
    await shot(page, size.label, '02-office');
    await expect(page.locator('#incident-brief')).toContainText('Critical');
    await shot(page, size.label, '03-critical-alert');

    // 4 — acknowledge, her entrance, her report and the briefing choice
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.getByRole('button', { name: 'Open response console' }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(400);
    await shot(page, size.label, '04-assistant');

    // 5 — evidence inspection
    await page.getByRole('button', { name: 'Open response console' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
    ]);
    await expect(page.locator('#evidence-inspector')).toContainText('Authenticated sender');
    await shot(page, size.label, '05-evidence');

    // 6 — consequential action confirmation
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' } },
      { tool: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      // Inspected here so the "contained" capture shows a clean 100/100 rather
      // than a run that quietly skipped an evidence step.
      { tool: 'inspect_artifact', input: { artifactId: 'art_cookie_001' } },
      { tool: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset' } },
      { tool: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
    ]);
    await page.getByRole('navigation').getByRole('button', { name: /^Respond/ }).click();
    await page.locator('#action-revoke_sessions').getByRole('button').first().click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await shot(page, size.label, '06-confirm-action');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();

    // 7 — successful containment
    await runSequence(page, PERFECT_RUN.slice(8));
    await continueToDebrief(page);
    await shot(page, size.label, '07-contained');

    // 8 — partial-containment debrief
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await page.getByRole('button', { name: 'Skip to console' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
    await runSequence(page, [
      { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_disable_account_now' } },
      { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
      { tool: 'submit_decision', input: { decisionId: 'D2', optionId: 'D2_trust_sender_display_name' } },
      { tool: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
      { tool: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_password_only' } },
      { tool: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_delete_email_and_close_alert' } },
      { tool: 'submit_decision', input: { decisionId: 'D5', optionId: 'D5_assume_single_account' } },
      { tool: 'submit_decision', input: { decisionId: 'D6', optionId: 'D6_close_without_verifying' } },
      { tool: 'take_response_action', input: { actionId: 'close_case' } },
    ]);
    await continueToDebrief(page);
    await expect(page.locator('#debrief-outcome')).toContainText('Partial containment');
    await shot(page, size.label, '08-partial-debrief');
  });
}
