import { readdirSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/**
 * Which audio files are actually on disk, resolved once at config time.
 *
 * The three CC0 alarm samples are nominated in `src/audio/manifest.ts` but are
 * not in the repository — Freesound needs a signed-in human, see
 * `docs/AUDIO_ASSET_REQUEST.md`. The loader used to find that out the way a
 * browser finds anything out: by asking. Three requests, three 404s, three
 * console errors on every run of the demo path, for files we already knew were
 * absent.
 *
 * So the question is answered where it can be answered for free. This scans
 * `public/audio/` on the machine doing the build and substitutes the result as
 * `__CYCASE_INSTALLED_AUDIO__`, exactly the way `buildDefines.ts` substitutes
 * the build identity — same precedent, same two importers (`vite.config.ts` and
 * `vitest.config.ts`), so a bundle and the tests that guard it can never
 * disagree about which files exist.
 *
 * **It knows nothing about the alarm.** It lists a directory. `manifest.ts`
 * intersects that list with its own declarations, which is what keeps the
 * nomination — path, licence, author, role — in exactly one place. Drop the
 * three files into `public/audio/sfx/` and the next build fetches them with no
 * code change anywhere; that is the property `tests/unit/audioAssets.test.ts`
 * pins.
 */

/** `public/`, the directory Vite copies verbatim into the bundle. */
function publicRoot(): string {
  return fileURLToPath(new URL('../public', import.meta.url));
}

/**
 * Every regular file under `public/audio/`, as the URL path the browser would
 * request. Sorted, so two machines produce byte-identical defines.
 *
 * A missing directory is not an error: a checkout that has never had audio in
 * it is a valid checkout, and the answer is simply "nothing is installed".
 */
export function installedAudioPaths(root: string = publicRoot()): string[] {
  return walk(`${root}/audio`, '/audio').sort();
}

function walk(directory: string, urlPrefix: string): string[] {
  const found: string[] = [];
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    // Dotfiles are editor and OS debris (`.DS_Store`), never assets.
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      found.push(...walk(`${directory}/${entry.name}`, `${urlPrefix}/${entry.name}`));
    } else if (entry.isFile()) {
      found.push(`${urlPrefix}/${entry.name}`);
    }
  }
  return found;
}

/** The `define` map. One key, and it carries data rather than configuration. */
export function audioDefines(): Record<string, string> {
  return { __CYCASE_INSTALLED_AUDIO__: JSON.stringify(installedAudioPaths()) };
}
