import { useRef, useState } from 'react';

import { useCommand, useGame, useRuntime } from '../../app/gameContext';
import { explorations, formatElapsed } from '../../game/selectors';
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
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [extra, setExtra] = useState<RailExtra>('narration');

  const optional = explorations(ctx);
  const explanation =
    ctx.lastHint?.hint ?? ctx.lastDecision?.explanation ?? t('assistant.welcome');
  const why = ctx.lastDecision?.learningGoal;

  return (
    <aside className={collapsed ? 'rail rail--collapsed' : 'rail'} aria-label={t('rail.title')}>
      <button
        ref={toggleRef}
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

            <div className="stack stack--tight">
              <span className="eyebrow">{t('rail.hint')}</span>
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
              <span className="muted text-xs">{t('rail.hint.no_penalty')}</span>
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
                          >
                            <span className="mono muted">{formatElapsed(entry.atMs / 1000)}</span>
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
