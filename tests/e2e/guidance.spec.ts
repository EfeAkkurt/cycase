import { expect, test, type Locator, type Page } from '@playwright/test';

import { openDashboard } from './helpers';

/**
 * Audit contract P0.6 — "a novice cannot finish the case in the target session
 * time."
 *
 * The audit measured a user-like run reaching only D3 after 8:42, on a golden
 * path of roughly 26 clicks, with one clock that quietly absorbed per-command
 * costs and an "Available actions" list that mixed the required next action in
 * with optional evidence.
 *
 * These specs pin the four things the contract asked for, in the browser:
 * two honestly-related clocks, exactly one required-step card at every stage,
 * a golden path inside the 10–14 interaction band that still scores 100/100,
 * and optional evidence that is reachable without competing.
 */

const CARD = '[data-testid="next-required-step"]';

/**
 * Every click the player makes, counted.
 *
 * The contract asks for a bound on *interactions*, so this counts real
 * activations and nothing else — not navigation the guided path never needs,
 * and not assertions. A confirmation press inside a dialog counts too: it is a
 * separate thing the player has to do.
 */
class Interactions {
  count = 0;

  async click(target: Locator): Promise<void> {
    this.count += 1;
    await target.click();
  }
}

/** The card's own CTA, whatever the current step happens to be. */
function cta(page: Page): Locator {
  return page.locator('#next-step-cta');
}

/** The confirm press for a consequential operation. Counted like any other. */
async function confirm(page: Page, clicks: Interactions): Promise<void> {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await clicks.click(dialog.getByRole('button', { name: 'Confirm' }));
}

function option(page: Page, optionId: string): Locator {
  return page.locator(`#decision-option-${optionId}`);
}

/**
 * The golden path, driven only through the guided card — no side navigation,
 * no Respond route, no evidence list. This is the run a novice is meant to
 * have.
 */
async function playGuidedPath(page: Page): Promise<Interactions> {
  const clicks = new Interactions();

  // D1 — preserve the evidence before responding.
  await clicks.click(option(page, 'D1_preserve_and_inspect'));

  // Read the reported message.
  await expect(page.locator(CARD)).toContainText('Read the reported message');
  await clicks.click(cta(page));

  // D2 — test the sender rather than trusting the display name.
  await clicks.click(option(page, 'D2_compare_signin_telemetry'));

  // Rebuild the authentication timeline: the diagnostic and the token
  // telemetry it reveals, as one interaction covering two commands.
  await expect(page.locator(CARD)).toContainText('Rebuild the authentication timeline');
  await clicks.click(cta(page));

  // D3 — sessions before passwords.
  await clicks.click(option(page, 'D3_revoke_then_reset'));

  // D4 — collect the endpoint evidence before isolating.
  await clicks.click(option(page, 'D4_collect_then_isolate'));

  // The containment operation: five commands in one interaction, plus the
  // confirmation the fixture asks for on a consequential action.
  await expect(page.locator(CARD)).toContainText('Contain the identity and the endpoint');
  await clicks.click(cta(page));
  await confirm(page, clicks);

  // D5 — scope beyond the one named identity.
  await clicks.click(option(page, 'D5_sweep_indicators'));

  // Sweep and block.
  await expect(page.locator(CARD)).toContainText('Sweep the estate');
  await clicks.click(cta(page));

  // D6 — verify before closing.
  await clicks.click(option(page, 'D6_verify_checklist'));

  // Close.
  await expect(page.locator(CARD)).toContainText('Close the case');
  await clicks.click(cta(page));
  await confirm(page, clicks);

  return clicks;
}

test.describe('two clocks', () => {
  test('shows play time and incident time separately, each with its own label', async ({
    page,
  }) => {
    await openDashboard(page);

    await expect(page.getByText('Play time', { exact: true })).toBeVisible();
    await expect(page.getByText('Incident time', { exact: true })).toBeVisible();
    await expect(page.locator('#play-clock')).toBeVisible();
    await expect(page.locator('#incident-clock')).toBeVisible();

    // The multiplier is stated, not implied.
    await expect(page.locator('#incident-clock')).toContainText('3×');
    await expect(page.locator('#clock-explainer')).toContainText(
      'Incident time runs at 3× play time',
    );
  });

  test('advances the incident clock at exactly 3x the play clock while investigating', async ({
    page,
  }) => {
    await openDashboard(page);

    // Both values are read in one evaluation, so a tick cannot land between
    // the two samples and fake a ratio.
    const read = async () => {
      const raw = await page.evaluate(() => ({
        play: document.querySelector('#play-clock')?.textContent ?? '',
        incident: document.querySelector('#incident-clock')?.textContent ?? '',
      }));
      return { play: toSeconds(raw.play), incident: toSeconds(raw.incident) };
    };

    // Sample only across a stretch where nothing is issued, so the ratio is
    // the tick rate and nothing else. Per-command costs are deliberately
    // excluded — the contract forbids disguising them as real time.
    const first = await read();
    await expect.poll(async () => (await read()).play, { timeout: 15_000 }).toBeGreaterThan(
      first.play + 2,
    );
    const second = await read();

    const playDelta = second.play - first.play;
    const incidentDelta = second.incident - first.incident;

    expect(playDelta).toBeGreaterThan(0);
    expect(incidentDelta / playDelta).toBe(3);
  });
});

test.describe('one required step', () => {
  test('is present exactly once at every stage of the golden path', async ({ page }) => {
    await openDashboard(page);

    const stages: string[] = [];
    const record = async () => {
      await expect(page.locator(CARD)).toHaveCount(1);
      stages.push(await page.locator('#next-step-title').innerText());
    };

    await record();
    await option(page, 'D1_preserve_and_inspect').click();
    await record();
    await page.locator('#next-step-cta').click();
    await record();
    await option(page, 'D2_compare_signin_telemetry').click();
    await record();
    await page.locator('#next-step-cta').click();
    await record();
    await option(page, 'D3_revoke_then_reset').click();
    await record();
    await option(page, 'D4_collect_then_isolate').click();
    await record();
    await page.locator('#next-step-cta').click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click();
    await record();
    await option(page, 'D5_sweep_indicators').click();
    await record();
    await page.locator('#next-step-cta').click();
    await record();
    await option(page, 'D6_verify_checklist').click();
    await record();

    // Eleven distinct stages, each naming something different: the card never
    // repeats itself and never goes blank.
    expect(stages).toHaveLength(11);
    expect(new Set(stages).size).toBe(11);
    for (const stage of stages) expect(stage.length).toBeGreaterThan(0);
  });

  test('stays on every route, so the answer is never a page away', async ({ page }) => {
    await openDashboard(page);

    for (const route of ['Command', 'Investigate', 'Evidence', 'Respond', 'Timeline']) {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: new RegExp(`^${route}`) })
        .click();
      await expect(page.locator(CARD)).toHaveCount(1);
      await expect(page.locator(CARD)).toBeVisible();
    }
  });

  test('names the action that actually advances the case', async ({ page }) => {
    await openDashboard(page);

    // At the start the case is waiting on D1, and the card is asking D1 —
    // not offering five things one of which happens to be D1.
    await expect(page.locator(CARD)).toContainText('Decide how to handle the reported message');
    await expect(option(page, 'D1_preserve_and_inspect')).toBeVisible();

    await option(page, 'D1_preserve_and_inspect').click();

    // D2 is genuinely locked until the reported message has been read, and
    // that is exactly what the card now asks for.
    await expect(page.locator(CARD)).toContainText('Read the reported message');
    await expect(page.locator(CARD)).toContainText('Phishing message');
  });

  test('reports result, what changed and why it mattered after each step', async ({ page }) => {
    await openDashboard(page);
    await option(page, 'D1_preserve_and_inspect').click();

    const outcome = page.locator('#last-outcome');
    await expect(outcome).toBeVisible();
    await expect(outcome).toContainText('What just happened');
    await expect(outcome).toContainText('Result');
    await expect(outcome).toContainText('What changed');
    await expect(outcome).toContainText('Why it mattered');
    await expect(outcome).toContainText('Score +6');
    await expect(outcome).toContainText('Case state is now v1');

    // And the next-step CTA is right there, in the same card.
    await expect(page.locator(CARD)).toContainText('Read the reported message');
  });
});

test.describe('the golden path fits the session', () => {
  test('completes through the guided UI alone, inside the 10-14 interaction band', async ({
    page,
  }) => {
    await openDashboard(page);

    const clicks = await playGuidedPath(page);

    // The contract band. Logged so a reviewer can see the number rather than
    // take the assertion's word for it.
    console.log(`guided golden path completed in ${clicks.count} interactions`);
    expect(clicks.count).toBeGreaterThanOrEqual(10);
    expect(clicks.count).toBeLessThanOrEqual(14);

    // And it is still the same case, scored the same way.
    await expect(page.locator('#debrief-outcome')).toContainText('Contained');
    await expect(page.locator('#debrief-outcome')).toContainText('100/100');
    await expect(page.locator('#debrief-missed')).toContainText(
      'Nothing critical was left open',
    );
  });

  test('wastes no work: no refused call anywhere on the guided path', async ({ page }) => {
    await openDashboard(page);
    await playGuidedPath(page);

    // Every refused call costs efficiency, so a clean 15/15 is the same claim
    // stated in the score. The activity feed is the human-readable version of
    // it, and the debrief keeps rendering the rail's tool log.
    await expect(page.locator('#debrief-outcome')).toContainText('100/100');
    await expect(page.locator('.feed__row--error')).toHaveCount(0);
  });
});

test.describe('optional evidence', () => {
  test('is behind "Explore more" rather than competing with the required step', async ({
    page,
  }) => {
    await openDashboard(page);

    const details = page.locator('#explore-more');
    const summary = details.getByText('Explore more', { exact: true });
    await expect(summary).toBeVisible();

    // Available from the first frame, and never needed to contain the case.
    const optional = details.getByRole('button', {
      name: 'Open Mass file enumeration on SRV-FILES-02',
    });

    // Closed by default: present in the document, absent from the page.
    await expect(details).not.toHaveAttribute('open', /.*/);
    await expect(optional).toBeHidden();

    // Reachable in one press, and still not part of the required step.
    await summary.click();
    await expect(details).toHaveAttribute('open', /.*/);
    await expect(optional).toBeVisible();
    await expect(page.locator(CARD)).not.toContainText('Mass file enumeration');
  });

  test('never lists evidence the guided path collects for you', async ({ page }) => {
    await openDashboard(page);

    const details = page.locator('#explore-more');
    await details.getByText('Explore more', { exact: true }).click();

    await expect(details.getByRole('button', { name: /Phishing message/ })).toHaveCount(0);
    await expect(details.getByRole('button', { name: /Token telemetry/ })).toHaveCount(0);
    await expect(details.getByRole('button', { name: /Endpoint report/ })).toHaveCount(0);
  });
});

/** "04:12" → 252. */
function toSeconds(label: string): number {
  const match = /(\d{2}):(\d{2})/.exec(label);
  if (!match) throw new Error(`not a clock: ${label}`);
  return Number(match[1]) * 60 + Number(match[2]);
}
