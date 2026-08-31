# CYCASE Master Project Context

Read this document completely before designing, coding or reviewing CYCASE. It exists so a new developer or coding agent can understand the product without access to previous conversations.

## 1. What We Are Building

CYCASE is a browser-based cyber incident simulation and learning game built for the OpenAI WebMCP Challenge.

The player wakes at a night-shift security workstation inside a lightweight 3D office. The centre monitor raises an alarm, the player acknowledges it, and VERA — the human operations assistant — walks in and reports the incident. Her report stays on screen until the player chooses **Explain the incident** or **Open response console**. Choosing the console (the machine event is still `DEBUG`) fades the cinematic office away and reveals a real, full-screen security operations dashboard.

Codex is not a character in that room. It has no avatar, no mesh and no dock. The player talks to Codex through Codex/ChatGPT, and Codex reads and operates the simulation through WebMCP. There is exactly one in-world assistant and she is a person; the second character that used to stand beside her was removed entirely by `NODELESS_SOC_REDESIGN_2026-08-31.md` §1.

CYCASE is **not** a story game that walks through pre-written lines. The security case is fully deterministic, but the *narration* is live. Codex generates the story, the teaching, the hints and the debrief in real time — from their choices, their mistakes, the evidence they actually looked at, the current case state, and a level and explanation style the engine derives from this run's hints and wrong answers rather than from any stored profile. Every line of dialogue in this document set is a **tone reference and deterministic fallback**, never the shipped script.

What Codex does not write is VERA. A generated line arrives in its own channel, headed **Generated guidance**, and that heading is inside the announced region so a screen reader hears the source as well as the sentence. It is never shown under her name and never becomes a second avatar. The guidance the engine derives from case state — hints, decision explanations, the "Explain the incident" body — is headed **Case guidance** for the mirror-image reason: nothing generated it, and it is not hers either.

The dashboard is not 3D. It is a production-style React interface built with HTML, CSS and SVG. It contains the evidence, telemetry, identities, affected assets, timeline, actions and explanations a security analyst needs. The player can work manually while ChatGPT/Codex can use WebMCP tools against the exact same game state.

The product promise:

> Learn cyber incident response by investigating and acting together with an AI agent, not by reading a fixed course.

### Narration is live; the case is not

When an agent is connected, narration is generated per player through the `present_guidance` tool (§6). When no agent is connected — an unsupported browser, a refused registration, a judge running the page alone — the page falls back to the deterministic baseline line set in `src/i18n/en.ts`. **The case, the valid actions, the score, the progression and the ending are byte-identical either way.** Live narration changes how the case is explained. It never changes what the case is. The game therefore remains fully playable without WebMCP, exactly as `WEBMCP_CONTRACT.md` requires.

## 2. Why WebMCP Is Essential

Without WebMCP, an agent must interpret screenshots and guess which controls to click. CYCASE exposes structured browser tools, so the agent can inspect evidence, run synthetic diagnostics and propose or execute allowed response actions while the player watches the same dashboard change.

This is the core competition demonstration:

```text
Player request in ChatGPT
        |
        v
Page WebMCP tool call
        |
        v
Validated deterministic game action
        |
        +--> dashboard changes
        +--> office monitors react
        +--> assistant status changes
        +--> player learns why
```

The assistant status in that chain is `assistantState` on the game context, rendered in the dashboard rail through the `assistant.state.*` strings. It is a status line on a panel, not a character.

A remote/backend MCP server may support scenario generation, but it does not replace the page's WebMCP implementation. Connected backend mode is deliberately off in this build. `src/backend/` exists and is unit-tested, but nothing outside that directory imports it, no `VITE_CYCASE_BACKEND_URL` is set, and `createBackendClient` returns `null` for an unset URL — so the page makes zero network requests and every run is local.

## 3. Experience Structure

### Layer A: 3D Office

Purpose: atmosphere, onboarding, story delivery and incident urgency.

- Constrained seated first-person head-look; no walking or open-world navigation.
- Desk with exactly three physical monitors.
- The centre monitor raises the alarm and has to be acknowledged before anything else happens.
- VERA, the operations assistant, then enters and reports the incident. Her path, timing and animation are scripted, and so is the report itself (`intro.colleague.line`). She reports operational facts and the results of actions; she does not deliver Codex's explanations.
- Bottom dialogue panel carries readable text and choices.
- No player walking, physics or open-world navigation.

One in-world assistant, and she is a person. No robot, pet, hologram or floating object shares the room with her.

Tone reference for the incident delivery — this is the register and the length to aim for, **not** the line that ships. It is the deterministic fallback held in `src/i18n/en.ts` as `intro.colleague.line`:

> {name} — we cannot reach the identity services, and the platform just blocked an outbound customer export at 62%. The account behind it is still signed in.

This sentence is what the office says, and it is hers. When an agent is connected it may write a line about the same beat, but that line arrives in the narration channel under **Generated guidance** and replaces the fixed copy rather than being spoken in her name — the dialogue panel never shows two speakers at once. `{name}` is interpolated from the operator name, and the table falls back to `Operator` (`intro.operator_default`) when none is set.

VERA is the messenger and the operator's colleague. Codex is the teacher and it speaks from outside the fiction, through a labelled channel. Nothing in the room competes with her for the assistant role, and nothing borrows her name for text she did not say.

### Layer B: Transition

Trigger: player selects **Open response console** (event `DEBUG`).

Required sequence:

1. Disable repeated input.
2. Office and dashboard are mounted concurrently; the dashboard subtree is inert
   while the office is still visible.
3. Office exposure fades to black in 300–450 ms. Shipped: 380 ms
   (`src/ui/intro/coverTimeline.ts`).
4. The machine advances and focus moves while the cover is at full opacity, so
   the swap reads as a cut rather than a jump. No status-text interstitial.
5. Black layer reveals the dashboard in 350–500 ms. Shipped: 400 ms.
6. Focus lands on the dashboard incident title. An active narration line is not
   dropped and not restarted; its caption follows the player into the dashboard.
7. Contextual WebMCP tools remain connected to the same state machine.
8. The narration queue survives the transition intact and `narrativeSequence`
   does not reset. A line queued in the office is delivered in the dashboard,
   once, in order.

The reverse direction is the same cover, held opaque until the WebGL canvas has
drawn, and it lands on the office's `resume` beat rather than replaying the wake
or VERA's entrance.

No page reload. No loss of incident state. No loss or duplication of narration. Respect reduced motion by replacing the cinematic transition with a short crossfade.

### Layer C: Real SOC Dashboard

Purpose: investigation, decisions, teaching and visible human-agent collaboration.

This layer is real DOM UI, not a texture and not a simulated screenshot.

Information architecture, as built:

```text
Top status bar
  Incident ID | Severity | Elapsed time | Connection | Agent status

Left navigation
  Command
  Investigate      SIEM · Identity · Endpoint/EDR · Network · Email
  Evidence
  Respond
  Timeline
  Debrief          locked until the case closes

Main workspace
  Incident summary
  Event/log timeline
  Evidence inspector
  Identity-device relationship graph
  Current hypotheses
  Containment checklist

Right guidance/activity rail
  Generated guidance   the caption channel, when an agent is connected
  Case guidance        the engine's own explanation and hint for this state
  Why this matters
  Optional evidence
  Agent tool activity
```

The six left-navigation destinations are the `nav.*` strings in
`src/i18n/en.ts`, driven by `DASHBOARD_ROUTES` and rendered by
`src/ui/dashboard/SideNav.tsx`. They are the redesign's six (§4), and six is a
cap rather than a target: identities and assets are not missing, they are inside
Investigate under the tool an analyst would actually reach for.

The rail ships labelled `Guidance and activity` (`rail.title`), and the panel
inside it `Case guidance` (`guidance.channel`). What it shows is the engine's
current explanation, the learning goal behind the last decision, optional
evidence and a live feed of every tool call, human or agent. It is not a chat
window, it is not a second character, and it is deliberately not VERA's: its
text is `lastHint` or `lastDecision.explanation`, both produced by the engine,
so it carries no name and no avatar.

The interface may feel like Notion in structure: clean document hierarchy, strong spacing, modular blocks and restrained chrome. It must still look like a security operations product, not a generic project-management dashboard.

## 4. Case 001

Working case name: **Session Ghost**.

```text
Phishing email
  -> fake sign-in page
  -> stolen session cookie
  -> unusual login
  -> cloud file enumeration
  -> attempted data exfiltration
```

All users, domains, IPs, devices and logs are fictional and synthetic. The product teaches defensive reasoning. It never provides real exploit payloads or unrestricted execution.

Case goals:

- Preserve and inspect evidence.
- Distinguish sender display name from authenticated identity.
- Understand why password reset alone may not revoke stolen sessions.
- Contain the active session and affected endpoint.
- Scope related indicators across synthetic data.
- Close only after critical findings are resolved.

## 5. The Deterministic / Dynamic Split

This is a hard boundary. Every agent, every document and every module respects it.

### DETERMINISTIC — engine only, never the model

- Valid actions.
- Telemetry and evidence relationships.
- State progression.
- Consequences.
- Score.
- Idempotency.
- Security boundaries.
- Scenario schema validation.

### DYNAMIC — Codex generates, the page renders

- The narration channel, headed **Generated guidance**, in the office dialogue panel and the dashboard rail. Not VERA's lines: her office copy is fixed, and a generated line replaces it rather than speaking under her name.
- The depth and tone of an explanation. The level it is pitched at is derived by the engine, not chosen by the model.
- Hints.
- The educational response to a mistake.
- The narration around the briefing choice — explain the incident, or open the console.
- The debrief narrative.
- The content of future schema-validated case packs. Generated case packs are
  specified and NOT-SHIPPED for this release (`PRODUCT_SPEC.md`).

**An LLM must never decide score, a valid action, or state progression. That is the line.**

Restated as concrete prohibitions, the model may never directly decide:

- Whether an invalid action succeeds.
- Score or ending.
- New tool names during a live case.
- Arbitrary commands, URLs, SQL or exploit content.
- State mutations outside the game machine.

The deterministic XState machine remains the owner of the current scene and route, the current incident state, valid action IDs, evidence availability, score and endings, tool lifecycle, and state version and idempotency. Generated narration is delivered through `present_guidance`, is appended to an append-only narrative log ordered by its own `narrativeSequence`, and cannot reach any of those.

## 6. WebMCP Tools

MVP tool set — **seven** tools:

- `get_incident`
- `inspect_artifact`
- `run_diagnostic`
- `take_response_action`
- `submit_decision`
- `request_hint`
- `present_guidance` — the narration channel; it speaks and captions one line, and can change nothing else

Every tool uses runtime validation. Mutating tools require `stateVersion` and `idempotencyKey`. `present_guidance` requires `basedOnStateVersion` and `idempotencyKey` but never bumps `stateVersion`. Human UI controls and WebMCP tools call the same domain functions. The full contract for all seven is in `WEBMCP_CONTRACT.md`.

`present_guidance` has no `speaker` field. The old three-value `speaker` enum was removed along with the second in-world character: Codex chooses the message, the `tone` and the `language`, and the page owns the single delivery channel that carries it. The validated shape — `basedOnStateVersion`, `idempotencyKey`, `tone`, `language`, `message`, and optional `relatedArtifactId` / `relatedDecisionId` — is `presentGuidanceSchema` in `src/game/validation.ts`.

Tools are registered on the top-level document using `document.modelContext`. Do not place the integration inside an iframe. Do not use deprecated `navigator.modelContext` for production registration.

## 7. Real-Time Monitor Architecture

The monitors in the office must look live, but the implementation must remain readable and fast.

Use a hybrid system:

### Compact Live Views

- Each monitor has a compact React component fed by the central game store.
- Charts and topology use SVG or Canvas 2D.
- Ambient animations update at 5–10 FPS, not 60 FPS.
- Data changes are event-driven, not random visual noise.

### In-Scene Rendering

- Monitor shells and glass are normal Three.js meshes.
- Non-interactive ambient graphics may be copied to a `CanvasTexture`.
- The focused/interactive monitor uses a perspective-aligned DOM layer over the WebGL canvas.
- Recalculate monitor screen corner projection during constrained head-look/scripted camera movement and on resize; stop per-frame projection work after the camera settles.
- Apply clipping and CSS transforms so the DOM surface appears inside the physical bezel.
- Every monitor also has a keyboard-focusable semantic control outside the canvas.

### Do Not

- Render dashboard text permanently into a low-resolution 3D texture.
- Run three independent React apps.
- Duplicate monitor data separately from dashboard data.
- Use CSS3DRenderer as an untested foundation. It has zoom and WebGL-composition limitations.

The same components should support two modes:

- `compact`: monitor view inside the office.
- `full`: real dashboard panel after Debug.

This is what lets the office read as a working desk without turning the dashboard into fake scenery: the monitors show the product, not a picture of it.

## 8. 3D and Asset Plan

No dedicated 3D artist is required. What shipped, and what it is recorded as in `ASSET_LICENSES.md`:

- Office props and textures come from Poly Haven CC0, fetched and optimised by the asset pipeline — desk, chair, cabinet, rack, lamp and clutter. Kenney packs are still listed as a candidate source in `ASSET_PIPELINE.md`; no Kenney asset ships.
- The scripted colleague is Quaternius CC0 (`Suit_Female`, Idle and Walk clips), converted to a single GLB with its source hash pinned in `public/asset-manifest.json`.
- Monitor shells, the workstation and every icon are modelled or drawn in-repo rather than sourced.
- AI image generation is used for composition studies and decals only. Both concept images are documentation; neither ships and neither is used as a texture.
- Microsoft TRELLIS.2 remains an option only if one unique object truly needs image-to-3D. Nothing has needed it.

No second character asset is required or wanted. The room holds the operator, VERA and the workstation, and nothing else that talks.

All assets entering the implementation repository need an `ASSET_LICENSES.md` row containing source URL, creator, license, modifications and local path.

## 9. Visual Direction

Atmosphere: quiet operational tension, believable night office, restrained low-poly realism.

Core palette:

- Void: `#0B0B0C`
- Surface: `#141414`
- Raised surface: `#1C1B19`
- Neutral signal/focus: `#D8D2C4`
- Critical red: `#B94A45`
- Warning amber: `#C79A52`
- Primary text: `#E8E3D8`

Avoid blue/cyan/teal/purple, gradients, neon glow, generic Matrix green, excessive holograms, cyberpunk city imagery, fake terminals and unreadable microtext. Red is reserved for actual incident semantics.

Target office direction: `assets/office-concept-v2-neutral.png`. The V1 concept and the older screenshots are historical references, not the target art direction. `VISUAL_RESET.md` is the acceptance contract for the V2 pass. The concept is a direction to work toward, not a frame to match, and the owner has not yet signed off on the captured result (`NODELESS_SOC_REDESIGN_2026-08-31.md` §11).

## 10. Frontend Stack

What is actually installed (`package.json`):

- React + React DOM + TypeScript + Vite.
- Three.js + React Three Fiber.
- XState + `@xstate/react`.
- Web Audio API, and `speechSynthesis` for narration — no audio library.
- Native WebMCP through `document.modelContext`, with a thin React lifecycle wrapper.
- `zod/mini` as the runtime schema validator.
- Recharts for the dashboard charts; the office monitor graphics stay hand-drawn SVG.
- Vitest for unit tests, Playwright and `@axe-core/playwright` for browser tests.
- Fastify for the `server/` run API, which the browser does not currently talk to.

Lighthouse CI is not installed; performance is gated by the Playwright budgets instead (`tests/e2e/performance.spec.ts`).

No physics engine, no free movement, no mandatory post-processing, no heavy embedded 3D platform and no typewriter library.

## 11. Build Order

1. Implement deterministic Case 001 state machine and fixtures.
2. Build the full 2D SOC dashboard using fixture data.
3. Implement seven WebMCP tools against the same actions, `present_guidance` included.
4. Build 2D fallback and complete manual/agent test flows.
5. Add the 3D office shell and monitor compact views.
6. Add the alarm acknowledgement, VERA's entrance and the briefing dialogue.
7. Add office-to-dashboard transition.
8. Optimize assets, accessibility and performance.
9. Record the sub-three-minute demo only after the live URL passes QA.

The dashboard comes before 3D polish. A beautiful office with a weak WebMCP workflow will score poorly.

This list is the order the product was built in, not the order the remaining work happens in. That is `NODELESS_SOC_REDESIGN_2026-08-31.md` §9, and where the two conflict the redesign wins.

## 12. Acceptance Criteria

1. The player can complete Case 001 manually.
2. ChatGPT can complete the same valid actions through WebMCP.
3. Every tool call has a visible effect in the dashboard, the office monitors or the assistant status.
4. Debug transitions from office to dashboard without a reload or state loss.
5. Invalid, duplicate and stale calls cannot corrupt state.
6. The case is completable with keyboard, muted audio, reduced motion and 3D disabled.
7. All shipped links, assets and licenses pass audit.
8. Live build meets the budgets in `PRODUCT_SPEC.md`.
9. Narration is generated live when an agent is connected and falls back to the deterministic baseline line set when it is not, with an identical case, score and ending in both modes.
10. Every spoken line is shown in full as a caption, and the player can Skip, Repeat or Stop Voice at any time.

`NODELESS_SOC_REDESIGN_2026-08-31.md` §10 adds its own gates on top of these, and where the two overlap the redesign is binding.

These are criteria, not a status report, and several are open for reasons no code change closes. There is no deployment and no live URL, so 8 cannot be exercised and neither can the demo recording in §11. The ChatGPT/Codex built-in-browser run has not happened, so 2 rests on the native Chrome WebMCP suite (`tests/e2e/webmcp-native.spec.ts`) rather than on the real client. The three alarm WAVs are absent, so the office alarm is visual only and captions that fact on screen. Zero uncoached novice sessions have been run.

## 13. Competition Requirements

- Deadline: September 3, 2026 at 1:00 PM PDT, which is 23:00 in Istanbul.
- Working hosted URL testable in ChatGPT's in-app browser or supported Chrome.
- Public source repository with all required code/assets/instructions and a visible open-source license.
- Public demo video under three minutes with audio.
- Project description must explain why WebMCP improves the experience and how human-agent collaboration works.
- Do not modify the submission, submitted repository or live site after the deadline until judging ends.

Judging categories have equal weight:

- WebMCP leverage.
- Execution.
- Potential impact.
- Creativity and ambition.

## 14. Research and Reference Links

WebMCP is evolving. Re-check official sources before changing API-level code.

### Challenge

- https://webmcp.devpost.com/
- https://webmcp.devpost.com/rules
- https://webmcp.devpost.com/resources
- https://openai.com/webmcp-challenge/

### OpenAI

- Site tools/WebMCP: https://learn.chatgpt.com/docs/webmcp
- Remote MCP servers: https://developers.openai.com/api/docs/mcp
- WebMCP apps: https://developers.openai.com/showcase?view=webmcp-apps
- ChatGPT Sites: https://learn.chatgpt.com/docs/sites
- Pets: https://learn.chatgpt.com/docs/pets

### WebMCP Specification and Chrome

- Specification repository: https://github.com/webmachinelearning/webmcp
- Chrome WebMCP overview: https://developer.chrome.com/docs/ai/webmcp
- Imperative API: https://developer.chrome.com/docs/ai/webmcp/imperative-api
- Security guide: https://developer.chrome.com/docs/ai/webmcp/secure-tools
- Evals: https://developer.chrome.com/docs/ai/webmcp/evals
- DevTools inspection: https://developer.chrome.com/docs/devtools/application/webmcp
- React hook package: https://www.npmjs.com/package/use-webmcp-tool
- React hook source: https://github.com/GoogleChromeLabs/use-webmcp-tool
- Angular integration: https://angular.dev/ai/webmcp
- Modern Web Guidance: https://github.com/GoogleChrome/modern-web-guidance
- Chrome Labs demos: https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/demos
- Third-party extension supplied by the team: https://chromewebstore.google.com/detail/webmcp-extension/jigokfbbpcdckjmhbgapmikncfihboec

### Cloudflare

- Overview: https://blog.cloudflare.com/webmcp/
- Browser Run WebMCP: https://developers.cloudflare.com/browser-run/features/webmcp/
- Coffee demo: https://webmcp-coffee.jilles.fyi/
- Challenge resources: https://webmcp-challenge.examples.workers.dev/
- React/Vite starter: https://github.com/cloudflare/agents/tree/main/examples/webmcp-react
- Pages deployment: https://developers.cloudflare.com/pages/

### Vercel

- Storefront source: https://github.com/vercel/shop
- WebMCP implementation PR: https://github.com/vercel/shop/pull/498
- Live storefront: https://template.vercel.shop/
- Pricing: https://vercel.com/pricing

### Shopify

- Storefront WebMCP tools: https://shopify.dev/docs/api/web-mcp
- Agentic commerce and remote MCP: https://shopify.dev/docs/agents

### Render

- Workflows: https://render.com/workflows
- Workflows docs: https://render.com/docs/workflows
- Templates: https://render.com/templates
- Credits documentation: https://render.com/docs/credits

### Netlify

- Platform: https://www.netlify.com/
- Getting started: https://docs.netlify.com/start/choose-your-path/
- WebMCP starter: https://webmcp-starter.netlify.app/

### Frontend, Game and Testing

- R3F performance: https://r3f.docs.pmnd.rs/advanced/scaling-performance
- glTF Transform CLI: https://www.npmjs.com/package/@gltf-transform/cli
- XState: https://github.com/statelyai/xstate
- Playwright: https://github.com/microsoft/playwright
- Web Audio best practices: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
- Three.js CSS3DRenderer: https://threejs.org/docs/pages/CSS3DRenderer.html
- Three.js CanvasTexture: https://threejs.org/docs/pages/CanvasTexture.html

### Free 3D Assets and AI 3D

- Blender license: https://www.blender.org/about/license/
- Kenney Furniture Kit: https://kenney.nl/assets/furniture-kit
- Kenney license/support: https://kenney.nl/support
- Quaternius FAQ/license: https://quaternius.com/faq.html
- Quaternius Furniture Pack: https://quaternius.com/packs/ultimatefurniture.html
- Quaternius Sci-Fi Essentials: https://quaternius.com/packs/scifiessentialskit.html
- Quaternius Animated Characters: https://quaternius.com/packs/ultimatedanimatedcharacter.html
- Quaternius Universal Animation Library: https://quaternius.com/packs/universalanimationlibrary.html
- Poly Haven license: https://polyhaven.com/license
- TRELLIS.2: https://github.com/microsoft/TRELLIS.2
- TRELLIS.2 hosted Space: https://huggingface.co/spaces/microsoft/TRELLIS.2
- Meshy free-plan limits: https://help.meshy.ai/en/articles/15696428-what-is-included-on-the-free-plan
- Hunyuan3D 2.1 license: https://github.com/Tencent-Hunyuan/Hunyuan3D-2.1/blob/main/LICENSE
- Stable Fast 3D license: https://github.com/Stability-AI/stable-fast-3d/blob/main/LICENSE.md

## 15. Instructions for a Coding Agent

Before implementation:

0. Read `NODELESS_SOC_REDESIGN_2026-08-31.md` first. It is the binding product and implementation direction, and it supersedes anything in this folder that contradicts it — including anything here.
1. Read every document in this folder.
2. Inspect the current repository and cite existing files before proposing changes.
3. Confirm the current WebMCP API against official OpenAI/Chrome sources.
4. Build deterministic state and dashboard before 3D polish.
5. Do not replace licensed assets or architecture without recording the reason.
6. Do not invent missing gameplay rules. Flag the gap.
7. Keep every canvas action accessible through real DOM.
8. Record every third-party asset and AI-generated output.
9. Test manual and WebMCP paths after each meaningful feature.
10. Treat this master context as product intent, the redesign as binding direction, and the other documents as implementation contracts.
