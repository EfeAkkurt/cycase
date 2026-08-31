# Alarm sounds go here

This directory is intentionally empty of audio. Three CC0 files belong in it and
they have to be downloaded by a signed-in human — Freesound does not serve
originals to an anonymous request.

    public/audio/sfx/alarm-primary.wav
    public/audio/sfx/alarm-impact.wav
    public/audio/sfx/alarm-alternative.wav

Sources, licences, the normalise routine and a listening checklist are in
`docs/AUDIO_ASSET_REQUEST.md`. The ledger rows are already written in
`ASSET_LICENSES.md`.

Copying the three files into this directory is the whole job. The build lists it
and tells the app what it found (`scripts/audioAssets.ts` →
`src/audio/manifest.ts`), so nothing needs editing afterwards — just rebuild, or
restart `npm run dev`, which restarts itself when a file appears here.

One trap worth knowing before you listen: only two of the three files make a
sound. `alarm-impact.wav` and `alarm-primary.wav` are the stab and the loop.
`alarm-alternative.wav` is fetched and decoded but never played — no code reads
it — so installing it changes nothing you can hear.

Until they land the app runs its degraded alarm treatment: silence from the
centre monitor's position, the red rim and the physical spill light, and copy
that says the alarm sound is not installed rather than describing a sound nobody
can hear. It also makes no request for them, so the demo path's console stays
clean. That path is tested — `tests/unit/audio.test.ts`,
`tests/unit/audioAssets.test.ts` and `tests/e2e/alarm-degraded.spec.ts` —
because it is the path the repository ships.
