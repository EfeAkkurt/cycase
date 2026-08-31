# Product Specification

## Product Promise

CYCASE teaches cyber incident response through a playable operations-room simulation in which the player and an AI agent inspect the same evidence and act on the same live game state.

CYCASE is not a story game that walks through pre-written lines. The security case stays fully deterministic; the *narration* is live. Codex generates the story, the teaching, the hints and the debrief in real time, from the player's level, their choices, their mistakes, the evidence they actually looked at, the explanation style they asked for, and the current case state.

Dialogue quoted anywhere in this document set is a tone reference and the deterministic fallback, never the shipped script.

## Primary User

A beginner or early-career learner who wants to understand cyber incidents by making decisions instead of reading a course.

## MVP

One polished 10–15 minute vertical slice:

- Wake-up sequence at a three-monitor workstation.
- One incident: phishing, stolen session, suspicious login and attempted data exfiltration.
- One choreographed low-poly colleague/NPC for incident delivery; her path and timing are scripted, her words are generated.
- A smooth transition from the 3D office to a real full-screen SOC dashboard.
- Seven WebMCP tools: five case operations/reads, `submit_decision`, and `present_guidance` for live narration.
- Live generated narration with a deterministic fallback line set, browser text-to-speech, and a caption for every spoken line.
- Four to six meaningful decisions.
- Two endings and a scored debrief.

## Out of Scope

- Open world, player walking or free camera. A scripted NPC entrance is allowed.
- Real targets, real credentials, executable exploits or shell access.
- Multiplayer, accounts, inventory and persistent progression.
- Procedurally generated tool names or unrestricted actions.
- A model-authored score, action list or state transition, in any form.
- Shipping generated case packs. The ScenarioPlan boundary is specified in `BACKEND_RUNTIME_CONTRACT.md` §7, feature-flagged and NOT-SHIPPED for this release.
- “All cyber topics” before the hackathon deadline.
- Exact OpenAI/Codex pet artwork.

## Architecture

```text
ChatGPT/Codex
      |
      v
WebMCP tool layer
      |
      v
Runtime validation + stateVersion check
      |
      v
Deterministic XState game machine
      |
      +--> DOM UI and monitor interfaces
      +--> full-screen SOC dashboard
      +--> 3D scene reactions

Codex --> present_guidance --> allowlist + version + idempotency check
                            --> append-only narrative log (narrativeSequence)
                            --> one active caption + optional browser speech

LLM backend --> typed ScenarioPlan --> validation --> game machine   [NOT SHIPPED]
```

### Ownership Rules — the deterministic / dynamic split

This is a hard boundary, stated identically in `PROJECT_CONTEXT.md` §5.

**DETERMINISTIC — engine only, never the model**

- Valid actions.
- Telemetry and evidence relationships.
- State progression.
- Consequences.
- Score.
- Idempotency.
- Security boundaries.
- Scenario schema validation.

**DYNAMIC — Codex generates, the page renders**

- The narration channel, headed **Generated guidance**. Not VERA's lines: her office
  copy is fixed, and a generated line replaces it rather than speaking under her name.
- The level and tone of explanation.
- Hints.
- The educational response to a mistake.
- The learn/solve narration.
- The debrief narrative.
- The content of future schema-validated case packs.

**An LLM must never decide score, a valid action, or state progression. That is the line.**

Concretely, the LLM must never provide:

- Arbitrary URLs, commands, SQL or executable payloads.
- New action IDs not present in the allowlist.
- Direct state mutations.
- A score or ending that bypasses the state machine.

The deterministic game core keeps ownership of the current scene and state, allowed actions, scoring and consequences, evidence visibility, ending selection, and idempotency and stale-call rejection.

### Narration fallback

Generated narration is an enhancement layer, not a dependency. With no agent connected the page narrates from the deterministic baseline line set in `src/i18n/en.ts`. The case content, valid actions, score, progression and ending are identical in both modes; only the wording, the level and the tone differ. This is what keeps the "fully playable without WebMCP" guarantee in `WEBMCP_CONTRACT.md` true.

## Frontend Stack

- React, React DOM, TypeScript and Vite.
- Three.js and React Three Fiber.
- XState and `@xstate/react`.
- Native Web Audio API.
- Native `document.modelContext` or a minimal lifecycle hook.
- Runtime schema validation; `zod/mini` is acceptable.
- Playwright, axe-core and Lighthouse CI for verification.

## Performance Budget

- One canvas and one renderer.
- Device pixel ratio capped at 1.5.
- Visible scene below 300,000 triangles and 120 draw calls.
- Production GLB bundle target: 8 MB or less.
- Critical first-load transfer target: 12 MB or less.
- Desktop target: average 55+ FPS at 1440×900 on a mid-range laptop.
- Texture size: 2K maximum; 1K for minor props.
- Baked lighting for the room; dynamic light only where interaction requires it.
- Static scene uses demand rendering. Animation invalidates frames only while active.

## Responsive Behavior

- Primary target: desktop widths of 1280 px and above.
- 1024–1279 px: compact HUD and reduced decorative props.
- Below 1024 px: replace 3D office navigation with a 2D monitor carousel. All gameplay remains available.

## Office-to-Dashboard Rule

The office introduces the problem. The dashboard is where the player solves it. Selecting **Çöz / Debug** must crossfade into a real HTML/CSS/SVG dashboard without reloading or resetting the state machine.

## Definition of Done

1. A player can complete Case 001 using only visible UI controls.
2. The same case can be completed through the seven WebMCP tools.
3. Every tool call creates a visible state change or returns useful structured evidence.
4. Invalid, duplicate and stale tool calls are rejected without corrupting state.
5. The intro is skippable and audio begins only after user interaction.
6. The full flow works with keyboard navigation and reduced motion.
7. The live build loads without console errors or broken network requests.
8. All shipped assets have documented licenses.
9. Debug transitions to the dashboard without state loss, duplicate tool registration or focus loss.
10. Narration is live when an agent is connected and falls back to the deterministic line set when it is not, with an identical case, score and ending in both modes.
11. Every spoken line appears in full as a caption; Skip, Repeat and Stop Voice are always available; nothing in a generated message is ever executed as markup, script, URL or SSML.
