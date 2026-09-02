import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { usePrefersReducedMotion } from '../app/gameContext';
import { alarmPhase, alarmRange } from './alarmPulse';
import { sharedChamferedBox } from './bevelGeometry';
import { LIGHTS, MONITORS, PALETTE, monitorStand, type MonitorSpec } from './layout';
import { roughnessVariation, variedRoughness } from './proceduralMaps';

/**
 * The three physical monitors.
 *
 * The screen plane is *not* where the interface lives — it is a near-black
 * backing so the glass reads as switched on and catches a little of the room.
 * The readable interface is a real DOM layer projected on top of it.
 *
 * Shells are modelled rather than loaded; the reason no CC0 monitor model is
 * used is recorded in `docs/ASSET_PIPELINE.md`. They carry a flat moulded-plastic
 * material rather than the painted-metal scan the header used to claim — see the
 * note on `shell` below. The geometry is a frame, a deeper chin, a vented
 * housing, a tilt hinge, a neck and a base plate that stands on the desk.
 *
 * The centre monitor is also the alarm emitter. Its red rim pulse and its
 * physical spill light are driven here, from the same `alert` flag that gates
 * the acknowledge raycast, so what is seen, what is heard and what can be
 * clicked cannot disagree about which screen is shouting. The sound comes from
 * the matching position in `src/audio/spatial.ts`; both read `MONITORS` rather
 * than a copied number.
 */

/**
 * Chamfer widths for the moulded and stamped parts, in metres.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §8: every edge in the room was a
 * perfect 90 degrees, and the missing highlight line down those edges is most
 * of what read as untextured CGI. A moulded bezel carries about a millimetre of
 * chamfer, a stamped base plate rather less, and a 5 mm power button less
 * again — so these are three numbers rather than one.
 *
 * `chamferedBox` cuts inward from the box it is given, so none of this moves
 * `bezel`, `outerWidth`, `outerHeight` or the z of the screen backing and the
 * alarm rim. That matters: `projection.ts` owns a 2 px drift budget against
 * those, and `headlook.spec.ts` measures the alarm's focal dominance inside a
 * quad derived from `screen/2 + bezel`. `tests/unit/bevelGeometry.test.ts`
 * asserts the bounding boxes are unchanged rather than trusting the comment.
 */
const CHAMFER = {
  /** Bezel frame, chin and back housing — injection-moulded ABS. */
  moulded: 0.0012,
  /** Neck and base plate — a heavier stamped and moulded assembly. */
  stand: 0.0015,
  /** The base's thin stamped lip, 4 mm thick, and the power button. */
  fine: 0.0006,
} as const;

/** Spill-light intensity range. The low end is never zero — it must stay lit. */
const ALARM_LIGHT_RANGE = { min: 0.8, max: 2.6 };
/*
 * Rim opacity range. Restrained: this is a border, never a full-screen flash.
 *
 * Raised from 0.16–0.50 for the P0.4 pass. The contract requires the centre
 * alarm to be the first focal point before acknowledgement, and once the
 * background carried a lit window, a lamp, a sconce and a rack of LEDs, it was
 * not: measured, the brightest 1% of the frame outside the centre monitor beat
 * the alarm 197 to 164. Half the fix was dimming the room's other highlights;
 * this is the other half. `headlook.spec.ts` now holds the comparison as a
 * gate, so the number cannot drift back without something failing.
 */
const ALARM_RIM_RANGE = { min: 0.36, max: 0.82 };

export function Monitors({
  alert,
  spill,
  onAcknowledge,
}: {
  alert: boolean;
  /**
   * How much of the alarm's spill is still lit, 1 to 0.
   *
   * Defaults to the boolean it replaces, so a caller with no acknowledge bundle
   * behaves exactly as before: lit while alarming, dark the instant it is not.
   */
  spill?: number;
  /** Raycast target while the alarm is unacknowledged (audit P0.2). */
  onAcknowledge?: () => void;
}) {
  /*
   * A plain material, not the painted-metal scan.
   *
   * The three monitors are the same object and were rendering up to 3x apart in
   * value, because the tiling `hardware` texture put a different patch of gold
   * speckle on each bezel. A bezel is moulded dark plastic; giving it a
   * photographed metal albedo was borrowing detail the shape does not have.
   */
  const shell = useMemo(() => {
    /*
     * The shell used to be `roughness: 0.66` and nothing else — one specular
     * response over three whole displays, which is the flat plastic-toy read
     * that no amount of geometry fixes. What a moulded ABS bezel actually has
     * is a fine mould-texture grain, and a grain is a roughness map.
     *
     * The scalar is `0.66 / mean`, not 0.66: `MeshStandardMaterial` multiplies
     * the two, so shipping the constant unchanged beside a map would have made
     * the bezels *smoother* on average and put new highlights into the frame
     * that `headlook.spec.ts` measures the alarm against. Compensated, the mean
     * effective roughness is still exactly 0.66 and only the variation is new.
     *
     * The three parts carrying this material — frame, housing and chin — are
     * all chamfered extrusions, so their UVs are in metres and `repeat: 30`
     * means a 33 mm tile on every one of them regardless of panel size.
     */
    const grain = roughnessVariation({ seed: 17, size: 128, cells: 9, amplitude: 0.16, repeat: 30 });
    return new THREE.MeshStandardMaterial({
      color: '#1c1a19',
      roughness: variedRoughness(0.66, grain.mean),
      roughnessMap: grain.texture,
      metalness: 0.04,
      envMapIntensity: 0.12,
    });
  }, []);

  /*
   * Materials own the textures built with them, and the office unmounts on
   * every trip to the dashboard. Nothing here was being disposed before there
   * were textures to leak; now there are.
   */
  useEffect(
    () => () => {
      shell.roughnessMap?.dispose();
      shell.dispose();
    },
    [shell],
  );

  const extras = useMemo(
    () => ({
      stand: new THREE.MeshStandardMaterial({
        color: '#1a1715',
        roughness: 0.55,
        metalness: 0.55,
      }),
      glass: new THREE.MeshStandardMaterial({
        color: PALETTE.screenOff,
        roughness: 0.28,
        metalness: 0.1,
      }),
    }),
    [],
  );

  /*
   * The other two materials, disposed for the same reason the shell is.
   *
   * `shell` was cleaned up when it gained a texture; these were left behind
   * because they have none — but a `MeshStandardMaterial` is a compiled GPU
   * program either way, and the office is unmounted and remounted on every trip
   * to the dashboard and back. Two programs a round trip is a slow leak rather
   * than a fast one, which is the kind that survives a review.
   */
  useEffect(
    () => () => {
      extras.stand.dispose();
      extras.glass.dispose();
    },
    [extras],
  );

  return (
    <group>
      {MONITORS.map((monitor) => (
        <Monitor
          key={monitor.id}
          monitor={monitor}
          shell={shell}
          stand={extras.stand}
          glass={extras.glass}
          alert={alert && monitor.id === 'center'}
          spill={monitor.id === 'center' ? (spill ?? (alert ? 1 : 0)) : 0}
          onAcknowledge={monitor.id === 'center' ? onAcknowledge : undefined}
        />
      ))}
    </group>
  );
}

function Monitor({
  monitor,
  shell,
  stand,
  glass,
  alert,
  spill,
  onAcknowledge,
}: {
  monitor: MonitorSpec;
  shell: THREE.Material;
  stand: THREE.Material;
  glass: THREE.Material;
  alert: boolean;
  /** 1 while alarming, then the acknowledge bundle's decay, then 0. */
  spill: number;
  onAcknowledge?: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const rimRef = useRef<THREE.MeshBasicMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  /** Only the centre monitor is the alarm emitter, in light as in sound. */
  const isEmitter = monitor.id === 'center';

  /*
   * Reduced motion holds the alarm at the midpoint of its range rather than
   * removing it: the state still has to be visible without animation, and a
   * screen that simply stops pulsing reads as a screen that stopped alarming.
   */
  useFrame(() => {
    /*
     * `spill`, not `alert`.
     *
     * The light used to be cut to zero on the frame the alarm was acknowledged,
     * which is the loudest object in the room disappearing between two frames.
     * It now follows the acknowledge bundle's decay down to nothing over about
     * 185 ms, and only then stops being drawn. The light stays mounted either
     * way; it is silenced by intensity, never by unmounting.
     */
    if (!alert && spill <= 0) {
      if (lightRef.current) lightRef.current.intensity = 0;
      if (rimRef.current) rimRef.current.opacity = 0;
      return;
    }
    /*
     * `performance.now()`, not `state.clock.elapsedTime`.
     *
     * The r3f clock starts when the canvas does, so the room's pulse used to
     * begin on a different beat from the DOM border layered on top of it — and
     * ran at a different period as well. Both now read `alarmPhase` off the
     * absolute clock, which is the one thing that makes them the same alarm
     * rather than two things that happen to blink.
     */
    const now = performance.now();
    if (lightRef.current) {
      lightRef.current.intensity = alarmRange(now, ALARM_LIGHT_RANGE, reducedMotion) * spill;
    }
    if (rimRef.current) {
      rimRef.current.opacity = alarmRange(now, ALARM_RIM_RANGE, reducedMotion) * spill;
    }
    /*
     * Publish what was actually applied.
     *
     * This is the value that just drove the material, so a test reading it is
     * reading the room's real output rather than a second calculation that
     * could agree with the comment and disagree with the pixels.
     */
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.alarmPhase = alarmPhase(now, reducedMotion).toFixed(4);
    }
  });

  // The published phase is about a room that is on screen. Leaving it behind
  // would have the dashboard advertising an alarm phase for a room that is not
  // mounted, which is exactly the kind of stale attribute a test then trusts.
  useEffect(() => {
    if (!isEmitter) return;
    return () => {
      if (typeof document !== 'undefined') delete document.documentElement.dataset.alarmPhase;
    };
  }, [isEmitter]);

  const outerWidth = monitor.screen.width + monitor.bezel * 2;
  const outerHeight = monitor.screen.height + monitor.bezel * 2;
  const [x, y, z] = monitor.position;

  /*
   * The stand, rebuilt against the desk the room actually ships.
   *
   * Three things were wrong with the old one, and all three came of deriving it
   * from `standDrop = y - (DESK.height + 0.012)` rather than from the parts it
   * has to touch.
   *
   * 1. The foot floated. Its plate spanned world y 0.752..0.768 — 12 mm of air
   *    between a monitor base and the desk it is supposed to be standing on.
   * 2. The neck was buried. At `standDrop * 0.86` it spanned world y 0.617 to
   *    0.882 on the side monitors, so 123 mm of it ran down *through* the desk
   *    top: geometry describing a monitor sunk into the furniture.
   * 3. The base overhung the desk. The foot sat at local z −0.06, which for the
   *    centre monitor is world z −0.68..−0.52; the shipped desk's back edge is
   *    at −0.565 (measured — see `DESK` in `layout.ts`), so 71% of the centre
   *    monitor's base was cantilevered off the back of the desk into air.
   *
   * The derivation lives in `monitorStand` so the cable run in `Workstation.tsx`
   * starts where the neck actually is. `bezel`, `outerWidth` and `outerHeight`
   * are deliberately untouched: the alarm rim and the focal-hierarchy quad in
   * `headlook.spec.ts` both key off `screen/2 + bezel` and must stay coincident.
   */
  const {
    chinHeight,
    panelBottom,
    chinBottom,
    deskLocal,
    baseHeight,
    baseTop,
    neckHeight,
    neckWidth,
    neckDepth,
    neckZ,
    baseZ,
    baseWidth,
    baseDepth,
  } = monitorStand(monitor);

  const vents = useMemo(() => {
    const count = 9;
    return Array.from({ length: count }, (_, index) => ({
      y: -outerHeight / 4 + index * 0.014,
    }));
  }, [outerHeight]);

  const interactive = alert && Boolean(onAcknowledge);

  return (
    <group
      position={[x, y, z]}
      rotation={[0, monitor.rotationY, 0]}
      // The physical click target the contract asks for. The projected DOM
      // panel carries the keyboard-equivalent button; both dispatch the same
      // ACKNOWLEDGE_ALARM event. The bezel is what peeks out around the DOM
      // surface, so this is reachable even though the panel covers the glass.
      onClick={interactive ? (event) => {
        event.stopPropagation();
        onAcknowledge?.();
      } : undefined}
      onPointerOver={interactive ? () => {
        document.body.style.cursor = 'pointer';
      } : undefined}
      onPointerOut={interactive ? () => {
        document.body.style.cursor = '';
      } : undefined}
    >
      {/*
        The front bezel frame, chamfered.

        This is the hero edge in the room: it runs the full width of the frame
        at the height the seated camera looks straight at, and until this pass
        it was a perfect square corner catching exactly one value of light. The
        1.2 mm cut is inward — the outer footprint is still exactly
        `outerWidth x outerHeight`, which the alarm rim and the DOM projection
        both depend on.
      */}
      <mesh
        position={[0, 0, -0.004]}
        material={shell}
        geometry={sharedChamferedBox(outerWidth, outerHeight, 0.012, CHAMFER.moulded)}
      />

      {/* thicker housing behind, narrower so the bezel reads as a lip */}
      <mesh
        position={[0, -0.006, -0.026]}
        material={shell}
        geometry={sharedChamferedBox(
          outerWidth * 0.82,
          outerHeight * 0.74,
          0.042,
          CHAMFER.moulded,
        )}
      />

      {/* vent slots on the back housing */}
      {vents.map((vent, index) => (
        <mesh key={index} position={[0, vent.y, -0.048]} material={stand}>
          <boxGeometry args={[outerWidth * 0.44, 0.005, 0.004]} />
        </mesh>
      ))}

      {/* screen backing */}
      <mesh position={[0, 0, 0.003]} material={glass}>
        <planeGeometry args={[monitor.screen.width, monitor.screen.height]} />
      </mesh>

      {/*
        The alarm rim. The readable interface is a DOM layer composited over the
        canvas, so this plane's centre is always hidden behind it and what the
        player actually sees is a pulsing red border around the glass — the
        "restrained screen-border pulse" of audit P0.2, never a viewport flash.
      */}
      {alert ? (
        <mesh position={[0, 0, 0.0035]}>
          <planeGeometry args={[outerWidth, outerHeight]} />
          <meshBasicMaterial
            ref={rimRef}
            color={PALETTE.critical}
            transparent
            opacity={ALARM_RIM_RANGE.min}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      ) : null}

      {/*
        The physical spill: real red light on the desk and the back wall.

        Mounted for the emitter monitor whether or not the alarm is sounding,
        and driven to zero intensity when it is not. Adding or removing a light
        changes the scene's light count, which forces three.js to recompile the
        program for every PBR material in the room — at office entry and again
        at acknowledgement, the one moment the audit wants to feel instant. An
        intensity-0 light keeps its slot and costs nothing to look at.
      */}
      {isEmitter ? (
        <pointLight
          ref={lightRef}
          position={[0, 0, 0.24]}
          color={LIGHTS.alertSpill}
          intensity={0}
          distance={2.1}
          decay={2}
        />
      ) : null}

      {/*
        The chin.

        A display has a thin top and sides and a deeper lower rail carrying the
        button and the power indicator, and ours had one uniform 16–18 mm frame
        all the way round — which is a large part of why the hardware read as a
        slab rather than as a monitor.

        It is built as its own bar *below* the frame rather than by growing
        `bezel`, and that is load-bearing rather than tidy. `bezel` sets the
        alarm rim's quad and the quad `headlook.spec.ts` measures the alarm's
        focal dominance inside; growing it would push a band of additive red
        outside the measured region and start spending the margin that gate has.
        A chin is not a lit part of the screen, so it belongs outside both.
      */}
      <mesh
        position={[0, panelBottom - chinHeight / 2, -0.004]}
        material={shell}
        geometry={sharedChamferedBox(outerWidth, chinHeight, 0.014, CHAMFER.moulded)}
      />

      {/* the power button, offset from centre the way a real chin carries it */}
      <mesh
        position={[outerWidth / 2 - 0.032, panelBottom - chinHeight / 2, 0.004]}
        material={stand}
        geometry={sharedChamferedBox(0.012, 0.005, 0.002, CHAMFER.fine)}
      />

      {/* power LED: dim amber normally, coral while the incident is unacknowledged */}
      <mesh position={[outerWidth / 2 - 0.056, panelBottom - chinHeight / 2, 0.004]}>
        <boxGeometry args={[0.01, 0.0035, 0.002]} />
        <meshBasicMaterial
          color={alert ? PALETTE.critical : '#6b5636'}
          toneMapped={false}
        />
      </mesh>

      {/* tilt hinge, neck and base — see the derivation above */}
      <mesh
        position={[0, chinBottom - 0.012, neckZ - 0.014]}
        rotation={[0, 0, Math.PI / 2]}
        material={stand}
      >
        <cylinderGeometry args={[0.016, 0.016, neckWidth * 0.92, 14]} />
      </mesh>
      <mesh
        position={[0, baseTop + neckHeight / 2, neckZ]}
        material={stand}
        geometry={sharedChamferedBox(neckWidth, neckHeight, neckDepth, CHAMFER.stand)}
      />
      {/*
        The base plate and its lip are read from above rather than head-on, so
        both are chamfered around their top and bottom faces — the edge a
        desk-level camera actually sees catch the ceiling panel.
      */}
      <mesh
        position={[0, deskLocal + baseHeight / 2, baseZ]}
        material={stand}
        geometry={sharedChamferedBox(baseWidth, baseHeight, baseDepth, CHAMFER.stand, 'y')}
      />
      {/* the thin lip a stamped base has around its edge */}
      <mesh
        position={[0, deskLocal + baseHeight + 0.002, baseZ]}
        material={stand}
        geometry={sharedChamferedBox(
          baseWidth * 0.84,
          0.004,
          baseDepth * 0.82,
          CHAMFER.fine,
          'y',
        )}
      />
    </group>
  );
}
