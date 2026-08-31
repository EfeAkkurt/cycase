import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { AudioBindingContext, type AlarmBinding, type AudioBinding } from './audioContext';
// A real import, not a side-effect one: the module publishes the read-only
// diagnostics surface on `window`, and without a used binding it is tree-shaken
// out of the bundle — the same reasoning as `main.tsx`'s import of `buildInfo`.
import { INSTALLED_AUDIO, measurePeak } from './diagnostics';
import { AudioEngine, type AlarmStatus } from './engine';
import { browserSpeechDeps, SpeechDirector, type SpeechState } from './speech';
import { SpeechBindingContext, SILENT_SPEECH, type SpeechBinding } from './speechContext';

/** Component-only module; hooks live in `audioContext.ts` / `speechContext.ts`. */
export function AudioProvider({ children }: { children: ReactNode }) {
  const engine = useMemo(() => new AudioEngine(), []);
  const [muted, setMutedState] = useState(engine.muted);
  const [volume, setVolumeState] = useState(engine.volume);
  const [unlocked, setUnlocked] = useState(false);
  const [alarmStatus, setAlarmStatus] = useState<AlarmStatus>(() => engine.alarmStatus);

  useEffect(() => engine.onAlarmChange(setAlarmStatus), [engine]);
  useEffect(() => () => engine.dispose(), [engine]);

  // Read-only reporting for the E2E suite, alongside the peak measurement the
  // diagnostics module publishes. Nothing here can start, stop or change a
  // sound; it only says what the engine believes, so a test can check that
  // belief against whether the sample files are really on the server.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__CYCASE_AUDIO__ = {
      measurePeak,
      installedAudio: INSTALLED_AUDIO,
      ...window.__CYCASE_AUDIO__,
      alarmStatus: () => engine.alarmStatus,
    };
  }, [engine]);

  /*
   * The alarm controls are memoised on `engine` alone, deliberately. The
   * binding below is rebuilt whenever mute or volume moves; if `start` were
   * rebuilt with it, an effect in the office that depends on it would re-run on
   * every volume tick. `start` is idempotent anyway, but an unstable identity
   * is how "a re-render must not start the sound twice" gets quietly broken.
   */
  const alarm = useMemo<Omit<AlarmBinding, 'status'>>(
    () => ({
      start: () => engine.startAlarm(),
      acknowledge: () => engine.acknowledgeAlarm(),
      reset: () => engine.resetAlarm(),
    }),
    [engine],
  );

  const binding = useMemo<AudioBinding>(
    () => ({
      play: (cue) => engine.play(cue),
      unlock: () => {
        engine.unlock();
        setUnlocked(engine.unlocked);
      },
      startAmbient: () => engine.startAmbient(),
      stopAmbient: () => engine.stopAmbient(),
      alarm: { ...alarm, status: alarmStatus },
      muted,
      volume,
      unlocked,
      setMuted: (next) => {
        engine.setMuted(next);
        setMutedState(next);
      },
      setVolume: (next) => {
        engine.setVolume(next);
        setVolumeState(next);
      },
    }),
    [engine, alarm, alarmStatus, muted, volume, unlocked],
  );

  return (
    <AudioBindingContext.Provider value={binding}>
      <SpeechLayer engine={engine}>{children}</SpeechLayer>
    </AudioBindingContext.Provider>
  );
}

/**
 * The narration layer, mounted inside the audio provider so it can duck the
 * scene while a line is being spoken. It lives here rather than in `main.tsx`
 * so the whole tree gets `useSpeech()` without another provider in the root.
 *
 * The director is created *inside* the effect on purpose. Under StrictMode
 * React mounts, unmounts and remounts every component in development; a
 * director built in `useMemo` would be disposed by that first teardown and
 * silently never speak again. Creating and destroying it with the effect makes
 * the remount produce a live one.
 */
function SpeechLayer({ engine, children }: { engine: AudioEngine; children: ReactNode }) {
  const [director, setDirector] = useState<SpeechDirector | null>(null);
  const [state, setState] = useState<SpeechState | null>(null);

  useEffect(() => {
    const instance = new SpeechDirector(browserSpeechDeps());
    setDirector(instance);
    const unsubscribe = instance.subscribe(setState);
    return () => {
      unsubscribe();
      instance.dispose();
      setDirector(null);
      setState(null);
    };
  }, []);

  // Automatic ducking: browser speech goes to the system mixer, not our graph,
  // so the graph is the side that moves out of its way.
  useEffect(() => {
    engine.setSpeaking(state?.speaking ?? false);
  }, [engine, state?.speaking]);

  const activate = useCallback(() => director?.activate(), [director]);
  const speak = useCallback((line: Parameters<SpeechDirector['speak']>[0]) => director?.speak(line), [director]);
  const repeat = useCallback(() => director?.repeat(), [director]);
  const cancel = useCallback(() => director?.cancel(), [director]);
  const setMuted = useCallback((next: boolean) => director?.setMuted(next), [director]);
  const setVoice = useCallback((uri: string | null) => director?.setVoice(uri), [director]);
  const setLocale = useCallback(
    (locale: Parameters<SpeechDirector['setLocale']>[0]) => director?.setLocale(locale),
    [director],
  );

  const binding = useMemo<SpeechBinding>(
    () =>
      state
        ? { ...state, activate, speak, repeat, cancel, setMuted, setVoice, setLocale }
        : SILENT_SPEECH,
    [state, activate, speak, repeat, cancel, setMuted, setVoice, setLocale],
  );

  return <SpeechBindingContext.Provider value={binding}>{children}</SpeechBindingContext.Provider>;
}
