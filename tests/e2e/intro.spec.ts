import { expect, test, type Page } from '@playwright/test';

/**
 * Audit contract P0.5 — the wake-up and transition effects.
 *
 * The three requirements are all timing claims, so all three are measured
 * rather than eyeballed:
 *
 *  - the typewriter runs at 28–36 ms per glyph, net of the punctuation rests,
 *    over a window long enough that timer jitter cannot decide the verdict;
 *  - the wake reveal lasts 2.8–3.4 s and its lid geometry reverses direction
 *    four times — two irregular lid movements, per
 *    `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §2, which supersedes the
 *    single re-close of audit contract P0.5. A reveal that only ever opens,
 *    or that blinks once, fails this file;
 *  - the office and the dashboard are both in the document during the
 *    crossfade, and no status text is ever shown.
 *
 * Nothing here asserts on a screenshot. Every number comes from the page's own
 * clock and from real element geometry.
 */

/** The opening copy, from `src/i18n/en.ts` with the default operator name. */
const LINES = [
  '03:17:42',
  'Unauthorized session detected in the identity layer.',
  'Operator, wake up.',
];

const TOTAL_GLYPHS = LINES.join('').length;

/**
 * Line 2's interior, which is where the cadence is measured.
 *
 * It used to be chosen so the window contained no rests at all, and the test
 * divided raw wall-clock time by glyphs. The line now rests briefly at the end
 * of each long word — a sentence typed at a fixed rate with no word rhythm
 * reads as a ticker rather than as typing — so the window is no longer
 * rest-free and the division subtracts the rests instead. That is the honest
 * form of the same measurement: `at` is `glyph * GLYPH_MS + pause` by
 * construction, so removing the pause delta leaves exactly the glyph time.
 */
const MEASURE_WINDOW = { from: LINES[0]!.length + 4, to: LINES[0]!.length + LINES[1]!.length - 4 };

/**
 * The WebGL room is irrelevant to every assertion below, and several agents
 * share this machine's GPU. The monitor wall is a real product path with its
 * own coverage in office.spec.ts.
 */
async function flatOffice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('cycase.office3d', 'false');
  });
}

/* ------------------------------------------------------------------ *
 * 1 — the two layers
 * ------------------------------------------------------------------ */

test.describe('opening typewriter', () => {
  test('the typed layer is aria-hidden while the whole sentence stays in the accessibility tree', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();

    const layer = page.locator('[data-testid="intro-typewriter"]');
    await expect(layer).toHaveAttribute('aria-hidden', 'true');

    // The decorative copy is drawn from a pseudo-element, so it contributes no
    // text nodes at all — not to the accessibility tree, and not to any other
    // consumer that reads the document's text.
    await expect(layer).toHaveText('');

    const samples = await page.evaluate(async (total: number) => {
      const readAccessible = (): string => {
        const parts: string[] = [];
        const walk = (node: Node) => {
          if (node.nodeType === Node.TEXT_NODE) {
            parts.push(node.nodeValue ?? '');
            return;
          }
          if (!(node instanceof Element)) return;
          if (node.getAttribute('aria-hidden') === 'true') return;
          if (node.hasAttribute('inert')) return;
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return;
          for (const child of node.childNodes) walk(child);
        };
        walk(document.body);
        return parts.join('');
      };

      const out: { typed: string[]; accessible: string; glyphs: number }[] = [];
      const deadline = performance.now() + 12_000;

      while (performance.now() < deadline) {
        const layer = document.querySelector('[data-testid="intro-typewriter"]');
        if (!layer) break;
        const glyphs = Number(layer.getAttribute('data-tw-glyphs'));
        out.push({
          typed: [...layer.querySelectorAll('[data-typed]')].map(
            (node) => node.getAttribute('data-typed') ?? '',
          ),
          accessible: readAccessible(),
          glyphs,
        });
        if (glyphs >= total) break;
        await new Promise((resolve) => window.setTimeout(resolve, 70));
      }
      return out;
    }, TOTAL_GLYPHS);

    expect(samples.length, 'the opening was never sampled').toBeGreaterThan(8);

    let sawPartialLine = false;
    for (const sample of samples) {
      sample.typed.forEach((typed, index) => {
        const full = LINES[index]!;
        if (typed.length === 0) return;

        // Whatever is on screen is a prefix of the real sentence...
        expect(full.startsWith(typed), `"${typed}" is not a prefix of "${full}"`).toBe(true);
        // ...and the complete sentence is already available to a screen reader.
        expect(sample.accessible, `line ${index} incomplete for assistive technology`).toContain(
          full,
        );
        if (typed.length < full.length) sawPartialLine = true;
      });
    }

    // If the visual layer never lagged the transcript the assertion above is
    // vacuous, so prove the half-typed state was actually observed.
    expect(sawPartialLine, 'never caught the typewriter mid-line').toBe(true);
  });

  test('a sentence exists exactly once in the document', async ({ page }) => {
    // The transcript and the typed layer must not both read as an occurrence of
    // the same copy: office.spec.ts and screenshots.spec.ts locate this line by
    // text, and a duplicate would break them rather than this file.
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();
    await expect(page.getByRole('button', { name: 'Investigate the incident' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Unauthorized session detected')).toHaveCount(1);
  });

  test('glyph cadence sits inside the contracted 28–36 ms, and punctuation rests', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();
    await page.waitForSelector('[data-testid="intro-typewriter"]');

    // A mutation observer on the glyph counter timestamps every reveal at the
    // moment the DOM changes — no polling interval to alias against.
    await page.evaluate(() => {
      const layer = document.querySelector('[data-testid="intro-typewriter"]');
      if (!layer) throw new Error('typewriter layer missing');
      const marks: { t: number; g: number; p: number; k: number }[] = [];
      (window as unknown as { __tw: typeof marks }).__tw = marks;

      const record = () =>
        marks.push({
          t: performance.now(),
          g: Number(layer.getAttribute('data-tw-glyphs')),
          p: Number(layer.getAttribute('data-tw-pause')),
          k: Number(layer.getAttribute('data-tw-keys')),
        });

      record();
      new MutationObserver(record).observe(layer, {
        attributes: true,
        attributeFilter: ['data-tw-glyphs'],
      });
    });

    await expect(page.getByRole('button', { name: 'Investigate the incident' })).toBeVisible({
      timeout: 15_000,
    });

    const marks = await page.evaluate(
      () => (window as unknown as { __tw: { t: number; g: number; p: number; k: number }[] }).__tw,
    );

    expect(marks.length, 'no glyph reveals were recorded').toBeGreaterThan(40);

    const first = marks.find((mark) => mark.g >= MEASURE_WINDOW.from);
    const last = [...marks].reverse().find((mark) => mark.g <= MEASURE_WINDOW.to);
    expect(first, 'the measurement window was never entered').toBeTruthy();
    expect(last, 'the measurement window never closed').toBeTruthy();

    const glyphs = last!.g - first!.g;
    const rests = last!.p - first!.p;
    expect(glyphs, 'window too short to average out timer jitter').toBeGreaterThanOrEqual(20);
    /*
     * The window rests, and that is the point: a run of words with no rhythm
     * between them is a ticker. What the 28–36 ms contract governs is the rate
     * between glyphs, so the rests are measured and subtracted rather than
     * avoided — and this asserts they are really there, because a window with
     * no rests would mean the word rhythm had quietly gone.
     */
    expect(rests, 'the sentence typed with no word rhythm at all').toBeGreaterThan(0);

    const cadence = (last!.t - first!.t - rests) / glyphs;
    console.log(`typewriter cadence: ${cadence.toFixed(2)} ms/glyph over ${glyphs} glyphs`);

    expect(cadence, `cadence ${cadence.toFixed(2)} ms is outside 28–36 ms`).toBeGreaterThanOrEqual(
      28,
    );
    expect(cadence, `cadence ${cadence.toFixed(2)} ms is outside 28–36 ms`).toBeLessThanOrEqual(36);

    // Punctuation actually rests: at least one single-glyph step carries a rest
    // longer than three glyph times.
    let longestRest = 0;
    for (let i = 1; i < marks.length; i += 1) {
      if (marks[i]!.g - marks[i - 1]!.g <= 2) {
        longestRest = Math.max(longestRest, marks[i]!.p - marks[i - 1]!.p);
      }
    }
    expect(longestRest, 'no punctuation rest was applied').toBeGreaterThanOrEqual(100);
  });

  test('key sounds are grouped: more than one per line, fewer than one per glyph', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();
    await expect(page.getByRole('button', { name: 'Investigate the incident' })).toBeVisible({
      timeout: 15_000,
    });

    const layer = page.locator('[data-testid="intro-typewriter"]');
    const keys = Number(await layer.getAttribute('data-tw-keys'));
    const glyphs = Number(await layer.getAttribute('data-tw-glyphs'));

    expect(glyphs).toBe(TOTAL_GLYPHS);
    console.log(`grouped key strikes: ${keys} for ${glyphs} glyphs across ${LINES.length} lines`);

    expect(keys, 'the sound is still playing once per line').toBeGreaterThan(LINES.length);
    expect(keys, 'the sound is playing once per glyph').toBeLessThan(glyphs);
    // A group is at most three characters, and boundaries flush early.
    expect(keys).toBeGreaterThanOrEqual(Math.floor(glyphs / 3));
  });
});

/* ------------------------------------------------------------------ *
 * 2 — the wake reveal
 * ------------------------------------------------------------------ */

interface WakeCapture {
  samples: { t: number; lid: number }[];
  start: number | null;
  end: number | null;
  attrDelta: number;
}

test.describe('wake reveal', () => {
  test('runs 2.8–3.4 s and reverses direction exactly four times', async ({ page }) => {
    await flatOffice(page);
    await page.goto('/');

    // Installed before the office exists, so the very first frame of the reveal
    // is sampled and the duration is not shortened by test latency.
    await page.evaluate(() => {
      const capture = {
        samples: [] as { t: number; lid: number }[],
        start: null as number | null,
        end: null as number | null,
        attrDelta: 0,
      };
      (window as unknown as { __wake: typeof capture }).__wake = capture;

      const deadline = performance.now() + 20_000;
      const tick = () => {
        const root = document.querySelector('[data-testid="wake-reveal"]');
        const top = root?.querySelector('.wake__lid--top');
        if (root && top) {
          if (capture.start === null) capture.start = Number(root.getAttribute('data-wake-start'));
          // Real geometry, not the reported number — and the two are compared.
          const lid = top.getBoundingClientRect().height / window.innerHeight;
          const reported = Number(root.getAttribute('data-wake-lid'));
          capture.attrDelta = Math.max(capture.attrDelta, Math.abs(lid - reported));
          capture.samples.push({ t: performance.now(), lid });
        } else if (capture.start !== null) {
          capture.end = performance.now();
          return;
        }
        if (performance.now() > deadline) return;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.locator('[data-testid="wake-reveal"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="wake-reveal"]')).toHaveCount(0, { timeout: 20_000 });

    const wake = await page.evaluate(
      () => (window as unknown as { __wake: WakeCapture }).__wake as WakeCapture,
    );

    expect(wake.start, 'the reveal never reported a start').not.toBeNull();
    expect(wake.end, 'the reveal never finished').not.toBeNull();
    expect(wake.samples.length, 'the reveal was never sampled').toBeGreaterThan(40);

    const duration = wake.end! - wake.start!;
    const lids = wake.samples.map((sample) => sample.lid);
    console.log(
      `wake reveal: ${duration.toFixed(0)} ms over ${lids.length} frames, lid ${lids[0]!.toFixed(3)} → ${lids[lids.length - 1]!.toFixed(3)}`,
    );

    expect(duration, `reveal lasted ${duration.toFixed(0)} ms`).toBeGreaterThanOrEqual(2800);
    expect(duration, `reveal lasted ${duration.toFixed(0)} ms`).toBeLessThanOrEqual(3400);

    // The reported lid fraction is the geometry, not a decoration beside it.
    expect(wake.attrDelta).toBeLessThan(0.01);

    // Starts effectively shut, ends fully open.
    expect(lids[0]!).toBeGreaterThan(0.44);
    expect(lids[lids.length - 1]!).toBeLessThan(0.005);

    // Two partial re-closes: a crack, a fall back, a wider opening, a shorter
    // second flutter, then the slow full open. A monotonic reveal scores zero
    // direction changes and a single blink scores two; both fail here. The
    // shape itself — the irregularity, the lid asymmetry and the sub-3 Hz
    // pulse rate — is pinned in `tests/unit/wake.test.ts`, which runs without
    // a browser; this is the proof that the DOM carries it.
    const EPSILON = 0.005;
    let direction = 0;
    let reference = lids[0]!;
    let changes = 0;
    for (const value of lids) {
      const delta = value - reference;
      if (Math.abs(delta) < EPSILON) continue;
      const next = delta > 0 ? 1 : -1;
      if (direction !== 0 && next !== direction) changes += 1;
      direction = next;
      reference = value;
    }
    expect(changes, `lid direction changed ${changes} times, expected two re-closes`).toBe(4);

    // And the first re-close is large enough to read as a blink, not as jitter.
    let lowest = Number.POSITIVE_INFINITY;
    let rebound = 0;
    for (const value of lids) {
      if (value < lowest) lowest = value;
      else rebound = Math.max(rebound, value - lowest);
    }
    expect(rebound, `re-close of only ${(rebound * 100).toFixed(1)}% of the viewport`).toBeGreaterThanOrEqual(
      0.05,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3 — reduced motion
 * ------------------------------------------------------------------ */

test.describe('reduced motion', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('skips the lid reveal and shows one short fade instead', async ({ page }) => {
    await flatOffice(page);
    await page.goto('/');

    await page.evaluate(() => {
      const seen = { count: 0, fade: 0, frames: 0 };
      (window as unknown as { __seen: typeof seen }).__seen = seen;
      const deadline = performance.now() + 10_000;
      const tick = () => {
        seen.frames += 1;
        seen.count += document.querySelectorAll('[data-testid="wake-reveal"]').length;
        seen.fade += document.querySelectorAll('[data-testid="wake-fade"]').length;
        if (performance.now() < deadline) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
    await page.waitForTimeout(4000);

    const seen = await page.evaluate(
      () =>
        (window as unknown as { __seen: { count: number; fade: number; frames: number } }).__seen,
    );
    expect(seen.frames, 'the office never rendered a frame').toBeGreaterThan(30);
    expect(seen.count, 'the wake reveal mounted under reduced motion').toBe(0);

    /*
     * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §2 allows one short fade in
     * place of the lid reveal, so the replacement is asserted rather than left
     * as an untested branch — it mounted, and it did not stay.
     */
    expect(seen.fade, 'the reduced-motion fade never mounted').toBeGreaterThan(0);
    await expect(page.locator('[data-testid="wake-fade"]')).toHaveCount(0);
  });

  test('shows the opening lines complete, with no typing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Enter Simulation' }).click();

    // Already finished: the advance button is in its completed state at once.
    await expect(page.getByRole('button', { name: 'Investigate the incident' })).toBeVisible();

    const typed = await page
      .locator('[data-testid="intro-typewriter"] [data-typed]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-typed')));
    expect(typed).toEqual(LINES);

    for (const line of LINES) {
      await expect(page.getByText(line, { exact: true })).toHaveCount(1);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 4 — the crossfade
 * ------------------------------------------------------------------ */

interface CrossCapture {
  frames: number;
  both: number;
  officeHiddenWhileBoth: number;
  dashboardHiddenWhileBoth: number;
  sceneFrames: number;
  statusSeen: boolean;
}

test.describe('office to dashboard crossfade', () => {
  test('mounts both scenes at once, under the cover, with no status interstitial', async ({
    page,
  }) => {
    await flatOffice(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();

    await page.evaluate(() => {
      const capture = {
        frames: 0,
        both: 0,
        officeHiddenWhileBoth: 0,
        dashboardHiddenWhileBoth: 0,
        sceneFrames: 0,
        statusSeen: false,
      };
      (window as unknown as { __cross: typeof capture }).__cross = capture;

      // The retired interstitial's copy, from `transition.status`.
      const PHRASE = 'Opening security operations console';

      const sample = () => {
        capture.frames += 1;
        const office = document.querySelector('[data-stage="office"]');
        const dashboard = document.querySelector('[data-stage="dashboard"]');
        if (office && dashboard) {
          capture.both += 1;
          if (office.getAttribute('aria-hidden') === 'true') capture.officeHiddenWhileBoth += 1;
          if (dashboard.getAttribute('aria-hidden') === 'true')
            capture.dashboardHiddenWhileBoth += 1;
        }
        // `.scene` is the full-page copy slate the boot and opening screens
        // use; the crossfade must never put one on screen.
        if (document.querySelectorAll('.scene').length > 0) capture.sceneFrames += 1;
        // textContent over the whole dashboard is not free, so sample it.
        if (capture.frames % 4 === 0 && (document.body.textContent ?? '').includes(PHRASE)) {
          capture.statusSeen = true;
        }
      };

      const deadline = performance.now() + 6000;
      const tick = () => {
        sample();
        if (performance.now() < deadline) requestAnimationFrame(tick);
      };
      sample();
      requestAnimationFrame(tick);
    });

    // The office chrome's skip goes straight to the dashboard, through the
    // crossfade — the same path openDashboard() takes. It is named for what it
    // skips: the intro is already over by the time this control exists.
    await page.getByRole('button', { name: 'Skip to console' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
    await page.waitForTimeout(1500);

    const cross = await page.evaluate(
      () => (window as unknown as { __cross: CrossCapture }).__cross,
    );
    console.log(
      `crossfade: ${cross.both} of ${cross.frames} frames had both stages mounted, status text seen: ${cross.statusSeen}`,
    );

    expect(cross.both, 'the office and the dashboard were never mounted together').toBeGreaterThanOrEqual(
      5,
    );
    // While both are up, neither is offered to assistive technology: the office
    // is on its way out and the dashboard is still behind black.
    expect(cross.officeHiddenWhileBoth).toBe(cross.both);
    expect(cross.dashboardHiddenWhileBoth).toBe(cross.both);

    expect(cross.statusSeen, 'a status-text interstitial appeared').toBe(false);
    expect(cross.sceneFrames, 'a full-page copy slate appeared during the crossfade').toBe(0);

    // Focus was swapped under the cover, per acceptance criterion 4.
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('incident-title');

    // And the cover cleans itself up.
    await expect(page.locator('[data-testid="transition-cover"]')).toHaveCount(0);
  });

  test('the office keeps its live subtree across the crossfade rather than reloading', async ({
    page,
  }) => {
    await flatOffice(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();

    // Stamp the live office node. If the crossfade re-mounted the subtree, the
    // stamp would be gone the moment the transition begins.
    await page.evaluate(() => {
      const office = document.querySelector('[data-stage="office"] .office');
      if (!office) throw new Error('office root missing');
      (office as HTMLElement).dataset.e2eStamp = 'kept';
    });

    await page.getByRole('button', { name: 'Skip to console' }).click();
    const stamped = await page.evaluate(
      () => document.querySelector('[data-stage="office"] .office')?.getAttribute('data-e2e-stamp'),
    );
    expect(stamped).toBe('kept');
  });
});
