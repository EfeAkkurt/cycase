import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveLocale,
  SpeechDirector,
  VOICE_PROFILES,
  VOICE_RESOLVE_TIMEOUT_MS,
  type SpeechDeps,
  type SpeechLine,
} from '../../src/audio/speech';

/**
 * `speechSynthesis` is a small API with a long list of ways to lose an
 * utterance, and every one of them is a way to lose narration the player needs.
 * The failures tested here are the real ones:
 *
 * - `getVoices()` returns `[]` on the first call in almost every browser, so a
 *   naive implementation either speaks in the wrong voice or never speaks;
 * - the voice then changes between lines, which sounds like two characters;
 * - an utterance survives a mute, an unmount, a hidden tab or a navigation and
 *   keeps talking over whatever comes next;
 * - the browser has no voices at all and the app throws instead of captioning;
 * - a line is thrown at an engine the browser has not unlocked yet, which
 *   swallows it without ever firing `onend` — so the app believes it is still
 *   talking and the player hears nothing.
 *
 * The engine is injected rather than read off `window`, because the unit suite
 * runs in Node — and because a fake is the only way to assert what was *queued*
 * rather than what was heard.
 */

/* ------------------------------------------------------------------ *
 * A recording speechSynthesis fake
 * ------------------------------------------------------------------ */

interface FakeUtteranceShape {
  text: string;
  rate: number;
  pitch: number;
  lang: string;
  voice: SpeechSynthesisVoice | null;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function makeVoice(
  name: string,
  lang: string,
  localService: boolean,
  isDefault = false,
): SpeechSynthesisVoice {
  return {
    voiceURI: `urn:${name}`,
    name,
    lang,
    localService,
    default: isDefault,
  } as SpeechSynthesisVoice;
}

class FakeSynth {
  spoken: FakeUtteranceShape[] = [];
  cancels = 0;
  private voices: SpeechSynthesisVoice[] = [];
  private handlers = new Set<() => void>();

  constructor(voices: SpeechSynthesisVoice[] = []) {
    this.voices = voices;
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.voices;
  }

  /** What a browser does a few hundred milliseconds after page load. */
  publishVoices(voices: SpeechSynthesisVoice[]): void {
    this.voices = voices;
    for (const handler of [...this.handlers]) handler();
  }

  addEventListener(_type: string, handler: () => void): void {
    this.handlers.add(handler);
  }

  removeEventListener(_type: string, handler: () => void): void {
    this.handlers.delete(handler);
  }

  speak(utterance: FakeUtteranceShape): void {
    this.spoken.push(utterance);
    utterance.onstart?.();
  }

  finishCurrent(): void {
    this.spoken.at(-1)?.onend?.();
  }

  cancel(): void {
    this.cancels += 1;
  }
}

class FakeUtterance implements FakeUtteranceShape {
  rate = 1;
  pitch = 1;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  text: string;

  // A parameter property would be erased syntax; this project forbids that.
  constructor(text: string) {
    this.text = text;
  }
}

/**
 * Stands in for `document`. The unit suite runs with `environment: 'node'`, so
 * there is no DOM to dispatch a real `pointerdown` at — the director takes the
 * target as a dependency precisely so the self-arming path is testable rather
 * than taken on trust.
 */
class FakeGestureTarget {
  private handlers = new Map<string, Set<(event: Event) => void>>();

  addEventListener(type: string, handler: (event: Event) => void): void {
    const set = this.handlers.get(type) ?? new Set<(event: Event) => void>();
    set.add(handler);
    this.handlers.set(type, set);
  }

  removeEventListener(type: string, handler: (event: Event) => void): void {
    this.handlers.get(type)?.delete(handler);
  }

  /** Live listeners, so "it lets go once armed" is a checkable fact. */
  get listenerCount(): number {
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }

  dispatch(type: string, extra: Record<string, unknown> = {}): void {
    for (const handler of [...(this.handlers.get(type) ?? [])]) {
      handler({ type, ...extra } as unknown as Event);
    }
  }
}

/** A storage fake that survives being handed to two directors in a row. */
function makeStorage(): Pick<Storage, 'getItem' | 'setItem'> & { keys: () => string[] } {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    keys: () => [...store.keys()],
  };
}

function makeDeps(synth: FakeSynth, extra: Partial<SpeechDeps> = {}): SpeechDeps {
  return {
    synth: synth as unknown as SpeechSynthesis,
    Utterance: FakeUtterance as unknown as typeof SpeechSynthesisUtterance,
    storage: makeStorage(),
    ...extra,
  };
}

/**
 * A director with the user-gesture gate already open.
 *
 * Every suite below except `the user-gesture gate` is about what happens once
 * the player is really here, so they arm explicitly rather than leaving the
 * precondition implied. The gate itself is tested on its own terms.
 */
function armed(deps: SpeechDeps): SpeechDirector {
  const director = new SpeechDirector(deps);
  director.activate();
  return director;
}

const TURKISH = makeVoice('Yelda', 'tr-TR', true);
const US = makeVoice('Samantha', 'en-US', true, true);
const UK_REMOTE = makeVoice('Daniel Online', 'en-GB', false);
const FRENCH = makeVoice('Amelie', 'fr-FR', true);

const line = (id: string, text = 'Identity services are unreachable.'): SpeechLine => ({
  id,
  text,
  role: 'colleague',
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/* ------------------------------------------------------------------ *
 * The user-gesture gate
 *
 * `NODELESS_SOC_REDESIGN_2026-08-31.md` §7: "Automatic TTS begins only after
 * Enter Simulation or another real user gesture." Two failures live here, and
 * they pull in opposite directions:
 *
 *  - speak too early and the browser swallows the utterance without firing
 *    `onend`, so the app believes it is talking and the player hears nothing;
 *  - make the gate something the player has to find and narration never starts
 *    at all, which is the requirement the same section is written against.
 *
 * The gate therefore holds rather than drops, and arms itself.
 * ------------------------------------------------------------------ */

describe('the user-gesture gate', () => {
  it('says nothing before a gesture, and captions every word regardless', () => {
    const synth = new FakeSynth([US]);
    const director = new SpeechDirector(makeDeps(synth));

    expect(director.state.activated).toBe(false);
    director.speak(line('l1', 'The account is still signed in.'));

    // Silent, because the browser has not unlocked the engine…
    expect(synth.spoken).toHaveLength(0);
    // …and complete, because the caption never depended on the voice.
    expect(director.state.caption?.text).toBe('The account is still signed in.');
    director.dispose();
  });

  it('speaks what it held, in arrival order, the moment the gesture lands', () => {
    const synth = new FakeSynth([US]);
    const director = new SpeechDirector(makeDeps(synth));

    director.speak(line('l1', 'First.'));
    director.speak(line('l2', 'Second.'));
    expect(synth.spoken).toHaveLength(0);

    director.activate();

    expect(director.state.activated).toBe(true);
    expect(synth.spoken.map((utterance) => utterance.text)).toEqual(['First.', 'Second.']);
    director.dispose();
  });

  it('arms itself from the first pointer event, so nothing has to remember to', () => {
    // The requirement is that the player never hunts for a control. The boot
    // screen calls `activate()` too, but this is what covers every other way
    // in: a click on Skip intro, a resumed session, a keyboard-only player.
    const synth = new FakeSynth([US]);
    const gestureTarget = new FakeGestureTarget();
    const director = new SpeechDirector(makeDeps(synth, { gestureTarget }));

    director.speak(line('l1'));
    expect(synth.spoken).toHaveLength(0);

    gestureTarget.dispatch('pointerdown');

    expect(director.state.activated).toBe(true);
    expect(synth.spoken).toHaveLength(1);
    // And it lets go of the document once it has what it needs.
    expect(gestureTarget.listenerCount).toBe(0);
    director.dispose();
  });

  it('arms from a keypress, but not from a modifier held on its own', () => {
    const synth = new FakeSynth([US]);
    const gestureTarget = new FakeGestureTarget();
    const director = new SpeechDirector(makeDeps(synth, { gestureTarget }));

    // Shift alone is not user activation in any browser; arming on it would
    // send the first line at an engine still refusing to speak.
    gestureTarget.dispatch('keydown', { key: 'Shift' });
    expect(director.state.activated).toBe(false);

    gestureTarget.dispatch('keydown', { key: 'Enter' });
    expect(director.state.activated).toBe(true);
    director.dispose();
  });

  it('arming twice does not speak a held line twice', () => {
    const synth = new FakeSynth([US]);
    const gestureTarget = new FakeGestureTarget();
    const director = new SpeechDirector(makeDeps(synth, { gestureTarget }));

    director.speak(line('l1'));
    // The boot screen's explicit call and the document listener both fire for
    // the same click. Idempotent, so the line still goes out once.
    director.activate();
    gestureTarget.dispatch('pointerdown');
    director.activate();

    expect(synth.spoken).toHaveLength(1);
    director.dispose();
  });

  it('holds a duplicate id once, so a replayed key does not repeat when the gate opens', () => {
    const synth = new FakeSynth([US]);
    const director = new SpeechDirector(makeDeps(synth));

    director.speak(line('l1'));
    director.speak(line('l1'));
    director.activate();

    expect(synth.spoken).toHaveLength(1);
    director.dispose();
  });

  it('both locks must open: a late voice list does not let a line out early', () => {
    // The gate would be decorative if the voice-resolution path flushed on its
    // own, so this is the assertion that keeps it real.
    const synth = new FakeSynth([]);
    const director = new SpeechDirector(makeDeps(synth));

    director.speak(line('l1'));
    synth.publishVoices([US]);
    expect(synth.spoken).toHaveLength(0);

    // …and neither does the bounded window closing by itself.
    vi.advanceTimersByTime(VOICE_RESOLVE_TIMEOUT_MS + 10);
    expect(synth.spoken).toHaveLength(0);

    director.activate();
    expect(synth.spoken).toHaveLength(1);
    director.dispose();
  });

  it('never persists activation: a reload starts closed again', () => {
    // Restoring "they gestured once, last week" would let a fresh page load
    // speak before it was touched, which is the whole point of the gate.
    const storage = makeStorage();
    const deps = makeDeps(new FakeSynth([US]), { storage });
    const first = new SpeechDirector(deps);
    first.activate();
    first.setVoice(US.voiceURI);
    expect(first.state.activated).toBe(true);
    first.dispose();

    expect(storage.keys().some((key) => key.includes('activ'))).toBe(false);

    const second = new SpeechDirector(deps);
    expect(second.state.activated).toBe(false);
    // The voice preference does persist; only the gesture does not.
    expect(second.state.selectedVoiceUri).toBe(US.voiceURI);
    second.dispose();
  });

  it('is inert, not fatal, in a browser with no speech engine', () => {
    const director = new SpeechDirector(null);
    expect(() => director.activate()).not.toThrow();
    director.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * The voices-arrive-late lifecycle
 * ------------------------------------------------------------------ */

describe('the voiceschanged lifecycle', () => {
  it('holds the first line until the voice list arrives, then speaks it', () => {
    // The state every browser starts in: the engine exists, the list is empty.
    const synth = new FakeSynth([]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1'));
    // Nothing spoken yet — but the caption is already published, which is why
    // the wait costs the player nothing.
    expect(synth.spoken).toHaveLength(0);
    expect(director.state.caption?.id).toBe('l1');

    synth.publishVoices([US, UK_REMOTE, FRENCH]);

    expect(synth.spoken).toHaveLength(1);
    expect(synth.spoken[0]!.voice).toBe(US);
    director.dispose();
  });

  it('gives up on its own if voiceschanged never fires, and speaks anyway', () => {
    // Safari has historically never fired the event. The bounded window is the
    // only reason the first line is not held forever — and when it closes with
    // an empty list the line still goes out, unnamed, on whatever the engine
    // treats as its default. A held line is a lost line; that is the failure
    // this window exists to prevent.
    const synth = new FakeSynth([]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1'));
    expect(synth.spoken).toHaveLength(0);

    vi.advanceTimersByTime(VOICE_RESOLVE_TIMEOUT_MS + 10);

    expect(director.state.caption?.id).toBe('l1');
    expect(director.state.hasVoice).toBe(false);
    expect(synth.spoken).toHaveLength(1);
    // Nothing is asserted about the voice, because there is nothing to name.
    expect(synth.spoken[0]!.voice).toBeNull();
    director.dispose();
  });

  it('picks up a list that appears only through the poll, not the event', () => {
    const synth = new FakeSynth([]);
    const director = armed(makeDeps(synth));

    // Swap the list in without notifying anyone. Only the poll can see this.
    (synth as unknown as { voices: SpeechSynthesisVoice[] }).voices = [US];
    vi.advanceTimersByTime(60);

    expect(director.state.hasVoice).toBe(true);
    expect(director.state.selectedVoiceUri).toBe(US.voiceURI);
    director.dispose();
  });

  it('latches the voice: it does not change between lines', () => {
    const synth = new FakeSynth([]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1'));
    synth.publishVoices([US, UK_REMOTE]);
    synth.finishCurrent();

    // A second publication — engines do re-emit — must not move the voice.
    synth.publishVoices([UK_REMOTE, US, FRENCH]);
    director.speak(line('l2'));
    synth.finishCurrent();
    director.speak(line('l3'));

    const used = synth.spoken.map((utterance) => utterance.voice);
    expect(used).toHaveLength(3);
    expect(new Set(used).size).toBe(1);
    expect(used[0]).toBe(US);
    director.dispose();
  });
});

describe('voice preference', () => {
  it('prefers a local voice in the target language', () => {
    const synth = new FakeSynth([UK_REMOTE, FRENCH, US]);
    const director = armed(makeDeps(synth));
    // en-US local beats en-GB remote, and neither loses to fr-FR.
    expect(director.state.selectedVoiceUri).toBe(US.voiceURI);
    director.dispose();
  });

  it('prefers tr-TR once the locale is Turkish', () => {
    const synth = new FakeSynth([US, TURKISH]);
    const director = armed(makeDeps(synth));
    expect(director.state.selectedVoiceUri).toBe(US.voiceURI);

    director.setLocale('tr');
    expect(director.state.selectedVoiceUri).toBe(TURKISH.voiceURI);
    director.dispose();
  });

  it("takes the interface's language from its dependencies, not the machine's", () => {
    // "Prefer a local voice matching the current language automatically" (§7).
    // Current language means the language the copy on screen is written in —
    // the document's — because a Turkish voice reading English text is worse
    // than no match at all.
    const synth = new FakeSynth([US, TURKISH]);
    const director = armed(makeDeps(synth, { locale: 'tr' }));
    expect(director.state.selectedVoiceUri).toBe(TURKISH.voiceURI);
    director.dispose();
  });

  it('reads a document language tag, and treats anything unknown as English', () => {
    expect(resolveLocale('tr')).toBe('tr');
    expect(resolveLocale('TR-tr')).toBe('tr');
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('de-DE')).toBe('en');
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale('')).toBe('en');
  });

  it('falls back to the engine default when nothing matches', () => {
    const synth = new FakeSynth([FRENCH, US]);
    const director = armed(makeDeps(synth));
    director.setLocale('tr');
    // No Turkish voice at all: the engine's own default, not silence.
    expect(director.state.selectedVoiceUri).toBe(US.voiceURI);
    director.dispose();
  });

  it("an explicit choice wins, persists, and survives a fresh director", () => {
    const deps = makeDeps(new FakeSynth([US, UK_REMOTE]));
    const first = armed(deps);
    first.setVoice(UK_REMOTE.voiceURI);
    expect(first.state.selectedVoiceUri).toBe(UK_REMOTE.voiceURI);
    first.dispose();

    const second = armed({ ...deps, synth: deps.synth });
    expect(second.state.selectedVoiceUri).toBe(UK_REMOTE.voiceURI);
    second.dispose();
  });

  it('re-picks rather than falling silent if the latched voice disappears', () => {
    const synth = new FakeSynth([UK_REMOTE]);
    const director = armed(makeDeps(synth));
    expect(director.state.selectedVoiceUri).toBe(UK_REMOTE.voiceURI);

    // A system voice was uninstalled mid-session.
    synth.publishVoices([US]);
    expect(director.state.selectedVoiceUri).toBe(US.voiceURI);
    director.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * Delivery
 * ------------------------------------------------------------------ */

describe('delivery', () => {
  /*
   * This test used to assert that `companion` and `colleague` sounded like two
   * different characters. That was NODE, and it is gone.
   * `NODELESS_SOC_REDESIGN_2026-08-31.md` §1 requires removing the `companion`
   * speaker along with "UI labels, current-contract language and active tests",
   * and §10 gates on "No NODE mesh, label, speaker, current beat or active
   * contract remains". So the assertion is inverted: the profile that made a
   * second persona audible must not exist.
   */
  it('has no companion profile: there is one assistant, and she is a person', () => {
    expect(Object.keys(VOICE_PROFILES)).not.toContain('companion');
    expect(Object.keys(VOICE_PROFILES).sort()).toEqual(['colleague', 'system']);
  });

  it('keeps the assistant and the workstation distinguishable, and both legible', () => {
    const synth = new FakeSynth([US]);
    const director = armed(makeDeps(synth));

    director.speak({ id: 'a', text: 'Three systems are affected.', role: 'colleague' });
    synth.finishCurrent();
    director.speak({ id: 'b', text: 'Evidence collected.', role: 'system' });

    const [colleague, system] = synth.spoken;
    expect(colleague!.rate).not.toBe(system!.rate);
    expect(colleague!.pitch).not.toBe(system!.pitch);

    // Distinguishable, but never at the cost of intelligibility: a cheap system
    // voice degrades badly outside this band, and the narration teaches.
    for (const profile of Object.values(VOICE_PROFILES)) {
      expect(profile.rate).toBeGreaterThanOrEqual(0.9);
      expect(profile.rate).toBeLessThanOrEqual(1.15);
      expect(profile.pitch).toBeGreaterThanOrEqual(0.9);
      expect(profile.pitch).toBeLessThanOrEqual(1.2);
    }
    director.dispose();
  });

  it('lets a normal line finish and cancels only for a deliberate interrupt', () => {
    const synth = new FakeSynth([US]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1'));
    const cancelsAfterFirst = synth.cancels;

    director.speak(line('l2'));
    expect(synth.cancels).toBe(cancelsAfterFirst);

    director.speak({ ...line('l3'), priority: 'interrupt' });
    expect(synth.cancels).toBe(cancelsAfterFirst + 1);
    director.dispose();
  });

  it('repeats the current line on demand, without queueing behind itself', () => {
    const synth = new FakeSynth([US]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1', 'Say that again.'));
    director.repeat();
    director.repeat();

    expect(synth.spoken).toHaveLength(3);
    expect(synth.spoken.every((utterance) => utterance.text === 'Say that again.')).toBe(true);
    // Each repeat clears what was in flight rather than stacking three voices.
    expect(synth.cancels).toBeGreaterThanOrEqual(2);
    director.dispose();
  });

  it('repeats a line that is still being held for the voice list', () => {
    const synth = new FakeSynth([]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1'));
    director.repeat();
    synth.publishVoices([US]);

    // Held once, not twice: a repeat replaces the pending line.
    expect(synth.spoken).toHaveLength(1);
    director.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * Nothing may leak
 * ------------------------------------------------------------------ */

describe('speech never leaks', () => {
  it('mute cancels what is already in flight', () => {
    const synth = new FakeSynth([US]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1'));
    const before = synth.cancels;
    director.setMuted(true);
    expect(synth.cancels).toBe(before + 1);

    // And nothing further is spoken while muted…
    director.speak(line('l2'));
    expect(synth.spoken).toHaveLength(1);
    // …though the caption still carries every word.
    expect(director.state.caption?.id).toBe('l2');
    director.dispose();
  });

  it('narration off is silence, never a shorter caption', () => {
    // §7: "When narration is off or `speechSynthesis` is unavailable, captions
    // remain complete." A returning player who switched it off last session
    // starts here, and must still be able to read the whole case.
    const storage = makeStorage();
    storage.setItem('cycase.speech_muted', 'true');
    const synth = new FakeSynth([US]);
    const director = armed(makeDeps(synth, { storage }));

    expect(director.state.muted).toBe(true);

    const seen: string[] = [];
    const off = director.subscribe((state) => {
      if (state.caption) seen.push(state.caption.text);
    });
    director.speak(line('l1', 'The stolen session is revoked.'));
    director.speak(line('l2', 'The endpoint is still sending traffic.'));
    off();

    expect(synth.spoken).toHaveLength(0);
    expect(seen).toEqual([
      'The stolen session is revoked.',
      'The endpoint is still sending traffic.',
    ]);
    director.dispose();
  });

  it('unmount cancels and detaches', () => {
    const synth = new FakeSynth([US]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1'));
    const before = synth.cancels;
    director.dispose();

    expect(synth.cancels).toBe(before + 1);
    // A disposed director is inert: a late callback cannot revive it.
    director.speak(line('l2'));
    expect(synth.spoken).toHaveLength(1);
  });

  it('a route change cancels: the next scene starts silent', () => {
    const synth = new FakeSynth([US]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1'));
    // What the UI calls when the scene changes.
    director.cancel();

    expect(synth.cancels).toBeGreaterThan(0);
    expect(director.state.caption).toBeNull();
    expect(director.state.speaking).toBe(false);
    director.dispose();
  });

  it('an utterance that errors does not leave the app believing it is talking', () => {
    const synth = new FakeSynth([US]);
    const director = armed(makeDeps(synth));

    director.speak(line('l1'));
    expect(director.state.speaking).toBe(true);

    synth.spoken.at(-1)!.onerror?.();
    expect(director.state.speaking).toBe(false);
    // The line is still on screen. A speech failure is not a content failure.
    expect(director.state.caption?.id).toBe('l1');
    director.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * No engine at all
 * ------------------------------------------------------------------ */

describe('a browser with no speech engine', () => {
  it('captions everything and raises nothing', () => {
    const director = new SpeechDirector(null);

    expect(director.state.available).toBe(false);
    expect(director.state.voices).toEqual([]);

    expect(() => {
      director.activate();
      director.speak(line('l1', 'Identity services are unreachable.'));
      director.repeat();
      director.setVoice('urn:nothing');
      director.setLocale('tr');
      director.setMuted(true);
      director.setMuted(false);
      director.cancel();
      director.dispose();
    }).not.toThrow();
  });

  it('still publishes the full caption for every line', () => {
    const director = new SpeechDirector(null);
    const seen: (string | null)[] = [];
    const off = director.subscribe((state) => seen.push(state.caption?.text ?? null));

    director.speak(line('l1', 'The account is still signed in.'));
    off();

    // Gameplay-critical text is never gated on a voice existing.
    expect(seen).toContain('The account is still signed in.');
    director.dispose();
  });
});
