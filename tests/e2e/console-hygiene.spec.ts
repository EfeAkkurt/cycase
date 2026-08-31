import { expect, test } from '@playwright/test';

import { ALARM_ASSETS, INSTALLED_ALARM_ASSETS } from '../../src/audio/manifest';
import { collectPageProblems } from './helpers';

/**
 * Console and network hygiene on the demo path, with warnings separated from
 * errors.
 *
 * The delivery plan asks for zero console errors on the demo path, and the final
 * audit asks for the `THREE.Clock` deprecation to be fixed "if it can be fixed
 * safely, otherwise recorded honestly". It cannot: the warning comes from
 * `@react-three/fiber` 9.7.0 constructing `new THREE.Clock()`, not from this
 * repository, and 9.7.0 is the newest stable release — the only alternatives are
 * 10.0.0 canaries. Swapping the library that drives the entire 3D office onto a
 * canary to silence a deprecation warning is a bad trade days before a deadline.
 *
 * So it is allowed by name and by reason. Everything else is not: a new warning
 * fails this test, which is the property that makes the allowance safe rather
 * than a blanket mute.
 */

/**
 * The three missing alarm samples, named — and named as impossible rather than
 * as forgiven.
 *
 * `alarm-primary.wav`, `alarm-impact.wav` and `alarm-alternative.wav` are
 * nominated in `src/audio/manifest.ts` and are not in the repository, because
 * Freesound requires a signed-in human to download the originals
 * (docs/AUDIO_ASSET_REQUEST.md). They were once the standing exception here:
 * three 404s and three console errors on every run, discounted by a regular
 * expression that every console gate in the suite read past.
 *
 * They are not discounted now, and they are not failing either. The build lists
 * `public/audio/` and substitutes the result, so `INSTALLED_ALARM_ASSETS` is the
 * intersection of the nomination with what is actually on disk and the loader
 * may only fetch from that list. With the samples absent the correct number of
 * audio requests is zero, which is what `alarm-degraded.spec.ts` measures. A
 * request for one of these three is therefore not an expected failure to be read
 * past — it is evidence that the intersection stopped being enforced, and
 * `noNominatedSampleRequested` says exactly that rather than letting it arrive
 * as an anonymous line in a list of URLs.
 */
const NOMINATED_SAMPLES = ALARM_ASSETS.map((asset) => asset.path);

function nominatedButNotInstalled(): string[] {
  const installed = new Set(INSTALLED_ALARM_ASSETS.map((asset) => asset.path));
  return NOMINATED_SAMPLES.filter((path) => !installed.has(path));
}

/** Warnings we have looked at, attributed, and decided to live with. */
const ACCEPTED_WARNINGS: { match: RegExp; because: string }[] = [
  {
    match: /THREE\.Clock/i,
    because:
      '@react-three/fiber 9.7.0 constructs new THREE.Clock(); 9.7.0 is the newest stable ' +
      'release and the only alternatives are 10.0.0 canaries.',
  },
];

function unexpected(warnings: string[]): string[] {
  return warnings.filter(
    (warning) => !ACCEPTED_WARNINGS.some((accepted) => accepted.match.test(warning)),
  );
}

test.describe('console hygiene on the demo path', () => {
  test.slow();

  test('zero errors, zero failed requests, and no warning we have not accounted for', async ({
    page,
  }) => {
    /*
     * The shared collector, not a local one.
     *
     * The listeners here used to be console-only, which left the office and 3D
     * path — the one this test walks, and the only demo path that streams ten
     * glTF props, three textures sets and an environment — with no network
     * coverage at all. `collectPageProblems` arms `requestfailed` and every
     * response at status 400 or above alongside the console, and it is already
     * the collector `manual.spec.ts` and `webmcp-native.spec.ts` use. Those two
     * run with `cycase.office3d` disabled; this is the first gate to hold the
     * room itself to the same standard.
     */
    const { errors, pageErrors, failed } = collectPageProblems(page);
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning') warnings.push(message.text());
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    // The office streams ten glTF props before the alarm control appears, and
    // under a full-suite load that takes longer than the default budget.
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible({
      timeout: 40_000,
    });
    await page.waitForTimeout(4000);
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await page.getByRole('button', { name: 'Open response console' }).click({ timeout: 40_000 });
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
    await page.waitForTimeout(1500);

    const surprises = unexpected(warnings);
    console.log(
      `console: ${errors.length} error(s), ${pageErrors.length} page error(s), ` +
        `${failed.length} failed request(s), ${warnings.length} warning(s), ` +
        `${surprises.length} unaccounted for`,
    );
    for (const accepted of ACCEPTED_WARNINGS) {
      const seen = warnings.filter((warning) => accepted.match.test(warning)).length;
      if (seen > 0) console.log(`  accepted x${seen}: ${accepted.because}`);
    }

    // The named exception, asserted rather than allowed. This can only fire if
    // the build-time intersection in src/audio/manifest.ts stopped being the
    // only list the loader reads.
    const absent = nominatedButNotInstalled();
    const requestedAnyway = absent.filter((path) =>
      [...errors, ...failed].some((problem) => problem.includes(path)),
    );
    expect(
      requestedAnyway,
      `the page asked for an alarm sample the build knows is absent:\n${requestedAnyway.join('\n')}`,
    ).toEqual([]);
    console.log(
      `alarm samples nominated but not installed: ${absent.length}, requested: 0 ` +
        '(the loader only fetches what the build found — src/audio/manifest.ts)',
    );

    // No filter. Every console error, page error and failed request is a
    // failure, including an audio 404 — the page no longer asks for a file the
    // build could not find.
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
    expect(failed, failed.join('\n')).toEqual([]);
    expect(surprises, `unaccounted-for warnings:\n${surprises.join('\n')}`).toEqual([]);
  });
});
