import { defineConfig, devices } from '@playwright/test';

import { resolveTestPort, testBaseUrl, testDistDir } from './scripts/test-port.mjs';

/*
 * One port for this run, shared with the static server and the guard that
 * clears it. `CYCASE_TEST_PORT` selects it; unset, this is 4183 and a serial
 * run behaves exactly as it always has. Two runs on two ports can now overlap
 * without either one's `free-test-port` killing the other's server.
 */
const PORT = resolveTestPort();
const BASE_URL = testBaseUrl();
const DIST_DIR = testDistDir();

/*
 * On the default port this is byte-for-byte the command it has always been.
 * Only a run that asked for its own port gets its own `--outDir`, because vite
 * empties the output directory before writing and two builds sharing `dist/`
 * kill each other mid-copy.
 */
const BUILD = DIST_DIR === 'dist' ? 'npm run build' : `npm run build -- --outDir ${DIST_DIR}`;

/**
 * E2E configuration.
 *
 * The suite runs against a production build, not the dev server, so what is
 * tested is what ships.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    /*
     * `devices['Desktop Chrome']` carries its own 1280x720 viewport, and a
     * project's `use` merges *over* the top-level one — so spreading the device
     * last silently discarded the 1440x900 above. The viewport is respread
     * after the device so the review size is the size the suite actually runs.
     */
    /*
     * Everything that does not need the GPU. Headless Chromium renders WebGL on
     * a software rasteriser — the office measures about 3 FPS there — so the 3D
     * specs are not merely slow in this project, their measurements are
     * meaningless. They live in `desktop-3d` below.
     */
    {
      name: 'desktop',
      testIgnore: /(webmcp-native|headlook|characters|office|office-visibility|performance|alarm-flow|screenshots|review-views|office-transition|alarm-degraded|console-hygiene|dashboard-visual)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    /*
     * The 3D specs, on the real GPU.
     *
     * Headed and single-worker, because that is the only configuration in which
     * a frame-rate budget, a luminance threshold or a settle time means
     * anything.
     */
    {
      name: 'desktop-3d',
      testMatch: /(headlook|characters|office|office-visibility|performance|alarm-flow|screenshots|review-views|office-transition|alarm-degraded|console-hygiene|dashboard-visual)\.spec\.ts/,
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        channel: 'chrome',
        headless: false,
      },
    },
    /*
     * The native WebMCP project: the INSTALLED Chrome, with the real
     * `document.modelContext`, and no test shim anywhere. The shim suite stays
     * because it is deterministic and CI-friendly, but
     * `docs/CODEX_WEBMCP_INTEGRATION.md` §13 is explicit that a shim test is
     * necessary and not sufficient — a page can satisfy a shim it also defines.
     *
     * Verified on Google Chrome 151.0.7922.171: the feature flag below exposes
     * registerTool/getTools/executeTool/ontoolchange. Headed, because WebMCP is
     * not exposed in headless.
     */
    {
      name: 'native-webmcp',
      testMatch: /webmcp-native\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        channel: 'chrome',
        headless: false,
        launchOptions: {
          args: [
            '--enable-features=WebMachineLearningModelContext,WebMCP',
            '--no-first-run',
            '--no-default-browser-check',
          ],
        },
      },
    },
    /*
     * The reduced-motion pass.
     *
     * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §10 asks for the reduced-motion
     * path to *complete the case*, and the two files this project used to match
     * could not answer that: `accessibility.spec.ts` reaches the debrief only
     * through the WebMCP tools, and `narration.spec.ts` is about captions and
     * speech. Neither plays Case 001 by hand, so "reduced motion never completes
     * the case with visible controls" was literally true of the suite.
     *
     * `manual.spec.ts` is the file that makes it false — its first test is
     * "a player completes the case with visible controls only" — and
     * `completion.spec.ts` adds the office-side paths: the monitor round trip,
     * the flat wall and the keyboard-only run. Four of `manual.spec.ts`'s tests
     * gain nothing from the motion setting (build identity, local mode, the
     * destroyed artifact, the double-click guard); `testMatch` is per file, and
     * running them twice is the cheaper half of the trade.
     */
    {
      name: 'reduced-motion',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        reducedMotion: 'reduce',
      },
      testMatch: /(accessibility|narration|completion|manual)\.spec\.ts/,
    },
  ],
  webServer: {
    /*
     * Not `vite preview`. It kept exiting part-way through long headed runs, and
     * every test after it failed with ERR_CONNECTION_REFUSED — a cascade that
     * reads as a wall of product regressions. `scripts/test-server.mjs` serves
     * the same `dist/` and survives a bad request.
     */
    command: `${BUILD} && node scripts/test-server.mjs`,
    env: { PORT: String(PORT), CYCASE_DIST_DIR: DIST_DIR },
    url: BASE_URL,
    /*
     * Off by default, deliberately.
     *
     * Reusing a running preview server silently tests whatever was last built.
     * A lighting change made to fix a failing visibility gate produced byte-identical
     * measurements because the suite was serving a stale `dist/` — the numbers looked
     * like the fix had done nothing, when in fact the fix had never been loaded. That is
     * exactly the class of false result these gates exist to prevent.
     *
     * Set CYCASE_REUSE_SERVER=1 when iterating on a spec and you know the build is current.
     */
    reuseExistingServer: process.env.CYCASE_REUSE_SERVER === '1',
    timeout: 120_000,
  },
});
