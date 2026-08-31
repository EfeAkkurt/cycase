import type { ReactNode } from 'react';

import { useGame, useRuntime } from '../../app/gameContext';
import { ARTIFACTS, DECISIONS, FINDINGS, RESPONSE_ACTIONS } from '../../game/fixtures/case001';
import { siemEvents } from '../../game/investigate';
import { hasPerformed, unresolvedCriticalFindings, visibleTimeline } from '../../game/selectors';
import { clocks } from '../../game/live';
import { formatElapsed } from '../../game/selectors';
import { t } from '../../i18n';
import { DASHBOARD_ROUTES, type DashboardRoute } from '../../game/types';
import { Icon, StatusDot, type IconName } from '../primitives';
import { incidentStatusRows, incidentStatusSentence, navItemA11y } from './shell';

/**
 * The console's left column: identity, destinations and incident status.
 *
 * Three things were previously spread across the chrome and are now in one
 * place, because they answer one question — *where am I in this case?*
 *
 *  1. Which case this is.
 *  2. Which of the six destinations is open (redesign doc §4; six is a cap).
 *  3. What the case currently reads: the eight numbers that used to be strung
 *     across the top bar, where they competed with the page title and pushed
 *     the global actions into a second row at 1280px.
 *
 * It collapses to a 72px rail. Collapsed, every destination is still a real
 * button in the same order, still keyboard reachable, and still carries its
 * label *and* its count in the accessible name — the icon is an abbreviation
 * for the eye, never for assistive technology. The status group is the part
 * that genuinely does not fit in 72px, so collapsing is an explicit trade the
 * player makes for width, and the toggle says so.
 *
 * Identities and assets are not missing from the six. They are inside
 * Investigate, under the tools an analyst would actually reach for to look at
 * them, which is the point of modelling the pivot rather than flattening every
 * source into one level of navigation.
 */
const ROUTE_META: Record<DashboardRoute, { labelKey: Parameters<typeof t>[0]; icon: IconName }> = {
  command: { labelKey: 'nav.command', icon: 'shield' },
  investigate: { labelKey: 'nav.investigate', icon: 'search' },
  evidence: { labelKey: 'nav.evidence', icon: 'eye' },
  respond: { labelKey: 'nav.respond', icon: 'block' },
  timeline: { labelKey: 'nav.timeline', icon: 'clock' },
  debrief: { labelKey: 'nav.debrief', icon: 'key' },
};

export function SideNav({
  collapsed,
  onToggle,
  statusExtras,
}: {
  collapsed: boolean;
  onToggle: () => void;
  /** Rendered as the last row of the status group. */
  statusExtras?: ReactNode;
}) {
  const ctx = useGame();
  const runtime = useRuntime();

  const appliedActions = RESPONSE_ACTIONS.filter((action) => hasPerformed(ctx, action.id)).length;
  const resolvedFindings = FINDINGS.length - unresolvedCriticalFindings(ctx).length;

  // The glanceable chip and the spoken sentence for the same fact. Neither is
  // derived from the other at render time — a "2/6" read aloud is two numbers
  // and no noun, and a full sentence in a 240px column is a wrapped paragraph.
  const counts: Record<DashboardRoute, { chip: string; label: string }> = {
    command: {
      chip: `${resolvedFindings}/${FINDINGS.length}`,
      label: t('nav.count.command', { done: resolvedFindings, total: FINDINGS.length }),
    },
    investigate: {
      chip: `${siemEvents(ctx).length}`,
      label: t('nav.count.investigate', { total: siemEvents(ctx).length }),
    },
    evidence: {
      chip: `${ctx.inspectedArtifacts.length}/${ARTIFACTS.length}`,
      label: t('nav.count.evidence', {
        done: ctx.inspectedArtifacts.length,
        total: ARTIFACTS.length,
      }),
    },
    respond: {
      chip: `${appliedActions}/${RESPONSE_ACTIONS.length}`,
      label: t('nav.count.respond', { done: appliedActions, total: RESPONSE_ACTIONS.length }),
    },
    timeline: {
      chip: `${visibleTimeline(ctx).length}`,
      label: t('nav.count.timeline', { total: visibleTimeline(ctx).length }),
    },
    debrief: { chip: '', label: '' },
  };

  return (
    <div className="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__brand">
          <Icon name="shield" size={18} />
          <span className="sidebar__brand-name sidebar__label">{t('app.title')}</span>
        </span>
        <button
          type="button"
          className="sidebar__toggle"
          aria-expanded={!collapsed}
          aria-controls="sidebar-nav"
          onClick={onToggle}
        >
          <Icon
            name={collapsed ? 'panelRight' : 'panelLeft'}
            size={16}
            label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          />
        </button>
      </div>

      <nav className="nav" id="sidebar-nav" aria-label={t('nav.section')}>
        {DASHBOARD_ROUTES.map((route) => {
          const meta = ROUTE_META[route];
          // The debrief is a real destination that is not open yet. It stays in
          // the spine, disabled and saying why, rather than appearing out of
          // nowhere when the case closes.
          const locked = route === 'debrief' && !ctx.caseClosed;
          const a11y = navItemA11y({
            label: t(meta.labelKey),
            countLabel: counts[route].label,
            locked,
            lockedReason: t('nav.debrief.locked'),
            collapsed,
          });

          return (
            <button
              key={route}
              type="button"
              className="nav__item"
              aria-current={ctx.route === route ? 'page' : undefined}
              aria-label={a11y.accessibleName}
              disabled={locked}
              title={a11y.title}
              onClick={() => {
                if (route === 'debrief') {
                  runtime.send({ type: 'OPEN_DEBRIEF' });
                  return;
                }
                runtime.send({ type: 'SET_ROUTE', route });
              }}
            >
              <Icon name={meta.icon} size={16} />
              <span className="nav__label sidebar__label">{t(meta.labelKey)}</span>
              {counts[route].chip ? (
                // Decorative: the same fact is already in the accessible name,
                // as a sentence. Announcing both would read "Evidence, 2 of 6
                // artifacts inspected, 2 slash 6".
                <span className="nav__count sidebar__label" aria-hidden="true">
                  {counts[route].chip}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {collapsed ? null : <IncidentStatus statusExtras={statusExtras} />}
    </div>
  );
}

/**
 * The status group.
 *
 * Eight labelled rows and exactly one live region. The rows themselves are
 * plain markup: the play clock ticks once a second, and a polite region wrapped
 * around these values would read a stream of digits at a screen-reader user for
 * the length of the session. The live region carries a sentence instead, and
 * that sentence only changes when something actually happened — a new state
 * version, a severity change, the feed pausing, an agent attaching.
 */
function IncidentStatus({ statusExtras }: { statusExtras?: ReactNode }) {
  const ctx = useGame();
  const rows = incidentStatusRows(ctx);
  const clock = clocks(ctx);
  const decisionsDone = Object.keys(ctx.decisions).length;

  return (
    <section className="sidebar__status sidebar__label" aria-labelledby="incident-status-title">
      <h2 className="sidebar__group-title" id="incident-status-title">
        {t('sidebar.status')}
      </h2>

      <dl className="status">
        {rows.map((row) => (
          <div className="status__row" key={row.id}>
            <dt className="status__label">{row.label}</dt>
            <dd
              className={row.mono ? 'status__value status__value--mono' : 'status__value'}
              id={row.id}
              aria-describedby={row.describedBy}
            >
              {row.tone ? <StatusDot tone={row.tone} pulse={row.pulse} /> : null}
              <span className="status__text">{row.value}</span>
              {row.suffix ? (
                <span className="status__suffix" aria-hidden="true">
                  {row.suffix}
                </span>
              ) : null}
              {row.detail ? <span className="status__detail">{row.detail}</span> : null}
            </dd>
          </div>
        ))}
      </dl>

      {/*
       * The WebMCP registration status. Outside the `<dl>` because it is not a
       * term/definition pair — it is a chip with a label, and a bare `<div>`
       * between `<dt>`s is invalid list markup.
       */}
      {statusExtras}

      <span className="sr-only" id="clock-explainer">
        {t('clock.explainer', {
          multiplier: clock.multiplier,
          cost: formatElapsed(clock.operationCostSec),
        })}
      </span>

      {/*
       * One sentence, one region. See `incidentStatusSentence` for why this is
       * not the eight rows above with `aria-live` on their container.
       */}
      <p className="sr-only" role="status">
        {incidentStatusSentence(ctx)}
      </p>

      <div className="status__footer">
        <span className="status__label">{t('decision.title')}</span>
        <span className="status__value status__value--mono">
          {t('decision.progress', { index: decisionsDone, total: DECISIONS.length })}
        </span>
      </div>
    </section>
  );
}
