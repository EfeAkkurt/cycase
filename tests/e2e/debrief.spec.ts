import { expect, test, type Page } from '@playwright/test';

import {
  PERFECT_RUN,
  continueToDebrief,
  installModelContext,
  openDashboard,
  runSequence,
} from './helpers';

/**
 * The debrief as a teaching pass rather than a score table.
 *
 * The score material is still here and still has every id the rest of the suite
 * reads. What these specs pin is what sits above it: the strongest move, the
 * one to work on, the lesson, the two clocks with the reason they differ, and
 * the chain in the order the run answered it — plus the two blocks below the
 * score, the replay goal and the optional question.
 *
 * The primary run is deliberately *not* `PERFECT_RUN`. A clean 100/100 has no
 * first wrong answer, so `pivotIndex` is -1, `improveObservation` falls through
 * to "nothing was missed" with no anchor, and a spec written against it would
 * assert that blocks render while never once exercising the case they exist
 * for. `ONE_WRONG_CALL` gets exactly one decision wrong, which makes the pivot,
 * the improve anchor and the retrieval question all resolve off the same known
 * decision.
 */

/**
 * D3 answered with the password-only option; everything else correct.
 *
 * D3 is the useful one to get wrong: the run still reaches containment, so the
 * screen under test is a real closed case rather than the collapse a
 * wrong-everything run produces, and the turn is unambiguous.
 */
const ONE_WRONG_CALL = [
  { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
  { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
  { tool: 'submit_decision', input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' } },
  { tool: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
  { tool: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_password_only' } },
  { tool: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate' } },
  { tool: 'inspect_artifact', input: { artifactId: 'art_edr_001' } },
  { tool: 'take_response_action', input: { actionId: 'isolate_endpoint' } },
  { tool: 'submit_decision', input: { decisionId: 'D5', optionId: 'D5_sweep_indicators' } },
  { tool: 'run_diagnostic', input: { diagnosticId: 'indicator_scope' } },
  { tool: 'take_response_action', input: { actionId: 'block_indicator' } },
  { tool: 'submit_decision', input: { decisionId: 'D6', optionId: 'D6_verify_checklist' } },
  { tool: 'take_response_action', input: { actionId: 'close_case' } },
];

/** Plays a sequence to a closed case and lands on the debrief. */
async function playToDebrief(
  page: Page,
  steps: { tool: string; input: Record<string, unknown> }[],
): Promise<void> {
  await openDashboard(page);
  const results = await runSequence(page, steps);
  for (const [index, result] of results.entries()) {
    expect(result.ok, `step ${index} (${steps[index]!.tool}) should succeed`).toBe(true);
  }

  /*
   * Closing the case no longer lands on the debrief: VERA confirms the case is
   * off the board and the player opens the debrief themselves. Pressed through
   * the shared helper rather than by locator here, because two specs describing
   * one control is exactly how the suite drifts away from the product.
   */
  await continueToDebrief(page);
}

test.beforeEach(async ({ page }) => {
  await installModelContext(page);
});

test.describe('the debrief teaches before it scores', () => {
  test('opens on the teaching pass, with the score kept below it', async ({ page }) => {
    await playToDebrief(page, ONE_WRONG_CALL);

    // The ordering claim, stated as document order rather than as pixels: the
    // first panel on the screen is the strongest move, not the outcome.
    await expect(page.locator('#main > section').first()).toHaveAttribute(
      'id',
      'debrief-strongest',
    );

    for (const id of [
      '#debrief-strongest',
      '#debrief-improve',
      '#debrief-lesson',
      '#debrief-time',
      '#debrief-chain',
    ]) {
      await expect(page.locator(id), `${id} should render`).toBeVisible();
      // A block that renders its heading and nothing else is the failure mode
      // this whole screen is meant to stop, so each one is asserted to carry
      // prose of its own.
      await expect(page.locator(`${id} .panel__body`)).not.toBeEmpty();
    }

    // And every id the rest of the suite reads is still here.
    for (const id of [
      '#debrief-outcome',
      '#debrief-missed',
      '#debrief-breakdown',
      '#debrief-decisions',
      '#debrief-entries',
    ]) {
      await expect(page.locator(id), `${id} should survive the reorder`).toBeVisible();
    }
  });

  test('names the strongest move and points at where it came from', async ({ page }) => {
    await playToDebrief(page, ONE_WRONG_CALL);

    const strongest = page.locator('#debrief-strongest');
    await expect(strongest.getByRole('heading')).toHaveText('Your strongest decision');
    await expect(strongest.locator('[data-testid="debrief-anchor"]')).toBeVisible();
  });

  test('phrases the improvement as a next action, anchored to the call that turned', async ({
    page,
  }) => {
    await playToDebrief(page, ONE_WRONG_CALL);

    const improve = page.locator('#debrief-improve');
    await expect(improve.getByRole('heading')).toHaveText('The one to work on');

    /*
     * The anchor is the assertion that matters. Without it the panel says only
     * that something went wrong, which is a verdict; with it, it names the call
     * to make instead and the decision to make it on.
     */
    const anchor = improve.locator('[data-testid="debrief-anchor"]');
    await expect(anchor).toHaveAttribute('data-anchor-kind', 'decision');
    await expect(anchor).toContainText('D3');
    await expect(anchor).toContainText('Revoke every active session, then reset credentials');
  });

  test('explains the gap between the two clocks instead of printing two numbers', async ({
    page,
  }) => {
    await playToDebrief(page, ONE_WRONG_CALL);

    const time = page.locator('#debrief-time');
    await expect(time).toContainText('Time at the desk');
    await expect(time).toContainText('Time in the incident');
    await expect(time.locator('[data-testid="debrief-time-real"]')).not.toBeEmpty();
    await expect(time.locator('[data-testid="debrief-time-sim"]')).not.toBeEmpty();

    // The explanation, which is the reason this is one block and not two stats.
    await expect(time).toContainText('incident time runs faster than time at the desk');
    await expect(time).toContainText('Neither number is scored');
  });

  test('shows the decision chain in order and marks the one that turned', async ({ page }) => {
    await playToDebrief(page, ONE_WRONG_CALL);

    const links = page.locator('#debrief-chain li');
    await expect(links).toHaveCount(6);

    // Answered in fixture order on this run, so the chain reads D1..D6.
    for (const [index, id] of ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'].entries()) {
      await expect(links.nth(index)).toHaveAttribute('data-decision', id);
    }

    // Exactly one turn, on the call this run deliberately got wrong.
    const pivot = page.locator('#debrief-chain li[data-pivot="true"]');
    await expect(pivot).toHaveCount(1);
    await expect(pivot).toHaveAttribute('data-decision', 'D3');
  });

  test('names a concrete replay goal, interpolated', async ({ page }) => {
    await playToDebrief(page, ONE_WRONG_CALL);

    const replay = page.locator('#debrief-replay');
    // The interpolation trap: `debrief.replay_goal` carries a {goal}
    // placeholder, and a surface that renders the raw template ships braces.
    await expect(replay).not.toContainText('{goal}');
    await expect(replay).toContainText('The one thing to get right this time');
    await expect(replay).toContainText('Revoke every active session, then reset credentials');
    await expect(replay.getByRole('button', { name: 'Run the case again' })).toBeVisible();
  });
});

test.describe('the optional question', () => {
  test('keeps the model answer out of the document until it is asked for', async ({ page }) => {
    await playToDebrief(page, ONE_WRONG_CALL);

    const retrieval = page.locator('#debrief-retrieval');
    await expect(retrieval).toBeVisible();
    await expect(retrieval).toContainText('Optional, and not scored');

    // Absent, not merely invisible: a reader who has not chosen to see the
    // answer cannot find it in the page either.
    const answer = retrieval.locator('[data-testid="retrieval-answer"]');
    await expect(answer).toHaveCount(0);

    await retrieval.getByRole('button', { name: 'Show the answer' }).click();
    await expect(answer).toHaveCount(1);
    await expect(answer).not.toBeEmpty();
  });

  test('is not part of the score display, and revealing changes no score', async ({ page }) => {
    await playToDebrief(page, ONE_WRONG_CALL);

    // The claim is structural first: the question lives in its own panel,
    // outside every block the score is rendered in.
    await expect(page.locator('#debrief-outcome #debrief-retrieval')).toHaveCount(0);
    await expect(page.locator('#debrief-breakdown #debrief-retrieval')).toHaveCount(0);
    await expect(page.locator('#debrief-entries #debrief-retrieval')).toHaveCount(0);
    await expect(page.locator('#debrief-retrieval .stat')).toHaveCount(0);

    const scoreBefore = await page.locator('#debrief-outcome .stat__value').first().textContent();
    const entriesBefore = await page.locator('#debrief-entries tbody tr').count();

    await page.locator('#debrief-retrieval').getByRole('button', { name: 'Show the answer' }).click();
    await expect(page.locator('[data-testid="retrieval-answer"]')).toBeVisible();

    // Answering, ignoring and revealing are indistinguishable to the engine, so
    // the score log has to be byte-identical either side of the press.
    expect(await page.locator('#debrief-outcome .stat__value').first().textContent()).toBe(
      scoreBefore,
    );
    expect(await page.locator('#debrief-entries tbody tr').count()).toBe(entriesBefore);
  });
});

test.describe('a run with nothing to improve', () => {
  /*
   * The degradation case, kept because the honest empty state is a real
   * requirement and not a gap: a perfect run has no turn and no next action, and
   * the screen has to say so rather than invent a criticism or leave a heading
   * standing over nothing.
   */
  test('still renders every block, with no turn marked', async ({ page }) => {
    await playToDebrief(page, PERFECT_RUN);

    await expect(page.locator('#debrief-outcome')).toContainText('100/100');

    for (const id of [
      '#debrief-strongest',
      '#debrief-improve',
      '#debrief-lesson',
      '#debrief-time',
      '#debrief-chain',
      '#debrief-replay',
    ]) {
      await expect(page.locator(id), `${id} should render`).toBeVisible();
    }

    await expect(page.locator('#debrief-chain li')).toHaveCount(6);
    await expect(page.locator('#debrief-chain li[data-pivot="true"]')).toHaveCount(0);
    await expect(page.locator('#debrief-replay')).not.toContainText('{goal}');
  });
});
