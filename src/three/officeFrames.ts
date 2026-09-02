/**
 * How hard the room has to be drawn, as a pure function of what is moving.
 *
 * The office runs `frameloop="demand"`: nothing is drawn until something asks
 * for it. That is right for an empty room and wrong for a pulsing alarm, and
 * the driver used to make the distinction on the colleague's walk alone — so
 * while the alarm was the only thing happening in the room, its rim and spill
 * were being redrawn on a 100 ms timer. A 1.6 s cosine sampled ten times a
 * second is a staircase, and it was sitting next to a DOM border animating at
 * the display's rate. Half of "the alarm reads as two rhythms" was this.
 *
 * Kept pure and separate from the component so the policy can be asserted
 * without a GPU. Frame *cadence* is meaningless on a software rasteriser — the
 * Playwright config says so itself and moves the 3D specs to a real GPU — but
 * the policy that decides the cadence is ordinary logic, and it is where the
 * defect actually lived.
 */

export type FrameMode =
  /** Every display frame. Something is animating that the eye tracks. */
  | 'continuous'
  /** Ambient only: invalidate on a slow timer. */
  | 'ambient'
  /** Nothing moves. One frame, then stop. */
  | 'static';

/** The contract: while the alarm or the colleague is active, this or better. */
export const CONTINUOUS_MAX_INTERVAL_MS = 33;

/** Ambient cadence when the room is idle. §7: 5–10 FPS, not 60. */
export const AMBIENT_INTERVAL_MS = 100;

export interface OfficeMotion {
  /** The alarm is unacknowledged, so the rim and the spill are pulsing. */
  alarm: boolean;
  /** The colleague is walking in — the most demanding thing the room does. */
  entering: boolean;
  /** She is in the room at all, so her idle motion is running. */
  colleagueVisible: boolean;
  reducedMotion: boolean;
}

export function officeFrameMode(motion: OfficeMotion): FrameMode {
  /*
   * Reduced motion first, and it wins over everything.
   *
   * A player who has asked for no motion is not asking for a slower pulse; the
   * alarm holds at its midpoint and the room is drawn once. `alarmPhase` returns
   * the held value in the same condition, so the two agree by construction.
   */
  if (motion.reducedMotion) return 'static';

  if (motion.entering || motion.alarm || motion.colleagueVisible) return 'continuous';
  return 'ambient';
}

/** The invalidation interval a mode implies, for the driver and for its test. */
export function frameIntervalMs(mode: FrameMode): number {
  if (mode === 'continuous') return CONTINUOUS_MAX_INTERVAL_MS;
  if (mode === 'ambient') return AMBIENT_INTERVAL_MS;
  return Infinity;
}
