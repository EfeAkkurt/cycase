import { expect, type Page } from '@playwright/test';

/**
 * A fake `document.modelContext` installed before the app boots.
 *
 * It captures whatever the page registers and lets a test drive those tools the
 * way ChatGPT would — same descriptors, same execute functions, same JSON in and
 * out. That is what makes the agent path in these specs a real end-to-end test
 * rather than a mock of our own code.
 */
export const MODEL_CONTEXT_SHIM = `
window.__cycaseTools = new Map();
Object.defineProperty(document, 'modelContext', {
  configurable: true,
  value: {
    registerTool(descriptor, options) {
      window.__cycaseTools.set(descriptor.name, { descriptor, options });
      if (options && options.signal) {
        options.signal.addEventListener('abort', () => window.__cycaseTools.delete(descriptor.name));
      }
      return Promise.resolve();
    },
    getTools() {
      // Chrome serialises inputSchema. Match it, so a test written against the
      // shim cannot assume a shape the real browser does not hand back.
      return Promise.resolve(
        [...window.__cycaseTools.values()]
          .map((entry) => ({
            name: entry.descriptor.name,
            description: entry.descriptor.description,
            inputSchema: JSON.stringify(entry.descriptor.inputSchema),
            annotations: entry.descriptor.annotations,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    },
    /*
     * Chrome's real signature, verified against 151.0.7922.171 and copied here
     * deliberately: it takes the RegisteredTool object that getTools() returned,
     * not a name; arguments arrive as a JSON string, not an object; and the
     * result envelope comes back serialised. The shim previously implemented
     * none of this, which is exactly how three signature divergences survived
     * a green shim suite until the native project caught them.
     */
    async executeTool(tool, inputJson) {
      const name = typeof tool === 'string' ? tool : tool && tool.name;
      const entry = window.__cycaseTools.get(name);
      if (!entry) throw new TypeError("The provided value is not of type 'RegisteredTool'.");
      let input;
      try {
        input = typeof inputJson === 'string' ? JSON.parse(inputJson) : undefined;
      } catch {
        throw new Error('Failed to parse input arguments');
      }
      if (input === undefined) throw new Error('Failed to parse input arguments');
      const result = await entry.descriptor.execute(input);
      return JSON.stringify(result);
    },
    addEventListener() {},
    removeEventListener() {},
  },
});
`;

export interface ToolResult<T = unknown> {
  ok: boolean;
  stateVersion: number;
  data?: T;
  error?: { code: string; message: string; recovery?: string };
}

/** Installs the shim. Must run before any page script. */
export async function installModelContext(page: Page): Promise<void> {
  await page.addInitScript(MODEL_CONTEXT_SHIM);
}

/** Lists the tool descriptors the page actually registered. */
export async function listTools(page: Page): Promise<
  {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: Record<string, boolean>;
  }[]
> {
  return page.evaluate(() =>
    [...(window as never as { __cycaseTools: Map<string, { descriptor: never }> }).__cycaseTools.values()].map(
      (entry) => {
        const d = entry.descriptor as unknown as {
          name: string;
          description: string;
          inputSchema: Record<string, unknown>;
          annotations?: Record<string, boolean>;
        };
        return {
          name: d.name,
          description: d.description,
          inputSchema: d.inputSchema,
          annotations: d.annotations,
        };
      },
    ),
  );
}

/** Calls one registered tool exactly the way an agent would. */
export async function callTool<T = unknown>(
  page: Page,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolResult<T>> {
  const raw = await page.evaluate(
    async ([toolName, args]) => {
      const tools = (
        window as never as {
          __cycaseTools: Map<string, { descriptor: { execute: (i: unknown) => unknown } }>;
        }
      ).__cycaseTools;
      const entry = tools.get(toolName as string);
      if (!entry) throw new Error(`Tool not registered: ${toolName}`);
      const result = (await entry.descriptor.execute(args)) as {
        content: { type: string; text: string }[];
        isError?: boolean;
      };
      return result.content[0]?.text ?? '';
    },
    [name, input] as const,
  );

  return JSON.parse(raw) as ToolResult<T>;
}

/** Reads the live stateVersion straight off the dashboard chrome. */
export async function readStateVersion(page: Page): Promise<number> {
  // `innerText` is empty while System details is collapsed (closed <details>),
  // but the id is still in the document. The chrome contract is the text node.
  const text = (await page.locator('#state-version').textContent()) ?? '';
  return Number(text.replace(/[^0-9]/g, ''));
}

/**
 * Boots into the dashboard, skipping the intro and the office choreography.
 * The office chrome's skip goes straight to the dashboard — QA requires the
 * skip to work at every stage, so the fast path is a product feature, not a
 * test cheat.
 */
export async function openDashboard(page: Page): Promise<void> {
  /*
   * Dashboard specs do not test the room, and every parallel worker that boots
   * a WebGL context plus ten glTF assets slows the whole suite down enough to
   * push the office choreography past its timeouts. The office still runs —
   * as the flat monitor wall, which is a real product path with its own
   * coverage in office.spec.ts.
   */
  await page.addInitScript(() => {
    window.localStorage.setItem('cycase.office3d', 'false');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Skip intro' }).first().click();
  // Now in the office; the chrome carries its own skip.
  await page.getByRole('button', { name: 'Skip intro' }).click();
  /*
   * The case name is the top bar's *context* line, not a heading. The console
   * redesign reduced the bar to one h1 -- the destination you are on -- and put
   * the case underneath it, so `getByRole('heading', { name: /Session Ghost/ })`
   * stopped matching and took three suites down with it. This waits for the
   * same fact in the place the product now puts it: the dashboard is up and it
   * names the case.
   */
  await page.locator('.topbar__context', { hasText: /Session Ghost/ }).waitFor();
}

/**
 * Plays the office choreography for specs that test it: acknowledge the alarm,
 * wait through the colleague's entrance and report, and land on the briefing
 * choice.
 */
export async function walkOfficeChoreography(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Acknowledge alarm' }).first().click();
  await page.getByRole('button', { name: 'Open response console' }).waitFor({ timeout: 30_000 });
}

/** The optimal analyst path, driven entirely through registered tools. */
export const PERFECT_RUN: { tool: string; input: Record<string, unknown> }[] = [
  { tool: 'submit_decision', input: { decisionId: 'D1', optionId: 'D1_preserve_and_inspect' } },
  { tool: 'inspect_artifact', input: { artifactId: 'art_email_001' } },
  { tool: 'submit_decision', input: { decisionId: 'D2', optionId: 'D2_compare_signin_telemetry' } },
  { tool: 'run_diagnostic', input: { diagnosticId: 'auth_timeline' } },
  { tool: 'inspect_artifact', input: { artifactId: 'art_cookie_001' } },
  { tool: 'submit_decision', input: { decisionId: 'D3', optionId: 'D3_revoke_then_reset' } },
  { tool: 'run_diagnostic', input: { diagnosticId: 'session_inventory' } },
  { tool: 'take_response_action', input: { actionId: 'revoke_sessions' } },
  { tool: 'take_response_action', input: { actionId: 'reset_credentials' } },
  { tool: 'submit_decision', input: { decisionId: 'D4', optionId: 'D4_collect_then_isolate' } },
  { tool: 'inspect_artifact', input: { artifactId: 'art_edr_001' } },
  { tool: 'take_response_action', input: { actionId: 'isolate_endpoint' } },
  { tool: 'submit_decision', input: { decisionId: 'D5', optionId: 'D5_sweep_indicators' } },
  { tool: 'run_diagnostic', input: { diagnosticId: 'indicator_scope' } },
  { tool: 'take_response_action', input: { actionId: 'block_indicator' } },
  { tool: 'submit_decision', input: { decisionId: 'D6', optionId: 'D6_verify_checklist' } },
  { tool: 'take_response_action', input: { actionId: 'close_case' } },
];

const MUTATING = new Set(['take_response_action', 'submit_decision']);

/**
 * Idempotency keys have to be unique per *intended application*. A second
 * `runSequence` in the same test would otherwise reuse `e2e-0-...` and have its
 * first mutating call replayed instead of applied — which is the ledger doing
 * exactly its job, and a confusing way for a test to fail.
 */
let keySeq = 0;

/**
 * Runs a scripted sequence, re-reading `stateVersion` from the previous result
 * exactly as a well-behaved agent would.
 */
export async function runSequence(
  page: Page,
  steps: { tool: string; input: Record<string, unknown> }[],
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];
  let version = await readStateVersion(page).catch(() => 0);

  for (const [index, step] of steps.entries()) {
    const input: Record<string, unknown> = { ...step.input, stateVersion: version };
    if (MUTATING.has(step.tool)) {
      keySeq += 1;
      input.idempotencyKey = `e2e-${keySeq}-${index}-${step.tool}`;
    }
    const result = await callTool(page, step.tool, input);
    results.push(result);
    version = result.stateVersion;
  }

  return results;
}

/**
 * There is no `MISSING_ALARM_SAMPLE` allowance any more, and that is a
 * tightening rather than a deletion.
 *
 * This module used to export one regular expression naming the three absent CC0
 * alarm samples, which every console gate in the suite read past. The requests
 * are now gone rather than forgiven: the build lists `public/audio/` and the
 * page never asks for a file the build could not find (`src/audio/manifest.ts`).
 * `alarm-degraded.spec.ts` asserts the audio request count against
 * `window.__CYCASE_AUDIO__.installedAudio`, which keeps meaning the same thing
 * on the day the files land.
 *
 * So every gate below counts every error, with nothing discounted by name.
 *
 * @see docs/AUDIO_ASSET_REQUEST.md
 */

/**
 * Arm the listeners a console gate needs. Nothing is discounted. Chrome puts a
 * failing resource's URL on the message location rather than in its text, so
 * the line carries both.
 */
export function collectPageProblems(page: Page): {
  errors: string[];
  pageErrors: string[];
  failed: string[];
} {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const failed: string[] = [];

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    errors.push(`${message.text()} ${message.location().url}`);
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('requestfailed', (request) => failed.push(request.url()));
  page.on('response', (response) => {
    if (response.status() < 400) return;
    failed.push(`${response.status()} ${response.url()}`);
  });

  return { errors, pageErrors, failed };
}

/* ------------------------------------------------------------------ *
 * The narration surfaces, which the office and the console render
 * differently. Shared, because office.spec.ts asserted the console's toggle
 * directly and went red the moment the shell put it behind a disclosure —
 * two specs describing one control is how that drift happens.
 * ------------------------------------------------------------------ */

/**
 * The office's narration toggle, which is on screen beside mute and volume.
 *
 * Scoped to `main.office` rather than left global because the office and the
 * console are both mounted during the crossfade, and both mount a
 * `VoiceSettings` — an unscoped `.voice-settings__toggle` is a strict-mode
 * violation waiting for a frame where the two overlap, not merely an imprecise
 * locator.
 */
export function officeNarrationToggle(page: Page) {
  return page.locator('.office .voice-settings__toggle');
}

/**
 * The console's narration toggle, which is behind a press.
 *
 * The shell branch consolidated the dashboard's narration, voice and
 * operating-system list into one Settings surface in the top bar —
 * `Dashboard.tsx` renders `<VoiceSettings surface="menu" />`, and that surface
 * keeps its body inside a disclosure so Pause and Return stay visible in a
 * 48px band. The control the office shows inline is therefore one press away
 * on the console; it is not gone, and it is not in the rail.
 *
 * So the reading is done the way a player does it: open Settings, then read the
 * toggle. The disclosure is component state, so it is closed again on every
 * mount — each leg of the round trip opens it for itself, which is also the
 * point, since a console that had rebuilt its settings state would open on the
 * default rather than on the preference the player set.
 */
export async function openConsoleSettings(page: Page): Promise<void> {
  const settings = page.locator('.voice-settings--menu').getByRole('button', { name: 'Settings' });
  await settings.click();
  await expect(settings).toHaveAttribute('aria-expanded', 'true');
}

export function consoleNarrationToggle(page: Page) {
  return page.locator('.voice-settings__panel .voice-settings__toggle');
}

/**
 * Opens one of the guidance rail's extras the way a player has to.
 *
 * The rail starts collapsed, and narration, optional evidence, the activity
 * feed and the registered tools are one tab at a time — each panel is absent
 * from the document until its own tab is selected. So a test that wants any of
 * them has to expand the rail and select the tab, exactly as a person does,
 * rather than reach for an id that is no longer rendered.
 */
export async function openRailTab(page: Page, name: string): Promise<void> {
  const toggle = page.locator('.rail__toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
  const tab = page.getByRole('tab', { name });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

