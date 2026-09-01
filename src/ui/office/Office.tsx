import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';

import { useAudio } from '../../audio/audioContext';
import {
  useGame,
  useGameSelector,
  useOfficeSubScene,
  usePrefersReducedMotion,
  useRuntime,
  type OfficeSubScene,
} from '../../app/gameContext';
import type { ResponseActionId } from '../../game/types';
import { t } from '../../i18n';
import { cameraRig } from '../../three/cameraRig';
import type { ColleaguePhase } from '../../three/Colleague';
import { VoiceSettings } from '../../audio/VoiceSettings';
import { NarrationPanel, useNarration } from '../narration/NarrationPanel';
import { TransitionCover } from '../intro/TransitionCover';
import { Button } from '../primitives';
import { MonitorWall2D, type FallbackReason } from './MonitorWall2D';
import { SettingsBar, use3DEnabled } from './SettingsBar';
import { focusLookSurface } from './lookSurface';
import { Scene3DBoundary } from './Scene3DBoundary';

import '../../styles/office.css';

/**
 * three.js is loaded only when the room is actually going to be drawn. The
 * dashboard — where the case is played and where an agent spends its whole
 * time — never pays for it, and neither does the 2D fallback.
 */
const Office3D = lazy(() =>
  import('./Office3D').then((module) => ({ default: module.Office3D })),
);

/**
 * The office scene, staged per the audit contract (P0.2):
 *
 *   alarmUnacknowledged → acknowledged → assistantReporting
 *     → (explained) → DEBUG
 *
 * Nothing arrives before the player acknowledges the alarm. The assistant
 * reports one concrete problem that matches the dashboard's incident data, and
 * her report stays on screen, with the two choices beneath it, until the player
 * takes one of them. No timer anywhere in this file moves that beat along.
 *
 * The scene runs identically over the WebGL room or the 2D monitor wall, and
 * the case itself is never gated on any of it — QA requires skip to work at
 * every stage, and the chrome's skip goes straight to the dashboard.
 */

/** Below this width the 3D office is replaced by the monitor wall. */
const MIN_3D_WIDTH = 1024;

/** The scripted glance toward the doorway after acknowledging. */
const DOOR_YAW = -(38 * Math.PI) / 180;

/**
 * The containment actions. Any one of them means the player has stopped
 * standing still, which is what lets the colleague stop being urgent.
 *
 * `close_case` is deliberately absent — closing the case is covered by
 * `caseClosed` below, and treating the *act* of closing as containment would
 * let a player relieve her by closing an incident they never touched.
 */
const CONTAINING_ACTIONS: readonly ResponseActionId[] = [
  'revoke_sessions',
  'reset_credentials',
  'isolate_endpoint',
  'block_indicator',
];


/** Alarm ping cadence while unacknowledged. */
const ALARM_PING_MS = 2400;

/**
 * Longest the dashboard return will hold its cover waiting for the room.
 *
 * The audit measured the remount at "the full room within about 2.5 seconds",
 * so this is that with roughly 60% of headroom. It is a cap, not a delay: the
 * cover lifts the moment `OfficeScene` reports a drawn frame, and in every run
 * where the room draws at all that is what ends it. The cap exists so a lost
 * context or a canvas that never gets a frame degrades to exactly the old
 * behaviour — a room revealed before it is ready — instead of a locked screen.
 */
const RETURN_MAX_HOLD_MS = 4000;

/** Focus lands here when the return cover lifts; the button that was clicked is gone. */
const RESUME_CTA_ID = 'office-resume-cta';

function useViewportAllows3D(): boolean {
  const [allows, setAllows] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= MIN_3D_WIDTH,
  );

  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${MIN_3D_WIDTH}px)`);
    const update = () => setAllows(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return allows;
}

function useWebglSupported(): boolean {
  const [supported] = useState(() => {
    try {
      const canvas = document.createElement('canvas');
      return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
      return false;
    }
  });
  return supported;
}

function colleaguePhaseFor(sub: OfficeSubScene | null): ColleaguePhase {
  switch (sub) {
    case 'acknowledged':
      return 'entering';
    case 'assistantReporting':
    case 'briefingChoice':
    case 'explained':
    case 'resume':
      return 'settled';
    default:
      return 'hidden';
  }
}


export function Office() {
  const ctx = useGame();
  const runtime = useRuntime();
  const sub = useOfficeSubScene();
  const audio = useAudio();
  const reducedMotion = usePrefersReducedMotion();

  const [enabled3D, setEnabled3D] = use3DEnabled();
  const viewportAllows = useViewportAllows3D();
  const webglSupported = useWebglSupported();

  /*
   * A runtime failure of the 3D path, which is a different thing from a
   * preference or a capability. `retryKey` re-arms the error boundary and
   * remounts the lazy chunk, so "try again" is a real retry rather than a
   * relabelled reload.
   */
  const [runtimeFailure, setRuntimeFailure] = useState<'load_failed' | 'context_lost' | null>(
    null,
  );
  const [retryKey, setRetryKey] = useState(0);

  const show3D = enabled3D && viewportAllows && webglSupported && runtimeFailure === null;

  const fallbackReason: FallbackReason | null = show3D
    ? null
    : (runtimeFailure ??
      (!webglSupported ? 'webgl' : !viewportAllows ? 'viewport' : 'preference'));

  const retry3D = useCallback(() => {
    setRuntimeFailure(null);
    setRetryKey((key) => key + 1);
  }, []);

  /*
   * A failure is per-attempt, not per-session. Turning 3D off and on again, or
   * widening the window back past the threshold, is the player asking for the
   * room again — so the recorded failure is cleared when the thing that could
   * have caused it changes.
   */
  useEffect(() => {
    setRuntimeFailure(null);
  }, [enabled3D, viewportAllows]);

  /**
   * Has the player actually dealt with this incident?
   *
   * The colleague's urgent/relieved axis reads this instead of a wall clock.
   * `useGameSelector` rather than `useGame` because the case context is
   * republished every second by the incident clock, and this value changes a
   * handful of times in a whole run.
   */
  const caseResolved = useGameSelector(
    (context) =>
      context.caseClosed ||
      context.performedActions.some((action) => CONTAINING_ACTIONS.includes(action.actionId)),
  );

  const unacknowledged = sub === 'alarmUnacknowledged';
  const colleaguePhase = colleaguePhaseFor(sub);

  /*
   * The dashboard return (audit P2), detected from the one fact only a return
   * can produce: this `Office` instance mounted *straight into* the resume
   * beat. Every other way into the office starts at `alarmUnacknowledged`, and
   * a player already sitting in `resume` is not remounting anything.
   *
   * Deriving it here rather than adding a machine state is deliberate.
   * `RETURN_TO_OFFICE` keeps targeting `office.resume` verbatim, so `sub` is
   * `resume` on the very first render — which means the colleague is `settled`
   * and the room's final light count is in frame one — `Lighting` hangs her key
   * and rim on `colleagueLit`. An intermediate state would have mounted the room
   * without her and then added those two lights at the moment of the reveal, and
   * `OfficeScene`'s own note is
   * explicit that changing the light count "recompiles every PBR program in the
   * room, so it must never happen at a moment the player is watching for
   * responsiveness". It also leaves `SceneId`, the WebMCP surface and
   * `runtime.test.ts` untouched.
   *
   * Only the WebGL path can show an undrawn room. The 2D monitor wall is
   * synchronous DOM, so the 3D-off and narrow-viewport paths get no cover at
   * all rather than a new black flash they never needed.
   */
  const [returning, setReturning] = useState(() => sub === 'resume' && show3D);
  const [roomDrawn, setRoomDrawn] = useState(false);
  const markRoomDrawn = useCallback(() => setRoomDrawn(true), []);

  const uncover = useCallback(() => {
    setReturning(false);

    /*
     * Take focus only if nobody else has.
     *
     * The button that started this — the dashboard's "Return to office" — was
     * unmounted with the dashboard, so focus is normally back on `body` and
     * moving it to the resume CTA is the courteous thing to do. But the cover
     * is `pointer-events: none` precisely so the room stays usable while it
     * fades, which means a player can click Recenter, or tab somewhere, during
     * the up-to-400 ms before this runs. Focusing unconditionally would then
     * yank the caret out from under them.
     */
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.getElementById(RESUME_CTA_ID)?.focus();
  }, []);

  useEffect(() => {
    cameraRig.setInstant(reducedMotion);
  }, [reducedMotion]);

  /*
   * Her arrival, when no animation can report it.
   *
   * The colleague's entrance is an animation fact — `Colleague` fires `onArrive`
   * when the walk lands — and reduced motion may not run that walk at all, so
   * the arrival is announced directly instead. It is choreography, not
   * dialogue: the machine's own 4500 ms net covers the same gap for the same
   * reason.
   *
   * There used to be a second branch here that sent `REPORT_DELIVERED` as soon
   * as she started speaking, and a 2600 ms timer below that did the same on the
   * 2D path. Both were essential-dialogue auto-advance in everything but name,
   * which §2 forbids, and neither is needed now: the two choices are live from
   * the moment `assistantReporting` is entered, so the beat already ends on
   * something the player did.
   */
  useEffect(() => {
    if (!reducedMotion) return;
    if (sub === 'acknowledged') runtime.send({ type: 'COLLEAGUE_ARRIVED' });
  }, [reducedMotion, sub, runtime]);

  // The flat wall has no entrance animation to fire `onArrive`, so the same
  // arrival is announced on a short timer. Same rule as above: this moves a
  // walk, never a line of dialogue.
  useEffect(() => {
    if (show3D || reducedMotion) return;
    if (sub !== 'acknowledged') return;
    const id = window.setTimeout(() => runtime.send({ type: 'COLLEAGUE_ARRIVED' }), 1800);
    return () => window.clearTimeout(id);
  }, [show3D, reducedMotion, sub, runtime]);

  // The alarm is the only sound while unacknowledged: a restrained two-tone
  // ping on a slow cadence, silenced by the acknowledge action.
  useEffect(() => {
    if (!unacknowledged) return;
    audio.play('alert');
    const id = window.setInterval(() => audio.play('alert'), ALARM_PING_MS);
    return () => window.clearInterval(id);
  }, [unacknowledged, audio]);

  /*
   * The glance to the doorway, and back to centre for the report.
   *
   * `assistantReporting` used to hold `DOOR_YAW * 0.45` — a 17.1° turn toward
   * the door — for the whole of her report, and the colleague was staged
   * against that turned framing. Two things were wrong with it. The player who
   * pressed Home, or came back from the dashboard, saw the centred frame
   * instead, and in the centred frame she was entirely off the right-hand edge.
   * And the framing was a number two files had to agree on by hand:
   * `characters.spec.ts` hard-coded the same 17.1° in order to know where to
   * look for her.
   *
   * The report is now framed at yaw 0 and she is staged there — see the settle
   * point in `layout.ts`. There is one report framing, it is the same one a
   * recentred player is in, and the test reads the live `data-yaw` rather than
   * assuming it.
   *
   * `explained` is in this list because the auto-advance is gone: it is now
   * reachable straight out of `assistantReporting`, where the camera would
   * otherwise still be angled at the doorway.
   */
  useEffect(() => {
    if (sub === 'acknowledged') cameraRig.lookAt(DOOR_YAW, 0);
    else if (
      sub === 'assistantReporting' ||
      sub === 'briefingChoice' ||
      sub === 'explained' ||
      sub === 'resume'
    ) {
      cameraRig.recenter();
    }
  }, [sub]);

  useEffect(() => () => cameraRig.reset(), []);

  const acknowledge = useMemo(
    () => () => {
      audio.play('confirm');
      runtime.send({ type: 'ACKNOWLEDGE_ALARM' });
    },
    [audio, runtime],
  );

  return (
    <>
      <main className="office" id="main">
        <div className="office__chrome">
          <h1 className="office__title">{t('app.title')}</h1>
          <span className="muted text-sm">
            {t('app.subtitle')}
          </span>
          <SettingsBar
            enabled3D={enabled3D}
            onToggle3D={setEnabled3D}
            can3D={viewportAllows && webglSupported}
          />
          {/* Narration voice, beside the room's own mute and volume. */}
          <VoiceSettings />
          {show3D ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                cameraRig.recenter();
                /*
                 * Hand the keyboard back to the room.
                 *
                 * Camera keys are ignored while a button has focus — otherwise
                 * ArrowLeft on the volume slider would turn the head — so
                 * without this, clicking Recenter left focus on Recenter and
                 * silently killed arrow and WASD look until the player clicked
                 * the room again. That was the reported bug.
                 */
                focusLookSurface();
              }}
            >
              {t('office.recenter')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => runtime.send({ type: 'DEBUG' })}>
            {t('app.skip_intro')}
          </Button>
        </div>

        {show3D ? (
          /*
           * Boundary outside, Suspense inside.
           *
           * `useLoader` throws a rejected fetch *through* Suspense, so a missing
           * GLB is an error the Suspense boundary cannot catch — it needs this.
           * Both land on the same 2D wall, and both keep the case: nothing about
           * the incident has ever lived in the canvas.
           */
          <Scene3DBoundary
            resetKey={retryKey}
            onError={() => setRuntimeFailure('load_failed')}
            fallback={
              <MonitorWall2D
                unacknowledged={unacknowledged}
                onAcknowledge={acknowledge}
                reason="load_failed"
                onRetry3D={retry3D}
              />
            }
          >
            <Suspense
              fallback={
                <MonitorWall2D unacknowledged={unacknowledged} onAcknowledge={acknowledge} />
              }
            >
              <Office3D
                key={retryKey}
                colleaguePhase={colleaguePhase}
                onColleagueArrive={() => runtime.send({ type: 'COLLEAGUE_ARRIVED' })}
                alert={unacknowledged}
                reducedMotion={reducedMotion}
                onAcknowledgeAlarm={unacknowledged ? acknowledge : undefined}
                onReady={returning ? markRoomDrawn : undefined}
                caseResolved={caseResolved}
                onContextLost={() => setRuntimeFailure('context_lost')}
              />
            </Suspense>
          </Scene3DBoundary>
        ) : (
          <MonitorWall2D
            unacknowledged={unacknowledged}
            onAcknowledge={acknowledge}
            reason={fallbackReason}
            onRetry3D={
              /*
               * Only offered where retrying could work. A narrow window or a
               * browser with no WebGL will fail again identically, and a button
               * that cannot succeed is worse than no button.
               */
              runtimeFailure && viewportAllows && webglSupported ? retry3D : undefined
            }
          />
        )}

        <Dialogue sub={sub} operatorName={ctx.operatorName} onAcknowledge={acknowledge} />
      </main>

      {/*
        * The reverse cover. Opaque in the first painted frame of the returning
        * office and held there until the room reports a drawn frame, so the
        * un-drawn room is never on screen rather than on screen for 2.5 s.
        *
        * It is a sibling of `<main>`, which puts it in the same containing
        * block as the forward cover App renders — `.stage` is `display:
        * contents` in every steady scene.
        */}
      {returning ? (
        <TransitionCover
          variant="return"
          reducedMotion={reducedMotion}
          ready={roomDrawn}
          maxHoldMs={RETURN_MAX_HOLD_MS}
          onEnd={uncover}
        />
      ) : null}
    </>
  );
}

/** The staged dialogue panel under the scene. */
function Dialogue({
  sub,
  operatorName,
  onAcknowledge,
}: {
  sub: OfficeSubScene | null;
  operatorName: string;
  onAcknowledge: () => void;
}) {
  const runtime = useRuntime();
  const audio = useAudio();
  const alarmSilent = audio.alarm.status.phase === 'degraded';
  // The fixed copy is the fallback, not a second voice: when the agent has
  // written a line for the state the player is in, that line is the dialogue
  // and this one stands down. The channel retires stale entries, so `active`
  // can only ever be a line about the beat on screen.
  const narrated = useNarration().active !== null;

  let speaker: string;
  let line: string;
  let hint: string | null = null;

  switch (sub) {
    case 'alarmUnacknowledged':
      speaker = t('office.system_speaker');
      line = t('office.alarm_line');
      /*
       * Say it plainly when the alarm has no sound. The degraded path used to
       * play a synthesised stand-in; silence is the honest behaviour, and
       * silence with no explanation reads as a bug rather than a missing asset.
       */
      hint = alarmSilent ? t('office.alarm_silent') : t('office.alarm_hint');
      break;
    case 'acknowledged':
      speaker = t('office.system_speaker');
      line = t('office.colleague_entering');
      break;
    /*
     * Her report is written once and shown in both beats, and both beats carry
     * the same two controls beneath it. The redesign is explicit that no
     * essential dialogue may disappear before the player has acted on it, and
     * this is where that used to happen — a six-second machine timer and a
     * 2600 ms component timer, either of which could fire while the player was
     * still reading.
     */
    case 'assistantReporting':
    case 'briefingChoice':
      speaker = t('intro.colleague.name');
      line = t('intro.colleague.line', { name: operatorName });
      break;
    /*
     * The teaching beat, and the one place the speaker is deliberately not her.
     *
     * "Explain the incident" is the branch the redesign routes to Codex; this
     * body is the deterministic stand-in that keeps the case playable with no
     * agent connected. Either way it is guidance, not an operational report, so
     * putting VERA's name on it would credit a person for the explanation the
     * product is careful never to attribute to her. It is not labelled
     * "Generated guidance" either — nothing generated it.
     */
    case 'explained':
      speaker = t('guidance.channel');
      line = t('intro.explain.body');
      break;
    case 'resume':
      speaker = t('intro.colleague.name');
      line = t('office.resume_line');
      break;
    default:
      speaker = t('intro.colleague.name');
      line = t('intro.colleague.line', { name: operatorName });
      break;
  }

  return (
    <section className="dialogue" aria-label={t('office.dialogue')}>
      <div className="dialogue__inner">
        {/*
         * A generated line takes the channel when there is one; the fixed copy
         * below is the deterministic fallback for the current beat, which is
         * what keeps the case fully playable with no agent connected.
         */}
        <NarrationPanel />
        {narrated ? null : (
          /*
           * Speaker and line announced together, for the same reason the
           * generated caption is.
           *
           * `aria-live` used to sit on the paragraph alone, so a screen reader
           * heard "that is the shape of a stolen session" with nothing saying
           * where it came from — and that beat is `Case guidance`, not VERA.
           * The live region is on the wrapper now, `aria-atomic` pulls the
           * speaker in with the sentence, and the wrapper holds nothing else,
           * so the announcement is still one attributed sentence rather than a
           * recital of the panel.
           *
           * The icon is gone too. The `agent` glyph used to sit on
           * `briefingChoice`, `explained` and `resume` — two of which are VERA
           * speaking — while the generated caption above carried the same
           * glyph, so one mark on both channels distinguished nothing. Among
           * the surfaces that name a speaker it now marks the generated caption
           * alone.
           */
          <div className="dialogue__caption" aria-live="polite" aria-atomic="true">
            <span className="dialogue__speaker">{speaker}</span>
            <p className="dialogue__text">{line}</p>
          </div>
        )}
        {/*
         * The hint and the buttons are not dialogue — they are how the case is
         * played, so they stay put whoever is speaking.
         */}
        {hint ? (
          <p className="muted text-sm">
            {hint}
          </p>
        ) : null}

        <div className="dialogue__actions">
          {sub === 'alarmUnacknowledged' ? (
            <Button variant="danger" onClick={onAcknowledge}>
              {t('office.acknowledge')}
            </Button>
          ) : null}

          {/*
           * The two controls that end the report beat.
           *
           * They are rendered from `assistantReporting` onward rather than from
           * `briefingChoice`, because with the auto-advance removed nothing
           * reaches `briefingChoice` on its own any more — and a report with no
           * way out of it is a worse defect than the timer that was removed.
           * Both events are accepted in both beats, so this is one set of
           * controls that happens to span two states rather than two sets.
           */}
          {sub === 'assistantReporting' || sub === 'briefingChoice' ? (
            <>
              <Button
                variant="primary"
                onClick={() => {
                  audio.play('confirm');
                  runtime.send({ type: 'DEBUG' });
                }}
              >
                {t('intro.action.solve')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  audio.play('reveal');
                  runtime.send({ type: 'EXPLAIN' });
                }}
              >
                {t('intro.action.explain_first')}
              </Button>
            </>
          ) : null}

          {sub === 'explained' ? (
            <Button
              variant="primary"
              onClick={() => {
                audio.play('confirm');
                runtime.send({ type: 'DEBUG' });
              }}
            >
              {t('intro.action.solve')}
            </Button>
          ) : null}

          {sub === 'resume' ? (
            <Button
              id={RESUME_CTA_ID}
              variant="primary"
              onClick={() => {
                audio.play('confirm');
                runtime.send({ type: 'DEBUG' });
              }}
            >
              {t('office.return_dashboard')}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
