/**
 * Gain staging, alarm timing and the output limiter, in one auditable place.
 *
 * These live apart from the engine because they are the numbers a test can hold
 * to account. The unit suite runs in Node, where there is no Web Audio
 * implementation at all, so the *analytic* budget is pinned here and the
 * *measured* peak is rendered through a real `OfflineAudioContext` in
 * `tests/e2e/audio.spec.ts`. Both have to agree that nothing clips.
 */

/* ------------------------------------------------------------------ *
 * Levels. Every one is a linear gain, and every one is applied to a
 * source whose worst case is a full-scale (±1.0) sample.
 * ------------------------------------------------------------------ */

/** The looping alarm, before the panner and the master. */
export const ALARM_GAIN = 0.34;
/** The single impact. Louder than the loop — it is a transient, not a bed. */
export const IMPACT_GAIN = 0.4;
/** Room tone. Deliberately far below everything else. */
export const AMBIENT_GAIN = 0.05;
/** The relay click that confirms acknowledgement. */
export const RELAY_GAIN = 0.16;
/** Interface cues (typewriter, confirm, reveal, transition, footsteps). */
export const CUE_PEAK_GAIN = 0.2;

/**
 * The distance-model gain the panner applies at the emitter's real distance.
 * `refDistance` is set to the seat-to-monitor distance, so the inverse model
 * evaluates to exactly 1 there. Head-look rotates; it never moves the seat, so
 * this is a constant rather than a range.
 */
export const PANNER_DISTANCE_GAIN = 1;

/**
 * HRTF panning is not gain-neutral: for a source near the median plane the two
 * ears sum to slightly more than the mono input. Carried as an explicit budget
 * line rather than hidden in a fudge factor.
 */
export const HRTF_SUM_HEADROOM = 1.2;

/* ------------------------------------------------------------------ *
 * The limiter
 *
 * "The level cannot clip or hurt" is a promise about every possible
 * combination of cues, volumes and asset levels — including CC0 files whose
 * loudness we have not measured because we cannot download them yet. An
 * arithmetic budget cannot promise that; a limiter can. The compressor below
 * sits on the master, last before the destination, and is the reason the
 * guarantee holds for assets that are not in the repository yet.
 * ------------------------------------------------------------------ */

export const LIMITER = {
  /** dBFS. −3 dB leaves the mix untouched at normal levels. */
  threshold: -3,
  /** dB. A hard knee, because this is protection and not colour. */
  knee: 0,
  ratio: 20,
  /** Seconds. Fast enough to catch the impact transient. */
  attack: 0.003,
  release: 0.12,
} as const;

/** Linear ceiling the limiter holds the master to. */
export const LIMITER_CEILING = Math.pow(10, LIMITER.threshold / 20) * 1.08;

/* ------------------------------------------------------------------ *
 * Ducking
 * ------------------------------------------------------------------ */

/** How far the room and interface buses drop while the pre-roll hole is open. */
export const DUCK_PREROLL_GAIN = 0.06;
/** How far everything drops while a line is being spoken. */
export const DUCK_SPEECH_GAIN = 0.4;
/** Ramp time constant for every duck transition, in seconds. */
export const DUCK_RAMP_SECONDS = 0.04;

/* ------------------------------------------------------------------ *
 * Timing. `room ambience -> duck -> impact -> primary alarm`.
 * ------------------------------------------------------------------ */

/**
 * The hole cut in the room tone before the impact lands. The contract asks for
 * 150–250 ms; `tests/unit/audio.test.ts` pins that it stays in range.
 */
export const DUCK_HOLD_SECONDS = 0.2;
/** How long after the impact the looping alarm comes in under it. */
export const IMPACT_TO_ALARM_SECONDS = 0.28;
/** Fade applied when the alarm is acknowledged. Short enough to read as instant. */
export const ALARM_RELEASE_SECONDS = 0.03;
/** Fade applied to the room tone on teardown. */
export const AMBIENT_RELEASE_SECONDS = 0.25;

/**
 * Worst-case linear peak arriving *at* the limiter, computed rather than
 * assumed: the impact still ringing, the loop already under it, the room tone
 * restored and an interface cue on top, all at full scale, with the volume
 * slider at its maximum.
 *
 * This is deliberately pessimistic — those four never actually align — and it
 * is the number the limiter has to be able to absorb without pumping, not the
 * number that reaches the speakers.
 */
export function worstCasePreLimiterPeak(volume = 1): number {
  const spatial = (ALARM_GAIN + IMPACT_GAIN) * PANNER_DISTANCE_GAIN * HRTF_SUM_HEADROOM;
  return (spatial + AMBIENT_GAIN + CUE_PEAK_GAIN) * volume;
}
