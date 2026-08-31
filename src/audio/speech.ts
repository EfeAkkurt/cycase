/**
 * Dynamic speech, spoken by the browser.
 *
 * The narration in CYCASE is generated at runtime, so it cannot be pre-recorded
 * and it cannot be pre-licensed. The choices are a paid TTS API, a bundled
 * neural model, or the engine every browser already ships. This is the third:
 * `window.speechSynthesis` costs nothing per run, adds nothing to the transfer
 * budget and needs no key. What it costs instead is *quality*, which varies by
 * browser and operating system — the UI says so, in as many words, rather than
 * implying a voice we do not control.
 *
 * Two honest limits, stated here so nothing downstream has to guess:
 *
 * - **Speech is never spatialised.** `speechSynthesis` writes straight to the
 *   system mixer; there is no node to pan. The alarm and the room hardware are
 *   positioned in 3D. Voices are not, and pretending otherwise would be a lie
 *   told in code.
 * - **Speech is never the only channel.** Every line passes through `caption`
 *   first and is published to subscribers whether or not a voice exists. A
 *   player with no voices installed, or with speech muted, loses nothing.
 *
 * The lifecycle bug this API is famous for is `getVoices()` returning `[]` on
 * the first call in almost every browser. It is handled explicitly below: the
 * first line waits a bounded moment for the list to arrive, the chosen voice is
 * then **latched**, and it does not change again for the rest of the session
 * unless the player picks a different one.
 *
 * There is a second gate in front of that one. Browsers refuse to speak before
 * the page has been interacted with, and an utterance thrown at a locked engine
 * is swallowed without firing `onend` — which leaves the app believing a line
 * is still being read. So the director stays **closed** until a real user
 * gesture arms it (`NODELESS_SOC_REDESIGN_2026-08-31.md` §7: "Automatic TTS
 * begins only after **Enter Simulation** or another real user gesture"). It
 * arms itself from the first `pointerdown`/`keydown`/`touchend` on the
 * document, so nothing in the interface has to remember to do it and the player
 * never has to find a control to hear narration. Lines that arrive before the
 * gesture are captioned immediately and held, not dropped.
 *
 * Activation is deliberately **not persisted**. Restoring "they gestured once,
 * last week" from storage would let a fresh page load speak before it was
 * touched, which is the exact thing the gate exists to prevent.
 */

/**
 * Who is speaking, for pace and pitch.
 *
 * There is one in-world assistant, so `colleague` is the only voice narration
 * ever uses. `system` remains for the workstation's own announcements, which
 * are not a character.
 */
export type SpeakerRole = 'colleague' | 'system';

export type SpeechLocale = 'en' | 'tr';

export interface SpeechLine {
  /** Stable id, so a repeat request can identify the line. */
  id: string;
  text: string;
  role: SpeakerRole;
  /**
   * `queued` lets whatever is speaking finish. `interrupt` cancels it — used
   * for a line the player must hear now, and never for flavour.
   */
  priority?: 'queued' | 'interrupt';
}

export interface VoiceOption {
  /** `voiceURI`, which is what gets persisted. */
  uri: string;
  name: string;
  lang: string;
  localService: boolean;
}

export interface SpeechState {
  /** Whether this browser exposes a usable speech engine at all. */
  available: boolean;
  /** Whether a voice has actually been resolved and latched. */
  hasVoice: boolean;
  /**
   * Whether a real user gesture has opened the gate. Session-only: it is never
   * read from or written to storage, so a reload starts closed again.
   */
  activated: boolean;
  speaking: boolean;
  muted: boolean;
  voices: VoiceOption[];
  selectedVoiceUri: string | null;
  /** The current line, always populated — this is the caption contract. */
  caption: SpeechLine | null;
}

/**
 * Delivery profiles. Clarity first: nothing strays far from 1.0, because a
 * cheap system voice degrades fast when it is pushed, and the narration carries
 * teaching content.
 */
export const VOICE_PROFILES: Record<SpeakerRole, { rate: number; pitch: number }> = {
  /**
   * The one in-world assistant. Level and a touch low — a colleague who has
   * just run down a corridor, not a machine.
   */
  colleague: { rate: 0.97, pitch: 0.96 },
  /** The workstation itself. Neutral, and not a character. */
  system: { rate: 1, pitch: 1 },
};

/**
 * How long the first line will wait for `getVoices()` to fill.
 *
 * Bounded, because Safari has historically never fired `voiceschanged` at all,
 * and free because the caption is already on screen. Long enough for Chrome to
 * populate its list, short enough that nobody notices.
 */
export const VOICE_RESOLVE_TIMEOUT_MS = 300;
const VOICE_POLL_MS = 50;

const VOICE_KEY = 'cycase.voice';
const SPEECH_MUTED_KEY = 'cycase.speech_muted';

/** Preferred BCP-47 prefixes per locale, best first. */
const LOCALE_PREFERENCES: Record<SpeechLocale, string[]> = {
  tr: ['tr-tr', 'tr'],
  en: ['en-us', 'en-gb', 'en'],
};

/**
 * Where the first-gesture listeners are attached — `document` in a browser.
 * Narrowed to the two methods actually used so the unit suite, which runs in
 * Node with no DOM at all, can pass a fake and drive the gate.
 */
export interface SpeechGestureTarget {
  addEventListener(
    type: string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    handler: (event: Event) => void,
    options?: EventListenerOptions,
  ): void;
}

export interface SpeechDeps {
  synth: SpeechSynthesis;
  Utterance: typeof SpeechSynthesisUtterance;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Omit to disable self-arming; the gate then only opens via `activate()`. */
  gestureTarget?: SpeechGestureTarget | null;
  /**
   * The language the interface is currently written in, so the automatically
   * chosen voice matches the words on screen. Not the operating system's
   * locale: a Turkish voice reading English copy is worse than a mismatch.
   */
  locale?: SpeechLocale;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (handle: number) => void;
}

/**
 * Maps a BCP-47 tag to the narration locales this app has copy for. Anything
 * unrecognised is English, because that is what the string table contains — a
 * voice speaking a language the text is not written in helps nobody.
 */
export function resolveLocale(tag: string | null | undefined): SpeechLocale {
  return (tag ?? '').trim().toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

/**
 * The gestures that count as "the player is really here". `pointerdown` covers
 * mouse, pen and touch; `touchend` is the belt for older Safari; `keydown`
 * covers a player who never touches a pointing device.
 */
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

/** Held alone, these do not count as user activation in any browser. */
const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta']);

/**
 * Reads the browser's speech engine off `window`, or returns `null` when there
 * is not one. Injected rather than reached for so the unit suite — which runs
 * in Node, with no DOM at all — can drive a fake.
 */
function readableStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  // Accessing `localStorage` throws outright when site data is blocked, so the
  // guard has to be a try/catch rather than a truthiness check.
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function browserSpeechDeps(): SpeechDeps | null {
  if (typeof window === 'undefined') return null;
  const synth = window.speechSynthesis;
  const Utterance = window.SpeechSynthesisUtterance;
  if (!synth || typeof Utterance !== 'function') return null;
  const doc = typeof document === 'undefined' ? null : document;
  return {
    synth,
    Utterance,
    storage: readableStorage(),
    gestureTarget: doc,
    // The document's own language, which is the language the copy is in.
    locale: resolveLocale(doc?.documentElement.lang),
  };
}

type Listener = (state: SpeechState) => void;

export class SpeechDirector {
  private readonly deps: SpeechDeps | null;
  private readonly setTimer: (handler: () => void, ms: number) => number;
  private readonly clearTimer: (handle: number) => void;

  private listeners = new Set<Listener>();
  private disposed = false;

  private voices: VoiceOption[] = [];
  private rawVoices: SpeechSynthesisVoice[] = [];
  /** Latched once chosen. The whole point: the voice must not drift mid-scene. */
  private chosenUri: string | null = null;
  private storedUri: string | null = null;
  private resolved = false;

  private locale: SpeechLocale = 'en';
  private mutedValue = false;
  private speakingValue = false;
  /** Session-only. Never read from, and never written to, storage. */
  private activatedValue = false;
  private current: SpeechLine | null = null;
  /** Lines held while the gate is closed or the voice list is still filling. */
  private pending: SpeechLine[] = [];
  private resolveTimer: number | null = null;
  private pollTimer: number | null = null;
  private gestureAttached = false;

  private onVoicesChanged = () => this.collectVoices();
  private onGesture = (event: Event) => {
    // A modifier held on its own is not user activation anywhere, and arming on
    // one would send the first line at an engine still refusing to speak.
    if (event.type === 'keydown' && MODIFIER_KEYS.has((event as KeyboardEvent).key)) return;
    this.activate();
  };
  private onHidden = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.cancel();
  };
  private onPageHide = () => this.cancel();

  constructor(deps: SpeechDeps | null) {
    this.deps = deps;
    this.setTimer =
      deps?.setTimeout ??
      ((handler, ms) => (globalThis.setTimeout as (h: () => void, m: number) => number)(handler, ms));
    this.clearTimer =
      deps?.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as unknown as number));

    this.storedUri = this.read(VOICE_KEY);
    this.mutedValue = this.read(SPEECH_MUTED_KEY) === 'true';
    this.locale = deps?.locale ?? 'en';

    if (!deps) return;

    this.attachGesture();
    deps.synth.addEventListener?.('voiceschanged', this.onVoicesChanged);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onHidden);
    }
    if (typeof window !== 'undefined') {
      // `pagehide` fires for bfcache navigations where `unload` does not, which
      // is precisely the case where a queued utterance outlives its page.
      window.addEventListener('pagehide', this.onPageHide);
    }

    this.collectVoices();
    if (!this.resolved) this.startResolveWindow();
  }

  /* ---------------- state ---------------- */

  get state(): SpeechState {
    return {
      available: this.deps !== null,
      hasVoice: this.chosenUri !== null,
      activated: this.activatedValue,
      speaking: this.speakingValue,
      muted: this.mutedValue,
      voices: this.voices,
      selectedVoiceUri: this.chosenUri,
      caption: this.current,
    };
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

  /* ---------------- voices ---------------- */

  private collectVoices(): void {
    if (!this.deps) return;
    const raw = this.deps.synth.getVoices() ?? [];
    if (raw.length === 0) return;

    this.rawVoices = [...raw];
    this.voices = raw.map((voice) => ({
      uri: voice.voiceURI,
      name: voice.name,
      lang: voice.lang,
      localService: voice.localService,
    }));

    if (!this.resolved) {
      this.resolved = true;
      this.chosenUri = this.pickVoice();
      this.stopResolveWindow();
      this.flushPending();
    } else if (this.chosenUri && !this.voices.some((v) => v.uri === this.chosenUri)) {
      // The engine re-published its list without the latched voice (a system
      // voice was uninstalled mid-session). Re-pick rather than fall silent.
      this.chosenUri = this.pickVoice();
    }
    this.emit();
  }

  /**
   * Picks in priority order: the player's stored choice, then a local voice in
   * the target language, then any voice in the target language, then whatever
   * the engine calls default.
   *
   * `localService` first is deliberate — a remote voice adds latency the
   * narration cannot absorb, and can fail silently offline.
   */
  private pickVoice(): string | null {
    if (this.voices.length === 0) return null;

    if (this.storedUri) {
      const stored = this.voices.find((voice) => voice.uri === this.storedUri);
      if (stored) return stored.uri;
    }

    const prefixes = LOCALE_PREFERENCES[this.locale];
    for (const prefix of prefixes) {
      const local = this.voices.find(
        (voice) => voice.localService && voice.lang.toLowerCase().startsWith(prefix),
      );
      if (local) return local.uri;
    }
    for (const prefix of prefixes) {
      const any = this.voices.find((voice) => voice.lang.toLowerCase().startsWith(prefix));
      if (any) return any.uri;
    }

    const fallback = this.rawVoices.find((voice) => voice.default) ?? this.rawVoices[0];
    return fallback ? fallback.voiceURI : null;
  }

  /**
   * The bounded wait for a late `voiceschanged`.
   *
   * Chrome fires the event; Safari has historically not, so the poll is the
   * belt to the event's braces. Either way the window closes on its own and the
   * first line goes out — with a voice if one turned up, captioned only if not.
   */
  private startResolveWindow(): void {
    this.pollTimer = this.setTimer(() => this.pollVoices(0), VOICE_POLL_MS);
    this.resolveTimer = this.setTimer(() => {
      if (this.resolved) return;
      this.resolved = true;
      this.chosenUri = this.pickVoice();
      this.stopResolveWindow();
      this.flushPending();
      this.emit();
    }, VOICE_RESOLVE_TIMEOUT_MS);
  }

  private pollVoices(elapsed: number): void {
    this.pollTimer = null;
    if (this.resolved || this.disposed) return;
    this.collectVoices();
    if (this.resolved) return;
    const next = elapsed + VOICE_POLL_MS;
    if (next >= VOICE_RESOLVE_TIMEOUT_MS) return;
    this.pollTimer = this.setTimer(() => this.pollVoices(next), VOICE_POLL_MS);
  }

  private stopResolveWindow(): void {
    if (this.pollTimer !== null) this.clearTimer(this.pollTimer);
    if (this.resolveTimer !== null) this.clearTimer(this.resolveTimer);
    this.pollTimer = null;
    this.resolveTimer = null;
  }

  /** The player's explicit pick. Persisted, and it wins over every heuristic. */
  setVoice(uri: string | null): void {
    this.storedUri = uri;
    this.chosenUri = uri && this.voices.some((voice) => voice.uri === uri) ? uri : this.pickVoice();
    this.write(VOICE_KEY, uri ?? '');
    this.emit();
  }

  setLocale(locale: SpeechLocale): void {
    if (this.locale === locale) return;
    this.locale = locale;
    // A language change is the one thing that may legitimately move the voice.
    if (this.resolved) this.chosenUri = this.pickVoice();
    this.emit();
  }

  /* ---------------- the user-gesture gate ---------------- */

  /**
   * Both locks open: the player has interacted with the page, and the voice
   * list has settled. Everything that speaks checks this and nothing else.
   */
  private get ready(): boolean {
    return this.activatedValue && this.resolved;
  }

  get activated(): boolean {
    return this.activatedValue;
  }

  /**
   * Opens the gate. Idempotent, and safe to call from anywhere — the boot
   * screen calls it beside `audio.unlock()` so the primary path is explicit,
   * and the document listener calls it for every other way in.
   *
   * Whatever was captioned while the gate was closed is spoken now, in the
   * order it arrived, so arming does not cost the player a line.
   */
  activate(): void {
    if (this.disposed || this.activatedValue) return;
    this.activatedValue = true;
    this.detachGesture();
    this.flushPending();
    this.emit();
  }

  private attachGesture(): void {
    const target = this.deps?.gestureTarget;
    if (!target || this.gestureAttached || this.activatedValue) return;
    this.gestureAttached = true;
    for (const type of GESTURE_EVENTS) {
      // Capture, so the gate is open before any handler that narrates as a
      // result of the very same gesture runs. Passive, so it can never delay
      // a scroll or a tap.
      target.addEventListener(type, this.onGesture, { capture: true, passive: true });
    }
  }

  private detachGesture(): void {
    const target = this.deps?.gestureTarget;
    if (!target || !this.gestureAttached) return;
    this.gestureAttached = false;
    for (const type of GESTURE_EVENTS) {
      target.removeEventListener(type, this.onGesture, { capture: true });
    }
  }

  /* ---------------- speaking ---------------- */

  get muted(): boolean {
    return this.mutedValue;
  }

  /** Muting is not "turn the volume down": it stops what is already in flight. */
  setMuted(muted: boolean): void {
    this.mutedValue = muted;
    this.write(SPEECH_MUTED_KEY, String(muted));
    if (muted) this.cancel({ keepCaption: true });
    else this.emit();
  }

  /**
   * Speaks a line — and, whatever happens to the audio, publishes it as the
   * caption. The caption is set before any engine call and is never cleared by
   * a speech failure, which is what makes "captions are always complete" a
   * property of the code rather than a hope.
   */
  speak(line: SpeechLine): void {
    if (this.disposed) return;

    this.current = line;
    this.emit();

    if (this.mutedValue || !this.deps) return;

    if (!this.ready) {
      // Either the page has not been touched yet, or the voice list is still
      // filling. Hold rather than speak: an utterance sent to a locked engine
      // is swallowed without firing `onend`, and one sent before the list
      // settles goes out in a voice that is about to be replaced.
      this.hold(line);
      return;
    }

    this.utter(line);
  }

  /**
   * Queues a held line in arrival order. De-duplicated by id, which is what
   * keeps a replayed idempotency key from speaking twice once the gate opens.
   */
  private hold(line: SpeechLine): void {
    this.pending = this.pending.filter((held) => held.id !== line.id);
    this.pending.push(line);
  }

  /** Re-speaks the current caption. Always allowed; never queues behind itself. */
  repeat(): void {
    const line = this.current;
    if (!line) return;
    if (this.mutedValue || !this.deps) {
      this.emit();
      return;
    }
    this.deps.synth.cancel();
    this.speakingValue = false;
    if (!this.ready) {
      this.pending = [line];
      return;
    }
    this.utter(line);
  }

  /**
   * Stops everything in flight. Called on mute, on unmount, on route change,
   * when the tab is hidden and when the page is put in the back/forward cache —
   * an utterance that outlives its scene is the failure mode this API is worst
   * at, and the only defence is to cancel at every exit.
   */
  cancel(options: { keepCaption?: boolean } = {}): void {
    this.pending = [];
    if (this.deps) this.deps.synth.cancel();
    this.speakingValue = false;
    if (!options.keepCaption) this.current = null;
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopResolveWindow();
    this.detachGesture();
    if (this.deps) {
      this.deps.synth.removeEventListener?.('voiceschanged', this.onVoicesChanged);
      this.deps.synth.cancel();
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onHidden);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.onPageHide);
    }
    this.pending = [];
    this.speakingValue = false;
    this.listeners.clear();
  }

  /**
   * Releases held lines — but only when *both* locks are open. Called from the
   * gesture gate and from each of the two places the voice list can settle, so
   * whichever happens second is the one that actually speaks. Without the
   * guard the voice path would let a line out before the gesture and the gate
   * would be decorative.
   */
  private flushPending(): void {
    if (!this.ready) return;
    const held = this.pending;
    this.pending = [];
    for (const line of held) this.utter(line);
  }

  private utter(line: SpeechLine): void {
    const deps = this.deps;
    if (!deps) return;

    if (line.priority === 'interrupt') deps.synth.cancel();

    const utterance = new deps.Utterance(line.text);
    const profile = VOICE_PROFILES[line.role];
    utterance.rate = profile.rate;
    utterance.pitch = profile.pitch;

    const voice = this.rawVoices.find((candidate) => candidate.voiceURI === this.chosenUri);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }

    utterance.onstart = () => {
      this.speakingValue = true;
      this.emit();
    };
    const finish = () => {
      this.speakingValue = false;
      this.emit();
    };
    utterance.onend = finish;
    // A failed utterance must not leave the app believing it is still talking,
    // and must never surface as an error: the caption already carried the line.
    utterance.onerror = finish;

    deps.synth.speak(utterance);
  }

  /* ---------------- storage ---------------- */

  private read(key: string): string | null {
    try {
      const value = this.deps?.storage?.getItem(key) ?? null;
      return value === '' ? null : value;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.deps?.storage?.setItem(key, value);
    } catch {
      // Preference simply does not persist.
    }
  }
}
