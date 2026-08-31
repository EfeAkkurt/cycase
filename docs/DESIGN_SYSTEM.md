# Design System

## Visual Direction

Quiet operational tension. The room is believable, tactile and restrained, not a neon cyberpunk set or a generic AI dashboard. See `VISUAL_RESET.md`; its V2 direction overrides earlier screenshots.

## Design System

`src/styles/tokens.css`, not a rewrite. `tests/unit/tokens.test.ts` pins
both halves.

### Colour — carbon surfaces, audit-contract accents

Warm neutral near-black with bone text. The accent is amber and red is reserved
for threats, per the binding audit contract (P0.4) — no blue anywhere, enforced
by the reinstated pixel gate and a token-file guard.

| Token | Value | Role |
|---|---:|---|
| `carbon` | `#0B0B0A` | Page |
| `carbon-sunken` → `tray-bg` | `#141413` | Gray tray |
| `carbon-raised` → `tray-cell-bg` | `#171716` | Inner surface, cards |
| `plate` → `tray-cell-hover` | `#201F1C` | Row hover |
| `gray-medium` → `border-default` | `#2A2926` | Borders |
| `bone` → `text-primary` | `#F2F0ED` | Primary text — 15.8:1 on raised |
| `text-secondary` | `bone @ 62%` | Secondary — 6.7:1 |
| `gray-dark` → `text-tertiary` | `#8F8B87` | Tertiary — 5.3:1 |
| `brand-primary` | `#C8A26A` | Accent fill and text; carbon text on it 8.3:1, as text on page 8.3:1 |
| `brand-primary-hover` | `#D4B078` | Hover ramp |
| `status-success` | `#8FAE75` | Success text — 6.0:1 on its chip (fill `#7E9464`) |
| `status-warning` | `#F07A34` | Warning — 5.4:1 on its chip |
| `status-error` | `#E8695C` | Error text — 4.9:1 on its chip (fill `#E2604E`) |
| `status-info` | `#A8A29E` | Info is neutral, not blue |

Hairlines, dividers and tints derive from one relative alpha scale
(`--ink-*`) built on the ink triplet, so a single variable pair inverts every
border on the page.

**A fill colour is not a text colour.** Every status foreground above is lifted
along its own hue until it clears 4.5:1 on its own 12% chip; the deeper fills
are for surfaces and glyphs, never body text.

Critical state always combines colour with an icon and a word.

### Structure

| Contract | Value |
|---|---|
| Radius | Hard lock: 6 / 8 / 12 px, plus the pill |
| Concentric tray | outer = inner + 4px frame inset → 12 / 8 |
| Controls | 32 / 36 / 44 px |
| Rows | 44 comfortable, 32 compact |
| Buttons | 32h · 13px · weight 500 · 12px padding · 8px gap · radius 8 |
| Chips | 20h · pill · 12px · weight 500 · 6px padding |
| Type scale | 12 / 13 / 14 / 16 / 18 / 20 / 24, line heights 16 / 18 / 20 / 22 / 24 / 26 / 28 |
| Body | 13/18, tracking −0.31px, tabular numerals |
| Weights | **400 and 500 only.** No bold anywhere. |
| Case | **No uppercase transforms anywhere.** |
| Icons | 16px, stroke 1.2 |
| Spacing | 4pt grid |
| Motion | 80 / 150 / 220 / 320 / 480 ms; standard `cubic-bezier(0.2,0,0,1)` |

Typefaces are Inter and JetBrains Mono, self-hosted as variable WOFF2.

## Typography

These two sections predate the structure above. Where the old
house figures disagreed with the system the product was told to match, the
system won and the numbers below have been corrected to what actually ships;
the intents behind them are unchanged.

- UI and dialogue: Inter.
- Logs, IDs, timestamps, addresses and telemetry: JetBrains Mono. Nothing else
  is monospaced.
- Body text: 13/18 — the `sm` step of the scale above, and `body`'s own
  `font-size`. The earlier 16 px floor was the house rule, not the system.
- Dialogue: 16/22 (`--type-lg-size`), the largest step used for running text.
- Critical state is not sized up. The unacknowledged alarm is distinguished by a
  red inset border, a 1.6 s pulse and a lit panel — with the other two monitors
  stepped back — not by a larger typeface. Size marks the weight of a figure,
  not urgency: the scale's top step, 24 px, is the debrief stat value
  (`--type-kpi-size`), and page titles sit below it at 20 px.
- The one deliberate exception is the boot wordmark (`.scene__title`, 40/48 with
  wide tracking), a title card rather than interface type.
- Measure is capped by `max-width`: 72ch on prose, 76ch on the dialogue block.
- Self-host variable WOFF2 files where possible.

## Geometry

- Base spacing unit: 4 px.
- Standard gaps: 8, 12, 16, 24 and 32 px.
- Control heights: 32 / 36 / 44 px (`--control-height-sm|md|lg`). The 48 px
  minimum this section used to state was the house rule; the enforced floor is
  WCAG 2.2 AA's 24×24 px, checked over every enabled button on the dashboard by
  `tests/e2e/accessibility.spec.ts`.
- Panels are concentric: 12 px outer, 8 px inner, from a 4 px frame inset.
- Buttons: 8 px radius (`--btn-radius`); no pill-shaped primary actions. Chips
  are the only pill.
- Borders: 1 px low-contrast warm gray (`#2A2926`).
- Focus ring: 1 px panel-coloured offset then a 2 px amber ring, applied once
  globally on `:focus-visible`. Amber, not blue — the accent contract has no
  blue in it.

## Components

### Incident Alert

- Icon, severity label, short title and elapsed time.
- Pulse no faster than 1.5 seconds.
- Reduced-motion mode removes scale and pulse; keeps static emphasis.

### Dialogue Panel

- Anchored to the bottom safe area.
- Speaker label with an optional small speaker icon, completed sentence, and at
  most two actions.
- Typewriter is visual only. Screen readers receive the complete sentence once.
- Advance and skip are visible controls, activated by Space/Enter like any other
  button. There is no unlabelled keypress a player has to guess.
- **No essential line may disappear without player input.** `assistantReporting`
  does advance on its own — a six-second safety net, plus a `REPORT_DELIVERED`
  event when the scene finishes her delivery — but what it advances to keeps her
  report on screen. The line is written once and rendered in both beats, and
  `briefingChoice` adds the two options beneath it rather than replacing it. The
  rule is that nothing essential is *removed* without input, not that no beat
  ever advances; timing dialogue **off** the screen is what
  `NODELESS_SOC_REDESIGN_2026-08-31.md` forbids, and that is what the old
  3.2-second timer did.
- The two choices under the briefing are labelled **Explain the incident** and
  **Open response console** — what each one does, not how eager the player is.

### Action Button

- Verb-first label: `Revoke active sessions`.
- Consequential choices state impact before confirmation.
- Disabled state includes a reason.
- Never show more than three primary choices at once.

### Evidence Card

- Evidence type, source, timestamp and trust warning.
- Suspicious external text is visually marked as untrusted content.
- Raw and explained views are separate.

### Assistant status

There is one in-world assistant — VERA, the human operations colleague — and no
second presence of any kind: no robot, pet, hologram or floating instrument.
Codex is not an in-world character and has no avatar; the player reaches it
through Codex/ChatGPT. See `NODELESS_SOC_REDESIGN_2026-08-31.md`, which is
binding here.

**Guidance is never attributed to her.** Three surfaces carry text, and each one
says where its text came from:

| Surface | Label | Who wrote it |
|---|---|---|
| Office dialogue speaker | **VERA**, or **Workstation** | fixed i18n copy — her report, the alarm, the resume line |
| `NarrationPanel` caption | **Generated guidance**, with the `agent` icon | a connected agent, through `present_guidance` |
| Office `explained` beat and the rail's guidance panel | **Case guidance** | the engine, deterministically, from case state |

The `agent` icon appears on exactly one of those, so the mark distinguishes the
channels rather than decorating all of them. (It still appears on two pieces of
chrome that name no speaker — the rail toggle and the "Next required step"
eyebrow — which is a different job.)

**A label the ear does not get is not a label.** Both text surfaces put the
speaker or source inside an `aria-atomic` wrapper with the sentence, so the
announcement carries both: `.narration__caption` for the generated channel, and
`.dialogue__caption` in the office, where the live region moved off the paragraph
for exactly this reason. Each wrapper holds the label and the line and nothing
else, so what is announced is one attributed sentence rather than a recital of
the surrounding panel — the tone badge, the queue counter and the controls stay
outside it.

Neither generated nor deterministic guidance opens a second avatar; the rail's
face glyph is gone, and nothing replaced it.

What remains is a status, not a character:

- Six states — idle, analyzing, needs-input, warning, success and error —
  modelled as `AssistantState` in `src/game/types.ts`.
- The state is always written as words (`assistant.state.*`), never carried by a
  glyph or a colour alone. That is the same rule as "Critical state always
  combines colour with an icon and a word" above, applied to a smaller surface.
- The status reports what the simulation knows. It does not become a second
  competing chat interface, and it is a line of text rather than a character:
  it sits under the rail's **Case guidance** heading with no glyph beside it.

### Full-Screen SOC Dashboard

- Real React DOM/SVG UI, never a flattened image or 3D texture.
- Document-like modular layout with Notion-level clarity and spacing.
- Persistent incident status bar, left navigation, main investigation workspace and right learning/action rail.
- Reuse the office monitors' telemetry, incident and topology components in `full` mode.
- The dashboard may be dense, but every region must have a clear title and one primary purpose.
- It is a teaching console for the shipped case, not a complete enterprise SOC
  workstation, and nothing here should describe it as one. The six-destination
  information architecture it is meant to grow into is specified in
  `NODELESS_SOC_REDESIGN_2026-08-31.md` §4 and is not built yet.

## 3D Rules

- Seated first-person camera; no free movement.
- Monitors have simple geometry and emissive surfaces.
- UI is native DOM aligned over or beside the canvas, not baked into textures.
- Monitor components have `compact` office and `full` dashboard modes backed by the same state.
- Decorative props cannot block monitor hit targets.
- Screen shake is prohibited. Use light and sound.

## Accessibility

- Every canvas target has a synchronized DOM control.
- Full keyboard completion is mandatory.
- Visible focus is mandatory.
- Captions, mute, volume and skip are available.
- Respect `prefers-reduced-motion`.
- Never announce typewriter characters one by one.
- Minimum target size is WCAG 2.2 AA's 24×24 px, per the control-height note
  under Geometry. Real controls sit well above it at 32 / 36 / 44 px.
