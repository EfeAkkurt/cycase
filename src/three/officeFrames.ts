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
  /**
   * Her pointing beat is running: a scripted arm movement the eye follows.
   *
   * Distinct from merely being in the room. `colleagueVisible` used to force
   * continuous frames, and because she never leaves, the office rendered at
   * display rate for the entire time a player spent in it — the ambient budget
   * in PROJECT_CONTEXT.md §7 was unreachable in the played flow, and the guard
   * that exists to notice that had nowhere left to measure. What the eye
   * actually tracks is the walk and the gesture, both of which end.
   */
  gesturing: boolean;
  /** She is in the room at all. On its own this is NOT a reason to draw hard. */
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

  /*
   * Continuous for real movement only: the walk, the gesture, the pulsing
   * alarm. Camera movement is not listed because it does not go through this
   * policy at all — `HeadLookDriver` invalidates directly for as long as the
   * rig reports motion, which is the right shape for something driven by input
   * rather than by a beat.
   */
  if (motion.entering || motion.alarm || motion.gesturing) return 'continuous';

  /*
   * A settled colleague standing in a quiet room is ambient. Her idle is
   * breathing amplitude on a background figure, which a 10 Hz pump carries;
   * the alarm was the case where it visibly could not, and the alarm is above.
   */
  return 'ambient';
}

/** The invalidation interval a mode implies, for the driver and for its test. */
export function frameIntervalMs(mode: FrameMode): number {
  if (mode === 'continuous') return CONTINUOUS_MAX_INTERVAL_MS;
  if (mode === 'ambient') return AMBIENT_INTERVAL_MS;
  return Infinity;
}
