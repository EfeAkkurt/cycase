import type { ReactNode } from 'react';

import { useGame, useRuntime } from '../../app/gameContext';
import { ARTIFACTS, DECISIONS, FINDINGS, RESPONSE_ACTIONS } from '../../game/fixtures/case001';
import { siemEvents } from '../../game/investigate';
import { clocks } from '../../game/live';
import { formatElapsed, hasPerformed, unresolvedCriticalFindings, visibleTimeline } from '../../game/selectors';
import { t } from '../../i18n';
import { DASHBOARD_ROUTES, type DashboardRoute } from '../../game/types';
import { Icon, StatusDot, type IconName } from '../primitives';
import {
  incidentStatusDetailRows,
  incidentStatusPrimaryRows,
  incidentStatusSentence,
  navItemA11y,
} from './shell';

/**
 * The console's left column: identity, destinations and incident status.
 *
 * The glanceable group is four facts: incident, severity, feed and agent.
 * Clocks, event rate, state version and registration detail sit behind
 * System details so a 240px column stays a status strip rather than a log.
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
  statusExtras?: ReactNode;
}) {
  const ctx = useGame();
  const runtime = useRuntime();

  const appliedActions = RESPONSE_ACTIONS.filter((action) => hasPerformed(ctx, action.id)).length;
  const resolvedFindings = FINDINGS.length - unresolvedCriticalFindings(ctx).length;

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

function IncidentStatus({ statusExtras }: { statusExtras?: ReactNode }) {
  const ctx = useGame();
  const primary = incidentStatusPrimaryRows(ctx);
  const details = incidentStatusDetailRows(ctx);
  const clock = clocks(ctx);
  const decisionsDone = Object.keys(ctx.decisions).length;

  return (
    <section className="sidebar__status sidebar__label" aria-labelledby="incident-status-title">
      <h2 className="sidebar__group-title" id="incident-status-title">
        {t('sidebar.status')}
      </h2>

      <StatusList rows={primary} />

      <details className="sidebar__details">
        <summary className="sidebar__details-summary">{t('sidebar.system_details')}</summary>
        <div className="sidebar__details-body" data-surface="2">
          <StatusList rows={details} />
          {statusExtras}
        </div>
      </details>

      <span className="sr-only" id="clock-explainer">
        {t('clock.explainer', {
          multiplier: clock.multiplier,
          cost: formatElapsed(clock.operationCostSec),
        })}
      </span>

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

function StatusList({ rows }: { rows: ReturnType<typeof incidentStatusPrimaryRows> }) {
  return (
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
  );
}
