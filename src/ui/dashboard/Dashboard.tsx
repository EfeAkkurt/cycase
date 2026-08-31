import { useEffect, useState } from 'react';

import { useGame, useRuntime } from '../../app/gameContext';
import { t } from '../../i18n';
import { Button } from '../primitives';
import { LearningRail } from './LearningRail';
import { NextStepCard, LastOutcome } from './NextStepCard';
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
import { VoiceSettings } from '../../audio/VoiceSettings';

/**
 * The operations console: real DOM and SVG, never a texture.
 *
 * The shell is three columns inside one non-scrolling frame:
 *
 *   ┌ sidebar ┬──────────── workspace card ────────────┐
 *   │ 240/72  │ topbar: destination + global actions   │
 *   │ nav     ├──────────────────────┬─────────────────┤
 *   │ status  │ main (scrolls)       │ rail (scrolls)  │
 *   └─────────┴──────────────────────┴─────────────────┘
 *
 * The page itself never scrolls; `main` and the rail scroll independently. That
 * is what keeps the required step, the destination heading and the global
 * actions in the same place all session, and it is why a long evidence list can
 * no longer push the Pause control off the screen.
 *
 * Order inside `main` is the whole point of the layout work:
 *
 *   1. the required step, compact
 *   2. `#destination-content` — the real content of the active destination
 *   3. `#last-outcome` — what the previous step did
 *
 * (2) has to be above the fold at 1280×720 and 1440×900; `tests/e2e/shell.spec.ts`
 * measures it rather than trusting this comment. (3) is feedback for an action
 * already taken, so it is the one thing that may sit below the fold — it is
 * still on the page, unconditionally, not behind a disclosure.
 *
 * On mount, focus moves to the page title — acceptance criterion 4 in
 * docs/PROJECT_CONTEXT.md requires the office-to-dashboard transition to land
 * focus here without a reload.
 */
export function Dashboard({ statusExtras }: { statusExtras?: React.ReactNode }) {
  const ctx = useGame();
  const runtime = useRuntime();

  // Two independent collapses. The sidebar trades the incident status for
  // width; the rail trades the assistant notes for width. Neither is
  // remembered across a session on purpose — a hidden persisted preference is
  // how a returning player finds a console they did not configure.
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  useEffect(() => {
    document.getElementById('incident-title')?.focus();
  }, []);

  const className = [
    'console',
    navCollapsed ? 'console--nav-collapsed' : '',
    railCollapsed ? 'console--rail-collapsed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <SideNav
        collapsed={navCollapsed}
        onToggle={() => setNavCollapsed((value) => !value)}
        statusExtras={statusExtras}
      />

      <div className="console__workspace">
        <div className="console__card">
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

                {/*
                 * The same voice control the office carries. Narration follows
                 * the player across the transition, so its settings have to as
                 * well — otherwise "Stop voice" is only reachable from a room
                 * you have left.
                 */}
                <VoiceSettings />

                {/* P0.7 — back to the seat without replaying the wake. */}
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
              {/* P0.6 — one persistent required step, on every route, so
                  "where do I click next?" never has to be asked. */}
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
