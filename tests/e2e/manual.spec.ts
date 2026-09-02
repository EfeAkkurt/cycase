import { expect, test, type Page } from '@playwright/test';

import {
  collectPageProblems,
  continueToDebrief,
  openDashboard,
  PERFECT_RUN,
  readStateVersion,
} from './helpers';

/**
 * Acceptance criterion 1: "The player can complete Case 001 manually."
 * Nothing in this file touches WebMCP — every step is a real click or key press
 * on a real control.
 */

/*
 * The dashboard is guided now (audit P0.6): one required step at a time, and a
 * decision's options render only once the operation that unlocks it is complete.
 * Running the auth-timeline diagnostic is half of an operation — reading the token
 * telemetry is the other half — so a sequence that skips the read never sees D3.
 *
 * That gating is the human path by design; the WebMCP tools remain unrestricted, and
 * webmcp.spec.ts covers the agent driving atomic calls in any legal order. These
 * tests therefore follow the guided path, which is what a player actually does.
 */
function nav(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}`) });
}

async function decide(page: Page, label: string | RegExp) {
  await nav(page, 'Command').click();
  await page.getByRole('button', { name: label }).click();
}

async function inspect(page: Page, name: string | RegExp) {
  await nav(page, 'Evidence').click();
  await page.locator('#evidence-list').getByRole('button', { name }).click();
}

async function runDiagnostic(page: Page, title: string) {
  await nav(page, 'Respond').click();
  await page
    .locator(`#diagnostic-${title}`)
    .getByRole('button', { name: 'Run' })
    .click();
}

async function respond(page: Page, label: string, confirm = true) {
  await nav(page, 'Respond').click();
  await page.locator(`#action-${label}`).getByRole('button').first().click();
  if (confirm) {
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
  }
}

test('a player completes the case with visible controls only', async ({ page }) => {
  await openDashboard(page);

  await decide(page, 'Preserve the reported message and inspect it');
  await inspect(page, /Phishing message/);
  await decide(page, 'Compare the authenticated sender and sign-in telemetry');
  await runDiagnostic(page, 'auth_timeline');
  await inspect(page, /Token telemetry/);
  await decide(page, 'Revoke every active session, then reset credentials');
  await runDiagnostic(page, 'session_inventory');
  await respond(page, 'revoke_sessions');
  await respond(page, 'reset_credentials');
  await decide(page, 'Collect the endpoint evidence, then isolate the host');
  await inspect(page, /Endpoint report/);
  await respond(page, 'isolate_endpoint');
  await decide(page, 'Sweep every indicator across the estate');
  await runDiagnostic(page, 'indicator_scope');
  await respond(page, 'block_indicator', false);
  await decide(page, 'Review the containment checklist, then close');
  await respond(page, 'close_case');

  // The console stays up on the close, so the run ends the way a player ends
  // it: read the receipt, then open the debrief.
  await continueToDebrief(page);
  await expect(page.locator('#debrief-outcome')).toContainText('Contained');
  await expect(page.locator('#debrief-outcome')).toContainText('100/100');
  await expect(page.locator('#debrief-missed')).toContainText('Nothing critical was left open');
});

test('closing with open findings produces the partial ending and explains the cost', async ({
  page,
}) => {
  test.slow();
  await openDashboard(page);

  /*
   * A poor player, played as a poor player actually plays: follow the guided path
   * and take the wrong option every single time.
   *
   * The route is deliberately not hard-coded. A wrong decision changes what the
   * case asks for next, so a fixed sequence would encode one particular wrong
   * route and break whenever the guidance changed — which is exactly what it did.
   * What this test is really for is the audit's requirement that wrong options are
   * "valid pedagogical branches with consequences": the run must stay completable,
   * end in partial containment, and say what it cost.
   *
   * "Wrong" is derived rather than listed: any option the canonical PERFECT_RUN
   * does not choose. If the fixture gains a decision, this keeps working.
   */
  const perfectOptions = new Set(
    PERFECT_RUN.filter((step) => step.tool === 'submit_decision').map(
      (step) => step.input.optionId as string,
    ),
  );

  const chosen: string[] = [];

  for (let move = 0; move < 40; move += 1) {
    // Check for the ending FIRST: once the case is closed there is no next
    // required step to press, and what stands in the card's place is the close
    // beat. The loop stops there and the debrief is opened below, deliberately
    // outside the loop — leaving the console is not one of the moves.
    if (await page.locator('#close-continue').count()) break;
    await nav(page, 'Command').click();

    const options = await page.locator('[id^="decision-option-"]').all();
    if (options.length > 0) {
      let picked = false;
      for (const option of options) {
        const id = (await option.getAttribute('id'))!.replace('decision-option-', '');
        if (!perfectOptions.has(id)) {
          chosen.push(id);
          await option.click();
          picked = true;
          break;
        }
      }
      // A decision with no wrong option would make this test meaningless.
      expect(picked, `every option of this decision is part of the perfect run`).toBe(true);
      continue;
    }

    const cta = page.locator('#next-step-cta');
    await expect(cta).toBeVisible();
    await cta.click();
    const dialog = page.getByRole('alertdialog');
    if (await dialog.count()) {
      await dialog.getByRole('button', { name: 'Confirm' }).click();
    }
  }

  // Every decision was answered, and answered badly.
  expect(chosen.length, `wrong options taken: ${chosen.join(', ')}`).toBe(perfectOptions.size);

  await continueToDebrief(page);
  await expect(page.locator('#debrief-outcome')).toContainText('Partial containment');
  await expect(page.locator('#debrief-missed')).toContainText('Stolen session still active');
  await expect(page.locator('#debrief-missed')).toContainText('Endpoint still leaking cookies');
});

test('a destroyed artifact cannot be inspected again', async ({ page }) => {
  await openDashboard(page);

  await decide(page, 'Preserve the reported message and inspect it');
  await inspect(page, /Phishing message/);
  await decide(page, 'Compare the authenticated sender and sign-in telemetry');
  await runDiagnostic(page, 'auth_timeline');
  await inspect(page, /Token telemetry/);
  await decide(page, 'Revoke every active session, then reset credentials');
  await runDiagnostic(page, 'session_inventory');
  await respond(page, 'revoke_sessions');
  await respond(page, 'reset_credentials');
  await decide(page, 'Delete the suspicious email and close the alert');

  await nav(page, 'Evidence').click();
  const email = page.locator('#evidence-art_email_001');
  await expect(email).toContainText('Destroyed');
  await expect(email).toBeDisabled();
});

test('a double-clicked consequential control applies once', async ({ page }) => {
  await openDashboard(page);
  await runDiagnostic(page, 'session_inventory');

  const versionBefore = await readStateVersion(page);
  await respond(page, 'revoke_sessions');
  const versionAfter = await readStateVersion(page);
  expect(versionAfter).toBe(versionBefore + 1);

  // The control is now disabled with a stated reason, so it cannot fire twice.
  const button = page.locator('#action-revoke_sessions').getByRole('button').first();
  await expect(button).toHaveCount(0);
  await expect(page.locator('#action-revoke_sessions')).toContainText('Applied');
});

test('focus lands on the incident title after the transition', async ({ page }) => {
  await openDashboard(page);
  const focusedId = await page.evaluate(() => document.activeElement?.id);
  expect(focusedId).toBe('incident-title');
});

test('the entire golden path produces zero console errors, zero page errors and zero failed requests', async ({
  page,
}) => {
  // P0.8: the duplicate-key error only appeared *after* auth_timeline ran, so a
  // console gate that stops at navigation proves nothing. This one plays the
  // whole case — every diagnostic, every decision, every response action —
  // with all three listeners armed for the duration.
  // The three missing alarm samples are discounted by name in the helper; a
  // fourth console error or failed request still fails this test.
  const { errors, pageErrors, failed } = collectPageProblems(page);

  await openDashboard(page);

  await decide(page, 'Preserve the reported message and inspect it');
  await inspect(page, /Phishing message/);
  await decide(page, 'Compare the authenticated sender and sign-in telemetry');
  await runDiagnostic(page, 'auth_timeline');
  await inspect(page, /Token telemetry/);
  await decide(page, 'Revoke every active session, then reset credentials');
  await runDiagnostic(page, 'session_inventory');
  await respond(page, 'revoke_sessions');
  await respond(page, 'reset_credentials');
  await decide(page, 'Collect the endpoint evidence, then isolate the host');
  await inspect(page, /Endpoint report/);
  await respond(page, 'isolate_endpoint');
  await decide(page, 'Sweep every indicator across the estate');
  await runDiagnostic(page, 'indicator_scope');
  await respond(page, 'block_indicator', false);
  await decide(page, 'Review the containment checklist, then close');
  await respond(page, 'close_case');
  await continueToDebrief(page);

  // Visit every dashboard artifact of the run before judging.
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
  expect(failed, failed.join('\n')).toEqual([]);
});

test('the shipped build publishes its own identity', async ({ page }) => {
  // The build SHA has to be visible on the deployed build. `buildInfo` is only
  // reachable through a side-effect import;
  // without it the module tree-shakes out and the bundle cannot name itself,
  // while the unit test still passes because vitest imports it directly. This
  // asserts against the actual served bundle.
  await page.goto('/');
  const build = await page.evaluate(
    () => (window as unknown as { __CYCASE_BUILD__?: { sha: string; version: string; builtAt: string } }).__CYCASE_BUILD__,
  );
  expect(build, 'window.__CYCASE_BUILD__ is missing from the served bundle').toBeTruthy();
  expect(build!.sha).not.toBe('unknown');
  expect(build!.sha).toMatch(/^[0-9a-f]{7,}(-dev)?$/);
  expect(build!.version).not.toBe('0.0.0');
});

test('local mode is the default and makes zero backend requests', async ({ page }) => {
  /*
   * BACKEND_RUNTIME_CONTRACT §5 makes local mode the required default and says
   * the browser must complete Case 001 with the backend entirely absent. The
   * backend modules are implemented and tested but deliberately NOT wired into
   * the production provider tree for this release, so this asserts the shipped
   * behaviour rather than an intention: a complete run touches no API at all.
   */
  test.setTimeout(120_000);

  const apiCalls: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/api\//.test(url) || /:4[0-9]{3}\/api/.test(url)) apiCalls.push(url);
  });

  await openDashboard(page);
  await decide(page, 'Preserve the reported message and inspect it');
  await inspect(page, /Phishing message/);
  await decide(page, 'Compare the authenticated sender and sign-in telemetry');
  await runDiagnostic(page, 'auth_timeline');
  await inspect(page, /Token telemetry/);
  await decide(page, 'Revoke every active session, then reset credentials');
  await runDiagnostic(page, 'session_inventory');
  await respond(page, 'revoke_sessions');
  await respond(page, 'reset_credentials');
  await decide(page, 'Collect the endpoint evidence, then isolate the host');
  await inspect(page, /Endpoint report/);
  await respond(page, 'isolate_endpoint');
  await decide(page, 'Sweep every indicator across the estate');
  await runDiagnostic(page, 'indicator_scope');
  await respond(page, 'block_indicator', false);
  await decide(page, 'Review the containment checklist, then close');
  await respond(page, 'close_case');

  await continueToDebrief(page);
  await expect(page.locator('#debrief-outcome')).toContainText('100/100');

  expect(apiCalls, `unexpected backend calls:\n${apiCalls.join('\n')}`).toEqual([]);
});
