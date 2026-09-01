import {
  useCommand,
  useGame,
  useRuntime,
} from '../../app/gameContext';
import { explorations, formatElapsed } from '../../game/selectors';
import { t } from '../../i18n';
import { HINT_TOPICS, type ArtifactId, type DiagnosticId, type HintTopic } from '../../game/types';
import { Badge, Button, Icon, Panel } from '../primitives';
import { openEvidenceRecord } from './flow';
import { WebMcpPanel } from '../../webmcp/WebMcpPanel';
import { NarrationPanel } from '../narration/NarrationPanel';

/**
 * The right-hand learning and action rail — the console's third column.
 *
 * It is not a chat window, and it is not anyone's voice. It shows the guidance
 * the engine derives from the current case state, what the game will let you do
 * next, and a live feed of every tool call — human or agent — so a viewer can
 * see the collaboration happening rather than infer it.
 *
 * The guidance panel is deliberately *not* attributed to VERA. Its text is
 * `lastHint` or `lastDecision.explanation`, both produced deterministically by
 * the engine, so crediting a person for them would be false — and giving them
 * an avatar would be the second persona the redesign forbids
 * (`docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §7).
 *
 * It scrolls independently of `main`, which is the point of the shell: reading
 * to the bottom of a long evidence list must not carry the guidance off the
 * screen, and expanding it must not move the case.
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

  const optional = explorations(ctx);

  const explanation =
    ctx.lastHint?.hint ?? ctx.lastDecision?.explanation ?? t('assistant.welcome');
  const why = ctx.lastDecision?.learningGoal;

  if (collapsed) {
    return (
      <aside className="rail rail--collapsed" aria-label={t('rail.title')}>
        <button
          type="button"
          className="rail__toggle"
          aria-expanded={false}
          onClick={onToggle}
        >
          {t('rail.title')}
        </button>
      </aside>
    );
  }

  return (
    <aside className="rail" aria-label={t('rail.title')}>
      <button type="button" className="rail__toggle" aria-expanded onClick={onToggle}>
        <Icon name="agent" size={13} />
        {t('rail.title')}
      </button>

      {/*
       * The same narration channel the office renders. A line the agent speaks
       * while the player is on the dashboard has to reach them there — the
       * audit's finding was that it reached them nowhere.
       */}
      <NarrationPanel compact />

      <Panel id="rail-guidance" title={t('guidance.channel')}>
        {/*
         * No avatar block here any more. The 22px glyph in a bordered square
         * read as a portrait, and a portrait over engine-derived text is a
         * persona the product does not have. The panel title names the channel;
         * the state line and the text are what the player actually needs.
         */}
        <div className="stack stack--tight">
          <span className="guidance__state">{t(`assistant.state.${ctx.assistantState}`)}</span>
          <p className="prose" style={{ fontSize: 'var(--type-sm-size)' }} id="rail-hint">
            {explanation}
          </p>
        </div>

        {why ? (
          <div className="stack stack--tight">
            <span className="eyebrow">{t('rail.why')}</span>
            <p className="prose muted text-sm">
              {why}
            </p>
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
                // The visible label is one word, but the nav has an "Evidence"
                // item too — an accessible name has to be unique per purpose.
                aria-label={t('rail.hint.ask_about', { topic: t(`rail.hint.${topic}`) })}
                onClick={() => run((r) => r.requestHint(topic))}
              >
                {t(`rail.hint.${topic}`)}
              </Button>
            ))}
          </div>
          <span className="muted text-xs">
            {t('rail.hint.no_penalty')}
          </span>
        </div>
      </Panel>

      {/*
       * P0.6 — optional evidence is reachable, never competing. What used to
       * be "Available actions" listed up to five choices and mixed the one
       * required next action in with them, which is exactly what stopped a
       * novice from knowing where to click. The required step now lives in its
       * own card; everything genuinely optional lives behind this disclosure,
       * closed by default.
       */}
      <Panel
        id="rail-explore"
        title={t('guide.optional')}
        actions={
          optional.length > 0 ? (
            <Badge>{t('guide.explore.count', { count: optional.length })}</Badge>
          ) : null
        }
      >
        <details id="explore-more" className="explore">
          <summary className="explore__summary">{t('guide.explore')}</summary>
          <p className="muted text-xs">
            {t('guide.explore.hint')}
          </p>
          {optional.length === 0 ? (
            <p className="muted text-sm">
              {t('guide.explore.empty')}
            </p>
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

      <WebMcpPanel />

      <Panel
        id="rail-activity"
        title={t('rail.activity')}
        actions={
          <Badge tone="accent">
            {ctx.toolLog.filter((e) => e.origin === 'agent').length} {t('rail.origin.agent')}
          </Badge>
        }
      >
        {ctx.toolLog.length === 0 ? (
          <p className="muted text-sm">
            {t('rail.activity.empty')}
          </p>
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
                      <span className="muted"> · v{entry.fromVersion}→v{entry.toVersion}</span>
                    ) : (
                      <span className="tone-bad"> · {entry.errorCode}</span>
                    )}
                  </span>
                  <span className="feed__origin">
                    {entry.origin === 'agent' ? t('rail.origin.agent') : t('rail.origin.human')}
                  </span>
                </li>
              ))}
          </ol>
        )}
      </Panel>
    </aside>
  );
}
