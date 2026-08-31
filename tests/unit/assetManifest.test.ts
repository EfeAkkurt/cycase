import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertTotals, totalsFor } from '../../scripts/fetch-assets.mjs';

/**
 * The shipped asset manifest, checked against the files it describes.
 *
 * `public/asset-manifest.json` is quoted by `ASSET_LICENSES.md` and by the
 * README, so a wrong number in it is a wrong number in the licence ledger. It
 * had one: the colleague GLB was regenerated from 319,100 to 503,188 bytes,
 * `characters[0].bytes` was corrected, and `totals.modelBytes` was left on the
 * old figure — 3,443,528 against a true 3,627,616, understating the shipped
 * model payload by 184,088 bytes.
 *
 * The cause was that the rollup was accumulated alongside the entries rather
 * than derived from them, so the two could disagree. It is derived now, and
 * these tests hold the three properties that made the drift possible:
 * the arithmetic is right, the totals include characters as well as models, and
 * every byte count in the file matches the file on disk.
 */

const ROOT = path.resolve(__dirname, '../..');

interface Entry {
  file: string;
  bytes: number;
}

interface Manifest {
  models: Entry[];
  characters: Entry[];
  textures: { maps: Entry[] }[];
  totals: { modelBytes: number; textureBytes: number; totalBytes: number };
}

const manifest = JSON.parse(
  readFileSync(path.join(ROOT, 'public/asset-manifest.json'), 'utf8'),
) as Manifest;

describe('asset manifest totals', () => {
  it('agrees with its own entries', () => {
    // The shipped file, not a fixture: this is the number the documents quote.
    expect(() => assertTotals(manifest)).not.toThrow();
  });

  it('counts characters as models, because they are shipped .glb files too', () => {
    const models = manifest.models.reduce((sum, entry) => sum + entry.bytes, 0);
    const characters = manifest.characters.reduce((sum, entry) => sum + entry.bytes, 0);

    expect(characters).toBeGreaterThan(0);
    // The exact failure that shipped: a total equal to the models alone, or to
    // the models plus a stale character size, both look plausible in isolation.
    expect(manifest.totals.modelBytes).not.toBe(models);
    expect(manifest.totals.modelBytes).toBe(models + characters);
  });

  it('adds up', () => {
    expect(manifest.totals.totalBytes).toBe(
      manifest.totals.modelBytes + manifest.totals.textureBytes,
    );
  });

  it('matches the bytes actually on disk', () => {
    const files = [
      ...manifest.models,
      ...manifest.characters,
      ...manifest.textures.flatMap((texture) => texture.maps),
    ];

    expect(files.length).toBeGreaterThan(10);

    const wrong = files
      .map((entry) => ({ entry, disk: statSync(path.join(ROOT, entry.file)).size }))
      .filter(({ entry, disk }) => entry.bytes !== disk);

    expect(
      wrong.map(({ entry, disk }) => `${entry.file}: manifest ${entry.bytes}, disk ${disk}`),
    ).toEqual([]);
  });

  it('recomputes to the same answer', () => {
    // `totalsFor` is what the fetch script writes; running it over the shipped
    // manifest must reproduce the shipped totals exactly, or the file on disk
    // was edited by something other than the script that owns it.
    expect(totalsFor(manifest)).toEqual(manifest.totals);
  });

  it('rejects a rollup left behind by a regenerated entry', () => {
    // The regression, reconstructed: one entry grows, the rollup does not.
    const stale = {
      ...manifest,
      characters: manifest.characters.map((entry) => ({ ...entry, bytes: entry.bytes + 184_088 })),
    };

    expect(() => assertTotals(stale)).toThrow(/totals\.modelBytes/);
  });
});
