#!/usr/bin/env node
/*
 * Measures the colour cast of a capture against the approved reference.
 *
 * The visual review kept turning on the word "orange", which is not something
 * two people can agree or disagree about. This reports the two numbers that
 * actually separate "a neutral room with warm pools in it" from "an orange
 * room": the red-minus-blue mean, and the mean saturation.
 *
 *   node scripts/measure-cast.mjs <capture.png> [more.png ...]
 *
 * Run with no arguments it compares the current review captures against
 * docs/assets/office-concept-v2-neutral.png and prints the gap. Paths are
 * relative to the repository root, which is where it expects to be run from.
 *
 * This is still not a quality gate: it does not fail on a bad number, because
 * the question "does this look credible" belongs to a person and this exists so
 * that person is arguing with a measurement rather than an adjective.
 *
 * It does now fail on a missing one. The default list still named
 * `1440x900-04-companion.png` after that capture had been renamed to
 * `1440x900-04-assistant.png` — a pure rename, one commit, when the redesign
 * removed the `companion` vocabulary along with NODE. The script was not
 * updated with it. A `.filter(existsSync)` then dropped the now-missing frame
 * on the floor, so it printed an average over two captures under a heading
 * that promised three, and nothing anywhere said so. A reviewer cannot notice
 * a frame that was never mentioned.
 *
 * So every named target — the three defaults, anything given on the command
 * line, and the reference itself — must exist. One that does not ends the run
 * with its path on stderr and a non-zero exit, rather than quietly shrinking
 * the sample the average is taken over.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

export const REFERENCE = 'docs/assets/office-concept-v2-neutral.png';

/**
 * The frames the review argues about when no capture is named.
 *
 * `tests/unit/measureCast.test.ts` asserts that all three are on disk, which is
 * the check that would have caught the `companion`/`assistant` rename the day
 * it happened instead of leaving a two-frame average calling itself three.
 */
export const DEFAULT_TARGETS = [
  'docs/screenshots/1440x900-02-office.png',
  'docs/screenshots/1440x900-03-critical-alert.png',
  'docs/screenshots/1440x900-04-assistant.png',
];

/** Skips the app chrome so the measurement is of the room, not the top bar. */
const CHROME_HEIGHT = 48;

/**
 * Which of these paths are not on disk.
 *
 * Deliberately a list rather than a boolean: a reviewer who has one frame
 * missing wants to be told which one, not that something somewhere is absent.
 */
export function missingTargets(files) {
  return files.filter((file) => !existsSync(file));
}

export function measure(file) {
  const png = PNG.sync.read(readFileSync(file));
  let r = 0;
  let g = 0;
  let b = 0;
  let sat = 0;
  let n = 0;

  // The lower band is the dialogue panel on our captures; the room is the middle.
  const top = Math.min(CHROME_HEIGHT, png.height);
  const bottom = png.height;

  for (let y = top; y < bottom; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const i = (png.width * y + x) << 2;
      if (png.data[i + 3] < 8) continue;
      const pr = png.data[i];
      const pg = png.data[i + 1];
      const pb = png.data[i + 2];
      const max = Math.max(pr, pg, pb);
      const min = Math.min(pr, pg, pb);
      r += pr;
      g += pg;
      b += pb;
      sat += max === 0 ? 0 : (max - min) / max;
      n += 1;
    }
  }

  return { file, r: r / n, g: g / n, b: b / n, warmth: (r - b) / n, saturation: sat / n };
}

function line(m) {
  return (
    `${m.file.replace(/^docs\//, '').padEnd(46)} ` +
    `rgb(${m.r.toFixed(0).padStart(3)},${m.g.toFixed(0).padStart(3)},${m.b.toFixed(0).padStart(3)})  ` +
    `r-b=${m.warmth.toFixed(1).padStart(5)}  sat=${(m.saturation * 100).toFixed(1).padStart(5)}%`
  );
}

/** Returns the process exit code, so the failure path is one obvious value. */
export function run(argv) {
  const files = argv.length ? argv : DEFAULT_TARGETS;

  // The reference is named by this file rather than by the caller, but it is
  // named all the same: without it the "vs reference" block simply does not
  // print, which is the same silence the missing capture used to get.
  const missing = missingTargets([REFERENCE, ...files]);
  if (missing.length > 0) {
    for (const file of missing) console.error(`missing target: ${file}`);
    console.error(
      `${missing.length} of ${files.length + 1} named targets are not on disk; ` +
        'no measurement was taken.',
    );
    return 1;
  }

  const reference = measure(REFERENCE);
  console.log('reference:');
  console.log(`  ${line(reference)}`);
  console.log('');

  console.log('captures:');
  for (const file of files) {
    const m = measure(file);
    console.log(`  ${line(m)}`);
    const dw = m.warmth - reference.warmth;
    const ds = (m.saturation - reference.saturation) * 100;
    console.log(
      `  ${''.padEnd(46)} vs reference: r-b ${dw >= 0 ? '+' : ''}${dw.toFixed(1)}, ` +
        `saturation ${ds >= 0 ? '+' : ''}${ds.toFixed(1)} points`,
    );
  }

  return 0;
}

// Importing this module — which is how the unit test reaches the pure parts —
// must not measure anything or set an exit code.
const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exitCode = run(process.argv.slice(2));
