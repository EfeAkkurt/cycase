/**
 * One clock for every surface that shows the alarm.
 *
 * The alarm is drawn three times over — a DOM border on the projected monitor
 * surface, an emissive rim and spill light inside the WebGL room, and a held
 * state for reduced motion — and until now each one kept its own time. The DOM
 * ran a 1.6 s CSS keyframe whose phase started whenever the element mounted;
 * the room ran a 1.15 s cosine off the r3f clock, which starts when the canvas
 * does. Different period, different origin, and both on screen at once, because
 * `.office3d__surface--alarm` is a DOM overlay sitting on top of the room it
 * disagrees with. What a player saw was two alarms beating against each other.
 *
 * Everything here is a pure function of an absolute timestamp, and that is what
 * makes one rhythm possible without any of the surfaces talking to each other:
 *
 *   phase(t) = 0.5 − 0.5·cos(2π · (t mod P) / P)
 *
 * `performance.now()` and the document timeline share a time origin, so a CSS
 * animation given `animation-delay: -(t mod P)` at the moment it is applied is
 * running at exactly the phase this function reports for the same `t`. No
 * shared epoch object, nothing to keep in sync, and no way for a late mount to
 * start the border on a different beat from the room.
 */

/**
 * The period, in milliseconds.
 *
 * 1600 rather than the room's old 1150. Both read as equipment rather than as a
 * blink, and both sit far under the 3 Hz photosensitivity threshold, so the
 * choice is about which one to keep, not about safety: the slower of the two is
 * the calmer, and it is the value the border's contrast and reduced-motion
 * treatment were already written against.
 */
export const ALARM_PULSE_MS = 1600;

/** Held value under reduced motion — the midpoint, on every surface. */
export const ALARM_PULSE_HELD = 0.5;

/** Positive modulo, so a timestamp before the origin still lands in range. */
function wrap(value: number, period: number): number {
  return ((value % period) + period) % period;
}

/**
 * Alarm brightness at `nowMs`, from 0 (dimmest) to 1 (brightest).
 *
 * A raised cosine rather than a triangle or a step: the alarm has to read as a
 * lamp with thermal mass, and the eye finds a linear ramp's corners.
 */
export function alarmPhase(nowMs: number, reducedMotion = false): number {
  if (reducedMotion) return ALARM_PULSE_HELD;
  return 0.5 - 0.5 * Math.cos((wrap(nowMs, ALARM_PULSE_MS) * Math.PI * 2) / ALARM_PULSE_MS);
}

/** Interpolates a range by the phase. The shape lives in one place. */
export function alarmRange(
  nowMs: number,
  range: { min: number; max: number },
  reducedMotion = false,
): number {
  return range.min + (range.max - range.min) * alarmPhase(nowMs, reducedMotion);
}

/**
 * The negative `animation-delay` that puts a CSS keyframe on this clock.
 *
 * Applied inline when the alarm class goes on. Without it the keyframe starts
 * at phase zero whenever the element happens to mount, which is the whole
 * reason the border and the room could drift apart in the first place.
 */
export function cssAlarmDelayMs(nowMs: number): number {
  return -wrap(nowMs, ALARM_PULSE_MS);
}

/** The next moment the alarm is at its brightest, at or after `nowMs`. */
export function nextAlarmPeakMs(nowMs: number): number {
  const peak = ALARM_PULSE_MS / 2;
  const offset = wrap(nowMs - peak, ALARM_PULSE_MS);
  return offset === 0 ? nowMs : nowMs + (ALARM_PULSE_MS - offset);
}

/**
 * How far apart two surfaces are, in milliseconds of phase.
 *
 * Signed distance around the cycle, so 0.98 and 0.02 are 0.04 apart rather than
 * 0.96 — the peaks either coincide or they do not, and a comparison that wraps
 * the wrong way would call a perfect match a whole period of drift.
 */
export function phaseSkewMs(a: number, b: number): number {
  const raw = Math.abs(a - b) * ALARM_PULSE_MS;
  return Math.min(raw, ALARM_PULSE_MS - raw);
}
