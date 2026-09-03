# Shooting script — Efe (the product takes)

You record everything the console does on its own: the case reaching containment,
the debrief, and the proof that the game is fully playable with no agent at all.
Cengizhan records the ChatGPT app.

Read `../DEMO_VIDEO.md` §2 for how these cut together. Your two shots are the
last third of the film — they answer "so what did it actually achieve?" and "and
what if I have no agent?".

---

## Setup

| # | Thing | Detail |
| --- | --- | --- |
| 1 | **Do Not Disturb ON** | A notification landed in our last capture. |
| 2 | **URL** | The deployed site only, never localhost: `https://cycase-gyq1usuwp-cengizhankoses-projects.vercel.app` |
| 3 | **Browser for B1** | Chrome 149+ with `chrome://flags/#enable-webmcp-testing` enabled and restarted. |
| 4 | **Browser for B2** | Plain Chrome, **flag off**. That is the whole point of the shot. |
| 5 | **Window** | 1440×900, browser chrome hidden if your recorder can. 1920×1080 60fps output. |
| 6 | **Recording** | Window only, **no system audio**, three seconds still at head and tail. |

---

## B1 — contain to debrief  *(target 26s)*

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
It is the number that proves the player was not a spectator. Give it room.

**Optional tail if you have time:** the full score log, where every point names
the action that earned it (`action:revoke_sessions`, `decision:D3_revoke_then_reset`).
Two seconds of scroll is enough to show it exists.

---

## B2 — no agent, still a game  *(target 20s)*

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

---

## What must never be in frame

- `localhost` or `127.0.0.1`.
- Bookmarks bar, other tabs, notifications, personal accounts.
- The Chrome flags page itself — set it up before you start.

---

## Two things to check before you send the files

1. **Is the phase strip legible at your capture size?** If the pills are too
   small to read at 1080p, zoom the browser to 110% and re-shoot. The phase
   model is one of the things the video is arguing.
2. **Did the score reach 100/100?** If your run scored lower, either re-run it
   or tell us — the voice-over says nothing about the number, but the frame does,
   and a lower score changes which sentence we can write over it.

## Hand off

Send Cengizhan the takes with a one-line note per file. He has the ChatGPT
material; the edit assembles yours after his.
