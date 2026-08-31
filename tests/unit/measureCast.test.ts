import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_TARGETS, REFERENCE, missingTargets } from '../../scripts/measure-cast.mjs';

/**
 * The colour-cast instrument, held to reporting what it actually measured.
 *
 * `scripts/measure-cast.mjs` names three review frames when the command line
 * names none, and one of those names went stale: the capture was renamed from
 * `1440x900-04-companion.png` to `-04-assistant.png` when the redesign renamed
 * the character it was named after, and the script kept the old name. The list
 * was then passed through `.filter(existsSync)`, so the frame that no longer
 * answered to that name was dropped in silence and the run printed a
 * two-capture average under a heading that promised three. Nothing in the
 * output mentioned the third frame, which is precisely why nobody noticed for
 * as long as it lasted.
 *
 * Two properties close that, and they are different properties. The first is
 * about this list on this day: the names in it are real files. The second is
 * about the instrument's character: a target it was told to measure and cannot
 * find ends the run loudly instead of shrinking the sample behind the
 * reviewer's back. A rename could break the first again; only the second makes
 * the break impossible to miss.
 */

const ROOT = path.resolve(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/measure-cast.mjs');

describe('the default targets', () => {
  it('names three frames that are all on disk', () => {
    expect(DEFAULT_TARGETS).toHaveLength(3);
    for (const target of DEFAULT_TARGETS) {
      expect(existsSync(path.join(ROOT, target)), `${target} is not on disk`).toBe(true);
    }
  });

  it('names a reference frame that is on disk', () => {
    expect(existsSync(path.join(ROOT, REFERENCE)), `${REFERENCE} is not on disk`).toBe(true);
  });
});

describe('a target that is not there', () => {
  it('is reported rather than filtered out of the list', () => {
    const absent = 'docs/screenshots/1440x900-04-companion.png';
    // The exact name the script used to carry, so this test is anchored to the
    // real defect rather than to an invented one.
    expect(existsSync(path.join(ROOT, absent))).toBe(false);

    const missing = missingTargets([REFERENCE, ...DEFAULT_TARGETS, absent]);
    expect(missing).toEqual([absent]);
  });

  it('ends the run non-zero, with its path printed', () => {
    /*
     * Run as a process, because the property under test is the exit code and
     * the exit code is not observable from inside the module. This costs one
     * node start and nothing else: the script refuses before it decodes a
     * single PNG, which is the whole point of refusing.
     */
    let status = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, [SCRIPT, 'docs/screenshots/does-not-exist.png'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      status = failure.status ?? 0;
      stderr = failure.stderr ?? '';
    }

    expect(status, 'a missing target did not fail the run').not.toBe(0);
    expect(stderr).toContain('docs/screenshots/does-not-exist.png');
  });

  it('still measures a run whose targets are all present', () => {
    const output = execFileSync(process.execPath, [SCRIPT, DEFAULT_TARGETS[0]!], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    // The reference block is part of the report, not an optional extra: a run
    // that cannot compare against it has nothing to say about the cast.
    expect(output).toContain('reference:');
    expect(output).toContain('vs reference:');
  });
});
