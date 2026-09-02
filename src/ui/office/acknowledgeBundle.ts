/**
 * What acknowledging the alarm feels like, as a timeline.
 *
 * Pressing the acknowledge control used to do exactly one thing: flip a
 * boolean. The border class came off, the room's spill light was set to zero on
 * the next frame, and the loudest object in the scene vanished between two
 * frames with nothing to say it had been the player who did it. A cut is not
 * feedback — it reads as the alarm having been wrong rather than as having been
 * handled.
 *
 * Three beats, in order, and all three are short:
 *
 *   press        the control acknowledges the press itself, immediately;
 *   settling     the spill light falls rather than disappearing;
 *   acknowledged a brief, explicit "you did that" before the room goes normal.
 *
 * Pure, so the budgets are assertions rather than intentions. No screen shake
 * and no input block anywhere in it: every one of these beats is a change in
 * brightness or a label, the room stays clickable throughout, and nothing here
 * takes the keyboard.
 */

/** Press affordance. The contract is "≤100 ms", so this is what it must beat. */
export const ACK_PRESS_MS = 90;

/** Spill decay. The contract's window is 150–220 ms; this sits in the middle. */
export const ACK_SPILL_DECAY_MS = 185;

/**
 * The short acknowledged state. Contract window 600–900 ms.
 *
 * 700 rather than the middle of it, so the whole bundle — press, settle and
 * hold — finishes inside a second. The alarm is acknowledged and the room is
 * normal again before the colleague's entrance begins, which is what keeps the
 * two beats from reading as one long wait.
 */
export const ACK_HOLD_MS = 700;

export const ACK_SETTLE_END_MS = ACK_PRESS_MS + ACK_SPILL_DECAY_MS;
export const ACK_TOTAL_MS = ACK_SETTLE_END_MS + ACK_HOLD_MS;

export type AckStage = 'idle' | 'pressed' | 'settling' | 'acknowledged';

/**
 * Which beat the bundle is on, `elapsed` ms after the press.
 *
 * `idle` before it starts and after it ends, which is the same answer for two
 * different reasons and deliberately so: nothing downstream should have to know
 * whether the alarm has never sounded or has been dealt with.
 */
export function ackStageAt(elapsedMs: number): AckStage {
  if (elapsedMs < 0) return 'idle';
  if (elapsedMs < ACK_PRESS_MS) return 'pressed';
  if (elapsedMs < ACK_SETTLE_END_MS) return 'settling';
  if (elapsedMs < ACK_TOTAL_MS) return 'acknowledged';
  return 'idle';
}

/**
 * How much of the alarm's spill light is still lit, from 1 to 0.
 *
 * Held through the press beat — the light does not start dying before the
 * player has seen their own press land — then eased out across the decay. Cubic
 * ease-out rather than linear: a filament and a phosphor both fall fast and
 * then linger, and a linear ramp reads as a dimmer switch being turned.
 */
export function ackSpillFactor(elapsedMs: number, reducedMotion = false): number {
  if (elapsedMs < 0) return 1;
  // No motion means no ramp. The light is on, and then it is not.
  if (reducedMotion) return 0;
  if (elapsedMs < ACK_PRESS_MS) return 1;
  if (elapsedMs >= ACK_SETTLE_END_MS) return 0;

  const t = (elapsedMs - ACK_PRESS_MS) / ACK_SPILL_DECAY_MS;
  return (1 - t) ** 3;
}

/** True while the bundle still has something to draw. */
export function ackIsRunning(elapsedMs: number): boolean {
  return elapsedMs >= 0 && elapsedMs < ACK_TOTAL_MS;
}
