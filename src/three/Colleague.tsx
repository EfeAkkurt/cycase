import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';

import { publishCharacterSampler } from './characterDiagnostics';

import {
  CHARACTER_FILES,
  CHARACTER_PALETTE,
  COLLEAGUE_CLIPS,
  COLLEAGUE_HEIGHT,
  COLLEAGUE_PATH,
  PALETTE,
  SEAT_Z,
} from './layout';

/**
 * VERA — the scripted colleague.
 *
 * She walks in from the door, stops behind the right-hand end of the desk,
 * reports one concrete problem and settles. That is the whole behaviour: no
 * pathfinding, no physics, no player control.
 *
 * The nine-box figure the audit rejected (P0.3) is gone. This is a rigged,
 * skinned CC0 character from the Quaternius Ultimate Animated Character Pack,
 * imported reproducibly by `scripts/fetch-assets.mjs` and recorded in
 * `ASSET_LICENSES.md`. Two of the pack's seventeen clips ship — `Walk` and
 * `Idle` — because those are the two the room plays; the rest are combat and
 * emotes and cost 2 MB of animation data.
 *
 * The pack has no pointing clip and no relieved variant, so the two remaining
 * beats the contract asks for are authored here as an additive layer on the
 * real skeleton, applied after the mixer writes each frame:
 *
 *   entering  → `Walk`, driven along `COLLEAGUE_PATH`
 *   urgent    → `Idle` at 1.4x with a forward lean and a fast chest rise
 *   pointing  → the right arm raised toward the centre monitor on bounded
 *               joint rotations, head turned to follow it, held for two seconds
 *   relieved  → `Idle` at 0.85x, lean released, breath long
 *
 * `urgent` and `relieved` are positions on one axis rather than two poses, and
 * that axis is driven by the *case* — `caseResolved` — not by how long she has
 * been standing there. See `RELIEF_RATE`.
 *
 * The point is solved against the real skeleton rather than aimed at runtime;
 * `POINT_POSE` records how, and why the runtime aim it replaces was removed.
 */

/** Long enough to read as a walk, short of the machine's 4500 ms safety net. */
const WALK_DURATION = 4.2;

/** Beat boundaries, in seconds since she settled. */
const URGENT_UNTIL = 1.3;
const POINT_IN = 0.8;
const POINT_HOLD = 1.9;
const POINT_OUT = 0.7;
const POINT_END = URGENT_UNTIL + POINT_IN + POINT_HOLD + POINT_OUT;

/**
 * How fast she settles between urgent and relieved, as an exponential rate.
 *
 * Applied as `1 - e^(-rate * dt)` for the same reason `cameraRig` does: it is
 * frame-rate independent, so the transition takes the same wall-clock time on a
 * 60 Hz laptop and inside a stepped test.
 *
 * This is a *transition* rate, and that distinction is the whole point of this
 * pass. It used to be `RELIEF_OVER`, a duration measured from the moment she
 * stopped walking — so she relaxed 7.3 seconds after arriving whatever the
 * player had done, including nothing. She reported a live intrusion and then
 * visibly calmed down while it was still live. Relief is now a function of the
 * case, and this constant only says how quickly she reacts once the case
 * actually changes.
 */
const RELIEF_RATE = 0.9;

/** Playback rate of the shared `Idle` clip per emotional beat. */
const IDLE_RATE_URGENT = 1.4;
const IDLE_RATE_RELIEVED = 0.85;

/**
 * Choreography phase (audit P0.2). `hidden` before the alarm is acknowledged,
 * `entering` while she walks in from the door, `settled` once the story has
 * moved past her arrival — including a return from the dashboard, which must
 * not replay the entrance.
 */
export type ColleaguePhase = 'hidden' | 'entering' | 'settled';

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT = new THREE.Vector3(1, 0, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);

/**
 * The pointing pose, as bounded rotations on the right arm's own joints.
 *
 * Solved against the real rig rather than eyeballed: the GLB was loaded
 * headlessly, posed on `Idle`, placed at the settle point, and the four angles
 * searched — but searched in *screen* space, which is the correction that
 * matters and the one two earlier attempts got wrong.
 *
 * ## What is actually possible here, measured
 *
 * The monitor interface is a DOM layer composited over the canvas, so anything
 * of hers inside a panel's rectangle is not dimmed, it is gone. Her shoulder
 * joint sits at world y 1.017 and her arm is 0.53 m long, and the arithmetic
 * that falls out of those two numbers is unforgiving:
 *
 * - Solving for world *height* is not enough. A first pass put the fist at
 *   y 1.271 — above the 1.26 the body needs at the settle depth — and the hand
 *   still projected inside the right panel, because the hand is 0.15 m closer
 *   to the camera than her body is and therefore needs to be higher, not the
 *   same.
 * - **The elbow cannot clear at all.** Swept exhaustively with the shoulder
 *   held inside 140° of flexion, 18,659 poses put the hand clear of every panel
 *   at every review size and *none* of them clear the elbow. Her forearm comes
 *   out from behind the glass; the joint it hinges on stays behind it.
 * - Aim is a trade against that. The best forearm-to-monitor alignment among
 *   poses whose hand clears is about 41°, so this reads as a raised hand
 *   indicating the screens rather than as a finger on one. Poses that aim
 *   within 17° exist, but only past 170° of shoulder flexion — the arm swung
 *   almost vertically behind her — which is a silhouette no report beat wants.
 *
 * So this is the honest maximum: the hand and the upper forearm are the visible
 * part of the gesture, and the claim in `CHARACTER_ANCHORS.colleaguePoint` is
 * about the hand alone. `characters.spec.ts` asserts it by projecting the live
 * `FistR` bone against the live monitor rectangles, so a regression here fails
 * on the measurement rather than on a screenshot nobody reads.
 *
 * This replaces a gesture that had been switched off entirely. The previous
 * attempt slerped the bone toward a world direction and wrote it back through
 * the parent's inverse, which on this rig swung *both* arms toward the camera
 * and read as a deformed figure. These are plain local-axis multiplies on the
 * two bones the clip already drives — the same mechanism as the lean and the
 * breath below, which the file's own note says survives the frame intact.
 *
 * The one thing not established without a GPU is how it *looks*. The chain
 * resolves correctly and both segments keep their lengths, but a pose can be
 * geometrically sound and still read badly, and this shoulder is near the top
 * of its range. It is the item most worth a human eye on the review capture.
 */
const POINT_POSE = {
  /** Raises the upper arm forward and up, about the bone's own bend axis. */
  lift: -2.45,
  /** A little inward, so the elbow stays off her ribs without flaring. */
  swing: -0.2,
  /** Rolls the arm so the forearm comes across toward the monitors. */
  twist: 0.9,
  /** The elbow bend that lifts her hand clear of the glass. */
  elbow: -1.7,
} as const;

/** Smoothstep, so every beat eases in and out rather than snapping. */
function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** How far into the point gesture we are, 0 → 1 → 0. */
function pointWeight(elapsed: number): number {
  const t = elapsed - URGENT_UNTIL;
  if (t <= 0 || elapsed >= POINT_END) return 0;
  if (t < POINT_IN) return smooth(t / POINT_IN);
  if (t < POINT_IN + POINT_HOLD) return 1;
  return 1 - smooth((t - POINT_IN - POINT_HOLD) / POINT_OUT);
}

export function Colleague({
  phase,
  onArrive,
  caseResolved = false,
}: {
  phase: ColleaguePhase;
  onArrive?: () => void;
  /**
   * Whether the player has actually dealt with the incident.
   *
   * Read from the case, not from a clock — `Office` derives it from the
   * containment actions on the machine's context. While it is false she stays
   * urgent however long she has been standing there, which is the behaviour the
   * contract asks for: she does not relax before the player solves it.
   */
  caseResolved?: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const elapsedRef = useRef(0);
  const settledRef = useRef(0);
  const arrivedRef = useRef(false);
  /**
   * Her current position between urgent (0) and relieved (1).
   *
   * Eased toward `caseResolved` rather than set from it, so the change reads as
   * someone letting a breath out rather than as a pose swap.
   */
  const reliefRef = useRef(caseResolved ? 1 : 0);

  const gltf = useLoader(GLTFLoader, CHARACTER_FILES.colleague);

  const curve = useMemo(
    () =>
      new THREE.CatmullRomCurve3(
        COLLEAGUE_PATH.map((point) => new THREE.Vector3(...point)),
        false,
        'catmullrom',
        0.4,
      ),
    [],
  );


  /**
   * One prepared instance: cloned so the loader cache is never mutated,
   * recoloured to the scene palette, and scaled to a real human height with
   * its feet on the floor.
   */
  const rig = useMemo(() => {
    const root = cloneSkeleton(gltf.scene) as THREE.Group;
    const owned: THREE.Material[] = [];

    root.traverse((object) => {
      if (!(object as THREE.Mesh).isMesh) return;
      const mesh = object as THREE.Mesh;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      // Skinned meshes are culled against their bind-pose bounds, which the
      // walk animation leaves behind; without this she vanishes mid-stride.
      mesh.frustumCulled = false;

      const source = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const replaced = source.map((material) => {
        const name = (material as THREE.Material).name;
        const next = new THREE.MeshStandardMaterial({
          name,
          color: new THREE.Color(CHARACTER_PALETTE[name] ?? PALETTE.cloth),
          roughness: name === 'Skin' || name === 'Face' ? 0.78 : 0.94,
          metalness: 0,
        });
        owned.push(next);
        return next;
      });
      mesh.material = replaced.length === 1 ? replaced[0]! : replaced;
    });

    // Fit to human scale with the feet on y = 0, whatever unit the pack used.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const fit = size.y > 0 ? COLLEAGUE_HEIGHT / size.y : 1;
    const centre = box.getCenter(new THREE.Vector3());

    const inner = new THREE.Group();
    root.position.set(-centre.x * fit, -box.min.y * fit, -centre.z * fit);
    root.scale.setScalar(fit);
    inner.add(root);

    /**
     * Finds a bone by its name in the source file.
     *
     * The fallback is not defensive padding — it is required, and its absence
     * was a silent bug. `GLTFLoader` runs every node name through
     * `PropertyBinding.sanitizeNodeName`, which *deletes* dots: the pack's
     * `Shoulder.R` is called `ShoulderR` by the time the scene exists. Three of
     * the six bones this component reaches for are dotted, so `getObjectByName`
     * returned `undefined` for the entire right arm, `applyPosture` skipped
     * every arm branch, and the "point at the monitor" beat the audit asks for
     * has never once played. Nothing failed; the gesture simply did not happen.
     */
    const bone = (name: string) =>
      (root.getObjectByName(name) ??
        root.getObjectByName(name.replace(/\./g, ''))) as THREE.Bone | undefined;

    const bones = {
      torso: bone('Torso'),
      neck: bone('Neck'),
      head: bone('Head'),
      shoulder: bone('Shoulder.R'),
      upperArm: bone('UpperArm.R'),
      lowerArm: bone('LowerArm.R'),
    };

    /*
     * The rest rotation of every bone the additive layer touches.
     *
     * `applyPosture` multiplies an offset onto whatever the mixer has just
     * written, which is correct only for bones the running clip actually
     * animates: for those, the mixer overwrites the bone every frame and the
     * multiply is a clean one-frame offset. A bone the clip does *not* animate
     * is never overwritten, so the same multiply lands on last frame's result
     * and compounds — sixty times a second, without bound.
     *
     * That is not hypothetical. It is what put a folded, unrecognisable figure
     * in `docs/screenshots/visual-after-*-06-companion-present.png` on the
     * first pass of this staging work — that capture keeps its old filename
     * because it genuinely shows what the room held when it was taken, and
     * the spec now writes the same frame as `06-briefing-choice`. Her hair
     * mass measured 1.2 m across in world units, because her upper body had
     * been rotated through several turns. It was invisible before only
     * because she stood in the dark.
     */
    const rest = new Map<THREE.Bone, THREE.Quaternion>();
    for (const joint of Object.values(bones)) {
      if (joint) rest.set(joint, joint.quaternion.clone());
    }

    return { object: inner, owned, bones, rest };
  }, [gltf]);

  const mixer = useMemo(() => new THREE.AnimationMixer(rig.object), [rig]);

  const actions = useMemo(() => {
    const find = (name: string) => THREE.AnimationClip.findByName(gltf.animations, name);
    const idleClip = find(COLLEAGUE_CLIPS.idle);
    const walkClip = find(COLLEAGUE_CLIPS.walk);
    return {
      idle: idleClip ? mixer.clipAction(idleClip) : null,
      walk: walkClip ? mixer.clipAction(walkClip) : null,
    };
  }, [gltf, mixer]);

  /**
   * Which bone rotations the shipped clips actually drive.
   *
   * Resolved with `THREE.PropertyBinding.parseTrackName`, which is the same
   * function the mixer itself uses to decide what a track points at. Doing this
   * by hand — splitting on a trailing `.quaternion` — is what a first attempt
   * did, and it is wrong for every exporter that emits a path rather than a
   * bare node name (`Armature/Torso.quaternion`). The failure is not subtle
   * once seen and completely silent until then: every targeted bone falls out
   * of the set, the reset below fires on all of them, and the character stands
   * in her bind pose with her arms straight out.
   */
  const animatedBones = useMemo(() => {
    const names = new Set<string>();
    for (const clip of gltf.animations) {
      for (const track of clip.tracks) {
        const parsed = THREE.PropertyBinding.parseTrackName(track.name);
        if (parsed.propertyName === 'quaternion' && parsed.nodeName) {
          names.add(parsed.nodeName);
        }
      }
    }
    return names;
  }, [gltf]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      for (const material of rig.owned) material.dispose();
    },
    [mixer, rig],
  );

  /*
   * Publish a read-only view of the skeleton for `characters.spec.ts`.
   *
   * Reports live objects rather than a copy, so a test reads the pose of the
   * frame it asks on. Cleared on unmount, so a stale rig can never be measured
   * after she has left the stage.
   */
  const postureOffsets = useMemo(() => new Map<string, number>(), []);
  /**
   * The pose each posture bone holds before the additive layer touches it.
   *
   * Owned here rather than derived, because it is the single thing that makes
   * that layer an offset rather than an accumulation.
   */
  const baseline = useMemo(() => new Map<THREE.Bone, THREE.Quaternion>(), []);

  useEffect(() => {
    publishCharacterSampler(() => {
      const group = groupRef.current;
      if (!group) return null;
      return { offsets: postureOffsets, root: group.position, skeleton: rig.object };
    });
    return () => publishCharacterSampler(null);
  }, [postureOffsets, rig]);

  /**
   * Returning from the dashboard mounts her straight into `settled`, and the
   * contract is explicit that the return must not replay the arrival. Starting
   * the beat clock past the point gesture lands her already relieved.
   */
  const enteredFromWalk = useRef(phase === 'entering');
  useEffect(() => {
    if (phase === 'entering') enteredFromWalk.current = true;
  }, [phase]);

  // Cross-fade on every phase change, so the walk resolves into the idle
  // instead of popping.
  useEffect(() => {
    const { idle, walk } = actions;
    if (phase === 'hidden') {
      mixer.stopAllAction();
      return;
    }
    if (phase === 'entering') {
      settledRef.current = 0;
      idle?.stop();
      walk?.reset().setEffectiveWeight(1).play();
      return;
    }
    if (!enteredFromWalk.current) {
      /*
       * A return from the dashboard, which must not replay the arrival: park
       * the beat clock past the point gesture so the arm stays down.
       *
       * Her *mood* is deliberately not parked with it. On the old build this
       * same line also made her relieved, because relief was a function of this
       * clock — so a player who bounced to the dashboard and straight back
       * found her calm about an incident nobody had touched. Relief now comes
       * from `caseResolved`, and the two paths stay separate.
       */
      settledRef.current = POINT_END;
      reliefRef.current = caseResolved ? 1 : 0;
    }
    if (!idle) return;
    idle.reset().setEffectiveWeight(1).play();
    if (walk?.isRunning()) walk.crossFadeTo(idle, 0.45, false);
    else walk?.stop();
    // `caseResolved` is read for the mount-time seed only; re-running this
    // effect when the case changes would restart her idle mid-report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, actions, mixer]);

  /**
   * The entrance still has to complete when no frames run — reduced motion, a
   * hidden tab, a 2D fallback swapping in. The machine carries its own 4500 ms
   * safety net; this fires first so the story keeps its intended rhythm.
   */
  useEffect(() => {
    if (phase !== 'entering' || arrivedRef.current) return;
    const id = window.setTimeout(() => {
      if (!arrivedRef.current) {
        arrivedRef.current = true;
        onArrive?.();
      }
    }, WALK_DURATION * 1000 + 300);
    return () => window.clearTimeout(id);
  }, [phase, onArrive]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group || phase === 'hidden') return;

    /*
     * Undo last frame's additive layer before the mixer runs.
     *
     * `applyPosture` multiplies a small offset onto each posture bone, and the
     * comment below assumes the mixer overwrites those bones every frame, which
     * makes that multiply a clean one-frame offset. Where the assumption holds,
     * restoring the baseline first is simply redundant.
     *
     * Where it does not hold, the same multiply lands on its own previous
     * result and compounds at frame rate. Measured on the real GPU: the
     * per-frame offset stayed a constant 0.237 rad on the torso while the
     * head's height above the hips swept from 0.68 m down to 0.013 m and back
     * again -- 599 anomalous frames out of 961, which is a person folding
     * double and unfolding, over and over. Disabling the layer alone took that
     * to 0 of 961, which is how it was identified.
     *
     * So the baseline is restored explicitly rather than assumed. If the mixer
     * writes, this is overwritten one line later at the cost of six quaternion
     * copies. If it does not, the bone starts from the last clean pose instead
     * of from our own output, and nothing can accumulate.
     */
    for (const [joint, base] of baseline) joint.quaternion.copy(base);

    // The mixer writes absolute bone rotations. Everything below layers on top
    // of what it just wrote, in the same callback, or it would be overwritten.
    mixer.update(delta);

    // The clean pose for the next frame: the mixer's, if it wrote; otherwise
    // exactly what was restored above.
    for (const joint of rig.rest.keys()) {
      const base = baseline.get(joint);
      if (base) base.copy(joint.quaternion);
      else baseline.set(joint, joint.quaternion.clone());
    }

    if (phase === 'entering') {
      elapsedRef.current += delta;
      const progress = Math.min(1, elapsedRef.current / WALK_DURATION);
      const eased = 1 - (1 - progress) ** 2.2;
      const point = curve.getPointAt(eased);
      group.position.set(point.x, 0, point.z);

      if (progress < 1) {
        const ahead = curve.getPointAt(Math.min(1, eased + 0.02));
        group.rotation.y = Math.atan2(ahead.x - point.x, ahead.z - point.z);
      } else {
        group.rotation.y += (settleFacing() - group.rotation.y) * Math.min(1, delta * 3);
        if (!arrivedRef.current) {
          arrivedRef.current = true;
          onArrive?.();
        }
      }

      // Walking pace: the clip carries the stride, the curve carries the ground.
      if (actions.walk) actions.walk.timeScale = 1.05;
      return;
    }

    settledRef.current += delta;
    const elapsed = settledRef.current;

    /*
     * Ease toward whatever the case says, every frame. Nothing here can reach
     * relief while the incident is open, which is the entire fix.
     */
    const target = caseResolved ? 1 : 0;
    reliefRef.current += (target - reliefRef.current) * (1 - Math.exp(-RELIEF_RATE * Math.max(0, delta)));
    if (Math.abs(target - reliefRef.current) < 0.002) reliefRef.current = target;
    const relief = reliefRef.current;

    const point = pointWeight(elapsed);

    const end = curve.getPointAt(1);
    group.position.set(end.x, 0, end.z);
    group.rotation.y = settleFacing();

    // Timing carries the emotion as much as posture: she breathes fast on
    // arrival and long once the room has calmed.
    if (actions.idle) {
      actions.idle.timeScale = IDLE_RATE_URGENT + (IDLE_RATE_RELIEVED - IDLE_RATE_URGENT) * relief;
    }

    /*
     * Reset every bone the clips do not drive, so the additive layer below is
     * an offset from rest rather than from its own previous frame.
     *
     * The guard is deliberate. If the name resolution above ever comes back
     * empty — a different exporter, a renamed rig — resetting on that basis
     * would put the character in her bind pose, which is a far worse failure
     * than the slow drift this loop exists to prevent. An empty set means
     * "we could not tell", and the safe answer to that is to touch nothing.
     */
    if (animatedBones.size > 0) {
      for (const [joint, quaternion] of rig.rest) {
        if (!animatedBones.has(joint.name)) joint.quaternion.copy(quaternion);
      }
    }

    applyPosture(rig.bones, {
      elapsed,
      urgency: 1 - relief,
      point,
    });

    for (const [joint, base] of baseline) {
      postureOffsets.set(joint.name, joint.quaternion.angleTo(base));
    }


  });

  if (phase === 'hidden') return null;

  const start = COLLEAGUE_PATH[0]!;
  const end = COLLEAGUE_PATH[COLLEAGUE_PATH.length - 1]!;
  const mounted = phase === 'entering' ? start : end;

  return (
    <group
      ref={groupRef}
      position={mounted}
      rotation={[0, phase === 'entering' ? 0 : settleFacing(), 0]}
    >
      <primitive object={rig.object} />
    </group>
  );
}

/**
 * Facing at the settle point: turned to the operator, not to the wall.
 *
 * The seat position is read from `layout.ts` rather than inlined. It used to be
 * a literal `0.8` here and again in the deleted second character's component,
 * which meant moving the chair would quietly have left both of the characters
 * there at the time addressing empty air. One of them is gone; reading the
 * shared constant is why the one who remains still faces the operator.
 */
function settleFacing(): number {
  const end = COLLEAGUE_PATH[COLLEAGUE_PATH.length - 1]!;
  return Math.atan2(-end[0], SEAT_Z - end[2]);
}

interface Bones {
  torso?: THREE.Bone;
  neck?: THREE.Bone;
  head?: THREE.Bone;
  shoulder?: THREE.Bone;
  upperArm?: THREE.Bone;
  lowerArm?: THREE.Bone;
}

const scratch = {
  quat: new THREE.Quaternion(),
  parent: new THREE.Quaternion(),
  world: new THREE.Quaternion(),
  origin: new THREE.Vector3(),
  direction: new THREE.Vector3(),
};

/**
 * Layers the authored beats onto whatever the mixer just wrote.
 *
 * Blender exports bones with their length along local +Y, so a rotation about
 * a bone's own Y is a twist and about its own X is a bend — which is why every
 * offset here is a plain local-axis multiply on a bone the clip already drives.
 * That is what keeps the chain resolving to a person: a world-space aim solved
 * back through the parent, which the removed point gesture used, swung the arms
 * out and broke the silhouette.
 */
function applyPosture(
  bones: Bones,
  { elapsed, urgency, point }: {
    elapsed: number;
    urgency: number;
    point: number;
  },
) {
  /*
   * Breath, and the audit's "out of breath / urgent report" beat.
   *
   * Every amplitude below is roughly doubled from the previous pass, and the
   * reason is measurement rather than taste: at 2.65 m the whole figure was
   * about 190 px tall in the office viewport, so a 0.16 rad lean moved her
   * shoulders by three pixels and the beat was invisible. She stands at 2.36 m
   * now and is lit, which makes the posture legible — but only if there is
   * posture to see. These stay inside the bounds the contract asks for: they
   * are an additive layer on the real `Idle` clip, they never drive a joint
   * past a pose a person holds, and they resolve to zero as she calms.
   */
  const rate = 2.2 - 1.2 * (1 - urgency);
  const breath = Math.sin(elapsed * rate) * (0.014 + 0.03 * urgency);
  /* A second, slower term, so the chest does not tick like a metronome. */
  const settleSway = Math.sin(elapsed * 0.62) * 0.02;

  if (bones.torso) {
    /*
     * Forward lean while urgent, released as she relaxes: she has come in at a
     * half-run to say something, and she leans in to say it.
     *
     * 0.18 rad, not the 0.3 this pass first tried. Ten degrees of extra spine
     * is not a stronger performance at this distance — it folds her over the
     * desk and drops her head 15 cm, out of the band of frame she was staged
     * into. The neck and head terms are scaled to match, so the chain still
     * resolves to a person looking at the operator rather than at the floor.
     */
    bones.torso.quaternion.multiply(
      scratch.quat.setFromAxisAngle(RIGHT, 0.18 * urgency + breath + settleSway * 0.4),
    );
    // A slight turn of the shoulders toward the desk she is reporting about.
    bones.torso.quaternion.multiply(
      scratch.quat.setFromAxisAngle(UP, -0.08 * urgency - 0.16 * point),
    );
  }

  if (bones.neck) {
    // Counter-rotates most of the lean, which is what keeps her eyeline up.
    bones.neck.quaternion.multiply(
      scratch.quat.setFromAxisAngle(RIGHT, -0.13 * urgency - breath * 0.6),
    );
  }

  if (bones.head) {
    // She looks at the monitor while pointing, then back at the operator.
    bones.head.quaternion.multiply(scratch.quat.setFromAxisAngle(UP, -0.45 * point));
    bones.head.quaternion.multiply(
      scratch.quat.setFromAxisAngle(RIGHT, -0.05 * urgency + breath * 0.4),
    );
  }

  /*
   * The point.
   *
   * Every term is scaled by `point`, which runs 0 → 1 → 0 across the beat, so
   * the arm rises, holds and comes back down, and outside the beat this whole
   * block is arithmetically the identity. That is what makes it safe to layer
   * on a clip: at `point === 0` the bones are left exactly as the mixer wrote
   * them.
   */
  if (bones.shoulder) {
    // The shoulder itself lifts a little, so the arm does not appear to hinge
    // out of a fixed socket.
    bones.shoulder.quaternion.multiply(
      scratch.quat.setFromAxisAngle(RIGHT, -0.26 * point + 0.12 * urgency),
    );
  }

  if (bones.upperArm) {
    bones.upperArm.quaternion.multiply(
      scratch.quat.setFromAxisAngle(RIGHT, POINT_POSE.lift * point),
    );
    bones.upperArm.quaternion.multiply(
      scratch.quat.setFromAxisAngle(FORWARD, POINT_POSE.swing * point),
    );
    bones.upperArm.quaternion.multiply(
      scratch.quat.setFromAxisAngle(UP, POINT_POSE.twist * point),
    );
  }

  if (bones.lowerArm) {
    bones.lowerArm.quaternion.multiply(
      scratch.quat.setFromAxisAngle(RIGHT, POINT_POSE.elbow * point),
    );
  }
}

export const COLLEAGUE_WALK_DURATION = WALK_DURATION;

/**
 * How long the pointing beat lasts after she settles, in seconds.
 *
 * Exported for `characters.spec.ts`. The gesture drives her upper arm through
 * `POINT_POSE.lift` — 2.45 radians — which is a deliberate, bounded offset and
 * looks exactly like runaway accumulation to a test that samples the posture
 * layer while it is running. The accumulation test needs to know when the
 * gesture is over so it can hold the standing pose to the tight bound and the
 * gesture to its own.
 */
export const COLLEAGUE_POINT_END = POINT_END;

/** The largest offset the pointing beat is allowed to apply, in radians. */
export const COLLEAGUE_POINT_MAX_OFFSET =
  Math.max(
    Math.abs(POINT_POSE.lift),
    Math.abs(POINT_POSE.swing),
    Math.abs(POINT_POSE.twist),
    Math.abs(POINT_POSE.elbow),
  ) + 0.2;
