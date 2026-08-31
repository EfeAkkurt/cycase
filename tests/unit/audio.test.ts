import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AudioEngine } from '../../src/audio/engine';
import { ALARM_ASSETS } from '../../src/audio/manifest';
import {
  ALARM_GAIN,
  AMBIENT_GAIN,
  DUCK_HOLD_SECONDS,
  DUCK_PREROLL_GAIN,
  IMPACT_GAIN,
  LIMITER_CEILING,
  worstCasePreLimiterPeak,
} from '../../src/audio/mix';
import { loadAlarmSamples } from '../../src/audio/samples';
import {
  ALARM_EMITTER,
  BASE_ORIENTATION,
  emitterDistance,
  listenerOrientation,
  LISTENER_POSITION,
} from '../../src/audio/spatial';
import { cameraRig } from '../../src/three/cameraRig';
import { CAMERA, MONITOR_BY_ID } from '../../src/three/layout';

/**
 * The alarm is the loudest, most interruptive thing in the product, so the
 * things that could go wrong with it are the things that get tested: it must
 * come out of one specific monitor, it must follow the head, it must never
 * start twice, it must never come back after it has been dismissed, it must
 * behave with its sample files absent — which is the state this repository
 * actually ships in — and it must not be able to clip.
 *
 * The unit suite runs in Node, where there is no Web Audio implementation at
 * all. Rather than skip the engine, the graph is built against a recording
 * fake, which is strictly better for these properties: a real context would let
 * a double-started source hide inside inaudible overlap, whereas the fake
 * counts it.
 */

/* ------------------------------------------------------------------ *
 * A recording Web Audio fake. Only what the engine touches.
 * ------------------------------------------------------------------ */

interface Recorded {
  loopingStarts: number;
  oneShotStarts: number;
  stops: number;
  connectedToPanner: number;
}

function makeParam(value = 0) {
  return {
    value,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  };
}

class FakeContext {
  currentTime = 0;
  sampleRate = 48_000;
  destination = { kind: 'destination' };
  listener = {
    positionX: makeParam(),
    positionY: makeParam(),
    positionZ: makeParam(),
    forwardX: makeParam(),
    forwardY: makeParam(),
    forwardZ: makeParam(),
    upX: makeParam(),
    upY: makeParam(),
    upZ: makeParam(),
  };

  readonly recorded: Recorded = {
    loopingStarts: 0,
    oneShotStarts: 0,
    stops: 0,
    connectedToPanner: 0,
  };

  panner: unknown = null;

  private node(extra: Record<string, unknown> = {}) {
    const connect = (target: unknown) => {
      if (target === this.panner) this.recorded.connectedToPanner += 1;
      return target;
    };
    return { ...extra, connect, disconnect: vi.fn() };
  }

  createGain() {
    return this.node({ gain: makeParam(1) });
  }

  createDynamicsCompressor() {
    return this.node({
      threshold: makeParam(),
      knee: makeParam(),
      ratio: makeParam(),
      attack: makeParam(),
      release: makeParam(),
    });
  }

  createOscillator() {
    return this.node({
      type: 'sine',
      frequency: makeParam(),
      start: vi.fn(),
      stop: vi.fn(),
    });
  }

  createBiquadFilter() {
    return this.node({ type: '', frequency: makeParam(), Q: makeParam() });
  }

  createPanner() {
    const panner = this.node({
      panningModel: '',
      distanceModel: '',
      refDistance: 0,
      maxDistance: 0,
      rolloffFactor: 0,
      positionX: makeParam(),
      positionY: makeParam(),
      positionZ: makeParam(),
    });
    this.panner = panner;
    return panner;
  }

  createBufferSource() {
    const recorded = this.recorded;
    return this.node({
      buffer: null as unknown,
      loop: false,
      onended: null as (() => void) | null,
      start(this: { loop: boolean }) {
        if (this.loop) recorded.loopingStarts += 1;
        else recorded.oneShotStarts += 1;
      },
      stop() {
        recorded.stops += 1;
      },
    });
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {
      length,
      sampleRate,
      numberOfChannels: channels,
      getChannelData: () => data,
    };
  }

  decodeAudioData(): Promise<unknown> {
    return Promise.resolve(this.createBuffer(1, 4800, this.sampleRate));
  }

  resume() {
    return Promise.resolve();
  }

  close() {
    return Promise.resolve();
  }
}

const store = new Map<string, string>();

function installBrowser(): void {
  store.clear();
  (globalThis as { window?: unknown }).window = {
    AudioContext: FakeContext as unknown as typeof AudioContext,
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
  };
}

/**
 * Serves every alarm asset, so the "files are present" branch can be tested.
 *
 * A serving fetch is only half of that world. The engine will not request a
 * file the *build* did not find, so every test of the sounding alarm also
 * constructs `new AudioEngine(ALARM_ASSETS)` — the state the owner creates by
 * dropping the three WAVs into `public/audio/sfx/`. Injecting the list is what
 * lets both worlds be tested from a repository that contains neither.
 */
function servingFetch(): typeof fetch {
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(64),
  })) as unknown as typeof fetch;
}

/** The state the repository actually ships in: nothing at those paths. */
function missingFetch(): typeof fetch {
  return vi.fn(async () => ({
    ok: false,
    status: 404,
    arrayBuffer: async () => new ArrayBuffer(0),
  })) as unknown as typeof fetch;
}

/** Lets the engine's `ensureSamples()` promise chain settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/*
 * Node's own `fetch` is put back rather than deleted. `loadAlarmSamples` reads
 * it as a default parameter, which is evaluated synchronously — deleting the
 * global turns that into a ReferenceError inside `unlock()`, and the engine
 * would then silently have no context at all.
 */
const nativeFetch = globalThis.fetch;

beforeEach(() => {
  installBrowser();
  cameraRig.reset();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  globalThis.fetch = nativeFetch;
  cameraRig.reset();
});

/* ------------------------------------------------------------------ *
 * Where the alarm comes from
 * ------------------------------------------------------------------ */

describe('the alarm emitter', () => {
  it('sits exactly on the centre monitor, never on a copied number', () => {
    expect(ALARM_EMITTER).toEqual(MONITOR_BY_ID.get('center')!.position);
    // Sanity: it is not either of the others.
    expect(ALARM_EMITTER).not.toEqual(MONITOR_BY_ID.get('left')!.position);
    expect(ALARM_EMITTER).not.toEqual(MONITOR_BY_ID.get('right')!.position);
  });

  it('is a real distance in front of the seat', () => {
    expect(LISTENER_POSITION).toEqual(CAMERA.position);
    expect(emitterDistance()).toBeGreaterThan(1);
    expect(emitterDistance()).toBeLessThan(2);
  });
});

describe('listener orientation', () => {
  const unit = (v: [number, number, number]) => Math.hypot(...v);

  it('starts level with the seated aim', () => {
    const { forward, up } = listenerOrientation(0, 0);
    expect(unit(forward)).toBeCloseTo(1, 6);
    expect(unit(up)).toBeCloseTo(1, 6);
    // Straight ahead is dead centre in x and pointing into the room (−z).
    expect(forward[0]).toBeCloseTo(0, 6);
    expect(forward[2]).toBeLessThan(0);
    // The seat looks very slightly downward at the monitors.
    expect(BASE_ORIENTATION.pitch).toBeLessThan(0);
  });

  it('turning the head toward the doorway swings the emitter across the ears', () => {
    // The doorway glance in `Office.tsx` is −38°, and the door is on the
    // right-hand wall (COLLEAGUE_PATH starts at x = +2.5). Looking that way
    // must put forward's x on the positive side.
    const door = listenerOrientation(-(38 * Math.PI) / 180, 0);
    expect(door.forward[0]).toBeGreaterThan(0.5);

    // The opposite turn is the mirror image, which is what makes the alarm's
    // perceived direction actually change rather than merely wobble.
    const other = listenerOrientation((38 * Math.PI) / 180, 0);
    expect(other.forward[0]).toBeLessThan(-0.5);
    expect(door.forward[0]).toBeCloseTo(-other.forward[0], 6);
  });

  it('looking up raises the forward vector and keeps the basis orthonormal', () => {
    const up = listenerOrientation(0, (20 * Math.PI) / 180);
    const level = listenerOrientation(0, 0);
    expect(up.forward[1]).toBeGreaterThan(level.forward[1]);

    const dot =
      up.forward[0] * up.up[0] + up.forward[1] * up.up[1] + up.forward[2] * up.up[2];
    expect(dot).toBeCloseTo(0, 6);
    expect(unit(up.forward)).toBeCloseTo(1, 6);
    expect(unit(up.up)).toBeCloseTo(1, 6);
  });

  it('the engine repoints the listener when the head moves', () => {
    const engine = new AudioEngine();
    engine.unlock();
    const context = (engine as unknown as { context: FakeContext }).context;

    const before = context.listener.forwardX.value;
    cameraRig.setInstant(true);
    cameraRig.lookAt(-(40 * Math.PI) / 180, 0);
    const after = context.listener.forwardX.value;

    expect(after).not.toBeCloseTo(before, 3);
    expect(after).toBeGreaterThan(0.5);
    engine.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * The alarm's state machine
 * ------------------------------------------------------------------ */

describe('the alarm', () => {
  it('starts once however many times it is asked to', async () => {
    (globalThis as { fetch?: unknown }).fetch = servingFetch();
    const engine = new AudioEngine(ALARM_ASSETS);
    engine.unlock();

    engine.startAlarm();
    engine.startAlarm();
    engine.play('alert');
    await settle();
    // The office scene pings on a cadence; that must stay a keep-alive.
    engine.play('alert');
    engine.play('alert');
    await settle();

    const context = (engine as unknown as { context: FakeContext }).context;
    expect(engine.alarmStatus.phase).toBe('sounding');
    expect(context.recorded.loopingStarts).toBe(1);
    engine.dispose();
  });

  it('never comes back after it has been acknowledged', async () => {
    (globalThis as { fetch?: unknown }).fetch = servingFetch();
    const engine = new AudioEngine(ALARM_ASSETS);
    engine.unlock();

    engine.startAlarm();
    await settle();
    engine.acknowledgeAlarm();
    expect(engine.alarmStatus.phase).toBe('acknowledged');

    const context = (engine as unknown as { context: FakeContext }).context;
    const loopsAtAcknowledgement = context.recorded.loopingStarts;

    engine.startAlarm();
    engine.play('alert');
    engine.acknowledgeAlarm();
    await settle();

    expect(engine.alarmStatus.phase).toBe('acknowledged');
    expect(context.recorded.loopingStarts).toBe(loopsAtAcknowledgement);
    engine.dispose();
  });

  it('is acknowledged even while muted, so unmuting cannot resurrect it', async () => {
    (globalThis as { fetch?: unknown }).fetch = servingFetch();
    const engine = new AudioEngine(ALARM_ASSETS);
    engine.unlock();
    engine.startAlarm();
    await settle();

    engine.setMuted(true);
    // The office scene's acknowledge handler plays `confirm` and nothing else;
    // mute must not swallow the state change riding on it.
    engine.play('confirm');
    expect(engine.alarmStatus.phase).toBe('acknowledged');

    engine.setMuted(false);
    engine.play('alert');
    await settle();
    expect(engine.alarmStatus.phase).toBe('acknowledged');
    engine.dispose();
  });

  it('a second unlock re-arms it, so a restarted case is not silently latched', async () => {
    /*
     * `RESTART` sends the machine back to `boot` and resets everything the game
     * owns — but the audio engine is mounted above the game provider and
     * survives. The boot screen's Enter/Skip gesture is the only caller of
     * `unlock()`, which makes it the exact signal for "a new run is starting".
     * Without this the second run shows a pulsing red monitor and an
     * Acknowledge button over an alarm that can never sound again.
     */
    (globalThis as { fetch?: unknown }).fetch = servingFetch();
    const engine = new AudioEngine(ALARM_ASSETS);
    engine.unlock();
    engine.startAlarm();
    await settle();
    engine.acknowledgeAlarm();
    expect(engine.alarmStatus.phase).toBe('acknowledged');

    engine.unlock();
    expect(engine.alarmStatus.phase).toBe('idle');

    // And the boot screen's own confirm cue, which fires immediately after the
    // gesture, must not re-acknowledge the alarm it just re-armed.
    engine.play('confirm');
    expect(engine.alarmStatus.phase).toBe('idle');

    engine.play('alert');
    await settle();
    expect(engine.alarmStatus.phase).toBe('sounding');
    engine.dispose();
  });

  it('only a deliberate reset reopens it', async () => {
    (globalThis as { fetch?: unknown }).fetch = servingFetch();
    const engine = new AudioEngine(ALARM_ASSETS);
    engine.unlock();
    engine.startAlarm();
    await settle();
    engine.acknowledgeAlarm();

    engine.resetAlarm();
    expect(engine.alarmStatus.phase).toBe('idle');
    engine.startAlarm();
    await settle();
    expect(engine.alarmStatus.phase).toBe('sounding');

    const context = (engine as unknown as { context: FakeContext }).context;
    expect(context.recorded.loopingStarts).toBe(2);
    engine.dispose();
  });

  it('publishes its phase to subscribers', async () => {
    (globalThis as { fetch?: unknown }).fetch = servingFetch();
    const engine = new AudioEngine(ALARM_ASSETS);
    engine.unlock();

    const seen: string[] = [];
    const off = engine.onAlarmChange((status) => seen.push(status.phase));
    engine.startAlarm();
    await settle();
    engine.acknowledgeAlarm();
    off();

    expect(seen[0]).toBe('idle');
    expect(seen).toContain('sounding');
    expect(seen.at(-1)).toBe('acknowledged');
    engine.dispose();
  });

  it('a confirm outside the alarm cannot silence anything', async () => {
    (globalThis as { fetch?: unknown }).fetch = servingFetch();
    const engine = new AudioEngine(ALARM_ASSETS);
    engine.unlock();

    // The boot screen plays `confirm` before the office exists.
    engine.play('confirm');
    expect(engine.alarmStatus.phase).toBe('idle');

    engine.startAlarm();
    await settle();
    expect(engine.alarmStatus.phase).toBe('sounding');
    engine.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * The files are not there — which is today's state, not a corner case
 * ------------------------------------------------------------------ */

describe('with the CC0 alarm files absent', () => {
  it('degrades without throwing, and says so rather than claiming a sound', async () => {
    const fetchImpl = missingFetch();
    (globalThis as { fetch?: unknown }).fetch = fetchImpl;

    const engine = new AudioEngine();
    engine.unlock();
    engine.startAlarm();
    await settle();

    expect(engine.alarmStatus.phase).toBe('degraded');
    expect(engine.alarmStatus.assetsPresent).toBe(false);
    expect(engine.alarmStatus.missing).toEqual(ALARM_ASSETS.map((asset) => asset.path));

    /*
     * Nothing is emitted. This assertion used to require the opposite — a
     * synthesised marker through the panner — and it was defending the very
     * behaviour the product owner asked to remove and the final audit found
     * still shipping.
     *
     * A stand-in is worse than silence here: it sets the wrong expectation for
     * the one sound the opening depends on, and because it is audible it removes
     * any pressure to fetch the real file. The alarm stays fully legible without
     * it — pulse, wording, and a caption that says the sound is not installed.
     */
    const context = (engine as unknown as { context: FakeContext }).context;
    expect(
      context.recorded.connectedToPanner,
      'the degraded alarm must be silent, not a synthesised substitute',
    ).toBe(0);

    // The interaction still completes: the visual carries the state and the
    // acknowledgement still latches.
    engine.acknowledgeAlarm();
    expect(engine.alarmStatus.phase).toBe('acknowledged');
    engine.dispose();
  });

  it('never asks for a file the build did not find', async () => {
    /*
     * Today's shipped state, and the whole point of the manifest gate: the
     * build listed `public/audio/`, found none of the three, and the browser
     * therefore makes NO audio request at all. Not three 404s that are quietly
     * tolerated — none.
     *
     * The engine is constructed with the real default, so this fails the moment
     * something reintroduces a blind fetch.
     */
    const fetchImpl = missingFetch();
    (globalThis as { fetch?: unknown }).fetch = fetchImpl;

    const engine = new AudioEngine();
    engine.unlock();
    for (let i = 0; i < 20; i += 1) engine.play('alert');
    await settle();
    engine.resetAlarm();
    for (let i = 0; i < 20; i += 1) engine.play('alert');
    await settle();

    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(0);

    // And the honesty contract is untouched: not-fetched is still missing.
    expect(engine.alarmStatus.phase).toBe('degraded');
    expect(engine.alarmStatus.assetsPresent).toBe(false);
    expect(engine.alarmStatus.missing).toEqual(ALARM_ASSETS.map((asset) => asset.path));
    engine.dispose();
  });

  it('asks for each installed file exactly once, however often the alarm is started', async () => {
    /*
     * The build found all three and the server then failed to produce them —
     * a partial upload, or a CDN that has not caught up with the new `dist/`.
     * The network guards in `samples.ts` still own this case, and the
     * one-attempt-ever memoisation still has to hold: a retry loop against a
     * 404 would be invisible to the player and ruinous on a metered connection.
     */
    const fetchImpl = missingFetch();
    (globalThis as { fetch?: unknown }).fetch = fetchImpl;

    const engine = new AudioEngine(ALARM_ASSETS);
    engine.unlock();
    for (let i = 0; i < 20; i += 1) engine.play('alert');
    await settle();
    engine.resetAlarm();
    for (let i = 0; i < 20; i += 1) engine.play('alert');
    await settle();

    // One request per installed asset for the lifetime of the page.
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(
      ALARM_ASSETS.length,
    );
    expect(engine.alarmStatus.phase).toBe('degraded');
    engine.dispose();
  });

  it('picks the files up with no code change once the build can see them', async () => {
    /*
     * The other half of the contract in `docs/AUDIO_ASSET_REQUEST.md`: dropping
     * the three WAVs into `public/audio/sfx/` must be the entire task. Nothing
     * below names a path, edits a list or flips a flag — the only difference
     * from the test above is which assets the build reported, which is exactly
     * what changes when the files land.
     */
    const fetchImpl = servingFetch();
    (globalThis as { fetch?: unknown }).fetch = fetchImpl;

    const engine = new AudioEngine(ALARM_ASSETS);
    engine.unlock();
    engine.startAlarm();
    await settle();

    expect(engine.alarmStatus.phase).toBe('sounding');
    expect(engine.alarmStatus.assetsPresent).toBe(true);
    expect(engine.alarmStatus.missing).toEqual([]);

    const context = (engine as unknown as { context: FakeContext }).context;
    expect(context.recorded.loopingStarts).toBe(1);
    engine.dispose();
  });

  it('treats an SPA fallback (200 with HTML) as missing, not as audio', async () => {
    const context = new FakeContext();
    context.decodeAudioData = () => Promise.reject(new Error('Unable to decode audio data'));

    const loaded = await loadAlarmSamples(
      context as unknown as BaseAudioContext,
      (async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(1024),
      })) as unknown as typeof fetch,
      // Listed present by the build, and the host serves index.html anyway.
      ALARM_ASSETS,
    );

    expect(loaded.complete).toBe(false);
    expect(loaded.missing.length).toBe(ALARM_ASSETS.length);
  });

  it('survives a fetch that rejects outright (offline)', async () => {
    const context = new FakeContext();
    const loaded = await loadAlarmSamples(
      context as unknown as BaseAudioContext,
      (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch,
      ALARM_ASSETS,
    );

    expect(loaded.complete).toBe(false);
    expect(loaded.get('primary')).toBeNull();
  });

  it('reports a skipped file as missing, exactly like one that failed', async () => {
    /*
     * The one thing this change must not do is redefine "missing". The caption
     * that tells the player the alarm sound is not installed reads this list,
     * and a file nobody asked for is missing in precisely the same sense as one
     * that came back 404. Half-installed is the case that would expose a
     * shortcut, so that is the case asserted.
     */
    const context = new FakeContext();
    const impactOnly = ALARM_ASSETS.filter((asset) => asset.id === 'impact');

    const loaded = await loadAlarmSamples(
      context as unknown as BaseAudioContext,
      servingFetch(),
      impactOnly,
    );

    expect(loaded.get('impact')).not.toBeNull();
    // The loop never arrived, so the alarm is still not complete.
    expect(loaded.complete).toBe(false);
    expect(loaded.missing).toEqual(
      ALARM_ASSETS.filter((asset) => asset.id !== 'impact').map((asset) => asset.path),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Level
 * ------------------------------------------------------------------ */

describe('level', () => {
  it('the pre-limiter budget is a real budget, not a guess', () => {
    const worst = worstCasePreLimiterPeak(1);
    // It is allowed to exceed 1.0 — that is what the limiter is for — but it
    // must stay inside the range a 20:1 limiter absorbs without audible
    // pumping. Above roughly 2x the ceiling the protection starts to sound
    // like an effect rather than a safety net.
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(LIMITER_CEILING * 2);
  });

  it('the limiter ceiling is below full scale', () => {
    expect(LIMITER_CEILING).toBeLessThan(1);
    expect(LIMITER_CEILING).toBeGreaterThan(0.5);
  });

  it('no single source is anywhere near full scale on its own', () => {
    for (const gain of [ALARM_GAIN, IMPACT_GAIN, AMBIENT_GAIN]) {
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThan(0.5);
    }
    // The room tone is a bed, not a cue.
    expect(AMBIENT_GAIN).toBeLessThan(ALARM_GAIN / 4);
  });

  it('the pre-roll hole is inside the contract window', () => {
    expect(DUCK_HOLD_SECONDS).toBeGreaterThanOrEqual(0.15);
    expect(DUCK_HOLD_SECONDS).toBeLessThanOrEqual(0.25);
    // A hole is only a hole if it actually gets quiet.
    expect(DUCK_PREROLL_GAIN).toBeLessThan(0.1);
  });
});

/* ------------------------------------------------------------------ *
 * The rest of the engine's contract
 * ------------------------------------------------------------------ */

describe('the engine', () => {
  it('constructs no AudioContext until unlock is called', () => {
    const engine = new AudioEngine();
    expect(engine.unlocked).toBe(false);
    engine.play('typewriter');
    engine.startAlarm();
    engine.startAmbient();
    expect(engine.unlocked).toBe(false);
    engine.dispose();
  });

  it('persists mute and volume', () => {
    const engine = new AudioEngine();
    engine.setVolume(0.3);
    engine.setMuted(true);
    engine.dispose();

    const revived = new AudioEngine();
    expect(revived.volume).toBeCloseTo(0.3, 5);
    expect(revived.muted).toBe(true);
    revived.dispose();
  });

  it('has no legacy cue left with nothing calling it', () => {
    // `reject` was synthesised and unreferenced; the toy two-tone `alert` was
    // replaced by the sampled, spatial alarm. This asserts the type surface has
    // not quietly regrown either.
    const cues = ['typewriter', 'alert', 'confirm', 'reveal', 'transition', 'footstep'] as const;
    const engine = new AudioEngine();
    engine.unlock();
    for (const cue of cues) expect(() => engine.play(cue)).not.toThrow();
    engine.dispose();
  });
});
