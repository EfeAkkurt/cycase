/**
 * Sample loading that treats "the file is not there" as a normal answer.
 *
 * The repository ships **without** the three CC0 alarm files (Freesound
 * requires an account to download originals — see `docs/AUDIO_ASSET_REQUEST.md`),
 * so the absent case is the case that actually runs today.
 *
 * **A file the build did not find is never requested.** That is the first line
 * of defence and the cheapest: `INSTALLED_ALARM_ASSETS` is the intersection of
 * the nomination with a real listing of `public/audio/`, so the browser only
 * ever asks for something that exists. A run with no samples installed makes
 * zero audio requests and logs zero console errors, instead of three 404s for
 * an answer the build already had.
 *
 * The network guards below are still here, and still earn their place — they
 * are simply no longer the shipped path. They now cover the case the build
 * cannot see: **listed present at build time, unavailable at run time.** A
 * partial upload, a CDN that has not caught up with the new `dist/`, a host
 * rewriting unknown paths. Two specific failures, because each has bitten real
 * projects:
 *
 * 1. **A 404 is not an exception.** `fetch` resolves; only `response.ok` tells
 *    you. Without the check, a 404 body would be handed to the decoder.
 * 2. **A 200 is not proof of audio.** A single-page host commonly rewrites an
 *    unknown path to `index.html`, so the bytes arrive with status 200 and
 *    `decodeAudioData` rejects. That rejection has to be caught too.
 *
 * And the third guarantee is unchanged and unconditional: **one attempt, ever.**
 * The result — buffer *or* null — is memoised by the engine as the promise
 * itself, so a component that re-renders, or an alarm that restarts, can never
 * turn a slow or missing file into a request storm.
 */

import { ALARM_ASSETS, INSTALLED_ALARM_ASSETS, type AlarmAssetSpec } from './manifest';

export type SampleId = AlarmAssetSpec['id'];

export interface LoadedSamples {
  get(id: SampleId): AudioBuffer | null;
  /** True when at least the impact and the primary loop decoded. */
  readonly complete: boolean;
  /** Every path that was requested and did not yield audio. */
  readonly missing: readonly string[];
}

async function loadOne(
  context: BaseAudioContext,
  spec: AlarmAssetSpec,
  fetchImpl: typeof fetch,
): Promise<AudioBuffer | null> {
  try {
    const response = await fetchImpl(spec.path, { cache: 'force-cache' });
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    // An SPA fallback hands back HTML with a 200. Decoding rejects; that is a
    // missing asset, not a fault.
    return await context.decodeAudioData(bytes);
  } catch {
    return null;
  }
}

/**
 * Loads every *installed* alarm asset once. Never rejects: a caller only has to
 * decide what to do with the nulls.
 *
 * `installed` narrows what is fetched. It never narrows what is reported:
 * `missing` is always every nominated path that did not end up as audio, so a
 * file that was skipped because the build could not find it is missing in
 * exactly the same sense as one that 404'd. The on-screen caption saying the
 * alarm sound is not installed reads that list, and it has to stay true.
 */
export function loadAlarmSamples(
  context: BaseAudioContext,
  fetchImpl: typeof fetch = fetch,
  installed: readonly AlarmAssetSpec[] = INSTALLED_ALARM_ASSETS,
): Promise<LoadedSamples> {
  return Promise.all(
    installed.map(async (spec) => [spec, await loadOne(context, spec, fetchImpl)] as const),
  ).then((entries) => {
    const buffers = new Map<SampleId, AudioBuffer | null>();
    for (const [spec, buffer] of entries) buffers.set(spec.id, buffer);

    // Every declared asset, not every requested one.
    const missing = ALARM_ASSETS.filter((spec) => !buffers.get(spec.id)).map((spec) => spec.path);

    return {
      get: (id: SampleId) => buffers.get(id) ?? null,
      complete: Boolean(buffers.get('impact')) && Boolean(buffers.get('primary')),
      missing,
    };
  });
}

/** The empty result, for a page that never got as far as an AudioContext. */
export const NO_SAMPLES: LoadedSamples = {
  get: () => null,
  complete: false,
  missing: ALARM_ASSETS.map((asset) => asset.path),
};
