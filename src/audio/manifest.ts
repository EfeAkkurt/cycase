/**
 * The alarm sample manifest.
 *
 * Three CC0 files from Freesound, verified on their own pages before being
 * nominated. Freesound requires an account to download originals, so at the
 * time of writing **none of them are in the repository** — see
 * `docs/AUDIO_ASSET_REQUEST.md`. A missing file is a normal, expected outcome
 * here, not an error path.
 *
 * Two lists come out of this module and the difference between them is the
 * whole point:
 *
 * - `ALARM_ASSETS` is the **nomination** — every file the alarm wants, with its
 *   licence, author and role. It does not change when a file lands.
 * - `INSTALLED_ALARM_ASSETS` is the **intersection** with what the build
 *   actually found on disk. It is the only list the loader is allowed to fetch,
 *   which is what makes a clean run cost zero failed requests instead of three
 *   404s and three console errors for files we already knew were absent.
 *
 * Nothing is hand-maintained: `scripts/audioAssets.ts` lists `public/audio/` at
 * config time and substitutes it below. Drop the three files in, build, and
 * they are fetched — no edit to this file or any other.
 *
 * Paths are relative to `public/`, which is how the rest of the project
 * addresses its CC0 assets (`three/layout.ts` MODEL_FILES).
 */

export interface AlarmAssetSpec {
  /** Stable key used by the engine and by the tests. */
  id: 'primary' | 'impact' | 'alternative';
  /** Public URL the browser fetches. */
  path: string;
  /** Freesound page, for the licence audit. */
  source: string;
  licence: 'CC0 1.0';
  author: string;
  title: string;
  role: string;
}

export const ALARM_ASSETS: AlarmAssetSpec[] = [
  {
    id: 'impact',
    path: '/audio/sfx/alarm-impact.wav',
    source: 'https://freesound.org/people/CAT-FOX_ALEX/sounds/859151/',
    licence: 'CC0 1.0',
    author: 'CAT-FOX_ALEX',
    title: 'Stab-Techno Stab 1',
    role: 'The single initial impact that lands after the room ducks.',
  },
  {
    id: 'primary',
    path: '/audio/sfx/alarm-primary.wav',
    source: 'https://freesound.org/people/lfyaudio/sounds/848858/',
    licence: 'CC0 1.0',
    author: 'lfyaudio',
    title: 'Large digital alarm',
    role: 'The looping alarm, emitted from the centre monitor.',
  },
  {
    id: 'alternative',
    path: '/audio/sfx/alarm-alternative.wav',
    source: 'https://freesound.org/people/JW_Audio/sounds/828620/',
    licence: 'CC0 1.0',
    author: 'JW_Audio',
    title: 'SCIAlrm_Alarm, Repeat, Danger, Warning, Error_05_JW Audio',
    role: 'Alternative loop, selectable in place of the primary.',
  },
];

export const ALARM_ASSET_BY_ID = new Map(ALARM_ASSETS.map((asset) => [asset.id, asset]));

/**
 * Every file the build found under `public/audio/`, substituted by
 * `scripts/audioAssets.ts`.
 *
 * Guarded with `typeof` the same way `buildInfo.ts` guards the build identity:
 * a bundler that does not run this project's config leaves the identifier
 * undeclared, and the safe answer there is "nothing is installed" — the
 * degraded alarm, which is a shipped, tested path.
 */
declare const __CYCASE_INSTALLED_AUDIO__: readonly string[];

const INSTALLED_PATHS: readonly string[] =
  typeof __CYCASE_INSTALLED_AUDIO__ === 'undefined' ? [] : __CYCASE_INSTALLED_AUDIO__;

/**
 * The subset of the nomination that is really on the server.
 *
 * Today this is empty and the alarm runs its degraded treatment. It is not a
 * placeholder to be edited: it is a build product, and it fills itself in the
 * moment the files exist.
 */
export const INSTALLED_ALARM_ASSETS: readonly AlarmAssetSpec[] = ALARM_ASSETS.filter((asset) =>
  INSTALLED_PATHS.includes(asset.path),
);
