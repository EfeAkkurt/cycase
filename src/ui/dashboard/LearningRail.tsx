import { useState } from 'react';

import { useCommand, useGame, useRuntime } from '../../app/gameContext';
import {
  explorations,
  formatElapsed,
  hintedDecisionId,
  nextDecisionHint,
} from '../../game/selectors';
import { t } from '../../i18n';
import { HINT_TOPICS, type ArtifactId, type DiagnosticId, type HintTopic } from '../../game/types';
import { Badge, Button, Icon, Panel, Tabs } from '../primitives';
import { openEvidenceRecord } from './flow';
import { WebMcpPanel } from '../../webmcp/WebMcpPanel';
import { NarrationPanel } from '../narration/NarrationPanel';

type RailExtra = 'narration' | 'explore' | 'activity' | 'tools';

/**
 * The right-hand learning and action rail.
 *
 * Guidance is always the first thing in the open rail. Narration, optional
 * evidence, activity and registered tools sit behind a tab strip so they cannot
 * bury the next step. The rail itself starts collapsed; the toggle is how
 * guidance stays findable at 1280px.
 *
 * Three voices reach the player here and the rail keeps them apart. VERA
 * reports operational fact from inside the estate; the generated channel
 * teaches from outside it and is labelled as generated wherever it speaks; the
 * dashboard is the record both are talking about. A *pointer* is none of the
 * three — it is the console reading the player's own case state back to them —
 * which is why the pointer panel below carries no speaker, no avatar and no
 * tone, and why nothing in it is ever narrated.
 */
export function LearningRail({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const ctx = useGame();
  const runtime = useRuntime();
  const run = useCommand();
  const [extra, setExtra] = useState<RailExtra>('narration');

  const optional = explorations(ctx);
  const explanation =
    ctx.lastHint?.hint ?? ctx.lastDecision?.explanation ?? t('assistant.welcome');
  const why = ctx.lastDecision?.learningGoal;

  /*
   * The pointer ladder, read rather than remembered.
   *
   * `hintedDecisionId` is the decision an ask would be about — the next one
   * unanswered, blocked or not — and returns null once the case has answered
   * all six, which is the only state with no pointer to offer. `nextDecisionHint`
   * reports the rung the *next* ask would land on without advancing it, so the
   * panel can promise what asking buys before the player spends the ask.
   */
  const pointerDecisionId = hintedDecisionId(ctx);
  const pointer = pointerDecisionId ? nextDecisionHint(ctx, pointerDecisionId) : null;
  /*
   * The rung already served, shown only while it is still a rung about the
   * decision the player is on.
   *
   * Two exclusions, both of which put the wrong thing on screen. A run that has
   * answered D2 still holds the rung it was handed for D2, and that text has
   * stopped being a pointer and become an answer key to a question already
   * closed. And an *exhausted* view is not a rung at all — the engine hands
   * back level 3 carrying `hint.exhausted`, so rendering it here would pair the
   * "Reason it through" label with a line saying there is nothing to reason
   * about, and print that line twice with the statement below.
   */
  const served =
    ctx.lastHint?.decision &&
    ctx.lastHint.decision.decisionId === pointerDecisionId &&
    !ctx.lastHint.decision.exhausted
      ? ctx.lastHint.decision
      : null;

  /*
   * The one-time explainer, derived from the case rather than remembered by the
   * browser.
   *
   * `stateVersion === 0` is "the case has not moved yet", and it is the right
   * reading of first arrival for two reasons the alternatives get wrong. It is
   * monotonic — the engine only ever raises it — so the explainer cannot come
   * back after the run has begun, which no ref or storage flag can promise
   * across the office/dashboard round trip and `replay()`. And it survives the
   * things that are not the player starting: `get_incident` is a pure read,
   * and neither `present_guidance` nor `request_hint` bumps the version, so an
   * agent narrating a line before the player has done anything leaves the
   * explainer up — which is precisely the moment its point about who is
   * talking is worth most. `commandLog.length === 0` would have dismissed it
   * on exactly that line.
   */
  const firstArrival = ctx.stateVersion === 0;

  return (
    <aside className={collapsed ? 'rail rail--collapsed' : 'rail'} aria-label={t('rail.title')}>
      <button
        type="button"
        className="rail__toggle"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        {collapsed ? null : <Icon name="agent" size={13} />}
        {collapsed ? t('rail.expand') : t('rail.collapse')}
      </button>

      {collapsed ? null : (
        <>
          {firstArrival ? (
            <Panel id="rail-intro" title={t('learning.intro.title')} variant="summary">
              <div className="stack stack--tight">
                <p className="prose text-sm">{t('learning.intro.vera')}</p>
                <p className="prose text-sm">{t('learning.intro.codex')}</p>
                <p className="prose text-sm">{t('learning.intro.dashboard')}</p>
              </div>
            </Panel>
          ) : null}

          <Panel id="rail-guidance" title={t('guidance.channel')} variant="summary">
            <div className="stack stack--tight">
              <span className="guidance__state">{t(`assistant.state.${ctx.assistantState}`)}</span>
              <p className="prose" style={{ fontSize: 'var(--type-sm-size)' }} id="rail-hint">
                {explanation}
              </p>
            </div>

            {why ? (
              <div className="stack stack--tight">
                <span className="eyebrow">{t('rail.why')}</span>
                <p className="prose muted text-sm">{why}</p>
              </div>
            ) : null}
          </Panel>

          {/*
           * Pointers live outside the guidance panel on purpose. That panel is
           * titled with `guidance.channel` — the label the explainer above
           * teaches the player to read as "written by a model" — and a pointer
           * is not that. It is not VERA either. Giving it its own unattributed
           * panel is the cheapest way to keep the claim the explainer makes
           * true on the same screen that makes it.
           */}
          <Panel id="rail-pointer" title={t('rail.hint')} variant="summary">
            {served ? (
              <div className="stack stack--tight">
                <span className="eyebrow">
                  {/* Numerals, not a sentence: the rung's own label already says
                      what the rung is, and an "N of M" written out here would
                      read as one more progress counter in a console that runs
                      exactly one. */}
                  <Badge>{`${served.level}/${served.levelsTotal}`}</Badge> {served.levelLabel}
                </span>
                <p className="prose text-sm">{served.text}</p>
              </div>
            ) : null}

            <div className="stack stack--tight">
              {pointer === null ? null : pointer.exhausted ? (
                /*
                 * Said plainly rather than by re-serving rung 3. A ladder that
                 * hands its last rung back on every further ask teaches that
                 * asking is free noise, which is the one habit a pointer must
                 * not build.
                 */
                <p className="prose muted text-sm">{t('hint.exhausted')}</p>
              ) : (
                /*
                 * What the next ask buys, before it is spent: which rung it
                 * lands on and what that rung does. The rung's *text* is
                 * deliberately not previewed — a pointer read without asking
                 * for it is just the answer moved one line up the panel.
                 */
                <span className="eyebrow">
                  <Badge>{`${pointer.level}/${pointer.levelsTotal}`}</Badge> {pointer.levelLabel}
                </span>
              )}

              <div className="row" style={{ gap: 'var(--space-2)' }}>
                {HINT_TOPICS.map((topic: HintTopic) => (
                  <Button
                    key={topic}
                    size="sm"
                    variant="ghost"
                    aria-label={t('rail.hint.ask_about', { topic: t(`rail.hint.${topic}`) })}
                    onClick={() => run((r) => r.requestHint(topic))}
                  >
                    {t(`rail.hint.${topic}`)}
                  </Button>
                ))}
              </div>

              {/* One promise, not two: `hint.free` says what `rail.hint.no_penalty`
                  said and also names the debrief, which is where a novice
                  expects the bill for help to arrive. */}
              <span className="muted text-xs">{t('hint.free')}</span>
            </div>
          </Panel>

          <div className="rail__extras">
            <Tabs
              idBase="rail-extra"
              label={t('rail.extras')}
              value={extra}
              onChange={setExtra}
              options={[
                { id: 'narration', label: t('rail.tab.narration') },
                {
                  id: 'explore',
                  label: t('rail.tab.explore'),
                  badge: optional.length > 0 ? String(optional.length) : undefined,
                },
                { id: 'activity', label: t('rail.tab.activity') },
                { id: 'tools', label: t('rail.tab.tools') },
              ]}
            />

            {extra === 'narration' ? (
              <div role="tabpanel" aria-labelledby="rail-extra-tab-narration">
                <NarrationPanel compact />
              </div>
            ) : null}

            {extra === 'explore' ? (
              <div role="tabpanel" aria-labelledby="rail-extra-tab-explore">
                <Panel
                  id="rail-explore"
                  title={t('guide.optional')}
                  variant="disclosure"
                  actions={
                    optional.length > 0 ? (
                      <Badge>{t('guide.explore.count', { count: optional.length })}</Badge>
                    ) : null
                  }
                >
                  <details id="explore-more" className="explore">
                    <summary className="explore__summary">{t('guide.explore')}</summary>
                    <p className="muted text-xs">{t('guide.explore.hint')}</p>
                    {optional.length === 0 ? (
                      <p className="muted text-sm">{t('guide.explore.empty')}</p>
                    ) : (
                      <ul className="stack stack--tight">
                        {optional.map((item) => (
                          <li key={`${item.kind}-${item.id}`}>
                            <Button
                              size="sm"
                              variant="ghost"
                              block
                              reason={item.note}
                              // The same artifact is also listed in the evidence panel,
                              // so this shortcut needs its own accessible name.
                              aria-label={t('guide.explore.open', { label: item.label })}
                              /*
                               * The same behaviour as every other "open this record"
                               * control in the console: navigate to it. This one used to
                               * inspect first and navigate second, which marked evidence
                               * read a frame before the reader could possibly have seen
                               * it — the inspector records the read now, once the record
                               * is genuinely on screen. Diagnostics are unchanged: they
                               * are operations, not records, and running one is the
                               * whole point of pressing it.
                               */
                              onClick={() => {
                                if (item.kind === 'inspect_artifact') {
                                  openEvidenceRecord(runtime, item.id as ArtifactId);
                                } else {
                                  run((r) => r.runDiagnostic(item.id as DiagnosticId));
                                  runtime.send({ type: 'SET_ROUTE', route: 'respond' });
                                }
                              }}
                            >
                              {item.label}
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                </Panel>
              </div>
            ) : null}

            {extra === 'activity' ? (
              <div role="tabpanel" aria-labelledby="rail-extra-tab-activity">
                <Panel
                  id="rail-activity"
                  title={t('rail.activity')}
                  variant="disclosure"
                  actions={
                    <Badge tone="accent">
                      {ctx.toolLog.filter((entry) => entry.origin === 'agent').length}{' '}
                      {t('rail.origin.agent')}
                    </Badge>
                  }
                >
                  {ctx.toolLog.length === 0 ? (
                    <p className="muted text-sm">{t('rail.activity.empty')}</p>
                  ) : (
                    <ol className="feed">
                      {[...ctx.toolLog]
                        .reverse()
                        .slice(0, 24)
                        .map((entry) => (
                          <li
                            key={entry.seq}
                            className={entry.ok ? 'feed__row' : 'feed__row feed__row--error'}
                            /*
                             * `.feed` is a capped flex column, so its rows are
                             * shrinkable flex items — which was invisible while
                             * every row was one line and became a row printing
                             * its opened raw line over the entry beneath it. The
                             * cap is there to make the feed scroll, not to
                             * compress what a row is saying.
                             */
                            style={{ flexShrink: 0 }}
                          >
                            <span className="mono muted">{formatElapsed(entry.atMs / 1000)}</span>
                            <div className="stack stack--tight">
                              {/*
                               * What happened, in the sentence the engine already
                               * writes for this row — `ToolLogEntry.summary` exists
                               * for the feed and the feed used to ignore it in favour
                               * of the wire name. A reader should not have to know
                               * that `submit_decision` is how a decision is answered
                               * to follow what has been done to their case.
                               */}
                              <span
                                className={entry.ok ? 'feed__summary' : 'feed__summary tone-bad'}
                              >
                                {entry.summary}
                              </span>
                              {/*
                               * The wire form stays, one press away, because it is
                               * evidence and not decoration: the exact command name
                               * and the two state versions are what let a player
                               * check a disputed row against the state their agent
                               * claimed to be acting on. Attribution stays out here
                               * in the open beside it, since that is the question a
                               * novice asks first and should never have to open
                               * anything to answer.
                               */}
                              <details className="explore">
                                <summary className="explore__summary">
                                  {t('activity.raw_show')}
                                </summary>
                                {/*
                                 * A `stack`, not two loose spans. Inline spans
                                 * inside the disclosure share one line box, and
                                 * with the mono raw line's taller leading they
                                 * overlapped each other and spilled past the
                                 * row — a feed that renders its own evidence
                                 * over the next entry is not readable evidence.
                                 */}
                                <div className="stack stack--tight">
                                  <span className="eyebrow">{t('activity.raw')}</span>
                                  <span className="feed__tool">
                                    {entry.tool}
                                    {entry.ok ? (
                                      <span className="muted">
                                        {' '}
                                        · v{entry.fromVersion}→v{entry.toVersion}
                                      </span>
                                    ) : (
                                      <span className="tone-bad"> · {entry.errorCode}</span>
                                    )}
                                  </span>
                                </div>
                              </details>
                            </div>
                            <span className="feed__origin">
                              {entry.origin === 'agent'
                                ? t('rail.origin.agent')
                                : t('rail.origin.human')}
                            </span>
                          </li>
                        ))}
                    </ol>
                  )}
                </Panel>
              </div>
            ) : null}

            {extra === 'tools' ? (
              <div role="tabpanel" aria-labelledby="rail-extra-tab-tools">
                <WebMcpPanel />
              </div>
            ) : null}
          </div>
        </>
      )}
    </aside>
  );
}
