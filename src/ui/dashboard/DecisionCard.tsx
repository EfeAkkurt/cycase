import { useGame, useRuntime } from '../../app/gameContext';
import { DECISION_BY_ID, DIAGNOSTIC_BY_ID } from '../../game/fixtures/case001';
import { correctivePath, phaseProgress, supportingSources } from '../../game/selectors';
import { t, tk } from '../../i18n';
import type { ArtifactId, DecisionId, SupportingSourceView } from '../../game/types';
import { Badge, Button, Panel } from '../primitives';
import { openEvidenceRecord } from './flow';
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
  // Empty until the decision is answered, which is exactly when this panel
  // exists — but it is the selector that decides that, not this component.
  const sources = supportingSources(ctx, decision.id);

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

        {/*
         * The records behind the correct reading. They appear here and not on
         * the open question on purpose: before the answer they would be the
         * answer, and after it they are the only way to check one.
         */}
        <SupportingSources sources={sources} />
      </div>

      {/* Only when this panel's own decision was the last command — the guided
          card owns the receipt for a decision answered from the card. */}
      <Receipt anchor={`decision-${decision.id}`} />
    </Panel>
  );
}

/**
 * The records that back the correct reading of a decision, shown only once the
 * decision has been answered.
 *
 * The point is not to repeat the explanation. The explanation asserts; these
 * say where the assertion came from, so a reader who does not believe it — or
 * who guessed correctly and knows it — has somewhere to go and check. That is
 * only worth anything if what the row offers is true, which is why every row
 * is rendered from `availability` rather than from an assumption that a source
 * named in the fixture is a source this run can reach.
 *
 * Two ways a run gets here with a source it cannot open, both ordinary: D2 can
 * be answered before the authentication timeline has ever been rebuilt, which
 * leaves that source un-run; and answering D4 by deleting the reported message
 * destroys D1's first source outright. A row that offered a link in either
 * case would be a lie the reader only finds out about by clicking it, so a
 * control is rendered for an artifact this run can genuinely open and for
 * nothing else. The rest say what stands between the reader and the record —
 * which, for a locked artifact, is the name of the query that would surface it.
 *
 * Diagnostics never get a control. `openEvidenceRecord` addresses artifacts in
 * the inspector, and a query result is not a record there; the honest form for
 * a query is its own name and whether it has been run.
 */
function SupportingSources({ sources }: { sources: SupportingSourceView[] }) {
  const runtime = useRuntime();

  if (sources.length === 0) return null;

  return (
    <ul className="stack stack--tight">
      {sources.map((source) => {
        // The query that would surface a locked artifact, named as the player
        // sees it named everywhere else rather than by its fixture id.
        const revealDiagnostic = source.revealedBy
          ? tk(DIAGNOSTIC_BY_ID.get(source.revealedBy)?.titleKey ?? source.revealedBy)
          : '';
        const titleId = `decision-source-${source.decisionId}-${source.id}`;

        return (
          <li key={`${source.kind}-${source.id}`} className="stack stack--tight">
            <div className="row" style={{ gap: 'var(--space-2)' }}>
              <span className="text-sm" id={titleId}>
                {source.title}
              </span>
              {source.availability === 'destroyed' ? (
                <Badge tone="critical" icon="trash">
                  {t('evidence.destroyed')}
                </Badge>
              ) : null}
              {source.availability === 'locked' ? (
                <Badge icon="lock">
                  {source.kind === 'artifact'
                    ? t('evidence.locked')
                    : t('investigate.source.locked')}
                </Badge>
              ) : null}
              {source.availability === 'available' && source.inspected ? (
                <Badge tone="success" icon="check">
                  {t('evidence.inspected')}
                </Badge>
              ) : null}
            </div>

            <p className="prose muted text-sm">{source.why}</p>

            {source.availability === 'destroyed' ? (
              <p className="muted text-xs">{t('evidence.destroyed_hint')}</p>
            ) : null}

            {source.availability === 'locked' && source.kind === 'diagnostic' ? (
              <p className="muted text-xs">
                {t('investigate.source.locked_hint', { diagnostic: source.title })}
              </p>
            ) : null}

            {source.availability === 'locked' && source.kind === 'artifact' && revealDiagnostic ? (
              <p className="muted text-xs">
                {t('evidence.locked_hint', { diagnostic: revealDiagnostic })}
              </p>
            ) : null}

            {source.availability === 'available' && source.kind === 'artifact' ? (
              <Button
                size="sm"
                variant="ghost"
                /*
                 * Navigation, not a command. `openEvidenceRecord` sends
                 * `SELECT_ARTIFACT` and `SET_ROUTE`, which the machine handles
                 * as plain assigns outside `runCommand` and so cannot move
                 * `stateVersion`. Calling `inspectArtifact` here instead would
                 * mark the record read a second time and bump the version for
                 * what is only a change of view — invalidating an agent's
                 * in-flight call because a human looked something up.
                 */
                onClick={() => openEvidenceRecord(runtime, source.id as ArtifactId)}
                // Every row's control carries the same label, so the record it
                // opens has to come from somewhere; the row title is already on
                // screen saying exactly that.
                aria-describedby={titleId}
              >
                {t('timeline.open_artifact')}
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
