# CYCASE — Cyber Case Simulation

> **Current release gate: NO-GO.** The binding product and implementation direction is [`docs/NODELESS_SOC_REDESIGN_2026-08-31.md`](./docs/NODELESS_SOC_REDESIGN_2026-08-31.md): NODE is removed, VERA is the only in-world assistant, and Codex teaches from outside the fiction over WebMCP. The core simulation, visible dynamic narration, browser TTS, GPU 3D tests and native seven-tool WebMCP pass. Release still requires owner visual approval, evidence regenerated from the final product SHA, the three alarm samples, manual player checks, HTTPS deployment and a real ChatGPT/Codex built-in-browser run. Older GO summaries and the pre-redesign audits and closeout prompts are historical.

Learn cyber incident response by investigating and acting **together with an AI
agent**, not by reading a fixed course.

CYCASE is a browser-based security operations simulation built for the OpenAI
WebMCP Challenge. A player works a synthetic incident in a real SOC dashboard.
The same incident is exposed to an agent through seven WebMCP tools registered on
`document.modelContext` — so ChatGPT and the player act on **one shared game
state**, and every agent call is visible on the player's screen the moment it
lands.

CYCASE is not a story game that walks through pre-written lines. The security
case is fully deterministic; the **narration is live**. Codex generates the
story, the teaching, the assistant's lines, the hints and the debrief in real
time — from the player's level, their choices, their mistakes, the evidence they
actually looked at, the explanation style they asked for and the current case
state — and delivers them through the seventh tool, `present_guidance`. With no
agent connected the page narrates from a deterministic fallback line set, and
the same run produces the same score and the same ending.

There is one other person in the room: **VERA**, the operations assistant. She
brings the incident and her report stays on screen until the player chooses what
to do with it. She is not the narrator. A generated line arrives in its own
channel headed **Generated guidance** — never under her name, and never as a
second character — and the label sits inside the announced region, so a screen
reader is told where a line came from on the same terms a sighted player is. The
guidance the engine derives from case state is headed **Case guidance**, for the
mirror-image reason: nothing generated it either. Codex is not in the room and
has no avatar — the player talks to it in Codex/ChatGPT, and it reads and
operates the simulation through WebMCP. The office scene contains the room, the
workstation, the monitors and VERA: no robot, pet, hologram or floating guide.

```text
Player request in ChatGPT
        |
        v
Page WebMCP tool call
        |
        v
Runtime validation -> stateVersion + idempotency check
        |
        v
Deterministic XState game machine
        |
        +--> dashboard changes
        +--> containment checklist updates
        +--> assistant state changes
        +--> player learns why
```

## Why WebMCP matters here

Without WebMCP an agent has to read screenshots and guess which pixel to click.
With it, the agent gets the same structured truth the UI renders from:

- `get_incident` returns the live summary, the open decision, and — when no
  decision is open — a `blockedDecision` naming the exact artifact or diagnostic
  that unblocks it. An agent can never be stuck without knowing why.
- Attacker-authored evidence comes back flagged `untrusted: true` with an
  explicit notice, so a phishing email is data, never instructions.
- Every mutating call carries `stateVersion` and `idempotencyKey`. Stale calls
  are refused with a recovery string; duplicate calls replay the original result
  instead of firing twice.
- The dashboard's own buttons call the **same domain functions** as the tools.
  There is exactly one way to change the game.
- `present_guidance` carries the generated narration and nothing else. It takes a
  message, a tone and a language and **names no speaker**: the words and the tone
  are the agent's, the delivery channel is the page's, so an agent cannot cast a
  second character. The published schema is closed, and the runtime validator
  keeps only the fields the contract declares, so a `speaker` never reaches the
  page. The tool never bumps `stateVersion`, never changes score, valid actions or
  progression, orders itself with its own `narrativeSequence`, and its message is
  inserted as text — markup, markdown links and URLs are refused with an
  explanation rather than silently stripped (`sanitiseGuidanceMessage`).

## Status

| Build order step (docs/PROJECT_CONTEXT.md §11) | State |
|---|---|
| 1. Deterministic Case 001 state machine and fixtures | Done |
| 2. Full 2D SOC dashboard on fixture data | Done |
| 3. WebMCP tools against the same actions | Done — six domain tools plus `present_guidance`, all seven verified in native Chrome |
| 4. 2D fallback plus manual and agent test flows | Done |
| 5. 3D office shell and monitor compact views | Done |
| 6. Assistant entrance and opening dialogue | Done |
| 7. Office-to-dashboard transition | Done |
| 8. Asset, accessibility and performance optimisation | Done |
| Dynamic narrative layer (`present_guidance`, captions, browser TTS) | Done — captions render in office and dashboard, one `speechSynthesis.speak` per line, proven in-browser |
| Nodeless SOC redesign (`docs/NODELESS_SOC_REDESIGN_2026-08-31.md`) | Part done — NODE is out of the scene, the office beats are `alarmUnacknowledged → acknowledged → assistantReporting → briefingChoice → (explained)` plus `resume`, the report no longer expires on a timer and the choices read "Explain the incident" and "Open response console". The six-destination information architecture and the three-monitor tool contract are **not built**: the dashboard still navigates Overview / Evidence / Identities / Assets / Timeline / Playbook |
| Visual/experience gate | Automated gates pass; composition and realism await human screenshot review (see `docs/screenshots/`) |
| Incident alarm samples | **Blocked on the owner** — the three CC0 files need a Freesound login; see `docs/AUDIO_ASSET_REQUEST.md` |
| Deployment and Codex built-in-browser proof | **Blocked on the owner** — needs a hosting account and a ChatGPT desktop session |
| 9. Demo video | Not started |

## Design system

**Structure** — concentric gray trays (12px outer, 4px frame inset, 8px inner),
a hard radius lock of 6/8/12 plus the pill, 32/36/44px controls, 44/32px rows,
20px pill chips, a 12–24px type scale on a 4pt grid, Inter at 13/18 with
−0.31px tracking and tabular numerals, 16px icons at 1.2 stroke. Two locks,
because they are what stop a system drifting: **no font weight above 500**, and
**no uppercase anywhere**.

**Colour** — warm neutral near-black (`#0B0B0A`) with bone text and restrained
amber focus. Decorative blue is prohibited. Red is reserved for active threats,
destructive conditions and the physical alarm moment. The one rule worth
stating: *a fill colour is not automatically a text colour*; every foreground
and status pairing must independently clear its required contrast threshold.

`tests/unit/tokens.test.ts` pins every structural token and every colour
anchor. Drift is a failing test, not a slow divergence.

## The office

A WebGL room with **real DOM monitor surfaces projected onto the bezels**. The
canvas draws the desk, the shells and the light; it never draws interface text.
Each monitor's screen quad is projected with the scene camera and a normal React
panel is laid onto it with a CSS `matrix3d` homography — so the telemetry stays
vector-crisp, selectable and reachable by keyboard, which a baked texture could
never be. The current build has constrained seated head-look and camera-aware
DOM projection. It does not add free walking or an open world.

Those panels are the *same components* the dashboard renders, in `compact` mode.
There is no second copy of the monitor data.

The desk, chair, cabinet, rack, lamp, notepads, stationery, thermos, plant and
bin are **CC0 scans from Poly Haven**, fetched and optimised by
`scripts/fetch-assets.mjs` — a reproducible pipeline, not a one-off download.
VERA's character mesh is CC0 as well, from the Quaternius animated character
pack. Floor and walls carry CC0 PBR texture sets. 3.5 MB of models — the ten
props and the character — and 380 KB of textures, all lazy-loaded with the office
chunk. Those are `public/asset-manifest.json`'s own derived totals, and
`tests/unit/assetManifest.test.ts` fails if they drift from the files on disk.

The monitor shells and keyboard are still modelled in code: no CC0 source
reachable from here publishes display hardware. They carry a real CC0
painted-metal PBR set. The three sources tried are recorded in
`docs/ASSET_PIPELINE.md`.

Three fallbacks, all of which keep the case completable:

- **3D off** — a toggle in the office chrome, remembered across reloads.
- **No WebGL, or a viewport under 1024px** — a flat monitor wall, same panels.
- **Reduced motion** — the entrance and the eyelid reveal are skipped rather
  than animated.

three.js is lazily imported, so the dashboard — where the case is actually
played, and where an agent spends all of its time — never downloads it.

Interface cues and room tone are synthesised at runtime with the Web Audio API: no library
and no sample files for those. The incident alarm is different — it is three CC0 samples
that are not in this build (see `docs/AUDIO_ASSET_REQUEST.md`), and with them absent the
alarm is visual-only and says so on screen rather than playing a stand-in. Narration is
spoken by the browser's own `speechSynthesis`, with a mandatory caption. Everything audible
stays behind one gesture gate: the `AudioContext` is constructed only inside `unlock()`,
which runs from the click that enters the simulation. Mute and volume are in the office
chrome and persist.

## Running it

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

### Verified numbers

Lighthouse against the production build. Lighthouse is not one of the thirteen
gates in `scripts/release-gates.sh`; these scores came from an earlier run and
are due to be re-measured on the release SHA:

| Category | Score | Target |
|---|---:|---:|
| Performance | 98 | 85+ |
| Accessibility | 100 | 95+ |
| Best Practices | 100 | 95+ |
| SEO | 100 | — |

The normal local/dashboard and native WebMCP paths have no console/page/network errors
and make zero third-party requests. The intentionally degraded alarm path reports the
three missing owner-supplied WAVs and shows a visual-only notice; see
`docs/AUDIO_ASSET_REQUEST.md`. Axe reports no serious or critical violations on any route,
in either motion mode.

| Bundle | Size | Gzipped |
|---|---:|---:|
| Initial JS + CSS (app, dashboard, WebMCP) | 507 KB | 150 KB |
| Office chunk (three.js), loaded only for the 3D room | 984 KB | 268 KB |
| CC0 models and textures, fetched only by the 3D room | 3.8 MB | — |

The first two rows are the build gate's own output at the last recorded release
candidate, `e28672b`; the third is the asset manifest's derived total. The
commits that removed NODE landed after that gate run, so the next matrix has to
measure the bundles again. The budget in `docs/PRODUCT_SPEC.md` is 12 MB of
critical first-load transfer and 8 MB of GLB. Neither is close to being spent.

```bash
npm run build        # production build
npm run preview      # serve the production build
npm test             # unit tests (game core, budget, live layer, replay)
npm run test:e2e     # browser tests (manual path, agent path, accessibility)
npm run test:3d      # the GPU suite: headed, one worker, real Chrome
npm run test:webmcp:native   # the seven tools in installed Chrome, no shim
npm run test:all     # typecheck, lint, unit, backend, integration, e2e, 3D,
                     # secrets and licences — not the native WebMCP gate

# The eight QA review captures, written to docs/screenshots/. They are part of
# the GPU project, so the headless `desktop` project matches none of them.
npx playwright test screenshots --project=desktop-3d
```

## Trying the agent path

In a browser that exposes WebMCP, open the page and the top bar shows the number
of registered tools — currently seven. The rail lists them, with a button that
copies a starter prompt. If the browser exposes WebMCP but rejects a descriptor, the badge says
so — "supported but incomplete" is a different failure from "unsupported", and
the panel prints the rejection.

> **Native Chrome verified at seven tools; the Codex product gate remains open.**
> Chrome 151 accepted and discovered all seven descriptors, including
> `present_guidance`, without the shim. Native
> `get_incident` and `submit_decision` calls mutated the shared runtime and the
> visible page from v0 to v1, and the whole case ran natively to the deterministic
> contained ending. The suite is `tests/e2e/webmcp-native.spec.ts`. The same
> case must still pass once in the ChatGPT desktop built-in browser with Codex,
> because Chrome support alone does not prove account rollout or the final agent
> surface. That gate is tracked in `docs/CODEX_WEBMCP_INTEGRATION.md`.

Without WebMCP the page says so plainly and stays **fully playable** — feature
detection is a product decision here, not just a guard.

The e2e suite drives the page's own registered tools through a shim that behaves
like `document.modelContext`, so the agent path is tested end to end without
needing a supported browser (`tests/e2e/webmcp.spec.ts`).

## The case

**CASE-001 "Session Ghost"** — a phishing message leads to a cloned sign-in
page, a stolen session cookie, a sign-in that never triggers MFA, mass file
enumeration and a partially-blocked data export.

Two layers, deliberately separated:

- **Decisions (D1–D6)** are pedagogical branches answered with `submit_decision`.
  Choosing the weaker option is not an error — it returns `ok: true` with a cost
  and an explanation, and sometimes a real consequence (deleting the phishing
  message destroys that evidence permanently).
- **Operations** are the real SOC actions: `inspect_artifact`, `run_diagnostic`
  and the five `take_response_action` ids — the four that actually contain the
  incident, and `close_case`, which is refused until the closing decision D6 has
  been submitted.

### Real-time

Nothing on screen animates a random number. The chart window slides because the
simulation clock advances and every sample is drawn from the incident's own
profile; the case log is append-only, timestamped on that same clock, and
derived from case state rather than stored, so it cannot disagree with the
incident it reports. Feed and agent status carry a last-update age. The
simulation can be paused — and pausing, like ticking, never touches
`stateVersion`, so it can't invalidate an agent's in-flight call.

A run is `(createInitialContext, commandLog)`. `replay()` feeds that back
through the same pure executor and lands on the same state; `live.test.ts`
asserts it, consequences included.

A flawless run scores exactly 100 across four buckets. The score is a pure
function of an append-only log, so a run is replayable and auditable, and no
model ever writes it.

### What is generated, and what is not

**Deterministic — engine only, never the model:** valid actions, telemetry and
evidence relationships, state progression, consequences, score, idempotency,
security boundaries, scenario schema validation.

**Dynamic — Codex generates, the page renders:** the assistant's lines, the level
and tone of explanation, hints, the educational response to a mistake, the
explanation the player asks for before opening the response console, the debrief
narrative, and the content of future schema-validated case packs.

An LLM must never decide score, a valid action, or state progression. That is the
line, and it is enforced by the tool surface: the six domain tools go through the
engine, and the seventh cannot reach it. Every spoken line is also shown in full
as a caption, and the player can Skip, Repeat or Stop voice at any time.

Every identity, domain, IP, device and log line is synthetic. See
[ASSET_LICENSES.md](./ASSET_LICENSES.md).

## Architecture

```text
src/game/          deterministic core — no React, no DOM, no clocks
  types.ts         ids, contracts, context shape
  fixtures/        Case 001 content and derived telemetry
  engine.ts        the single pure command executor
  machine.ts       XState scene graph; context is the case
  runtime.ts       the seam both the UI and WebMCP call
  validation.ts    zod schemas — the real gate; JSON Schema is only a model hint
  scoring.ts       pure, clamped, auditable
src/ui/            React DOM and SVG; panels have compact and full modes
src/game/live.ts   the sliding window, the case log, feed health — all derived
src/game/replay.ts rebuild a run from its command log
src/three/         the WebGL office, and the projection that puts DOM on it
  layout.ts        room, desk and monitor geometry — one source of truth
  assets.tsx       CC0 model loading, placement by base centre, warm environment
  projection.ts    screen quads and the stable camera, as pure functions
  homography.ts    four-point mapping -> CSS matrix3d
src/audio/         synthesised cues, browser speech; alarm samples expected in
                   public/audio/sfx/ (absent — the build runs silent-but-honest without them)
src/webmcp/        tool definitions, registration lifecycle, result compaction
src/i18n/          every user-visible and agent-visible string
```

The engine is a pure function of `(context, command)`. It has no clock and no
randomness, which is why the whole case is replayable and why the unit suite
runs in milliseconds without a browser.

## Documentation

Implementation contracts live in [`docs/`](./docs). The order below is the order
of precedence: where two documents disagree, the higher one wins.

- [NODELESS_SOC_REDESIGN_2026-08-31.md](./docs/NODELESS_SOC_REDESIGN_2026-08-31.md) — **binding** product and implementation direction; read it before any older prompt or audit
- [PROJECT_CONTEXT.md](./docs/PROJECT_CONTEXT.md) — orientation for a new contributor or agent; read first for the shape of the project
- [PRODUCT_SPEC.md](./docs/PRODUCT_SPEC.md)
- [GAME_FLOW.md](./docs/GAME_FLOW.md)
- [WEBMCP_CONTRACT.md](./docs/WEBMCP_CONTRACT.md) — the seven tools as they now stand
- [DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md)
- [ASSET_PIPELINE.md](./docs/ASSET_PIPELINE.md)
- [BACKEND_RUNTIME_CONTRACT.md](./docs/BACKEND_RUNTIME_CONTRACT.md) — persistence, replay and telemetry boundary
- [CODEX_WEBMCP_INTEGRATION.md](./docs/CODEX_WEBMCP_INTEGRATION.md) — Codex site-tools contract and test matrix

Historical, kept as a record and superseded by the redesign wherever they
disagree — do not execute them as instructions:

- [VISUAL_RESET.md](./docs/VISUAL_RESET.md) — the earlier art-direction reset

## License

[MIT](./LICENSE). Third-party assets are recorded in
[ASSET_LICENSES.md](./ASSET_LICENSES.md).
