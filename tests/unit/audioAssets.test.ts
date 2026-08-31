import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ALARM_ASSETS, INSTALLED_ALARM_ASSETS } from '../../src/audio/manifest';
import { installedAudioPaths } from '../../scripts/audioAssets';

/**
 * The manifest gate, from the disk end.
 *
 * `docs/AUDIO_ASSET_REQUEST.md` promises the owner that dropping three WAVs
 * into `public/audio/sfx/` is the entire task — no edit to a list, no flag, no
 * code change. `tests/unit/audio.test.ts` proves the engine half of that by
 * injecting the installed list. This proves the half that actually reads the
 * filesystem, which is the half that would silently rot.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'cycase-audio-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function install(...names: string[]): void {
  mkdirSync(path.join(root, 'audio', 'sfx'), { recursive: true });
  for (const name of names) {
    writeFileSync(path.join(root, 'audio', 'sfx', name), 'RIFF');
  }
}

describe('the installed-audio scan', () => {
  it('answers "nothing" for a tree with no audio directory at all', () => {
    // A checkout that has never had audio in it is a valid checkout. The safe
    // answer is an empty list and the degraded alarm, not a thrown config.
    expect(installedAudioPaths(root)).toEqual([]);
  });

  it('finds the three alarm files the moment they exist, and nothing else changes', () => {
    expect(installedAudioPaths(root)).toEqual([]);

    // The owner's entire task, simulated: copy the files in.
    install(...ALARM_ASSETS.map((asset) => path.basename(asset.path)));

    const found = installedAudioPaths(root);
    for (const asset of ALARM_ASSETS) {
      expect(found, `${asset.path} was not picked up`).toContain(asset.path);
    }
  });

  it('picks up a partial install without inventing the rest', () => {
    install('alarm-primary.wav');
    expect(installedAudioPaths(root)).toEqual(['/audio/sfx/alarm-primary.wav']);
  });

  it('emits browser URL paths, sorted, so two machines produce the same define', () => {
    install('b.wav', 'a.wav');
    mkdirSync(path.join(root, 'audio', 'vo'), { recursive: true });
    writeFileSync(path.join(root, 'audio', 'vo', 'line.wav'), 'RIFF');

    expect(installedAudioPaths(root)).toEqual([
      '/audio/sfx/a.wav',
      '/audio/sfx/b.wav',
      '/audio/vo/line.wav',
    ]);
  });

  it('ignores OS and editor debris', () => {
    install('alarm-primary.wav');
    writeFileSync(path.join(root, 'audio', 'sfx', '.DS_Store'), '');
    expect(installedAudioPaths(root)).toEqual(['/audio/sfx/alarm-primary.wav']);
  });

  it('knows nothing about the alarm — the manifest does the matching', () => {
    // The scan is a directory listing. Every path, licence and role stays
    // declared in exactly one place, which is what stops the two drifting.
    install('something-nobody-declared.wav');
    expect(installedAudioPaths(root)).toEqual(['/audio/sfx/something-nobody-declared.wav']);
  });
});

describe('what this repository actually ships', () => {
  it('installs none of the three alarm samples, so nothing is fetched', () => {
    /*
     * This is a statement of fact about the tree, not an aspiration. It fails
     * the day the files land — and that failure is the signal to update
     * `docs/AUDIO_ASSET_REQUEST.md`, `ASSET_LICENSES.md` and the degraded-path
     * E2E specs, all of which describe a repository without them.
     */
    expect(INSTALLED_ALARM_ASSETS).toEqual([]);
  });

  it('never lists an asset the manifest has not declared', () => {
    for (const asset of INSTALLED_ALARM_ASSETS) {
      expect(ALARM_ASSETS).toContain(asset);
    }
  });
});
