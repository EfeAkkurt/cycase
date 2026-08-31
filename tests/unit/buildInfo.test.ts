import { describe, expect, it } from 'vitest';

import { BUILD_INFO, buildLabel } from '../../src/buildInfo';

/**
 * There has to be one source for build/version metadata, and the SHA has to be
 * visible on the deployed build. A missing definition
 * would silently resolve to 'unknown' and make a deployed bug report unattributable,
 * so the fallback is asserted against rather than trusted.
 */
describe('build metadata', () => {
  it('resolves a real sha, timestamp and version rather than the fallbacks', () => {
    expect(BUILD_INFO.sha).not.toBe('unknown');
    expect(BUILD_INFO.sha).toMatch(/^[0-9a-f]{7,}(-dev)?$/);
    expect(BUILD_INFO.version).not.toBe('0.0.0');
    expect(() => new Date(BUILD_INFO.builtAt).toISOString()).not.toThrow();
  });

  it('formats a label short enough for a status bar', () => {
    expect(buildLabel()).toContain(BUILD_INFO.sha);
    expect(buildLabel().length).toBeLessThan(40);
  });
});
