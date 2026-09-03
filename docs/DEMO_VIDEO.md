# Demo video — scenario, scripts and work plan

Devpost requires a video **under three minutes**, publicly on YouTube, with audio
covering *what you built* and *how you used WebMCP*. Their own guidance: show the
project working in the first fifteen seconds, start already logged in, skip
setup and loading, and cut dead air, slow sections and live typing.

Nothing here is recorded yet. This is the plan.

## 1. The thesis, in one sentence

**An agent can work a real incident beside you — and the page, not the model, is
what keeps it honest.**

Everything in the cut serves that sentence. If a shot does not, it goes.

## 2. Timeline

Target **2:45**, hard ceiling 2:59. Times are cumulative.

| # | Time | On screen | Source |
| --- | --- | --- | --- |
| 1 | 0:00–0:14 | **Cold open, mid-case.** Chat: the agent proposes *Revoke active sessions*. Console: the proposal beside the case's own label, `Approve`. Cursor clicks Approve. Containment checklist 0/5 → 1/5, Active sessions 3 → 1, a receipt appears. | A1 |
| 2 | 0:14–0:34 | **What it is.** Lobby, gated: *"Seven site tools are registered. No agent has called one yet."* Copy prompt → paste in ChatGPT → send. Gate opens. | A2 |
| 3 | 0:34–0:52 | **The page tells the agent where you are.** Agent replies that `page` is `enter_simulation` and asks for the button. Press it. Wake, office, alarm, VERA's report. | A3 |
| 4 | 0:52–1:16 | **Playing from the chat.** Agent explains the first decision and asks. Answer in the chat. The console opens by itself on the evidence the agent just read. Phase rail Triage → Investigate. | A4 |
| 5 | 1:16–1:46 | **The guarantee.** Agent proposes a consequential move. Console renders the model's line as untrusted content *beside the fixture's own label*, with Approve. Approve. Receipt: what changed, what did not. | A5 |
| 6 | 1:46–2:12 | **Contain → close.** Phase pills filling, checklist to 5/5, severity Critical → Contained, debrief: score, three lessons, "Nothing critical was left open." | B1 |
| 7 | 2:12–2:32 | **No agent, still a game.** Plain Chrome: lobby lets you straight in, the same case played by hand through the console's own controls. | B2 |
| 8 | 2:32–2:45 | **Close.** Static card: live URL, repo URL, "MIT". | E1 |

## 3. Voice-over, word for word

One voice for the whole video. ~330 words at a calm pace is ~2:40 — do not
speed-read; cut a sentence instead.

> **[0:00]** This is a live security incident, and the thing on the left is an AI
> agent working it with me. It has just proposed revoking the attacker's
> sessions. It cannot do that itself — it proposes, I approve, and the page
> carries it out.
>
> **[0:14]** CYCASE is a cyber incident-response simulation for people who have
> never worked an incident. It registers seven WebMCP site tools on
> `document.modelContext`, so the agent and I share one case, one timeline and
> the same controls. The shift does not even start until an agent is actually
> on the line.
>
> **[0:34]** The first thing the agent does is read the incident — and the page
> tells it where I am. It knows I have not opened the console yet, so instead of
> acting into a screen I am not looking at, it asks me to press the button.
>
> **[0:52]** Now it teaches. It reads the evidence, explains what the message
> actually proves, and asks me which way to go. I answer in the chat, and the
> console follows the work: it opens on the evidence the agent just read, and
> the phase strip moves from triage to investigation.
>
> **[1:16]** Here is the part that matters. The next move is consequential, so
> the agent is not allowed to take it. It sends a proposal, and the page renders
> its sentence as untrusted content *beside the case's own label for that move* —
> so nothing the model writes can dress one operation up as another. I approve,
> and the command is recorded as mine. Every call is versioned and idempotent; a
> stale one is refused with a recovery instruction.
>
> **[1:46]** We contain the identity and the endpoint, sweep the estate for the
> same indicators, and close against a verified checklist. The debrief scores the
> run and names the habits worth keeping.
>
> **[2:12]** With no agent at all, the same case is fully playable by hand. The
> agent is a partner, not a dependency.
>
> **[2:32]** It is open source, MIT, and live at the link below.

## 4. Who records what

Two capture sets. Both must be recorded **against the deployed HTTPS URL**, not
localhost — judges will open the deployed site and the video should show the
same thing.

### Cengizhan — the agent takes (A1–A5)

You already have this working: ChatGPT desktop, built-in browser, GPT-5.6 Sol.

**Setup, before recording**
1. ChatGPT desktop, Settings → Browser → site tools enabled.
2. Model **GPT-5.6 Sol or Terra**. Luna has WebMCP disabled and will do nothing.
3. Open the deployed URL in the app's built-in browser (⌘T, or the side panel's
   **Browser** row).
4. Window at a 16:9 shape. Do not resize mid-take.
5. macOS: hide notifications, hide the menu-bar clutter, empty the chat sidebar.
6. Have the Learn prompt already on the clipboard — **never film yourself
   typing it**.

**A1 — the cold open (record last, when you know the case)**
Play the case up to the containment proposal, then start recording. Get: the
agent's proposal in the chat, the console's proposal card, one deliberate click
on **Approve**, and the numbers moving. ~15 seconds. Take it three times and
keep the calmest one.

**A2 — the lobby gate**
Fresh page. Show the gated lobby with the line *"Seven site tools are
registered. No agent has called one yet."* Click **Copy prompt**, click into the
chat, paste with ⌘V, send. Stop when the gate opens.

**A3 — the page token**
Continue: the agent answers that the page is at `enter_simulation` and asks for
the button. Press **Enter Simulation**. Let the wake and the office play. Stop
after VERA's report is on screen.

**A4 — playing from the chat**
Acknowledge the alarm. Let the agent explain the first decision. Answer it **in
the chat** — short, e.g. `Preserve the message and inspect it.` Stop once the
console has opened and the phase strip shows Investigate.

**A5 — the guarantee**
Continue to a consequential move. Frame both halves: the agent's line in the
chat *and* the proposal card on the page. Click **Approve** slowly enough to see
it. Hold on the receipt for two seconds.

### Efe — the product takes (B1–B2)

Chrome 149+ with `chrome://flags/#enable-webmcp-testing`, or plain Chrome for
B2. Same deployed URL. 1440×900, browser chrome hidden if you can.

**B1 — contain to debrief**
Drive the case to the end however is fastest, then record the *last* stretch:
the phase pills filling, the containment checklist reaching 5/5, severity
flipping to **Contained**, and the debrief — score, the three lessons, and
"Nothing critical was left open." Scroll slowly; no jump cuts inside the shot.

**B2 — no agent, still a game**
Plain Chrome, **no** WebMCP flag. Show the lobby letting you straight in and one
decision answered with the console's own buttons. This is the shot that proves
the accessibility claim, so let the controls be legible.

### Either of you — E1

A static end card: live URL, `github.com/EfeAkkurt/cycase`, "MIT". Ten seconds
of stills is fine; it will be built in the edit.

## 5. Capture settings

- **1920×1080, 60fps**, H.264. Record the window, not the whole desktop.
- **No system audio.** Voice-over is recorded separately and laid over.
- Cursor visible. Move it deliberately — a cursor that darts is unreadable at
  three minutes.
- No notifications, no personal email, no other tabs, no Slack, no calendar.
- Each take: three seconds of stillness at the head and tail for the edit.

## 6. What must not appear

- Anyone's email address, real name in the chat sidebar, or other chats.
- Any third-party logo beyond ChatGPT's own UI, which is unavoidable and fine.
- Copyrighted music. The rules exclude it explicitly.
- `localhost` or `127.0.0.1` in the address bar.
- Live typing of the prompt, sign-in, or loading screens.

## 7. Claims the voice-over must not make

- Do not say the data is real. It is synthetic and the interface says so.
- Do not say the agent decides anything. It proposes; the engine referees.
- Do not name a session length. It has never been measured.

## 8. Order of work

1. **Deploy.** Everything downstream needs the URL. *(blocking)*
2. **Smoke the deployed build** in the ChatGPT desktop browser once: seven tools
   in Site tools, one decision, one approval.
3. **Cengizhan records A2 → A5**, then **A1** last.
4. **Efe records B1, B2.**
5. **One voice records the whole VO** to §3, in one sitting, one microphone.
6. **Assemble in Remotion**: end card, lower thirds naming each guarantee, the
   timeline in §2. Titles only — no transitions that cost seconds.
7. **Watch it once at full length.** If it is over 2:59, cut shot 7 first, then
   trim §3's third paragraph.
8. **Upload to YouTube, public**, title `CYCASE — incident response you play with an agent`.
9. Paste the link into Devpost.

## 9. Remotion, when we get there

Kept deliberately small: a title card, an end card, and lower thirds. The
screen recordings carry the film; motion design would only cost seconds we do
not have. Compositions at 1920×1080/60, one `<Sequence>` per shot in §2, audio
as a single track so the VO timing in §3 is the master clock.
