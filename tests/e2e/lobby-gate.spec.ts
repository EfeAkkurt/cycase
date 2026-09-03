import { expect, test } from '@playwright/test';

import { callTool, installModelContext } from './helpers';

/**
 * The shift starts when an agent is on the case. Registration is not arrival —
 * the page registers its own tools on load — so the gate opens on the first
 * tool call carrying `origin: 'agent'`, and never deadlocks: a capable browser
 * nobody joins is let in anyway, and says why.
 */

test('waits for an agent rather than for its own registration', async ({ page }) => {
  await installModelContext(page, { agentArrives: false });
  await page.goto('/');

  const enter = page.getByRole('button', { name: 'Enter Simulation' });
  await expect(enter).toBeDisabled();
  await expect(page.locator('#lobby-gate')).toContainText('No agent has called one yet');
});

test('opens as soon as an agent calls a tool', async ({ page }) => {
  await installModelContext(page, { agentArrives: false });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Enter Simulation' })).toBeDisabled();

  await callTool(page, 'get_incident', {});

  await expect(page.getByRole('button', { name: 'Enter Simulation' })).toBeEnabled();
  await expect(page.locator('#lobby-gate')).toContainText('An agent is on the case');
});

test('lets a browser without site tools straight in', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Enter Simulation' })).toBeEnabled();
  await expect(page.locator('#lobby-gate')).toContainText('playable without an agent');
});

test('the gate is a real control, not a hidden one', async ({ page }) => {
  await installModelContext(page, { agentArrives: false });
  await page.goto('/');

  // A disabled primary action has to say why, or it reads as a broken page.
  await expect(page.locator('.btn__reason')).toContainText('Waiting for the agent');
});

test('a joined browser starts the shift without ceremony', async ({ page }) => {
  // The default double is a browser with an agent attached, which is what every
  // other spec means when it installs the shim.
  await installModelContext(page);
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Enter Simulation' })).toBeEnabled();
  await expect(page.locator('#lobby-gate')).toContainText('An agent is on the case');
});
