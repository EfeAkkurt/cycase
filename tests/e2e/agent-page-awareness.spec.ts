import { expect, test } from '@playwright/test';

import { callTool, installModelContext, openDashboard } from './helpers';

/**
 * `get_incident` says where the player is, so a coach cannot explain the first
 * decision to a screen the player has not opened yet. The two page-side gates —
 * entering the simulation and acknowledging the alarm — stay with the player,
 * and the agent is told to ask for them.
 */

test.beforeEach(async ({ page }) => {
  await installModelContext(page);
});

type Incident = { page: string };

test('reports that the player has not entered yet', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(async () => (await callTool<Incident>(page, 'get_incident', {}).catch(() => null))?.ok)
    .toBe(true);

  const result = await callTool<Incident>(page, 'get_incident', {});
  expect(result.data?.page).toBe('enter_simulation');
});

test('reports the alarm the player still has to acknowledge', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('cycase.office3d', 'false');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await page.getByRole('button', { name: 'Acknowledge alarm' }).first().waitFor();

  const result = await callTool<Incident>(page, 'get_incident', {});
  expect(result.data?.page).toBe('acknowledge_alarm');
});

test('reports the console once it is open, and keeps the payload in budget', async ({ page }) => {
  await openDashboard(page);

  const result = await callTool<Incident>(page, 'get_incident', {});
  expect(result.data?.page).toBe('console_ready');
  // The token is reserved before compaction, so the merged payload still fits.
  expect(JSON.stringify(result).length).toBeLessThanOrEqual(1500);
});

test('names every state it can report in the tool description', async ({ page }) => {
  await page.goto('/');
  await expect
    .poll(async () => (await callTool(page, 'get_incident', {}).catch(() => null))?.ok)
    .toBe(true);

  const tools = await page.evaluate(async () => {
    const ctx = (document as unknown as { modelContext: { getTools: () => Promise<unknown[]> } })
      .modelContext;
    return (await ctx.getTools()) as { name: string; description: string }[];
  });
  const incident = tools.find((tool) => tool.name === 'get_incident');
  for (const state of [
    'enter_simulation',
    'acknowledge_alarm',
    'briefing',
    'briefing_choice',
    'console_ready',
    'debrief',
  ]) {
    expect(incident?.description).toContain(state);
  }
});
