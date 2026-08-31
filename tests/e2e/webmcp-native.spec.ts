import { expect, test, type Page } from '@playwright/test';

import { collectPageProblems, PERFECT_RUN } from './helpers';

/**
 * Native WebMCP — the installed Chrome, no shim.
 *
 * `docs/CODEX_WEBMCP_INTEGRATION.md` §13 is explicit that the shim suite is necessary
 * and not sufficient: a page that both defines and satisfies its own `modelContext` has
 * proven nothing about the real browser API. Every assertion here runs against
 * `document.modelContext` as Chrome exposes it.
 *
 * Verified against Google Chrome 151.0.7922.171 with
 * `--enable-features=WebMachineLearningModelContext,WebMCP`. Headed, because the API is
 * not exposed to headless Chrome.
 *
 * If the installed browser lacks WebMCP the whole file skips with a stated reason
 * rather than passing vacuously — a green tick for an API that was never present is
 * exactly the false proof this file exists to prevent.
 */

const TOOL_NAMES = [
  'get_incident',
  'inspect_artifact',
  'run_diagnostic',
  'take_response_action',
  'submit_decision',
  'request_hint',
  // The seventh tool: live narration. Registered through the same generic loop
  // as the other six, so if the browser accepts them it must accept this one.
  'present_guidance',
];

interface NativeToolResult {
  ok: boolean;
  stateVersion: number;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; recovery?: string };
}

async function nativeSupported(page: Page): Promise<boolean> {
  return page.evaluate(() => typeof document.modelContext?.registerTool === 'function');
}

/** Reads the tool list the way the agent surface does. */
async function listTools(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const tools = (await document.modelContext!.getTools!()) ?? [];
    return tools.map((tool) => tool.name).sort();
  });
}

/**
 * Invokes through the browser's own `executeTool` — not through our page code.
 *
 * Two divergences from the shim, both found by running this against real Chrome:
 *   1. it takes the RegisteredTool object `getTools()` returned, not a name
 *      string — a name raises "The provided value is not of type 'RegisteredTool'";
 *   2. arguments arrive as a JSON **string**, not an object — an object raises
 *      "Failed to parse input arguments";
 *   3. the *result* comes back serialised too, so the envelope needs parsing
 *      before the tool's own JSON payload inside `content[0].text` does.
 *      `inputSchema` is serialised for the same reason.
 * Neither could ever surface in a shim suite, because a shim implements
 * whatever signature its own test assumes. This is why §13 of the integration
 * contract calls the shim necessary and not sufficient.
 */
async function callNative(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<NativeToolResult> {
  return page.evaluate(
    async ({ name, input }) => {
      const tools = (await document.modelContext!.getTools!()) ?? [];
      const tool = tools.find((candidate) => candidate.name === name);
      if (!tool) throw new Error(`tool ${name} is not registered`);
      const raw = await document.modelContext!.executeTool!(tool, JSON.stringify(input));
      const envelope = (typeof raw === 'string' ? JSON.parse(raw) : raw) as {
        content?: Array<{ text?: string }>;
      };
      return JSON.parse(envelope?.content?.[0]?.text ?? '{}') as NativeToolResult;
    },
    { name, input },
  );
}

async function openOfficeThenDashboard(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('cycase.office3d', 'false');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  await page.getByRole('button', { name: 'Skip intro' }).click();
  await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();
}

test.describe('native WebMCP in installed Chrome', () => {
  test.slow();

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    if (!(await nativeSupported(page))) {
      test.skip(
        true,
        'Installed Chrome does not expose document.modelContext.registerTool. Relaunch with --enable-features=WebMachineLearningModelContext,WebMCP or use a channel that ships WebMCP.',
      );
    }
  });

  test('the browser exposes the real API surface, not our shim', async ({ page }) => {
    await openOfficeThenDashboard(page);

    const surface = await page.evaluate(() => ({
      register: typeof document.modelContext?.registerTool,
      getTools: typeof document.modelContext?.getTools,
      executeTool: typeof document.modelContext?.executeTool,
      // A shim installed by the page would be a plain object literal; the real
      // API lives on a prototype provided by the browser.
      prototypeMethods: Object.keys(
        Object.getPrototypeOf(document.modelContext!) as object,
      ).sort(),
    }));

    expect(surface.register).toBe('function');
    expect(surface.getTools).toBe('function');
    expect(surface.executeTool).toBe('function');
    expect(surface.prototypeMethods).toContain('registerTool');
    expect(surface.prototypeMethods).toContain('executeTool');
  });

  test('discovery returns exactly the seven contract tools', async ({ page }) => {
    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toEqual([...TOOL_NAMES].sort());
  });

  test('narration is registered natively and cannot move the case', async ({ page }) => {
    /*
     * The shim suite cannot prove this. A page that both defines and satisfies
     * its own `modelContext` will accept any descriptor it is handed — so
     * "Chrome accepted the seventh tool" is a claim only real Chrome can settle,
     * and the inertness of narration is worth re-checking on the path the
     * product actually ships on.
     */
    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);

    const before = await callNative(page, 'get_incident', {});
    expect(before.stateVersion).toBe(0);

    const spoken = await callNative(page, 'present_guidance', {
      basedOnStateVersion: 0,
      idempotencyKey: 'native-line-1',
      tone: 'teaching',
      language: 'en',
      message: 'Start with the reported message itself — the headers decide this case.',
    });

    expect(spoken.ok, `narration was refused: ${JSON.stringify(spoken.error)}`).toBe(true);
    expect(spoken.stateVersion).toBe(0);
    expect(spoken.data?.affectsState).toBe(false);
    expect(spoken.data?.narrativeSequence).toBe(1);
    await expect(page.locator('#state-version')).toContainText('v0');

    // A hostile line, through the browser's own executeTool, is refused with a
    // recovery path and still moves nothing.
    const refused = await callNative(page, 'present_guidance', {
      basedOnStateVersion: 0,
      idempotencyKey: 'native-line-2',
      tone: 'warning',
      language: 'en',
      message: '<script>alert(1)</script>',
    });
    expect(refused.ok).toBe(false);
    expect(refused.error?.code).toBe('INVALID_INPUT');
    expect(refused.error?.recovery?.length ?? 0).toBeGreaterThan(20);
    await expect(page.locator('#state-version')).toContainText('v0');
  });

  test('every descriptor has a narrow, closed input schema', async ({ page }) => {
    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);

    const descriptors = await page.evaluate(async () => {
      const tools = (await document.modelContext!.getTools!()) ?? [];
      return tools.map((tool) => ({
        name: tool.name,
        hasDescription: Boolean(tool.description && tool.description.length > 20),
        // Chrome returns the schema already serialised; stringifying again
        // would double-encode it.
        schema:
          typeof tool.inputSchema === 'string'
            ? tool.inputSchema
            : JSON.stringify(tool.inputSchema ?? null),
      }));
    });

    for (const descriptor of descriptors) {
      expect(descriptor.hasDescription, `${descriptor.name} needs a real description`).toBe(true);
      // §12 of the integration contract: inputs stay narrow and closed.
      expect(descriptor.schema, `${descriptor.name} must close its schema`).toContain(
        '"additionalProperties":false',
      );
    }
  });

  test('a native read call returns parseable structured domain state', async ({ page }) => {
    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);

    const result = await callNative(page, 'get_incident', {});
    expect(result.ok).toBe(true);
    expect(typeof result.stateVersion).toBe('number');
    expect(JSON.stringify(result.data)).toContain('INC-74219');
  });

  test('a native mutation changes the visible state exactly once', async ({ page }) => {
    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);

    const before = await callNative(page, 'get_incident', {});
    expect(before.stateVersion).toBe(0);

    const applied = await callNative(page, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
      stateVersion: before.stateVersion,
      idempotencyKey: 'native-d1-once',
    });
    expect(applied.ok).toBe(true);
    expect(applied.stateVersion).toBe(1);

    // The human-visible dashboard must reflect the agent's mutation.
    await expect(page.locator('#decision-D1')).toContainText('Preserve the reported message');
    await expect(page.locator('#state-version')).toContainText('v1');

    // Replaying the same intent must not apply twice.
    const replayed = await callNative(page, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
      stateVersion: before.stateVersion,
      idempotencyKey: 'native-d1-once',
    });
    expect(replayed.stateVersion).toBe(1);
    await expect(page.locator('#state-version')).toContainText('v1');
  });

  test('a stale state version is refused natively with a recovery path', async ({ page }) => {
    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);

    await callNative(page, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
      stateVersion: 0,
      idempotencyKey: 'native-stale-setup',
    });

    const stale = await callNative(page, 'run_diagnostic', {
      diagnosticId: 'auth_timeline',
      stateVersion: 0,
    });
    expect(stale.ok).toBe(false);
    expect(stale.error?.code).toBe('STALE_STATE');
    expect(stale.error?.recovery, 'a refusal must tell the agent how to recover').toBeTruthy();
  });

  test('every native call is attributed to the agent in the visible activity log', async ({
    page,
  }) => {
    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);

    await callNative(page, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
      stateVersion: 0,
      idempotencyKey: 'native-attribution',
    });

    const activity = page.locator('#rail-activity');
    await expect(activity).toContainText('Agent');
    await expect(activity).toContainText(/submit_decision|Decision/i);
  });

  test('a reload leaves exactly seven registrations, not duplicates', async ({ page }) => {
    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);

    await page.reload();
    await page.getByRole('button', { name: 'Skip intro' }).first().click();
    await page.getByRole('button', { name: 'Skip intro' }).click();
    await expect(page.locator('.topbar__context', { hasText: /Session Ghost/ })).toBeVisible();

    // React Strict Mode mounts twice in development; a leaked registration would
    // show up here as a duplicated name.
    const names = await listTools(page);
    expect(names).toHaveLength(7);
    expect(new Set(names).size).toBe(7);
  });

  test('the complete case can be driven natively to the deterministic contained ending', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);

    let version = 0;
    let key = 0;
    const call = async (name: string, input: Record<string, unknown>) => {
      const mutating = name !== 'get_incident' && name !== 'request_hint';
      key += 1;
      const result = await callNative(page, name, {
        ...input,
        stateVersion: version,
        ...(mutating ? { idempotencyKey: `native-run-${key}` } : {}),
      });
      expect(result.ok, `${name} failed: ${JSON.stringify(result.error)}`).toBe(true);
      version = result.stateVersion;
      return result;
    };

    // The canonical sequence lives in helpers.ts as PERFECT_RUN — the same one the
    // shim suite drives — so the native run cannot drift into its own private idea
    // of the golden path.
    for (const step of PERFECT_RUN) {
      await call(step.tool, step.input);
    }

    // The agent-driven run must land on the same deterministic result as the
    // human-driven run in manual.spec.ts.
    await expect(page.getByRole('heading', { level: 1, name: 'Debrief' })).toBeVisible();
    await expect(page.locator('#debrief-outcome')).toContainText('Contained');
    await expect(page.locator('#debrief-outcome')).toContainText('100/100');
  });

  test('the native run produces no console, page or network errors', async ({ page }) => {
    // The three missing alarm samples are discounted by name in the helper; a
    // fourth console error or failed request still fails this test.
    const { errors, pageErrors, failed } = collectPageProblems(page);

    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);
    await callNative(page, 'get_incident', {});
    await callNative(page, 'submit_decision', {
      decisionId: 'D1',
      optionId: 'D1_preserve_and_inspect',
      stateVersion: 0,
      idempotencyKey: 'native-clean',
    });

    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    expect(errors, errors.join('\n')).toEqual([]);
    expect(failed, failed.join('\n')).toEqual([]);
  });

  test('no third-party network request leaves the page', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (request) => {
      const url = request.url();
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost') && !url.startsWith('data:') && !url.startsWith('blob:')) {
        external.push(url);
      }
    });

    await openOfficeThenDashboard(page);
    await expect.poll(() => listTools(page), { timeout: 15_000 }).toHaveLength(7);
    await callNative(page, 'get_incident', {});

    expect(external, `unexpected third-party requests:\n${external.join('\n')}`).toEqual([]);
  });
});
