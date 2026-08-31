import { assign, setup } from 'xstate';

import { createInitialContext } from './context';
import { executeCommand } from './engine';
import type {
  AgentStatus,
  ArtifactId,
  DashboardRoute,
  GameCommand,
  GameContext,
  InvestigateTab,
  InvestigationFocus,
  TimeRangeId,
} from './types';

/**
 * The deterministic game machine.
 *
 * XState owns the scene graph and the case context. Every case mutation goes
 * through the single `COMMAND` event, whose handler is the pure engine — so
 * there is exactly one way to change the game, and both the dashboard and the
 * WebMCP tool layer use it.
 *
 * `TICK` deliberately does *not* bump `stateVersion`: a live clock must never
 * make an agent's in-flight call go stale.
 */

export type GameEvent =
  | { type: 'ENTER' }
  | { type: 'SKIP_INTRO' }
  | { type: 'INTRO_ADVANCE' }
  | { type: 'ACKNOWLEDGE_ALARM' }
  | { type: 'COLLEAGUE_ARRIVED' }
  | { type: 'REPORT_DELIVERED' }
  | { type: 'EXPLAIN' }
  | { type: 'DEBUG' }
  | { type: 'RETURN_TO_OFFICE' }
  | { type: 'TRANSITION_DONE' }
  | { type: 'COMMAND'; command: GameCommand }
  | { type: 'TICK'; seconds: number }
  | { type: 'SET_PAUSED'; paused: boolean }
  /**
   * `tab` is optional and only applies when supplied: a plain destination
   * change must not silently reset which investigation tool was open. It
   * exists so a surface outside the console — an office monitor — can express
   * "open Investigate on Identity" as one intent instead of two events that
   * can be interleaved by a scene transition.
   */
  | { type: 'SET_ROUTE'; route: DashboardRoute; tab?: InvestigateTab }
  | { type: 'SET_INVESTIGATE_TAB'; tab: InvestigateTab }
  | { type: 'SELECT_ARTIFACT'; artifactId: ArtifactId | null }
  /** The console-wide time range. One control, several places, one value. */
  | { type: 'SET_TIME_RANGE'; range: TimeRangeId }
  /**
   * Follow something across the tools — or stop following it, with `null`.
   *
   * `route` and `tab` ride along for the same reason they do on `SET_ROUTE`:
   * "open Endpoint on WKS-114" is one intent, and splitting it into two events
   * lets a re-render land between them and show the wrong tool for a frame.
   */
  | { type: 'SET_FOCUS'; focus: InvestigationFocus | null; route?: DashboardRoute; tab?: InvestigateTab }
  | { type: 'SET_AGENT_STATUS'; status: AgentStatus }
  | { type: 'SET_OPERATOR_NAME'; name: string }
  | { type: 'OPEN_DEBRIEF' }
  | { type: 'RESTART' };

export const gameMachine = setup({
  types: {
    context: {} as GameContext,
    events: {} as GameEvent,
    input: {} as { operatorName?: string } | undefined,
  },
  actions: {
    runCommand: assign(({ context, event }) => {
      if (event.type !== 'COMMAND') return {};
      return executeCommand(context, event.command).context;
    }),
    tick: assign(({ context, event }) => {
      if (event.type !== 'TICK') return {};
      if (context.paused) return {};
      return { clockSec: context.clockSec + event.seconds };
    }),
    setPaused: assign(({ event }) =>
      event.type === 'SET_PAUSED' ? { paused: event.paused } : {},
    ),
    setRoute: assign(({ event }) => {
      if (event.type !== 'SET_ROUTE') return {};
      return event.tab === undefined
        ? { route: event.route }
        : { route: event.route, investigateTab: event.tab };
    }),
    setInvestigateTab: assign(({ event }) =>
      event.type === 'SET_INVESTIGATE_TAB' ? { investigateTab: event.tab } : {},
    ),
    selectArtifact: assign(({ event }) =>
      event.type === 'SELECT_ARTIFACT' ? { selectedArtifact: event.artifactId } : {},
    ),
    setTimeRange: assign(({ event }) =>
      event.type === 'SET_TIME_RANGE' ? { timeRange: event.range } : {},
    ),
    setFocus: assign(({ event }) => {
      if (event.type !== 'SET_FOCUS') return {};
      return {
        focus: event.focus,
        ...(event.route === undefined ? {} : { route: event.route }),
        ...(event.tab === undefined ? {} : { investigateTab: event.tab }),
      };
    }),
    setAgentStatus: assign(({ event }) =>
      event.type === 'SET_AGENT_STATUS' ? { agentStatus: event.status } : {},
    ),
    setOperatorName: assign(({ event }) =>
      event.type === 'SET_OPERATOR_NAME' ? { operatorName: event.name } : {},
    ),
    reset: assign(({ context }) => createInitialContext(context.operatorName)),
    markAnalyzing: assign({ assistantState: 'analyzing' as const }),
    markNeedsInput: assign({ assistantState: 'needs-input' as const }),
  },
  guards: {
    caseClosed: ({ context }) => context.caseClosed,
  },
}).createMachine({
  id: 'cycase',
  context: ({ input }) => createInitialContext(input?.operatorName),
  initial: 'boot',

  // Available in every scene: the case core must never be scene-gated, so a
  // WebMCP call cannot be blocked by where the camera happens to be.
  on: {
    COMMAND: { actions: 'runCommand' },
    TICK: { actions: 'tick' },
    // Pausing freezes the simulation clock. It deliberately does not touch
    // `stateVersion`, so an agent's in-flight call cannot be invalidated by it.
    SET_PAUSED: { actions: 'setPaused' },
    SET_AGENT_STATUS: { actions: 'setAgentStatus' },
    SET_OPERATOR_NAME: { actions: 'setOperatorName' },
    // Route intent is not scene state. A monitor in the office expresses
    // "open Investigate on Identity" while the camera is still at the desk,
    // and the redesign's §10 requires that intent to survive the office ->
    // dashboard round trip. Gating these on `dashboard` used to drop it.
    SET_ROUTE: { actions: 'setRoute' },
    SET_INVESTIGATE_TAB: { actions: 'setInvestigateTab' },
    SELECT_ARTIFACT: { actions: 'selectArtifact' },
    SET_TIME_RANGE: { actions: 'setTimeRange' },
    SET_FOCUS: { actions: 'setFocus' },
    RESTART: { target: '.boot', actions: 'reset' },
  },

  states: {
    /** Black screen. Nothing runs until the user opts in, so audio never autoplays. */
    boot: {
      on: {
        ENTER: { target: 'intro' },
        SKIP_INTRO: { target: 'office' },
      },
    },

    /** Typewriter lines and the eyelid reveal. Always skippable. */
    intro: {
      on: {
        INTRO_ADVANCE: { target: 'office' },
        SKIP_INTRO: { target: 'office' },
      },
    },

    /**
     * The office. Story delivery only — but staged, per the audit contract
     * (P0.2): the alarm must be acknowledged before anyone arrives, and only
     * then does the player choose between explanation and action.
     *
     *   alarmUnacknowledged → acknowledged → assistantReporting
     *     → (explained) → DEBUG
     *
     * There is one in-world assistant and she is a person. The beat that used
     * to introduce a second, robotic guide is gone, along with the two-second
     * timer that advanced past it — `docs/NODELESS_SOC_REDESIGN_2026-08-31.md`
     * §1 and §2.
     *
     * Only one delay survives anywhere in this region, and it is on the
     * entrance rather than on anything anyone says. Every other step out of a
     * beat is an event: an animation reporting a physical fact, or the player
     * pressing something.
     *
     * `DEBUG` stays available at the office level so the skip path can bypass
     * the choreography entirely — QA requires skip to work at every stage.
     */
    office: {
      initial: 'alarmUnacknowledged',
      on: {
        DEBUG: { target: 'transition' },
      },
      states: {
        /** Only the centre monitor pulses. Nothing else happens until the
         * player acknowledges — pointer on the screen, or keyboard on the
         * projected panel's button. */
        alarmUnacknowledged: {
          on: {
            ACKNOWLEDGE_ALARM: { target: 'acknowledged', actions: 'markAnalyzing' },
          },
        },

        /** Alarm silenced; the camera eases toward the doorway and the
         * assistant enters. Her arrival is an animation fact, so the
         * animation reports it. */
        acknowledged: {
          on: {
            COLLEAGUE_ARRIVED: { target: 'assistantReporting' },
          },
          // Safety net: if the entrance animation cannot run (context lost,
          // tab hidden), the story must not deadlock.
          after: { 4500: { target: 'assistantReporting' } },
        },

        /**
         * She catches her breath and reports one concrete problem, and the two
         * choices are live from the moment she has.
         *
         * This state used to carry a six-second `after`, and before that a
         * 3.2-second one, which walked past her report whether or not anybody
         * had read it. The redesign forbids that outright — §2 and §10 of
         * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` — so the delay is gone and
         * nothing has replaced it. The comment that used to stand here claimed
         * the scene reported delivery; nothing in the shipped scene ever sent
         * `REPORT_DELIVERED`, which is precisely why the timer was the only
         * thing moving the story and why removing it had to make this beat
         * actionable rather than merely slower.
         *
         * So `EXPLAIN` is handled here, alongside the office-level `DEBUG`, and
         * those two events are the whole exit. They are the two controls the
         * player can see: "Explain the incident" and "Open response console".
         *
         * `REPORT_DELIVERED` is kept as the beat's optional pacing signal — a
         * scene that one day wants to hold the choice back until she has
         * finished speaking has somewhere to say so, and `briefingChoice` is
         * where it lands. It cannot become an auto-advance again, because only
         * something with a real fact to report can send it.
         */
        assistantReporting: {
          entry: 'markNeedsInput',
          on: {
            EXPLAIN: { target: 'explained', actions: 'markAnalyzing' },
            REPORT_DELIVERED: { target: 'briefingChoice' },
          },
        },

        /**
         * The same two actions under the same report, entered only if some
         * surface has reported that she finished speaking. Nothing is removed
         * on the way in — the report is rendered identically in both beats, and
         * the choice is added beneath it rather than replacing it.
         */
        briefingChoice: {
          entry: 'markNeedsInput',
          on: { EXPLAIN: { target: 'explained', actions: 'markAnalyzing' } },
        },

        explained: {
          entry: 'markNeedsInput',
        },

        /** Return from the console without replaying the briefing. */
        resume: {
          entry: 'markNeedsInput',
        },
      },
    },

    /**
     * Office-to-dashboard crossfade. A real state rather than a CSS-only
     * effect, so the dashboard mounts behind the black layer and no reload or
     * context reset can happen here.
     */
    transition: {
      on: {
        TRANSITION_DONE: { target: 'dashboard' },
        SKIP_INTRO: { target: 'dashboard' },
      },
    },

    /** The real SOC dashboard. */
    dashboard: {
      on: {
        // P0.7: back to the same seated view and the same case state, without
        // re-running the wake-up or the colleague entrance.
        RETURN_TO_OFFICE: { target: '#cycase.office.resume' },
        OPEN_DEBRIEF: { target: 'debrief', guard: 'caseClosed' },
      },
      always: { target: 'debrief', guard: 'caseClosed' },
    },

    /** Scored debrief. */
    debrief: {},
  },
});

export type GameMachine = typeof gameMachine;
