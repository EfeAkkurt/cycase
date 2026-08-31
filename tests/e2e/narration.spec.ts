import { expect, test, type Page } from '@playwright/test';

import { installModelContext, openDashboard, PERFECT_RUN } from './helpers';

/**
 * Dynamic narration, proven the way the audit demands it.
 *
 * The finding that produced this file: `present_guidance` returned `ok: true`,
 * appended to `narrativeLog`, and the player saw nothing. The test that existed
 * — "the narrative log survives the office round trip" — only proved the log
 * could be read back through `get_incident`. It asserted a data structure and
 * was taken as evidence of a feature.
 *
 * So nothing here inspects the log. Every assertion is about what a player can
 * see on screen or what the speech engine was actually asked to say. A
 * `speechSynthesis` recorder is installed before the app boots and counts real
 * `speak()` calls with their text.
 */

/** Records every utterance, and reports a voice so the speaking path is live. */
const SPEECH_RECORDER = `
window.__spoken = [];
(() => {
  const voices = [{
    name: 'CYCASE Test Voice', lang: 'en-US', voiceURI: 'cycase-test',
    localService: true, default: true,
  }];
  const synth = {
    speaking: false, pending: false, paused: false,
    getVoices: () => voices,
    speak(utterance) {
      window.__spoken.push({ text: utterance.text, at: Date.now() });
      synth.speaking = true;
      // Resolve on a later task so 'speaking' is observable in between.
      setTimeout(() => {
        synth.speaking = false;
        utterance.onend?.(new Event('end'));
      }, 60);
    },
    cancel() { synth.speaking = false; window.__cancelled = (window.__cancelled ?? 0) + 1; },
    pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
    onvoiceschanged: null,
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text; this.lang = 'en-US'; this.voice = null;
    this.rate = 1; this.pitch = 1; this.volume = 1;
    this.onend = null; this.onerror = null; this.onstart = null;
  };
})();
`;

interface Spoken {
  text: string;
}

async function spoken(page: Page): Promise<Spoken[]> {
  return page.evaluate(() => (window as unknown as { __spoken: Spoken[] }).__spoken ?? []);
}

/** Calls present_guidance through the public tool surface, as an agent would. */
async function narrate(
  page: Page,
  message: string,
  options: {
    key?: string;
    speaker?: string;
    tone?: string;
    stateVersion?: number;
  } = {},
): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ message, options }) => {
      const tools = (await document.modelContext!.getTools!()) ?? [];
      const tool = tools.find((candidate) => candidate.name === 'present_guidance');
      if (!tool) throw new Error('present_guidance is not registered');
      const raw = await document.modelContext!.executeTool!(
        tool,
        JSON.stringify({
          basedOnStateVersion: options.stateVersion ?? 0,
          idempotencyKey: options.key ?? `n-${Math.round(performance.now() * 1000)}`,
          tone: options.tone ?? 'urgent',
          language: 'en',
          message,
        }),
      );
      const envelope = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
        content?: Array<{ text?: string }>;
      };
      return JSON.parse(envelope?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
    },
    { message, options },
  );
}

async function openOfficeWithSpeech(page: Page) {
  await page.addInitScript(SPEECH_RECORDER);
  await installModelContext(page);
  await page.addInitScript(() => window.localStorage.setItem('cycase.office3d', 'false'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();
}

async function openDashboardWithSpeech(page: Page) {
  await page.addInitScript(SPEECH_RECORDER);
  await installModelContext(page);
  await openDashboard(page);
}

const LINE = 'We have been unable to reach the identity servers for sixty minutes.';

test.describe('generated narration reaches the player', () => {
  test('the exact line appears in the office within 250 ms', async ({ page }) => {
    await openOfficeWithSpeech(page);

    /*
     * Measured the way the contract defines it: from the tool handler's promise
     * resolving to the caption being on screen. Measuring from outside the page
     * would fold in Playwright's own round trip and quietly inflate the number.
     */
    const measurement = await page.evaluate(async (line) => {
      const tools = (await document.modelContext!.getTools!()) ?? [];
      const tool = tools.find((candidate) => candidate.name === 'present_guidance');
      if (!tool) throw new Error('present_guidance is not registered');

      await document.modelContext!.executeTool!(
        tool,
        JSON.stringify({
          basedOnStateVersion: 0,
          idempotencyKey: 'latency',
          tone: 'urgent',
          language: 'en',
          message: line,
        }),
      );
      const handlerReturned = performance.now();

      await new Promise<void>((resolve) => {
        const check = () => {
          const node = document.querySelector('#rail-narration .narration__text');
          if (node?.textContent === line) resolve();
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
      return performance.now() - handlerReturned;
    }, LINE);

    console.log(`office caption visible ${measurement.toFixed(1)} ms after the handler returned`);
    expect(measurement).toBeLessThanOrEqual(250);

    await expect(page.locator('#rail-narration .narration__text')).toHaveText(LINE);
  });

  test('the exact line appears on the dashboard too', async ({ page }) => {
    await openDashboardWithSpeech(page);
    await narrate(page, LINE, { stateVersion: 0 });
    await expect(page.locator('#rail-narration .narration__text')).toHaveText(LINE, {
      timeout: 3000,
    });
  });

  test('speechSynthesis.speak is called exactly once for a new line', async ({ page }) => {
    await openOfficeWithSpeech(page);
    await narrate(page, LINE);
    await expect(page.locator('#rail-narration .narration__text')).toHaveText(LINE);

    await expect.poll(async () => (await spoken(page)).length, { timeout: 3000 }).toBe(1);
    expect((await spoken(page))[0]!.text).toBe(LINE);
  });

  test('a duplicate idempotency key does not requeue, respeak or relog', async ({ page }) => {
    await openOfficeWithSpeech(page);

    const first = await narrate(page, LINE, { key: 'same-key' });
    expect(first.ok).toBe(true);
    await expect(page.locator('#rail-narration .narration__text')).toHaveText(LINE);
    await expect.poll(async () => (await spoken(page)).length, { timeout: 3000 }).toBe(1);

    const second = await narrate(page, LINE, { key: 'same-key' });
    expect(second.ok).toBe(true);
    expect((second.data as Record<string, unknown>).duplicate).toBe(true);

    // Give a second utterance every chance to appear before asserting it did not.
    await page.waitForTimeout(1200);
    expect((await spoken(page)).length, 'a replayed key spoke again').toBe(1);
  });

  test('three rapid lines play in sequence with none lost', async ({ page }) => {
    await openOfficeWithSpeech(page);

    const lines = ['First line about the session.', 'Second line about the endpoint.', 'Third line about the sweep.'];
    for (const [index, line] of lines.entries()) {
      await narrate(page, line, { key: `seq-${index}` });
    }

    // Each is spoken, in order, exactly once.
    await expect.poll(async () => (await spoken(page)).length, { timeout: 15_000 }).toBe(3);
    expect((await spoken(page)).map((entry) => entry.text)).toEqual(lines);

    // And each becomes the visible caption in turn.
    await expect
      .poll(
        async () => page.locator('#rail-narration .narration__text').textContent(),
        { timeout: 15_000 },
      )
      .toBe(lines[2]);
  });

  test('a line written after the channel has fallen quiet is shown and spoken', async ({
    page,
  }) => {
    /*
     * The gap between the two calls is the whole test.
     *
     * "Three rapid lines" above proves the queue drains, and it passed
     * throughout a run-ending deadlock: it writes all three lines inside the
     * first one's hold, so the channel was never asked to release itself
     * against an empty queue. That was the broken case — the hold expired with
     * nothing waiting, `active` was left set with no timer to clear it, and
     * every later line was accepted, logged and silently parked in `pending`.
     * An agent narrating a case at a human pace — a sentence, the player acts,
     * another sentence — got exactly one line per run.
     *
     * So this waits out the real hold before writing the second line. Both
     * messages are 51 characters, short enough that the hold is `MIN_HOLD_MS`
     * (2600 ms) rather than a reading-pace one, and 3500 clears it.
     */
    await openOfficeWithSpeech(page);

    const FIRST = 'The first line, said while nothing else is waiting.';
    const SECOND = 'The second line, said after the channel fell quiet.';

    await narrate(page, FIRST, { key: 'spaced-1' });
    await expect(page.locator('#rail-narration .narration__text')).toHaveText(FIRST);
    await expect.poll(async () => (await spoken(page)).length, { timeout: 3000 }).toBe(1);

    await page.waitForTimeout(3500);

    const receipt = (await narrate(page, SECOND, { key: 'spaced-2' })).data as Record<
      string,
      unknown
    >;

    // Seen...
    await expect(page.locator('#rail-narration .narration__text')).toHaveText(SECOND, {
      timeout: 5000,
    });
    // ...and heard. Both lines, in the order they were written, once each.
    await expect
      .poll(async () => (await spoken(page)).map((utterance) => utterance.text), { timeout: 5000 })
      .toEqual([FIRST, SECOND]);

    // The receipt agrees, which is the same fact from the agent's side: nothing
    // was ahead of this line, so it was not queued behind anything.
    expect(receipt.delivery, 'the second line was reported as stuck in a queue').toBe('spoken');
    expect(receipt.queueDepth).toBe(0);
  });

  test('the receipt carries the contract fields', async ({ page }) => {
    await openOfficeWithSpeech(page);
    const result = await narrate(page, LINE, { key: 'receipt' });
    const data = result.data as Record<string, unknown>;

    expect(data.accepted).toBe(true);
    expect(typeof data.narrativeSequence).toBe('number');
    expect(data.stateVersion).toBe(0);
    expect(data.duplicate).toBe(false);
    expect(String(data.nextStep).length).toBeGreaterThan(10);

    /*
     * Values, not types.
     *
     * This test used to assert that `delivery` was one of three strings and
     * that `queueDepth` was a number, which every wrong answer also satisfies —
     * and one was being given. The receipt read the narration channel straight
     * after the engine returned, before the driver had ingested the new line,
     * so it described the previous one: the first line of a run reported
     * `caption_only` with depth 0 while it was on its way to being spoken.
     *
     * This is the first line, voice is on, and nothing is ahead of it.
     */
    expect(data.delivery, 'the first line is not queued behind anything').toBe('spoken');
    expect(data.queueDepth, 'nothing is waiting behind the only line').toBe(0);
  });

  test('the receipt describes the line just accepted, not the one before it', async ({ page }) => {
    /*
     * All three calls land inside the first line's 2600 ms hold, and that is
     * now the only reason the second and third report themselves queued. It
     * used to be true for a second reason as well — the channel could deadlock
     * with `active` stuck, refusing everything — and that reason is gone, so
     * the three calls must stay back to back. Putting a wait between them would
     * not weaken this test, it would test something else entirely: the released
     * channel, which is the spaced-lines test above.
     */
    await openOfficeWithSpeech(page);

    // First line takes the channel and is read.
    const first = (await narrate(page, LINE, { key: 'depth-1' })).data as Record<string, unknown>;
    expect(first.delivery).toBe('spoken');
    expect(first.queueDepth).toBe(0);

    // The second cannot be spoken yet — the first is holding the channel — so
    // it must report itself queued, and the depth must count it.
    const second = (await narrate(page, 'A second line, written immediately after.', {
      key: 'depth-2',
    })).data as Record<string, unknown>;
    expect(second.delivery, 'a line behind another is not being spoken').toBe('queued');
    expect(second.queueDepth, 'the queue depth must count the line just accepted').toBe(1);

    const third = (await narrate(page, 'A third line, also immediate.', { key: 'depth-3' }))
      .data as Record<string, unknown>;
    expect(third.delivery).toBe('queued');
    expect(third.queueDepth).toBe(2);

    // Sequences are distinct and ascending, so none of the three replaced another.
    const sequences = [first, second, third].map((d) => d.narrativeSequence as number);
    expect(new Set(sequences).size).toBe(3);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
  });

  test('with the voice off the receipt says caption_only, not spoken', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cycase.speech_muted', 'true'));
    await openOfficeWithSpeech(page);

    const data = (await narrate(page, LINE, { key: 'muted-receipt' })).data as Record<
      string,
      unknown
    >;
    expect(data.delivery).toBe('caption_only');
    expect(data.queueDepth).toBe(0);
  });

  test('narration never moves the game', async ({ page }) => {
    await openDashboardWithSpeech(page);

    const before = await page.locator('#state-version').innerText();
    await narrate(page, 'Nothing about this line may change the case.', { key: 'inert' });
    await expect(page.locator('#rail-narration .narration__text')).toBeVisible();

    expect(await page.locator('#state-version').innerText()).toBe(before);
    // The guided path is still asking for the same thing it was.
    await expect(page.locator('#next-step-title')).toBeVisible();
  });
});

test.describe('narration controls', () => {
  test('Stop voice silences speech and keeps the full caption', async ({ page }) => {
    await openOfficeWithSpeech(page);
    await narrate(page, LINE, { key: 'stop-1' });
    await expect(page.locator('#rail-narration .narration__text')).toHaveText(LINE);
    await expect.poll(async () => (await spoken(page)).length, { timeout: 3000 }).toBe(1);

    await page.locator('#narration-stop-voice').click();
    await narrate(page, 'A second line that must be read but not spoken.', { key: 'stop-2' });

    // Caption still complete...
    await expect(page.locator('#rail-narration .narration__text')).toHaveText(
      'A second line that must be read but not spoken.',
      { timeout: 15_000 },
    );
    // ...and nothing new was spoken.
    expect((await spoken(page)).length).toBe(1);
  });

  test('Repeat re-speaks the active line', async ({ page }) => {
    await openOfficeWithSpeech(page);
    await narrate(page, LINE, { key: 'rep' });
    await expect.poll(async () => (await spoken(page)).length, { timeout: 3000 }).toBe(1);

    await page.locator('#narration-repeat').click();
    await expect.poll(async () => (await spoken(page)).length, { timeout: 3000 }).toBe(2);
    expect((await spoken(page))[1]!.text).toBe(LINE);
  });

  test('every control is reachable and operable by keyboard alone', async ({ page }) => {
    await openOfficeWithSpeech(page);
    await narrate(page, LINE, { key: 'kbd' });
    await expect(page.locator('#rail-narration .narration__text')).toHaveText(LINE);

    const stop = page.locator('#narration-stop-voice');
    await stop.focus();
    await expect(stop).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(stop).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#narration-skip').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#rail-narration')).toHaveCount(0);
  });

  test('a browser with no speech engine still shows the caption', async ({ page }) => {
    // No recorder, and no speechSynthesis at all.
    await page.addInitScript(() => {
      Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: undefined });
    });
    await installModelContext(page);
    await page.addInitScript(() => window.localStorage.setItem('cycase.office3d', 'false'));
    await page.goto('/');
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();

    await narrate(page, LINE, { key: 'nospeech' });
    await expect(page.locator('#rail-narration .narration__text')).toHaveText(LINE, {
      timeout: 3000,
    });
  });
});

test.describe('narration is untrusted text', () => {
  const HOSTILE = [
    { name: 'a script tag', message: '<script>window.__pwned = 1</script> read this' },
    { name: 'an image error handler', message: '<img src=x onerror="window.__pwned=1"> read this' },
  ];

  for (const attack of HOSTILE) {
    test(`refuses or neutralises ${attack.name} — nothing executes, nothing renders`, async ({
      page,
    }) => {
      await openOfficeWithSpeech(page);
      await narrate(page, attack.message, { key: `hostile-${attack.name}` });

      // Whether the engine refused it or stripped it, the invariant is the same:
      // no script ran, and no element was created from the payload.
      expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
        undefined,
      );
      expect(await page.locator('#rail-narration script').count()).toBe(0);
      expect(await page.locator('#rail-narration img').count()).toBe(0);
    });
  }
});

/**
 * Two rules the contract states separately but which only hold together.
 *
 * "Stale generated narration must not replace a newer state's instruction" and
 * "the fixed i18n line is the fallback only when no generated line exists for
 * the current beat" pull in opposite directions: the second silences the
 * deterministic instruction whenever the agent is speaking, which is only safe
 * because the first guarantees the agent's line is about the beat on screen.
 * Tested here as one pair, because passing either alone is not the requirement.
 */
test.describe('generated narration yields to the case', () => {
  /** Advances the domain state the way a player's decision does. */
  async function decideThroughTools(page: Page, stateVersion: number): Promise<void> {
    const result = await page.evaluate(
      async ({ stateVersion }) => {
        const tools = (await document.modelContext!.getTools!()) ?? [];
        const tool = tools.find((candidate) => candidate.name === 'submit_decision');
        if (!tool) throw new Error('submit_decision is not registered');
        const raw = await document.modelContext!.executeTool!(
          tool,
          JSON.stringify({
            decisionId: 'D1',
            optionId: 'D1_preserve_and_inspect',
            stateVersion,
            idempotencyKey: `stale-${stateVersion}`,
          }),
        );
        const envelope = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
          content?: Array<{ text?: string }>;
        };
        return JSON.parse(envelope?.content?.[0]?.text ?? '{}') as Record<string, unknown>;
      },
      { stateVersion },
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  }

  test('a line is retired when the case moves past the state it was written about', async ({
    page,
  }) => {
    await openDashboardWithSpeech(page);

    await narrate(page, LINE, { stateVersion: 0, key: 'stale-active' });
    await expect(page.locator('#rail-narration')).toContainText(LINE);

    // The player decides. Everything the agent said about the previous state is
    // now describing a case that no longer exists.
    await decideThroughTools(page, 0);

    await expect(page.locator('#rail-narration')).toBeHidden();
  });

  test('a queued line overtaken before it is shown never surfaces', async ({ page }) => {
    await openDashboardWithSpeech(page);

    // Three at once: the first takes the channel, two wait behind it.
    await narrate(page, 'First line about the opening state.', { stateVersion: 0, key: 'q1' });
    await narrate(page, 'Second line about the opening state.', { stateVersion: 0, key: 'q2' });
    await narrate(page, 'Third line about the opening state.', { stateVersion: 0, key: 'q3' });
    await expect(page.locator('#rail-narration')).toContainText('First line');

    await decideThroughTools(page, 0);

    // Long enough that the hold on the first line would have released the queue.
    await page.waitForTimeout(3200);
    await expect(page.locator('#rail-narration')).toBeHidden();
  });

  test('a line about the current state survives an unrelated re-render', async ({ page }) => {
    await openDashboardWithSpeech(page);
    await decideThroughTools(page, 0);

    // Written about where the case actually is now, so it must hold.
    await narrate(page, LINE, { stateVersion: 1, key: 'current' });
    await expect(page.locator('#rail-narration')).toContainText(LINE);

    await page.waitForTimeout(1200);
    await expect(page.locator('#rail-narration')).toContainText(LINE);
  });

  test('the fixed line stands down while the agent is speaking, and returns after', async ({
    page,
  }) => {
    await openOfficeWithSpeech(page);

    // The deterministic fallback, which is what a player with no agent sees.
    const fixed = page.locator('.dialogue__text');
    await expect(fixed).toBeVisible();
    const fallback = (await fixed.textContent())?.trim() ?? '';
    expect(fallback.length).toBeGreaterThan(0);

    await narrate(page, LINE, { stateVersion: 0, key: 'exclusive' });

    // One voice: the generated line replaces the fixed copy rather than
    // stacking two speakers in the same panel.
    await expect(page.locator('#rail-narration')).toContainText(LINE);
    await expect(fixed).toHaveCount(0);

    // The case is still playable throughout — narration is not a modal.
    await expect(page.getByRole('button', { name: 'Acknowledge alarm' }).first()).toBeVisible();

    // Skipping hands the beat back to the deterministic line.
    await page.locator('#narration-skip').click();
    await expect(page.locator('#rail-narration')).toBeHidden();
    await expect(page.locator('.dialogue__text')).toHaveText(fallback);
  });
});

/**
 * Rows the checklist could not close without a browser saying so.
 *
 * Each of these is cheap to fake in a review and impossible to fake here: the
 * caption's full text under reduced motion, the accessible announcement, and a
 * whole case completed with the voice off from the first line.
 */
test.describe('narration is complete without sound or motion', () => {
  test('the caption is announced as a live region and carries the whole sentence', async ({
    page,
  }) => {
    await openDashboardWithSpeech(page);
    await narrate(page, LINE, { stateVersion: 0, key: 'a11y' });

    const region = page.locator('#rail-narration');
    // Announced as a whole sentence rather than word-by-word: polite, not
    // assertive, so it never interrupts what the player is already reading.
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'polite');

    // The complete message, not a summary and not an ellipsis. Compared against
    // the string that was sent, so a CSS truncation would still pass here —
    // which is why the clientWidth check below is part of the same assertion.
    const caption = page.locator('.narration__text');
    await expect(caption).toHaveText(LINE);

    /*
     * The source reaches the ear, not only the eye.
     *
     * "Generated guidance" used to sit in the `aria-live="off"` head, so a
     * sighted player was told the line was written by an agent and a screen
     * reader user was told only the sentence. The label now shares one
     * `aria-atomic` wrapper with the caption, which is what pulls it into the
     * announcement — and the wrapper stops there, so the tone badge, the queue
     * counter and the three buttons stay out of it.
     */
    const announced = page.locator('#rail-narration .narration__caption');
    await expect(announced).toHaveAttribute('aria-atomic', 'true');
    await expect(announced).toContainText('Generated guidance');
    await expect(announced).toContainText(LINE);
    await expect(announced.locator('button')).toHaveCount(0);
    const clipped = await caption.evaluate(
      (element) => element.scrollHeight > element.clientHeight + 1,
    );
    expect(clipped, 'the caption is visually truncated').toBe(false);

    // Every control is a real button, so it is in the tab order by construction.
    for (const id of ['#narration-skip', '#narration-repeat', '#narration-stop-voice']) {
      await expect(page.locator(id)).toBeVisible();
    }
  });

  test('the whole case completes with the voice off from the first line', async ({ page }) => {
    // Off before boot, which is what a returning player who pressed Stop Voice
    // last time actually gets: the speech engine persists the choice, and it is
    // the same choice the settings toggle shows.
    await page.addInitScript(() => window.localStorage.setItem('cycase.speech_muted', 'true'));
    await openDashboardWithSpeech(page);

    await narrate(page, LINE, { stateVersion: 0, key: 'quiet-1' });
    // The caption is present and complete regardless — silence is never a
    // reason to show the player less.
    await expect(page.locator('.narration__text')).toHaveText(LINE);
    await expect(page.locator('#narration-stop-voice')).toHaveAttribute('aria-pressed', 'true');

    let version = 0;
    for (const [index, step] of PERFECT_RUN.entries()) {
      version = await page.evaluate(
        async ({ step, version }) => {
          const tools = (await document.modelContext!.getTools!()) ?? [];
          const tool = tools.find((candidate) => candidate.name === step.tool);
          if (!tool) throw new Error(`${step.tool} is not registered`);
          const raw = await document.modelContext!.executeTool!(
            tool,
            JSON.stringify({ ...step.input, stateVersion: version, idempotencyKey: `quiet-${version}` }),
          );
          const envelope = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
            content?: Array<{ text?: string }>;
          };
          const result = JSON.parse(envelope?.content?.[0]?.text ?? '{}') as {
            ok?: boolean;
            stateVersion?: number;
            error?: unknown;
          };
          if (!result.ok) throw new Error(`${step.tool}: ${JSON.stringify(result.error)}`);
          return result.stateVersion ?? version;
        },
        { step, version },
      );

      // Narrate alongside the run, as an agent would, with the voice still off.
      await narrate(page, `Step ${index + 1} of the response is recorded.`, {
        stateVersion: version,
        key: `quiet-line-${index}`,
      });
    }

    // The case reaches the same deterministic ending it reaches with sound on.
    await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible();
    await expect(page.locator('#debrief-outcome')).toContainText('Contained');
    await expect(page.locator('#debrief-outcome')).toContainText('100/100');

    // And nothing was ever spoken.
    expect(await spoken(page), 'something was spoken with the voice off').toEqual([]);
  });
});
