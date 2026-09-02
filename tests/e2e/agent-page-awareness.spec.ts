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

test.describe('the office hands over when the agent starts working', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('cycase.office3d', 'false');
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.getByRole('button', { name: 'Open response console' }).waitFor({ timeout: 30_000 });
    await expect
      .poll(async () => (await callTool<Incident>(page, 'get_incident', {})).data?.page)
      .toBe('briefing_choice');
  });

  test('a case call opens the console so a proposal has somewhere to land', async ({ page }) => {
    const read = await callTool<Incident>(page, 'get_incident', {});
    expect(read.data?.page).toBe('briefing_choice');

    const decision = await callTool(page, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
      stateVersion: read.stateVersion,
      idempotencyKey: 'handover-d1',
    });
    expect(decision.ok).toBe(true);

    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible({
      timeout: 15_000,
    });
    const after = await callTool<Incident>(page, 'get_incident', {});
    expect(after.data?.page).toBe('console_ready');
  });

  test('a read leaves the player where they are', async ({ page }) => {
    await callTool(page, 'get_incident', {});
    await callTool(page, 'request_hint', { topic: 'evidence' });
    await page.waitForTimeout(1000);

    await expect(page.getByRole('button', { name: 'Open response console' })).toBeVisible();
    const still = await callTool<Incident>(page, 'get_incident', {});
    expect(still.data?.page).toBe('briefing_choice');
  });

  test('a refused call leaves the player where they are', async ({ page }) => {
    const bad = await callTool(page, 'take_response_action', {
      actionId: 'close_case',
      stateVersion: 0,
      idempotencyKey: 'too-early',
    });
    expect(bad.ok).toBe(false);
    await page.waitForTimeout(700);

    const still = await callTool<Incident>(page, 'get_incident', {});
    expect(still.data?.page).toBe('briefing_choice');
  });
});

test('never skips the alarm the player has not acknowledged', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('cycase.office3d', 'false');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await page.getByRole('button', { name: 'Acknowledge alarm' }).first().waitFor();

  const read = await callTool<Incident>(page, 'get_incident', {});
  const decision = await callTool(page, 'submit_decision', {
    decisionId: 'D1',
    optionId: 'D1_preserve_and_inspect',
    stateVersion: read.stateVersion,
    idempotencyKey: 'before-alarm',
  });
  // The case moves; the player does not.
  expect(decision.ok).toBe(true);
  await page.waitForTimeout(1000);

  const still = await callTool<Incident>(page, 'get_incident', {});
  expect(still.data?.page).toBe('acknowledge_alarm');
  await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
});
