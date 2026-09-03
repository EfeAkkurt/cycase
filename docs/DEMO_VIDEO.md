# Demo video — scenario, scripts and work plan

Devpost requires a video **under three minutes**, publicly on YouTube, with audio
covering *what you built* and *how you used WebMCP*. Their own guidance: show the
project working in the first fifteen seconds, start already logged in, skip
setup and loading, and cut dead air, slow sections and live typing.

This is a **pitch video with two on-camera narrators**, not a silent screen
recording. Efe and Cengizhan both appear on camera, in their own words, cut
against the product working. Nothing here is recorded yet. This is the plan.

## 1. The thesis, in one sentence

**An agent can work a real incident beside you — and the page, not the model, is
what keeps it honest.**

Everything in the cut serves that sentence. If a shot does not, it goes.

## 2. Format

Two kinds of footage, cut together:

- **Screen captures** — silent, video only, no system audio. `SHOOT_CENGIZHAN.md`
  (shots A1–A5) and `SHOOT_EFE.md` (shots B1–B2). These already exist as scripts
  and one full 39-minute reference playthrough is captured at
  `~/Desktop/cycase-demo/cycase-full-playthrough.mov`.
- **Camera footage** — Efe and Cengizhan, on camera, each delivering their whole
  part of the script in one continuous take (§4). This is new since the last
  version of this plan.

The edit decides, shot by shot, whether a line plays as a **talking head** (face
on screen) or as **narration over screen b-roll** (voice continues, screen takes
over). You do not need to decide this while shooting — read your part straight
through, on camera, start to finish. Bracketed notes like `[screen: A2]` are for
the editor; do not read them aloud.

## 3. Timeline

Target **2:45**, hard ceiling 2:59.

| # | Time | Visual | Speaker |
| --- | --- | --- | --- |
| 1 | 0:00–0:10 | **Screen, silent, caption only.** A1 cold open: agent proposes, Approve, containment moves. Caption pops at 0:08: *"Contained · 100/100."* | — |
| 2 | 0:10–0:25 | **Camera.** Cengizhan, hook. | Cengizhan |
| 3 | 0:25–0:45 | **Screen** (A2, lobby gate), his voice continues. | Cengizhan |
| 4 | 0:45–1:00 | **Camera.** Efe, the guarantee. | Efe |
| 5 | 1:00–1:25 | **Screen** (A3 page token + A4 chat play), his voice continues. | Efe |
| 6 | 1:25–1:55 | **Screen only** (A5, the proposal card). No camera cut here — let the frame breathe. | Cengizhan (VO) |
| 7 | 1:55–2:15 | **Screen** (B1, contain → debrief, land on the activity split). | Efe (VO) |
| 8 | 2:15–2:35 | **Camera, both together.** Close. | Both |
| 9 | 2:35–2:45 | **Screen, static end card.** Live URL, repo, MIT. | Cengizhan (tail) |

Row 6 is deliberately camera-free: it is the single most important frame in the
film (the proposal card, untrusted-content shell, case label, Approve) and a
cutaway to a face would cost the viewer the read.

## 4. The script

Two blocks. Each person reads their **whole** block on camera, straight through,
in order, looking at the lens. `[screen: …]` notes are for the editor.

### Cengizhan's block

> **[camera]** Hi — I'm Cengizhan. This is CYCASE: a cyber incident-response
> simulation where an AI agent works a real case beside you. You just watched it
> happen — an agent reading evidence, proposing a move, and me approving it on
> the page.
>
> **[screen: A2]** It's built on WebMCP — seven site tools, registered right on
> the page. The shift doesn't even start until an agent actually shows up.
> Watch: the button's locked until it calls its first tool.
>
> **[screen: A5 — no camera cut, keep this short and let the card sit]** Here's
> that guarantee in action. The agent's own words show up as untrusted content,
> right beside the case's real label for the move. I approve — and it's
> recorded as my decision, not the model's.
>
> **[camera, with Efe]** No agent? Still a full game — every control's right
> there, keyboard and all.
>
> **[screen: end card, tail]** Thanks for watching.

### Efe's block

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
> **[camera, with Cengizhan]** It's open source, it's live, and it's built
> entirely on WebMCP.

Read this out loud once before recording — total is close to 100 words each,
which at a calm pace is close to the 45–50 seconds of on-camera-attributed time
each person gets in the timeline. If a take runs long, cut a clause, not the
pace.

## 5. Who records what

- **[`video/SHOOT_CENGIZHAN.md`](./video/SHOOT_CENGIZHAN.md)** — his camera
  block (§4 above) plus screen shots A1–A5.
- **[`video/SHOOT_EFE.md`](./video/SHOOT_EFE.md)** — his camera block plus
  screen shots B1–B2.
- **Row 8 (both together)** needs a joint sitting — see both scripts' final
  section for how to shoot it once and split it.

A full 39-minute playthrough against the deployed URL is already captured at
`~/Desktop/cycase-demo/cycase-full-playthrough.mov`. It is the fallback, not the
cut: it carries two macOS notifications and a mechanical cursor. Both scripts
say which screen shots to take fresh.

## 6. Camera setup — read this before recording either block

Same setup for both of you, so the two halves cut together without a visible
seam.

| # | Thing | Detail |
| --- | --- | --- |
| 1 | **Frame** | Landscape, eye-level, head and shoulders, a little headroom above. Phone or laptop webcam is fine at 1080p60 or better. |
| 2 | **Distance** | About an arm's length. Close enough that the face carries the room; not so close it distorts. |
| 3 | **Light** | Face a window or a lamp — light in front of you, never behind you. No hard shadows across the face. |
| 4 | **Background** | Plain wall, or a tidy room with nothing distracting behind you. No other screens visible. |
| 5 | **Audio** | Earbuds mic or a lav mic beats a laptop's built-in mic every time. Test one line first and listen back. |
| 6 | **Look at the lens**, not at your own preview. That is what reads as eye contact. |
| 7 | **Room tone** | Five seconds of silence, camera rolling, before you speak — the edit needs it for noise reduction. |
| 8 | **Takes** | Three full read-throughs minimum. Keep the calmest one, not the fastest. |
| 9 | **Wardrobe** | Solid colours read better than fine patterns on camera. |

Record your **whole** block in one continuous take each time — do not stop
between the bracketed sections. Natural pauses between them are fine and
expected; the edit finds the cut points.

## 7. What must never be in frame

- Anyone's email address, real name in a chat sidebar, or other chats.
- Any third-party logo beyond ChatGPT's own UI, which is unavoidable and fine.
- Copyrighted music. The rules exclude it explicitly.
- `localhost` or `127.0.0.1` in the address bar.
- Live typing of the prompt, sign-in, or loading screens.
- Notifications of any kind — Do Not Disturb on, always.

## 8. Claims the script must not make

- Do not say the data is real. It is synthetic and the interface says so.
- Do not say the agent decides anything. It proposes; the engine referees.
- Do not name a session length. It has never been measured.

## 9. Order of work

1. **Deploy** — done. Live URL: `cycase-gyq1usuwp-cengizhankoses-projects.vercel.app`.
2. **Each of you records your camera block** (§4, §6) — do this first; it is the
   part that needs a clean room and a good take, and it tells the editor exactly
   how long each screen segment has to fill.
3. **Record your screen shots** per your own script (A1–A5 or B1–B2).
4. **Shoot the joint close together** (row 8) — see the final section of either
   shoot script.
5. **Send everything to one place** — camera clips and screen clips, one file
   per shot, named by shot code (`C-cengizhan.mov`, `A2.mov`, `B1.mov`, …).
6. **Assemble in Remotion**: end card, the timeline in §3, camera cuts against
   screen b-roll per the bracketed notes in §4.
7. **Watch it once at full length.** If it is over 2:59, cut a clause from §4
   first, then trim the B1 tail.
8. **Upload to YouTube, public**, title
   `CYCASE — incident response you play with an agent`.
9. Paste the link into Devpost.

## 10. Remotion, when we get there

A title card, an end card, and lower thirds naming each speaker on their first
appearance. The camera and screen footage carry the film; motion design would
only cost seconds we do not have. Compositions at 1920×1080/60, one
`<Sequence>` per row in §3, camera audio as the master track so screen b-roll is
timed to the voice, not the other way round.
