import { useCallback, useState } from 'react';

import { useAudio } from '../../audio/audioContext';
import { t } from '../../i18n';
import { Button, Icon } from '../primitives';

/**
 * Mute, volume and the 3D toggle.
 *
 * All three are requirements, not conveniences: docs/DESIGN_SYSTEM.md lists
 * "captions, mute, volume and skip" under accessibility, and the case has to
 * be completable with the 3D canvas disabled.
 */

const KEY_3D = 'cycase.office3d';

export function use3DEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = useState(() => {
    try {
      return window.localStorage.getItem(KEY_3D) !== 'false';
    } catch {
      return true;
    }
  });

  const update = useCallback((next: boolean) => {
    setEnabled(next);
    try {
      window.localStorage.setItem(KEY_3D, String(next));
    } catch {
      // Preference simply does not persist.
    }
  }, []);

  return [enabled, update];
}

export function SettingsBar({
  enabled3D,
  onToggle3D,
  can3D,
}: {
  enabled3D: boolean;
  onToggle3D: (next: boolean) => void;
  can3D: boolean;
}) {
  const audio = useAudio();

  return (
    <div className="settings" role="group" aria-label={t('settings.title')}>
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={audio.muted}
        onClick={() => audio.setMuted(!audio.muted)}
      >
        <Icon name={audio.muted ? 'block' : 'agent'} size={13} />
        {audio.muted ? t('app.unmute') : t('app.mute')}
      </Button>

      <label className="settings__volume">
        <span className="sr-only">{t('settings.volume')}</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(audio.volume * 100)}
          disabled={audio.muted}
          onChange={(event) => audio.setVolume(Number(event.target.value) / 100)}
          aria-label={t('settings.volume')}
        />
      </label>

      <Button
        size="sm"
        variant="ghost"
        aria-pressed={enabled3D && can3D}
        disabled={!can3D}
        reason={can3D ? undefined : t('settings.no_3d')}
        onClick={() => onToggle3D(!enabled3D)}
      >
        <Icon name="device" size={13} />
        {t('fallback.toggle_3d')}
      </Button>
    </div>
  );
}
