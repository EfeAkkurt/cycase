/**
 * Types for the two helpers `tests/unit/assetManifest.test.ts` imports.
 *
 * The script itself is plain ESM JavaScript and stays that way — it is a build
 * tool, not shipped code. Only the pieces a test needs are declared, so the
 * declaration cannot drift into claiming things about the rest of the file.
 */
export interface AssetTotals {
  modelBytes: number;
  textureBytes: number;
  totalBytes: number;
}

export interface AssetManifestShape {
  models: { file: string; bytes: number }[];
  characters: { file: string; bytes: number }[];
  textures: { maps: { file: string; bytes: number }[] }[];
  totals: AssetTotals;
}

/** Derives the `totals` block from the manifest's own entries. */
export function totalsFor(manifest: AssetManifestShape): AssetTotals;

/** Throws when the rollup and the entries disagree. */
export function assertTotals(manifest: AssetManifestShape): void;
