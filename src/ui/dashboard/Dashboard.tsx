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
 *   1. the required step, compact — or, once the case is closed, the beat that
 *      says so and offers the debrief
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
              {/*
                * One card owns the top of the workspace, and which one it is
                * depends on whether the case is still running. There is no next
                * required step after a close, so the slot carries the close
                * beat instead of a guide card with nothing to guide.
                */}
              {ctx.caseClosed ? <CaseClosed /> : <NextStepCard />}

              <div className="workspace__content" id="destination-content">
                {ctx.route === 'command' ? <CommandRoute /> : null}
                {ctx.route === 'investigate' ? <InvestigateRoute /> : null}
                {ctx.route === 'evidence' ? <EvidenceRoute /> : null}
                {ctx.route === 'respond' ? <RespondRoute /> : null}
                {ctx.route === 'timeline' ? <TimelineRouteWithLog /> : null}
                {/*
                  * Five branches for six destinations, on purpose. Nothing can
                  * put this scene on the `debrief` destination: the nav row is
                  * disabled until the case closes, and once it is not it sends
                  * `OPEN_DEBRIEF` — which changes the scene, never the
                  * destination — so the sixth is reached by leaving the console
                  * rather than by rendering inside it. The branch that used to
                  * sit here rendered a panel no player has ever seen — see the
                  * note at the foot of routes.tsx.
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

/**
 * The close, as a beat rather than a cut.
 *
 * This is what the machine's removed `always` transition used to skip. It sits
 * in the slot the required-step card owns, because after a close there is no
 * next required step and an empty guide card is a worse answer than the one
 * thing that is true; everything else on the console — the receipt for the
 * closing command, the outcome block under it, and the sources the player spent
 * the case verifying — stays exactly where it was, which is the whole point of
 * not cutting away.
 *
 * VERA says it, and her name is on it. An unattributed sentence here would read
 * as the console's own voice, and the console is the source of truth: it states
 * records, not how a case has gone. Her register is the record and nothing else
 * — off the live board, written as it stands. No score, no lesson, no verdict;
 * the debrief has all three and it has them only when the player asks.
 *
 * `action.close_case.result` — 'Case closed.' — is deliberately not repeated
 * here. That line belongs to the command rather than to the case, and it is
 * already on screen in both of the places a command reports itself: the receipt
 * beside the control that ran it, and `#last-outcome` below. Printing it again
 * under VERA's confirmation would be the console agreeing with itself twice
 * over one press.
 */
function CaseClosed() {
  const runtime = useRuntime();

  return (
    <section className="guide" id="case-closed" aria-labelledby="case-closed-speaker">
      <div className="guide__body">
        <div className="guide__head">
          {/* The speaker, not a state. No icon: every glyph in this set names
              either an operation or a status, and hanging one over a person's
              name would say something about her the line does not. */}
          <span className="guide__eyebrow" id="case-closed-speaker">
            {t('intro.colleague.name')}
          </span>
        </div>

        <p className="prose" id="case-closed-confirm">
          {t('close.confirm')}
        </p>

        {/* The player's own move. Primary because it is the only thing left to
            do, and worded as an invitation because nothing is waiting on it. */}
        <div className="row">
          <Button
            variant="primary"
            id="close-continue"
            onClick={() => runtime.send({ type: 'OPEN_DEBRIEF' })}
          >
            {t('close.continue')}
          </Button>
        </div>
      </div>
    </section>
  );
}
