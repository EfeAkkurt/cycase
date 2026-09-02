import { expect, test, type Page } from '@playwright/test';

import { openDashboard } from './helpers';

/**
 * Phase 3D — the SOC tools, measured as structure rather than as pixels.
 *
 * The file name matters: everything in `playwright.config.ts`'s `desktop-3d`
 * regex runs headed on a real GPU, and this suite has to run in the headless
 * project. So every claim below is expressed as geometry or as DOM the browser
 * can answer for without a GPU — `boundingBox()`, `open`, scroll offsets, and
 * counts — rather than as a screenshot comparison.
 *
 * The one criterion that genuinely cannot be settled here is the 520x306
 * compact surface, because that surface only exists projected onto a WebGL
 * monitor. What is asserted for it is structural: the compact variants render,
 * they stay inside the box, and they do not print the strip's long facts. The
 * visual read stays a GPU job and is called out as one.
 */

const TOOLS = ['siem', 'identity', 'endpoint', 'network', 'email'] as const;

/**
 * The sidebar rows are buttons with accessible names rather than ids — the same
 * way `shell.spec.ts` reaches them, so both files break together if the nav
 * changes shape.
 */
async function goTo(page: Page, destination: string) {
  await page
    .getByRole('navigation')
    .getByRole('button', { name: new RegExp(`^${destination}`) })
    .click();
}

async function openInvestigate(page: Page, tab: (typeof TOOLS)[number] = 'siem') {
  await openDashboard(page);
  await goTo(page, 'Investigate');
  await expect(page.locator('#investigate-panel')).toBeVisible();
  if (tab !== 'siem') await page.locator(`#investigate-tab-${tab}`).click();
  await expect(page.locator(`#tool-context-${tab}`)).toBeVisible();
}

/* ------------------------------------------------------------------ *
 * Task 7 / acceptance: "the user can say what they are looking at, and why"
 * ------------------------------------------------------------------ */

test.describe('every tool says what it is showing', () => {
  for (const tab of TOOLS) {
    test(`${tab} names its source, its range and its state`, async ({ page }) => {
      await openInvestigate(page, tab);

      const strip = page.locator(`#tool-context-${tab}`);
      await expect(strip).toBeVisible();

      /*
       * The source is the fact this phase added and the one that was missing
       * everywhere: an analyst reading the Identity table had no way to say
       * which system produced the rows. It must be a real system name, not the
       * tool's own label — "Identity" describing the Identity tool answers
       * nothing.
       */
      const source = strip.locator('.tool-context__fact', { hasText: 'Source' });
      await expect(source).toBeVisible();
      const sourceValue = (await source.locator('dd').textContent())?.trim() ?? '';
      expect(sourceValue.length, `${tab} named no source system`).toBeGreaterThan(3);

      /*
       * The range is stated, not merely selected on a control somewhere else.
       *
       * Matched on the label rather than on the fact's text: the Query fact's
       * empty-state copy is "no filter — every row in range", which a substring
       * match on "Range" also finds.
       */
      await expect(strip.getByRole('term').filter({ hasText: /^Range$/ })).toBeVisible();

      // And the feed state is named in words, never by colour alone.
      const state = page.locator(`#tool-state-${tab}`);
      await expect(state).toBeVisible();
      const stateText = (await state.textContent())?.trim() ?? '';
      expect(stateText.length, `${tab} showed no feed state`).toBeGreaterThan(0);
    });
  }

  test('the SIEM strip reports the query, and names it when it is a saved one', async ({
    page,
  }) => {
    await openInvestigate(page, 'siem');
    const strip = page.locator('#tool-context-siem');

    // With no filter it says so in words rather than showing an empty value.
    await expect(
      strip.locator('.tool-context__fact').filter({ has: page.getByRole('term').filter({ hasText: /^Query$/ }) }),
    ).toContainText(/no filter/i);

    /*
     * Running a saved query names it — the fact that lets someone describe what
     * they ran without reading the syntax back.
     *
     * Deliberately not the *first* saved query: `SAVED_QUERIES` opens with
     * "All events", whose text is the empty string, and `savedQueryFor` does not
     * report that one. See the note on it — claiming a saved query for a reader
     * who has not filtered anything would read as a choice they did not make.
     */
    const savedButtons = page
      .locator('#investigate-tool .stack--tight')
      .filter({ hasText: 'Saved' })
      .getByRole('button');
    await savedButtons.nth(1).click();
    await expect(
      strip.getByRole('term').filter({ hasText: /^Saved query$/ }),
      'a named query was run and the strip did not name it',
    ).toBeVisible();
    await expect(
      strip.locator('.tool-context__fact').filter({
        has: page.getByRole('term').filter({ hasText: /^Query$/ }),
      }),
    ).not.toContainText(/no filter/i);
  });

  test('a pivot is carried into the tool it lands in', async ({ page }) => {
    await openInvestigate(page, 'siem');

    // Follow the first thing the SIEM offers to follow.
    const followButton = page.locator('#investigate-tool button[title^="Follow"]').first();
    if ((await followButton.count()) === 0) test.skip(true, 'no followable row in this state');
    const followed = (await followButton.getAttribute('title')) ?? '';
    await followButton.click();

    /*
     * A pivot may land the reader in a different tool — that is what a pivot is
     * for — so this reads the strip of whichever tool ended up active rather
     * than assuming it is still the SIEM.
     */
    const strip = page.locator('.tool-context');
    const following = strip.locator('.tool-context__fact').filter({
      has: page.getByRole('term').filter({ hasText: /^Following$/ }),
    });
    await expect(
      following,
      'the tool does not say what it is following, so a pivot loses its own reason',
    ).toBeVisible();

    /*
     * The value in the strip is the value that was followed. Read from the
     * `.mono` span rather than the whole `dd`, which also carries the kind
     * label ("IP address") beside it.
     */
    const value = (await following.locator('dd .mono').textContent())?.trim() ?? '';
    expect(value.length, 'the strip named no value').toBeGreaterThan(0);
    expect(followed).toContain(value);
  });
});

/* ------------------------------------------------------------------ *
 * Task 3 / acceptance: the evidence inspector is usable above the fold
 * ------------------------------------------------------------------ */

test.describe('the evidence workbench', () => {
  async function openEvidence(page: Page) {
    await openDashboard(page);
    await goTo(page, 'Evidence');
    await expect(page.locator('#evidence-list')).toBeVisible();
  }

  test('list and inspector are one workbench, the same height', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEvidence(page);

    const list = (await page.locator('#evidence-list').boundingBox())!;
    const inspector = (await page.locator('#evidence-inspector').boundingBox())!;

    /*
     * `align-items: start` was why these were different heights — the list ran
     * to its content and the inspector ran to its own, so the two columns of a
     * master-detail view never agreed on where the bottom was.
     */
    expect(
      Math.abs(list.height - inspector.height),
      `list ${list.height.toFixed(0)}px vs inspector ${inspector.height.toFixed(0)}px`,
    ).toBeLessThanOrEqual(2);

    // Side by side, not stacked, at the review size.
    expect(inspector.x).toBeGreaterThan(list.x + list.width - 4);
  });

  test('the inspector is usable without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEvidence(page);
    await page.locator('#evidence-art_email_001').click();

    const viewport = page.viewportSize()!;
    const inspector = (await page.locator('#evidence-inspector').boundingBox())!;

    /*
     * "Usable above the fold" is not "the panel begins on screen" — a panel
     * whose heading is visible and whose controls are 900px down is not usable.
     * The workbench stretches to the room the guided card leaves it and scrolls
     * inside itself, so the whole inspector fits and everything in it is
     * reachable without scrolling the page.
     */
    expect(inspector.y, 'the inspector starts below the fold').toBeLessThan(viewport.height * 0.6);
    expect(
      inspector.y + inspector.height,
      `the inspector runs ${(inspector.y + inspector.height - viewport.height).toFixed(0)}px past ` +
        'the bottom of the screen, so its lower half needs a page scroll to reach',
    ).toBeLessThanOrEqual(viewport.height);

    // The record's own name and its Raw/Explained control are both in view.
    for (const selector of ['#evidence-record-title', '#evidence-inspector [role="tablist"]']) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, `${selector} is not rendered`).not.toBeNull();
      expect(box!.y + box!.height, `${selector} is below the fold`).toBeLessThan(viewport.height);
    }
  });

  test('selecting a record does not move the page or the row under the pointer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEvidence(page);

    const workspace = page.locator('main.workspace');
    const scrollBefore = await workspace.evaluate((el) => el.scrollTop);

    const second = page.locator('.evidence__item:not(:disabled)').nth(1);
    const before = (await second.boundingBox())!;
    await second.click();
    await expect(second).toHaveAttribute('aria-current', 'true');
    await page.waitForTimeout(400);
    const after = (await second.boundingBox())!;

    /*
     * The reported defect: clicking a row scrolled the workspace to bring the
     * inspector heading into view, which moved the list out from under the
     * pointer. `scrollIntoView` is gone and focus is taken with
     * `preventScroll`, so both of these must hold.
     */
    expect(
      Math.abs(after.y - before.y),
      `the selected row moved ${Math.abs(after.y - before.y).toFixed(1)}px when it was selected`,
    ).toBeLessThanOrEqual(1);
    expect(
      await workspace.evaluate((el) => el.scrollTop),
      'selecting a record scrolled the page',
    ).toBe(scrollBefore);
  });

  test('each column scrolls inside itself rather than growing the page', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEvidence(page);
    await page.locator('#evidence-art_email_001').click();

    for (const id of ['#evidence-list', '#evidence-inspector']) {
      const scrollable = await page
        .locator(`${id} > .panel__body`)
        .evaluate((el) => getComputedStyle(el).overflowY);
      expect(scrollable, `${id} body does not scroll on its own`).toMatch(/auto|scroll/);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Tasks 5 and 6 / acceptance: "Respond is not a card stack"
 * ------------------------------------------------------------------ */

test.describe('the respond playbook', () => {
  async function openRespond(page: Page) {
    await openDashboard(page);
    await goTo(page, 'Respond');
    await expect(page.locator('#playbook-actions')).toBeVisible();
  }

  test('exactly one operation and one query are open by default', async ({ page }) => {
    await openRespond(page);

    /*
     * The route used to render eleven full-weight cards at once. The rule now
     * is one open step per panel: the next thing to do. Everything else is a
     * row inside a disclosure, and a disclosure that is closed is `open=false`
     * in the DOM — which is exactly what makes this measurable rather than a
     * matter of taste.
     */
    await expect(page.locator('.respond-step--next')).toHaveCount(2);

    for (const id of ['#playbook-diagnostics-rest', '#playbook-actions-rest']) {
      const group = page.locator(id);
      if ((await group.count()) === 0) continue;
      expect(
        await group.evaluate((el) => (el as HTMLDetailsElement).open),
        `${id} is expanded on arrival — the stack is back`,
      ).toBe(false);
    }
  });

  test('the big tables open on request, not all at once', async ({ page }) => {
    await openRespond(page);

    /*
     * Task 6: prerequisites and the effect diff are the two heavy blocks, and
     * six actions rendering both of them expanded is four tables and six lists
     * on one screen. At most the *next* step may pre-open one, so the count of
     * open disclosures anywhere on the route stays small.
     */
    const open = await page
      .locator('details.disclosure[open]')
      .count();
    expect(open, `${open} disclosures are open on arrival`).toBeLessThanOrEqual(2);

    // And they really do open when asked.
    const first = page.locator('details.disclosure').first();
    await first.locator('summary').click();
    expect(await first.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true);
  });

  test('a collapsed operation still carries its control', async ({ page }) => {
    await openRespond(page);
    const rest = page.locator('#playbook-actions-rest');
    await rest.locator('summary').first().click();

    /*
     * Collapsing must not mean disabling. A reader who opens the group has to
     * be able to act from there — otherwise the disclosure has moved the work
     * rather than reduced it.
     */
    const steps = rest.locator('.respond-step');
    expect(await steps.count()).toBeGreaterThan(0);
    await expect(steps.first().locator('button')).toHaveCount(1);
  });
});

/* ------------------------------------------------------------------ *
 * Tasks 1 and 2 — Command's first viewport
 * ------------------------------------------------------------------ */

test.describe('command triage order', () => {
  test('the first viewport answers the triage questions in order', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDashboard(page);
    await goTo(page, 'Command');

    const order = ['#case-queue', '#overview-summary', '#respond-blast-radius', '#command-last-event'];
    const tops: number[] = [];
    for (const selector of order) {
      const box = await page.locator(selector).boundingBox();
      expect(box, `${selector} is not on the Command destination`).not.toBeNull();
      tops.push(box!.y);
    }

    for (let i = 1; i < tops.length; i += 1) {
      expect(
        tops[i]!,
        `${order[i]} is above ${order[i - 1]} — the triage order is wrong`,
      ).toBeGreaterThanOrEqual(tops[i - 1]!);
    }

    /*
     * And the reference material is *below* the triage. Source health and the
     * telemetry curves are things an analyst consults, not things they read
     * first, and they used to sit between the incident and the containment
     * state.
     */
    const containment = (await page.locator('#overview-checklist').boundingBox())!;
    const sources = (await page.locator('#command-source-health').boundingBox())!;
    expect(
      containment.y,
      'source health is still above the containment state',
    ).toBeLessThan(sources.y);
  });

  test('the single-case queue is a line, not a table', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openDashboard(page);
    await goTo(page, 'Command');

    const queue = (await page.locator('#case-queue').boundingBox())!;
    /*
     * A six-column table with one row in it spent about 180px of the first
     * viewport saying "there is one case and you are on it". Every fact it
     * carried is still here; the shape is not.
     */
    expect(queue.height, `the queue is still ${queue.height.toFixed(0)}px tall`).toBeLessThan(140);
    await expect(page.locator('#case-queue table')).toHaveCount(0);

    // The facts survive the reshape, including the current-case announcement.
    await expect(page.locator('#case-queue')).toContainText(/CASE-|INC-/);
    await expect(page.locator('[id^="queue-CASE"]')).toHaveAttribute('aria-current', 'true');
  });
});

/* ------------------------------------------------------------------ *
 * Task 12 — no layout shift, no scroll loss
 * ------------------------------------------------------------------ */

test.describe('nothing moves that the reader did not move', () => {
  test('switching tools keeps the console still', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openInvestigate(page, 'siem');

    const panel = page.locator('#investigate-panel');
    const before = (await panel.boundingBox())!;

    for (const tab of ['identity', 'endpoint', 'network', 'email'] as const) {
      await page.locator(`#investigate-tab-${tab}`).click();
      await expect(page.locator(`#tool-context-${tab}`)).toBeVisible();
      const after = (await panel.boundingBox())!;
      expect(
        Math.abs(after.y - before.y),
        `the panel moved ${Math.abs(after.y - before.y).toFixed(1)}px when ${tab} opened`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test('a live tick does not scroll the page or move the strip', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openInvestigate(page, 'siem');

    const workspace = page.locator('main.workspace');
    await workspace.evaluate((el) => {
      el.scrollTop = 120;
    });
    const strip = page.locator('#tool-context-siem');
    const before = (await strip.boundingBox())!;

    /*
     * Long enough to cross several incident-clock ticks and at least one 30
     * second sample bucket — which is the beat the tables are allowed to move
     * on. What must not happen is the *page* moving underneath a reader.
     */
    await page.waitForTimeout(4000);

    expect(await workspace.evaluate((el) => el.scrollTop), 'a tick scrolled the page').toBe(120);
    const after = (await strip.boundingBox())!;
    expect(Math.abs(after.y - before.y), 'the context strip moved on a tick').toBeLessThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ *
 * Tasks 8 and 10 — pause is a state, and it is said out loud
 * ------------------------------------------------------------------ */

test.describe('feed state follows the simulation clock', () => {
  test('pausing the incident clock is reported by every tool', async ({ page }) => {
    await openInvestigate(page, 'siem');

    const chip = page.locator('#tool-state-siem');
    await expect(chip).not.toContainText(/paused/i);

    await page.getByRole('button', { name: /^Pause simulation/ }).click();
    await expect(
      chip,
      'the tool kept claiming to be live while the incident clock was stopped',
    ).toContainText(/paused/i);

    // And the sentence says what that means rather than only naming the state.
    await expect(chip).toContainText(/clock is stopped/i);

    await page.getByRole('button', { name: /^Resume simulation/ }).click();
    await expect(chip).not.toContainText(/paused/i);
  });

  test('the live dot does not pulse while the stream is frozen', async ({ page }) => {
    await openInvestigate(page, 'siem');
    await page.getByRole('button', { name: /^Pause simulation/ }).click();
    await expect(page.locator('#tool-state-siem')).toContainText(/paused/i);

    /*
     * A pulsing dot beside the word "Paused" is the single most confusing thing
     * a status line can do — it says the opposite of the label next to it.
     */
    const pulsing = await page
      .locator('#tool-state-siem .dot.pulse')
      .count();
    expect(pulsing, 'the status dot is still pulsing on a paused stream').toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Task 11 — the compact variants, structurally
 * ------------------------------------------------------------------ */

test('the compact tool surface stays inside a 520x306 monitor', async ({ page }) => {
  /*
   * The real surface is projected onto a WebGL monitor, which is a GPU job and
   * lives in `desktop-3d`. What can be settled here is the part that is
   * geometry rather than rendering: given exactly the box the office gives it,
   * the compact tool does not overflow it and does not print the long facts the
   * full strip carries.
   */
  await openDashboard(page);
  await goTo(page, 'Investigate');
  await expect(page.locator('#investigate-panel')).toBeVisible();

  /*
   * Mounting a second React tree into a 520x306 box is not something this suite
   * can do honestly, so it does not pretend to. What it checks is the part that
   * is real: the compact rules are loaded and they hide the facts that do not
   * survive monitor distance. A missing stylesheet is the realistic regression
   * here, and it is the one this catches.
   */
  const hidesLongFacts = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.className = 'panel panel--compact';
    probe.innerHTML =
      '<div class="tool-context"><dl class="tool-context__facts">' +
      '<div class="tool-context__fact"><dt>a</dt><dd>1</dd></div>' +
      '<div class="tool-context__fact"><dt>b</dt><dd>2</dd></div>' +
      '<div class="tool-context__fact" id="third"><dt>c</dt><dd>3</dd></div>' +
      '</dl><span class="tool-state"><span class="tool-state__detail">x</span></span></div>';
    document.body.appendChild(probe);
    const third = probe.querySelector('#third')!;
    const detail = probe.querySelector('.tool-state__detail')!;
    const result = {
      third: getComputedStyle(third).display,
      detail: getComputedStyle(detail).display,
    };
    probe.remove();
    return result;
  });

  expect(
    hidesLongFacts.third,
    'the compact strip still prints every fact — soc-tools.css did not load',
  ).toBe('none');
  expect(hidesLongFacts.detail, 'the compact state chip still prints its sentence').toBe('none');
});
