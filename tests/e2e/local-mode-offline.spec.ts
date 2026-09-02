import { expect, test, type Request } from '@playwright/test';

import { continueToDebrief, openDashboard } from './helpers';
import { testBaseUrl } from '../../scripts/test-port.mjs';

/**
 * Local mode makes zero backend requests (contract §14, first bullet).
 *
 * The unit suite proves the sync layer itself never calls `fetch` when no base
 * URL is configured (`tests/backend/unit/localMode.test.ts`). This proves the
 * complementary half from outside the code: with the backend NOT running, the
 * shipped bundle finishes Case 001 and every request it makes is a static asset
 * from its own origin.
 *
 * Kept in its own file rather than added to `manual.spec.ts`, which another
 * agent is actively editing.
 */

/** Requests that are not the app loading itself. */
function isBackendCall(request: Request, origin: string): boolean {
  const url = request.url();
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  if (!url.startsWith(origin)) return true;
  // Same-origin, but an API path would still mean a backend was contacted.
  return new URL(url).pathname.startsWith('/api/');
}

test('local mode completes Case 001 while making zero backend requests', async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? testBaseUrl()).origin;
  const offOrigin: string[] = [];
  const failed: string[] = [];

  page.on('request', (request) => {
    if (isBackendCall(request, origin)) offOrigin.push(`${request.method()} ${request.url()}`);
  });
  // A backend call that is *attempted* and refused would fail here rather than
  // in the request handler, so both are recorded.
  page.on('requestfailed', (request) => {
    if (isBackendCall(request, origin)) failed.push(request.url());
  });

  await openDashboard(page);

  const nav = (name: string) =>
    page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}`) });

  const decide = async (label: string | RegExp) => {
    await nav('Command').click();
    await page.getByRole('button', { name: label }).click();
  };
  const inspect = async (name: RegExp) => {
    await nav('Evidence').click();
    await page.locator('#evidence-list').getByRole('button', { name }).click();
  };
  const diagnostic = async (id: string) => {
    await nav('Respond').click();
    await page.locator(`#diagnostic-${id}`).getByRole('button', { name: 'Run' }).click();
  };
  const respond = async (id: string, confirm = true) => {
    await nav('Respond').click();
    await page.locator(`#action-${id}`).getByRole('button').first().click();
    if (confirm) {
      await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
    }
  };

  await decide('Preserve the reported message and inspect it');
  await inspect(/Phishing message/);
  await decide('Compare the authenticated sender and sign-in telemetry');
  await diagnostic('auth_timeline');
  await inspect(/Token telemetry/);
  await decide('Revoke every active session, then reset credentials');
  await diagnostic('session_inventory');
  await respond('revoke_sessions');
  await respond('reset_credentials');
  await decide('Collect the endpoint evidence, then isolate the host');
  await inspect(/Endpoint report/);
  await respond('isolate_endpoint');
  await decide('Sweep every indicator across the estate');
  await diagnostic('indicator_scope');
  await respond('block_indicator', false);
  await decide('Review the containment checklist, then close');
  await respond('close_case');

  // The case really finished, so the zero above is a zero over a whole run and
  // not over a page that never got started. The last press of that run is the
  // one that leaves the console, and it is the player's.
  await continueToDebrief(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible();
  await expect(page.locator('#debrief-outcome')).toContainText('Contained');

  expect(offOrigin, `unexpected backend requests:\n${offOrigin.join('\n')}`).toEqual([]);
  expect(failed, `failed backend requests:\n${failed.join('\n')}`).toEqual([]);
});
