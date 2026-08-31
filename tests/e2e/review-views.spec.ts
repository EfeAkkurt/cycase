import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * The review set a person has to sign off.
 *
 * Somebody has to look at a fixed set of frames at both review sizes. Until
 * now that set existed only as files an agent had produced by hand, which is
 * not a set anyone can regenerate or trust.
 *
 * So this is the capture harness, committed: front (alarm unacknowledged),
 * left, right, rear, the colleague mid-walk, her report, and front again once
 * the alarm is acknowledged. Seven frames, two sizes, reproducible with one
 * command. The gap at `07` is where a frame of the removed robot used to sit;
 * the numbers after it were left alone so older captures stay comparable.
 *
 * It asserts almost nothing. `headlook.spec.ts` owns the luminance floors and
 * the focal-hierarchy gate, `characters.spec.ts` owns the staging assertions,
 * and duplicating either here would mean two places to update and one of them
 * silently going stale. What this adds is the *measurement printed next to the
 * picture*: the review kept turning on the word "orange", and an adjective is
 * not something two people can agree or disagree about.
 *
 * Run: `npx playwright test review-views --project=desktop-3d`
 *
 * It lives in the GPU project deliberately. Headless Chromium rasterises WebGL
 * in software, and a review capture taken there is a picture of the software
 * rasteriser rather than of the product.
 */

const SIZES = [
  { label: '1440x900', width: 1440, height: 900 },
  { label: '1280x720', width: 1280, height: 720 },
];

/** The clamps, copied from the rig rather than imported, so a change to the
 * product's limits shows up here as a failed settle rather than a silently
 * different framing. */
const YAW_LIMIT = 55;
const PITCH_DOWN_LIMIT = 20;

/*
 * These three are deliberately local rather than shared with
 * `headlook.spec.ts`. That file owns the assertions about the rig; this one
 * only needs to reproduce a framing. Importing across spec files to save nine
 * lines would couple the review set to a test's private helpers, and the day
 * one of them changed shape the review captures would change with it without
 * anybody deciding that.
 */
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

/**
 * Red-minus-blue and mean saturation over the captured frame.
 *
 * The same two numbers `scripts/measure-cast.mjs` reports, so a frame in the
 * review set and the same frame measured later from disk agree. The approved
 * reference sits at r-b 8.3 and 29.3% saturation; that is the target this is
 * printed against, not a threshold this test enforces — whether the result
 * looks credible is a judgement, and it belongs to a person.
 */
function cast(buffer: Buffer): { warmth: number; saturation: number; mean: number } {
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

  return { warmth: warmth / n, saturation: saturation / n, mean: mean / n };
}

async function capture(page: Page, size: string, name: string): Promise<void> {
  // Park the pointer: wherever the last interaction left it, a hover state
  // under it lands in the review set and reads as a design decision.
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);

  const path = `docs/screenshots/review-${size}-${name}.png`;
  const buffer = await page.screenshot({ path });
  const { warmth, saturation, mean } = cast(buffer);
  console.log(
    `review ${size} ${name.padEnd(24)} ` +
      `r-b=${warmth.toFixed(1).padStart(5)} ` +
      `sat=${(saturation * 100).toFixed(1).padStart(5)}% ` +
      `luma=${mean.toFixed(1).padStart(5)}  (reference: r-b 8.3, sat 29.3%)`,
  );
}

for (const size of SIZES) {
  test(`captures the six review views at ${size.label}`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: size.width, height: size.height });

    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();

    // Ten glTF props stream in and the DOM overlay only projects once the scene
    // has a size. A capture taken before all three surfaces exist is a picture
    // of a half-loaded room.
    await expect
      .poll(async () => page.locator('.office3d__screen').count(), { timeout: 30_000 })
      .toBe(3);
    await page.waitForTimeout(2500);

    /*
     * The four room views are all taken while the alarm is unacknowledged, so
     * they share one lighting state and are comparable with each other and with
     * the reference — which is itself an unacknowledged incident scene.
     */
    await capture(page, size.label, '01-front-unacknowledged');

    await look(page, 'ArrowLeft', 20);
    await settleAt(page, YAW_LIMIT, 0);
    await capture(page, size.label, '02-look-left');

    await look(page, 'ArrowRight', 40);
    await settleAt(page, -YAW_LIMIT, 0);
    await capture(page, size.label, '03-look-right');

    await look(page, 'ArrowDown', 10);
    await settleAt(page, -YAW_LIMIT, -PITCH_DOWN_LIMIT);
    await capture(page, size.label, '04-look-rear');

    await page.getByRole('button', { name: 'Recenter view' }).click();
    await settleAt(page, 0, 0);

    // The colleague walks in through the doorway and reports. The office turns
    // the camera toward her for the duration, which is the framing her staging
    // was designed and measured against.
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();

    /*
     * Mid-walk, while she is still crossing the room. Captured because the
     * arrival is where a rig shows its problems — root motion fighting the
     * path, a clip transition landing badly — and none of it is visible in a
     * frame taken once she has stopped.
     */
    await expect
      .poll(async () => page.locator('.office3d').getAttribute('data-colleague-phase'), {
        timeout: 20_000,
      })
      .toBe('entering');
    await page.waitForTimeout(900);
    await capture(page, size.label, '05-colleague-arriving');

    /*
     * Captured the moment she settles, before waiting on the briefing choice.
     * The office turns the camera toward the doorway while she walks in and
     * eases it back afterwards, so a frame taken once the next control appears
     * is a frame of the room she has already left the middle of.
     */
    await expect
      .poll(async () => page.locator('.office3d').getAttribute('data-colleague-phase'), {
        timeout: 30_000,
      })
      .toBe('settled');
    await capture(page, size.label, '06-colleague-report');

    await page.getByRole('button', { name: 'Open response console' }).waitFor({ timeout: 40_000 });

    // The beat after her report is the briefing choice itself: nothing else
    // takes the stage when she has finished.
    await expect(
      page.getByRole('button', { name: 'Open response console' }),
    ).toBeVisible({ timeout: 30_000 });

    /*
     * The centre monitor has to be the first focal point
     * before acknowledgement and to become normal after. The frame above is
     * post-acknowledgement, so this pair is the evidence for the second half:
     * compared against 01, the red treatment is gone and the two side monitors
     * are back to full brightness.
     */
    await page.getByRole('button', { name: 'Recenter view' }).click();
    await settleAt(page, 0, 0);
    await capture(page, size.label, '08-front-acknowledged');
  });
}
