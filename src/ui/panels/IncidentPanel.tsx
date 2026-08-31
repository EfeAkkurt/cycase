import {
  useGame,
} from '../../app/gameContext';
import { INCIDENT_ID } from '../../game/fixtures/case001';
import { incidentCounters } from '../../game/fixtures/telemetry';
import {
  currentHypothesis,
  elapsedSeconds,
  formatElapsed,
  incidentStatus,
  knownFacts,
  openQuestions,
  unresolvedCriticalFindings,
} from '../../game/selectors';
import { t } from '../../i18n';
import { Badge, Button, Icon, Panel } from '../primitives';
import type { PanelMode } from './TelemetryPanel';

/**
 * The incident brief. In `compact` mode this is the red alert screen on the
 * centre monitor; in `full` mode it is the dashboard's overview summary. Both
 * read the same case state.
 */
export function IncidentPanel({
  mode = 'full',
  onAcknowledgeAlarm,
}: {
  mode?: PanelMode;
  /**
   * Present only while the alarm is unacknowledged (audit P0.2). The projected
   * DOM panel carries the keyboard-operable equivalent of clicking the screen:
   * a native button, so pointer, Enter and Space all dispatch the same event.
   */
  onAcknowledgeAlarm?: () => void;
}) {
  const ctx = useGame();
  const status = incidentStatus(ctx);
  const counters = incidentCounters(ctx);
  const open = unresolvedCriticalFindings(ctx);

  const statusLabel =
    status === 'closed'
      ? t('overview.status.closed')
      : status === 'contained'
        ? t('overview.status.contained')
        : t('overview.status.active');

  if (mode === 'compact') {
    return (
      <Panel
        id="incident-brief"
        title={t('topbar.incident')}
        tone={status === 'active' ? 'critical' : undefined}
        compact
        headingLevel={3}
      >
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <Icon
            name={status === 'active' ? 'alert' : 'shield'}
            size={20}
            label={status === 'active' ? t('a11y.severity_icon') : undefined}
          />
          <strong className="text-2xl">
            {status === 'active' ? t('overview.severity.critical') : statusLabel}
          </strong>
        </div>
        <p className="prose text-sm">
          {t('incident.fact.exfil_blocked')}
        </p>
        {onAcknowledgeAlarm ? (
          <Button variant="danger" block onClick={onAcknowledgeAlarm} id="acknowledge-alarm">
            {t('office.acknowledge')}
          </Button>
        ) : null}
        <dl className="kv">
          <div className="kv__row">
            <dt className="kv__key">{t('topbar.incident')}</dt>
            <dd className="kv__value">{INCIDENT_ID}</dd>
          </div>
          <div className="kv__row">
            <dt className="kv__key">{t('topbar.elapsed')}</dt>
            <dd className="kv__value">{formatElapsed(elapsedSeconds(ctx))}</dd>
          </div>
          <div className="kv__row">
            <dt className="kv__key">{t('overview.checklist')}</dt>
            <dd className={open.length > 0 ? 'kv__value kv__value--bad' : 'kv__value kv__value--good'}>
              {5 - open.length}/5
            </dd>
          </div>
        </dl>
      </Panel>
    );
  }

  return (
    <Panel
      id="overview-summary"
      title={t('overview.summary')}
      tone={status === 'active' ? 'critical' : undefined}
      actions={
        <Badge
          tone={status === 'active' ? 'critical' : status === 'contained' ? 'success' : 'accent'}
          icon={status === 'active' ? 'alert' : 'check'}
        >
          {statusLabel}
        </Badge>
      }
    >
      <div className="row" style={{ gap: 'var(--space-6)' }}>
        <Counter label={t('assets.title')} value={counters.affectedAssets} />
        <Counter
          label="Active sessions"
          value={counters.activeSessions}
          tone={counters.activeSessions > 1 ? 'bad' : 'good'}
        />
        <Counter
          label="Blocked indicators"
          value={counters.blockedIndicators}
          tone={counters.blockedIndicators > 0 ? 'good' : undefined}
        />
        <Counter
          label={t('overview.checklist')}
          value={`${5 - open.length}/5`}
          tone={open.length > 0 ? 'bad' : 'good'}
        />
      </div>

      <div className="stack stack--tight">
        <span className="eyebrow">{t('overview.hypotheses')}</span>
        <p className="prose">{currentHypothesis(ctx)}</p>
      </div>

      <div className="grid-2">
        <div className="stack stack--tight">
          <span className="eyebrow">{t('overview.known_facts')}</span>
          <ul className="stack stack--tight">
            {knownFacts(ctx).map((fact) => (
              <li key={fact} className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <span className="dot dot--accent" style={{ marginTop: 8 }} />
                <span className="text-sm">{fact}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="stack stack--tight">
          <span className="eyebrow">{t('overview.open_questions')}</span>
          {openQuestions(ctx).length === 0 ? (
            <p className="muted text-sm">
              {t('overview.no_open_questions')}
            </p>
          ) : (
            <ul className="stack stack--tight">
              {openQuestions(ctx).map((question) => (
                <li
                  key={question}
                  className="row"
                  style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}
                >
                  <span className="dot dot--warning" style={{ marginTop: 8 }} />
                  <span className="text-sm">{question}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: 'bad' | 'good';
}) {
  return (
    <div className="stat">
      <span className="stat__label">{label}</span>
      <span
        className={['stat__value', 'text-2xl', tone === 'bad' ? 'tone-bad' : '', tone === 'good' ? 'tone-good' : '']
          .filter(Boolean)
          .join(' ')}
      >
        {value}
      </span>
    </div>
  );
}
