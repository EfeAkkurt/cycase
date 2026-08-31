import { expect, test, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

import { PERFECT_RUN, installModelContext, runSequence } from './helpers';

/**
 * The review set for the dashboard destinations and for the rewired office.
 *
 * Two things review has to sign off after the nodeless-SOC pass, and neither of
 * them is a number a classifier can settle:
 *
 *  a. every dashboard destination in `docs/NODELESS_SOC_REDESIGN_2026-08-31.md`
 *     §4, at both review sizes, captured through one reproducible path so a
 *     "before" taken from the pre-change tree and an "after" taken from this one
 *     are genuinely the same frame of two different products;
 *  b. what actually changed in the office (§5): three monitors that are three
 *     *different* tools, the alarm state the centre one carries before it is
 *     acknowledged, the console the monitor opens, the room it returns to, and
 *     the contextual monitor switching from Identity to Endpoint when the
 *     required step moves on to the host.
 *
 * ## Before/after
 *
 * `CYCASE_VISUAL_PHASE=before` writes the `*-before-*` sets; the default writes
 * `*-after-*`. That is `headlook.spec.ts`'s convention ("visual evidence (P0.4)")
 * rather than a second one invented here, so a reviewer who already knows how to
 * regenerate the office evidence knows how to regenerate this.
 *
 *   CYCASE_VISUAL_PHASE=before npx playwright test dashboard-visual --project=desktop-3d
 *   npx playwright test dashboard-visual --project=desktop-3d
 *
 * NOTE FOR REVIEW: there is no `before` set on disk and none in git — the
 * repository has a single commit, so no pre-change tree exists here to capture
 * one from. The switch above is the mechanism; producing the `before` half needs
 * a checkout that predates the redesign. Nothing in this file relabels today's
 * frames as "before".
 *
 * AND: the committed `after` frames were taken against a dirty working tree, not
 * against a commit. §9.9 asks for release evidence regenerated on one clean RC
 * SHA, and a before/after pair whose halves came from different working states
 * is not the comparison it claims to be. Re-run this on the RC before signing
 * anything off.
 *
 * ## Why the GPU project
 *
 * Headless Chromium rasterises WebGL in software, so an office capture taken
 * there is a picture of the software rasteriser. The dashboard half does not
 * need the GPU, but it must not be split across two projects either: the whole
 * point of a before/after pair is that both halves came through one code path,
 * and a set half-rendered by Chrome and half by SwiftShader is not comparable
 * with anything. So the file is `desktop-3d`, entirely.
 *
 * The `beforeEach` below enforces that from inside the file, because right now
 * the config sends it to the wrong place rather than to no place. Both projects
 * key off the filename, and `dashboard-visual` is in neither list — so the file
 * collects into `desktop` (headless, software WebGL) and into `desktop-3d` not
 * at all. The guard skips it there, which is why a full headless run cannot
 * overwrite a GPU capture set with a picture of the software rasteriser. It also
 * means these tests capture nothing until `dashboard-visual` is added to
 * `desktop-3d`'s `testMatch` *and* to `desktop`'s `testIgnore`. Verify with:
 *
 *   npx playwright test --list --project=desktop-3d | grep dashboard-visual   # 4
 *   npx playwright test --list --project=desktop    | grep dashboard-visual   # 0
 *
 * It asserts almost nothing about how any of this looks. `headlook.spec.ts` owns
 * the luminance floors and the focal-hierarchy gate, `office.spec.ts` owns the
 * monitor wiring, and duplicating either here would mean two places to update and
 * one of them silently going stale. What this adds is the *measurement printed
 * next to the picture* — a reviewer arguing about a frame should be arguing about
 * a number.
 */

const GPU_ONLY =
  'Review captures are real-GPU only. This file must run in the desktop-3d project; ' +
  'see playwright.config.ts testMatch/testIgnore.';

/*
 * `test.info()` rather than a `({}, testInfo)` hook signature: Playwright
 * requires the first hook argument to be a destructuring pattern, and an empty
 * one trips `no-empty-pattern`. This is a hook rather than a line inside each
 * test so a capture added later cannot be the one that forgets it.
 */
test.beforeEach(async () => {
  test.skip(test.info().project.name !== 'desktop-3d', GPU_ONLY);
});

const PHASE = process.env.CYCASE_VISUAL_PHASE === 'before' ? 'before' : 'after';

const SIZES = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '1280x720', width: 1280, height: 720 },
];

/** The head-look clamps and key step, copied from the rig rather than imported,
 * so a change to the product's limits shows up here as a failed settle rather
 * than a silently different framing. `KEY_STEP` is 4 degrees per arrow press
 * (`src/three/HeadLookControls.tsx`). */
const KEY_STEP_DEG = 4;

/**
 * How far to turn to square a side monitor to the camera.
 *
 * The side monitors sit at x = +/-0.75 with their glass at z = -0.46, and the
 * seated eye is at z = 0.8 (`src/three/layout.ts`), so the bearing to one is
 * atan(0.75 / 1.26) = 30.8 degrees. Eight presses is 32 — the nearest the
 * keyboard rig can actually land, and well inside the 55-degree clamp.
 *
 * What this buys is the glass seen face-on instead of foreshortened, and clear
 * of the edge of the frame. It does *not* magnify anything: angular size is set
 * by where the monitor is in the room, not by where it sits in the picture. So
 * the clip dimensions printed beside each frame are the honest answer to "close
 * enough to read", and they are not flattering — measured on this tree, a side
 * monitor lands at 263x158 at 1440x900 and 196x118 at 1280x720, from a DOM
 * surface authored at 520x306. That is 51% and 38% linear, which puts 12px UI
 * text at roughly 6px and 4.5px on the glass. A reviewer should argue with those
 * two numbers rather than with the word "readable".
 */
const SIDE_PRESSES = 8;
const SIDE_YAW = SIDE_PRESSES * KEY_STEP_DEG;

/* ------------------------------------------------------------------ *
 * Measurement
 * ------------------------------------------------------------------ */

/**
 * Red-minus-blue, mean saturation and mean luma over a captured buffer.
 *
 * Mirrored verbatim from `review-views.spec.ts`'s `cast()`, which is itself the
 * in-browser form of the two numbers `scripts/measure-cast.mjs` reports. It is
 * copied rather than imported for the reason that file gives for its own local
 * helpers: importing across spec files runs the other file's `test()`
 * registrations, and a shared helper would couple this review set to a change
 * nobody made on its behalf. The one difference from `measure-cast.mjs` is
 * deliberate — that script crops 48px of app chrome off the top, which is right
 * for a full frame and wrong for a 300px monitor clip.
 *
 * The approved office reference sits at r-b 8.3 and 29.3% saturation. That is
 * the target these are printed against, not a threshold this file enforces:
 * whether a result looks credible is a judgement, and it belongs to a person.
 */
function cast(buffer: Buffer): {
  warmth: number;
  saturation: number;
  mean: number;
  width: number;
  height: number;
} {
  const png = PNG.sync.read(buffer);
  let warmth = 0;
  let saturation = 0;
  let mean = 0;
  let n = 0;

  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i + 3]! < 8) continue;
    const r = png.data[i]!;
    const g = png.data[i + 1]!;
    const b = png.data[i + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    warmth += r - b;
    saturation += max === 0 ? 0 : (max - min) / max;
    mean += 0.299 * r + 0.587 * g + 0.114 * b;
    n += 1;
  }

  return {
    warmth: warmth / n,
    saturation: saturation / n,
    mean: mean / n,
    width: png.width,
    height: png.height,
  };
}

interface CaptureOptions {
  /** Clip to one element — a monitor's glass rather than the whole room. */
  clip?: Locator;
  /** The fact this frame is evidence for, printed on the line under it. */
  note?: string;
}

/**
 * One review frame, and the numbers to argue about it with.
 *
 * `family` keeps the two halves of this file apart on disk and in the log:
 * `dashboard-*` is §4, `monitors-*` is §5.
 */
async function capture(
  page: Page,
  family: 'dashboard' | 'monitors',
  size: string,
  name: string,
  options: CaptureOptions = {},
): Promise<void> {
  /*
   * Scene and route changes keep the previous scroll offset, so a capture taken
   * straight after one lands mid-page. Every review shot starts at the top.
   */
  await page.evaluate(() => window.scrollTo(0, 0));

  /*
   * Charts are lazy-loaded, and a capture taken the instant a route mounts shows
   * an empty panel where a chart belongs — the debrief breakdown shipped into
   * the review set as a blank grey box for exactly this reason
   * (`screenshots.spec.ts`). Wait for every skeleton to resolve.
   */
  await expect
    .poll(async () => page.locator('.viz__skeleton').count(), { timeout: 20_000 })
    .toBe(0);

  // Park the pointer: wherever the last interaction left it, a hover state or a
  // held-open chart tooltip lands in the review set and reads as a decision.
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);

  let clip: { x: number; y: number; width: number; height: number } | undefined;
  if (options.clip) {
    const box = await options.clip.boundingBox();
    expect(box, `nothing to clip for ${family} ${size} ${name}`).not.toBeNull();
    const viewport = page.viewportSize()!;
    // A projected monitor near the edge of the frame can extend past it, and a
    // clip that does is a Playwright error rather than a smaller picture.
    const x = Math.max(0, box!.x);
    const y = Math.max(0, box!.y);
    clip = {
      x,
      y,
      width: Math.min(box!.width, viewport.width - x),
      height: Math.min(box!.height, viewport.height - y),
    };
  }

  const path = `docs/screenshots/${family}-${PHASE}-${size}-${name}.png`;
  const buffer = await page.screenshot({ path, clip });
  const { warmth, saturation, mean, width, height } = cast(buffer);

  console.log(
    `${family} ${PHASE} ${size} ${name.padEnd(28)} ` +
      `${String(width).padStart(4)}x${String(height).toString().padEnd(4)} ` +
      `r-b=${warmth.toFixed(1).padStart(6)} ` +
      `sat=${(saturation * 100).toFixed(1).padStart(5)}% ` +
      `luma=${mean.toFixed(1).padStart(5)}  (office reference: r-b 8.3, sat 29.3%)`,
  );
  if (options.note) console.log(`${' '.repeat(family.length + 1)}${' '.repeat(9)}${options.note}`);
}

/* ------------------------------------------------------------------ *
 * (a) The dashboard destinations
 * ------------------------------------------------------------------ */

/**
 * Enough of the optimal run to make every destination show something.
 *
 * A virgin Evidence page is an empty artifact list, a virgin Timeline is the
 * alert on its own and a virgin Respond page is six actions with unmet
 * prerequisites — none of which is a picture of the destination, and all of
 * which would compare identically before and after any redesign. This is the
 * first seven steps of `PERFECT_RUN`: three decisions taken, two artifacts
 * inspected, two diagnostics run.
 */
const SEED = PERFECT_RUN.slice(0, 7);

for (const size of SIZES) {
  test(`captures the dashboard destinations at ${size.label}`, async ({ page }) => {
    test.slow();
    test.setTimeout(240_000);

    await installModelContext(page);
    /*
     * The office is not what this half is about, and the flat monitor wall is a
     * real product path (`office.spec.ts`) that gets here without booting a
     * WebGL context and ten glTF props. The office's own review frames are the
     * `monitors-*` set below.
     */
    await page.addInitScript(() => {
      window.localStorage.setItem('cycase.office3d', 'false');
    });
    await page.setViewportSize({ width: size.width, height: size.height });

    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await page.getByRole('button', { name: 'Skip intro' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();

    await runSequence(page, SEED);

    const nav = page.getByRole('navigation');
    const go = async (label: string) => {
      await nav.getByRole('button', { name: new RegExp(`^${label}`) }).click();
      await expect(page.locator('#incident-title')).toBeVisible();
    };

    // 1 — Command: the case queue, severity, elapsed time and required step.
    await go('Command');
    await capture(page, 'dashboard', size.label, '01-command');

    /*
     * 2/3/4 — Investigate, on the three tools Case 001 actually feeds and the
     * three the office monitors point at. Captured as separate frames rather
     * than one, because "the right monitor opens the Identity tool" is only
     * checkable against a picture of the Identity tool.
     */
    await go('Investigate');
    /*
     * Named by substring rather than in full: `getByRole`'s `name` is a
     * case-insensitive substring match, the tabs carry a live row-count badge
     * inside the button, and "Endpoint / EDR" is the product's wording to
     * change. `accessibility.spec.ts` reaches the same five tools the same way.
     */
    for (const [index, tab] of ['SIEM', 'Identity', 'Endpoint'].entries()) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      const slug = tab.toLowerCase().replace(/[^a-z]+/g, '');
      await capture(page, 'dashboard', size.label, `0${index + 2}-investigate-${slug}`);
    }

    // 5 — Evidence: the artifacts collected so far, with provenance.
    await go('Evidence');
    await capture(page, 'dashboard', size.label, '05-evidence');

    // 6 — Respond: available operations, prerequisites and blast radius.
    await go('Respond');
    await capture(page, 'dashboard', size.label, '06-respond');

    // 7 — Timeline: alert, human and agent events in one chronology.
    await go('Timeline');
    await capture(page, 'dashboard', size.label, '07-timeline');

    /*
     * 8 — Debrief. It is the one destination that cannot be navigated to: §4
     * unlocks it only when the case closes, and the nav row is disabled until
     * then. So the rest of the optimal run has to be played to reach it, which
     * is also the only way its score and action history contain anything.
     */
    await runSequence(page, PERFECT_RUN.slice(7));
    await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible();
    await capture(page, 'dashboard', size.label, '08-debrief');
  });
}

/* ------------------------------------------------------------------ *
 * (b) The office, and what the monitors now are
 * ------------------------------------------------------------------ */

async function pose(page: Page): Promise<{ yaw: number; pitch: number }> {
  return page.locator('.office3d').evaluate((element) => ({
    yaw: Number((element as HTMLElement).dataset.yaw),
    pitch: Number((element as HTMLElement).dataset.pitch),
  }));
}

async function settleAt(page: Page, yaw: number, pitch: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const current = await pose(page);
        return `${current.yaw.toFixed(1)}/${current.pitch.toFixed(1)}`;
      },
      { timeout: 20_000 },
    )
    .toBe(`${yaw.toFixed(1)}/${pitch.toFixed(1)}`);
}

async function look(page: Page, key: string, times: number): Promise<void> {
  await page.locator('.office3d__canvas').focus();
  for (let press = 0; press < times; press += 1) {
    await page.keyboard.press(key);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
  }
}

/** One projected monitor, by the id `Office3D` stamps on the overlay element. */
function screen(page: Page, id: 'left' | 'center' | 'right'): Locator {
  return page.locator(`.office3d__screen[data-monitor="${id}"]`);
}

/**
 * What a monitor says it is, as facts rather than as a picture.
 *
 * The group's accessible name and the `data-monitor-opens` attribute
 * `MonitorWall2D` puts on the open control are the two things that make "three
 * different tools" checkable. A reviewer looking at three similar dark panels
 * can disagree about what is on them; nobody can disagree about
 * `investigate:siem` against `command` against `investigate:identity`.
 */
/**
 * What a monitor IS, with no trace of WHICH monitor it is.
 *
 * The identity deliberately excludes `id`. An earlier version of this helper
 * prefixed the string with `left:` / `center:` / `right:`, which made the
 * uniqueness check below unfalsifiable: three monitors rendering one identical
 * panel would still have produced three distinct strings, so no state of the
 * product could fail it. The prefix now lives only in the printed line, which
 * is for a person reading the log, not in the value the assertion compares.
 */
async function monitorIdentity(page: Page, id: 'left' | 'center' | 'right'): Promise<string> {
  const surface = screen(page, id).locator('.monitor-surface');
  const label = await surface.getAttribute('aria-label');
  const opens = await surface.locator('.monitor-open').getAttribute('data-monitor-opens');
  const headings = await surface.locator('.panel__title, h3').allInnerTexts();
  return `aria-label="${label}" opens=${opens} panels=[${headings.join(' | ')}]`;
}

/** The same facts with the monitor named, for the log only. */
async function describeMonitor(page: Page, id: 'left' | 'center' | 'right'): Promise<string> {
  return `${id}: ${await monitorIdentity(page, id)}`;
}

for (const size of SIZES) {
  test(`captures the rewired office at ${size.label}`, async ({ page }) => {
    test.slow();
    test.setTimeout(300_000);

    /*
     * The shim is installed here for the last two frames only: §5's contextual
     * monitor cannot be photographed doing the one interesting thing it does —
     * switching tool with the required step — until the case has actually
     * progressed, and driving that through the registered tools is how every
     * other spec in this suite advances a case.
     */
    await installModelContext(page);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();

    /*
     * Ten glTF props stream in and the DOM overlay only projects once the scene
     * has a size. A capture taken before all three surfaces exist is a picture
     * of a half-loaded room.
     */
    await expect(page.locator('.office3d')).toBeVisible();
    await expect
      .poll(async () => page.locator('.office3d__screen').count(), { timeout: 40_000 })
      .toBe(3);
    await page.waitForTimeout(2_500);

    /*
     * 01/02 — the alarm, before acknowledgement. The room narrows to the centre
     * monitor: it takes `--alarm` and the two beside it take `--deferred`. The
     * second frame is that same monitor close enough to read the critical brief
     * and the acknowledge control on the glass.
     */
    const alarming = page.locator('.office3d__surface--alarm');
    const deferred = page.locator('.office3d__surface--deferred');
    await expect(alarming).toHaveCount(1);
    await expect(deferred).toHaveCount(2);
    await expect(page.locator('#incident-brief')).toContainText('Critical');
    await capture(page, 'monitors', size.label, '01-front-alarm-unacknowledged', {
      note:
        `alarm surfaces=${await alarming.count()} deferred=${await deferred.count()}; ` +
        'the centre monitor carries the alarm and the two beside it step back',
    });
    await capture(page, 'monitors', size.label, '02-center-alarm-close', {
      clip: screen(page, 'center'),
      note: 'centre monitor, alarm unacknowledged: incident command with the acknowledge control',
    });

    /*
     * Acknowledge, and let VERA finish. Her report no longer auto-advances —
     * §2 forbids the old 6000 ms timeout — so the briefing choice appearing is
     * what says the beat is over rather than a wait long enough to be sure.
     */
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.getByRole('button', { name: 'Open response console' }).waitFor({ timeout: 60_000 });
    await expect(alarming).toHaveCount(0);
    await expect(deferred).toHaveCount(0);

    await page.getByRole('button', { name: 'Recenter view' }).click();
    await settleAt(page, 0, 0);

    /*
     * 03/04/05 — the three monitors, each turned toward so it fills enough of
     * the frame to be read. The order is the order they sit on the desk, so the
     * set reads left to right.
     */
    await look(page, 'ArrowLeft', SIDE_PRESSES);
    await settleAt(page, SIDE_YAW, 0);
    await expect(screen(page, 'left')).toBeVisible();
    await capture(page, 'monitors', size.label, '03-monitor-left-siem', {
      clip: screen(page, 'left'),
      note: await describeMonitor(page, 'left'),
    });

    await page.getByRole('button', { name: 'Recenter view' }).click();
    await settleAt(page, 0, 0);
    await capture(page, 'monitors', size.label, '04-monitor-center-command', {
      clip: screen(page, 'center'),
      note: await describeMonitor(page, 'center'),
    });

    await look(page, 'ArrowRight', SIDE_PRESSES);
    await settleAt(page, -SIDE_YAW, 0);
    await expect(screen(page, 'right')).toBeVisible();
    const identityDescriptor = await describeMonitor(page, 'right');
    await capture(page, 'monitors', size.label, '05-monitor-right-contextual', {
      clip: screen(page, 'right'),
      note: identityDescriptor,
    });

    /*
     * The three descriptors, printed together. Three copies of one panel would
     * be three identical lines here, and no amount of arguing about the pictures
     * would be needed to see it.
     */
    await page.getByRole('button', { name: 'Recenter view' }).click();
    await settleAt(page, 0, 0);
    const wall = [
      await describeMonitor(page, 'left'),
      await describeMonitor(page, 'center'),
      await describeMonitor(page, 'right'),
    ];
    console.log(`monitors ${PHASE} ${size.label} wall:\n  ${wall.join('\n  ')}`);

    /*
     * Three DIFFERENT tools, per §5. Compared on identity alone — the label,
     * the route the button opens, and the panel titles actually rendered — so
     * that a regression collapsing the wall to three copies of one panel fails
     * here instead of passing on the strength of the monitors' own names.
     */
    const identities = [
      await monitorIdentity(page, 'left'),
      await monitorIdentity(page, 'center'),
      await monitorIdentity(page, 'right'),
    ];
    expect(
      new Set(identities).size,
      `two monitors are the same tool:\n${wall.join('\n')}`,
    ).toBe(3);

    // 06 — the settled room once the alarm is dealt with, for comparison with 01.
    await capture(page, 'monitors', size.label, '06-front-acknowledged', {
      note: 'the alarm treatment is gone and all three surfaces are back to full brightness',
    });

    /*
     * 07 — the office to dashboard transition, driven from the glass. The right
     * monitor is the contextual one, so it is the interesting case: it advertises
     * a route *and* a tab, and both have to survive the crossfade (§10).
     */
    const opener = screen(page, 'right').locator('.monitor-open');
    const advertised = await opener.getAttribute('data-monitor-opens');
    await opener.click();

    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
    await expect(page.locator('[data-testid="transition-cover"]')).toHaveCount(0, {
      timeout: 20_000,
    });

    const landedRoute = await page
      .getByRole('navigation')
      .locator('[aria-current="page"]')
      .getAttribute('aria-label');
    // Scoped to the Investigate tablist by its `idBase` (`ui/primitives`
    // `tabId`): the Evidence destination has a tablist of its own, and
    // "whichever tab is selected somewhere on the page" is not a fact.
    const landedTab = await page
      .locator('[id^="investigate-tab-"][aria-selected="true"]')
      .innerText();
    await capture(page, 'monitors', size.label, '07-console-from-right-monitor', {
      note: `monitor advertised "${advertised}"; landed on nav "${landedRoute}", tab "${landedTab}"`,
    });

    /*
     * Stated as facts as well as printed, because "it opened the right tool" is
     * the §10 gate and a screenshot of a console is not evidence of which one.
     * The tab is matched loosely: `investigate:endpoint` is the "Endpoint / EDR"
     * tab, and the label is the product's to word.
     */
    const [route, tab] = (advertised ?? '').split(':');
    expect(landedRoute?.toLowerCase(), `monitor advertised ${advertised}`).toContain(route!);
    if (tab) {
      expect(landedTab.toLowerCase().replace(/[^a-z]+/g, ''), `monitor advertised ${advertised}`)
        .toContain(tab);
    }

    /*
     * Work the case from the console before going back, for two reasons that
     * frame 05 makes obvious. The right monitor was captured there showing
     * Identity's *empty state* — "the session store has not been queried" —
     * which is honest at that point in the story and almost no evidence about
     * §5's "compact rows remain legible at monitor distance", because there
     * were no rows. And the contextual monitor's whole contract is that it
     * changes with the required step, which nothing before D4 can show.
     *
     * Ten steps of the optimal run: the session inventory that fills Identity,
     * and D4, whose pending work is the EDR report and the isolation — the
     * exact condition `contextualTab()` reads to switch the screen to Endpoint.
     */
    await runSequence(page, PERFECT_RUN.slice(0, 10));

    /*
     * 08 — and back. §10 asks that the round trip preserve state and route
     * intent; the resume beat is the frame that shows the room came back drawn
     * rather than black behind the projected panels, and now also the frame that
     * shows the console's work on the glass.
     */
    await page.getByRole('button', { name: 'Return to office' }).click();
    await expect(page.getByText('Your investigation is exactly where you left it.')).toBeVisible();
    await expect(
      page.locator('[data-testid="transition-cover"][data-direction="return"]'),
    ).toHaveCount(0, { timeout: 40_000 });
    await expect
      .poll(async () => page.locator('.office3d__screen').count(), { timeout: 40_000 })
      .toBe(3);
    await page.waitForTimeout(1_200);
    await capture(page, 'monitors', size.label, '08-office-returned', {
      note: 'the resume beat: the same case, no opening report replayed, ten steps of state on the glass',
    });

    /*
     * 09 — the contextual monitor, having switched. This is the pair to 05:
     * same screen, same run, different tool, because the required step moved on
     * to the endpoint. Printed as the two descriptors rather than described, so
     * "it switched" is a diff between two strings.
     */
    await expect(screen(page, 'right')).toBeVisible();
    const switched = await describeMonitor(page, 'right');
    console.log(`monitors ${PHASE} ${size.label} contextual switch:\n  was ${identityDescriptor}\n  now ${switched}`);
    expect(switched, 'the contextual monitor never left Identity').not.toBe(identityDescriptor);
    await capture(page, 'monitors', size.label, '09-monitor-right-switched-to-endpoint', {
      clip: screen(page, 'right'),
      note: switched,
    });
  });
}
