import { expect, test, type Page } from '@playwright/test';

/**
 * The office layer: WebGL room, projected DOM monitors, audio controls, and the
 * fallbacks that have to keep the case playable when any of that is missing.
 */

async function openOffice(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  // The office opens in the unacknowledged-alarm state (audit P0.2).
  await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
}

/**
 * Walks focus forward with the Tab key until it lands on `selector`.
 *
 * Deliberately not `locator.focus()`. What the redesign's §10 gate asks for is
 * that the monitors are *reachable* by keyboard, and a scripted `.focus()` call
 * proves only that an element can hold focus — it would pass just as happily on
 * the old `<div role="group">` with no `tabIndex`, which no player could ever
 * have reached. Pressing Tab is the assertion.
 */
async function tabTo(page: Page, selector: string, limit = 40) {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    const landed = await page.evaluate(
      (target) => document.activeElement?.matches(target) ?? false,
      selector,
    );
    if (landed) return;
  }
  throw new Error(`Tab never reached ${selector} in ${limit} presses`);
}

/** The console destination the side navigation is currently marking. */
function currentRoute(page: Page) {
  return page.locator('#sidebar-nav [aria-current="page"]');
}

test.describe('3D office', () => {
  test('renders a single WebGL canvas, hidden from assistive technology', async ({ page }) => {
    await openOffice(page);

    const canvas = page.locator('canvas');
    await expect(canvas).toHaveCount(1);

    const readCanvas = () =>
      page.evaluate(() => {
        const element = document.querySelector('canvas');
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          width: element.width,
          height: element.height,
          cssWidth: rect.width,
          ariaHidden: Boolean(element.closest('[aria-hidden="true"]')),
        };
      });

    // Sizing is inherently asynchronous: the renderer only learns the viewport
    // from an observer callback, so the canvas is briefly at its intrinsic
    // 300x150. Poll rather than race it.
    await expect.poll(async () => (await readCanvas())?.width ?? 0, { timeout: 10_000 }).toBeGreaterThan(
      300,
    );

    const info = (await readCanvas())!;
    // One canvas, one renderer, device pixel ratio capped at 1.5
    // (docs/PRODUCT_SPEC.md performance budget).
    expect(info.width / info.cssWidth).toBeLessThanOrEqual(1.5 + 0.01);
    expect(info.ariaHidden).toBe(true);
  });

  test('projects three DOM monitor surfaces onto the bezels', async ({ page }) => {
    await openOffice(page);

    const screens = page.locator('.office3d__screen');
    await expect(screens).toHaveCount(3);

    const transforms = await screens.evaluateAll((nodes) =>
      nodes.map((node) => getComputedStyle(node).transform),
    );

    for (const transform of transforms) {
      // A real perspective mapping, not a flat translate.
      expect(transform).toContain('matrix3d');
    }
  });

  test('keeps the monitor interfaces as real, readable DOM', async ({ page }) => {
    await openOffice(page);

    // Text is selectable DOM, not pixels in a texture — and it is now three
    // different SOC tools rather than three views of the Command page
    // (docs/NODELESS_SOC_REDESIGN_2026-08-31.md §5).
    await expect(page.locator('#incident-brief')).toContainText('Critical');
    // Left: the live anomaly trend, with the SIEM's own event rows beneath it.
    await expect(page.locator('#overview-telemetry')).toContainText('Baseline');
    await expect(page.locator('#monitor-siem')).toContainText('indexed events');
    // Right: the contextual tool, which for Case 001 opens on Identity.
    await expect(page.locator('#monitor-investigate')).toContainText(
      'session store has not been queried',
    );
  });

  test('labels every monitor for assistive technology', async ({ page }) => {
    await openOffice(page);

    /*
     * The surface stays a labelled group in every beat, and the control that
     * opens the console is a button inside it. Putting `role="button"` on the
     * surface would have made everything on the screen presentational — one
     * label in exchange for the incident brief, the event rows and the session
     * table, which is the opposite of the readability this gate is about.
     */
    for (const label of [
      'Left monitor: SIEM live event stream',
      'Center monitor: incident command',
      'Right monitor: Identity',
    ]) {
      await expect(page.getByRole('group', { name: label })).toBeVisible();
    }
  });

  test('re-projects the monitors when the window is resized', async ({ page }) => {
    await openOffice(page);
    const read = () =>
      page.locator('.office3d__screen').first().evaluate((node) => getComputedStyle(node).transform);

    // The projection only exists once the office chunk has loaded and the
    // container has been measured. Reading before that captures `none`, which
    // trivially differs from anything and makes the assertion meaningless.
    await expect.poll(read, { timeout: 15_000 }).toContain('matrix3d');
    const before = await read();

    await page.setViewportSize({ width: 1100, height: 760 });
    await expect.poll(read, { timeout: 10_000 }).not.toBe(before);
  });
});

test.describe('3D fallbacks', () => {
  test('turning 3D off falls back to a flat monitor wall', async ({ page }) => {
    await openOffice(page);
    await expect(page.locator('canvas')).toHaveCount(1);

    await page.getByRole('button', { name: /3D office/ }).click();

    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('.monitors')).toBeVisible();
    // Same three panels, same store.
    await expect(page.locator('#incident-brief')).toContainText('Critical');
  });

  test('the preference survives a reload', async ({ page }) => {
    await openOffice(page);
    await page.getByRole('button', { name: /3D office/ }).click();
    await expect(page.locator('canvas')).toHaveCount(0);

    await openOffice(page);
    await expect(page.locator('canvas')).toHaveCount(0);
  });

  test('the case is still completable with 3D off', async ({ page }) => {
    await openOffice(page);
    await page.getByRole('button', { name: /3D office/ }).click();
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.getByRole('button', { name: 'Open response console' }).click({ timeout: 30_000 });

    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
    await page.locator('#decision-option-D1_preserve_and_inspect').click();
    await expect(page.locator('#decision-D1')).toContainText('Your choice');
  });

  test('a narrow viewport uses the flat wall regardless of the preference', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 800 });
    await openOffice(page);

    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('.monitors')).toBeVisible();
  });
});

test.describe('audio controls', () => {
  /** Counts real AudioContext constructions, so "no autoplay" is a fact. */
  const countAudioContexts = async (page: Page) => {
    await page.addInitScript(() => {
      const target = window as unknown as { __audioContexts: number; AudioContext: typeof AudioContext };
      target.__audioContexts = 0;
      const Real = target.AudioContext;
      if (!Real) return;
      target.AudioContext = class extends Real {
        constructor(...args: ConstructorParameters<typeof AudioContext>) {
          target.__audioContexts += 1;
          super(...args);
        }
      } as typeof AudioContext;
    });
  };

  const readCount = (page: Page) =>
    page.evaluate(() => (window as unknown as { __audioContexts?: number }).__audioContexts ?? -1);

  test('no AudioContext exists until the player chooses to enter', async ({ page }) => {
    await countAudioContexts(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Enter Simulation' })).toBeVisible();

    // docs/PRODUCT_SPEC.md: "audio begins only after user interaction".
    expect(await readCount(page)).toBe(0);

    await page.getByRole('button', { name: 'Enter Simulation' }).click();
    await expect.poll(() => readCount(page)).toBeGreaterThan(0);
  });

  test('skipping the intro also counts as the gesture that unlocks audio', async ({ page }) => {
    await countAudioContexts(page);
    await page.goto('/');
    expect(await readCount(page)).toBe(0);

    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect.poll(() => readCount(page)).toBeGreaterThan(0);
  });

  test('mute and volume are available and persist', async ({ page }) => {
    await openOffice(page);

    const mute = page.getByRole('button', { name: 'Mute' });
    await expect(mute).toBeVisible();
    await mute.click();
    await expect(page.getByRole('button', { name: 'Unmute' })).toBeVisible();

    const volume = page.getByRole('slider', { name: 'Volume' });
    await expect(volume).toBeDisabled();

    await page.getByRole('button', { name: 'Unmute' }).click();
    await volume.fill('30');

    await openOffice(page);
    await expect(page.getByRole('slider', { name: 'Volume' })).toHaveValue('30');
  });
});

test.describe('office to dashboard', () => {
  test('the transition tears the canvas down and keeps the case state', async ({ page }) => {
    // 3D boot plus the full arrival choreography; see manual.spec.ts.
    test.slow();
    await openOffice(page);
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.getByRole('button', { name: 'Explain the incident' }).click({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Open response console' })).toBeVisible();

    await page.getByRole('button', { name: 'Open response console' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();

    // WebGL is released once the office is gone — the dashboard never needs it.
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('#state-version')).toContainText('v0');
  });
});

/**
 * The three monitors as three tools — redesign §5, and the §10 gate that says
 * all three are "readable, keyboard-operable and open the correct full tool".
 *
 * Every assertion here is about the *3D* office, because that is the surface
 * the gate names and the one where a focus ring can be clipped away by the
 * room's `overflow: hidden`. The flat wall mounts the same descriptors from the
 * same module, so a divergence between the two paths is not possible by
 * construction rather than by a second copy of these tests.
 */
test.describe('monitors as tools', () => {
  /** What each screen shows, and where activating it has to land. */
  const MONITORS = [
    {
      name: 'left',
      opens: 'investigate:siem',
      route: 'Investigate',
      tab: 'investigate-tab-siem',
      opensLabel: 'Open the SIEM tool in the console',
    },
    {
      name: 'centre',
      opens: 'command',
      route: 'Command',
      tab: null,
      opensLabel: 'Open Command in the console',
    },
    {
      name: 'right',
      opens: 'investigate:identity',
      route: 'Investigate',
      tab: 'investigate-tab-identity',
      opensLabel: 'Open the Identity tool in the console',
    },
  ] as const;

  test('the surfaces do not act until the alarm is acknowledged', async ({ page }) => {
    test.slow();
    await openOffice(page);

    /*
     * P0.2 staging: the centre monitor's whole job at this moment is the alarm,
     * and a screen that could send the player to the console instead would undo
     * it. Nothing is an activation target yet.
     *
     * Scoped to the projected overlay rather than the whole document, so the
     * count says which wall it means: the flat fallback mounts the same three
     * controls, and a bare count would quietly pass on either.
     */
    const controls = page.locator('.office3d__overlay [data-monitor-opens]');
    await expect(controls).toHaveCount(0);

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    await expect(controls).toHaveCount(3);
  });

  for (const monitor of MONITORS) {
    test(`the ${monitor.name} monitor opens its tool from the keyboard alone`, async ({ page }) => {
      // 3D boot plus the entrance choreography; see manual.spec.ts.
      test.slow();
      await openOffice(page);
      await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

      const control = page.locator(
        `.office3d__overlay button[data-monitor-opens="${monitor.opens}"]`,
      );
      await expect(control).toHaveCount(1);
      // The accessible name says which tool it opens, before it is pressed —
      // and it is the visible text, so there is no label-in-name mismatch.
      await expect(control).toHaveAccessibleName(monitor.opensLabel);

      await tabTo(page, `.office3d__overlay [data-monitor-opens="${monitor.opens}"]`);
      await page.keyboard.press('Enter');

      await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible({
        timeout: 30_000,
      });
      await expect(currentRoute(page)).toContainText(monitor.route);
      if (monitor.tab) {
        await expect(page.locator(`#${monitor.tab}`)).toHaveAttribute('aria-selected', 'true');
      }
    });
  }

  test('Space opens a monitor as well as Enter', async ({ page }) => {
    test.slow();
    await openOffice(page);
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    // §10 asks for both keys. They come from the control being a real button
    // rather than a handler on the surface, which is exactly why it is one.
    await tabTo(page, '.office3d__overlay [data-monitor-opens="investigate:siem"]');
    await page.keyboard.press('Space');

    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('#investigate-tab-siem')).toHaveAttribute('aria-selected', 'true');
  });

  test('the route, the tab, the case and the narration setting survive the round trip', async ({
    page,
  }) => {
    test.slow();
    await openOffice(page);

    // A preference set in the room, before anything else happens to it.
    await page.getByRole('button', { name: 'Narration on' }).click();
    await expect(page.getByRole('button', { name: 'Narration off' })).toBeVisible();

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await tabTo(page, '.office3d__overlay [data-monitor-opens="investigate:identity"]');
    await page.keyboard.press('Enter');

    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.locator('#investigate-tab-identity')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Something to lose, so "the case state survived" is a claim about data
    // rather than about an empty context.
    await page.locator('#decision-option-D1_preserve_and_inspect').click();
    await expect(page.locator('#state-version')).toContainText('v1');

    await page.locator('#return-to-office').click();
    await page.locator('#office-resume-cta').click({ timeout: 30_000 });

    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible({
      timeout: 30_000,
    });
    // §10: "Dashboard -> office -> dashboard preserves state, route intent and
    // narration preference." All three, in one place, because they are one gate.
    await expect(currentRoute(page)).toContainText('Investigate');
    await expect(page.locator('#investigate-tab-identity')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.locator('#state-version')).toContainText('v1');
    await expect(page.getByRole('button', { name: 'Narration off' })).toBeVisible();
  });
});
