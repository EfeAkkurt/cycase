import { useCallback, useEffect, useState } from 'react';

import { t } from '../../i18n';
import { Button } from '../primitives';

/**
 * The compact head-look hint.
 *
 * Head-look is the one interaction in the office with no visible affordance:
 * the room looks like a picture, and nothing about a picture says you can pull
 * it sideways. So the first visit gets the three gestures spelled out — drag,
 * arrows/WASD, Home — and after that the panel has to get out of the way,
 * because a permanent instruction panel over the room is the other failure
 * mode.
 *
 * "Gets out of the way" is not "disappears". It collapses to a single labelled
 * control in the same corner, which reopens the panel and is reachable by
 * keyboard like anything else — a player who forgets the keys after the tenth
 * visit can still find them.
 *
 * The trigger to collapse is a *successful look*, not a timer and not a
 * dismissal. `hasLooked` is set by the input layer the moment the rig actually
 * moves, by any of the three paths, so the hint stands down when it has been
 * understood rather than when it has been on screen long enough. Someone who
 * never works out the gesture keeps the instructions.
 */

/** Remembers that this player already knows how to look around. */
const KEY_USED = 'cycase.office.headlook-used';

function readUsed(): boolean {
  try {
    return window.localStorage.getItem(KEY_USED) === 'true';
  } catch {
    // Private mode, or storage disabled. Showing the hint again is the safe
    // failure: a returning player sees one extra panel, a new one is never
    // left without instructions.
    return false;
  }
}

function rememberUsed(): void {
  try {
    window.localStorage.setItem(KEY_USED, 'true');
  } catch {
    // The preference simply does not persist.
  }
}

export function HeadLookHelp({
  hasLooked,
  pointerLocked,
}: {
  /** True once the player has turned the head by any input path. */
  hasLooked: boolean;
  /** Mouse-look holds the pointer; the release key gets top billing then. */
  pointerLocked: boolean;
}) {
  /*
   * Seeded from storage on the first render rather than in an effect, so a
   * returning player never gets a frame of the expanded panel before it
   * collapses. That flash is small and it is exactly the kind of thing that
   * reads as a bug.
   */
  const [open, setOpen] = useState(() => !readUsed());
  const [everLooked, setEverLooked] = useState(() => readUsed());

  useEffect(() => {
    if (!hasLooked || everLooked) return;
    setEverLooked(true);
    setOpen(false);
    rememberUsed();
  }, [hasLooked, everLooked]);

  const toggle = useCallback(() => setOpen((previous) => !previous), []);

  /*
   * While the pointer is locked the only thing worth saying is how to get the
   * cursor back, and it is said in the office's own status line rather than
   * here — two overlapping panels in one corner is worse than one.
   */
  if (pointerLocked) return null;

  if (!open) {
    return (
      <div className="office-help office-help--collapsed">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={false}
          aria-controls="office-help-panel"
          onClick={toggle}
        >
          {t('office.headlook.help_show')}
        </Button>
      </div>
    );
  }

  return (
    <div className="office-help" id="office-help-panel">
      {/*
       * A `group`, not a live region. It is present from the first paint rather
       * than announced into the middle of something, and the same three
       * gestures are already in the room's `aria-describedby` help text — so
       * announcing this too would say everything twice.
       */}
      <div className="office-help__panel" role="group" aria-label={t('office.headlook.help_title')}>
        <p className="office-help__title">{t('office.headlook.help_title')}</p>
        <ul className="office-help__list">
          <li>
            <span className="office-help__key">{t('office.headlook.help_drag_key')}</span>
            {t('office.headlook.help_drag')}
          </li>
          <li>
            <span className="office-help__key">{t('office.headlook.help_keys_key')}</span>
            {t('office.headlook.help_keys')}
          </li>
          <li>
            <span className="office-help__key">{t('office.headlook.help_home_key')}</span>
            {t('office.headlook.help_home')}
          </li>
        </ul>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded
          aria-controls="office-help-panel"
          onClick={() => {
            setOpen(false);
            // Dismissing it by hand is also a way of saying you know the
            // gestures, so it should not come back every visit either.
            rememberUsed();
            setEverLooked(true);
          }}
        >
          {t('office.headlook.help_dismiss')}
        </Button>
      </div>
    </div>
  );
}
