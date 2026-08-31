# Visual Reset — Required V2 Pass

## Decision

The current implementation is technically sound but its art direction is not accepted as final. The procedural room reads as a blockout, while the navy/cyan dashboard reads as a generic AI/cyber demo. Preserve the architecture, game state, tests, WebMCP tools and compact/full component reuse. Replace the visual layer.

Reference: `assets/office-concept-v2-neutral.png`.

## Amendment — final colour ruling

**Status: the warm-neutral direction below is restored and binding.**

The history, so nobody has to reconstruct it from git: this document's warm
ramp was first implemented; a later instruction adopted the current
structure and then the "carbon" colour theme, whose accent is a
measured blue. The ruling:

- **Surfaces stay carbon** (`#0B0B0A` page, `#141413` tray, `#171716`
  cell, bone text) — they are warm-neutral and were never the problem.
- **Structure stays fixed** (radius/density/type/motion locks).
- **The blue accent is removed.** Accent and focus are amber (`#C8A26A`);
  red is reserved for threats and destructive state; status greens/oranges are
  the measured warm set.
- `tests/e2e/palette.spec.ts` (the no-cool-hue pixel gate) is **reinstated**
  and passing, alongside `tests/unit/tokens.test.ts`, which now pins the
  accent layer and rejects any blue/cyan/teal literal in the token file.
- `tests/e2e/office-visibility.spec.ts` enforces the luminance
  thresholds (mean ≥22, dark share ≤65%) on the seated front view.

## Non-negotiable Direction

- No blue, cyan, teal, purple, neon glow or blue-tinted charcoal anywhere.
- Use warm neutral blacks, graphite, bone text, muted amber and restrained red.
- Red belongs only to an active incident, destructive consequence or failed state.
- No gradients, glowing panel outlines, glassmorphism, fake holograms or decorative terminal noise.
- The companion is an original utilitarian monitor-mounted instrument, not a cute mascot and not an OpenAI/Codex character.
- The result should resemble a believable night-shift SOC product and workplace, not science-fiction concept art.

## 3D Office

Primitive geometry may remain for walls and invisible layout helpers, but it is not acceptable for every visible object. Add licensed CC0 props and physically believable materials for the desk, monitor bodies, chair edge, rack/cabinet, keyboard, cables and small workplace clutter. Use warm practical ceiling/desk light plus restrained monitor spill; do not color-wash the room.

Use constrained seated head-look and keep the DOM monitor projection aligned while the camera moves. Do not replace selectable React monitor UI with textures. Keep lazy loading, fallbacks and performance budgets.

If the build environment lacks Blender, use ready-to-load GLB/glTF assets or install/use a verifiable conversion pipeline. Do not silently substitute an all-primitive room again. Every asset must be recorded in `ASSET_LICENSES.md`.

## Dashboard

Keep the full-screen dashboard as real DOM/SVG. Restyle it as a dense, calm operations console:

- flat near-black and warm graphite surfaces;
- thin neutral separators instead of glowing cards;
- less empty space and fewer oversized containers;
- tables, event rows and evidence details aligned to a disciplined grid;
- compact status chips with text/icon, not luminous pills;
- monospaced type only for timestamps, IDs, hashes, IPs and logs;
- a collapsible `Assistant notes` rail rather than a dominant AI character panel.

The dashboard must prioritize the incident, evidence and next safe action. Decoration must never compete with them.

## What “Real-time” Means

Real-time is functional, not visual noise. All changing UI must be driven by the deterministic simulation clock and case events:

- a visible incident elapsed timer;
- append-only event/log rows as scenario events occur;
- chart windows that advance from actual case samples;
- connection/agent states with timestamps and last-update age;
- monitor alert transitions that match the state machine;
- immediate compact/full synchronization;
- pause/replay from the same seed for deterministic tests.

Do not animate random numbers, fake packets or meaningless charts. The UI may interpolate between real samples, but every value must be explainable from case state.

## Acceptance Gate

The pass is complete only when:

1. All eight 1440×900 and 1280×720 screenshots are regenerated.
2. No visible blue/cyan/teal/purple remains in screenshot pixel review.
3. The office no longer reads as a primitive blockout at first glance.
4. Opening, office, alert, companion, evidence, confirmation, contained and debrief states remain playable.
5. Existing unit, E2E, accessibility and Lighthouse thresholds do not regress.
6. The real WebMCP path, frame rate, hosting, demo video and Devpost checks remain separate release gates; visual approval does not close them.

### Result

| # | Criterion | State | Evidence |
|---|---|---|---|
| 1 | Sixteen captures regenerated | Met | `docs/screenshots/`, produced by `tests/e2e/screenshots.spec.ts` |
| 2 | Colour contract enforced | Superseded, re-gated | The cool-hue ban was retired with the design-system change above. `tests/unit/tokens.test.ts` now pins the structural tokens to `the design system` and the colour anchors to `carbon`, and axe holds contrast at wcag2aa across every route. |
| 3 | Office is not a blockout | Met | Desk, chair, cabinet, rack, lamp, notepads, stationery, thermos, plant and bin are CC0 scans on real PBR materials; floor and walls carry CC0 texture sets. See `ASSET_LICENSES.md`. |
| 4 | Every state still playable | Met | 69 E2E across two motion modes, including the full manual path and the full agent path |
| 5 | No threshold regression | Met | 91 unit tests, axe clean at wcag2aa, Lighthouse unchanged |
| 6 | Release gates stay open | Acknowledged | Real-browser WebMCP verification, measured frame rate, hosting, demo video and the Devpost submission are still open. Visual approval did not close them. |

**Not covered by this pass:** the monitor shells, keyboard and mouse are still
modelled in code, because no CC0 source reachable from this environment
publishes display hardware. They carry a real CC0 PBR material set. The three
sources tried are recorded in `docs/ASSET_PIPELINE.md`, amendment 2.
