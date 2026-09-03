# Shooting script — Cengizhan

Two parts: your **camera block** (you, on screen, narrating) and your **screen
captures** (the ChatGPT app, agent-side shots). Do the camera block first — it
fixes the pacing the screen shots have to fill.

Read `../DEMO_VIDEO.md` first for how this all cuts together.

---

## Part 1 — your camera block

Full setup and framing rules are in `../DEMO_VIDEO.md` §6. Read that once before
you start.

**Your lines** (from `../DEMO_VIDEO.md` §4 — reproduced here so you have one
page to read from):

> **[camera]** Hi — I'm Cengizhan. This is CYCASE: a cyber incident-response
> simulation where an AI agent works a real case beside you. You just watched it
> happen — an agent reading evidence, proposing a move, and me approving it on
> the page.
>
> **[screen: A2]** It's built on WebMCP — seven site tools, registered right on
> the page. The shift doesn't even start until an agent actually shows up.
> Watch: the button's locked until it calls its first tool.
>
> **[screen: A5]** Here's that guarantee in action. The agent's own words show
> up as untrusted content, right beside the case's real label for the move. I
> approve — and it's recorded as my decision, not the model's.
>
> **[camera, with Efe — see "The joint close" below]** No agent? Still a full
> game — every control's right there, keyboard and all.
>
> **[screen: end card]** Thanks for watching.

**How to shoot it:**

1. Do the setup in `../DEMO_VIDEO.md` §6 — light in front of you, look at the
   lens, earbuds or lav mic, five seconds of silence before you start.
2. Record your **whole block above, straight through, in order** — including
   the parts marked `[screen: …]`. Do not skip them and do not stop between
   them. The editor decides which lines end up as your face on screen and which
   play under the ChatGPT footage; you do not need to think about that while
   recording.
3. The bracketed notes are for the editor. Do not read `[camera]` or
   `[screen: A2]` out loud.
4. Three full takes minimum. Keep the calmest one.
5. The **"No agent? Still a full game"** line is shot separately, with Efe — see
   the last section of this document.

---

## Part 2 — your screen captures (the ChatGPT app)

You record everything that involves the **ChatGPT desktop app**: the lobby, the
prompt, the agent's reasoning, the proposals and the approvals. Efe records the
console-only material.

**A full 39-minute playthrough is already recorded**
(`~/Desktop/cycase-demo/cycase-full-playthrough.mov`). It is the safety net,
not the cut: it has two macOS notifications in it and a cursor that moves like
a robot. Re-shoot the five shots below cleanly; fall back to the raw file only
if a shot will not come out.

### Setup — do this once, before any take

| # | Thing | Detail |
| --- | --- | --- |
| 1 | **Do Not Disturb ON** | Two AirPods notifications landed in the last recording. Control Centre → Focus → Do Not Disturb. |
| 2 | **Model** | GPT-5.6 **Sol** or **Terra**. Luna has WebMCP disabled and nothing will happen. Check the model chip at the bottom of the composer. |
| 3 | **Site tools** | ChatGPT → Settings → Browser → site tools enabled. |
| 4 | **Fresh chat** | ⌘N. The sidebar must not show other conversations in frame. |
| 5 | **Browser** | ⌘T, then the deployed URL — **never** localhost: `https://cycase-gyq1usuwp-cengizhankoses-projects.vercel.app` |
| 6 | **Window** | 16:9, do not resize between takes. Menu bar clutter hidden. |
| 7 | **Prompt on the clipboard** | Only if a take needs a paste you did not film — normally you click **Copy prompt** on the page, which is part of shot A2. |
| 8 | **Recording** | 1920×1080 60fps, window only, **no system audio** — narration is added separately from Part 1. Three seconds of stillness at the head and tail of every take. |

**Reload the page between takes** so the lobby is gated again. The gate opens
permanently once the agent has called a tool.

### A2 — the lobby gate  *(target 20s)*

The shot that says "this is a game you play *with* an agent."

1. Fresh page. In frame: **"Seven site tools are registered. No agent has called one yet."**
   and **Enter Simulation** greyed out.
2. Click **Copy prompt** on the *Start with your agent* card.
3. Click the chat composer, ⌘V, ⏎.
4. Hold until the agent's first reply lands **and** the lobby line flips to
   **"An agent is on the case. The shift can start."** with Enter Simulation now live.

**Must be legible:** the gate sentence before and after, and the Enter Simulation
button changing state. That state change is the shot.

**Cut in the edit:** the ~45s the agent takes to reply. Film it, we speed-ramp it.

### A3 — the page token  *(target 18s)*

The proof that the page tells the agent where the player is.

1. Continue from A2. The agent's reply reads roughly:
   > "Chief, I see incident **INC-74219, 'Session Ghost,' critical**, but the page
   > is waiting at **Enter Simulation**… Press Enter Simulation on the page; tell
   > me when the next screen appears."
2. Let that sit on screen for two full seconds.
3. Press **Enter Simulation**.
4. Let the wake and the typewriter play; press **Investigate the incident**.
5. Stop once the 3D office is up and the centre monitor is pulsing red.

**Must be legible:** the agent's sentence naming `Enter Simulation`.

### A4 — playing from the chat  *(target 25s)*

1. Dismiss the **Got it** look-controls popover.
2. Click **Acknowledge alarm**.
3. Let VERA arrive and deliver her report. Hold on it.
4. Click **Open response console**.
5. Type in the chat: `The response console is open.` and send.
6. Hold while the agent reads the evidence. Stop when the console is showing the
   phishing message in the Evidence inspector and the phase strip reads
   **Triage 1/3**.

**Must be legible:** the phase strip, and the console arriving on the evidence the
agent just read.

### A5 — the guarantee  *(target 30s — the most important shot in the film)*

1. Continue. The agent will say something close to:
   > "…I recommend preserving and inspecting. **Shall I send that recommendation
   > to the CYCASE console for you to approve?**"
2. Reply `Yes, send it to the console.` and send.
3. When the proposal card appears, **hold still for three seconds.** Do not move
   the cursor. In frame, all four of these must be readable:
   - **The agent suggests** · **Awaiting your approval**
   - the **Untrusted content** shell around the agent's own sentence
   - **"It is proposing: Preserve the reported message and inspect it"** — the
     case's own label, not the model's
   - *"The suggestion changed nothing. Approving runs it as you, and it is
     recorded as your decision."*
4. Move the cursor deliberately to **Approve and run it** and click once.
5. Hold three seconds on the receipt: **Applied · What this did**, Score +6,
   *Case state is now v2*.

This is the shot the whole submission argues from. Shoot it three times; keep the
calmest. No camera cut lands here — the frame plays alone (see the timeline in
`../DEMO_VIDEO.md` §3, row 6).

### A1 — the cold open  *(target 15s — film this LAST)*

Devpost wants the product working in the first fifteen seconds, so this is the
first thing a judge sees and the last thing you shoot, when you know the timing.
It plays **silent**, with one caption the editor adds — no camera, no VO needed
from you here.

1. Play the case forward to the **containment** stage — the point where the
   phase strip reads **Contain** and the card carries the red **Consequential**
   badge with **Revoke active sessions**.
2. Start recording there.
3. Show, in one unbroken take: the agent's proposal in the chat → the card on the
   page → **Approve** → the **Confirm: Revoke active sessions** dialog with its
   predicted impact → **Confirm** → the numbers moving (Active sessions 3 → 1,
   checklist filling, Score +10).

**Must be legible:** the impact sentence in the dialog, and the state changing
afterwards. Fifteen seconds, no dead air, no hunting for the button.

### What must never be in frame

- Your email address, other chat titles in the sidebar, other tabs.
- `localhost` or `127.0.0.1` in the address bar.
- Any notification banner.
- You typing the prompt by hand.

---

## The joint close (with Efe)

Row 8 of the timeline is both of you on camera together, delivering:

> Cengizhan: "No agent? Still a full game — every control's right there,
> keyboard and all."
> Efe: "It's open source, it's live, and it's built entirely on WebMCP."

Shoot this once, together, in the same frame or as two matched single shots (his
script has the same instructions) — whichever is easier to set up. Same setup
rules as Part 1: light in front, look at the lens, quiet room, three takes.

## Hand off

Send Efe (or wherever the files are collected) every clip, named by shot code:
`C-cengizhan.mov`, `A1.mov` … `A5.mov`, `C-joint-close.mov`. One-line note per
file on which take you kept, if you shot more than one.
