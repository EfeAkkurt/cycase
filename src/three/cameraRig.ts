/**
 * The seated camera rig.
 *
 * Head-look, not free movement (audit P0.1): the operator stays in the chair
 * and turns their head. The rig is a tiny store outside React so that the
 * WebGL camera, the DOM monitor projection and any scripted glance all read
 * the same yaw/pitch — per frame, without a React render in the loop.
 *
 * Clamps are the contract's: ±55° yaw, +25°/−20° pitch. The doorway, both
 * side walls and the racks are all inside that cone.
 */

export const YAW_LIMIT = (55 * Math.PI) / 180;
export const PITCH_UP_LIMIT = (25 * Math.PI) / 180;
export const PITCH_DOWN_LIMIT = (20 * Math.PI) / 180;

/**
 * How fast an eased glance closes on its target.
 *
 * Applied as `1 - e^(-rate * dt)`, not `rate * dt`: an exponential decay is
 * frame-rate independent, so the same glance takes the same wall-clock time on
 * a 60 Hz laptop and inside a stepped test, and a long frame can never
 * overshoot.
 */
const EASE_RATE = 4.2;
/** Below this remaining error the rig snaps and reports settled. */
const SETTLE_EPSILON = 0.0008;

export interface RigState {
  yaw: number;
  pitch: number;
  /** True while easing toward a scripted target or gliding after input. */
  moving: boolean;
}

type Listener = (state: RigState) => void;

class CameraRig {
  private yaw = 0;
  private pitch = 0;
  private targetYaw = 0;
  private targetPitch = 0;
  /** Instant mode: reduced motion tracks the target without inertia. */
  private instant = false;
  private listeners = new Set<Listener>();

  get state(): RigState {
    return { yaw: this.yaw, pitch: this.pitch, moving: this.moving };
  }

  get moving(): boolean {
    return (
      Math.abs(this.targetYaw - this.yaw) > SETTLE_EPSILON ||
      Math.abs(this.targetPitch - this.pitch) > SETTLE_EPSILON
    );
  }

  setInstant(instant: boolean): void {
    this.instant = instant;
  }

  /** Nudge the target by a delta (drag, keys, mouse look). */
  lookBy(deltaYaw: number, deltaPitch: number): void {
    this.lookAt(this.targetYaw + deltaYaw, this.targetPitch + deltaPitch);
  }

  /** Ease toward an absolute orientation (scripted glances, recenter). */
  lookAt(yaw: number, pitch: number): void {
    this.targetYaw = clamp(yaw, -YAW_LIMIT, YAW_LIMIT);
    this.targetPitch = clamp(pitch, -PITCH_DOWN_LIMIT, PITCH_UP_LIMIT);
    if (this.instant) {
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
    }
    this.emit();
  }

  recenter(): void {
    this.lookAt(0, 0);
  }

  /** Advance the easing. Returns true while still moving. */
  update(deltaSeconds: number): boolean {
    if (!this.moving) return false;

    const factor = this.instant
      ? 1
      : 1 - Math.exp(-EASE_RATE * Math.max(0, deltaSeconds));
    this.yaw += (this.targetYaw - this.yaw) * factor;
    this.pitch += (this.targetPitch - this.pitch) * factor;

    if (!this.moving) {
      this.yaw = this.targetYaw;
      this.pitch = this.targetPitch;
    }

    this.emit();
    return this.moving;
  }

  /** Reset to centre without animation — scene teardown, restart. */
  reset(): void {
    this.yaw = 0;
    this.pitch = 0;
    this.targetYaw = 0;
    this.targetPitch = 0;
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.state;
    for (const listener of this.listeners) listener(snapshot);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** One rig per page — the office is a single seat. */
export const cameraRig = new CameraRig();
