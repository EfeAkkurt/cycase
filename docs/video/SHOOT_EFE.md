# Shooting script — Efe

Two parts: your **camera block** (you, on screen, narrating) and your **screen
captures** (the console-only shots). Do the camera block first — it fixes the
pacing the screen shots have to fill.

Read `../DEMO_VIDEO.md` first for how this all cuts together.

---

## Part 1 — your camera block

Full setup and framing rules are in `../DEMO_VIDEO.md` §6. Read that once before
you start.

**Your lines** (from `../DEMO_VIDEO.md` §4 — reproduced here so you have one
page to read from):

> **[camera]** Hey, I'm Efe. The part we're proudest of: the agent can never
> take a risky action on its own. It proposes — right there on the page,
> labelled by the case, not by the model — and you approve.
>
> **[screen: A3 + A4]** It even knows where you are in the room. If you haven't
> opened the console yet, it tells you to, instead of guessing. Answer its
> questions in the chat, and the console follows you there.
>
> **[screen: B1]** By the end, the numbers tell the story: eleven actions were
> mine, thirty-four were the agent's — working together, not one replacing the
> other. Contained, at a hundred out of a hundred.
>
> **[camera, with Cengizhan — see "The joint close" below]** It's open source,
> it's live, and it's built entirely on WebMCP.

**How to shoot it:**

1. Do the setup in `../DEMO_VIDEO.md` §6 — light in front of you, look at the
   lens, earbuds or lav mic, five seconds of silence before you start.
2. Record your **whole block above, straight through, in order** — including
   the parts marked `[screen: …]`. Do not skip them and do not stop between
   them. The editor decides which lines end up as your face on screen and which
   play under the console footage; you do not need to think about that while
   recording.
3. The bracketed notes are for the editor. Do not read `[camera]` or
   `[screen: A3 + A4]` out loud.
4. Three full takes minimum. Keep the calmest one.
5. The **"It's open source, it's live"** line is shot separately, with
   Cengizhan — see the last section of this document.

---

## Part 2 — your screen captures (the console)

You record everything the console does on its own: the case reaching
containment, the debrief, and the proof that the game is fully playable with no
agent at all. Cengizhan records the ChatGPT app.

### Setup

| # | Thing | Detail |
| --- | --- | --- |
| 1 | **Do Not Disturb ON** | A notification landed in our last capture. |
| 2 | **URL** | The deployed site only, never localhost: `https://cycase-gyq1usuwp-cengizhankoses-projects.vercel.app` |
| 3 | **Browser for B1** | Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled and restarted. |
| 4 | **Browser for B2** | Plain Chrome, **flag off**. That is the whole point of the shot. |
| 5 | **Window** | 1440×900, browser chrome hidden if your recorder can. 1920×1080 60fps output. |
| 6 | **Recording** | Window only, **no system audio** — narration is added separately from Part 1. Three seconds still at head and tail. |

### B1 — contain to debrief  *(target 26s)*

The payoff shot. You are not showing the whole case, only the last stretch where
the work visibly lands.

**Getting into position (not filmed).** Play or drive the case until the
containment stages are done and the case is closed. Fastest route: use the
console's own controls — the guided card walks you through
`Session inventory → Revoke active sessions → Reset credentials →
Endpoint report → Isolate endpoint`, then the sweep, then `Close the case`.

**What to film**, in one continuous take with slow, deliberate scrolling:

1. The phase strip with **Triage ✓ Investigate ✓ Contain ✓ Scope ✓** and
   **Close** live.
2. The incident status going **Critical → Contained** and the containment
   checklist at **5/5**.
3. `Close the case`, its confirm dialog, and VERA's handover line:
   *"That is the case closed. It is off the live board and the record is written
   as it stands."*
4. **Open the debrief**, then rest on these, in this order:
   - **Outcome — Contained**
   - **Score 100/100**
   - **Human and agent activity: 11 by you · 34 by the agent** ← hold two seconds
   - **Breakdown** with all four bars full
   - **What was missed — nothing critical was left open**

**The single most important frame in your half is `11 by you · 34 by the agent`.**
It is the number your camera line lands on ("eleven actions were mine,
thirty-four were the agent's"). Give it room.

**Optional tail if you have time:** the full score log, where every point names
the action that earned it (`action:revoke_sessions`, `decision:D3_revoke_then_reset`).
Two seconds of scroll is enough to show it exists.

### B2 — no agent, still a game  *(target 20s)*

The shot that defends the accessibility claim. Judges will wonder whether this
is an agent demo that falls over without an agent.

1. Plain Chrome, **no WebMCP flag**. Open the deployed URL.
2. Show the lobby: it lets you **straight in** — no gate, and the card says the
   case is fully playable without an agent.
3. **Enter Simulation** → skip ahead to the console.
4. Answer one decision using the console's **own buttons** — pick
   *"Decide how to handle the reported message"* and click
   **Preserve the reported message and inspect it**.
5. Hold on the receipt that follows: *Applied · What this did*, Score +6.

**Must be legible:** the lobby letting you in without an agent, and a decision
being answered with a normal button. Let the controls be big enough to read.

### What must never be in frame

- `localhost` or `127.0.0.1`.
- Bookmarks bar, other tabs, notifications, personal accounts.
- The Chrome flags page itself — set it up before you start.

### Two things to check before you send the files

1. **Is the phase strip legible at your capture size?** If the pills are too
   small to read at 1080p, zoom the browser to 110% and re-shoot.
2. **Did the score reach 100/100?** If your run scored lower, either re-run it
   or tell Cengizhan — his line says "a hundred out of a hundred," and a lower
   score means that line has to change before the edit locks.

---

## The joint close (with Cengizhan)

Row 8 of the timeline is both of you on camera together, delivering:

> Cengizhan: "No agent? Still a full game — every control's right there,
> keyboard and all."
> Efe: "It's open source, it's live, and it's built entirely on WebMCP."

Shoot this once, together, in the same frame or as two matched single shots —
whichever is easier to set up. Same setup rules as Part 1: light in front, look
at the lens, quiet room, three takes.

## Hand off

Send Cengizhan (or wherever the files are collected) every clip, named by shot
code: `C-efe.mov`, `B1.mov`, `B2.mov`, `C-joint-close.mov`. One-line note per
file on which take you kept, if you shot more than one.
