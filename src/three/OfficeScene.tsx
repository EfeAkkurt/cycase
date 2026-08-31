import { Suspense, useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { cameraRig } from './cameraRig';
import { Colleague, type ColleaguePhase } from './Colleague';
import { WarmEnvironment } from './assets';
import { BACKDROP, DESK, LIGHTS, PALETTE, ROOM } from './layout';
import { CAMERA_PROPS } from './projection';
import { Monitors } from './Monitors';
import { ResizeObserverShim } from './ResizeObserverShim';
import { Room } from './Room';
import { Workstation } from './Workstation';

/**
 * The WebGL office.
 *
 * One canvas, one renderer, demand rendering, DPR capped at 1.5 — the budget in
 * docs/PRODUCT_SPEC.md. Nothing here is interactive: every control the player
 * needs lives in real DOM, either on the projected monitor surfaces or in the
 * dialogue panel below.
 */

export interface OfficeSceneProps {
  /** Choreography phase of the human colleague (audit P0.2). */
  colleaguePhase: ColleaguePhase;
  onColleagueArrive?: () => void;
  /** Centre monitor runs the unacknowledged-incident treatment. */
  alert: boolean;
  reducedMotion: boolean;
  onFootstep?: () => void;
  onAcknowledgeAlarm?: () => void;
  /**
   * Fired once the room has actually been drawn — see `ReadyProbe`.
   *
   * Optional and normally absent. Only the dashboard return supplies it, and
   * only to decide when it is safe to uncover the room.
   */
  onReady?: () => void;
}

const MAX_DPR = 1.5;

/**
 * Frames that must be drawn before the room counts as ready.
 *
 * `useFrame` runs *before* `gl.render`, so on the tick where the counter
 * reaches this the two frames before it have been rendered and presented —
 * which is what actually costs the time on a remount. The GLTFs and their
 * textures are already parsed and cached by then; what is not cached is the
 * WebGL context itself, so every PBR program in the room is compiled and every
 * texture re-uploaded on the first `render` against the new context.
 */
const READY_FRAMES = 3;

/**
 * A single shadow-mapped spot, aimed down at the desk from the ceiling fixture.
 *
 * `autoUpdate` is switched off after the first render. The casters are static
 * furniture and the light never moves, so re-rendering the depth map on every
 * requested frame would be paying for the same picture repeatedly — and this
 * scene requests frames whenever the head turns.
 *
 * The cone is narrow and the intensity is small on purpose. The room is
 * already lit by the point light at the same position; what this adds is the
 * contact, not the illumination.
 *
 * What it does *not* currently add is contact for anything short, and it is
 * worth writing the arithmetic down rather than leaving the next person to
 * wonder why the foreground still reads ungrounded.
 *
 * The shadow camera's fov is `angle * 2` = 97.4°, and the desk surface is
 * 1.734 m from the fixture, so the map covers 3.95 m of desk. At 2048 that is
 * 1.93 mm per texel: a 62 mm mouse is 32 texels across and a 86 mm mug is 45,
 * both easily resolved. (At the previous 1024 they were 16 and 22, which is
 * where a contact shadow starts to read as a blur rather than as a shadow. The
 * map is rendered exactly once — `autoUpdate` is off below — so the larger size
 * costs one render and no per-frame work at all; the sample count is unchanged.)
 *
 * The limit is `shadow-normalBias`, not resolution. At 0.02 the receiver is
 * sampled from 20 mm above its own surface, so an occluder shorter than that
 * casts nothing and one twice that casts half of what it should: the mug (90 mm)
 * survives it, the mouse (40 mm) partially, the hub (24 mm) and the keycaps
 * (22 mm above the plate) effectively not. Lowering it would recover them and
 * risks shadow acne on the desk's own grazing faces — a trade that has to be
 * looked at on a real GPU, not reasoned about, so it has deliberately not been
 * made here.
 */
function ContactShadowLight() {
  const light = useRef<THREE.SpotLight>(null);

  useEffect(() => {
    const current = light.current;
    if (!current) return;
    // One pass, then frozen. `needsUpdate` forces that one pass even though
    // autoUpdate is already false by the time the next frame is requested.
    current.shadow.autoUpdate = false;
    current.shadow.needsUpdate = true;
  }, []);

  return (
    <spotLight
      ref={light}
      position={[0, ROOM.height - 0.12, -0.62]}
      target-position={[0, 0, DESK.z]}
      angle={0.85}
      penumbra={0.8}
      intensity={2.2}
      distance={5.2}
      decay={2}
      color={LIGHTS.ceilingPanel}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-bias={-0.0005}
      shadow-normalBias={0.02}
    />
  );
}

export function OfficeScene(props: OfficeSceneProps) {
  return (
    <Canvas
      // Static scene: frames are requested, not pumped. `AnimationDriver`
      // invalidates while something is actually moving.
      frameloop="demand"
      // R3F will not create its WebGL root until the element it measures
      // reports a size, and it learns that size only from a ResizeObserver
      // callback — which is not guaranteed to arrive in every embedding.
      resize={{ polyfill: ResizeObserverShim as unknown as typeof ResizeObserver }}
      dpr={[1, MAX_DPR]}
      /*
       * One shadow map, for contact.
       *
       * Nothing in this room dropped a shadow, and contact occlusion is most of
       * what tells a viewer that a mug is standing on a desk rather than
       * hovering over a picture of one. It is also the cheapest thing here: the
       * scene is `frameloop="demand"` and the geometry that casts is static, so
       * the map is rendered on the frames that are requested anyway and
       * `autoUpdate` is switched off after the first one.
       */
      /*
       * PCF, explicitly. R3F's `shadows` shorthand selects `PCFSoftShadowMap`,
       * which three.js now deprecates and warns about once per renderer — and
       * `console-hygiene.spec.ts` fails on any warning that is not named and
       * justified, correctly.
       */
      shadows={{ type: THREE.PCFShadowMap }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={CAMERA_PROPS}
      onCreated={({ gl }) => {
        gl.setClearColor(PALETTE.void, 1);
        gl.toneMappingExposure = 0.44;
      }}
      aria-hidden="true"
    >
      {/*
        * Suspense lives *inside* the canvas on purpose. Asset loading suspends,
        * and if that propagates outward React Three Fiber throws its block
        * promise past the canvas — the renderer survives the round trip sized
        * and context-alive, but its demand loop does not resume, so the scene
        * renders zero frames and shows as pure black with no error anywhere.
        */}
      <Suspense fallback={null}>
        <SceneContents {...props} />
      </Suspense>
    </Canvas>
  );
}

function SceneContents({
  colleaguePhase,
  onColleagueArrive,
  alert,
  reducedMotion,
  onFootstep,
  onAcknowledgeAlarm,
  onReady,
}: OfficeSceneProps) {
  const animating = colleaguePhase === 'entering';

  return (
    <>
      <ReadyProbe onReady={onReady} />
      <WarmEnvironment intensity={1.25} />
      <Lighting alert={alert} colleagueLit={colleaguePhase !== 'hidden'} />
      <Room />
      <Workstation />
      <Monitors alert={alert} onAcknowledge={onAcknowledgeAlarm} />
      <Colleague phase={colleaguePhase} onArrive={onColleagueArrive} />
      <HeadLookDriver />
      <AnimationDriver
        active={animating}
        reducedMotion={reducedMotion}
        onFootstep={colleaguePhase === 'entering' ? onFootstep : undefined}
      />
    </>
  );
}

/**
 * Reports the first moment the room is on screen rather than merely mounted.
 *
 * It lives *inside* the canvas's Suspense boundary, so by the time it renders
 * at all every asset the scene suspended on has resolved; and it counts
 * rendered frames rather than trusting `onCreated`, which fires when the WebGL
 * root is created — before a single program is compiled and while the canvas
 * is still the clear colour.
 *
 * It drives its own frames instead of riding `AnimationDriver`'s pump. Under
 * reduced motion that pump deliberately does not exist on a settled beat
 * (`if (reducedMotion && !active) { invalidate(); return; }`), so a probe that
 * only counted would sit at one frame forever and the caller waiting on it
 * would wait out its timeout. Once it has reported, it stops invalidating and
 * costs nothing; with no `onReady` it never starts.
 */
function ReadyProbe({ onReady }: { onReady?: () => void }) {
  const invalidate = useThree((state) => state.invalidate);
  const drawn = useRef(0);
  const reported = useRef(false);

  useEffect(() => {
    if (!onReady) return;
    invalidate();
  }, [invalidate, onReady]);

  useFrame(() => {
    if (reported.current || !onReady) return;

    drawn.current += 1;
    if (drawn.current >= READY_FRAMES) {
      reported.current = true;
      onReady();
      return;
    }
    invalidate();
  });

  return null;
}

/**
 * Applies the seated head-look rig to the render camera every frame it moves,
 * and keeps the demand loop alive while it does. The DOM monitor projection
 * follows the same rig from `Office3D`, so glass and interface stay glued.
 */
function HeadLookDriver() {
  const invalidate = useThree((state) => state.invalidate);
  const baseRotation = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    /*
     * Wake the loop on *every* rig emit, not only while it reports motion.
     * Reduced motion runs the rig in instant mode, where a look lands on its
     * target inside `lookAt` and `moving` is already false by the time the
     * listener sees it — waiting for motion there would leave the camera
     * pointing at the old pose until something else happened to draw a frame.
     */
    return cameraRig.subscribe(() => invalidate());
  }, [invalidate]);

  useFrame((frameState, delta) => {
    const camera = frameState.camera;
    if (!baseRotation.current) {
      camera.rotation.reorder('YXZ');
      baseRotation.current = { x: camera.rotation.x, y: camera.rotation.y };
    }

    const stillMoving = cameraRig.update(delta);
    const rig = cameraRig.state;
    camera.rotation.y = baseRotation.current.y + rig.yaw;
    camera.rotation.x = baseRotation.current.x + rig.pitch;

    if (stillMoving) invalidate();
  });

  return null;
}

/**
 * Lighting reads as baked: a soft ambient fill plus a handful of fixed lights
 * standing in for the monitor spill. Only the alert light changes, and only
 * when the incident state changes.
 */
function Lighting({ alert, colleagueLit }: { alert: boolean; colleagueLit: boolean }) {
  return (
    <>
      {/*
       * Relit twice now. The first pass (P0.4, luminance) lifted a room that
       * measured mean 9.7 with 89.7% of the frame under 20 — too dark to
       * perceive its own assets. This pass fixes what that one introduced: every
       * term in the rig was warm, so the room came out sodium-orange while the
       * approved reference is a *neutral grey* office with warm pools in it.
       *
       * General illumination is near-achromatic now (`LIGHTS.ambient` and
       * `LIGHTS.fill` are a couple of points of red over blue and no more) and
       * the warmth is spent only where a fixture is actually visible: the desk
       * lamp, the sconce over the door, the corridor beyond it. The colour gate
       * is untouched by this — it fires on `b - r > 18`, and a neutral grey has
       * `b - r = 0` — but the picture changes completely.
       */}
      <ambientLight intensity={0.42} color={LIGHTS.ambient} />
      <hemisphereLight args={[LIGHTS.hemiSky, LIGHTS.hemiGround, 0.4]} />

      {/* the lit ceiling troffer over the desk — the room's key light */}
      <pointLight
        position={[0, ROOM.height - 0.12, -0.62]}
        intensity={7.4}
        distance={5.6}
        decay={2}
        color={LIGHTS.ceilingPanel}
      />

      {/*
       * The shadow caster, and the only one.
       *
       * Deliberately a second light rather than a conversion of the troffer
       * above: a point light's shadow is a six-face cube map, and changing that
       * fixture to a spot would change the room's whole falloff along with it.
       * This adds a narrow cone from the same fixture position carrying a
       * fraction of the intensity, so what it contributes is the shadow rather
       * than the light.
       */}
      <ContactShadowLight />

      {/*
       * The desk lamp practical.
       *
       * Down from 3.2 and raised 16 cm. It sat 30 cm above the desk with a
       * 1.8 m reach and burned a pool at rgb(252,226,159) into the bottom-left
       * corner — the hottest pixels in the picture, which with the alarm
       * required to be the first focal point is the one place they must not be.
       * Lifting the source as well as dimming it is what softens the pool
       * rather than just darkening the whole corner.
       */}
      <pointLight
        position={[-0.95, 1.22, -0.28]}
        intensity={1.0}
        distance={1.5}
        decay={2}
        color={LIGHTS.practical}
      />

      {/* monitor spill: warm grey, not a colour wash */}
      <pointLight
        position={[-0.8, 1.18, -0.14]}
        intensity={1.1}
        distance={1.2}
        decay={2}
        color={LIGHTS.screenSpill}
      />
      <pointLight
        position={[0, 1.22, -0.26]}
        intensity={alert ? 2.4 : 1.2}
        distance={1.5}
        decay={2}
        color={alert ? LIGHTS.alertSpill : LIGHTS.screenSpill}
      />
      <pointLight
        position={[0.8, 1.18, -0.14]}
        intensity={1.1}
        distance={1.2}
        decay={2}
        color={LIGHTS.screenSpill}
      />

      {/*
       * The warm pools, and the only saturated lights in the room.
       *
       * The sconce over the doorway and the corridor beyond it. Both were one
       * anonymous "back wall" light before; they are now aimed at the objects
       * that justify them, which is what makes the warmth read as a fixture
       * rather than as a colour grade.
       */}
      <pointLight
        position={[BACKDROP.door.position[0], BACKDROP.door.height + 0.2, BACKDROP.door.position[2] + 0.34]}
        intensity={1.3}
        /*
         * 2.0 reached far enough to wash roughly a quarter of the upper frame.
         * A sconce on a wall makes a pool; this is the radius that makes one.
         * It also widens the focal-hierarchy margin, because the brightest
         * region outside the alarm was this fixture's spill.
         */
        distance={1.1}
        decay={2}
        color={LIGHTS.practical}
      />

      {/*
       * Fill for the head-look cone (P0.1). The seated player can turn 55°
       * either way and 20° down, and the four contract captures are measured
       * with the same thresholds as the front view — so the shoulders, both
       * side walls and the floor in front of the desk have to carry light of
       * their own. The pair is symmetric because the cone is.
       */}
      <pointLight position={[-1.8, 1.9, 0.8]} intensity={2.6} distance={4.2} decay={2} color={LIGHTS.fill} />
      <pointLight position={[1.8, 1.9, 0.8]} intensity={2.6} distance={4.2} decay={2} color={LIGHTS.fill} />

      {/*
       * Floor bounce. The ceiling panel throws a lot of light at bare concrete
       * and almost none of it came back, which left the rear-limit view — the
       * only one that looks down — measurably darker than the room it is in.
       */}
      <pointLight position={[0, 0.42, 0.5]} intensity={4.2} distance={4.8} decay={2} color={LIGHTS.fill} />

      {/*
       * Two more bounce terms, on the near corners of the desk.
       *
       * Measured, the rear head-look limit — yaw -55, pitch -20, the operator
       * looking down past the right shoulder — came back at mean luminance 16.4
       * with 32% of the frame under 8. The ceiling panel and the desk lamp both
       * point away from that corner, so it was floor and desk edge with nothing
       * lighting them. Bounce is the physically honest fix; lifting global
       * exposure instead would have washed out the three views that already pass
       * comfortably.
       */}
      {/*
       * Both passes reached for the same dial. The staging pass raised the two
       * desk fills; the relight pass added two terms aimed at what the new
       * geometry had taken. Kept together and re-measured, because the racks,
       * shelving, whiteboard and ceiling are all in the frame now and the rear
       * head-look limit is the gate with the least room in it.
       */}
      <pointLight position={[1.15, 0.5, 0.75]} intensity={5.4} distance={3.2} decay={2} color={LIGHTS.fill} />
      <pointLight position={[-1.15, 0.5, 0.75]} intensity={3.0} distance={3.0} decay={2} color={LIGHTS.fill} />
      <pointLight position={[1.9, 1.25, -1.5]} intensity={4.2} distance={3.6} decay={2} color={LIGHTS.fill} />
      <pointLight position={[-0.4, 1.35, -1.9]} intensity={3.4} distance={3.4} decay={2} color={LIGHTS.hemiSky} />

      {/*
       * The colleague's key and rim — the audit's own prescription: "Give her a
       * rim or key light and readable material values — she is currently almost
       * a silhouette."
       *
       * These are the *only* lights in the room that are added and removed
       * rather than dimmed, and that is a considered exception to the rule
       * `Monitors.tsx` follows. Changing the scene's light count recompiles
       * every PBR program in the room, so it must never happen at a moment the
       * player is watching for responsiveness — but these two mount when she
       * starts walking, four seconds of scripted animation before she says
       * anything, and are gone once the room returns to its resting state. Two
       * lights carried permanently for one character would cost every frame of
       * the case for a beat that lasts fifteen seconds.
       *
       * Placement is three-quarter front-left for the key, so the light comes
       * from the room she has walked into rather than from the camera, and a
       * low rear-right rim to separate her from the server bay behind her. The
       * rim is warm-*neutral* plaster bounce, not the usual cool edge — the
       * colour gate would fail a blue rim on sight, and a cool rim would be
       * wrong in this room regardless.
       *
       * Both have a short `distance` and a correspondingly high intensity, and
       * that is the point rather than an accident of tuning. The first version
       * reached 2.9 m, which meant it also lit the wall shelf and the window
       * frame eight feet away: the room visibly brightened when she walked in,
       * which is not what a key light on a person looks like, and it broke the
       * differential measurement in `characters.spec` by changing a patch of
       * wall as much as it changed her. A key that lights the whole set is not
       * a key.
       */}
      {colleagueLit ? (
        <>
          <pointLight
            position={[0.94, 1.72, -0.42]}
            intensity={4.6}
            distance={1.9}
            decay={2}
            color={LIGHTS.characterKey}
          />
          <pointLight
            position={[1.98, 1.46, -1.48]}
            intensity={3.2}
            distance={1.4}
            decay={2}
            color={LIGHTS.characterRim}
          />
        </>
      ) : null}
    </>
  );
}

/**
 * Frame pump for demand rendering.
 *
 * Full rate only while the scripted entrance is running. Otherwise ambient
 * motion is invalidated at 10 FPS, which is what docs/PROJECT_CONTEXT.md §7
 * asks for ("ambient animations update at 5–10 FPS, not 60 FPS") and keeps the
 * office nearly free when nothing is happening.
 */
function AnimationDriver({
  active,
  reducedMotion,
  onFootstep,
}: {
  active: boolean;
  reducedMotion: boolean;
  onFootstep?: () => void;
}) {
  const invalidate = useThree((state) => state.invalidate);
  const stepRef = useRef(0);

  // Assets resolve asynchronously; demand rendering needs to be told that the
  // scene it was asked to draw has only just arrived.
  useEffect(() => {
    invalidate();
  }, [invalidate]);

  useEffect(() => {
    if (reducedMotion && !active) {
      invalidate();
      return;
    }

    let raf = 0;
    let timer = 0;

    if (active) {
      const pump = () => {
        invalidate();
        raf = window.requestAnimationFrame(pump);
      };
      raf = window.requestAnimationFrame(pump);
    } else {
      timer = window.setInterval(() => invalidate(), 100);
    }

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      if (timer) window.clearInterval(timer);
    };
  }, [active, reducedMotion, invalidate]);

  // Footstep cues, timed off the same clock the walk animation uses.
  useFrame((_, delta) => {
    if (!active || !onFootstep) return;
    stepRef.current += delta;
    if (stepRef.current >= 0.38) {
      stepRef.current = 0;
      onFootstep();
    }
  });

  return null;
}

export { ROOM };
