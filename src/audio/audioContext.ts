import { createContext, useContext } from 'react';

import type { AlarmStatus, Cue } from './engine';

/**
 * Context and hook only — no components. Keeps this module eligible for React
 * Fast Refresh, so editing the provider can never recreate the context
 * identity underneath consumers. Same split as `app/gameContext.ts`.
 */

/**
 * The alarm, as the interface sees it.
 *
 * Every method is idempotent and every one is stable across renders, so a
 * component may call `start()` from an effect without guarding it: starting a
 * sounding alarm, or acknowledging an acknowledged one, does nothing.
 */
export interface AlarmBinding {
  status: AlarmStatus;
  /** Begin the sequence. No-op once sounding or acknowledged. */
  start: () => void;
  /** Stop it immediately and latch it shut. */
  acknowledge: () => void;
  /** Reopen it for a fresh case. */
  reset: () => void;
}

export interface AudioBinding {
  play: (cue: Cue) => void;
  unlock: () => void;
  startAmbient: () => void;
  stopAmbient: () => void;
  alarm: AlarmBinding;
  muted: boolean;
  volume: number;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  unlocked: boolean;
}

export const AudioBindingContext = createContext<AudioBinding | null>(null);

export function useAudio(): AudioBinding {
  const binding = useContext(AudioBindingContext);
  if (!binding) throw new Error('useAudio must be used inside <AudioProvider>.');
  return binding;
}
