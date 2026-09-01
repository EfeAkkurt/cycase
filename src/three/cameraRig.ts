/**
 * The seated camera rig.
 *
 * Head-look, not free movement (audit P0.1): the operator stays in the chair
 * and turns their head. The rig is a tiny store outside React so that the
 * WebGL camera, the DOM monitor projection and any scripted glance all read
 * the same yaw/pitch — per frame, without a React render in the loop.
 *
 * ## The cone, and why it is wider than the audit's
 *
 * It was ±55° yaw and +25°/−20° pitch, which is the range of a head turning on
 * a fixed neck. That is not the range of a person in an office chair, and the
 * difference mattered: at 55° the side walls are still at the edge of the
 * picture and the room behind the seat has never been on screen at all, so
 * "look around the office" resolved to "look slightly to one side of your
 * monitors". The cone below is a chair swivel — 120° either way reaches both
 * side walls square-on and brings the back of the room into frame, which is
 * what makes the set dressing behind the operator worth having.
 *
 * Two things this deliberately does **not** change, because both would move the
 * monitor overlay:
 *
 * - `CAMERA.fov` in `layout.ts`. The horizontal field is already 92.7° at
 *   1440x900 and 104.5° at 1280x720; widening it further would distort the
 *   frame and re-scale every projected DOM surface. The cone is a clamp on
 *   where the camera may point, not on how much it sees at once.
 * - The projection itself. `computeMonitorPlacements` is a pure function of
 *   size and pose, so at yaw 0 it returns exactly what it returned before —
 *   the 2 px drift budget is untouched by this file.
 */

export const YAW_LIMIT = (120 * Math.PI) / 180;
export const PITCH_UP_LIMIT = (32 * Math.PI) / 180;
export const PITCH_DOWN_LIMIT = (38 * Math.PI) / 180;

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

  /**
   * Pulls the current pose back inside the clamps.
   *
   * Needed because the rig outlives the thing that moved it. The office
   * unmounts and remounts on a 3D toggle and on a viewport crossing the 3D
   * threshold, and a build that narrows the cone would otherwise leave a
   * remounted scene pointing somewhere the clamps no longer allow — visible as
   * a room that opens facing a wall. Cheap, idempotent, and safe to call on
   * every mount.
   */
  clampToLimits(): void {
    this.lookAt(this.targetYaw, this.targetPitch);
    this.yaw = clamp(this.yaw, -YAW_LIMIT, YAW_LIMIT);
    this.pitch = clamp(this.pitch, -PITCH_DOWN_LIMIT, PITCH_UP_LIMIT);
    this.emit();
  }

  /**
   * True when the pose is centred and at rest.
   *
   * The office asks this before deciding whether a remount needs to recentre
   * the view at all, so that a return from the dashboard — which mounts already
   * centred — does not emit a redundant glance.
   */
  get centred(): boolean {
    return (
      Math.abs(this.yaw) <= SETTLE_EPSILON &&
      Math.abs(this.pitch) <= SETTLE_EPSILON &&
      !this.moving
    );
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
