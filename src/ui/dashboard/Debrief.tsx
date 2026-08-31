import { Suspense, lazy } from 'react';

import {
  useGame,
  useRuntime,
} from '../../app/gameContext';
import { DECISIONS, DECISION_BY_ID, DIAGNOSTICS, FINDINGS } from '../../game/fixtures/case001';
import { computeScore } from '../../game/scoring';
import { availableArtifacts, unresolvedCriticalFindings } from '../../game/selectors';
import { t, tk } from '../../i18n';
import { SCORE_BUCKET_MAX, type ScoreBucket } from '../../game/types';
import { ChartSkeleton } from '../charts';
import { Badge, Button, Icon, Panel } from '../primitives';
import { TopBar } from './TopBar';

const BUCKETS: ScoreBucket[] = ['evidence', 'containment', 'scope', 'efficiency'];

/**
 * What the run never looked at.
 *
 * The unresolved-findings panel above says what was left *undone*; this says
 * what was left *unread*, which is a different and usually more instructive
 * failure. A run can close every finding and still have reached the right
 * answer without evidence — and an analyst who does not know that about their
 * own run cannot correct it.
 *
 * Counted from the same `availableArtifacts` / `availableDiagnostics` selectors
 * the console uses, so it lists only what was genuinely reachable. A record the
 * case never unlocked is not a thing anyone missed.
 */
function MissedEvidence() {
  const ctx = useGame();
  const unread = availableArtifacts(ctx).filter(
    (artifact) => !ctx.inspectedArtifacts.includes(artifact.id),
  );
  const unrun = DIAGNOSTICS.filter((diagnostic) => !ctx.ranDiagnostics.includes(diagnostic.id));

  return (
    <Panel id="debrief-unread" title={t('debrief.unread')}>
      {unread.length === 0 ? (
        <p className="prose" style={{ color: 'var(--status-success)' }}>
          <Icon name="check" size={16} /> {t('debrief.unread.none')}
        </p>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 'var(--type-sm-size)' }}>
            {t('debrief.unread.hint')}
          </p>
          <ul className="checklist">
            {unread.map((artifact) => (
              <li key={artifact.id} className="checklist__item checklist__item--open">
                <Icon name="eye" size={18} />
                <div>
                  <div className="checklist__title">{tk(artifact.titleKey)}</div>
                  <div className="checklist__consequence mono">{artifact.source}</div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="eyebrow">{t('debrief.unrun')}</h3>
      {unrun.length === 0 ? (
        <p className="prose" style={{ color: 'var(--status-success)' }}>
          <Icon name="check" size={16} /> {t('debrief.unrun.none')}
        </p>
      ) : (
        <ul className="checklist">
          {unrun.map((diagnostic) => (
            <li key={diagnostic.id} className="checklist__item checklist__item--open">
              <Icon name="search" size={18} />
              <div>
                <div className="checklist__title">{tk(diagnostic.titleKey)}</div>
                <div className="checklist__consequence">{tk(diagnostic.descriptionKey)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * The breakdown is a real chart now rather than four progress meters, and it
 * is lazy for the same reason the telemetry charts are: Recharts belongs in
 * its own chunk, not in the bundle every player downloads before the intro.
 */
const ScoreBreakdownChart = lazy(() => import('../charts/ScoreBreakdownChart'));

export function Debrief() {
  const ctx = useGame();
  const runtime = useRuntime();
  const score = computeScore(ctx.scoreEntries);
  const ending = ctx.ending ?? 'partial';
  const missed = unresolvedCriticalFindings(ctx);

  const humanCalls = ctx.toolLog.filter((entry) => entry.origin === 'human').length;
  const agentCalls = ctx.toolLog.filter((entry) => entry.origin === 'agent').length;

  return (
    /*
     * The same shell, minus the two columns the debrief has no use for: the
     * case is closed, so there is nothing left to navigate to and no live
     * status to watch. What stays is the frame — inset card, one header, one
     * scrolling `main` — so the last screen of the session does not look like
     * a different product from the twenty minutes before it.
     */
    <div className="console console--flat">
      <div className="console__workspace">
        <div className="console__card">
          <TopBar title={t('debrief.title')} context={t('incident.title')} titleId="debrief-title" />

          <div className="console__body">
            <main className="workspace workspace--centred" id="main">
              <Panel
                id="debrief-outcome"
                title={t('debrief.outcome')}
                tone={ending === 'partial' ? 'critical' : undefined}
                actions={
                  <Badge tone={ending === 'contained' ? 'success' : 'critical'} icon={ending === 'contained' ? 'check' : 'alert'}>
                    {t(`debrief.ending.${ending}`)}
                  </Badge>
                }
              >
                <p className="prose text-lg">
                  {t(`debrief.ending.${ending}.body`)}
                </p>

                <div className="row" style={{ gap: 'var(--space-8)' }}>
                  <div className="stat">
                    <span className="stat__label">{t('debrief.score')}</span>
                    <span className="stat__value text-kpi">
                      {score.total}
                      <span className="muted text-xl">
                        /{score.max}
                      </span>
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat__label">{t('debrief.collaboration')}</span>
                    <span className="stat__value">
                      {t('debrief.calls_human', { count: humanCalls })} ·{' '}
                      {t('debrief.calls_agent', { count: agentCalls })}
                    </span>
                  </div>
                </div>
              </Panel>

              <Panel id="debrief-breakdown" title={t('debrief.breakdown')}>
                <Suspense fallback={<ChartSkeleton height={200} />}>
                  <ScoreBreakdownChart
                    rows={BUCKETS.map((bucket) => ({
                      label: t(`debrief.bucket.${bucket}`),
                      earned: score.buckets[bucket].earned,
                      max: SCORE_BUCKET_MAX[bucket],
                    }))}
                  />
                </Suspense>
              </Panel>

              <Panel id="debrief-missed" title={t('debrief.missed')}>
                {missed.length === 0 ? (
                  <p className="prose tone-good">
                    <Icon name="check" size={16} /> {t('debrief.nothing_missed')}
                  </p>
                ) : (
                  <ul className="checklist">
                    {missed.map((id) => {
                      const finding = FINDINGS.find((f) => f.id === id);
                      if (!finding) return null;
                      return (
                        <li key={id} className="checklist__item checklist__item--open">
                          <Icon name="alert" size={18} label={t('a11y.open_icon')} />
                          <div>
                            <div className="checklist__title">{tk(finding.titleKey)}</div>
                            <div className="checklist__consequence">{tk(finding.consequenceKey)}</div>
                          </div>
                          <span className="badge badge--critical">{t('finding.open')}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>

              <MissedEvidence />

              <Panel id="debrief-decisions" title={t('debrief.decisions')}>
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">#</th>
                        <th scope="col">{t('decision.your_choice')}</th>
                        <th scope="col">{t('decision.learning_goal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DECISIONS.map((decision) => {
                        const record = ctx.decisions[decision.id];
                        const option = record
                          ? DECISION_BY_ID.get(decision.id)?.options.find((o) => o.id === record.optionId)
                          : undefined;

                        return (
                          <tr key={decision.id}>
                            <th scope="row" className="mono">
                              {decision.id}
                            </th>
                            <td>
                              {option ? (
                                <div className="stack stack--tight">
                                  <span className="row" style={{ gap: 'var(--space-2)' }}>
                                    <Badge tone={option.correct ? 'success' : 'warning'}>
                                      {option.correct ? t('finding.resolved') : t('debrief.missed')}
                                    </Badge>
                                    {tk(option.labelKey)}
                                  </span>
                                  <span className="muted text-xs">
                                    {tk(option.explanationKey)}
                                  </span>
                                </div>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td className="muted">{tk(decision.learningGoalKey)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <Panel id="debrief-entries" title={t('debrief.entries')}>
                <div className="table-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">Bucket</th>
                        <th scope="col">Δ</th>
                        <th scope="col">Reason</th>
                        <th scope="col">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {score.entries.map((entry, index) => (
                        <tr key={`${entry.source}-${index}`}>
                          <td>{t(`debrief.bucket.${entry.bucket}`)}</td>
                          <td
                            className="mono"
                            style={{ color: entry.delta < 0 ? 'var(--status-error)' : 'var(--status-success)' }}
                          >
                            {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
                          </td>
                          <td>{tk(entry.reasonKey)}</td>
                          <td className="mono muted">{entry.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>

              <div className="row">
                <Button variant="primary" onClick={() => runtime.send({ type: 'RESTART' })}>
                  {t('debrief.replay')}
                </Button>
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
