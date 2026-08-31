# CYCASE — OpenAI WebMCP Challenge submission

## What it is

A first-person cyber incident simulation for people who have never worked an incident.
You wake at a SOC desk at night, a monitor is alarming, a colleague comes through the
door out of breath, and you work one real case — evidence, diagnostics, decisions,
containment — in a dashboard that is a real application, not a texture painted on a 3D
screen. An agent can sit beside you and work the *same* case through the page's own site
tools, and you watch it happen — proven at all seven tools in installed Chrome, against
the real `document.modelContext` with no shim (`tests/e2e/webmcp-native.spec.ts`).

## The beginner problem it solves

Incident-response training is either a slide deck or a capture-the-flag that assumes you
already know what a session token is. Neither teaches the thing that actually separates a
junior from a senior analyst: **order of operations under time pressure**. Revoking a
session before resetting the credential contains the attacker; doing it the other way
round lets them sign back in. Deleting the phishing email destroys the only record of how
they got in. CYCASE makes those the decisions, and shows the consequence of each.

Six decisions, D1–D6. Every wrong option is a real analyst mistake with a real cost, not
an error message — the case continues, the score reflects it, and the debrief explains
what it cost.

## Why a simulation rather than a dashboard demo

Because the lesson is situational. "Preserve evidence before acting" is a platitude on a
slide and a genuine trade-off when a transfer is draining and someone is standing over
your desk asking you to make it stop. The office, the alarm, the colleague's urgency and
the compressed clock exist to put the decision under the pressure it has in real life. The
case already has a history when you sit down: the phishing message landed at 02:41 and the
alert that wakes you fires at 03:17. From there incident time runs at a stated 3× play
time, with every operation you issue charging its own incident cost on top. How long a
first-time player actually takes has not been measured, so no session-length claim is made
here.

## Why WebMCP improves this beyond browser clicking

An agent that drives this app by clicking pixels can do everything wrong that a human can,
and the page has no way to stop it or explain it. Through site tools the page keeps its
own guarantees:

- **The page stays the referee.** Every tool call goes through the same `GameRuntime`
  and the same XState machine as a human click. The LLM never decides what is a valid
  action, what a decision costs, or when the case is contained.
- **Stale calls cannot corrupt state.** Every mutating tool carries a `stateVersion`;
  an out-of-date call is refused with a recovery instruction instead of silently applying
  to the wrong state.
- **Consequential actions are idempotent.** A retried `take_response_action` with the same
  `idempotencyKey` does not revoke sessions twice.
- **Attacker text stays data.** Evidence authored by the attacker is marked
  `untrusted` in the tool result itself, so the agent is told — structurally, not by
  wording — that instructions found inside it are not instructions.
- **Every agent action is visible.** Tool name, origin, and the state version before and
  after — or the error code, when the call was refused — appear in the activity rail as it
  happens. The human always knows what the agent just did. The engine also records the id
  of the region each call changed; the rail does not render that yet.

None of that is expressible through generic click-and-screenshot automation.

## How human and agent share one deterministic state

There is exactly one source of truth: a pure command engine in `src/game/engine.ts`. A
click and a tool call enter it through the same command path, so a decision the agent
submits and a decision you submit are the same `submit_decision` command with a different
`origin`. A run is fully reconstructible from its command log — `replay()` rebuilds it and
produces a signature, which is how a persisted run is verified rather than trusted.

The seven tools: `get_incident`, `inspect_artifact`, `run_diagnostic`, `submit_decision`,
`take_response_action`, `request_hint`, and `present_guidance`.

Six of them are domain tools and go through the engine. The seventh is the narration
channel and reaches nothing else. CYCASE is not a story game that walks through
pre-written lines: the security case is fully deterministic, and the story, the
teaching, the hints and the debrief are generated live for that player, at their level,
from the choices and mistakes they actually made. An LLM never decides score, a valid
action or state progression — and with no agent connected a deterministic fallback line
set narrates the same case to the same ending and the same score.

## What a learner understands after one run

- Why a display name is not identity evidence, and which three authentication results are.
- Why revoking sessions must precede resetting credentials.
- Why collecting endpoint evidence must precede isolating the host.
- Why "one alert" is a hypothesis until an indicator sweep measures the blast radius.
- Why closing against a verified checklist is what makes the next shift able to trust
  your work.

## Which data is simulated

**All of it, and the interface says so.** The feed is labelled *simulated live feed*. Every
identity, host, address and log line is synthetic: RFC 5737 TEST-NET-2 and TEST-NET-3
addresses, the RFC 5398 documentation ASN, invented domains that resolve to nothing and are
defanged where they stand for attacker infrastructure. There is no connection to any real
system and no third-party network request at runtime — `tests/e2e/local-mode-offline.spec.ts`
completes the whole case and asserts that every request came from the app's own origin,
rather than the README claiming it.

The clock is real: a deterministic simulation clock that advances event timestamps,
telemetry and the timeline consistently. The compression ratio is stated in the UI rather
than hidden.

## Assets and accessibility

Every model, texture, font and sound is licence-verified and recorded in
`ASSET_LICENSES.md` with source, creator, licence, date and redistribution rights, and a
CI script fails the build if a shipped asset is missing from the ledger. Poly Haven models
and textures are CC0. Inter and JetBrains Mono are OFL. The colleague is a CC0 Quaternius
character.

Interface cues, room tone and the acknowledgement relay are synthesised in the Web Audio
API. The **incident alarm is three CC0 sample files**, and they are **not in this build**:
Freesound requires a signed-in account to download originals, so the owner adds them with
`docs/AUDIO_ASSET_REQUEST.md`. Until they land the alarm is deliberately silent — the
centre monitor pulses, the panel reads Critical, and the interface says the sound is not
installed rather than substituting a synthesised stand-in.

Narration is spoken by the browser's own `speechSynthesis`. No paid TTS, no per-run cost,
no embedded model; quality is whatever the viewer's operating system provides, which is
why every spoken line is also a complete on-screen caption.

**No OpenAI or Codex artwork, character or branding is used or imitated.**

Accessibility is a gate, not an afterthought: the entire case is completable with the
keyboard alone and with 3D disabled, every canvas interaction has a semantic DOM
equivalent, the alarm never relies on colour alone — an icon and explicit wording carry it,
and while the samples are absent that wording says the sound is not installed rather than a
stand-in faking it — reduced motion removes the pulsing without removing the urgency, and
axe reports zero serious violations on every route.
`tests/e2e/alarm-degraded.spec.ts` asserts the silent-alarm caption is actually on screen.

## Judging instructions

> **Deployment is pending.** No public HTTPS URL exists yet: it needs a hosting
> account, which is the owner's to create. Until then the walkthrough below runs
> locally with `npm ci && npm run dev`. The steps are otherwise unchanged. The host
> configuration is committed.

**Build identity.** The running page publishes its own build on `window.__CYCASE_BUILD__` —
short git SHA, ISO-8601 build timestamp and package version, from `src/buildInfo.ts` — and
`tests/e2e/manual.spec.ts` asserts it against the served bundle rather than the module. A
build also writes the same three values to `/build-info.json`, from the same resolved
identity, so a deployed origin can be identified with `curl` without booting the app. A bug
report or a judging note can therefore name exactly which build it saw.

**Which commit the numbers belong to.** The full matrix below was run on `8e5de8d`.
Commits since then —
`a036baf`, which changes build tooling and a public asset, and the release/deployment pass,
which changes build configuration — have **not** had the full matrix rerun on them, so
neither is a gated SHA. No commit here is a
released build either: visual, audio and manual owner gates are open and there is no
deployment.

**The tested numbers, as recorded on `8e5de8d`:** 425 vitest tests (of which 145 backend-only
and 54 integration/load are filtered views of the same run), 158 headless E2E across desktop
and reduced motion, 53 real-GPU 3D tests passing with one headed pointer-lock check skipped,
and 12 native Chrome WebMCP tests. Secrets, 22 shipped-asset licences and 82 external links
are clean. The vitest suite is the only one that runs without a GPU or a browser, so it is
the only one rerun since: 431 on `a036baf`, and 436 with the release pass that added
`tests/unit/toolSurface.test.ts`. The browser and GPU suites still belong to `8e5de8d`.

1. Open the app. Press **Enter Simulation** — or **Skip intro** to go straight in.
2. Look around: drag the office, or use the arrow keys. **Recenter view** returns you.
3. Click the flashing centre monitor, or press Enter on its acknowledge control.
4. Let the colleague arrive, then choose **Explain first** or **Start solving**.
5. Work the case. The **Next required step** card always names the one action that
   advances it; optional evidence lives under **Explore more**.
6. To see the agent side: what is verified today is the page's half of the contract.
   Installed Chrome 151, launched headed with
   `--enable-features=WebMachineLearningModelContext,WebMCP`, registers all seven tools on
   the real `document.modelContext` and drives the case through them with no shim —
   `tests/e2e/webmcp-native.spec.ts`. Watch the activity rail while it works.
   The ChatGPT desktop app's built-in browser is the intended surface and that run has
   **not** happened yet: it needs the deployed URL above. The learn-mode prompt is in
   `docs/CODEX_WEBMCP_INTEGRATION.md` §15.
7. **Return to office** at any time — the case state and your camera come back with you.

Nothing requires a login.
