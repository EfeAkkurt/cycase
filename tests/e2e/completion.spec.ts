import { expect, test, type Page } from '@playwright/test';

import {
  PERFECT_RUN,
  consoleNarrationToggle,
  officeNarrationToggle,
  openConsoleSettings,
} from './helpers';

/**
 * Four ways to finish Case 001, each proven to the Debrief.
 *
 * The audit's finding was not that these paths were broken — it was that every
 * test of them stopped early. The 2D fallback was proven to answer D1
 * (`office.spec.ts`, "the case is still completable with 3D off"); the
 * reduced-motion project was pointed at `accessibility` and `narration` and so
 * ran nothing that plays the case by hand; the round trip was proven on the
 * headed GPU project alone and never carried on to an ending. "Renders" and
 * "completes" are different claims, and only the second one is an acceptance
 * gate (`docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §10: "Keyboard,
 * reduced-motion, 2D fallback and screen-reader paths complete the case").
 *
 * So every test in this file starts on the opening screen, plays Case 001 with
 * real controls, and ends on the Debrief with the outcome asserted there. What
 * distinguishes them is the *path*: which surface the player used to get into
 * the console, and what they changed on the way.
 *
 * Two deliberate constraints:
 *
 * - **No WebMCP shim is installed anywhere in this file.** These are the human
 *   paths. A `document.modelContext` in scope would leave open the question of
 *   whether the agent surface was quietly doing some of the work.
 * - **The flat monitor wall, not the WebGL room.** This file runs in the
 *   headless `desktop` and `reduced-motion` projects, where Chromium rasterises
 *   WebGL in software at about 3 FPS — a room is not a sensible thing to boot
 *   seventeen interactions deep. The 3D monitors have their own coverage on the
 *   real GPU in `office.spec.ts`; what is unproven, and proven here, is that
 *   the paths those tests open actually reach an ending.
 */

/** Scene transitions cross a cover and a machine state; 5 s is not enough. */
const SCENE = { timeout: 30_000 } as const;

/**
 * The opening screen, with the flat monitor wall selected before boot.
 *
 * `cycase.office3d = 'false'` is the same key `SettingsBar` writes, so this is
 * a returning player's stored preference rather than a test hook.
 */
async function openOffice2D(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('cycase.office3d', 'false'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
}

/**
 * One monitor's activation control, scoped to the flat wall.
 *
 * Scoped rather than global for the reason `office.spec.ts` scopes to
 * `.office3d__overlay`: both walls mount the same descriptors from
 * `MonitorWall2D.tsx`, so an unscoped locator would not say which surface it
 * found — and this file's whole subject is which surface the player used.
 */
function monitorControl(page: Page, opens: string) {
  return page.locator(`.monitors button[data-monitor-opens="${opens}"]`);
}

function nav(page: Page, name: string) {
  return page.getByRole('navigation').getByRole('button', { name: new RegExp(`^${name}`) });
}

/** The console destination the side navigation is currently marking. */
function currentRoute(page: Page) {
  return page.locator('#sidebar-nav [aria-current="page"]');
}

/**
 * One step of the canonical run, performed with the pointer on the destination
 * that owns it.
 *
 * Driven from `PERFECT_RUN` in `helpers.ts` rather than from a second list of
 * option labels. That fixture is the golden path the whole suite already agrees
 * on, and deriving the clicks from it means a case that gains a decision or
 * renames an artifact cannot leave this file testing a route nobody plays.
 */
async function playStepWithPointer(
  page: Page,
  step: { tool: string; input: Record<string, unknown> },
): Promise<void> {
  switch (step.tool) {
    case 'submit_decision': {
      await nav(page, 'Command').click();
      await page.locator(`#decision-option-${step.input.optionId as string}`).click();
      // The answered decision, its consequence and its lesson land in the
      // Command route's own card — which is also how this asserts the click
      // was accepted rather than merely dispatched.
      await expect(page.locator(`#decision-${step.input.decisionId as string}`)).toContainText(
        'Your choice',
      );
      break;
    }

    case 'inspect_artifact': {
      await nav(page, 'Evidence').click();
      await page.locator(`#evidence-${step.input.artifactId as string}`).click();
      break;
    }

    case 'run_diagnostic': {
      await nav(page, 'Respond').click();
      await page
        .locator(`#diagnostic-${step.input.diagnosticId as string}`)
        .getByRole('button', { name: 'Run' })
        .click();
      break;
    }

    case 'take_response_action': {
      await nav(page, 'Respond').click();
      await page
        .locator(`#action-${step.input.actionId as string}`)
        .getByRole('button')
        .first()
        .click();
      /*
       * Only the consequential actions raise a dialog — `block_indicator` does
       * not — so this asks the page rather than carrying a table of which ones
       * do. A table would go stale the day an action changes its mind.
       */
      const dialog = page.getByRole('alertdialog');
      if (await dialog.count()) {
        await dialog.getByRole('button', { name: 'Confirm' }).click();
      }
      break;
    }

    default:
      throw new Error(`no manual path for ${step.tool}`);
  }
}



/** The whole canonical run, with the pointer, from wherever the console is open. */
async function playCaseWithPointer(page: Page): Promise<void> {
  for (const step of PERFECT_RUN) {
    await playStepWithPointer(page, step);
  }
}

/** The ending every path in this file has to reach, asserted where it is stated. */
async function expectContainedDebrief(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible(SCENE);
  await expect(page.locator('#debrief-outcome')).toContainText('Contained');
  await expect(page.locator('#debrief-outcome')).toContainText('100/100');
  await expect(page.locator('#debrief-missed')).toContainText('Nothing critical was left open');
}

/**
 * Walks focus forward with Tab until it lands on `selector`.
 *
 * The same instrument `office.spec.ts` uses, and for the same reason: a
 * scripted `locator.focus()` proves an element can hold focus, not that a
 * player could ever have got there. Pressing Tab is the assertion.
 *
 * The limit is generous because the console is a large document and this starts
 * from wherever the previous interaction left the caret; Chromium wraps at the
 * end of the tab ring, so a reachable control is always found within one lap.
 */
async function tabTo(page: Page, selector: string, limit = 200): Promise<void> {
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

/** The same walk, for controls that are identified by their visible label. */
async function tabToText(page: Page, text: string, limit = 60): Promise<void> {
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    const landed = await page.evaluate(
      (target) => document.activeElement?.textContent?.trim() === target,
      text,
    );
    if (landed) return;
  }
  throw new Error(`Tab never reached a control labelled "${text}" in ${limit} presses`);
}

test.describe('every path finishes the case', () => {
  test('a route opened from a monitor survives office → dashboard → office → dashboard, and the case still completes', async ({
    page,
  }) => {
    test.slow();

    /*
     * §10: "Dashboard -> office -> dashboard preserves state, route intent and
     * narration preference."
     *
     * `office.spec.ts` asserts the preservation itself, on the headed GPU
     * project. Two things it does not do are what this test is for: it never
     * reaches an ending, and it never runs anywhere but `desktop-3d` — so a
     * regression in the intent that survives a crossfade would be invisible to
     * every headless run of the suite, including the reduced-motion one.
     *
     * The right-hand monitor is the choice that makes the assertion mean
     * something: `createInitialContext` opens on `route: 'command'` with
     * `investigateTab: 'siem'`, so Investigate-on-Identity is not the default in
     * either field, and a round trip that silently reset the context would show
     * up here rather than pass by coincidence.
     */
    await openOffice2D(page);
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    const identity = monitorControl(page, 'investigate:identity');
    await expect(identity).toHaveCount(1);
    await identity.click();

    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible(SCENE);
    await expect(currentRoute(page)).toContainText('Investigate');
    await expect(page.locator('#investigate-tab-identity')).toHaveAttribute('aria-selected', 'true');
    // Stated as "not the default" rather than only "the chosen one".
    await expect(page.locator('#investigate-tab-siem')).toHaveAttribute('aria-selected', 'false');

    /*
     * Something to lose, so the round trip is a claim about a case in progress
     * rather than about an empty context — and answered from the guide band,
     * which is on every destination, rather than by walking to Command. Using
     * the side navigation here would replace the very intent under test with a
     * fresh one and turn the assertions below into a tautology.
     */
    await page
      .locator(`#decision-option-${PERFECT_RUN[0]!.input.optionId as string}`)
      .click();
    await expect(page.locator('#state-version')).toContainText('v1');
    await expect(currentRoute(page)).toContainText('Investigate');

    await page.locator('#return-to-office').click();
    await page.locator('#office-resume-cta').click(SCENE);
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible(SCENE);

    /*
     * The route intent, both halves of it, after the crossfade in each
     * direction. Note that the player never touched the side navigation: what
     * is being read back is the intent the *monitor* recorded.
     */
    await expect(currentRoute(page)).toContainText('Investigate');
    await expect(page.locator('#investigate-tab-identity')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#investigate-tab-siem')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#state-version')).toContainText('v1');

    // And the run that was interrupted by the round trip finishes.
    for (const step of PERFECT_RUN.slice(1)) {
      await playStepWithPointer(page, step);
    }
    await expectContainedDebrief(page);
  });

  test('a narration preference changed during play survives the round trip, and the case still completes', async ({
    page,
  }) => {
    test.slow();

    /*
     * `office.spec.ts:363` already toggles narration in the room and reads it
     * back after the round trip, so the preservation itself is not the new
     * claim. Three things about it are: that test runs only on the headed
     * `desktop-3d` project, so no headless or reduced-motion run checks the
     * preference at all; it stops at the round trip and never reaches an
     * ending; and it re-reads the toggle in the office, while the leg checked
     * here is the *console's* copy of it — the one a dashboard that rebuilt its
     * own settings state would drop.
     *
     * Every test in `narration.spec.ts` seeds `cycase.speech_muted` with
     * `addInitScript` before boot, so the engine reads the preference once, at
     * construction, and a round trip that dropped a *live* change would still
     * find the seeded value in storage and pass. Here the player sets it the
     * way a player does: by pressing the one primary toggle §7 asks for, in the
     * middle of a case, and then leaving and re-entering the room.
     *
     * Only the toggle is touched, never the voice list. `speechSynthesis`
     * reports no voices in headless Chromium, so `VoiceSettings` renders its
     * "no voices" note instead of the advanced disclosure — the toggle is the
     * control that is always there, and the preference it writes is the one
     * that has to survive.
     *
     * The office shows that toggle inline; the console keeps it inside the top
     * bar's Settings disclosure. Both legs press the same control and make the
     * same assertion — see `openConsoleSettings`.
     */
    await openOffice2D(page);

    const toggle = officeNarrationToggle(page);
    await expect(toggle).toHaveText('Narration on');
    await toggle.click();
    await expect(toggle).toHaveText('Narration off');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await monitorControl(page, 'command').click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible(SCENE);

    // The console carries the same control, so the first thing the crossfade
    // could lose is checked before the round trip even starts.
    await openConsoleSettings(page);
    await expect(consoleNarrationToggle(page)).toHaveText('Narration off');

    await page.locator('#return-to-office').click();
    await expect(officeNarrationToggle(page)).toHaveText('Narration off', SCENE);

    await page.locator('#office-resume-cta').click(SCENE);
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible(SCENE);
    await openConsoleSettings(page);
    await expect(consoleNarrationToggle(page)).toHaveText('Narration off');
    await expect(consoleNarrationToggle(page)).toHaveAttribute('aria-pressed', 'false');

    /*
     * Closed before the run resumes, the way a player closes it: pressing
     * Escape. Leaving a dialog open over the workspace would be a state no
     * player carries into the case, and the run below is the same seventeen
     * steps every other path in this file plays.
     */
    await page.keyboard.press('Escape');
    await expect(consoleNarrationToggle(page)).toHaveCount(0);

    await playCaseWithPointer(page);
    await expectContainedDebrief(page);
  });

  test('the flat monitor wall completes the case with no WebGL canvas on the page', async ({
    page,
  }) => {
    test.slow();

    /*
     * `office.spec.ts`'s 3D-off test stops at D1 — it proves the wall renders
     * and that one decision is answerable, which is where the audit's "renders
     * but is not proven to complete" finding came from. This plays the whole
     * case on that path.
     *
     * `canvas` count 0 is the assertion that makes it non-vacuous: the flat
     * wall is also the Suspense fallback while the room's chunk loads, so
     * `.monitors` being visible would be true on the WebGL path too for as long
     * as the import takes. No canvas means the preference was honoured and the
     * room was never mounted.
     */
    await openOffice2D(page);
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('.monitors')).toBeVisible();

    // Acknowledged on the centre monitor, which is where the alarm lives.
    await page.locator('.monitors').getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await expect(page.locator('.monitors [data-monitor-opens]')).toHaveCount(3);

    // Into the console through a monitor rather than through the chrome's skip,
    // so the surface under test is the one that carried the player in.
    await monitorControl(page, 'investigate:siem').click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible(SCENE);
    /*
     * The tab strip existing at all is the load-bearing half: it is rendered
     * only by InvestigatePanel's full mode, so finding it proves the monitor
     * moved the route off its default of `command`. The tab being `siem` is
     * NOT evidence — `siem` is also the default investigateTab — which is why
     * the non-default route and tab are carried by the route-intent test above
     * rather than here.
     */
    await expect(page.locator('#investigate-tab-siem')).toBeVisible();

    await playCaseWithPointer(page);
    await expectContainedDebrief(page);
  });

  test('the case completes with the keyboard alone, from the opening screen to the debrief', async ({
    page,
  }) => {
    test.slow();

    /*
     * No `.click()` anywhere in this test — Tab to move, Enter and Space to act,
     * including the confirmation of every consequential operation. That is the
     * distinction the acceptance gate turns on: `accessibility.spec.ts` proves
     * one decision and one dialog are keyboard-operable, which is a statement
     * about two controls, not about a case a keyboard player can finish.
     *
     * The route is the guided one — `NextStepCard` is the first thing in the
     * workspace on every destination, so the whole case is playable without
     * ever reaching for the side navigation, and that is what a keyboard player
     * would actually do. `tests/unit/live.test.ts` establishes that following
     * `nextRequiredStep` with the correct option each time is worth the full
     * 100, so the ending asserted below is the same ending the pointer path
     * reaches, not a lesser one excused by the input device.
     */
    const perfectOptions = new Set(
      PERFECT_RUN.filter((step) => step.tool === 'submit_decision').map(
        (step) => step.input.optionId as string,
      ),
    );

    await page.addInitScript(() => window.localStorage.setItem('cycase.office3d', 'false'));
    await page.goto('/');

    // Boot, office and monitor, all by keyboard.
    await tabToText(page, 'Skip intro');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();

    await tabToText(page, 'Acknowledge alarm');
    await page.keyboard.press('Enter');

    // Space, not Enter: a native button gets both, which is the whole reason
    // the monitor's activation is a real `<button>` rather than a handler on
    // the surface.
    await tabTo(page, '.monitors [data-monitor-opens="investigate:identity"]');
    await page.keyboard.press('Space');
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible(SCENE);

    const chosen: string[] = [];

    for (let move = 0; move < 40; move += 1) {
      // Checked first: closing the case replaces the console with the debrief,
      // and the guide goes with it.
      if (await page.locator('#debrief-outcome').count()) break;

      const optionIds = await page
        .locator('[id^="decision-option-"]')
        .evaluateAll((nodes) => nodes.map((node) => node.id));

      if (optionIds.length > 0) {
        const target = optionIds.find((id) =>
          perfectOptions.has(id.replace('decision-option-', '')),
        );
        expect(
          target,
          `no canonical option among ${optionIds.join(', ')}`,
        ).toBeTruthy();
        await tabTo(page, `#${target!}`);
        await page.keyboard.press('Space');
        chosen.push(target!.replace('decision-option-', ''));
        continue;
      }

      await tabTo(page, '#next-step-cta');
      await page.keyboard.press('Enter');

      /*
       * The dialog traps focus, so it has to be dealt with before the next
       * `tabTo` — and dealing with it is the point rather than an obstacle: a
       * consequential action confirmed from the keyboard is what the gate
       * names. Focus is moved onto Confirm when the dialog opens, so Enter is
       * the whole interaction.
       */
      const dialog = page.getByRole('alertdialog');
      if (await dialog.count()) {
        const confirm = dialog.getByRole('button', { name: 'Confirm' });
        await expect(confirm).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(dialog).toBeHidden();
      }
    }

    // Every decision was answered, and answered correctly.
    expect(chosen.sort()).toEqual([...perfectOptions].sort());
    await expectContainedDebrief(page);
  });
});
