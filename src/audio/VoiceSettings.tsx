import { useEffect, useId, useRef, useState } from 'react';

import { t } from '../i18n';
import { useSpeech } from './speechContext';
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
