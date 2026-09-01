import { useCallback, useEffect, useRef, useState } from 'react';

import { usePrefersReducedMotion, useRuntime, useScene } from './app/gameContext';
import { useAudio } from './audio/audioContext';
import type { SceneId } from './game/types';
import { t } from './i18n';
import { Dashboard } from './ui/dashboard/Dashboard';
import { Debrief } from './ui/dashboard/Debrief';
import { BootScene } from './ui/intro/BootScene';
import { IntroScene } from './ui/intro/IntroScene';
import { TransitionCover } from './ui/intro/TransitionCover';
import { WakeFade, WakeReveal } from './ui/intro/WakeReveal';
import { Office } from './ui/office/Office';
import { WebMcpBadge, WebMcpProvider } from './webmcp/WebMcpPanel';
import { useWebMcpTools } from './webmcp/useWebMcpTools';
import { NarrationDriver } from './ui/narration/NarrationDriver';

/**
 * Scene composition.
 *
 * Two things here are load-bearing and were previously only claimed in a
 * comment (audit contract P0.5):
 *
 *  - during `transition` the office and the dashboard are both mounted. Not
 *    "conceptually", not "the state exists": two live subtrees, at the same
 *    time, in the same document. The office keeps the React instance it had in
 *    the `office` scene, because the stage wrappers hold stable slots — moving
 *    a subtree between slots would tear down the WebGL context, which is the
 *    exact reload the contract forbids.
 *  - the reveal happens under the cover: the machine advances and focus moves
 *    while the screen is at full black, and there is no status text anywhere.
 *
 * The stage wrappers are `display: contents` in every steady scene, so in
 * `office` and `dashboard` the DOM the rest of the app sees is byte-for-byte
 * what it was before. Only during the crossfade do they become stacked layers.
 */
export function App() {
  const scene = useScene();
  const runtime = useRuntime();
  const reducedMotion = usePrefersReducedMotion();

  // Tools are registered once for the lifetime of the page, on the top-level
  // document, and gate themselves by state. See docs/WEBMCP_CONTRACT.md.
  const mcp = useWebMcpTools();

  /**
   * The crossfade, counted rather than flagged.
   *
   * This was a boolean, and a boolean cannot express "start a second crossfade
   * while the first one is still on screen". Entering `transition` again set an
   * already-true flag, which is a no-op, so the cover that was still mounted
   * from the previous crossfade stayed mounted — and that instance has already
   * swapped, so it never calls `onSwap` again. `TRANSITION_DONE` was therefore
   * never sent, the machine sat in `transition` forever, and `transition` gives
   * both stages `inert` and the dashboard `stage--muted`. The result was a black,
   * inert, unrecoverable screen; only a reload got out of it.
   *
   * It is reachable by a player, not just by a test: the forward cover runs
   * 380 ms in, 90 hold, 400 out, and the dashboard goes live and interactive at
   * 380 ms — so pressing "Return to office" and then "Open response console"
   * inside the following ~490 ms locks the console. Under reduced motion the
   * window is 80 ms, narrower and still reachable.
   *
   * Counting gives every crossfade its own cover. The key change unmounts the
   * old instance, whose `cancelAnimationFrame` cleanup runs, so its stale
   * `onEnd` cannot land on the new one.
   */
  const [crossfade, setCrossfade] = useState(0);
  const crossfading = crossfade > 0;

  /**
   * The wake reveal is a first-arrival event, not a scene event. P0.7 requires
   * `Return to office` to land back in the chair without replaying it, so the
   * flag is set on the way *out* of the office as well as on completion — a
   * player who skips at 0.4 s must not be woken up a second time.
   */
  const [wakeSeen, setWakeSeen] = useState(false);

  useEffect(() => {
    if (scene === 'boot') setWakeSeen(false);
    else if (scene !== 'office' && scene !== 'intro') setWakeSeen(true);
  }, [scene]);

  useEffect(() => {
    // A new token on every entry, so a crossfade that begins while the previous
    // cover is still fading out gets its own cover rather than inheriting one
    // that has already done its swap.
    if (scene === 'transition') setCrossfade((token) => token + 1);
  }, [scene]);

  const onSwap = useCallback(() => {
    runtime.send({ type: 'TRANSITION_DONE' });
    // The dashboard subtree is already in the document; it was inert while the
    // office was still visible. One frame after the machine advances it is
    // live, and acceptance criterion 4 says focus belongs on the incident.
    requestAnimationFrame(() => {
      document.getElementById('incident-title')?.focus();
    });
  }, [runtime]);

  const onCoverEnd = useCallback(() => setCrossfade(0), []);

  const inTransition = scene === 'transition';
  const officeMounted = scene === 'office' || inTransition;
  const dashboardMounted = inTransition || scene === 'dashboard';
  /*
   * The first-person wake, once per session, on entering the office.
   *
   * Reduced motion takes the second branch rather than none at all:
   * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §2 allows "one short fade" in
   * place of the lid reveal, and a cut straight from the opening copy to a lit
   * room is harsher than the fade it replaces.
   */
  const wakePending = scene === 'office' && !wakeSeen;
  const showWake = wakePending && !reducedMotion;
  const showWakeFade = wakePending && reducedMotion;

  return (
    <WebMcpProvider status={mcp}>
      {/*
       * One driver above every surface. The office dialogue panel and the
       * dashboard rail both render the narration channel, and a generated line
       * must be spoken once regardless of how many of them are mounted — which
       * they both are during the crossfade.
       */}
      <NarrationDriver />
      <div className="shell">
        <a className="skip-link" href="#main">
          {t('app.skip_to_main')}
        </a>

        {scene === 'boot' ? <BootScene /> : null}
        {scene === 'intro' ? <IntroScene /> : null}

        {officeMounted ? (
          <div
            className={inTransition ? 'stage stage--layer' : 'stage'}
            data-stage="office"
            aria-hidden={inTransition || undefined}
            inert={inTransition}
          >
            <Office />
            {showWake ? <WakeReveal onDone={() => setWakeSeen(true)} /> : null}
            {showWakeFade ? <WakeFade onDone={() => setWakeSeen(true)} /> : null}
          </div>
        ) : null}

        {dashboardMounted ? (
          <div
            className={inTransition ? 'stage stage--layer stage--muted' : 'stage'}
            data-stage="dashboard"
            aria-hidden={inTransition || undefined}
            inert={inTransition}
          >
            {/*
             * The WebMCP registration status is an incident-status fact, not a
             * global action, so it rides with the other eight in the sidebar.
             */}
            <Dashboard statusExtras={<WebMcpBadge />} />
          </div>
        ) : null}

        {crossfading ? (
          <TransitionCover
            key={crossfade}
            reducedMotion={reducedMotion}
            onSwap={onSwap}
            onEnd={onCoverEnd}
          />
        ) : null}

        {scene === 'debrief' ? <Debrief /> : null}
      </div>
      <TransitionAudio scene={scene} reducedMotion={reducedMotion} />
    </WebMcpProvider>
  );
}

/**
 * The crossfade sweep.
 *
 * A leaf, deliberately: `useAudio()` re-renders its consumer whenever the
 * volume or mute state changes, and that must not be the whole scene tree.
 */
function TransitionAudio({ scene, reducedMotion }: { scene: SceneId; reducedMotion: boolean }) {
  const audio = useAudio();
  const audioRef = useRef(audio);

  useEffect(() => {
    audioRef.current = audio;
  }, [audio]);

  useEffect(() => {
    if (scene === 'transition' && !reducedMotion) audioRef.current.play('transition');
  }, [scene, reducedMotion]);

  return null;
}
