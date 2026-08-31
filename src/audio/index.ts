/**
 * The audio and narration layer's public surface.
 *
 * The interface workstreams consume this module and nothing deeper. Two things
 * are worth knowing before wiring anything to it:
 *
 * 1. **The alarm is idempotent at every entry point.** `alarm.start()`,
 *    `alarm.acknowledge()` and `speech.repeat()` are all safe to call from a
 *    render-driven effect without a guard.
 * 2. **Speech is an enhancement, never a channel of record.** `speech.caption`
 *    is populated for every line whether or not a voice exists, and it is what
 *    the dialogue panel must render. `speech.available` and `speech.hasVoice`
 *    say whether anything was actually spoken; nothing gameplay-critical may
 *    depend on them.
 */

export { AudioProvider } from './AudioProvider';
export { VoiceSettings } from './VoiceSettings';
export { useAudio, type AlarmBinding, type AudioBinding } from './audioContext';
export { useSpeech, type SpeechBinding } from './speechContext';
export { AudioEngine, type AlarmPhase, type AlarmStatus, type Cue } from './engine';
export {
  SpeechDirector,
  browserSpeechDeps,
  VOICE_PROFILES,
  VOICE_RESOLVE_TIMEOUT_MS,
  type SpeakerRole,
  type SpeechLine,
  type SpeechLocale,
  type SpeechState,
  type VoiceOption,
} from './speech';
export { ALARM_ASSETS, INSTALLED_ALARM_ASSETS, type AlarmAssetSpec } from './manifest';
export { measurePeak, type PeakMeasurement } from './diagnostics';
export { ALARM_EMITTER, LISTENER_POSITION, listenerOrientation } from './spatial';
