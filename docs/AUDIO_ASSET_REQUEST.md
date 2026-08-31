# Audio asset request — three CC0 files a human has to download

**Status: blocked on a manual download. One person, about five minutes.**

**Updated 2026-08-30 (second pass).** An automated attempt to obtain these files was made
and failed; the record is below, including what was tried *instead* of Freesound and why
none of it was substituted. Nothing about the shipped build changed as a result. What did
change is this document: the conversion commands now normalise, the listening checklist is
now checkable rather than impressionistic, and one thing that was previously implied but
untrue — that installing all three files gives you three sounds — is corrected.

The alarm is fully implemented, wired, spatialised and tested. Three sound files
are missing from it, and they cannot be fetched by an automated agent: Freesound
requires a signed-in account to download originals.

## The download attempt, verbatim

Re-verified 2026-08-30T20:20:05Z, for all three sounds rather than one. Every original
redirects to the login page. No attempt was made to bypass, script or otherwise defeat that
login, and no Freesound API key was used — the project ships no API keys and adding one is
out of scope.

```
$ curl -sIL https://freesound.org/people/lfyaudio/sounds/848858/download/
HTTP/2 302
location: /home/login/?next=/people/lfyaudio/sounds/848858/

$ curl -sIL https://freesound.org/people/CAT-FOX_ALEX/sounds/859151/download/
HTTP/2 302
location: /home/login/?next=/people/CAT-FOX_ALEX/sounds/859151/

$ curl -sIL https://freesound.org/people/JW_Audio/sounds/828620/download/
HTTP/2 302
location: /home/login/?next=/people/JW_Audio/sounds/828620/
```

No preview MP3 has been substituted and no different asset has been quietly
swapped in. A Freesound preview is a lossy re-encode intended for auditioning in
the browser; shipping one as the alarm would be a quality decision made by
accident, and it would make this document unnecessary — which is exactly how a
placeholder becomes permanent.

## Why no directly-downloadable substitute was used

This is recorded so the next person does not spend the same hour. A directly-downloadable
CC0 alternative was searched for and **the corpus turned out to be the wrong corpus**, for a
reason specific to this project rather than a matter of taste.

The freely-downloadable public-domain alarm corpus is overwhelmingly *synthesised square
waves* — which is precisely the class of sound this project already auditioned, rejected and
deleted. The three best-licensed candidates found on Wikimedia Commons:

| Candidate | Licence tag | Why it fails here |
|---|---|---|
| `File:Alarm or siren.ogg` | `{{PD-author}}` — the cleanest of the set | The uploader's own description: a sine "distorted it. And made the volume shape a square-wave to make it 'beep - beep - beep'". This *is* the toy oscillator alarm that was removed from `engine.ts`. Installing it would reintroduce the rejected sound as a file. |
| `File:NFPA Fire Alarm.ogg` | `{{PD ineligible}}` | Description states it is "a 500Hz square wave" generated in Audacity. Same objection, plus the licence is an uploader's *copyrightability* claim, not an author's dedication. |
| `File:Sscmalarme gen.oga` | `{{PD-ineligible}}`, author `{{unknown}}` | A national civil-defence siren recording sourced from a cantonal government site, with no known author. Wrong texture — the alarm must come out of a monitor, not a rooftop — and an unknown-author PD-ineligible claim is not provenance a licence gate should accept. |

Everything else the search returned was either CC-BY-**SA** (share-alike, outside the CC0 /
commercial-CC-BY bar this project holds) or a field recording of a real emergency, including
active-conflict recordings that are not acceptable as game SFX at all.

Two commonly suggested sources were rejected on process, not taste: **Pixabay**'s licence
page returns a Cloudflare interstitial and **Mixkit**'s sound-effects terms render only
inside a JavaScript modal. Neither licence could be read, so neither could be quoted, so
neither could be relied on.

Finally, and independently of all of the above: an automated agent cannot listen. Choosing
the opening's single most important sound without auditioning it is the same accident this
document exists to prevent.

**Conclusion: the three named Freesound files remain the plan. They need a signed-in human.**

## What to do

Sign in to Freesound, download the original from each page below, then run the
normalise step. The loader, the manifest, the licence ledger and the tests are
already written against these three paths, and the app switches from its degraded
treatment to the real alarm **the next time it is built** — `npm run build`, or a
restart of `npm run dev`, which restarts itself when a file appears under
`public/audio/`.

Copying the files in is the whole task. Nothing needs editing: `scripts/audioAssets.ts`
lists `public/audio/` at config time and `src/audio/manifest.ts` intersects that listing
with the three nominations below, so the paths, licences and roles stay declared exactly
once. `tests/unit/audioAssets.test.ts` performs that copy against a temporary tree and
asserts it is picked up, which is why "no code change" is a checked claim rather than a
promise.

| # | Source page | Licence | Original file | Destination path in this repo |
|---|---|---|---|---|
| 1 | <https://freesound.org/people/lfyaudio/sounds/848858/> | CC0 1.0 | `848858__lfyaudio__large-digital-alarm.wav` (WAV, 48 kHz, 5.67 s) | `public/audio/sfx/alarm-primary.wav` |
| 2 | <https://freesound.org/people/CAT-FOX_ALEX/sounds/859151/> | CC0 1.0 | `859151__cat-fox_alex__stab-techno-stab-1.flac` (FLAC, 44.1 kHz, stereo, 2.81 s) | `public/audio/sfx/alarm-impact.wav` |
| 3 | <https://freesound.org/people/JW_Audio/sounds/828620/> | CC0 1.0 | `828620__jw_audio__scialrm-alarm-repeat-danger-warning-error-05-jw-audio.wav` (WAV, 96 kHz, stereo, 7.44 s) | `public/audio/sfx/alarm-alternative.wav` |

### Normalise on the way in

The previous version of this document converted formats but did **not** normalise, which
left the shipped level entirely at the mercy of three files nobody had measured. One routine
now handles all three cases — FLAC input, 96 kHz input, and level — in a single pass.

Save this as `normalise.sh` anywhere and `chmod +x` it:

```sh
#!/bin/sh
# normalise <in> <out> — peak-normalise to -1.0 dBFS, 48 kHz, 16-bit PCM WAV.
set -e
# Exactly two arguments, and the second must not already exist as a source you
# are about to read. A glob in argument one silently shifts everything along:
# `normalise a-*.wav dest.wav` with two matches makes $2 the SECOND SOURCE, and
# `ffmpeg -y` would then overwrite it.
[ $# -eq 2 ] || { echo "usage: normalise <in> <out>  (got $# arguments)" >&2; exit 2; }
in="$1"; out="$2"; ceiling="-1.0"
peak=$(ffmpeg -hide_banner -nostats -i "$in" -af volumedetect -f null - 2>&1 \
       | sed -n 's/.*max_volume: \(-*[0-9.]*\) dB.*/\1/p')
[ -n "$peak" ] || { echo "could not measure $in" >&2; exit 1; }
gain=$(awk -v c="$ceiling" -v p="$peak" 'BEGIN{printf "%.2f", c - p}')
echo "peak ${peak} dBFS -> applying ${gain} dB"
ffmpeg -hide_banner -nostats -loglevel error -y -i "$in" \
       -af "volume=${gain}dB" -ar 48000 -c:a pcm_s16le "$out"
```

Then:

```sh
./normalise.sh 848858__lfyaudio__large-digital-alarm.wav          public/audio/sfx/alarm-primary.wav
./normalise.sh 859151__cat-fox_alex__stab-techno-stab-1.flac      public/audio/sfx/alarm-impact.wav
# No glob here: quote the real filename once you have it on disk. The guard
# above turns a multi-match glob into an error rather than a lost source file.
./normalise.sh '828620__jw_audio__scialrm-alarm-repeat-danger-warning-error-05-jw-audio.wav' public/audio/sfx/alarm-alternative.wav
```

**Why -1 dBFS and not louder.** `src/audio/mix.ts` sets every level on the stated assumption
that each source's "worst case is a full-scale (±1.0) sample" — `ALARM_GAIN = 0.34` and
`IMPACT_GAIN = 0.4` are the *relative* balance between the loop and the stab. Normalising
each file independently to the same ceiling is what makes that balance the one you actually
hear. The -3 dBFS limiter on the master exists to protect against un-measured file levels;
this step is about not shipping a clipped file in the first place, not about protecting the
mix.

**Verify it worked** — the only output that counts is `max_volume: -1.0 dB`:

```sh
ffmpeg -hide_banner -nostats -i public/audio/sfx/alarm-primary.wav -af volumedetect -f null - 2>&1 | grep max_volume
ffprobe -v error -show_entries stream=sample_rate,channels,codec_name -of default=nw=1 public/audio/sfx/alarm-primary.wav
# expect: max_volume: -1.0 dB   /   pcm_s16le, 48000, (1 or 2 channels)
```

This routine was tested on this machine with ffmpeg 8.1.2, on synthetic inputs rather than
on the real files (which could not be obtained). It was proven in all three directions that
matter: a quiet source at -18.1 dBFS was raised to exactly -1.0; a 44.1 kHz stereo **FLAC**
was converted to 48 kHz `pcm_s16le` at exactly -1.0; and a source already peaking at
0.0 dBFS was **attenuated** to -1.0 rather than left to clip.

## Licences, verified

Each page was read before the sound was nominated. All three carry Creative
Commons 0, whose page text is *"You can copy, modify, distribute and perform the
sound, even for commercial purposes, all without the need of asking permission
to the author."* CC0 requires no attribution; the authors are credited in
`ASSET_LICENSES.md` anyway, because they should be.

| Sound | Author | Title | Licence on the page |
|---|---|---|---|
| Primary alarm | lfyaudio | Large digital alarm | Creative Commons 0 |
| Initial impact | CAT-FOX_ALEX | Stab-Techno Stab 1 | Creative Commons 0 |
| Alternative alarm | JW_Audio | SCIAlrm_Alarm, Repeat, Danger, Warning, Error_05 | Creative Commons 0 |

## What installing each file actually changes

Read this before listening, or you will listen for a difference that cannot happen.

| File | Effect when installed |
|---|---|
| `alarm-impact.wav` | **Audible.** The single stab after the duck. Scheduled at `engine.ts:378`. |
| `alarm-primary.wav` | **Audible.** The loop underneath it. Scheduled at `engine.ts:399`. |
| `alarm-alternative.wav` | **Silent — costs one extra request and changes nothing else.** |

`alarm-alternative.wav` is fetched and decoded *once it is installed*, but it is **never
played**. `grep -rn "alternative" src/` returns hits in `src/audio/manifest.ts` only. It
does not count toward `LoadedSamples.complete`, which is
`Boolean(impact) && Boolean(primary)` (`src/audio/samples.ts:89`), and `runAlarmSequence`
never reads it. The manifest's `role` string calls it "selectable in place of the primary";
there is no selector, in the UI or anywhere else.

That is a documentation overstatement, not a defect, and it is deliberately **not** being
fixed here: wiring a selector would be new behaviour in a release candidate. Install the
file — it completes the licence ledger — but expect no sound from it.

So: **two of the three files change what you hear.** None of the three changes the console:
with the files absent the page does not request them, and with the files present the
requests succeed. Either way the demo path logs zero errors.

## What the engine will do once the files land — verified by reading the code

Each of these was confirmed against the source on this branch, not taken from a comment. The
line numbers were re-checked at the commit that added the manifest presence gate; if one has
drifted again, grep for the named symbol rather than trusting the number.

- **Spatialised at the centre monitor.** `createEmitterPanner` (`engine.ts:734`) builds an
  HRTF panner positioned at `ALARM_EMITTER`, which `src/audio/spatial.ts` derives from
  `MONITOR_BY_ID.get('center').position` in `three/layout.ts`. It is created once in
  `unlock()` (`engine.ts:212`) and never moved, so the alarm cannot drift off the mesh it is
  supposed to come out of.
- **Ducks ambience, not itself.** Room tone runs `source → filter → gain → preRoll`
  (`engine.ts:584`). The alarm runs `gain → panner → speechDuck` (`engine.ts:213`), which
  bypasses `preRoll` entirely. `runAlarmSequence` ducks `preRoll.gain` to
  `DUCK_PREROLL_GAIN` (0.06), so the hole opens in the room and the interface while the
  alarm passes through at full level.
- **Impact, then loop.** The duck holds for `DUCK_HOLD_SECONDS` (0.2 s), the impact is
  scheduled at `impactAt` (`engine.ts:378`) and the loop starts
  `IMPACT_TO_ALARM_SECONDS` (0.28 s) later with `loop = true` (`engine.ts:399`). Everything
  is scheduled against `context.currentTime`, not `setTimeout`, so a busy main thread or a
  backgrounded tab cannot smear the shape.
- **Latches on acknowledgement.** `acknowledgeAlarm()` sets the phase to `'acknowledged'`
  (`engine.ts:320`) and `startAlarm()` returns immediately unless the phase is `'idle'`
  (`engine.ts:291`). Acknowledgement is therefore a one-way door.
- **Never restarts after mute/unmute.** `setMuted` writes the preference and calls
  `applyGain()`, which touches `master.gain` only (`engine.ts:235–239`, `547–552`). It does
  not read or write the alarm phase. The single call site that reopens the latch is
  `resetAlarm()` inside `unlock()` (`engine.ts:180`), and `unlock()` has exactly one caller
  in the app: `src/ui/intro/BootScene.tsx:18`. The provider's `alarm.reset`
  (`AudioProvider.tsx:47`) is never called from any UI component. A mute toggle cannot reach
  either.

Note the deliberate ordering in `play()`: the alarm's state transitions run *before* the
`if (this.mutedValue) return;` check, so acknowledging while muted still latches. Without
that, unmuting would resurrect a dismissed alarm.

## Listening checklist — observable pass/fail

Run the app, click through to the incident, and check each line. These are the checks
automation cannot make; every one is a thing you either hear or do not.

- [ ] **The room drops before anything hits.** A ~200 ms hole in the room tone, *then* the
      impact. If the stab arrives with no dip in front of it, the duck is not landing.
- [ ] **The impact fires once.** Exactly one stab per alarm, not one per re-render. The
      office pings `play('alert')` on a cadence; `startAlarm` is idempotent and must absorb it.
- [ ] **It comes from the centre monitor.** Look left and right with head-look: the alarm
      should move across the stereo field opposite to your turn. If it stays centred in your
      head regardless of where you look, HRTF is not engaged.
- [ ] **The loop enters underneath the impact,** about a quarter-second later, and keeps
      going — it does not retrigger from the top on every cycle.
- [ ] **Acknowledge silences it immediately,** followed by the relay click, and the room tone
      comes back up.
- [ ] **Acknowledge, then mute, then unmute: silence.** The dismissed alarm must not return.
      This is the one that has regressed before.
- [ ] **Mute mid-alarm, then unmute: it is still sounding,** at the point the loop has
      reached — muting is a level control, not a pause.
- [ ] **Restart the case.** The alarm arms again and sounds for the second run. (A second
      `unlock()` from the boot screen is what re-arms it.)
- [ ] **Nothing clips or hurts** at maximum volume with narration speaking over it.

## After the files land

```sh
node -e "console.log(require('fs').statSync('public/audio/sfx/alarm-primary.wav').size)"
npm run check:licenses      # the ledger rows are already written
npx playwright test --project=desktop tests/e2e/audio.spec.ts
```

**The licence gate is already proven to pass with the files present.** This was verified
empirically rather than predicted: three stand-in WAVs were written to the exact
destination paths, `npm run check:licenses` reported `clean: 25 shipped asset(s)` (up from
22) and `npx vitest run` was unchanged at 429 passed / 2 skipped, after which the stand-ins
were deleted. Be precise about what that proves: the stand-ins were **silent** 48 kHz WAVs,
so what was demonstrated is that the gate is filename-driven and indifferent to audio
content. It validates the *gate*, not the sound — the listening checklist above is still the
only thing that can validate the sound. Both directions of the gate hold — the three basenames already appear in
`ASSET_LICENSES.md`, and the ledger's alarm paths are written *without* backticks precisely
so that the "every backticked `public/` path exists" check does not fire while they are
absent. `public/asset-manifest.json` covers models, characters and textures only, so no
manifest byte-count needs updating.

The e2e spec has a branch for each case, so it passes both before and after —
it asserts the degraded contract when the files are absent and the sounding
contract when they are present, rather than being disabled in one of them.

Adding these files changes the product candidate. A new RC_SHA and a full matrix rerun are
required.

## What the build does while they are absent

This is the state the repository ships in today, so it is a tested path rather
than a hopeful one (`tests/unit/audio.test.ts`, `tests/e2e/audio.spec.ts`):

- **no path is requested at all.** The build lists `public/audio/`, finds none of
  the three, and `INSTALLED_ALARM_ASSETS` is empty — so the browser never asks
  for a file the build already knew was absent. A clean run makes zero audio
  requests and logs zero console errors;
- an *installed* path is still requested **once per page load** and no more, so
  a partial upload or a stale CDN cannot become a retry loop however many times
  the alarm starts (the result is memoised as the promise itself, `engine.ts`);
- a 404, or a 200 carrying an SPA fallback page, is still treated as missing —
  those guards now cover the build-says-present/server-says-no case rather than
  the everyday one, because `decodeAudioData` rejecting is the only way to tell
  HTML from audio;
- the alarm still runs its sequence: the room still ducks, one non-alarm
  transition cue still marks the moment from the centre monitor's position, the
  red rim and the physical spill light still pulse, and acknowledgement still
  latches;
- `AlarmStatus.assetsPresent` is `false`, and the UI copy for that case
  (`audio.alarm_caption_silent`) reads *"The centre monitor is flashing an alarm. The alarm
  sound is not installed in this build."* — it says the sound is missing rather than
  describing a sound nobody can hear.

## The voice surface, as shipped

`src/audio/VoiceSettings.tsx` is rendered in both places a player can be: the
office chrome, beside the mute and volume controls, and the dashboard top bar.
The voice list, the on/off toggle and the persisted choice are reachable in a
running build.

There is exactly **one** mute, not two. The caption's "Stop Voice" and this
toggle both write the speech engine's own preference (`cycase.speech_muted`),
which is also what gates `speak()`. They were briefly separate — pressing Stop
Voice left this toggle still reading "Narration on" — and that duplicate
preference has been removed.

Captions are never affected by any of it. `useSpeech()` returns `speak`,
`repeat`, `cancel` and `caption`, and the caption is populated for every line
whether or not a voice exists; `tests/e2e/narration.spec.ts` plays a complete
case muted-before-boot, reaching Contained 100/100 with the full text on screen
and `speechSynthesis.speak` recorded exactly zero times.
