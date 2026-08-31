# CYCASE — Nodeless SOC redesign

Date: 2026-08-31\
Status: binding product and implementation direction\
Supersedes: every unexecuted prompt that keeps NODE as a visual character or a guidance persona

## 1. Locked decisions

1. **NODE is removed completely.** Remove the 3D mesh, lights, mount, animation,
   diagnostics, state-machine beats, `companion` speaker, `companionState`, UI labels,
   current-contract language and active tests. Historical release evidence may keep the word
   only when it is clearly marked as historical.
2. **There is one in-world assistant:** the human operations assistant already represented
   by VERA. She brings incident updates, reports the result of actions and hands the case to
   the operator. Do not add another robot, pet, hologram or floating object.
3. **Codex is not an in-world character.** The player talks to Codex through Codex/ChatGPT,
   asks what the incident means and learns the response. Codex uses WebMCP to read and operate
   the simulation. Short guidance may be mirrored into the page and spoken, but it has no
   avatar and never pretends to be a second character.
4. **The simulation owns truth; Codex owns phrasing and teaching.** Case state, telemetry,
   available evidence, valid operations, consequences and scoring stay deterministic and
   schema-validated. When connected, Codex writes context-aware explanations from the current
   state. Without Codex, a deterministic fallback keeps the entire case playable.
5. **The three monitors are three operational tools, not three unrelated dashboards.** They
   reuse the same state and the same React components as the full response console.
6. **Audio narration is automatic and free.** Use browser `speechSynthesis` after the initial
   user gesture. Every line is also captioned. The player has one global Narration on/off
   control; voice selection belongs under advanced settings, not in the primary chrome.

## 2. Correct story flow

```text
Boot
  -> opening text/typewriter
  -> first-person wake/eyelid reveal
  -> seated 3D SOC office
  -> centre monitor alarm
  -> player acknowledges the physical monitor/DOM control
  -> VERA approaches and reports the live incident
  -> report stays visible until the player chooses
       [Explain the incident] or [Open response console]
  -> Codex teaching + WebMCP investigation
  -> player/Codex applies real simulated operations
  -> VERA delivers state-derived updates such as
       "Chief, the stolen session is revoked" or
       "Chief, the endpoint is still sending traffic"
  -> dashboard and all three monitors update from the same state
  -> containment verification
  -> debrief
```

Remove `companionArrives` and `learnOrSolve`. Replace them with assistant-oriented names
such as `assistantReporting` and `briefingChoice`. The current 3.2-second automatic report
timeout is forbidden: no essential dialogue may disappear before user input. Preserve a
reduced-motion path and a complete 2D fallback.

The requested “smooth eye blink” means the **first-person wake overlay**, not facial blinking
on the character model. Target a 2.8–3.4 second reveal with two irregular lid movements,
soft exposure/focus recovery and no hard symmetrical wipe. Reduced motion may use one short
fade. Never flash more than three times per second.

## 3. Codex/WebMCP model

Keep the seven-tool architecture unless a failing native API requirement proves otherwise:

1. `get_incident`
2. `inspect_artifact`
3. `run_diagnostic`
4. `take_response_action`
5. `submit_decision`
6. `request_hint`
7. `present_guidance`

`present_guidance` remains narration-only and must never change domain state, score, valid
actions or routes. Remove its `speaker: colleague | companion | system` choice. Delivery is
through one fixed assistant/narration channel; Codex chooses the safe message and tone, not
which fictional persona speaks. Rename `companionState` to `assistantState` only where a
visible status is genuinely needed; otherwise remove it.

Required interaction loop:

```text
get_incident
  -> inspect relevant artifacts / run diagnostics
  -> present a short state-grounded explanation
  -> player chooses or authorizes a response
  -> submit_decision / take_response_action
  -> read the returned state version and effects
  -> show and speak the result
  -> repeat until verification and close_case
```

The agent must never invent a tool, log source, asset, diagnostic or operation that the
simulation cannot represent. Future AI-generated scenarios must compile into the same closed
scenario schema before play begins; do not improvise new mutable domain rules mid-run.

## 4. What the current dashboard is — and is not

The current product already has a good Case 001 teaching console:

- Overview / incident summary
- Evidence inspector
- Identities
- Assets
- Timeline and case activity
- Playbook, diagnostics and containment actions
- Event telemetry, topology and incident panels

It is **not** yet a complete enterprise SOC/incident-response workstation. A senior analyst
at a large company does not literally see “everything” in one dashboard; they pivot between
specialised vendor tools. CYCASE should model those mental workflows with a vendor-neutral
shell and progressive disclosure.

Target information architecture, limited to six primary destinations:

1. **Command** — case queue, active incident, severity, SLA/elapsed time, ownership,
   containment status and current required step.
2. **Investigate** — scenario-relevant tool tabs:
   - SIEM: query bar, saved query, raw event table and aggregation
   - Identity: sign-ins, device, IP/ASN, MFA claim, token/session inventory
   - Endpoint/EDR: process tree, extension inventory, hash and network connections
   - Network: proxy, DNS, firewall and egress byte timeline
   - Email: message trace, headers, SPF/DKIM/DMARC and URL detonation
   - Cloud/Infrastructure: service health, workloads, IAM and deployment changes when the
     scenario actually touches them
3. **Evidence** — collected artifacts, raw/explained modes, provenance and chain of custody.
4. **Respond** — available operations, prerequisites, blast radius, consequence preview and
   verification status.
5. **Timeline** — alert, human, agent and system events in one attributable chronology.
6. **Debrief** — outcome, score, missed risks, action history and learning goals; unlocked
   only when the case closes.

DevOps data is relevant when the incident touches infrastructure: service health,
deployments, Kubernetes/workload state, logs, metrics and traces. Do not bolt a full DevOps
platform onto every cyber case. Show only the sources needed to investigate the active case.

## 5. Three-monitor contract

### Left — SIEM / live event stream

- live EPS/anomaly trend
- active query and time range
- top matching events
- incident markers on the timeline
- click/focus opens `Investigate > SIEM` in the full console

### Centre — incident command

- critical alarm and acknowledge control
- incident summary, owner, elapsed/SLA and containment checklist
- current required step and latest assistant update
- click/focus opens `Command`

### Right — contextual investigation tool

- defaults to Identity for Case 001
- switches to Endpoint or Network when the current step makes that source relevant
- compact rows remain legible at monitor distance; no dense full-page table squeezed into
  the glass
- click/focus opens the matching `Investigate` tab

All three surfaces remain real DOM projected onto the 3D monitor planes. They must use the
same selectors and components as the full dashboard in `compact`/`full` modes. Do not create
three independent stores, duplicate datasets or screenshot textures.

## 6. Every simulated operation must have observable effects

An operation is not complete when only the score or a toast changes. Within 250 ms it must
update every affected view and produce an attributable timeline entry.

For Case 001:

- `revoke_sessions` invalidates the stolen session in Identity, changes topology and stops
  session-backed access.
- `reset_credentials` changes credential state but does not falsely claim an already-issued
  token was revoked.
- `isolate_endpoint` changes the EDR host state and stops its network connections while
  preserving previously collected evidence.
- `block_indicator` updates proxy/firewall state and the egress timeline.
- scope diagnostics add discovered identities/assets and revise blast radius.
- `close_case` remains unavailable until the final decision and required verification.

Codex must receive the exact structured before/after result so it can explain what changed,
what remains open and why the next step follows.

## 7. Narration and sound

- Automatic TTS begins only after **Enter Simulation** or another real user gesture.
- A new accepted line is spoken exactly once; retries and duplicate idempotency keys do not
  repeat it.
- Queue rapid lines in order. New state may retire a stale queued line.
- One primary toggle: **Narration on/off**. Mute and volume remain global sound controls.
- Every line is visible as complete text and announced as a sentence-level live region.
- When narration is off or `speechSynthesis` is unavailable, captions remain complete.
- Prefer a local voice matching the current language automatically. Move the long operating-
  system voice list under Advanced settings.
- VERA reports urgent operational facts. Codex explanations may be mirrored into the same
  caption/TTS channel, but the UI must label generated guidance honestly and never create a
  second avatar.

## 8. 3D and visual work

Immediate correction pass:

- remove NODE geometry, light spill, diagnostics and all dead clearances
- fix mug-handle and mouse orientation
- slow and smooth the first-person wake reveal
- keep character breathing, weight transfer and camera easing subtle and non-accumulating
- do not force the camera so strongly that the player loses orientation
- add bevels to hero hard-surface objects and use texture-driven roughness/normal variation
- add restrained contact shading/SSAO only if the real-GPU budget remains green

High-realism pass:

- assemble the office in Blender from verified CC0 assets
- correct real-world scale, UVs, bevels, PBR materials and prop placement
- bake lighting/AO or lightmaps; use a restrained HDRI/environment contribution
- export GLB, then optimise geometry and compress textures for web delivery
- keep one R3F canvas, projected DOM monitors, demand rendering and the 2D fallback

AI image-to-3D output is a draft, never a shippable asset without topology, UV, material,
scale and licence review.

## 9. Implementation order

1. Remove NODE and migrate the state machine/domain vocabulary.
2. Narrow `present_guidance`, update schemas, docs and native WebMCP tests while retaining
   seven tools.
3. Move learn/solve ownership to VERA and remove all essential auto-advance dialogue.
4. Refactor the dashboard information architecture and build the scenario-relevant
   enterprise investigation tools.
5. Wire the three monitors to those same components and route targets.
6. Make every response operation update all affected simulated sources.
7. Simplify and verify automatic TTS.
8. Apply the immediate 3D correction pass; record the Blender/high-realism pass separately
   if the required `.blend` work cannot be produced and inspected in this environment.
9. Reconcile active documentation and regenerate release evidence on one clean RC SHA.

Do not run multiple headed GPU browser suites concurrently. Run the final GPU and native
WebMCP gates serially, one worker, against the production build.

## 10. Acceptance gates

- No NODE mesh, label, speaker, current beat or active contract remains.
- Exactly one in-world assistant exists and the story has no duplicate guide persona.
- VERA's report never disappears without player input.
- Seven native WebMCP tools register once and complete the deterministic case.
- The player can ask Codex, receive a state-grounded explanation and apply the corresponding
  operation in the simulation.
- Each operation changes the relevant SIEM/Identity/EDR/Network/incident/timeline views.
- All three 3D monitors are readable, keyboard-operable and open the correct full tool.
- Dashboard -> office -> dashboard preserves state, route intent and narration preference.
- Narration automatically speaks each accepted line once and always keeps captions.
- Keyboard, reduced-motion, 2D fallback and screen-reader paths complete the case.
- Real-GPU performance, drift, console/network, asset licence and native WebMCP gates pass.
- No document claims that the product is a complete enterprise platform, photoreal,
  reference-matched or connected to a live production SOC.

## 11. Owner/external work that code cannot close

- download, normalise and listen to the selected CC0 alarm WAVs
- approve or reject the captured visual direction
- perform headed pointer-lock/Escape validation on the demo machine
- run three uncoached novice sessions
- deploy the exact gated SHA over HTTPS
- execute the real ChatGPT/Codex built-in-browser run
- record the demo and publish the Devpost submission

