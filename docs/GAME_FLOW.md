# Game Flow

## How to read this document

The **structure** below is deterministic: the order of beats, the state
transitions, the decision prerequisites, the operations, the scoring and the
endings. That is engine-owned and never negotiable.

The **words** below are not the shipped script. Every quoted line is a tone
reference and the deterministic fallback that plays when no agent is connected.
When Codex is connected it writes the explanations, the response to a mistake
and the debrief live — through `present_guidance` — against the player's level,
the explanation style the run has inferred, the evidence they have actually
inspected and the current case state.

What it does **not** write is VERA. A generated line arrives in its own channel,
labelled "Generated guidance" in the caption and inside the announced region, so
a screen reader hears the source as well as the sentence. It never appears under
her name, and it never becomes a second avatar. The deterministic guidance the
engine derives from case state — the hints, the decision explanations and the
"Explain the incident" body — is labelled "Case guidance" for the same reason
pointing the other way: nothing generated it, and it is not hers either.

There is one in-world assistant: VERA, a human operations assistant. She reports
operational facts and the results of actions. Codex is not a character in the
office. It has no avatar and never appears as a second guide; the player reaches
it through Codex/ChatGPT, and it reaches the case through WebMCP.

Both modes traverse exactly the same beats and produce exactly the same score.

## The Spine

`NODELESS_SOC_REDESIGN_2026-08-31.md` §2, which the rest of this document
expands:

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

The two update lines above are register, not copy: the shipped fallback
addresses the operator by name rather than as "Chief".

The office half of that spine is the machine's `office` region in
`src/game/machine.ts`:

```text
alarmUnacknowledged -> acknowledged -> assistantReporting -> briefingChoice
  -> (explained) -> DEBUG
```

plus `resume`, the beat a player lands on when they return from the dashboard.

## Opening Sequence

The choreography before the alarm is short, and the player is never locked out
of it. The intro does not advance on a timer at all: the machine's `intro` state
waits for the player, and the typewriter's own duration — 3,438 ms at the
English fallback text, from `planTypewriter` in `src/ui/intro/typewriter.ts` —
only governs how long the drawing takes, not when the scene moves on.
A visible control sits under the intro text the whole time — **Skip intro**
while the lines are still being drawn, **Investigate the incident**
(`intro.action.investigate`) once they have finished — and either press advances
to the office.

1. Black screen.
2. After the user presses **Enter Simulation**, initialize audio.
3. Bottom text appears with restrained typewriter sound. Three short lines,
   in this shape — timestamp, one-sentence detection statement, one wake
   address. The fallback text in `src/i18n/en.ts`, and the tone the generated
   version must match:
   - `03:17:42`
   - `Unauthorized session detected in the identity layer.`
   - `{name}, wake up.`

   The timestamp is engine-owned and never generated. The two sentences are
   narration. `{name}` is the operator name, or `Operator` when none is set.
4. The first-person wake reveal: the lids open to a narrow gap, close part of
   the way once, then open fully while the exposure settles on the desk and the
   three monitors. 2,850 ms in `src/ui/intro/wake.ts`, inside the 2.8–3.4 s the
   redesign asks for. Under reduced motion the overlay is not mounted at all.
5. The centre monitor pulses red and is the primary visible and
   keyboard-focusable target. The three alarm WAVs are not in the build, so the
   alert is visual only, and the dialogue panel says so in plain words rather
   than letting the silence read as a bug (`office.alarm_silent`).
6. The player acknowledges the alarm — the flashing screen itself, or the
   acknowledge control on the panel projected onto it. Nothing else happens
   until they do. This is `alarmUnacknowledged -> acknowledged`.
7. VERA enters and reports the incident. Her path, timing and animation are
   scripted; the report itself is narration. The scene reports her arrival, and
   again when she has finished speaking, which is what drives
   `acknowledged -> assistantReporting -> briefingChoice`.
8. Her report stays on screen and the two choices are added beneath it. The
   report is rendered identically in `assistantReporting` and `briefingChoice`,
   so advancing the beat cannot take it away. The 3.2-second timer that used to
   remove it is gone. The timers that remain — 4,500 ms and 6,000 ms in
   `src/game/machine.ts` — are deadlock safety nets for the case where the
   entrance or report animation cannot run at all, and all they do is add the
   choice.

The briefing offers exactly two actions, and no third:

- **Explain the incident** (`intro.action.explain_first`)
- **Open response console** (`intro.action.solve`)

**Explain the incident** moves to the `explained` beat, which shows a short
state-grounded explanation of what the telemetry means and then offers one
onward control, **Open response console**. From either beat that control sends
`DEBUG`.

The choice does not set the explanation style. That value is derived rather
than chosen: `explanationStyle()` in `src/game/narrative.ts` returns `guided`
once the player has asked for a hint or answered a decision wrongly, and
`direct` until then. It is a pure function of this run's context and resets with
the case — no profile, no account, no personal data, and nothing kept outside
the run.

Activating **Open response console** fades the 3D office to black and reveals
the full-screen SOC dashboard. All following investigation and response
decisions occur in the real dashboard UI.

### Returning to the office

**Return to office** and **Return to dashboard** are a round trip, not a
restart. `RETURN_TO_OFFICE` from the dashboard lands on the office's `resume`
beat, which replays neither the wake reveal, nor the alarm, nor VERA's
entrance: it says the case is still live and where the investigation stands, and
offers a single control back to the console. Case state, route intent and the
narration preference survive both directions.

## Case 001: Session Ghost

### Incident Chain

```text
Phishing email
  -> fake sign-in page
  -> stolen session cookie
  -> login from unusual location
  -> cloud file enumeration
  -> attempted data exfiltration
```

All identities, domains, IP addresses and logs are fictional.

### Monitor Roles

What ships today. All three are the same React panels the dashboard uses, in
`compact` mode, mounted in `src/ui/office/Office3D.tsx` — not textures, and not
a second copy of the data:

- Left: `TelemetryPanel` — event stream, authentication anomalies and severity
  trend.
- Centre: `IncidentPanel` — the alarm and its acknowledge control first, then
  the incident brief.
- Right: `TopologyPanel` — identity and device relationships, and containment
  state.

The redesign's three-monitor contract (§5: SIEM on the left, incident command in
the centre, and a contextual investigation tool on the right that follows the
current required step) is the target for these same components. It is not built
yet.

### Decision Sequence

Decisions and operations are two separate layers (see `WEBMCP_CONTRACT.md`).
A decision is a pedagogical branch answered with `submit_decision`; it never
touches the simulated environment. The containment work itself happens through
`take_response_action`, `run_diagnostic` and `inspect_artifact`.

Both options of every decision are valid moves. The weaker one is not an error —
it is a branch with a deterministic cost and an explanation.

#### D1: Triage

Opens immediately.

- `D1_preserve_and_inspect` — Preserve the reported message and inspect it. *(+6 evidence)*
- `D1_disable_account_now` — Disable the account immediately, investigate later. *(−6 evidence; disables `usr_dilara`; sets `evidence_at_risk`)*

Learning goal: urgency does not remove the need to preserve evidence.

#### D2: Validate

Opens after D1 and after `art_email_001` has been inspected.

- `D2_compare_signin_telemetry` — Compare the authenticated sender and sign-in telemetry. *(+5 evidence)*
- `D2_trust_sender_display_name` — Trust the sender display name. *(−5 evidence)*

Learning goal: display names are not identity evidence.

#### D3: Contain

Opens after D2 and after `auth_timeline` has been run.

- `D3_revoke_then_reset` — Revoke every active session, then reset credentials. *(+5 containment; recommends `revoke_sessions`, `reset_credentials`)*
- `D3_password_only` — Change the password only. *(−6 containment)*

Learning goal: a password reset alone may not invalidate an already stolen session.

#### D4: Endpoint

Opens after D3.

- `D4_collect_then_isolate` — Collect the endpoint evidence, then isolate the host. *(+5 evidence; recommends `isolate_endpoint`)*
- `D4_delete_email_and_close_alert` — Delete the suspicious email and close the alert. *(−8 evidence; **permanently destroys `art_email_001`**)*

Learning goal: removing the visible symptom does not contain the incident.

#### D5: Scope

Opens after D4.

- `D5_sweep_indicators` — Sweep every indicator across the estate. *(+5 scope; recommends `block_indicator`)*
- `D5_assume_single_account` — Assume only the reported account is affected. *(−6 scope)*

Learning goal: incident scope must be verified, not assumed.

#### D6: Close

Opens after D5. Either option unlocks `close_case`; neither closes the case by
itself.

- `D6_verify_checklist` — Review the containment checklist, then close. *(no cost)*
- `D6_close_without_verifying` — Close now without reviewing. *(−3 efficiency)*

Learning goal: closure requires evidence that the threat is contained.

### Operations

Independent of the decisions, and required to actually contain the incident:

| Operation | Resolves | Score |
|---|---|---|
| `run_diagnostic auth_timeline` | — | +4 evidence |
| `run_diagnostic session_inventory` | — | +5 containment |
| `run_diagnostic indicator_scope` | `scope_unverified` | +10 scope |
| `inspect_artifact art_email_001` | — | +4 evidence |
| `inspect_artifact art_cookie_001` | — | +3 evidence |
| `inspect_artifact art_edr_001` | — | +3 evidence |
| `take_response_action revoke_sessions` | `rogue_session_active` | +10 containment, −4 if `session_inventory` was skipped |
| `take_response_action reset_credentials` | `credentials_exposed` | +7 containment |
| `take_response_action isolate_endpoint` | `endpoint_uncontained` | +8 containment, −4 evidence if `art_edr_001` was not read |
| `take_response_action block_indicator` | `indicators_unblocked` | +5 scope |
| `take_response_action close_case` | — | −5 efficiency if critical findings remain |

A flawless run scores exactly 100: 30 evidence, 35 containment, 20 scope,
15 efficiency. Each bucket is clamped to `[0, max]`.

## Narration

Narration is a separate layer from the case. It is delivered by
`present_guidance` (see `WEBMCP_CONTRACT.md`) and is subject to these rules:

- A narration message can never change the score, the valid actions or the
  progression. It carries `basedOnStateVersion` for correctness and
  `idempotencyKey` so a retry does not re-speak, but it never bumps
  `stateVersion`.
- Ordering uses its own monotonic `narrativeSequence`, so narration cannot
  collide with or invalidate the domain `stateVersion`.
- Every message is appended to an append-only narrative log.
- Only one line is active in the UI at a time; the rest queue behind it.
- The player can **Skip**, **Repeat** and **Stop Voice** at any point.
- Every spoken line is simultaneously shown in full as a caption. Nothing is
  audio-only.
- With no agent connected, the deterministic fallback line set in
  `src/i18n/en.ts` plays instead, and the run is otherwise identical.
- `present_guidance` carries a `tone` and a `language`, and no speaker. The
  three-value `speaker` choice was removed along with the second in-world
  character: Codex chooses the message and the register, the page owns the one
  channel that delivers it. The validated shape is `presentGuidanceSchema` in
  `src/game/validation.ts`.
- The page's own string table is English only (`src/i18n/index.ts`), while
  `present_guidance` accepts `language: 'tr' | 'en'`. A generated line may
  therefore be Turkish while the surrounding chrome is not.

What the narration adapts to, through the bounded `coaching` snapshot on
`get_incident`: the player's level and explanation style — both derived from
this run's hints and wrong answers, never chosen or stored as a profile — which
evidence they have and have not inspected, which diagnostics ran, which moves
were correct and which were not, the score so far, elapsed simulation time and
the last few lines already spoken. The single step that unblocks the case is
`get_incident.requiredNextAction`, restated at the top level for exactly this
reason; `openDecision` carries the decision itself when one is open.

## Endings

### Contained

Requirements:

- Suspicious session revoked.
- Credentials reset.
- Endpoint isolated or cleared through evidence.
- Indicators scoped.
- No unresolved critical finding.

### Partial Containment

Triggered when the player closes the case with one or more unresolved critical findings. The debrief explains the exact missed action and its likely consequence.

## Score

Score is deterministic and never supplied by the LLM. Narration may *explain*
a score; it can never produce one.

- Evidence quality: 0–30.
- Containment quality: 0–35.
- Scope accuracy: 0–20.
- Decision efficiency: 0–15, starting full and spent only by avoidable mistakes.

The score is a pure function of an append-only score log, so a run is fully
replayable and auditable.

Do not punish the player for requesting explanations or accessibility features.
`request_hint` never changes the score and says so in its own response.
