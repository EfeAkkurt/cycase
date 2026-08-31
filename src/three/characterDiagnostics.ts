import * as THREE from 'three';

/** Reused so a per-frame poll does not allocate a vector per bone. */
const scratch = new THREE.Vector3();

/**
 * A read-only window onto the colleague's skeleton, for tests.
 *
 * Published on `window.__CYCASE_CHARACTER__`, the same way `diagnostics.ts`
 * publishes `__CYCASE_AUDIO__`. Strictly a reporter: it can measure the rig and
 * it cannot pose it, move it, or touch case state.
 *
 * It exists because of a specific defect and the shape of that defect matters.
 * The additive posture layer in `Colleague.tsx` multiplies a small offset onto
 * whatever the animation mixer has just written. That is a clean one-frame
 * offset for a bone the running clip animates, because the mixer overwrites the
 * bone first — and it compounds without bound for a bone the mixer is not
 * writing, sixty times a second, until the character is rotated through whole
 * turns. On screen that reads as her tipping over and her torso spinning, and
 * it was reported by a player before any test caught it.
 *
 * Every existing character test measures pixels: is she visible, does she
 * overlap a monitor, is her patch lit. None of them could see this, because a
 * figure rotated through two turns still lights the same pixels. So the
 * invariant is measured where it actually lives — as the angle between what
 * the mixer wrote and what the posture layer left behind, which is small and
 * steady if the layer is an offset and grows without bound if it is not.
 */

export interface BoneDeviation {
  /** Bone name as the loader sanitised it, e.g. `ShoulderR`. */
  name: string;
  /**
   * How far the additive layer moved this bone *this frame*, in radians.
   *
   * Measured between the rotation the mixer wrote and the rotation left after
   * `applyPosture`, which is the only quantity that separates the two cases.
   * Distance from the bind pose was tried first and is useless here: the Idle
   * clip legitimately poses a shoulder a radian away from bind, so a healthy
   * rig and a broken one both read about 1.7.
   */
  radians: number;
}

/** A bone's world position, for anatomical sanity checks. */
export interface BonePlacement {
  name: string;
  world: [number, number, number];
}

export interface CharacterDiagnostics {
  /**
   * The additive offset applied to each posture bone on the last rendered
   * frame.
   *
   * Returns an empty array when she is not on stage, which a caller must treat
   * as "no measurement" rather than "no deviation".
   */
  boneDeviation: () => BoneDeviation[];
  /** The largest of those, or 0 when she is not on stage. */
  worstDeviation: () => number;
  /** World-space position of the rig root, for the feet-on-the-floor check. */
  rootPosition: () => [number, number, number] | null;
  /**
   * Where every bone in the skeleton actually is, in world space.
   *
   * The offset measurement above proves the additive layer is well behaved. It
   * cannot prove the *skeleton* is: a mis-bound mixer, a clip driving the wrong
   * node, or a bad clone all leave the offsets tiny while putting a forearm two
   * metres from its shoulder. This is what a person means by "her bones are
   * deformed", so it is what gets measured.
   */
  bonePlacements: () => BonePlacement[];
}

type Sampler = () => {
  /** Bone name to the angle the additive layer applied on the last frame. */
  offsets: Map<string, number>;
  root: THREE.Vector3;
  /** Every bone in the rig, for the world-space placement report. */
  skeleton: THREE.Object3D;
} | null;

let sampler: Sampler = () => null;

/** Called by `Colleague` on mount; passing `null` clears it on unmount. */
export function publishCharacterSampler(next: Sampler | null): void {
  sampler = next ?? (() => null);
}

function deviations(): BoneDeviation[] {
  const sample = sampler();
  if (!sample) return [];
  return [...sample.offsets].map(([name, radians]) => ({ name, radians }));
}

function placements(): BonePlacement[] {
  const sample = sampler();
  if (!sample) return [];

  const out: BonePlacement[] = [];
  sample.skeleton.updateWorldMatrix(true, true);
  sample.skeleton.traverse((node) => {
    if (!(node as { isBone?: boolean }).isBone) return;
    const p = node.getWorldPosition(scratch);
    out.push({ name: node.name, world: [p.x, p.y, p.z] });
  });
  return out;
}

export const characterDiagnostics: CharacterDiagnostics = {
  boneDeviation: deviations,
  worstDeviation: () => deviations().reduce((worst, bone) => Math.max(worst, bone.radians), 0),
  rootPosition: () => {
    const sample = sampler();
    return sample ? [sample.root.x, sample.root.y, sample.root.z] : null;
  },
  bonePlacements: placements,
};

declare global {
  interface Window {
    __CYCASE_CHARACTER__?: CharacterDiagnostics;
  }
}

if (typeof window !== 'undefined') {
  window.__CYCASE_CHARACTER__ = characterDiagnostics;
}
