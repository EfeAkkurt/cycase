import { useId } from 'react';

import { t } from '../i18n';
import { useSpeech } from './speechContext';

/**
 * The narration control.
 *
 * One primary switch — **Narration on/off** — and nothing else in the top bar.
 * `NODELESS_SOC_REDESIGN_2026-08-31.md` §7 is explicit about the shape: "One
 * primary toggle: Narration on/off. Mute and volume remain global sound
 * controls… Move the long operating-system voice list under Advanced settings."
 * So the operating system's voice list — which on a stocked machine is dozens
 * of entries long, none of which the player has any reason to care about — sits
 * behind a closed disclosure, and the room's mute and volume stay where they
 * were, in `SettingsBar`.
 *
 * This lives in `src/audio/` rather than in the office chrome so the settings
 * surface and the engine ship together; the chrome drops `<VoiceSettings />` in
 * beside the mute and volume controls and gets the whole thing, including its
 * accessibility behaviour.
 *
 * Three requirements are visible in the markup rather than assumed:
 *
 * - **It tells the truth.** Browser speech quality genuinely depends on the
 *   browser and the operating system, and the note says exactly that instead of
 *   implying a voice we produced.
 * - **It disappears when there is nothing to choose.** A browser with no voices
 *   gets the note, not a broken empty `select` — and the captions carry on.
 * - **It never claims to be spatial.** The alarm is positioned in the room; the
 *   voice is not, and no copy here suggests otherwise.
 *
 * The toggle writes through the speech engine, which owns and persists the one
 * `cycase.speech_muted` preference. The caption's own "Stop voice" writes to
 * the same place, so the two are one control seen from two rooms rather than
 * two switches that can disagree.
 */
export function VoiceSettings() {
  const speech = useSpeech();
  const selectId = useId();
  const noteId = useId();

  const hasChoices = speech.voices.length > 0;

  return (
    <div className="voice-settings" role="group" aria-label={t('settings.narration')}>
      <button
        type="button"
        className="voice-settings__toggle"
        aria-pressed={!speech.muted}
        onClick={() => speech.setMuted(!speech.muted)}
      >
        {speech.muted ? t('settings.narration_off') : t('settings.narration_on')}
      </button>

      {/*
       * Closed by default, and a real `<details>` rather than a scripted
       * accordion: keyboard-operable, screen-reader-announced and expandable
       * with no JavaScript at all.
       *
       * Rendered only when the engine has voices to offer. An empty disclosure
       * promising settings that are not there is worse than no disclosure.
       */}
      {hasChoices ? (
        <details className="voice-settings__advanced">
          <summary className="voice-settings__summary">{t('settings.advanced')}</summary>
          <div className="voice-settings__advanced-body">
            <label className="voice-settings__field" htmlFor={selectId}>
              <span className="voice-settings__label">{t('settings.voice')}</span>
              <select
                id={selectId}
                className="voice-settings__select"
                aria-describedby={noteId}
                value={speech.selectedVoiceUri ?? ''}
                onChange={(event) => speech.setVoice(event.target.value || null)}
              >
                {/*
                 * "Automatic" is not an empty choice — it is the language
                 * match. Clearing the stored preference sends the director back
                 * to picking a local voice in the interface's own language.
                 */}
                <option value="">{t('settings.voice_auto')}</option>
                {speech.voices.map((voice) => (
                  <option key={voice.uri} value={voice.uri}>
                    {voice.name} ({voice.lang})
                    {voice.localService ? '' : ` — ${t('settings.voice_remote')}`}
                  </option>
                ))}
              </select>
            </label>
            <p className="voice-settings__note" id={noteId}>
              {t('settings.voice_hint')}
            </p>
          </div>
        </details>
      ) : (
        /*
         * No voices at all: say so where the list would have been. The player
         * loses nothing — every line is captioned in full either way — and this
         * is the sentence that stops them hunting for a control that cannot
         * exist on their machine.
         */
        <p className="voice-settings__note">{t('settings.voice_none')}</p>
      )}
    </div>
  );
}
