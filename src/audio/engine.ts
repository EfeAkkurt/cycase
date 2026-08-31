/**
 * The audio engine.
 *
 * Two kinds of sound live here and they are built differently on purpose.
 *
 * **Interface cues** — typing, confirmation, the reveal, the scene transition,
 * footsteps — stay synthesised. They are short, abstract, non-diegetic and cost
 * zero bytes, and `docs/PRODUCT_SPEC.md` rules out an audio library "unless
 * later evidence justifies one".
 *
 * **The alarm** is not an interface cue. It is a physical event happening at a
 * specific point in the room, and the oscillator version of it sounded like a
 * toy. It is now a CC0 sample played through an HRTF `PannerNode` bound to the
 * centre monitor's real position, so turning the head changes where it comes
 * from. The samples are not in the repository yet (Freesound needs an account —
 * `docs/AUDIO_ASSET_REQUEST.md`), and the missing-file path is a first-class,
 * tested behaviour rather than an afterthought.
 *
 * The graph:
 *
 *     destination
 *       ← limiter          (protection; see mix.ts)
 *         ← master         (volume / mute)
 *           ← speechDuck   (drops while a line is being spoken)
 *             ← preRoll    (drops for the 200 ms hole before the impact)
 *             │   ← ambient bus
 *             │   ← cue bus
 *             └── panner (HRTF, at the centre monitor)
 *                   ← alarm loop / impact / relay click
 *
 * The context is created only inside `unlock()`, which runs from a real user
 * gesture, so the page can never trip an autoplay warning.
 */

import { cameraRig } from '../three/cameraRig';
import {
  ALARM_GAIN,
  ALARM_RELEASE_SECONDS,
  AMBIENT_GAIN,
  AMBIENT_RELEASE_SECONDS,
  CUE_PEAK_GAIN,
  DUCK_HOLD_SECONDS,
  DUCK_PREROLL_GAIN,
  DUCK_RAMP_SECONDS,
  DUCK_SPEECH_GAIN,
  IMPACT_GAIN,
  IMPACT_TO_ALARM_SECONDS,
  LIMITER,
  RELAY_GAIN,
} from './mix';
import { INSTALLED_ALARM_ASSETS, type AlarmAssetSpec } from './manifest';
import { loadAlarmSamples, NO_SAMPLES, type LoadedSamples } from './samples';
import { ALARM_EMITTER, emitterDistance, listenerOrientation, LISTENER_POSITION } from './spatial';

/**
 * `alert` is kept as the caller-facing name for the alarm because the office
 * scene already speaks it and that file belongs to another workstream. What it
 * *does* changed completely: it is now an idempotent request to start the
 * spatial alarm, not a two-tone oscillator ping. The old `reject` cue had no
 * callers at all and is gone.
 */
export type Cue = 'typewriter' | 'alert' | 'confirm' | 'reveal' | 'transition' | 'footstep';

export type AlarmPhase =
  | 'idle'
  /** Sounding with the real CC0 samples. */
  | 'sounding'
  /** Sounding without them: one spatial marker, then the visual carries it. */
  | 'degraded'
  | 'acknowledged';

export interface AlarmStatus {
  phase: AlarmPhase;
  /**
   * Whether the alarm samples are actually present. The UI must not claim an
   * alarm is audible when this is false — see `docs/AUDIO_ASSET_REQUEST.md`.
   */
  assetsPresent: boolean;
  /** Paths that were requested and did not yield audio. */
  missing: readonly string[];
}

/** Strike pitches for the grouped key click, walked in order. */
const KEY_PITCHES = [318, 372, 286, 404, 340] as const;

const VOLUME_KEY = 'cycase.volume';
const MUTED_KEY = 'cycase.muted';

function readStored<T>(key: string, fallback: T, parse: (raw: string) => T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : parse(raw);
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private browsing or blocked storage. Preferences just do not persist.
  }
}

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private speechDuck: GainNode | null = null;
  private preRoll: GainNode | null = null;
  private panner: PannerNode | null = null;
  private ambient: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private keyIndex = -1;

  private samples: LoadedSamples = NO_SAMPLES;
  private samplesPromise: Promise<LoadedSamples> | null = null;

  private alarmPhase: AlarmPhase = 'idle';
  private alarmNodes: { source: AudioBufferSourceNode; gain: GainNode }[] = [];
  private alarmListeners = new Set<(status: AlarmStatus) => void>();

  private speaking = false;
  private unsubscribeRig: (() => void) | null = null;

  private volumeValue = readStored(VOLUME_KEY, 0.6, (raw) => {
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.6;
  });

  private mutedValue = readStored(MUTED_KEY, false, (raw) => raw === 'true');

  /**
   * The alarm files this build found on disk, and therefore the only ones the
   * engine may request. Injectable so the suite can drive both worlds — the
   * shipped one where nothing is installed and nothing is fetched, and the one
   * the owner creates by dropping the files in — without writing WAVs to the
   * repository to do it.
   */
  private readonly installed: readonly AlarmAssetSpec[];

  constructor(installed: readonly AlarmAssetSpec[] = INSTALLED_ALARM_ASSETS) {
    this.installed = installed;
  }

  get volume(): number {
    return this.volumeValue;
  }

  get muted(): boolean {
    return this.mutedValue;
  }

  get unlocked(): boolean {
    return this.context !== null;
  }

  get alarmStatus(): AlarmStatus {
    return {
      phase: this.alarmPhase,
      assetsPresent: this.samples.complete,
      missing: this.samples.missing,
    };
  }

  /**
   * Must be called from a user gesture. Safe to call repeatedly.
   *
   * Calling it a second time also re-arms the alarm, and that is deliberate.
   * `unlock()` is only ever reached from the boot screen, and the boot screen
   * is only ever reached at the start of a run — including after `RESTART`,
   * which sends the machine back to `boot` while this engine, mounted above
   * `GameProvider`, survives. Without this the second run would show a pulsing
   * red monitor and an Acknowledge button over a permanently latched, silent
   * alarm: the same lie as claiming a sound that is not installed, in reverse.
   */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      this.resetAlarm();
      return;
    }
    if (typeof window === 'undefined') return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    try {
      const context = new Ctor();

      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = LIMITER.threshold;
      limiter.knee.value = LIMITER.knee;
      limiter.ratio.value = LIMITER.ratio;
      limiter.attack.value = LIMITER.attack;
      limiter.release.value = LIMITER.release;
      limiter.connect(context.destination);

      const master = context.createGain();
      master.gain.value = this.effectiveGain();
      master.connect(limiter);

      const speechDuck = context.createGain();
      speechDuck.gain.value = 1;
      speechDuck.connect(master);

      const preRoll = context.createGain();
      preRoll.gain.value = 1;
      preRoll.connect(speechDuck);

      const panner = createEmitterPanner(context);
      panner.connect(speechDuck);

      this.context = context;
      this.master = master;
      this.speechDuck = speechDuck;
      this.preRoll = preRoll;
      this.panner = panner;
      this.noiseBuffer = this.createNoiseBuffer(context);

      this.bindListenerToHead(context);
      this.ensureSamples();
    } catch {
      this.context = null;
    }
  }

  setVolume(value: number): void {
    this.volumeValue = Math.min(1, Math.max(0, value));
    writeStored(VOLUME_KEY, String(this.volumeValue));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    writeStored(MUTED_KEY, String(muted));
    this.applyGain();
  }

  /**
   * Ducks everything in the graph while a line is being spoken.
   *
   * Browser speech synthesis does not go through this graph — it goes to the
   * system mixer — so ducking *our* side is the only automatic ducking that is
   * available, and it is the side that should move anyway.
   */
  setSpeaking(speaking: boolean): void {
    if (this.speaking === speaking) return;
    this.speaking = speaking;
    if (!this.context || !this.speechDuck) return;
    this.speechDuck.gain.setTargetAtTime(
      speaking ? DUCK_SPEECH_GAIN : 1,
      this.context.currentTime,
      DUCK_RAMP_SECONDS,
    );
  }

  dispose(): void {
    this.stopAmbient();
    this.stopAlarmNodes(0);
    this.unsubscribeRig?.();
    this.unsubscribeRig = null;
    this.alarmListeners.clear();
    this.context?.close().catch(() => undefined);
    this.context = null;
    this.master = null;
    this.speechDuck = null;
    this.preRoll = null;
    this.panner = null;
  }

  /* ---------------- the alarm ---------------- */

  onAlarmChange(listener: (status: AlarmStatus) => void): () => void {
    this.alarmListeners.add(listener);
    listener(this.alarmStatus);
    return () => this.alarmListeners.delete(listener);
  }

  /**
   * Starts the alarm sequence. **Idempotent by construction**: once the alarm
   * is sounding, or once it has been acknowledged, every further call is a
   * no-op. That is what makes a re-render — or the office scene's keep-alive
   * ping — incapable of starting the sound twice, and what makes "the alarm
   * never restarts after acknowledgement" true rather than merely intended.
   *
   * Only `resetAlarm()` reopens the door, and only a new case calls it.
   */
  startAlarm(): void {
    if (this.alarmPhase !== 'idle') return;
    if (!this.context || !this.panner || !this.preRoll) return;

    // The samples may still be in flight on the very first frame. Latch the
    // phase now so nothing double-starts, and let the load decide which
    // treatment plays.
    this.alarmPhase = this.samples.complete ? 'sounding' : 'degraded';
    this.emitAlarm();

    void this.ensureSamples().then(() => {
      if (this.alarmPhase !== 'sounding' && this.alarmPhase !== 'degraded') return;
      const next: AlarmPhase = this.samples.complete ? 'sounding' : 'degraded';
      if (next !== this.alarmPhase) {
        this.alarmPhase = next;
        this.emitAlarm();
      }
      this.runAlarmSequence();
    });
  }

  /**
   * Stops the alarm immediately and latches it shut.
   *
   * The relay click that follows is spatial — it comes out of the same monitor
   * the alarm did, which is what makes the room feel like it has hardware in it
   * rather than a sound effect track.
   */
  acknowledgeAlarm(): void {
    if (this.alarmPhase !== 'sounding' && this.alarmPhase !== 'degraded') return;
    this.alarmPhase = 'acknowledged';
    this.stopAlarmNodes(ALARM_RELEASE_SECONDS);
    this.restorePreRoll();
    this.relayClick();
    this.emitAlarm();
  }

  /** Reopens the alarm for a fresh case. Nothing else may call this. */
  resetAlarm(): void {
    this.stopAlarmNodes(0);
    this.restorePreRoll();
    this.alarmPhase = 'idle';
    this.emitAlarm();
  }

  private emitAlarm(): void {
    const status = this.alarmStatus;
    for (const listener of this.alarmListeners) listener(status);
  }

  private ensureSamples(): Promise<LoadedSamples> {
    if (this.samplesPromise) return this.samplesPromise;
    const context = this.context;
    if (!context) return Promise.resolve(NO_SAMPLES);
    // Memoised as the promise, so an installed file is fetched exactly once for
    // the lifetime of the page however many times the alarm is started — and an
    // absent one is never fetched at all.
    this.samplesPromise = loadAlarmSamples(context, fetch, this.installed).then((loaded) => {
      this.samples = loaded;
      this.emitAlarm();
      return loaded;
    });
    return this.samplesPromise;
  }

  /**
   * `room ambience -> 200 ms hole -> one impact -> the loop underneath it`.
   *
   * Every step is scheduled against `context.currentTime` rather than with
   * `setTimeout`, so the sequence keeps its shape under a busy main thread and
   * in a throttled background tab.
   */
  private runAlarmSequence(): void {
    const context = this.context;
    const panner = this.panner;
    const preRoll = this.preRoll;
    if (!context || !panner || !preRoll) return;

    const now = context.currentTime;
    const impactAt = now + DUCK_HOLD_SECONDS;

    // The hole: duck the room and the interface, not the alarm itself.
    preRoll.gain.cancelScheduledValues(now);
    preRoll.gain.setTargetAtTime(DUCK_PREROLL_GAIN, now, DUCK_RAMP_SECONDS);
    preRoll.gain.setTargetAtTime(1, impactAt + 0.05, DUCK_RAMP_SECONDS * 2);

    const impact = this.samples.get('impact');
    if (impact) {
      this.playSpatial(impact, IMPACT_GAIN, impactAt, false);
    } else {
      /*
       * Degraded: no alarm sample, and therefore NO SOUND AT ALL.
       *
       * A synthesised marker used to play here. The product owner asked for the
       * toy alarm to be removed and the final audit found this was where it had
       * survived — a swept oscillator standing in for a real siren. A stand-in
       * is worse than silence: it sets the wrong expectation for the one sound
       * the whole opening depends on, and because it is audible it removes the
       * pressure to ever fetch the real file.
       *
       * The alarm remains fully legible without it. The centre monitor keeps its
       * red border pulse and emissive spill, the dialogue states the alarm in
       * words, and `alarmStatus.phase` is `degraded` so the interface can say
       * plainly that the sound is missing rather than pretending.
       */
    }

    const primary = this.samples.get('primary');
    if (primary) {
      this.playSpatial(primary, ALARM_GAIN, impactAt + IMPACT_TO_ALARM_SECONDS, true);
    }
  }

  private playSpatial(
    buffer: AudioBuffer,
    peak: number,
    startAt: number,
    loop: boolean,
  ): void {
    const context = this.context;
    const panner = this.panner;
    if (!context || !panner) return;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;

    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.02);

    source.connect(gain).connect(panner);
    source.start(startAt);

    const entry = { source, gain };
    this.alarmNodes.push(entry);
    source.onended = () => {
      this.alarmNodes = this.alarmNodes.filter((node) => node !== entry);
    };
  }

  private stopAlarmNodes(release: number): void {
    const context = this.context;
    const nodes = this.alarmNodes;
    this.alarmNodes = [];
    if (!context) return;
    const now = context.currentTime;

    for (const { source, gain } of nodes) {
      gain.gain.cancelScheduledValues(now);
      if (release > 0) {
        gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
      } else {
        gain.gain.setValueAtTime(0.0001, now);
      }
      try {
        source.stop(now + release + 0.01);
      } catch {
        // Never started, or already stopped.
      }
    }
  }

  private restorePreRoll(): void {
    if (!this.context || !this.preRoll) return;
    const now = this.context.currentTime;
    this.preRoll.gain.cancelScheduledValues(now);
    this.preRoll.gain.setTargetAtTime(1, now, DUCK_RAMP_SECONDS);
  }

  /** The hardware relay behind the acknowledgement, from the monitor itself. */
  private relayClick(): void {
    const context = this.context;
    const panner = this.panner;
    if (!context || !panner || !this.noiseBuffer || this.mutedValue) return;
    const now = context.currentTime;

    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1450;
    filter.Q.value = 3.2;

    const gain = context.createGain();
    gain.gain.setValueAtTime(RELAY_GAIN, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

    source.connect(filter).connect(gain).connect(panner);
    source.start(now);
    source.stop(now + 0.08);
  }

  /* ---------------- spatialisation ---------------- */

  /**
   * Keeps the Web Audio listener pointing wherever the head is pointing.
   *
   * `cameraRig` emits on every eased step of a glance, not just at the ends, so
   * the alarm swings across the stereo field through the whole motion — the
   * same subscription the DOM monitor projection uses, from the same source of
   * truth, which is what stops the picture and the sound disagreeing.
   */
  private bindListenerToHead(context: AudioContext): void {
    const listener = context.listener;
    const [px, py, pz] = LISTENER_POSITION;

    if (listener.positionX) {
      listener.positionX.value = px;
      listener.positionY.value = py;
      listener.positionZ.value = pz;
    } else {
      // Safari still ships the deprecated form.
      (listener as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(
        px,
        py,
        pz,
      );
    }

    const apply = (yaw: number, pitch: number) => {
      const { forward, up } = listenerOrientation(yaw, pitch);
      if (listener.forwardX) {
        listener.forwardX.value = forward[0];
        listener.forwardY.value = forward[1];
        listener.forwardZ.value = forward[2];
        listener.upX.value = up[0];
        listener.upY.value = up[1];
        listener.upZ.value = up[2];
      } else {
        (
          listener as unknown as {
            setOrientation(
              fx: number,
              fy: number,
              fz: number,
              ux: number,
              uy: number,
              uz: number,
            ): void;
          }
        ).setOrientation(forward[0], forward[1], forward[2], up[0], up[1], up[2]);
      }
    };

    this.unsubscribeRig?.();
    this.unsubscribeRig = cameraRig.subscribe((state) => apply(state.yaw, state.pitch));
  }

  /* ---------------- shared plumbing ---------------- */

  private effectiveGain(): number {
    return this.mutedValue ? 0 : this.volumeValue;
  }

  private applyGain(): void {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.effectiveGain(), now, 0.02);
  }

  private createNoiseBuffer(context: BaseAudioContext): AudioBuffer {
    const length = Math.floor(context.sampleRate * 0.4);
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministic pseudo-noise. A fixed sequence keeps every run identical,
    // which matters because the QA pass compares recordings.
    let seed = 1;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      data[i] = (seed / 2147483648 - 1) * 0.6;
    }
    return buffer;
  }

  /** Low room tone. Started once the office is visible, stopped on teardown. */
  startAmbient(): void {
    if (!this.context || !this.preRoll || this.ambient || !this.noiseBuffer) return;

    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;

    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 180;

    const gain = this.context.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(AMBIENT_GAIN, this.context.currentTime, 1.2);

    source.connect(filter).connect(gain).connect(this.preRoll);
    source.start();
    this.ambient = { source, gain };
  }

  stopAmbient(): void {
    if (!this.ambient || !this.context) return;
    const { source, gain } = this.ambient;
    gain.gain.setTargetAtTime(0, this.context.currentTime, AMBIENT_RELEASE_SECONDS);
    window.setTimeout(() => {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }, 600);
    this.ambient = null;
  }

  play(cue: Cue): void {
    if (!this.context || !this.preRoll) return;

    /*
     * The alarm's state transitions run *before* the mute check, and that
     * ordering is the whole point. Mute silences sound; it does not change what
     * the incident is doing. If acknowledgement were skipped while muted, the
     * loop would still be running at zero gain and unmuting would bring a
     * dismissed alarm back — which is exactly the bug "the alarm never restarts
     * after acknowledgement" exists to forbid.
     */
    if (cue === 'alert') {
      // The office scene pings this on a slow cadence while the alarm is
      // unacknowledged. `startAlarm` is idempotent, so the cadence is a
      // harmless keep-alive rather than a re-trigger.
      this.startAlarm();
      return;
    }
    if (cue === 'confirm') {
      /*
       * Bridge, and marked as one: the alarm has to stop the instant it is
       * acknowledged, and the office scene's acknowledge handler plays this cue
       * immediately before dispatching ACKNOWLEDGE_ALARM. The alarm only ever
       * sounds in a state whose single confirmable action *is* the
       * acknowledgement, so this cannot silence it early. Once the UI
       * workstream calls `acknowledgeAlarm()` directly this becomes a no-op,
       * because acknowledgement latches.
       */
      this.acknowledgeAlarm();
    }

    if (this.mutedValue) return;
    const context = this.context;
    const now = context.currentTime;

    switch (cue) {
      case 'confirm':
        this.tone(520, now, 0.09, CUE_PEAK_GAIN * 0.8, 'sine');
        this.tone(780, now + 0.06, 0.12, CUE_PEAK_GAIN * 0.6, 'sine');
        break;
      case 'typewriter': {
        // Walk the strike pitches so a typed line reads as a keyboard rather
        // than a metronome. Grouped per visual character group, not per glyph.
        this.keyIndex = (this.keyIndex + 1) % KEY_PITCHES.length;
        this.click(KEY_PITCHES[this.keyIndex]!, 0.035, CUE_PEAK_GAIN * 0.7);
        break;
      }
      case 'footstep':
        this.click(90, 0.09, CUE_PEAK_GAIN * 0.35);
        break;
      case 'reveal':
        this.tone(300, now, 0.5, CUE_PEAK_GAIN * 0.5, 'sine', 900);
        break;
      case 'transition':
        this.sweep(now, 0.55);
        break;
    }
  }

  private tone(
    frequency: number,
    startAt: number,
    duration: number,
    peak: number,
    type: OscillatorType = 'sine',
    glideTo?: number,
  ): void {
    if (!this.context || !this.preRoll) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (glideTo) oscillator.frequency.exponentialRampToValueAtTime(glideTo, startAt + duration);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(gain).connect(this.preRoll);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }

  private click(cutoff: number, duration: number, peak: number): void {
    if (!this.context || !this.preRoll || !this.noiseBuffer) return;
    const now = this.context.currentTime;

    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;

    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = cutoff;
    filter.Q.value = 1.4;

    const gain = this.context.createGain();
    gain.gain.setValueAtTime(peak, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter).connect(gain).connect(this.preRoll);
    source.start(now);
    source.stop(now + duration + 0.02);
  }

  private sweep(startAt: number, duration: number, into?: AudioNode): void {
    if (!this.context || !this.preRoll) return;
    const destination = into ?? this.preRoll;
    const oscillator = this.context.createOscillator();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(180, startAt);
    oscillator.frequency.exponentialRampToValueAtTime(70, startAt + duration);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800, startAt);
    filter.frequency.exponentialRampToValueAtTime(220, startAt + duration);

    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(CUE_PEAK_GAIN * 0.8, startAt + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

    oscillator.connect(filter).connect(gain).connect(destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.05);
  }
}

/** The HRTF emitter, parked on the centre monitor and never moved. */
function createEmitterPanner(context: BaseAudioContext): PannerNode {
  const panner = context.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  // Reference distance is the real seat-to-monitor distance, so the distance
  // model is exactly 1 at rest and the level is set by `mix.ts` alone.
  panner.refDistance = emitterDistance();
  panner.maxDistance = 20;
  panner.rolloffFactor = 1;

  const [x, y, z] = ALARM_EMITTER;
  if (panner.positionX) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else {
    (panner as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(
      x,
      y,
      z,
    );
  }
  return panner;
}
