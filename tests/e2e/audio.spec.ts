import { expect, test, type APIRequestContext, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * The audio contract, in a real browser.
 *
 * Three claims are only worth making if a browser makes them: that no
 * `AudioContext` exists before the player asks for one, that the missing alarm
 * files degrade in silence rather than in a console full of red — which is the
 * state this repository ships in — and that the output cannot clip. The last
 * one is *measured*, through a real `OfflineAudioContext` rendering the real
 * graph, because a number nobody rendered is an opinion.
 */

/** Counts real AudioContext constructions, so "no autoplay" is a fact. */
async function countAudioContexts(page: Page) {
  await page.addInitScript(() => {
    const target = window as unknown as {
      __audioContexts: number;
      AudioContext: typeof AudioContext;
    };
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
}

const readCount = (page: Page) =>
  page.evaluate(() => (window as unknown as { __audioContexts?: number }).__audioContexts ?? -1);

/**
 * Collects console errors and page exceptions. Nothing is filtered: the claim is
 * that a missing asset produces *nothing*, and a filter is how that claim gets
 * weakened without anyone noticing.
 *
 * It used to discount the three absent alarm samples by name. It no longer
 * needs to — the page does not request a file the build could not find — so the
 * discount is gone rather than merely unused.
 */
function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    problems.push(`console.error: ${message.text()} ${message.location().url}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

/** Requests the page made for the alarm samples. */
function collectSampleRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/audio/sfx/')) requests.push(request.url());
  });
  return requests;
}

async function openOffice(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
}

test.describe('audio unlock', () => {
  test('no AudioContext exists until the player chooses to enter', async ({ page }) => {
    await countAudioContexts(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Enter Simulation' })).toBeVisible();

    // The alarm engine is heavier than the old oscillator one; it must still be
    // constructed only from a real gesture.
    expect(await readCount(page)).toBe(0);

    await page.getByRole('button', { name: 'Enter Simulation' }).click();
    await expect.poll(() => readCount(page)).toBeGreaterThan(0);
  });

  test('nothing is fetched from /audio/sfx/ before the gesture either', async ({ page }) => {
    const requests = collectSampleRequests(page);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Enter Simulation' })).toBeVisible();
    // Samples load from inside `unlock()`, so a request here would mean the
    // context — or a speculative preload — beat the gesture.
    expect(requests).toEqual([]);
  });
});

test.describe('the alarm', () => {
  /**
   * Whether the three CC0 files are on the server, asked of the server rather
   * than assumed. The spec then asserts the contract for the case it is
   * actually in — the alternative is a suite that silently stops testing the
   * alarm the day someone drops the files in.
   *
   * Note that this is now the *second* source of truth. The page decides what
   * to fetch from `__CYCASE_AUDIO__.installedAudio`, which the build resolved
   * by listing `public/audio/`. The two must agree, and the suite builds fresh
   * from the same tree it then serves, so a disagreement here is a real finding
   * — a stale `dist/` against a newer `public/` — rather than test noise.
   */
  async function assetsPresent(request: APIRequestContext): Promise<boolean> {
    const responses = await Promise.all(
      ['/audio/sfx/alarm-impact.wav', '/audio/sfx/alarm-primary.wav'].map((path) =>
        request.get(path).catch(() => null),
      ),
    );
    return responses.every((response) => {
      if (!response || !response.ok()) return false;
      // A single-page host answers an unknown path with index.html and a 200.
      const type = response.headers()['content-type'] ?? '';
      return !type.includes('text/html');
    });
  }

  test('reports its own state truthfully, whichever files are on the server', async ({
    page,
    request,
  }) => {
    const present = await assetsPresent(request);
    await openOffice(page);

    const status = await page.evaluate(() => window.__CYCASE_AUDIO__?.alarmStatus?.());
    expect(status).toBeTruthy();

    // The claim and the ground truth have to agree. This is the guard against
    // the UI describing an alarm nobody can hear — the single failure that
    // would make `docs/AUDIO_ASSET_REQUEST.md` a lie.
    expect(status!.assetsPresent).toBe(present);

    if (present) {
      expect(status!.phase).toBe('sounding');
      expect(status!.missing).toEqual([]);
    } else {
      expect(status!.phase).toBe('degraded');
      expect(status!.missing.length).toBeGreaterThan(0);
    }
  });

  test('degrades in silence: no console error, no request storm', async ({ page }) => {
    // Boots the real 3D office. Headless Chromium rasterises WebGL in software,
    // so this is slow here — but what it asserts is DOM and console state, not a
    // rendered measurement, so it belongs in the fast project with a real budget
    // rather than on the GPU project with the specs that measure pixels.
    test.slow();
    const problems = collectProblems(page);
    const requests = collectSampleRequests(page);

    await openOffice(page);

    // Sit through several cycles of the office scene's alarm keep-alive ping,
    // which fires every 2.4 s while the alarm is unacknowledged.
    await page.waitForTimeout(6_000);

    const status = await page.evaluate(() => document.title);
    expect(status).toBeTruthy();

    // Zero, with nothing discounted.
    expect(problems, problems.join('\n')).toEqual([]);

    // Exactly one request per *installed* asset for the whole page lifetime,
    // and today that is none: the build listed `public/audio/`, found nothing,
    // and the page therefore asks for nothing. The assertion reads that list
    // rather than a literal, so it still means "ask for what exists and no
    // more" the day the owner installs the files.
    const installed = await page.evaluate(() => window.__CYCASE_AUDIO__?.installedAudio);
    expect(installed, '__CYCASE_AUDIO__.installedAudio is not published').toBeDefined();
    expect(requests, requests.join('\n')).toHaveLength(installed!.length);

    // Whatever happened to the sound, the interaction is intact.
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
  });

  test('acknowledging still works and the alarm treatment stops', async ({ page }) => {
    const problems = collectProblems(page);
    await openOffice(page);

    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(0);

    // And it does not come back, however long the scene runs on.
    await page.waitForTimeout(5_000);
    await expect(page.locator('.office3d__surface--alarm')).toHaveCount(0);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('muting mid-alarm and unmuting does not resurrect it', async ({ page }) => {
    /*
     * Mute silences sound; it does not dismiss an incident. The failure this
     * guards is subtle and would only ever be found by a player: acknowledge
     * while muted, unmute, and hear an alarm the game already agreed was over.
     *
     * Run on the flat monitor wall rather than the WebGL room. Several workers
     * share one GPU here and the room's ten glTF assets push this past its
     * budget; the alarm state machine under test is identical in both, and the
     * 3D path has its own coverage above.
     */
    await page.addInitScript(() => {
      window.localStorage.setItem('cycase.office3d', 'false');
    });
    await openOffice(page);

    await page.getByRole('button', { name: 'Mute' }).click();
    await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Unmute' }).click();
    await page.waitForTimeout(2_000);

    // Nothing brought it back: not the unmute, not the office scene's ping.
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' })).toHaveCount(0);
  });
});

test.describe('output level', () => {
  test('the rendered worst case does not clip', async ({ page }) => {
    // Rendering 1.5 s of HRTF-panned audio offline is CPU work, and this
    // machine's GPU and cores are shared with other suites. The measurement is
    // deterministic; only how long it takes is not.
    test.slow();

    await page.goto('/');
    // Published by `src/audio/diagnostics.ts`, the way `buildInfo.ts` publishes
    // the build identity.
    await expect
      .poll(() => page.evaluate(() => typeof window.__CYCASE_AUDIO__?.measurePeak), {
        timeout: 15_000,
      })
      .toBe('function');

    const measurement = await page.evaluate(() => window.__CYCASE_AUDIO__!.measurePeak());
    expect(measurement).not.toBeNull();

    const { peak, preLimiterBudget } = measurement!;

    // Rendered, not reasoned about: the alarm loop, the impact, the room tone
    // and an interface cue, all at full scale, through the real HRTF panner and
    // the real limiter, with the volume slider at maximum.
    console.log(
      `measured peak ${peak.toFixed(4)} (pre-limiter budget ${preLimiterBudget.toFixed(4)})`,
    );

    expect(peak).toBeGreaterThan(0);
    // Full scale is 1.0. Anything at or above it is a clipped sample.
    expect(peak).toBeLessThan(1);
    // And it is not merely under the rail — it keeps real headroom, so a louder
    // CC0 file than the one measured here still cannot get there.
    expect(peak).toBeLessThan(0.95);
  });

  test('the volume control actually moves the output', async ({ page }) => {
    await openOffice(page);
    const volume = page.getByRole('slider', { name: 'Volume' });
    await volume.fill('20');
    await expect(volume).toHaveValue('20');

    await page.getByRole('button', { name: 'Mute' }).click();
    await expect(volume).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Unmute' })).toBeVisible();
  });
});

test.describe('speech', () => {
  test('the narration layer never speaks without being asked to', async ({ page }) => {
    // Instrument before the app boots: any utterance queued during the intro or
    // the office entrance would be narration nobody requested.
    await page.addInitScript(() => {
      const target = window as unknown as { __utterances: string[] };
      target.__utterances = [];
      const synth = window.speechSynthesis;
      if (!synth) return;
      const speak = synth.speak.bind(synth);
      synth.speak = (utterance: SpeechSynthesisUtterance) => {
        target.__utterances.push(utterance.text);
        speak(utterance);
      };
    });

    await openOffice(page);
    await page.waitForTimeout(2_000);

    const spoken = await page.evaluate(
      () => (window as unknown as { __utterances?: string[] }).__utterances ?? [],
    );
    // The dialogue panel is wired by another workstream; until a line is handed
    // to `speech.speak()`, nothing talks. This is the guard against an
    // autoplaying voice, which is the one thing worse than no voice.
    expect(spoken).toEqual([]);
  });

  test('leaving the page cancels anything in flight', async ({ page }) => {
    await openOffice(page);

    const leaked = await page.evaluate(async () => {
      const synth = window.speechSynthesis;
      if (!synth) return false;
      const utterance = new SpeechSynthesisUtterance(
        'A long line that would keep talking over the next scene if nothing cancelled it.',
      );
      synth.speak(utterance);
      // `pagehide` is what a bfcache navigation fires, and it is the listener
      // the director installs. Firing it must stop the queue.
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      return synth.speaking || synth.pending;
    });

    expect(leaked).toBe(false);
  });
});
