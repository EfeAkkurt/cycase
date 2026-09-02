import { expect, test } from '@playwright/test';

import { installModelContext } from './helpers';

/**
 * The page cannot type into the chat, so the lobby hands the player the prompt
 * and a copy button. Without site tools it says where to open the page instead.
 */

test('offers the prompt in two modes and two languages', async ({ page }) => {
  await installModelContext(page);
  await page.goto('/');

  const text = page.locator('#agent-prompt-text');
  await expect(text).toBeVisible();
  await expect(text).toContainText('get_incident');
  await expect(text).toContainText('propose it and wait');
  await expect(text).toContainText('you are Deniz');
  await expect(page.getByRole('button', { name: 'Learn' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Solve' }).click();
  await expect(text).toContainText('wait for my approval');
  await expect(page.getByRole('button', { name: 'Learn' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  await page.getByRole('button', { name: 'Türkçe' }).click();
  await expect(text).toContainText('onayımı bekle');
});

test('copies the prompt to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await installModelContext(page);
  await page.goto('/');

  await page.locator('#agent-prompt-copy').click();
  await expect(page.locator('#agent-prompt-copy')).toHaveText(/Copied/);
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain('get_incident');
});

test('says where to open the page when there are no site tools', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#agent-prompt')).toContainText('ChatGPT desktop');
  await expect(page.locator('#agent-prompt-text')).toHaveCount(0);
});

test('leaves the lobby usable and does not block entering', async ({ page }) => {
  await installModelContext(page);
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'Enter Simulation' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Skip intro' })).toBeEnabled();
});
