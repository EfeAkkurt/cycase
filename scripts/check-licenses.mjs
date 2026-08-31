#!/usr/bin/env node
/**
 * Asset licence ledger audit (delivery plan §10).
 *
 * "Every shipped external or generated asset must list local path, source URL,
 * creator/provider, licence, date acquired, modifications, attribution and whether
 * redistribution is permitted."
 *
 * The failure this guards is drift: an asset lands in public/ and nobody updates the
 * ledger, so the build ships something whose redistribution rights were never checked.
 * So the check runs in BOTH directions — every shipped asset must be in the ledger, and
 * every ledger row must point at a file that exists.
 *
 * Exits non-zero on any gap.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const LEDGER = join(ROOT, 'ASSET_LICENSES.md');

/** Extensions that are shipped assets rather than source. */
const ASSET_EXT = new Set([
  '.glb', '.gltf', '.bin', '.png', '.jpg', '.jpeg', '.webp', '.ktx2',
  '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.wav', '.ogg', '.webm', '.mp4',
]);

/** Assets we author ourselves, which need no external licence row. */
const OWN_WORK = [/^public\/favicon/, /^public\/og-/, /^docs\/screenshots\//, /^docs\/assets\//];

function walkAssets(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkAssets(full, out);
    else if (ASSET_EXT.has(extname(entry).toLowerCase())) out.push(relative(ROOT, full));
  }
  return out;
}

if (!existsSync(LEDGER)) {
  console.error('ASSET_LICENSES.md is missing.');
  process.exit(1);
}

const ledger = readFileSync(LEDGER, 'utf8');
const shipped = walkAssets(join(ROOT, 'public'));

const REQUIRED_FIELDS = ['licence', 'license', 'source'];
const hasFieldVocabulary = REQUIRED_FIELDS.some((field) =>
  new RegExp(field, 'i').test(ledger),
);
if (!hasFieldVocabulary) {
  console.error('ASSET_LICENSES.md does not document licence or source at all.');
  process.exit(1);
}

const problems = [];

// Direction 1: every shipped asset appears in the ledger.
for (const asset of shipped) {
  if (OWN_WORK.some((pattern) => pattern.test(asset))) continue;
  const basename = asset.split('/').pop();
  if (!ledger.includes(basename)) {
    problems.push(`shipped but not in the ledger: ${asset}`);
  }
}

// Direction 2: every path the ledger names still exists.
for (const match of ledger.matchAll(/`(public\/[^`]+)`/g)) {
  const path = match[1];
  if (!existsSync(join(ROOT, path))) {
    problems.push(`ledger names a file that does not exist: ${path}`);
  }
}

// Direction 3: no OpenAI/Codex branded asset ships (delivery plan §10).
const BRAND_FORBIDDEN = /\b(openai|chatgpt|codex)[-_ ]?(pet|logo|mark|brand)/i;
for (const asset of shipped) {
  if (BRAND_FORBIDDEN.test(asset)) {
    problems.push(`branded asset must not ship: ${asset}`);
  }
}

if (problems.length > 0) {
  console.error(`Licence audit FAILED with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(
  `Licence audit clean: ${shipped.length} shipped asset(s), all reconciled with ASSET_LICENSES.md`,
);
