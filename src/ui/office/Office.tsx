import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';

import { useAudio } from '../../audio/audioContext';
import {
  useGame,
  useOfficeSubScene,
  usePrefersReducedMotion,
  useRuntime,
  type OfficeSubScene,
} from '../../app/gameContext';
import { t } from '../../i18n';
import { cameraRig } from '../../three/cameraRig';
import type { ColleaguePhase } from '../../three/Colleague';
import { VoiceSettings } from '../../audio/VoiceSettings';
import { NarrationPanel, useNarration } from '../narration/NarrationPanel';
import { TransitionCover } from '../intro/TransitionCover';
import { Button } from '../primitives';
import { MonitorWall2D } from './MonitorWall2D';
import { SettingsBar, use3DEnabled } from './SettingsBar';

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
  const show3D = enabled3D && viewportAllows && webglSupported;

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
   * Scripted glances: toward the doorway while she enters, back to centre as
   * she reports. Head-look input (P0.1) rides the same rig.
   *
   * `assistantReporting` used to hold the camera at 45% of the door yaw, which
   * was right while it was a six-second transient the timer moved you out of.
   * It is now where the player sits until they choose, so a held 17-degree
   * offset would mean reading the monitors and pressing a control from a room
   * turned away from both. She is already `settled` by this beat, so this is
   * the moment the comment above always described as "back to centre".
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
            <Button size="sm" variant="ghost" onClick={() => cameraRig.recenter()}>
              {t('office.recenter')}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => runtime.send({ type: 'DEBUG' })}>
            {t('app.skip_intro')}
          </Button>
        </div>

        {show3D ? (
          <Suspense fallback={<MonitorWall2D unacknowledged={unacknowledged} onAcknowledge={acknowledge} />}>
            <Office3D
              colleaguePhase={colleaguePhase}
              onColleagueArrive={() => runtime.send({ type: 'COLLEAGUE_ARRIVED' })}
              alert={unacknowledged}
              reducedMotion={reducedMotion}
              onAcknowledgeAlarm={unacknowledged ? acknowledge : undefined}
              onReady={returning ? markRoomDrawn : undefined}
            />
          </Suspense>
        ) : (
          <MonitorWall2D unacknowledged={unacknowledged} onAcknowledge={acknowledge} />
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
