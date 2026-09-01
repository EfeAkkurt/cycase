import { useGame } from '../../app/gameContext';
import { DECISION_BY_ID } from '../../game/fixtures/case001';
import { correctivePath, phaseProgress } from '../../game/selectors';
import { t, tk } from '../../i18n';
import type { DecisionId } from '../../game/types';
import { Badge, Panel } from '../primitives';
import { Receipt } from './Receipt';

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
 * It no longer counts decisions. "Decision 3 of 6" was a second progress model
 * competing with the guided card's own count, and a player given two different
 * answers to "how far through this am I?" has effectively been given none.
 * There is one model — the incident's phases — and this panel reports the phase
 * the answered decision belongs to rather than inventing a scale of its own.
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

  const progress = phaseProgress(ctx);
  // What a weaker branch actually left open, if anything is still fixable.
  const corrections = chosen.correct ? [] : correctivePath(ctx);

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
            {progress.complete ? t('phase.complete') : progress.label}
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

        {/*
         * A weaker branch keeps its cost — the score entry stands and the
         * debrief still narrates it. What it gains is a way forward: the
         * operation that still closes the finding, named here instead of
         * quietly withheld for the rest of the case.
         */}
        {corrections.length > 0 ? (
          <p className="prose text-sm" id={`decision-corrective-${decision.id}`}>
            {t('corrective.intro')} {corrections[0]!.why}
          </p>
        ) : null}
      </div>

      {/* Only when this panel's own decision was the last command — the guided
          card owns the receipt for a decision answered from the card. */}
      <Receipt anchor={`decision-${decision.id}`} />
    </Panel>
  );
}
