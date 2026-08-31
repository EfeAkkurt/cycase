import { useGame } from '../../app/gameContext';
import { DECISIONS, DECISION_BY_ID } from '../../game/fixtures/case001';
import { t, tk } from '../../i18n';
import type { DecisionId } from '../../game/types';
import { Badge, Panel } from '../primitives';

/**
 * The outcome half of the D1–D6 decision layer.
 *
 * A decision is a pedagogical branch, not a SOC operation: choosing the weaker
 * option is a valid move that returns `ok: true` with a cost and an
 * explanation. What used to live here was both the question and the answer,
 * which meant the question competed with everything else on the Overview
 * route. Per the audit contract (P0.6) the *open* decision is now the single
 * "Next required step" card; this panel keeps the answered one — the choice,
 * its consequence and the transferable lesson — where it can be re-read
 * without pulling attention away from what has to happen next.
 *
 * Both surfaces call the identical `submitDecision()` domain function, so a
 * human click and an agent tool call remain indistinguishable.
 */
export function DecisionCard() {
  const ctx = useGame();

  const resolvedIds = Object.keys(ctx.decisions) as DecisionId[];
  const lastResolvedId = resolvedIds[resolvedIds.length - 1];
  const decision = lastResolvedId ? DECISION_BY_ID.get(lastResolvedId) : null;
  const record = lastResolvedId ? ctx.decisions[lastResolvedId] : undefined;
  const chosen = record ? decision?.options.find((o) => o.id === record.optionId) : undefined;

  if (!decision || !chosen) return null;

  const index = DECISIONS.findIndex((d) => d.id === decision.id) + 1;

  return (
    <Panel
      id={`decision-${decision.id}`}
      title={t('decision.title')}
      actions={
        <>
          <Badge tone="success" icon="check">
            {t('decision.resolved')}
          </Badge>
          <span className="muted text-xs">
            {t('decision.progress', { index, total: DECISIONS.length })}
          </span>
        </>
      }
    >
      <p className="decision__prompt">{tk(decision.promptKey)}</p>

      <div
        className={
          chosen.correct ? 'decision__outcome' : 'decision__outcome decision__outcome--wrong'
        }
      >
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <Badge
            tone={chosen.correct ? 'success' : 'warning'}
            icon={chosen.correct ? 'check' : 'alert'}
          >
            {t('decision.your_choice')}
          </Badge>
          <span className="text-sm">{tk(chosen.labelKey)}</span>
        </div>
        <p className="prose">{tk(chosen.explanationKey)}</p>
        <div className="stack stack--tight">
          <span className="eyebrow">{t('decision.learning_goal')}</span>
          <p className="prose muted text-sm">
            {tk(decision.learningGoalKey)}
          </p>
        </div>
      </div>
    </Panel>
  );
}
