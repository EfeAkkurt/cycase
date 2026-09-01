import { useEffect, useState } from 'react';

import { useGame, useRuntime } from '../../app/gameContext';
import { VoiceSettings } from '../../audio/VoiceSettings';
import { t } from '../../i18n';
import { useNarration } from '../narration/NarrationPanel';
import { Button } from '../primitives';
import { LearningRail } from './LearningRail';
import { LastOutcome, NextStepCard } from './NextStepCard';
import {
  CommandRoute,
  EvidenceRoute,
  InvestigateRoute,
  RespondRoute,
  TimelineRouteWithLog,
} from './routes';
import { destinationTitle } from './shell';
import { SideNav } from './SideNav';
import { TopBar } from './TopBar';

/**
 * The operations console: real DOM and SVG, never a texture.
 *
 * The shell is three columns inside one non-scrolling frame. The learning rail
 * starts collapsed so a 240px sidebar plus a 320px rail cannot squeeze the
 * workspace off a 1280px screen; the player can open it back. Guidance stays
 * findable from the collapsed strip.
 *
 * Order inside `main`:
 *
 *   1. the required step, compact
 *   2. `#destination-content` — the real content of the active destination
 *   3. `#last-outcome` — what the previous step did
 */
export function Dashboard({ statusExtras }: { statusExtras?: React.ReactNode }) {
  const ctx = useGame();
  const runtime = useRuntime();
  const narration = useNarration();

  const [navCollapsed, setNavCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(true);

  useEffect(() => {
    document.getElementById('incident-title')?.focus();
  }, []);

  useEffect(() => {
    const onPointer = () => {
      document.documentElement.dataset.input = 'pointer';
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key === 'Tab' ||
        event.key === 'Enter' ||
        event.key === ' ' ||
        event.key.startsWith('Arrow')
      ) {
        document.documentElement.dataset.input = 'keyboard';
      }
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  useEffect(() => {
    if (narration.active) setRailCollapsed(false);
  }, [narration.active]);

  const className = [
    'console',
    navCollapsed ? 'console--nav-collapsed' : '',
    railCollapsed ? 'console--rail-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} data-surface="0">
      <SideNav
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed((value) => !value)}
        statusExtras={statusExtras}
      />

      <div className="console__workspace" data-surface="1">
        <div className="console__card" data-surface="1">
          <TopBar
            title={destinationTitle(ctx.route)}
            context={t('incident.title')}
            titleId="incident-title"
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={ctx.paused}
                  onClick={() => runtime.send({ type: 'SET_PAUSED', paused: !ctx.paused })}
                >
                  {ctx.paused ? t('topbar.resume') : t('topbar.pause')}
                </Button>

                <VoiceSettings surface="menu" />

                <Button
                  size="sm"
                  variant="ghost"
                  id="return-to-office"
                  onClick={() => runtime.send({ type: 'RETURN_TO_OFFICE' })}
                >
                  {t('topbar.return_to_office')}
                </Button>
              </>
            }
          />

          <div className="console__body">
            <main className="workspace" id="main">
              <NextStepCard />

              <div className="workspace__content" id="destination-content">
                {ctx.route === 'command' ? <CommandRoute /> : null}
                {ctx.route === 'investigate' ? <InvestigateRoute /> : null}
                {ctx.route === 'evidence' ? <EvidenceRoute /> : null}
                {ctx.route === 'respond' ? <RespondRoute /> : null}
                {ctx.route === 'timeline' ? <TimelineRouteWithLog /> : null}
                {/*
                  * Five branches for six destinations, on purpose. Nothing can
                  * put this scene on the `debrief` route: the nav row is
                  * disabled until the case closes and sends `OPEN_DEBRIEF`
                  * rather than `SET_ROUTE` once it is not, and closing the case
                  * moves the machine out of the dashboard altogether. The
                  * branch that used to sit here rendered a panel no player has
                  * ever seen — see the note at the foot of routes.tsx.
                  */}
              </div>

              <LastOutcome />
            </main>

            <LearningRail
              collapsed={railCollapsed}
              onToggle={() => setRailCollapsed((value) => !value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
