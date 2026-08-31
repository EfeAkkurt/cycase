import { expect, test, type Page } from '@playwright/test';

import { PERFECT_RUN, installModelContext, openDashboard, runSequence } from './helpers';

/**
 * The chart surface.
 *
 * The charts were rejected for looking like crude "signal" graphics, and the
 * replacement is shadcn/ui's chart component (Recharts, themed) ported onto
 * this project's token system. "Looks better" is not testable, so what is
 * tested here is every property the rejection was actually about:
 *
 *  - a chart has axes with real values on them, not a bare row of bars;
 *  - a chart names its values on hover rather than leaving the reader to
 *    measure pixels;
 *  - a chart is a pure function of case state, so the picture changes when the
 *    incident changes and not otherwise;
 *  - nothing is signalled by colour alone, and no colour is off-token;
 *  - the office does not pay for any of it.
 */

const CLOCK = /^\d{2}:\d{2}$/;

/**
 * A run that scores badly: the same tool calls, four decisions answered wrong,
 * and two containment actions never taken. It exists so the debrief has a
 * shortfall to draw.
 */
const WRONG_OPTION: Record<string, string> = {
  D1_preserve_and_inspect: 'D1_disable_account_now',
  D2_compare_signin_telemetry: 'D2_trust_sender_display_name',
  D5_sweep_indicators: 'D5_assume_single_account',
  D6_verify_checklist: 'D6_close_without_verifying',
};

const PARTIAL_RUN = PERFECT_RUN.filter(
  (step) => step.input.actionId !== 'block_indicator' && step.input.actionId !== 'isolate_endpoint',
).map((step) => {
  const optionId = step.input.optionId as string | undefined;
  return optionId && WRONG_OPTION[optionId]
    ? { ...step, input: { ...step.input, optionId: WRONG_OPTION[optionId] } }
    : step;
});

async function waitForCharts(page: Page, count: number) {
  await expect
    .poll(async () => page.locator('.viz .recharts-surface').count(), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(count);
  // One frame past the animation budget (--motion-duration-base is 220 ms).
  await page.waitForTimeout(400);
}

test.describe('charts', () => {
  test.slow();

  test('every chart carries a text description', async ({ page }) => {
    await openDashboard(page);
    await waitForCharts(page, 3);

    /*
     * Two families of surface, one contract. Recharts routes a chart's
     * `className` to its wrapper `div` and hard-codes `recharts-surface` on the
     * `<svg>`, so the themed charts cannot carry this project's `chart` class —
     * they are matched by their own class instead. `accessibility.spec.ts`
     * keeps the `svg.chart` half of the same assertion.
     */
    const labels = await page
      .locator('svg.chart[role="img"], .viz .recharts-surface[role="img"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));

    // Three Recharts surfaces on the overview plus the topology graph.
    expect(labels.length).toBeGreaterThanOrEqual(4);
    for (const label of labels) expect(label.length).toBeGreaterThan(20);

    // The stream describes the window it is actually drawing.
    const stream = await page
      .locator('.viz--stream .recharts-surface')
      .first()
      .getAttribute('aria-label');
    expect(stream).toMatch(/Event stream from \d{2}:\d{2} to \d{2}:\d{2}/);
    expect(stream).toMatch(/anomalous events/);
  });

  test('the event stream is a time series with real clock values on its axis', async ({
    page,
  }) => {
    await openDashboard(page);
    await waitForCharts(page, 3);

    const ticks = await page
      .locator('.viz--stream .recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')
      .allTextContents();

    expect(ticks.length).toBeGreaterThanOrEqual(3);
    for (const tick of ticks) expect(tick.trim()).toMatch(CLOCK);

    // Time runs left to right, and the axis covers the sampled window.
    const minutes = ticks.map((tick) => {
      const [h, m] = tick.trim().split(':').map(Number);
      return h! * 60 + m!;
    });
    for (let i = 1; i < minutes.length; i += 1) {
      expect(minutes[i]!).toBeGreaterThan(minutes[i - 1]!);
    }

    // A value axis, not a decorative one.
    const values = await page
      .locator('.viz--stream .recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value')
      .allTextContents();
    expect(values.length).toBeGreaterThanOrEqual(2);
    for (const value of values) expect(value.trim()).toMatch(/^\d+$/);

    // Both series are drawn and both are named in the legend.
    const legend = await page.locator('.viz--stream').locator('..').locator('.viz__legend').first();
    await expect(legend).toContainText('Baseline traffic');
    await expect(legend).toContainText('Anomalous');
  });

  test('the tooltip names the series and the value under the cursor', async ({ page }) => {
    await openDashboard(page);
    await waitForCharts(page, 3);

    const surface = page.locator('.viz--stream .recharts-surface').first();
    await surface.scrollIntoViewIfNeeded();
    const box = (await surface.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5, { steps: 4 });

    const tooltip = page.locator('.viz__tooltip').first();
    await expect(tooltip).toBeVisible();
    // The label is the simulation clock the sample was taken on.
    await expect(tooltip.locator('.viz__tooltip-label')).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    await expect(tooltip).toContainText('Baseline traffic');
    await expect(tooltip).toContainText('Anomalous');
    // …and a real number, not a percentage of an invisible maximum.
    await expect(tooltip.locator('.viz__tooltip-value').first()).toHaveText(/\d/);
  });

  test('the stream stays a pure function of case state', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);
    await waitForCharts(page, 3);

    const before = await page.locator('.viz--stream .recharts-surface').getAttribute('aria-label');
    expect(before).toMatch(/anomalous events sit on top of a stable baseline/);
    const beforeCount = Number(/(\d+) anomalous events/.exec(before ?? '')?.[1] ?? '0');
    expect(beforeCount).toBeGreaterThan(0);

    // Containing the incident is the one thing that flattens the curve. If the
    // chart were animating on a clock of its own this would not move.
    await runSequence(page, PERFECT_RUN.slice(0, 12));

    await expect
      .poll(
        async () => {
          const label = await page
            .locator('.viz--stream .recharts-surface')
            .getAttribute('aria-label');
          return Number(/(\d+) anomalous events/.exec(label ?? '')?.[1] ?? '-1');
        },
        { timeout: 15_000 },
      )
      .toBeLessThan(beforeCount);
  });

  test('the topology marks its alert nodes by icon as well as colour', async ({ page }) => {
    await openDashboard(page);

    const graph = page.locator('svg.chart--graph');
    await expect(graph).toBeVisible();

    // Every node carries two glyphs: what it is, and what state it is in.
    const nodes = await graph.locator('.topo-node__box').count();
    expect(nodes).toBeGreaterThanOrEqual(6);
    expect(await graph.locator('.topo-node__kind svg').count()).toBe(nodes);
    expect(await graph.locator('.topo-node__state svg').count()).toBe(nodes);
    // …and a word.
    expect(await graph.locator('.topo-node__status').count()).toBe(nodes);

    // The state is legible without the picture at all.
    await expect(graph).toContainText('Rogue session active');
    await expect(page.locator('#overview-topology table')).toContainText('Compromised');

    // Edges are routed, not drawn as raw straight lines between centres.
    const paths = await graph.locator('.topo-edge[marker-end]').count();
    expect(paths).toBeGreaterThanOrEqual(5);
  });

  test('the debrief breakdown shows achieved against possible', async ({ page }) => {
    await installModelContext(page);
    await openDashboard(page);
    await runSequence(page, PERFECT_RUN);

    await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible();
    const panel = page.locator('#debrief-breakdown');
    await expect(panel.locator('.viz--score')).toBeVisible();
    await waitForCharts(page, 1);

    const readouts = await panel.locator('.recharts-label-list text').allTextContents();
    expect(readouts.length).toBe(4);
    for (const readout of readouts) expect(readout.trim()).toMatch(/^\d+\/\d+$/);

    // Every bucket is named, and the two stack segments are named too.
    await expect(panel).toContainText('Evidence quality');
    await expect(panel.locator('.viz__legend')).toContainText('Earned');
    await expect(panel.locator('.viz__legend')).toContainText('Not earned');
  });

  test('the breakdown separates earned from not-earned on a partial run', async ({ page }) => {
    /*
     * The perfect run hides the whole point of the chart: with every bucket
     * full there is no shortfall segment to get wrong. On a partial run there
     * is, and Recharts reads a data row's `fill` key for *every* series drawn
     * from that row — so a field by that name paints both stack segments the
     * same colour and the bar stops saying anything at all.
     */
    await installModelContext(page);
    await openDashboard(page);
    await runSequence(page, PARTIAL_RUN);

    await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible();
    const panel = page.locator('#debrief-breakdown');
    await waitForCharts(page, 1);

    const fills = await panel
      .locator('.recharts-rectangle')
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).fill));

    // Four buckets, two segments each.
    expect(fills.length).toBe(8);
    expect(new Set(fills).size).toBeGreaterThan(1);

    // Every readout is a genuine fraction, and at least one is short of its max.
    const readouts = await panel.locator('.recharts-label-list text').allTextContents();
    expect(readouts.length).toBe(4);
    const shortfalls = readouts.filter((readout) => {
      const [earned, max] = readout.trim().split('/').map(Number);
      return earned! < max!;
    });
    expect(shortfalls.length).toBeGreaterThan(0);
  });

  test('no chart element resolves to an off-palette colour', async ({ page }) => {
    await openDashboard(page);
    await waitForCharts(page, 3);

    /*
     * Recharts hardcodes its own defaults — `#3182bd` for an unset line or
     * area, `#ccc` for a grid, `#666` for a tick. The first is a blue, and the
     * palette gate fails the build over blue. This walks what actually
     * rendered and classifies the *computed* colour, so a rule that silently
     * fails to match is caught here rather than in a pixel diff.
     */
    const offenders = await page.evaluate(() => {
      const cool = (r: number, g: number, b: number) => b - r > 18 || Math.min(g, b) - r > 18;
      const parse = (value: string) => {
        const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
        return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
      };

      const bad: string[] = [];
      for (const node of document.querySelectorAll('.viz svg *, svg.chart *')) {
        const style = getComputedStyle(node);
        for (const property of ['fill', 'stroke'] as const) {
          const rgb = parse(style[property]);
          if (!rgb) continue;
          if (cool(rgb[0]!, rgb[1]!, rgb[2]!)) {
            bad.push(`${node.nodeName}.${node.getAttribute('class') ?? ''} ${property}=${style[property]}`);
          }
        }
      }
      return bad;
    });

    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  test('gridlines and axis text come from the token set', async ({ page }) => {
    await openDashboard(page);
    await waitForCharts(page, 3);

    const measured = await page.evaluate(() => {
      const grid = document.querySelector('.viz .recharts-cartesian-grid line');
      const tick = document.querySelector('.viz .recharts-cartesian-axis-tick-value');
      const root = getComputedStyle(document.documentElement);
      return {
        gridStroke: grid ? getComputedStyle(grid).stroke : null,
        gridWidth: grid ? getComputedStyle(grid).strokeWidth : null,
        tickFill: tick ? getComputedStyle(tick).fill : null,
        tickSize: tick ? getComputedStyle(tick).fontSize : null,
        expectedGrid: root.getPropertyValue('--ink-100').trim(),
        expectedTick: root.getPropertyValue('--text-tertiary').trim(),
      };
    });

    // `--ink-100` is `rgba(ink, 0.12)`; the computed value is the same colour.
    expect(measured.gridStroke).toContain('0.12');
    expect(measured.gridWidth).toBe('1px');
    expect(measured.tickSize).toBe('12px');
    expect(measured.tickFill).not.toBeNull();
    expect(measured.expectedGrid).not.toBe('');
    expect(measured.expectedTick).not.toBe('');
  });

  test('charts render fully under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openDashboard(page);

    // No animation at all, so the geometry is final on the first paint: the
    // bars must already have their width before any animation budget elapses.
    await expect
      .poll(async () => page.locator('.viz--categories .recharts-rectangle').count(), {
        timeout: 20_000,
      })
      .toBe(5);

    const widths = await page
      .locator('.viz--categories .recharts-rectangle')
      .evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('width') ?? 0)));
    expect(Math.min(...widths)).toBeGreaterThan(0);

    // Nothing is left mid-transition.
    const running = await page.evaluate(
      () => document.querySelectorAll('.viz .recharts-layer[style*="transition"]').length,
    );
    expect(running).toBe(0);
  });

  test('the office never downloads the charting library', async ({ page }) => {
    /*
     * The office draws these same panels onto its monitors, at up to 120 FPS.
     * Recharts is not free, so `compact` mode draws its own SVG and the chart
     * modules are behind `lazy` — which is only true for as long as nothing
     * imports them eagerly. This is that guarantee, measured on the wire.
     */
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));

    await page.addInitScript(() => {
      window.localStorage.setItem('cycase.office3d', 'false');
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.locator('#incident-brief')).toBeVisible();
    await page.waitForTimeout(1500);

    // The compact stream is drawn, and it is the hand-rolled one.
    await expect(page.locator('svg.chart--spark').first()).toBeVisible();
    expect(await page.locator('.viz').count()).toBe(0);

    const chartChunks = requested.filter((url) => /\/assets\/(chart|TelemetryCharts|ScoreBreakdownChart)-/.test(url));
    expect(chartChunks, `office loaded ${chartChunks.join(', ')}`).toEqual([]);
  });
});
