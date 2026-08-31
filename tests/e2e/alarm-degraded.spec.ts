import { expect, test } from '@playwright/test';

/**
 * The alarm with its sample files absent — which is the state this repository
 * ships in, because Freesound requires a login to download the originals.
 *
 * The audit found a synthesised sweep standing in for the missing siren. A
 * stand-in is worse than silence: it sets the wrong expectation for the one
 * sound the opening depends on, and because it is audible it removes any
 * pressure to ever fetch the real file. These tests hold the degraded path to
 * silence plus an honest explanation.
 *
 * Silence is now also *quiet on the wire*. The build lists `public/audio/` and
 * tells the page which files exist, so a run with nothing installed asks for
 * nothing — see `src/audio/manifest.ts`. The degraded treatment itself is
 * unchanged: same red rim, same wording, same `degraded` phase, same list of
 * missing paths.
 */

test.describe('the alarm with no samples installed', () => {
  test.slow();

  test('reports the degraded phase and names the missing files', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();

    const status = await page.evaluate(() => window.__CYCASE_AUDIO__?.alarmStatus?.());

    expect(status, '__CYCASE_AUDIO__.alarmStatus is not published').toBeTruthy();
    expect(status!.phase).toBe('degraded');
    expect(status!.missing.length).toBeGreaterThan(0);
    console.log(`alarm degraded, missing: ${status!.missing.join(', ')}`);
  });

  test('says out loud that the alert is visual only', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByText(/alarm sound is not installed/i)).toBeVisible({ timeout: 20_000 });
  });

  test('the visual alarm still carries the alert on its own', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();

    // Colour is never the only channel: the pulse, the word "Critical" and the
    // named control all say the same thing.
    await expect(page.locator('.office3d__surface--alarm').first()).toBeVisible();
    await expect(page.locator('#incident-brief')).toContainText('Critical');
  });

  test('asks for nothing that is not there, and logs nothing', async ({ page }) => {
    /*
     * This test used to allow three 404s by name. It no longer does, and the
     * allowance was not merely deleted — the requests are gone.
     *
     * The build lists `public/audio/` and substitutes the result, so the page
     * knows which files exist before it asks for one. With the three CC0
     * samples absent, the correct number of audio requests is zero and the
     * correct number of console errors is zero. There is no longer such a thing
     * as an expected failed audio request on the demo path.
     *
     * The assertion is written against `installedAudio` rather than against a
     * literal, so it keeps meaning the same thing the day the files land: ask
     * for exactly what the build found, and nothing else.
     */
    const errors: string[] = [];
    const audioRequests: string[] = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // Chrome puts a failed resource's URL on the location, not in the text.
      errors.push(`${message.text()} ${message.location().url}`);
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('request', (request) => {
      if (request.url().includes('/audio/')) audioRequests.push(request.url());
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
    await page.waitForTimeout(6000);

    const installed = await page.evaluate(() => window.__CYCASE_AUDIO__?.installedAudio);
    expect(installed, '__CYCASE_AUDIO__.installedAudio is not published').toBeDefined();

    expect(errors, errors.join('\n')).toEqual([]);
    // Exactly one attempt per installed file, ever. Today that is none; a
    // retry loop would be invisible to the player and ruinous on a metered
    // connection, and a blind fetch would be three console errors.
    expect(audioRequests, `audio requests: ${audioRequests.join(', ')}`).toHaveLength(
      installed!.length,
    );
  });

  test('acknowledging is immediate and the alarm never returns', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(0);

    // Mute and unmute: a latched alarm must not resurrect.
    const mute = page.getByRole('button', { name: /Mute|Unmute/ }).first();
    if (await mute.count()) {
      await mute.click();
      await page.waitForTimeout(400);
      await mute.click();
      await page.waitForTimeout(600);
    }
    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(0);
  });
});
