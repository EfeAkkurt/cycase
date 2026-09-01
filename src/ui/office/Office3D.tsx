import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useAudio } from '../../audio/audioContext';
import { t } from '../../i18n';
import { cameraRig } from '../../three/cameraRig';
import { useHeadLook } from '../../three/HeadLookControls';
import type { ColleaguePhase } from '../../three/Colleague';
import { computeMonitorPlacements, type MonitorPlacement } from '../../three/projection';
import { ResizeObserverShim } from '../../three/ResizeObserverShim';
import { OfficeScene } from '../../three/OfficeScene';
import { Button } from '../primitives';
import { HeadLookHelp } from './HeadLookHelp';
import { LOOK_SURFACE_ID } from './lookSurface';
import { MonitorSurface3D } from './MonitorWall2D';

/**
 * The 3D office with real DOM monitor surfaces on top of it.
 *
 * The WebGL canvas draws the room, the desk, the bezels and the light; it never
 * draws interface text. Each monitor's screen quad is projected with the scene
 * camera and a normal React panel is laid onto it with a CSS `matrix3d`.
 *
 * With head-look (audit P0.1) the camera is no longer fixed, so the projection
 * follows the rig: while the head moves the placements recompute on every rig
 * update, and one final pass runs after it settles. The homography and the
 * WebGL camera read the *same* `cameraRig.state` sample, taken inside the same
 * `update()` call, which is what keeps interface and bezel inside the
 * contract's 2 px rather than a frame apart.
 *
 * Those per-frame transforms are written straight to the DOM rather than
 * through React state. Re-rendering three live panels sixty times a second
 * during a glance is both a frame-budget problem and a source of one-frame lag
 * between the canvas and the overlay; React is only asked to re-render when the
 * *set* of visible monitors changes.
 *
 * ## Two elements, two jobs
 *
 * `.office3d` is the **interaction region**: it is what a drag is bound to, and
 * it sits above the projected panels so that grabbing a monitor's blank surface
 * turns the room like grabbing anything else does. `.office3d__canvas` is the
 * **focus target**: it carries `role="application"`, the ARIA description and
 * the keyboard shortcuts, and it is what Pointer Lock is requested on.
 *
 * They used to be the same element, and being the same element is what made the
 * drag unreliable — the listener sat *below* an overlay that covers most of the
 * picture, so whether a drag worked depended on where in the frame it started.
 */

const HELP_ID = 'office-headlook-help';

export function Office3D({
  colleaguePhase,
  onColleagueArrive,
  alert,
  reducedMotion,
  onAcknowledgeAlarm,
  onReady,
  caseResolved,
  onContextLost,
}: {
  colleaguePhase: ColleaguePhase;
  onColleagueArrive?: () => void;
  alert: boolean;
  reducedMotion: boolean;
  onAcknowledgeAlarm?: () => void;
  /** Fired once the WebGL room has drawn. Only the dashboard return uses it. */
  onReady?: () => void;
  /** Drives the colleague's urgent/relieved axis from the case, not a clock. */
  caseResolved?: boolean;
  /** The WebGL context went away; the office falls back to the 2D wall. */
  onContextLost?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Bumped when React hands us a different container node — see `attachContainer`. */
  const [containerGeneration, setContainerGeneration] = useState(0);
  /*
   * Same reason as `attachContainer`: React replaces these nodes on remount, and
   * the head-look listeners must follow them rather than stay on the dead ones.
   * `regionNode` is what a drag is bound to; `canvasNode` is what takes focus.
   */
  const [regionNode, setRegionNode] = useState<HTMLDivElement | null>(null);
  const [canvasNode, setCanvasNode] = useState<HTMLDivElement | null>(null);
  const surfaceRefs = useRef(new Map<MonitorPlacement['id'], HTMLDivElement>());
  const latestRef = useRef<MonitorPlacement[]>([]);
  const [visible, setVisible] = useState<MonitorPlacement[]>([]);
  const audio = useAudio();

  const {
    pointerLocked,
    togglePointerLook,
    pointerLockSupported,
    pointerLockFailure,
    dragging,
    hasLooked,
  } = useHeadLook(regionNode, canvasNode);

  /*
   * The room opens facing the monitors, every time it opens.
   *
   * `cameraRig` is a module singleton, so it outlives this component: turning
   * 3D off and on again, or dragging the window narrow enough to cross the 3D
   * threshold and back, unmounts and remounts *this* while the rig keeps
   * whatever pose it was left in. Before this, the office came back facing a
   * side wall and the player had to find Recenter to get their monitors back.
   *
   * `clampToLimits` runs first for the case where the cone itself has changed
   * between builds, and `reset` is used rather than `recenter` because there is
   * no frame to ease from — the room is being mounted, not turned.
   */
  useLayoutEffect(() => {
    cameraRig.clampToLimits();
    if (!cameraRig.centred) cameraRig.reset();
    return () => cameraRig.reset();
  }, []);

  /*
   * A callback ref, not a plain object ref with an empty-dependency effect.
   *
   * The office remounts — Suspense resolving, the scene toggling — and React
   * replaces this node when it does. With `useLayoutEffect(..., [])` the effect
   * captured the FIRST node forever: the ResizeObserver and the head-look
   * subscription stayed bound to a node no longer in the document, and
   * `getBoundingClientRect()` on a detached node returns zeros. The monitor
   * transforms kept working, because those write through per-surface refs, so
   * the failure was invisible until a test read `data-yaw` off the live node and
   * found no attributes at all.
   */
  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    if (containerRef.current === node) return;
    containerRef.current = node;
    setRegionNode(node);
    setContainerGeneration((generation) => generation + 1);
  }, []);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const size = { width: 0, height: 0 };
    let signature = '';

    const project = () => {
      const rig = cameraRig.state;
      const placements = computeMonitorPlacements(
        size.width,
        size.height,
        rig.yaw,
        rig.pitch,
      );
      latestRef.current = placements;

      // Where the head is pointing, in degrees, for QA and for the contract's
      // clamp evidence. Nothing in the app reads these back.
      element.dataset.yaw = toDegrees(rig.yaw);
      element.dataset.pitch = toDegrees(rig.pitch);
      element.dataset.settled = rig.moving ? 'false' : 'true';

      for (const placement of placements) {
        const surface = surfaceRefs.current.get(placement.id);
        if (surface) surface.style.transform = placement.transform;
      }

      // React only hears about it when a monitor enters or leaves the frame.
      const next = placements.map((placement) => placement.id).join('|');
      if (next !== signature) {
        signature = next;
        setVisible(placements);
      }
    };

    const measure = () => {
      const rect = element.getBoundingClientRect();
      size.width = rect.width;
      size.height = rect.height;
      project();
    };

    measure();

    /*
     * A `resize` listener that measures synchronously can read the *pre-reflow*
     * rectangle: the event fires before the new layout is necessarily
     * committed. Two frames is the cheap, reliable fix — the first lands after
     * style and layout, the second after the compositor has settled.
     */
    let pending = 0;
    const remeasure = () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => {
        pending = requestAnimationFrame(measure);
      });
    };

    const observer = new ResizeObserverShim(remeasure);
    observer.observe(element);
    window.addEventListener('resize', remeasure);

    // Follow the head. The rig emits on every eased step, so the DOM surfaces
    // track the glass through the whole motion, not just at the ends.
    const unsubscribe = cameraRig.subscribe(() => project());

    return () => {
      cancelAnimationFrame(pending);
      observer.disconnect();
      window.removeEventListener('resize', remeasure);
      unsubscribe();
    };
    // Re-binds whenever React gives us a new container node.
  }, [containerGeneration]);

  useEffect(() => {
    audio.startAmbient();
    return () => audio.stopAmbient();
  }, [audio]);

  return (
    <div
      className="office3d"
      ref={attachContainer}
      /*
       * The assistant's choreography phase, published for QA alongside the
       * head-look pose.
       *
       * A state fact rather than a pixel diff. The rule this exists for — that
       * nobody arrives before the alarm is acknowledged — was once inferred by
       * differencing a corner of the frame, which measured the alarm light
       * going out, then the live charts redrawing, then her walking past.
       */
      data-colleague-phase={colleaguePhase}
      /*
       * Read by CSS, not by script: it swaps the cursor to `grabbing` and locks
       * text selection while a drag is running. Selection matters now that the
       * drag surface covers the monitor panels — without it, pulling the room
       * sideways highlighted every line of the incident brief on the way past.
       */
      data-dragging={dragging ? 'true' : 'false'}
    >
      {/*
        * The canvas host. Focusable and labelled because head-look has to be
        * discoverable and operable with no mouse at all, and it is what Pointer
        * Lock is requested on — but it is *not* what the drag listens to. The
        * region above owns that, so a drag works over the projected panels too.
        */}
      <div
        className="office3d__canvas"
        id={LOOK_SURFACE_ID}
        ref={setCanvasNode}
        tabIndex={0}
        role="application"
        aria-label={t('office.headlook.label')}
        aria-describedby={HELP_ID}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown A D W S Home Escape"
      >
        <OfficeScene
          colleaguePhase={colleaguePhase}
          onColleagueArrive={onColleagueArrive}
          alert={alert}
          reducedMotion={reducedMotion}
          onFootstep={() => audio.play('footstep')}
          onAcknowledgeAlarm={onAcknowledgeAlarm}
          onReady={onReady}
          caseResolved={caseResolved}
          onContextLost={onContextLost}
        />
      </div>

      <p className="sr-only" id={HELP_ID}>
        {t('office.headlook.help')}
      </p>

      <HeadLookHelp hasLooked={hasLooked} pointerLocked={pointerLocked} />

      <div className="office3d__controls">
        {/*
          * The mouse-look state, said out loud.
          *
          * Pointer Lock hides the cursor and swallows every mouse event on the
          * page, so a player who does not know Escape gets it back has lost
          * control of the window — and the only previous indication was
          * `aria-pressed` on a button they can no longer click. Both branches
          * are `aria-live` so the change is announced rather than merely drawn.
          */}
        <p className="office3d__status" role="status" aria-live="polite">
          {pointerLocked ? t('office.headlook.release') : null}
          {!pointerLocked && pointerLockFailure === 'denied'
            ? t('office.headlook.lock_denied')
            : null}
          {!pointerLocked && pointerLockFailure === 'unsupported'
            ? t('office.headlook.lock_unsupported')
            : null}
        </p>

        {pointerLockSupported ? (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={pointerLocked}
            onClick={togglePointerLook}
          >
            {t('office.headlook.mouse_look')}
          </Button>
        ) : null}
      </div>

      <div className="office3d__overlay">
        {visible.map((placement) => (
          <div
            key={placement.id}
            className="office3d__screen"
            data-monitor={placement.id}
            ref={(element) => {
              if (!element) {
                surfaceRefs.current.delete(placement.id);
                return;
              }
              surfaceRefs.current.set(placement.id, element);
              // A monitor can mount mid-glance; start it on the current pose
              // rather than one render behind.
              const current = latestRef.current.find((entry) => entry.id === placement.id);
              element.style.transform = (current ?? placement).transform;
            }}
            style={{
              width: placement.width,
              height: placement.height,
              transform: placement.transform,
            }}
          >
            {/*
              * The surface itself, with its interface and — once the alarm is
              * acknowledged — its activation. Which tool each screen carries
              * and which console route it opens is `MonitorWall2D`'s to say:
              * the flat wall mounts exactly the same descriptors, and two
              * copies of that mapping is how the two paths would drift.
              *
              * The classes are still this file's, because they are about the
              * glass rather than the tool. While the alarm is unacknowledged
              * the room narrows to it: the centre monitor is treated, and the
              * two beside it step back. Not decoration — all three carry the
              * same bright DOM content, so before this the alarming one was not
              * the brightest thing in its own frame, measured at 167.3 against
              * 168.4 for the rest of the room. The side panels stay fully
              * legible; they are dimmed, not hidden, and recover the moment it
              * is acknowledged.
              */}
            <MonitorSurface3D
              id={placement.id}
              className={
                alert
                  ? placement.id === 'center'
                    ? 'office3d__surface office3d__surface--alarm'
                    : 'office3d__surface office3d__surface--deferred'
                  : 'office3d__surface'
              }
              alert={alert}
              onAcknowledgeAlarm={onAcknowledgeAlarm}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function toDegrees(radians: number): string {
  return ((radians * 180) / Math.PI).toFixed(2);
}
