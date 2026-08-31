import { describe, expect, it } from 'vitest';

import { definesFor, type BuildIdentity } from '../../scripts/buildDefines';

/**
 * `dist/build-info.json` and `window.__CYCASE_BUILD__` must name the same build.
 *
 * The mechanism it guards is small and easy to lose: `vite.config.ts` resolves the
 * identity ONCE into a module-level constant and hands the same object to both
 * `definesFor()` (substituted into the bundle) and the `generateBundle` hook that
 * emits the JSON. Anyone who "tidies" that into two `buildInfo()` calls gets two
 * `builtAt` timestamps milliseconds apart, and a deployment whose console and whose
 * JSON file disagree about when it was built.
 */
describe('build identity is one value in two places', () => {
  const identity: BuildIdentity = {
    sha: 'abc1234',
    builtAt: '2026-08-30T12:00:00.000Z',
    version: '0.1.0',
  };

  it('the defines substituted into the bundle carry exactly the JSON fields', () => {
    const defines = definesFor(identity);

    // `define` values are source text, so each is the JSON encoding of the value
    // that ends up in the bundle. Decoding them recovers what the page will report.
    const fromBundle = {
      sha: JSON.parse(defines.__BUILD_SHA__!),
      builtAt: JSON.parse(defines.__BUILD_TIME__!),
      version: JSON.parse(defines.__BUILD_VERSION__!),
    };

    // And this is what `vite.config.ts` writes to dist/build-info.json.
    const fromFile = JSON.parse(JSON.stringify(identity));

    expect(fromBundle).toEqual(fromFile);
  });

  it('every field of the identity reaches the bundle, so neither side can gain one', () => {
    // A field added to BuildIdentity and written to the JSON but never given a
    // define would make the file strictly richer than the page — the two would
    // disagree by omission rather than by value, which is harder to notice.
    expect(Object.keys(definesFor(identity)).sort()).toEqual([
      '__BUILD_SHA__',
      '__BUILD_TIME__',
      '__BUILD_VERSION__',
    ]);
    expect(Object.keys(identity).sort()).toEqual(['builtAt', 'sha', 'version']);
  });

  it('a different identity produces different defines, so the mapping is not constant', () => {
    const other = definesFor({ ...identity, sha: 'def5678' });
    expect(other.__BUILD_SHA__).not.toEqual(definesFor(identity).__BUILD_SHA__);
  });
});
