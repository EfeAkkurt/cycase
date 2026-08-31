/**
 * Build identity — the single source for version metadata.
 *
 * The build SHA must be visible on the deployed URL so a judge (or a bug report) can
 * name exactly which build they saw. The values are substituted at build time by
 * `vite.config.ts`; in `vite dev` they resolve to the working tree's current SHA plus
 * a `-dev` marker.
 *
 * It is also published on `window.__CYCASE_BUILD__` so an E2E test and a deployed
 * smoke check can read it without scraping the DOM.
 */

declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_VERSION__: string;

export interface BuildInfo {
  /** Short git SHA of the commit the bundle was built from. */
  sha: string;
  /** ISO-8601 build timestamp. */
  builtAt: string;
  /** package.json version. */
  version: string;
}

export const BUILD_INFO: BuildInfo = {
  sha: typeof __BUILD_SHA__ === 'string' ? __BUILD_SHA__ : 'unknown',
  builtAt: typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'unknown',
  version: typeof __BUILD_VERSION__ === 'string' ? __BUILD_VERSION__ : '0.0.0',
};

/** `v0.1.0 · a1b2c3d` — short enough for a status bar. */
export function buildLabel(): string {
  return `v${BUILD_INFO.version} · ${BUILD_INFO.sha}`;
}

if (typeof window !== 'undefined') {
  (window as unknown as { __CYCASE_BUILD__: BuildInfo }).__CYCASE_BUILD__ = BUILD_INFO;
}
