# Devpost submission — every field, ready to paste

Deadline **4 September 2026, 04:00 EDT** (11:00 Istanbul) — Devpost's own clock.
**Submitted 4 September 2026, 01:45 Istanbul** with the copy below; editable
until the deadline. Project page:
https://devpost.com/software/cycase-incident-response-you-play-with-an-agent

Rules require the description to answer four things by name: why the use case
fits WebMCP, how it improves the experience, what people and agents can now do
together that was hard before, and how WebMCP was implemented. Devpost's own
field additionally asks what inspired you, what you learned, how you built it
and what the challenges were. The copy below covers all eight.

---

## 1. Project name  *(≤60 characters)*

```
CYCASE — incident response you play with an agent
```

*48 characters.*

## 2. Elevator pitch  *(≤200 characters)*

```
A cyber incident-response simulation where an AI agent works the case beside you through seven WebMCP site tools. It proposes, you approve, and the page — not the model — is the referee.
```

*185 characters.*

## 3. About the project

> Paste as Markdown. Headings below map to the rules' four required points and
> Devpost's four prompts.

### What it is

You wake at a SOC desk at 03:17. A monitor is alarming, a colleague comes
through the door with the first facts, and you have one real incident to work:
a stolen session that a password reset will not close. An AI agent works it
beside you — reading evidence, explaining what it proves, proposing the next
move — through seven WebMCP tools the page registers on
`document.modelContext`.

### Why this is a strong fit for WebMCP

Incident response is exactly the domain where "the agent clicked something"
is not good enough. Every action has an order, a cost and a consequence:
revoking sessions before resetting a credential contains the attacker, the
other order lets them back in; deleting the phishing message destroys the only
record of how they got in.

An agent driving this by clicking pixels could make every one of those mistakes
and the page would have no way to stop it, explain it, or even know it had
happened. Through site tools the page keeps its own guarantees — and they are
guarantees about *safety*, not convenience.

### How it creates a better experience

The player runs the incident from the chat and the console follows the work,
rather than the player hunting for the control the agent just used.

- `get_incident` tells the agent **which screen the player is on**. If the
  console is not open yet, the agent asks the player to open it instead of
  acting into a screen nobody is looking at.
- The shift does not start until an agent has actually called a tool.
  Registration is the page's own doing; it is not an arrival, and the lobby no
  longer pretends it is.
- Every call — human or agent — produces a receipt beside the control that
  issued it: what happened, what changed, why it mattered, and on a failure what
  did *not* change plus exactly one way forward.

### What people and agents can do together that was difficult before

**The agent cannot take a consequential move at all.** It sends the move as a
*proposal*; the console renders the model's own sentence as untrusted content
**beside the case's own label for that action**, so nothing the model writes can
dress one operation up as another. The player approves, and the command enters
the log with `origin: human`.

That is the thing that was previously impossible. A chat assistant can advise
and a scripted tool can execute, but neither can offer a consequential action
*in a surface the user already trusts*, labelled by the application rather than
by the model, with the authorisation recorded as the human's. It turns "the AI
did it" into "I did it, having been advised" — which for incident response is
the difference between a training exercise and a liability.

### How WebMCP was implemented

Seven tools, registered on the top-level `document.modelContext`:
`get_incident`, `inspect_artifact`, `run_diagnostic`, `submit_decision`,
`take_response_action`, `request_hint`, `present_guidance`.

Six reach a pure command engine. A tool call and a button press enter it through
the same path and differ only by an `origin` field, which is what makes "the UI
and the agent share one state" structural rather than aspirational.

- **Stale calls cannot corrupt state.** Every mutating tool carries a
  `stateVersion`; an out-of-date call is refused with a recovery instruction.
- **Consequential actions are idempotent.** A retried containment with the same
  `idempotencyKey` does not revoke twice.
- **Attacker text stays data.** Evidence the attacker authored is marked
  `untrusted` in the tool result itself — structurally, not by wording.
- **A run is reconstructible.** The command log replays to the same state and
  the same signature, so a stored run is verified rather than trusted.
- **The seventh tool changes nothing.** `present_guidance` is the narration
  channel and the only tool whose words the model writes. It carries the
  `proposes` field, and the engine — never the model — decides score, validity
  and progression.

Results are compacted to a ~1500-character wire budget with an ordering that
protects the fields an agent needs to recover, and the page token's size is
reserved *before* compaction so it can never be clipped away.

### What inspired it

Incident-response training is either a slide deck or a capture-the-flag that
assumes you already know what a session token is. Neither teaches the thing that
separates a junior from a senior analyst: order of operations under pressure.
And every "AI agent" demo we could find either solved the task for the user or
asked them to trust a black box. We wanted the third thing — an agent that
teaches while the human stays in command.

### What we learned

That the honest signal is rarely the convenient one. The lobby called itself
"connected" the moment the page registered its own tools, which says nothing
about an agent; the fix was to wait for a call that actually happened. The same
lesson repeated in the test double: it modelled a browser with WebMCP and nobody
attached, while every spec using it assumed an agent was there.

We also learned how little room a tool result has. Adding one short field to
`get_incident` meant reserving its size before compaction, because the payload
already ran within about fifteen characters of the budget.

### How we built it

React 19, TypeScript and XState 5 over a pure command engine, with a three.js
office rendered by React Three Fiber as real DOM projected onto the monitors —
never a screenshot texture. Vitest for the engine, Playwright for the agent
path, including a project that drives the **real** `document.modelContext` in
installed Chrome with no shim.

### Challenges

The hardest was resisting the obvious design. It is easy to let an agent call
`take_response_action` and narrate afterwards; every version of that we tried
produced a debrief that said the player had done nothing. Moving the
consequential move behind a proposal — and making the console label it from the
fixture rather than from the model — took three attempts and is the part of the
product we are most confident about.

The second was honesty under a deadline: the alarm audio is not in this build
because the samples need a signed-in download, so the interface says the sound
is not installed rather than substituting a synthesised stand-in.

## 4. Built with  *(≤25 tags)*

```
webmcp, document.modelContext, typescript, react, vite, xstate, three.js,
react-three-fiber, web-speech-api, playwright, vitest, chatgpt, openai,
node.js, css, vercel
```

## 5. Which agent(s) or client(s) did you test your WebMCP tools with?

```
ChatGPT desktop app, built-in browser, GPT-5.6 Sol — played the case end to end
from the chat: seven site tools discovered, every decision asked and answered in
the chat, closed Contained. Also driven headlessly against the real
document.modelContext in installed Chrome 151 with
--enable-features=WebMachineLearningModelContext,WebMCP and no shim
(tests/e2e/webmcp-native.spec.ts), plus a full shim suite in Playwright.
```

## 6. Which AI tools have you leveraged while working on this project?

```
ChatGPT and Codex (GPT-5.6 Sol) for implementation, review and the in-app
browser used to verify the WebMCP path; Claude Code for implementation and code
review.
```

*Fill in anything else either of you used — the field is factual, not a pitch.*

## 7. App Status → **Existing**

Required explanation of what was added during the submission period:

```
The repository predates the submission window, but every WebMCP capability in it
was built during the window: the seven-tool surface on document.modelContext,
the proposal model that stops an agent taking a consequential action, the page
field that tells an agent which screen the player is on, the lobby gate that
waits for a real agent call, per-command receipts, and the agent-path test
suites (shim and native Chrome). Before the window the project had no agent
integration of any kind.
```

*Verify this sentence against the repository history before submitting.*

## 8. Testing instructions

```
No login. Open the live URL in the ChatGPT desktop app's built-in browser, or in
Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled.

The lobby waits for an agent: copy the prompt from the "Start with your agent"
card, paste it into the chat beside the page, and send it. The agent's first
tool call opens the shift. Answer its questions in the chat and approve the
moves it proposes on the page.

To play without an agent, open the same URL in any browser: the lobby lets you
straight in and the whole case is playable with the console's own controls, by
keyboard, with sound off and 3D disabled.

The alarm sound is deliberately not installed in this build; the interface says
so rather than substituting a stand-in.
```

## 9. Other fields

| Field | Value |
| --- | --- |
| Video demo link | https://www.youtube.com/watch?v=RFlYtoRGxrs (2:34, public) |
| Live URL | https://cycase-gyq1usuwp-cengizhankoses-projects.vercel.app |
| Repository | `https://github.com/EfeAkkurt/cycase` |
| Submitter type | Team of Individuals |
| Country of residence | Türkiye, for both team members |
| Level of learning | Significant |
| AI value for your career | Yes |
| Thumbnail | A console frame with the phase strip and a proposal card visible |

---

## 10. Gate checklist

| # | Gate | State |
| --- | --- | --- |
| 1 | Public repository | ✅ `EfeAkkurt/cycase` |
| 2 | Open-source licence visible in About | ✅ MIT |
| 3 | WebMCP registration in the repo | ✅ seven tools on `document.modelContext` |
| 4 | Verified in ChatGPT's in-app browser | ✅ played end to end |
| 5 | Live URL judges can open | ✅ Vercel |
| 6 | Video under 3 min, public on YouTube, with audio | ✅ 2:34, RFlYtoRGxrs |
| 7 | Description answers the four required points | ✅ §3 above |
| 8 | Existing-project explanation | ✅ §7 above — verify before sending |
| 9 | Both team members added and accepted | ⏳ Efe invited, must accept |
| 10 | Rules agreement ticked, not left as a draft | ✅ submitted |

## 11. Order of work

1. **Deploy** → paste the URL into §9 and into `DEMO_VIDEO.md`. *(blocking)*
2. **Smoke the deployed build** once in the ChatGPT desktop browser: seven tools
   in Site tools, one decision, one approval. If that fails, nothing else
   matters.
3. **Fix the lobby's disabled-button overlap** — the reason text sits on top of
   the label, and shot A2 of the video frames it.
4. **Record** to `DEMO_VIDEO.md` §4: Cengizhan A2→A5 then A1, Efe B1–B2.
5. **Voice-over**, one voice, one sitting, to `DEMO_VIDEO.md` §3.
6. **Assemble in Remotion**, watch once at full length, cut to under 2:59.
7. **Upload to YouTube as public.**
8. **Fill the Devpost form** from this document, add both team members, tick the
   agreement, submit — *not* as a draft.

Steps 4–6 cannot start before 1. Step 3 can happen while 1 runs.
