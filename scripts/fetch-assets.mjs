#!/usr/bin/env node
/**
 * Fetches and optimises the CC0 office assets.
 *
 * The room comes from Poly Haven, which publishes CC0 and — unlike the other
 * sources `docs/ASSET_PIPELINE.md` names — serves a real API rather than a
 * JavaScript download modal. The scripted colleague comes from the Quaternius
 * Ultimate Animated Character Pack, also CC0, whose download modal turned out
 * to hide a plain Google Drive folder that serves the files directly (see the
 * third amendment in `docs/ASSET_PIPELINE.md`). Both are reproducible: delete
 * `public/models` and `public/textures`, run this, get the same output.
 *
 *   node scripts/fetch-assets.mjs
 *
 * Models are downloaded as 1k glTF and optimised to a single `.glb` with
 * `@gltf-transform/cli`: WebP textures, 1024px cap, `quantize` compression.
 * Quantize is deliberate — Draco and Meshopt both need a decoder wired into
 * `GLTFLoader` at runtime, and a missing decoder fails silently.
 *
 * The manifest this writes is the source for the `ASSET_LICENSES.md` rows.
 */

import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);

const API = 'https://api.polyhaven.com';
const ROOT = path.resolve(import.meta.dirname, '..');
const RAW = path.join(ROOT, '.assets-raw');
const MODELS_OUT = path.join(ROOT, 'public/models');
const TEXTURES_OUT = path.join(ROOT, 'public/textures');

/** Props that carry the room. Kept small: every one is drawn every frame. */
const MODELS = [
  { id: 'metal_office_desk', role: 'Desk', textureSize: 1024 },
  { id: 'modern_arm_chair_01', role: 'Operator chair', textureSize: 1024 },
  { id: 'drawer_cabinet', role: 'Cabinet behind the desk', textureSize: 512 },
  { id: 'worn_metal_rack', role: 'Equipment rack', textureSize: 512 },
  { id: 'desk_lamp_arm_01', role: 'Desk lamp — the warm practical', textureSize: 512 },
  { id: 'office_notepads', role: 'Desk clutter', textureSize: 512 },
  { id: 'stationery_supplies', role: 'Desk clutter', textureSize: 512 },
  { id: 'plastic_thermos', role: 'Desk clutter', textureSize: 512 },
  // Leaf atlases dominate this one; it is background dressing at 3 m.
  { id: 'potted_plant_01', role: 'Background plant', textureSize: 256, simplify: 0.4 },
  { id: 'metal_trash_can', role: 'Floor clutter', textureSize: 256 },
];

/**
 * Room surfaces and the materials for the hardware we model ourselves.
 * `arm` packs ambient-occlusion, roughness and metalness into one image, which
 * is exactly how three.js wants them.
 */
const TEXTURES = [
  { id: 'concrete_floor_02', maps: ['Diffuse', 'nor_gl', 'arm'], role: 'Floor' },
  { id: 'painted_plaster_wall', maps: ['Diffuse', 'nor_gl', 'arm'], role: 'Walls' },
  { id: 'metal_plate', maps: ['Diffuse', 'nor_gl', 'arm'], role: 'Monitor shells and keyboard' },
];

/**
 * Rigged, animated CC0 characters.
 *
 * Quaternius publishes the Ultimate Animated Character Pack under CC0 — the
 * statement and the deed link are on the pack page itself, which is the
 * rights-holder's own site. `docs/ASSET_PIPELINE.md` previously recorded the
 * pack as unreachable because its download control is `href="#inline"`; the
 * modal behind that anchor opens a public Google Drive folder whose `glTF`
 * subfolder serves each character as a plain file. The file id below is
 * pinned rather than re-scraped: Drive's folder markup differs between its
 * list and grid views, and a scraper that works today is not a pipeline.
 *
 * Three guards make the import trustworthy rather than lucky:
 *
 * 1. The payload is checked for glTF 2.0 structure. Drive serves consent and
 *    quota pages with HTTP 200, so "it downloaded" proves nothing; without
 *    this, HTML lands in `public/models` and the office goes silently black.
 * 2. The SHA-256 of the source file is verified against the digest recorded
 *    when the licence was checked. A different upstream file is a different
 *    licence question, so it stops the run instead of shipping quietly.
 * 3. Only the clips the game plays survive. Seventeen combat and emote clips
 *    are 2 MB of animation data for a scene that walks and breathes.
 */
const CHARACTERS = [
  {
    id: 'colleague_suit_female',
    role: 'Scripted colleague (Ecrin)',
    pack: 'Quaternius — Ultimate Animated Character Pack',
    page: 'https://quaternius.com/packs/ultimatedanimatedcharacter.html',
    licence: 'CC0 1.0',
    deed: 'https://creativecommons.org/publicdomain/zero/1.0/',
    author: 'Quaternius',
    /** `glTF/Suit_Female.gltf` inside the pack's public Drive folder. */
    driveFileId: '1f0AZRaRmoxdn64Khz6of_6wLHBzMc8AE',
    sourceName: 'Suit_Female.gltf',
    sha256: '37cbe38d428f57aff788be0f585fb9892b6115cc014c494cb19ec65c621e1f07',
    /** Everything the office actually plays. The rest is combat and emotes. */
    keepClips: ['Idle', 'Walk'],
  },
];

const DRIVE_DOWNLOAD = 'https://drive.usercontent.google.com/download';

const RESOLUTION = '1k';
const FORMAT = 'jpg';

/**
 * Poly Haven's smallest texture is 1k JPEG, which is far more than a wall three
 * metres from a fixed camera needs. Re-encoding to 512px WebP takes the three
 * room materials from 5.5 MB to a few hundred kilobytes with no visible loss at
 * this distance. Normal maps keep more quality than albedo, because banding in
 * a normal map shows up as visible faceting.
 */
const TEXTURE_TARGET = { size: 512, albedoQuality: 78, dataQuality: 90 };

/** Poly Haven's own map names, mapped to the suffix three.js code expects. */
const MAP_SUFFIX = { Diffuse: 'diff', nor_gl: 'nor', arm: 'arm' };

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`${response.status} ${url}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await pipeline(response.body, createWriteStream(destination));
}

async function sizeOf(file) {
  return (await stat(file)).size;
}

function human(bytes) {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * The `totals` block, derived from the manifest's own entries.
 *
 * `modelBytes` covers `models[]` *and* `characters[]`: both are `.glb` files
 * under `public/models/`, both are shipped, and a reader comparing this figure
 * against the directory would otherwise find it short by exactly one character.
 */
function totalsFor(manifest) {
  const modelBytes = [...manifest.models, ...manifest.characters].reduce(
    (sum, entry) => sum + entry.bytes,
    0,
  );
  const textureBytes = manifest.textures
    .flatMap((texture) => texture.maps)
    .reduce((sum, map) => sum + map.bytes, 0);
  return { modelBytes, textureBytes, totalBytes: modelBytes + textureBytes };
}

/**
 * Fails the run if the rollup and the entries disagree.
 *
 * Cheap, and it closes the door this bug came through: the manifest is a
 * hand-editable JSON file that `ASSET_LICENSES.md` and `README.md` both quote,
 * so an entry corrected by hand without its total is a documented number that
 * is quietly wrong.
 */
function assertTotals(manifest) {
  const expected = totalsFor(manifest);
  for (const key of ['modelBytes', 'textureBytes', 'totalBytes']) {
    if (manifest.totals[key] !== expected[key]) {
      throw new Error(
        `asset-manifest totals.${key} is ${manifest.totals[key]}, but the entries sum to ` +
          `${expected[key]}. The rollup must be derived from the entries, never maintained ` +
          `beside them.`,
      );
    }
  }
}

export { totalsFor, assertTotals };

/** Downloads one model's glTF plus every texture it references. */
async function fetchModel(id) {
  const files = await getJson(`${API}/files/${id}`);
  const entry = files.gltf?.[RESOLUTION]?.gltf;
  if (!entry) throw new Error(`No ${RESOLUTION} glTF for ${id}`);

  const dir = path.join(RAW, id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const gltfPath = path.join(dir, `${id}.gltf`);
  await download(entry.url, gltfPath);

  for (const [relative, info] of Object.entries(entry.include ?? {})) {
    await download(info.url, path.join(dir, relative));
  }

  return { gltfPath, dir };
}

/**
 * @param {object} options
 * @param {boolean} [options.skinned]
 *   Skinned models must NOT have their positions quantized.
 *
 *   `quantize` rewrites POSITION into int16 and puts the compensating scale on
 *   the node. glTF ignores a skinned mesh's node transform — skinning uses the
 *   skeleton's inverse bind matrices instead — so the compensation is silently
 *   dropped and the mesh renders in raw quantized space. The colleague shipped
 *   that way and drew as a collapsed heap on the desk: a face lying flat, no
 *   recognisable body. Measured, her positions spanned 65534 units instead of
 *   1.94, and the runtime height-fit then divided by the wrong number.
 *
 *   Textures are still compressed; only position quantization is skipped, which
 *   costs about 184 KB on this model and is the difference between a character
 *   and a bug.
 */
async function optimiseModel(
  id,
  gltfPath,
  { textureSize = 1024, simplify, palette = true, skinned = false },
) {
  const out = path.join(MODELS_OUT, `${id}.glb`);
  await mkdir(MODELS_OUT, { recursive: true });

  const args = [
    '--yes',
    '@gltf-transform/cli',
    'optimize',
    gltfPath,
    out,
    '--texture-compress',
    'webp',
    '--texture-size',
    String(textureSize),
    '--compress',
    skinned ? 'draco' : 'quantize',
  ];

  if (simplify) args.push('--simplify', 'true', '--simplify-error', String(simplify));
  else args.push('--simplify', 'false');
  if (!palette) args.push('--palette', 'false');

  await run('npx', args, { maxBuffer: 32 * 1024 * 1024 });
  return out;
}

/* ------------------------------------------------------------------ *
 * Characters
 * ------------------------------------------------------------------ */

/**
 * Downloads one pinned Drive file and refuses anything that is not the exact
 * glTF whose licence was checked.
 */
async function fetchCharacterSource(character) {
  const dir = path.join(RAW, character.id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const source = path.join(dir, character.sourceName);
  const url = `${DRIVE_DOWNLOAD}?id=${character.driveFileId}&export=download`;
  await download(url, source);

  const bytes = await readFile(source);

  // Drive answers consent screens, quota walls and "file not found" with 200
  // and an HTML body. Fail loudly here rather than three steps later.
  const head = bytes.subarray(0, 512).toString('utf8').trimStart();
  if (!head.startsWith('{')) {
    throw new Error(
      `${character.id}: Drive returned ${bytes.length} bytes that are not glTF JSON — ` +
        `probably an interstitial page. First bytes: ${head.slice(0, 80)}`,
    );
  }

  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== character.sha256) {
    throw new Error(
      `${character.id}: SHA-256 mismatch. Expected ${character.sha256}, got ${digest}. ` +
        'The upstream file changed; re-verify the licence before updating the digest.',
    );
  }

  const doc = JSON.parse(bytes.toString('utf8'));
  if (doc.asset?.version !== '2.0') throw new Error(`${character.id}: not glTF 2.0`);
  if (!doc.skins?.length) throw new Error(`${character.id}: no skin — not a rigged character`);

  const names = new Set((doc.animations ?? []).map((clip) => clip.name));
  const missing = character.keepClips.filter((clip) => !names.has(clip));
  if (missing.length) throw new Error(`${character.id}: missing clips ${missing.join(', ')}`);

  return { doc, source, digest, bytes: bytes.length };
}

/**
 * Writes a copy carrying only the clips the game plays. `prune` in the
 * optimize pipeline then drops every accessor the removed clips owned, which
 * is where most of the file went.
 */
async function trimClips(character, doc, dir) {
  const trimmed = {
    ...doc,
    animations: (doc.animations ?? []).filter((clip) => character.keepClips.includes(clip.name)),
  };
  const out = path.join(dir, `${character.id}.trimmed.gltf`);
  await writeFile(out, JSON.stringify(trimmed));
  return out;
}

/** Reads the material names back out of a `.glb`, so the check is on shipped bytes. */
async function readGlbJson(file) {
  const buffer = await readFile(file);
  const jsonLength = buffer.readUInt32LE(12);
  return JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
}

async function buildCharacter(character) {
  const { doc, bytes: sourceBytes } = await fetchCharacterSource(character);
  const dir = path.join(RAW, character.id);
  const trimmed = await trimClips(character, doc, dir);

  /*
   * `--palette false` is load-bearing. The palette pass folds every material
   * into one generated texture atlas, which erases the material *names* the
   * office recolours by — `src/three/Colleague.tsx` retargets Skin/Shirt/Hair
   * to the warm-neutral scene palette, and the pack's belt colour is cool
   * enough to trip `tests/e2e/palette.spec.ts` if it survives baked into an
   * image instead of a factor.
   */
  const out = await optimiseModel(character.id, trimmed, {
    skinned: true,
    simplify: false,
    palette: false,
    textureSize: 512,
  });

  const shipped = await readGlbJson(out);
  const materials = (shipped.materials ?? []).map((material) => material.name);
  if (materials.length < 2) {
    throw new Error(
      `${character.id}: the optimised file has ${materials.length} material(s); ` +
        'the per-material recolour in Colleague.tsx needs the names to survive.',
    );
  }

  return {
    out,
    sourceBytes,
    materials,
    clips: (shipped.animations ?? []).map((clip) => clip.name),
  };
}

async function fetchTexture({ id, maps }) {
  const files = await getJson(`${API}/files/${id}`);
  const written = [];

  for (const map of maps) {
    const entry = files[map]?.[RESOLUTION]?.[FORMAT];
    if (!entry) {
      console.warn(`  ! ${id}: no ${map} at ${RESOLUTION}/${FORMAT}`);
      continue;
    }
    const suffix = MAP_SUFFIX[map] ?? map;
    const source = path.join(RAW, 'tex', `${id}_${suffix}.jpg`);
    const destination = path.join(TEXTURES_OUT, `${id}_${suffix}.webp`);

    await download(entry.url, source);
    await mkdir(TEXTURES_OUT, { recursive: true });
    await sharp(source)
      .resize(TEXTURE_TARGET.size, TEXTURE_TARGET.size, { fit: 'inside' })
      .webp({ quality: suffix === 'diff' ? TEXTURE_TARGET.albedoQuality : TEXTURE_TARGET.dataQuality })
      .toFile(destination);

    written.push({ map: suffix, file: path.relative(ROOT, destination), bytes: await sizeOf(destination) });
  }

  return written;
}

/**
 * Which sections to build. `node scripts/fetch-assets.mjs characters` rebuilds
 * only the characters and merges the result into the existing manifest, so a
 * character swap does not re-download 3 MB of unchanged room.
 */
function requestedSections(argv) {
  const known = ['models', 'characters', 'textures'];
  const asked = argv.filter((arg) => known.includes(arg));
  return new Set(asked.length ? asked : known);
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(path.join(ROOT, 'public/asset-manifest.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const sections = requestedSections(process.argv.slice(2));
  const previous = (await readManifest()) ?? {};

  const manifest = {
    source: 'https://polyhaven.com',
    license: 'CC0 1.0',
    models: sections.has('models') ? [] : (previous.models ?? []),
    characters: sections.has('characters') ? [] : (previous.characters ?? []),
    textures: sections.has('textures') ? [] : (previous.textures ?? []),
  };

  if (sections.has('models')) console.log('Models');
  for (const { id, role, textureSize, simplify } of sections.has('models') ? MODELS : []) {
    process.stdout.write(`  ${id} … `);
    const info = await getJson(`${API}/info/${id}`);
    const { gltfPath } = await fetchModel(id);
    const out = await optimiseModel(id, gltfPath, { textureSize, simplify });
    const bytes = await sizeOf(out);

    manifest.models.push({
      id,
      role,
      authors: Object.keys(info.authors ?? {}),
      page: `https://polyhaven.com/a/${id}`,
      file: path.relative(ROOT, out),
      bytes,
    });
    console.log(human(bytes));
  }

  if (sections.has('characters')) console.log('Characters');
  for (const character of sections.has('characters') ? CHARACTERS : []) {
    process.stdout.write(`  ${character.id} … `);
    const built = await buildCharacter(character);
    const bytes = await sizeOf(built.out);

    manifest.characters.push({
      id: character.id,
      role: character.role,
      pack: character.pack,
      page: character.page,
      author: character.author,
      license: character.licence,
      licenseUrl: character.deed,
      driveFileId: character.driveFileId,
      sourceName: character.sourceName,
      sourceSha256: character.sha256,
      clips: built.clips,
      materials: built.materials,
      file: path.relative(ROOT, built.out),
      bytes,
    });
    console.log(`${human(bytes)} (clips: ${built.clips.join(', ')})`);
  }

  if (sections.has('textures')) console.log('Textures');
  for (const texture of sections.has('textures') ? TEXTURES : []) {
    process.stdout.write(`  ${texture.id} … `);
    const info = await getJson(`${API}/info/${texture.id}`);
    const written = await fetchTexture(texture);
    manifest.textures.push({
      id: texture.id,
      role: texture.role,
      authors: Object.keys(info.authors ?? {}),
      page: `https://polyhaven.com/a/${texture.id}`,
      maps: written,
    });
    console.log(written.map((w) => `${w.map} ${human(w.bytes)}`).join(', '));
  }

  /*
   * Totals are derived from the entries in the manifest, never accumulated
   * alongside them.
   *
   * They used to be a running counter seeded from whichever sections were
   * carried forward and incremented as new files were written. That is correct
   * only while every number in the file came from the same run, and it silently
   * stops being correct the moment one does not: the colleague GLB was
   * regenerated from 319,100 to 503,188 bytes, `characters[0].bytes` was
   * updated, and `totals.modelBytes` kept the old figure — 3,443,528 against a
   * true 3,627,616, understating the shipped model payload by 184,088 bytes in
   * the file the licence ledger and the README both quote.
   *
   * Recomputing here cannot lag, because there is no second copy of the number
   * to fall behind. `assertTotals` then checks the arithmetic on the way out,
   * so a hand-edit to an entry cannot leave the rollup stale either.
   */
  manifest.totals = totalsFor(manifest);
  assertTotals(manifest);

  await writeFile(
    path.join(ROOT, 'public/asset-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  console.log(`\nModels   ${human(manifest.totals.modelBytes)}`);
  console.log(`Textures ${human(manifest.totals.textureBytes)}`);
  console.log(`Total    ${human(manifest.totals.totalBytes)}`);
  console.log('Wrote public/asset-manifest.json');

  const stale = await readdir(RAW).catch(() => []);
  if (stale.length) console.log(`Raw downloads kept in ${path.relative(ROOT, RAW)} (gitignored).`);
}

/*
 * Only run when invoked directly. The totals helpers are exported so a test can
 * check the arithmetic without this file reaching for the network.
 */
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
