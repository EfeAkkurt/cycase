# Asset Licenses

Every third-party or generated asset that ships in the build has a row here.
Nothing enters `public/` or `src/` without one.

## Fonts

The shipped typefaces are recorded under [Typefaces](#typefaces) below — Inter and
JetBrains Mono, both under the SIL Open Font License 1.1. Both are self-hosted, so
the running page makes **no** third-party font request. IBM Plex was removed when
the design system changed and no longer ships; `public/fonts/` holds those two
files and nothing else.

## Images

| Asset | Local path | Source | License | Use |
|---|---|---|---|---|
| Favicon | `public/favicon.svg` | Authored for this repository | MIT (this repo) | Shipped; original shield-and-alert mark, no third-party marks |
| Office concept v1 | `docs/assets/office-concept-v1.png` | OpenAI image generation | AI-generated; used as a build reference | Documentation only — **not** shipped in the build and not used as a texture |
| Office concept v2 (neutral) | `docs/assets/office-concept-v2-neutral.png` | OpenAI image generation | AI-generated; the art direction reference for `docs/VISUAL_RESET.md` | Documentation only — **not** shipped and not used as a texture |

## Icons and illustration

All icons are original inline SVG authored for this repository
(`src/ui/primitives/index.tsx`). No icon font, no third-party icon set, and no
OpenAI/Codex marks.

## Case data

Every identity, domain, IP address, device name, hash and log line in
`src/game/fixtures/case001.ts` is fictional and written for this project.
Addresses use the documentation ranges reserved for exactly this purpose:

- `203.0.113.0/24` — RFC 5737 TEST-NET-3
- `198.51.100.0/24` — RFC 5737 TEST-NET-2
- `AS64500` — RFC 5398 documentation ASN

Domains (`cy-case.corp`, `cy-case-secure-id.net`, `sso-cycase-verify[.]net`) are
invented, defanged where they represent attacker infrastructure, and resolve to
nothing. The case contains no exploit code, no payload and no runnable command.

## 3D office

Every model and every room material is **CC0 1.0** from
[Poly Haven](https://polyhaven.com), fetched and optimised by
`scripts/fetch-assets.mjs`. Delete `public/models` and `public/textures`, run
`node scripts/fetch-assets.mjs`, and the same files come back — the manifest it
writes (`public/asset-manifest.json`) is the source of the rows below.

Poly Haven publishes everything under CC0: <https://polyhaven.com/license>.
No attribution is required; the authors are credited here because they should be.

### Models

Downloaded as 1k glTF, then optimised to a single `.glb` with
`@gltf-transform/cli` — WebP textures, per-asset size cap, `quantize`
compression. Quantize rather than Draco or Meshopt: both of those need a
decoder wired into `GLTFLoader` at runtime, and a missing decoder fails silently.

| Asset | Role | Author(s) | File | Size |
|---|---|---|---|---:|
| [metal_office_desk](https://polyhaven.com/a/metal_office_desk) | Desk | Ulan Cabanilla | `public/models/metal_office_desk.glb` | 291 KB |
| [modern_arm_chair_01](https://polyhaven.com/a/modern_arm_chair_01) | Operator chair | Vibrant Nordic | `public/models/modern_arm_chair_01.glb` | 419 KB |
| [drawer_cabinet](https://polyhaven.com/a/drawer_cabinet) | Cabinet behind the desk | Ulan Cabanilla | `public/models/drawer_cabinet.glb` | 589 KB |
| [worn_metal_rack](https://polyhaven.com/a/worn_metal_rack) | Equipment rack | Luca B | `public/models/worn_metal_rack.glb` | 240 KB |
| [desk_lamp_arm_01](https://polyhaven.com/a/desk_lamp_arm_01) | Desk lamp — the warm practical | Yann Kervran, Kuutti Siitonen | `public/models/desk_lamp_arm_01.glb` | 614 KB |
| [office_notepads](https://polyhaven.com/a/office_notepads) | Desk clutter | Ulan Cabanilla | `public/models/office_notepads.glb` | 34 KB |
| [stationery_supplies](https://polyhaven.com/a/stationery_supplies) | Desk clutter | Mateusz Sadek | `public/models/stationery_supplies.glb` | 159 KB |
| [plastic_thermos](https://polyhaven.com/a/plastic_thermos) | Desk clutter | PierreB3D | `public/models/plastic_thermos.glb` | 157 KB |
| [potted_plant_01](https://polyhaven.com/a/potted_plant_01) | Background plant | Rico Cilliers | `public/models/potted_plant_01.glb` | 207 KB |
| [metal_trash_can](https://polyhaven.com/a/metal_trash_can) | Floor clutter | GurJas Studios | `public/models/metal_trash_can.glb` | 342 KB |

**Total: 3051 KB** for these ten props. Adding the CC0 colleague recorded under
[Characters](#characters) below, the build ships eleven GLB files totalling
3543 KB, against an 8 MB GLB budget.

Every size in this file is measured from the files on disk. That began as a
guard against the manifest: `totals.modelBytes` once carried the colleague's
pre-regeneration size and read 184,088 bytes light, because the rollup was
accumulated beside the entries instead of derived from them. It is derived now
and the two agree — every per-asset `bytes`, both subtotals and `totalBytes`
match disk exactly, which `tests/unit/assetManifest.test.ts` checks against the
shipped file rather than a fixture. Measuring from disk stays, because it is the
measurement that would catch the drift a second time.

### Original work

| Asset | Where it lives | What it is |
|---|---|---|
| The interface cues and room tone | `src/audio/engine.ts` | Synthesised in the Web Audio API: filtered noise bursts and oscillator tones. No sample files and no library. The incident alarm is **not** synthesised — see "The alarm — three CC0 sounds" below. With those three files absent, as they are today, it makes no sound at all (`src/audio/engine.ts`, the `degraded` branch). |

## Characters

| Asset | Local path | Source | Creator | Licence | Notes |
|---|---|---|---|---|---|
| Suit Female (scripted colleague, "VERA") | `public/models/colleague_suit_female.glb` | [Quaternius — Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html) | Quaternius | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | `glTF/Suit_Female.gltf` from the pack, converted to a single GLB by the asset pipeline. Source SHA-256 `37cbe38d…e1f07` pinned in `public/asset-manifest.json`. Clips used: Idle, Walk. 491 KB. Redistribution permitted; no attribution required, given here anyway. |

CC0 waives copyright entirely, so redistribution inside this repository is permitted and
no attribution is required. It is recorded regardless — an unattributed asset is an asset
whose provenance nobody can check later.

## Textures

All files below are served from `public/textures/`.

Downloaded as 1k JPEG and re-encoded to 512px WebP. `arm` packs
ambient-occlusion, roughness and metalness into R/G/B, which is exactly how
three.js reads a single image assigned to `aoMap`, `roughnessMap` and
`metalnessMap`.

| Asset | Role | Author(s) | Maps | Size |
|---|---|---|---|---:|
| [concrete_floor_02](https://polyhaven.com/a/concrete_floor_02) | Floor | Rob Tuytel | `concrete_floor_02_diff.webp`, `concrete_floor_02_nor.webp`, `concrete_floor_02_arm.webp` | 152 KB |
| [painted_plaster_wall](https://polyhaven.com/a/painted_plaster_wall) | Walls | Amal Kumar | `painted_plaster_wall_diff.webp`, `painted_plaster_wall_nor.webp`, `painted_plaster_wall_arm.webp` | 55 KB |
| [metal_plate](https://polyhaven.com/a/metal_plate) | Shipped, currently unbound (see below) | Rob Tuytel | `metal_plate_diff.webp`, `metal_plate_nor.webp`, `metal_plate_arm.webp` | 173 KB |

**Total: 380 KB.** Everything is lazy-loaded with the
office chunk; the dashboard never fetches any of it.

**`metal_plate` has no consumer in the scene.** Its stated role was "monitor
shells and keyboard", and it is now applied to neither: it is a photograph of
painted sheet steel, and both of those surfaces are moulded plastic. The monitor
bezels stopped using it when three identical panels started rendering up to 3x
apart in value because the tiling put a different patch of speckle on each; the
keyboard stopped using it in the visual pass that gave the board its full key
field, since a modelled plastic case has none of the underlying detail a
photographic metal albedo implies.

It is recorded here rather than quietly removed, because the choice belongs to
the owner and both options are defensible. Either retire the three files (and
the manifest rows, the counts quoted in `README.md`, and this table with them),
or bind the set to a surface that genuinely is painted metal. It ships and is
correctly licensed either way; while unbound it is never requested at runtime,
so it costs 0 bytes of transfer and 173 KB of repository.

### What is still modelled in code

The monitor shells, the keyboard, the mouse, the desk mat, the cable runs and
the desk clutter (`src/three/Workstation.tsx`), and the whole SOC backdrop —
server cabinets and their status LEDs, the blinded window and the street beyond
it, the doorway and its corridor, the wall shelf and its binders, the
whiteboard, the acoustic treatment and the suspended ceiling
(`src/three/Backdrop.tsx`). No CC0 source reachable from this environment
publishes a monitor or a keyboard — see the second amendment in
`docs/ASSET_PIPELINE.md` for the three sources tried — and nothing publishes a
security-operations backdrop at all. Every one of these is primitive geometry
authored in this repository, carrying flat scene-palette materials whose
roughness and metalness are chosen for the material each part actually is —
moulded ABS for the monitor shells and the keyboard case, matte plastic for the
mouse, PVC for the cable jackets. None of it is downloaded, so none of it costs
a byte of transfer.

No floating companion object is modelled alongside any of it. The procedural
companion mesh this file used to record was deleted outright under
`docs/NODELESS_SOC_REDESIGN_2026-08-31.md`, and its rows are gone rather than
marked historical, because a licence ledger states what the build ships today.
The one in-world assistant is the scripted colleague.

She is no longer primitive geometry: she is a licensed CC0 character
from the Quaternius Ultimate Animated Character Pack, recorded under [Characters](#characters) above and
pinned by source hash in `public/asset-manifest.json` so a re-fetch that returns different
bytes fails rather than silently substituting a different model.

## Typefaces

| Asset | Licence | Source | Files |
|---|---|---|---|
| Inter (variable) | SIL Open Font License 1.1 | [rsms.me/inter](https://rsms.me/inter/) via `@fontsource-variable/inter` | `public/fonts/inter-latin-wght-normal.woff2` |
| JetBrains Mono (variable) | SIL Open Font License 1.1 | [jetbrains.com/lp/mono](https://www.jetbrains.com/lp/mono/) via `@fontsource-variable/jetbrains-mono` | `public/fonts/jetbrains-mono-latin-wght-normal.woff2` |

Both are self-hosted; the page makes no font request to a third party. 87 KB
combined (48,256 + 40,404 bytes). The OFL permits redistribution with the
software.

IBM Plex Sans and Mono were removed when the design system changed — dead bytes
are worse than none.

## Audio

### Interface cues — synthesised

The interface cues (typing, confirmation, reveal, scene transition, footsteps,
the acknowledgement relay click and the room tone) are synthesised at runtime
with the Web Audio API in `src/audio/engine.ts`: filtered noise bursts and
oscillator tones. No sample library, no audio file, no third-party audio code,
zero bytes of transfer.

### The alarm — three CC0 sounds, **not yet in this repository**

The oscillator alarm was removed: a two-tone square wave is not what a security
incident sounds like. Its replacement is a sample played through an HRTF panner
at the centre monitor's position. The three files below were chosen and their
licences verified on their own pages, but **none of them is in the repository
yet** — Freesound requires a signed-in account to download originals, and a
lossy preview is not an acceptable stand-in for a production asset.

`docs/AUDIO_ASSET_REQUEST.md` carries the full instructions, including the
conversion commands. The rows below are written in advance so that dropping the
files in is the only remaining step; the paths are given without backticks on
purpose, because `scripts/check-licenses.mjs` verifies that every backticked
`public/` path in this file exists on disk.

| Asset | Author | Title | Licence | Source | Destination (pending) |
|---|---|---|---|---|---|
| Primary alarm | lfyaudio | Large digital alarm | CC0 1.0 | <https://freesound.org/people/lfyaudio/sounds/848858/> | public/audio/sfx/alarm-primary.wav |
| Initial impact | CAT-FOX_ALEX | Stab-Techno Stab 1 | CC0 1.0 | <https://freesound.org/people/CAT-FOX_ALEX/sounds/859151/> | public/audio/sfx/alarm-impact.wav |
| Alternative alarm | JW_Audio | SCIAlrm_Alarm, Repeat, Danger, Warning, Error_05 | CC0 1.0 | <https://freesound.org/people/JW_Audio/sounds/828620/> | public/audio/sfx/alarm-alternative.wav |

CC0 permits copying, modification, distribution and commercial use with no
permission and no attribution required; the authors are credited here anyway.
Planned modifications on the way in: format conversion to 16-bit PCM WAV, a
resample to 48 kHz, and a peak normalisation to -1.0 dBFS (the routine and its
verification command are in `docs/AUDIO_ASSET_REQUEST.md`). Redistribution is
permitted.

A directly-downloadable substitute was searched for on 2026-08-30 and none was
adopted. The freely-downloadable public-domain alarm corpus is dominated by
synthesised square waves — the exact sound removed from this project — and the
remaining candidates were either share-alike, of unknown authorship, or
recordings of real emergencies. `docs/AUDIO_ASSET_REQUEST.md` names the
candidates and the reason each was rejected.

The build behaves correctly with all three absent — that is the state it ships
in today, and it is covered by `tests/unit/audio.test.ts` and
`tests/e2e/audio.spec.ts` rather than merely intended.

### Narration — the browser's own voice

Spoken narration uses `window.speechSynthesis` (`src/audio/speech.ts`). The
voices belong to the player's browser and operating system; nothing is
downloaded, bundled or licensed by this project, and no third-party or paid
speech service is contacted. The UI says so in `settings.voice_hint`.

## Runtime dependencies

Every package declared in `package.json` under `dependencies`, plus the single
`optionalDependencies` entry. Each licence below is the `license` field of that
package's own `node_modules/<name>/package.json` at the version
`package-lock.json` resolves; the versions are recorded because a licence is only
established for the version it was read from.

| Package | Version | License | Where it ships |
|---|---|---|---|
| react, react-dom | 19.2.8 | MIT | Main bundle |
| xstate | 5.32.6 | MIT | Main bundle |
| @xstate/react | 5.0.5 | MIT | Main bundle |
| zod | 4.4.3 | MIT | Main bundle |
| three | 0.185.1 | MIT | Lazy office chunk only — `src/ui/office/Office.tsx` reaches `Office3D` through `lazy(() => import('./Office3D'))`, so it lands in `dist/assets/Office3D-*.js` and not in the entry bundle |
| @react-three/fiber | 9.7.0 | MIT | The same lazy office chunk |
| recharts | 3.8.0 | MIT | Lazy chart chunk (`dist/assets/chart-*.js`), pulled in by the dashboard's telemetry and score-breakdown views |
| fastify | 5.12.1 | MIT | **Not in the client bundle.** Imported only by `server/`, which `npm run build` (`tsc -b && vite build`) does not compile, and connected backend mode is disabled in the shipped app |
| pg | 8.23.0 | MIT | Optional, and **not in the client bundle.** `server/persistence/postgresRepository.ts` loads it through a dynamic specifier so the build and the tests run with it absent |

`three` and `@react-three/fiber` are the largest thing the project ships, and they
are the reason the office is a separate chunk: a player who never enters the
office never fetches them.

Transitive packages are not listed row by row. The resolved tree
(`npm ls --omit=dev --all`) is 132 packages; reading the `license` field of every
one gives 106 MIT, 15 ISC, 8 BSD-3-Clause, one `MIT AND ISC` (`victory-vendor`, a
recharts dependency that does ship), one `0BSD` (`tslib`) and one
`Apache-2.0 AND LGPL-3.0-or-later AND MIT` (`@img/sharp-wasm32`). Not one declares
a missing or unknown licence. That last entry is the only copyleft term anywhere
in the tree and it does **not** ship: it is an optional platform binary of the
dev-only `sharp`, npm marks it extraneous in a production listing, and
`grep -rl '@img/sharp' dist/` returns nothing.

Build and test tooling (Vite, TypeScript, Vitest, Playwright, axe-core, sharp,
tsx, ESLint) is dev-only and does not ship. axe-core is MPL-2.0 and is used for
testing only.
