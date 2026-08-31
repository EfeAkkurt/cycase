import { createContext, useContext } from 'react';

import type { SpeechLine, SpeechLocale, SpeechState } from './speech';

/**
 * Context and hook only — no components, so this module stays eligible for
 * React Fast Refresh. Same split as `audio/audioContext.ts` and
 * `app/gameContext.ts`.
 */

export interface SpeechBinding extends SpeechState {
  /**
   * Open the user-gesture gate. Idempotent, and already wired to the first
   * pointer or key event on the document — the boot screen calls it too so the
   * `Enter Simulation` path is explicit rather than incidental.
   */
  activate: () => void;
  /** Speak a line. The caption is published whether or not a voice exists. */
  speak: (line: SpeechLine) => void;
  /** Re-speak the current caption. */
  repeat: () => void;
  /** Stop anything in flight and clear the caption. */
  cancel: () => void;
  setMuted: (muted: boolean) => void;
  setVoice: (uri: string | null) => void;
  setLocale: (locale: SpeechLocale) => void;
}

/**
 * The binding used before the director exists (one render at mount) and in a
 * browser with no speech engine. Captions still work; nothing throws.
 */
export const SILENT_SPEECH: SpeechBinding = {
  available: false,
  hasVoice: false,
  activated: false,
  speaking: false,
  muted: false,
  voices: [],
  selectedVoiceUri: null,
  caption: null,
  activate: () => undefined,
  speak: () => undefined,
  repeat: () => undefined,
  cancel: () => undefined,
  setMuted: () => undefined,
  setVoice: () => undefined,
  setLocale: () => undefined,
};

export const SpeechBindingContext = createContext<SpeechBinding>(SILENT_SPEECH);

/**
 * Never throws when used outside a provider: speech is an enhancement, and a
 * component that only wants the caption should not have to care whether the
 * narration layer is mounted.
 */
export function useSpeech(): SpeechBinding {
  return useContext(SpeechBindingContext);
}
