import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { t } from '../i18n';
import { useSpeech } from './speechContext';
import { filterVoices, rankVoices } from './voiceList';
import { Button } from '../ui/primitives';

/**
 * The narration control.
 *
 * On the dashboard this is one Settings surface: narration, voice and the
 * operating-system list live together so Pause and Return stay visible in the
 * top bar. In the office it stays inline beside mute and volume.
 */
export function VoiceSettings({ surface = 'inline' }: { surface?: 'inline' | 'menu' }) {
  const speech = useSpeech();
  const selectId = useId();
  const noteId = useId();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const hasChoices = speech.voices.length > 0;

  /*
   * The list, ordered so the usable voices are the visible ones.
   *
   * A browser commonly returns forty or more voices in the operating system's
   * own order, with the two or three that can read this copy scattered through
   * the middle. `rankVoices` puts the locale's voices first, local engines
   * ahead of network ones, by the same rule the automatic pick uses — so the
   * voice at the top of the list is the one the player would have got anyway.
   * Everything else stays reachable behind "Show all", which is the difference
   * between a shorter list and a list that has hidden something.
   */
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const searchId = useId();

  const ranked = useMemo(
    () => rankVoices(speech.voices, speech.locale),
    [speech.voices, speech.locale],
  );

  const recommended = useMemo(
    () => filterVoices(ranked.recommended, query),
    [ranked.recommended, query],
  );
  const other = useMemo(
    // Searching implies showing all: a player who types a language tag is
    // asking for the voice with that tag, wherever it was filed.
    () => (showAll || query.trim() ? filterVoices(ranked.other, query) : []),
    [ranked.other, query, showAll],
  );

  useEffect(() => {
    if (!open || surface !== 'menu') return;

    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, surface]);

  const body = (
    <>
      <button
        type="button"
        className="voice-settings__toggle"
        aria-pressed={!speech.muted}
        onClick={() => speech.setMuted(!speech.muted)}
      >
        {speech.muted ? t('settings.narration_off') : t('settings.narration_on')}
      </button>

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
                <option value="">{t('settings.voice_auto')}</option>
                {recommended.length > 0 ? (
                  <optgroup label={t('settings.voice_group.recommended')}>
                    {recommended.map((voice) => (
                      <option key={voice.uri} value={voice.uri}>
                        {voice.name} ({voice.lang})
                        {voice.localService ? '' : ` — ${t('settings.voice_remote')}`}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {other.length > 0 ? (
                  <optgroup label={t('settings.voice_group.other')}>
                    {other.map((voice) => (
                      <option key={voice.uri} value={voice.uri}>
                        {voice.name} ({voice.lang})
                        {voice.localService ? '' : ` — ${t('settings.voice_remote')}`}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>

            <label className="voice-settings__field" htmlFor={searchId}>
              <span className="voice-settings__label">{t('settings.voice_search')}</span>
              <input
                id={searchId}
                type="search"
                className="voice-settings__select"
                value={query}
                placeholder={t('settings.voice_search_placeholder')}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            {ranked.other.length > 0 && !query.trim() ? (
              <button
                type="button"
                className="voice-settings__toggle"
                id="voice-show-all"
                aria-pressed={showAll}
                onClick={() => setShowAll((value) => !value)}
              >
                {showAll
                  ? t('settings.voice_show_recommended')
                  : t('settings.voice_show_all', { count: ranked.other.length })}
              </button>
            ) : null}

            <p className="voice-settings__note" id={noteId}>
              {t('settings.voice_hint')}
            </p>
          </div>
        </details>
      ) : (
        <p className="voice-settings__note">{t('settings.voice_none')}</p>
      )}
    </>
  );

  if (surface === 'menu') {
    return (
      <div
        ref={rootRef}
        className="voice-settings voice-settings--menu"
        role="group"
        aria-label={t('settings.shell')}
      >
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          {t('settings.shell')}
        </Button>
        {open ? (
          <div
            className="voice-settings__panel"
            id={panelId}
            role="dialog"
            aria-label={t('settings.shell')}
          >
            {body}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="voice-settings" role="group" aria-label={t('settings.narration')}>
      {body}
    </div>
  );
}
