import { Suspense, lazy, useState } from 'react';

import {
  useGame,
  useRuntime,
} from '../../app/gameContext';
import { DECISIONS, DECISION_BY_ID, DIAGNOSTICS, FINDINGS } from '../../game/fixtures/case001';
import { computeScore } from '../../game/scoring';
import {
  availableArtifacts,
  debriefAnalytics,
  retrievalQuestion,
  unresolvedCriticalFindings,
} from '../../game/selectors';
import { t, tk } from '../../i18n';
import {
  SCORE_BUCKET_MAX,
  type DebriefAnchor,
  type DebriefObservation,
  type DecisionChainLink,
  type ScoreBucket,
} from '../../game/types';
import { ChartSkeleton } from '../charts';
import { Badge, Button, Icon, Panel, StatusDot, type IconName } from '../primitives';
import { TopBar } from './TopBar';

const BUCKETS: ScoreBucket[] = ['evidence', 'containment', 'scope', 'efficiency'];

/**
 * An anchor is the difference between advice and a verdict.
 *
 * "You should have revoked the sessions first" is a judgement about a run that
 * is already over. The same sentence with the record it came from attached is a
 * place to go back to, and the anchor carries exactly that: the kind of thing,
 * its real fixture id, and the name the player saw on it. So every observation
 * that has one renders it, and the id is shown in the monospace it is written
 * in everywhere else in the console, because that is the string a player types
 * into a tool call.
 */
const ANCHOR_ICON: Record<DebriefAnchor['kind'], IconName> = {
  decision: 'node',
  artifact: 'eye',
  diagnostic: 'search',
  action: 'shield',
  finding: 'alert',
};

function Anchor({ anchor }: { anchor: DebriefAnchor }) {
  return (
    <p
      className="row"
      data-testid="debrief-anchor"
      data-anchor-kind={anchor.kind}
      style={{ gap: 'var(--space-2)' }}
    >
      <Icon name={ANCHOR_ICON[anchor.kind]} size={16} />
      <span className="checklist__title">{anchor.label}</span>
      <span className="mono muted text-xs">{anchor.id}</span>
    </p>
  );
}

/**
 * One derived observation, rendered as its own panel.
 *
 * The headline comes off the observation rather than being re-resolved here.
 * `strongestObservation` and its two siblings already decided which string this
 * is, and a surface that looks the key up a second time is a second place for
 * the two to disagree.
 */
function Observation({ id, observation }: { id: string; observation: DebriefObservation }) {
  return (
    <Panel id={id} title={observation.headline}>
      <p className="prose text-lg">{observation.body}</p>
      {observation.anchor ? <Anchor anchor={observation.anchor} /> : null}
    </Panel>
  );
}

/**
 * One link in the chain, in the order the run answered it.
 *
 * The turn is marked rather than named: there is no string in the table for
 * "this is where it went wrong", and the fact is already carried by the badge
 * beside it, so the accent is a second reading of something said in words and
 * not the only way to know. `data-pivot` is the hook the spec reads, since the
 * accent itself is a colour and a colour is not a contract.
 */
function ChainRow({ link }: { link: DecisionChainLink }) {
  return (
    <li
      className="timeline__row"
      data-decision={link.decisionId}
      data-pivot={link.pivot ? 'true' : undefined}
      style={
        link.pivot
          ? {
              borderLeft: '2px solid var(--status-error)',
              paddingLeft: 'var(--space-3)',
            }
          : undefined
      }
    >
      <span className="timeline__time">{link.at ?? '—'}</span>
      <span className="timeline__marker">
        <StatusDot tone={!link.answered ? 'neutral' : link.correct ? 'success' : 'critical'} />
      </span>
      <span className="stack stack--tight">
        <span className="timeline__label">{link.prompt}</span>
        {link.optionLabel ? <span className="muted text-xs">{link.optionLabel}</span> : null}
      </span>
      {link.answered ? (
        <Badge tone={link.correct ? 'success' : 'warning'}>
          {link.correct ? t('finding.resolved') : t('debrief.missed')}
        </Badge>
      ) : (
        <span className="muted">—</span>
      )}
    </li>
  );
}

/**
 * The optional question, and the answer it keeps back.
 *
 * The disclosure is component state on purpose, and it is the one piece of this
 * screen that must *not* be state-derived: the engine cannot reach this
 * question, and asking it, ignoring it and revealing the answer have to stay
 * indistinguishable to the engine or the promise on the panel is a lie. So
 * nothing here is dispatched, nothing is stored, and the answer is genuinely
 * absent from the document until it is asked for rather than merely hidden.
 *
 * The reveal control is dropped once it has been used because the string table
 * has no word for putting an answer back, and hiding something you have already
 * read is not a thing anybody needs.
 */
function Retrieval({ question }: { question: NonNullable<ReturnType<typeof retrievalQuestion>> }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <Panel id="debrief-retrieval" title={t('retrieval.title')}>
      <p className="muted text-sm">{t('retrieval.optional')}</p>
      <p className="prose text-lg">{question.question}</p>
      {question.anchor ? <Anchor anchor={question.anchor} /> : null}

      {revealed ? (
        <div className="stack stack--tight" data-testid="retrieval-answer">
          <h3 className="eyebrow">{t('retrieval.answer')}</h3>
          <p className="prose">{question.modelAnswer}</p>
        </div>
      ) : (
        <div className="row">
          <Button onClick={() => setRevealed(true)}>{t('retrieval.reveal')}</Button>
        </div>
      )}
    </Panel>
  );
}

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
  const analytics = debriefAnalytics(ctx);
  const question = retrievalQuestion(ctx);

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
              {/*
               * The teaching pass comes first, and that ordering is the whole
               * change. A screen that opens on a number tells a player how they
               * did; the number is the last thing they can act on and the first
               * thing they stop reading past. What they can act on is what they
               * did well, what to do next, what it generalises to, and where the
               * run turned — so those are what the screen opens on, and the
               * score keeps every panel and every id it had, one scroll down.
               */}
              <Observation id="debrief-strongest" observation={analytics.strongest} />
              <Observation id="debrief-improve" observation={analytics.improve} />
              <Observation id="debrief-lesson" observation={analytics.lesson} />

              {/*
               * Two clocks with the reason they differ, rather than two numbers
               * a reader is left to reconcile. Unexplained, the gap reads as a
               * penalty for being slow, which is the exact opposite of what this
               * case teaches; `debrief.time.why` says it is neither scored nor a
               * measure of them. Both labels are formatted by the selector, so
               * no arithmetic happens on this screen.
               */}
              <Panel id="debrief-time" title={t('clock.explain')}>
                <div className="row" style={{ gap: 'var(--space-8)' }}>
                  <div className="stat">
                    <span className="stat__label">{t('debrief.time.real')}</span>
                    <span className="stat__value text-xl mono" data-testid="debrief-time-real">
                      {analytics.time.realLabel}
                    </span>
                  </div>
                  <div className="stat">
                    <span className="stat__label">{t('debrief.time.sim')}</span>
                    <span className="stat__value text-xl mono" data-testid="debrief-time-sim">
                      {analytics.time.simulatedLabel}
                    </span>
                  </div>
                </div>
                <p className="prose">{t('debrief.time.why')}</p>
              </Panel>

              {/*
               * The chain, in the order the run answered it — which is not the
               * fixture order the table below uses, and that is the point. A
               * table sorted by id says which calls were right; a chain says
               * which call the later ones followed from.
               */}
              <Panel id="debrief-chain" title={t('debrief.chain')}>
                <ol className="timeline">
                  {analytics.chain.map((link) => (
                    <ChainRow key={link.decisionId} link={link} />
                  ))}
                </ol>
              </Panel>

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

              {/*
               * "Run the case again" on its own sends a player back to repeat
               * the run they just had. The goal the engine picked names the one
               * call worth getting right this time, so the button has something
               * to be a second attempt *at*.
               */}
              <div className="stack" id="debrief-replay">
                <p className="prose text-lg">
                  {t('debrief.replay_goal', { goal: analytics.replayGoal })}
                </p>
                <div className="row">
                  <Button variant="primary" onClick={() => runtime.send({ type: 'RESTART' })}>
                    {t('debrief.replay')}
                  </Button>
                </div>
              </div>

              {question ? <Retrieval question={question} /> : null}
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
