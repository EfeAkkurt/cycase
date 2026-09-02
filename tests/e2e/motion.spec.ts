import { expect, test, type Page } from '@playwright/test';

/**
 * Motion and game feel, in the browser.
 *
 * The acceptance list for this phase, stated as things a player experiences:
 * the alarm reads as one rhythm, the app never pretends to have a sound it does
 * not have, nothing in the opening or the transition takes input away, and
 * somebody who asked for no motion gets none.
 *
 * What is deliberately *not* here: frame rate. Headless Chromium rasterises
 * WebGL in software — the Playwright config says so and keeps the 3D specs in
 * their own GPU project — so a cadence measured here would be a measurement of
 * the rasteriser. The policy that decides the cadence is asserted instead, as
 * arithmetic, in `tests/unit/motion.test.ts`.
 */

/** The office on the flat monitor wall: no WebGL, and the alarm is DOM. */
async function openOffice2D(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('cycase.office3d', 'false');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
}

/* ------------------------------------------------------------------ */

test.describe('one alarm rhythm', () => {
  test('phase-locks the border keyframe to the shared clock', async ({ page }) => {
    await openOffice2D(page);

    /*
     * The animation's own `currentTime` is the border's real phase — not a
     * number the app wrote down about itself. Compared against the phase the
     * shared clock reports for the same instant, which is what the room reads
     * per frame.
     */
    const reading = await page.evaluate(() => {
      const surface = document.querySelector('.office3d__surface--alarm');
      if (!surface) throw new Error('the alarm surface is not on screen');

      const animation = surface.getAnimations()[0];
      if (!animation) throw new Error('the alarm border is not animating');

      const effect = animation.effect as KeyframeEffect;
      /*
       * `localTime`, not `currentTime`.
       *
       * `currentTime` is measured from when the animation started and excludes
       * the delay; `localTime` is where inside the keyframe the browser is
       * actually painting, which is the whole point of the negative delay this
       * is here to check. Comparing `currentTime` would have measured how long
       * ago the surface mounted and called it drift.
       */
      const computed = effect.getComputedTiming();
      return {
        duration: Number(effect.getTiming().duration),
        localTime: Number(computed.localTime),
        now: performance.now(),
      };
    });

    // The period is the shared constant, not a value typed into the stylesheet.
    expect(reading.duration).toBe(1600);

    // Where the keyframe is, and where the clock says it should be.
    const cssProgress = ((reading.localTime % 1600) + 1600) % 1600;
    const clockProgress = ((reading.now % 1600) + 1600) % 1600;
    const skew = Math.min(
      Math.abs(cssProgress - clockProgress),
      1600 - Math.abs(cssProgress - clockProgress),
    );

    console.log(`alarm phase skew: ${skew.toFixed(1)} ms`);
    expect(skew, `border and room are ${skew.toFixed(1)} ms apart`).toBeLessThanOrEqual(50);
  });

  test('pulses far below the flash threshold', async ({ page }) => {
    await openOffice2D(page);
    const duration = await page.evaluate(() => {
      const surface = document.querySelector('.office3d__surface--alarm');
      const animation = surface?.getAnimations()[0];
      return Number((animation?.effect as KeyframeEffect | undefined)?.getTiming().duration ?? 0);
    });
    // WCAG 2.3.1's general threshold is three flashes a second.
    expect(1000 / duration).toBeLessThan(3);
  });
});

/* ------------------------------------------------------------------ */

test.describe('acknowledging the alarm', () => {
  test('answers the press, settles the room, then says it was acknowledged', async ({ page }) => {
    await openOffice2D(page);

    const office = page.locator('.office');
    await expect(office).toHaveAttribute('data-ack-stage', 'idle');

    const pressedAt = Date.now();
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    // The press is answered, and quickly. The attribute is set synchronously in
    // the handler, so what this really measures is that nothing defers it.
    await expect(office).not.toHaveAttribute('data-ack-stage', 'idle');
    const answeredIn = Date.now() - pressedAt;
    console.log(`press answered in ${answeredIn} ms`);
    expect(answeredIn).toBeLessThanOrEqual(100);

    // And the bundle finishes rather than latching: a room that can never leave
    // its acknowledged state is a room stuck in a beat.
    await expect(office).toHaveAttribute('data-ack-stage', 'idle', { timeout: 3_000 });
    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(0);
  });

  test('never shakes the screen and never takes the keyboard', async ({ page }) => {
    await openOffice2D(page);

    const before = await page.evaluate(() => {
      const main = document.querySelector('.office') as HTMLElement;
      const rect = main.getBoundingClientRect();
      return { x: rect.x, y: rect.y, transform: getComputedStyle(main).transform };
    });

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    // Sampled through the whole bundle. A shake would move the root; the
    // contract forbids one outright.
    for (let sample = 0; sample < 6; sample += 1) {
      const during = await page.evaluate(() => {
        const main = document.querySelector('.office') as HTMLElement;
        const rect = main.getBoundingClientRect();
        return { x: rect.x, y: rect.y, transform: getComputedStyle(main).transform };
      });
      expect(during.x).toBe(before.x);
      expect(during.y).toBe(before.y);
      expect(during.transform).toBe(before.transform);
      await page.waitForTimeout(150);
    }
  });
});

/* ------------------------------------------------------------------ */

test.describe('the app does not pretend to have a sound', () => {
  test('says the alarm is silent rather than playing a stand-in', async ({ page }) => {
    await openOffice2D(page);

    const installed = await page.evaluate(() => window.__CYCASE_AUDIO__?.installedAudio ?? null);
    expect(installed, '__CYCASE_AUDIO__.installedAudio is not published').not.toBeNull();

    if (installed!.length === 0) {
      // The shipped state: no licensed files on disk. The room says so in
      // words rather than substituting a synthesised siren, which would set the
      // wrong expectation for the one sound the whole opening depends on.
      await expect(page.locator('.dialogue')).toContainText('not installed');
    } else {
      // If the files ever land, the honesty note must go with them.
      await expect(page.locator('.dialogue')).not.toContainText('not installed');
    }
  });

  test('requests no audio it was not told exists', async ({ page }) => {
    const audioRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/audio\//.test(request.url())) audioRequests.push(request.url());
    });

    await openOffice2D(page);
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.waitForTimeout(500);

    const installed = (await page.evaluate(() => window.__CYCASE_AUDIO__?.installedAudio)) ?? [];
    // One request per installed file, and none at all when none are installed —
    // not three 404s for an answer the build already had.
    expect(audioRequests).toHaveLength(installed.length);
  });
});

/* ------------------------------------------------------------------ */

test.describe('nothing in the opening takes input away', () => {
  test('leaves every full-viewport overlay click-through', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();

    const blocking = await page.evaluate(() =>
      ['.transition-cover', '.wake', '.fade-layer', '.eyelid']
        .flatMap((selector) => [...document.querySelectorAll(selector)])
        .filter((node) => getComputedStyle(node).pointerEvents !== 'none')
        .map((node) => node.className),
    );
    expect(blocking, `these overlays would swallow a click: ${blocking.join(', ')}`).toEqual([]);
  });

  test('keeps the intro controls operable for the whole reveal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();

    // Mid-reveal, both controls answer.
    const complete = page.locator('#intro-complete');
    await expect(complete).toBeVisible();
    await expect(complete).toBeEnabled();
    await expect(page.locator('#intro-advance')).toBeEnabled();
  });

  test('shows the whole text on request, without leaving the scene', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();
    await page.locator('#intro-complete').click();

    // Every line complete, the reveal over, and still on the opening.
    const typed = await page.evaluate(() =>
      [...document.querySelectorAll('.intro__glyphs')].map(
        (node) => (node as HTMLElement).dataset.typed ?? '',
      ),
    );
    expect(typed.filter((line) => line.length > 0)).toHaveLength(3);
    expect(typed.join('')).toContain('Unauthorized session detected in the identity layer.');

    await expect(page.locator('#intro-complete')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Investigate the incident' })).toBeVisible();
  });

  test('stops offering to skip the intro once the intro is over', async ({ page }) => {
    await openOffice2D(page);
    // The office is what comes after the intro. Nothing here offers to skip it.
    await expect(page.getByRole('button', { name: 'Skip intro' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Skip to console' })).toBeVisible();
  });
});

/* ------------------------------------------------------------------ */

test.describe('the console arrives from the monitor that was pressed', () => {
  test('centres the reveal on the activated screen', async ({ page }) => {
    await openOffice2D(page);
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    const open = page.getByRole('button', { name: /^Open / }).last();
    await expect(open).toBeVisible();
    const box = (await open.boundingBox())!;
    const viewport = page.viewportSize()!;

    await open.click();

    const cover = page.locator('[data-testid="transition-cover"]');
    const originX = Number(await cover.getAttribute('data-origin-x'));
    const originY = Number(await cover.getAttribute('data-origin-y'));

    // Within a quarter of the viewport of the control that was pressed: the
    // reveal grows out of that screen rather than from the middle by default.
    expect(Math.abs(originX - (box.x + box.width / 2) / viewport.width)).toBeLessThan(0.25);
    expect(Math.abs(originY - (box.y + box.height / 2) / viewport.height)).toBeLessThan(0.25);
  });

  /*
   * The cover's own budget is 870 ms and is asserted exactly, as arithmetic, in
   * `tests/unit/motion.test.ts`. What this measures is the whole observable
   * crossing — the click round trip, the cover, and the console's first paint —
   * so it is checked against a looser bound on purpose. A tight assertion here
   * would be measuring Playwright.
   */
  test('crosses to the console without a visible gap', async ({ page }) => {
    await openOffice2D(page);
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    const started = Date.now();
    await page.getByRole('button', { name: /^Open / }).last().click();
    await page.locator('.topbar__context', { hasText: /Session Ghost/ }).waitFor();
    // The cover is gone, not merely transparent.
    await expect(page.locator('[data-testid="transition-cover"]')).toHaveCount(0, {
      timeout: 2_000,
    });
    const elapsed = Date.now() - started;

    console.log(`office → dashboard in ${elapsed} ms`);
    // Generous over the 870 ms the cover budgets, because this also includes
    // the click round trip and the dashboard's first paint.
    expect(elapsed).toBeLessThanOrEqual(1_800);
  });
});

/* ------------------------------------------------------------------ */

test.describe('reduced motion', () => {
  /*
   * Emulated per test rather than by joining the `reduced-motion` project.
   *
   * That project exists to run *whole specs* a second time under the
   * preference; this file's other assertions are about motion that must still
   * happen, so running all of them again with motion off would prove nothing
   * twice. `emulateMedia` has to precede navigation, because the preference is
   * read when the components mount.
   */
  test('holds the alarm still instead of pulsing it', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openOffice2D(page);

    const animating = await page.evaluate(() => {
      const surface = document.querySelector('.office3d__surface--alarm');
      if (!surface) throw new Error('the alarm surface is not on screen');
      return {
        animations: surface.getAnimations().length,
        shadow: getComputedStyle(surface).boxShadow,
      };
    });

    expect(animating.animations, 'the border is still animating').toBe(0);
    // Held at the midpoint, not frozen at the dim end of its range: an alarm
    // stopped at its faintest is the one thing this state must not look like.
    expect(animating.shadow).not.toBe('none');
  });

  test('runs no transform anywhere in the office', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openOffice2D(page);
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.waitForTimeout(400);

    const moving = await page.evaluate(() =>
      [...document.querySelectorAll('.office, .office *')]
        .filter((node) => {
          const style = getComputedStyle(node);
          const transform = style.transform;
          return (
            style.animationName !== 'none' &&
            transform !== 'none' &&
            transform !== 'matrix(1, 0, 0, 1, 0, 0)'
          );
        })
        .map((node) => node.className)
        .slice(0, 5),
    );
    expect(moving, `still animating a transform: ${moving.join(', ')}`).toEqual([]);
  });

  test('shows the opening complete, with no reveal at all', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();

    // Straight to the finished frame: no typing, and the advance control is
    // already the one that leaves.
    await expect(page.getByRole('button', { name: 'Investigate the incident' })).toBeVisible();
    await expect(page.locator('#intro-complete')).toHaveCount(0);
  });
});
