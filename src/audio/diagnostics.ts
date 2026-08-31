/**
 * Output-level measurement.
 *
 * "The level cannot clip or hurt" is a claim, and a claim about audio has to be
 * measured rather than reasoned about. This renders the *same* graph the engine
 * builds — same gains, same HRTF panner at the same emitter position, same
 * limiter — through an `OfflineAudioContext`, with a full-scale (±1.0) stimulus
 * standing in for every source at once, and reports the true peak sample.
 *
 * Two honesty notes, because the number is easy to over-read:
 *
 * - The three CC0 alarm files are not in the repository yet, so this measures
 *   **gain staging headroom against a normalised stimulus**, not those files.
 *   A normalised stimulus is the correct stand-in: it is the loudest thing a
 *   sample can legally be, so a peak measured this way bounds the real one.
 * - It is deliberately worse than anything that can actually happen — impact,
 *   loop, room tone and an interface cue all at full scale simultaneously, with
 *   the volume slider at maximum.
 *
 * Published on `window.__CYCASE_AUDIO__` the same way `buildInfo.ts` publishes
 * the build identity, so `tests/e2e/audio.spec.ts` can read a real number out
 * of a real browser instead of trusting arithmetic.
 */

import type { AlarmStatus } from './engine';
import { INSTALLED_ALARM_ASSETS } from './manifest';
import {
  ALARM_GAIN,
  AMBIENT_GAIN,
  CUE_PEAK_GAIN,
  IMPACT_GAIN,
  LIMITER,
  worstCasePreLimiterPeak,
} from './mix';
import { ALARM_EMITTER, emitterDistance, listenerOrientation, LISTENER_POSITION } from './spatial';

export interface PeakMeasurement {
  /** True peak sample on the rendered master output, linear. */
  peak: number;
  /** The pessimistic arithmetic budget, for comparison. */
  preLimiterBudget: number;
  sampleRate: number;
  seconds: number;
}

const SECONDS = 1.5;
const SAMPLE_RATE = 48_000;

/** A full-scale square-ish stimulus: the loudest a normalised sample can be. */
function fullScale(context: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  // A 220 Hz square alternating between the rails. Deterministic, and it holds
  // ±1.0 for long stretches, which is what makes it a worst case rather than a
  // sine whose average is 0.7 of its peak.
  const period = context.sampleRate / 220;
  for (let i = 0; i < length; i += 1) {
    data[i] = i % period < period / 2 ? 1 : -1;
  }
  return buffer;
}

function source(context: BaseAudioContext, buffer: AudioBuffer, gain: number, into: AudioNode) {
  const node = context.createBufferSource();
  node.buffer = buffer;
  node.loop = true;
  const level = context.createGain();
  level.gain.value = gain;
  node.connect(level).connect(into);
  node.start(0);
}

/**
 * Renders the worst case and returns its true peak. Resolves to `null` in an
 * environment with no `OfflineAudioContext` (the Node unit suite), where the
 * arithmetic budget in `mix.ts` is the guard instead.
 */
export async function measurePeak(): Promise<PeakMeasurement | null> {
  const Ctor =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : (globalThis as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext;
  if (!Ctor) return null;

  const context = new Ctor(2, Math.floor(SAMPLE_RATE * SECONDS), SAMPLE_RATE);

  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  limiter.connect(context.destination);

  const master = context.createGain();
  // The maximum the volume slider can reach. Anything less is a smaller number.
  master.gain.value = 1;
  master.connect(limiter);

  const speechDuck = context.createGain();
  speechDuck.gain.value = 1;
  speechDuck.connect(master);

  const preRoll = context.createGain();
  preRoll.gain.value = 1;
  preRoll.connect(speechDuck);

  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = emitterDistance();
  panner.maxDistance = 20;
  panner.rolloffFactor = 1;
  panner.positionX.value = ALARM_EMITTER[0];
  panner.positionY.value = ALARM_EMITTER[1];
  panner.positionZ.value = ALARM_EMITTER[2];
  panner.connect(speechDuck);

  const listener = context.listener;
  listener.positionX.value = LISTENER_POSITION[0];
  listener.positionY.value = LISTENER_POSITION[1];
  listener.positionZ.value = LISTENER_POSITION[2];
  const { forward, up } = listenerOrientation(0, 0);
  listener.forwardX.value = forward[0];
  listener.forwardY.value = forward[1];
  listener.forwardZ.value = forward[2];
  listener.upX.value = up[0];
  listener.upY.value = up[1];
  listener.upZ.value = up[2];

  const stimulus = fullScale(context, 0.5);
  source(context, stimulus, IMPACT_GAIN, panner);
  source(context, stimulus, ALARM_GAIN, panner);
  source(context, stimulus, AMBIENT_GAIN, preRoll);
  source(context, stimulus, CUE_PEAK_GAIN, preRoll);

  const rendered = await context.startRendering();

  let peak = 0;
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      const value = Math.abs(data[i]!);
      if (value > peak) peak = value;
    }
  }

  return {
    peak,
    preLimiterBudget: worstCasePreLimiterPeak(1),
    sampleRate: SAMPLE_RATE,
    seconds: SECONDS,
  };
}

/**
 * The diagnostics surface.
 *
 * Strictly read-only. It can measure and it can report; it cannot make a sound,
 * start or stop the alarm, or touch case state. `alarmStatus` is filled in by
 * `AudioProvider`, which is the only thing holding an engine — it is what lets
 * a test assert that the UI's claim about the alarm matches whether the files
 * are actually there.
 */
export interface AudioDiagnostics {
  measurePeak: typeof measurePeak;
  alarmStatus?: () => AlarmStatus;
  /**
   * The alarm files this build found on disk — the exact set the page is
   * allowed to request.
   *
   * Published so a browser test can assert the request count against it
   * instead of against a hard-coded three. With nothing installed the correct
   * number of audio requests is zero; once the owner drops the files in it is
   * three, and the same assertion keeps holding without an edit.
   */
  installedAudio: readonly string[];
}

declare global {
  interface Window {
    __CYCASE_AUDIO__?: AudioDiagnostics;
  }
}

/** The published form of `INSTALLED_ALARM_ASSETS`: paths, and nothing else. */
export const INSTALLED_AUDIO: readonly string[] = INSTALLED_ALARM_ASSETS.map(
  (asset) => asset.path,
);

if (typeof window !== 'undefined') {
  window.__CYCASE_AUDIO__ = {
    ...window.__CYCASE_AUDIO__,
    measurePeak,
    installedAudio: INSTALLED_AUDIO,
  };
}
