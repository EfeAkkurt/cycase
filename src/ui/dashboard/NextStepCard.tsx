import { useState } from 'react';

import { useCommand, useGame, useRuntime } from '../../app/gameContext';
import {
  correctivePath,
  lastCompletedStep,
  nextRequiredStep,
  phaseProgress,
  type CorrectiveStep,
  type GuidedStage,
  type PhaseProgress,
} from '../../game/selectors';
import { t } from '../../i18n';
import { Badge, Button, ConfirmDialog, Icon } from '../primitives';
import { openEvidenceRecord } from './flow';
import { Receipt, issueCommand } from './Receipt';
import { claimReceipt } from './receiptClaim';
import { useMainScrollMemory } from './scrollMemory';

/**
 * The single "Next required step" card.
 *
 * There is exactly one of these on the page, it is the first thing in the
 * workspace on every route, and it always names the action that actually moves
 * the incident forward.
 *
 * **One click is one action.** The containment step used to run five commands
 * from one press — a session inventory, two credential operations, an evidence
 * read and an endpoint isolation — under a single confirmation that named the
 * group rather than the parts. Four of the five were invisible until they had
 * already happened, there was no point at which a player could stop, and a
 * failure in the middle left a half-applied operation with one line of text to
 * explain it. The card now runs the *next stage only*: the checklist says what
 * the operation is, the control names the one thing it is about to do, and the
 * receipt for that one thing appears beside it before anything else is offered.
 *
 * **Opening a record is navigation, not a mutation.** An evidence stage takes
 * the player to the record. The case records it as read when the inspector has
 * it on screen — see `flow.ts` — which is what makes "you cannot pass D2 without
 * seeing the evidence" true rather than aspirational.
 *
 * It runs commands, it does not implement them. Every command goes through the
 * same `GameRuntime` methods a WebMCP tool call uses, so a guided click is
 * indistinguishable to the engine from an agent doing the same work.
 */
export function NextStepCard() {
  const ctx = useGame();
  const runtime = useRuntime();
  const run = useCommand();
  const [confirming, setConfirming] = useState<GuidedStage | null>(null);

  useMainScrollMemory(ctx.route);

  const step = nextRequiredStep(ctx);
  const progress = phaseProgress(ctx);
  const decision = step?.decision ?? null;
  const corrections = correctivePath(ctx);

  /**
   * Runs one stage. Never a list.
   *
   * An evidence stage is not run at all — it is navigated to, and the inspector
   * records the read once the record is genuinely on screen.
   */
  const runStage = (stage: GuidedStage) => {
    setConfirming(null);

    if (stage.command.kind === 'inspect_artifact') {
      openEvidenceRecord(runtime, stage.command.artifactId);
      return;
    }

    run((r) => issueCommand(r, stage.command));
    // The card issued it, so the card shows the receipt — including when the
    // call was refused, which is the moment a receipt matters most.
    claimReceipt(runtime.context.seq);
  };

  const pressStage = (stage: GuidedStage) => {
    // A confirmation belongs to the operation the case author marked, and to
    // nothing queued behind it. Navigation and diagnostics never raise one.
    if (stage.requiresConfirmation) setConfirming(stage);
    else runStage(stage);
  };

  return (
    <section
      className="guide"
      id="next-step"
      data-testid="next-required-step"
      aria-labelledby="next-step-title"
    >
      <div className="guide__body">
        <div className="guide__head">
          <span className="guide__eyebrow">
            <Icon name="agent" size={14} />
            {t('guide.title')}
          </span>
          {step ? (
            <span className="guide__head-right">
              {/*
               * The destructive warning describes the *stage*, never the step.
               * Warning "destructive" over a read-only session inventory
               * because a revocation is queued behind it is how a player learns
               * to ignore the warning that matters.
               */}
              {step.consequential ? (
                <Badge tone="critical" icon="alert">
                  {t('action.destructive_badge')}
                </Badge>
              ) : null}
              <PhaseProgressReadout progress={progress} />
            </span>
          ) : null}
        </div>

        <PhaseRail progress={progress} />

        {step ? (
          <>
            <div className="guide__lead">
              <h2 className="guide__title" id="next-step-title">
                {step.title}
              </h2>

              {decision || !step.stage ? null : (
                <Button
                  variant={step.consequential ? 'danger' : 'primary'}
                  id="next-step-cta"
                  className="guide__cta"
                  onClick={() => pressStage(step.stage!)}
                >
                  {step.stage.cta}
                </Button>
              )}
            </div>

            {decision ? (
              <div id={`decision-${decision.decisionId}`} className="guide__decision">
                <p className="guide__prompt">{decision.prompt}</p>
                <div className="guide__options">
                  {decision.options.map((option) => (
                    <Button
                      key={option.optionId}
                      variant="default"
                      block
                      id={`decision-option-${option.optionId}`}
                      onClick={() => {
                        run((r) => r.submitDecision(decision.decisionId, option.optionId));
                        claimReceipt(runtime.context.seq);
                      }}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
                <p className="guide__hint">{t('guide.decision_hint')}</p>
              </div>
            ) : (
              <div className="guide__operation">
                {/*
                 * Kept visible, never disclosed. These name the artifacts,
                 * diagnostics and operations the step is made of, with the one
                 * the button is about to run marked — so a player can see both
                 * what this press does and what it does not.
                 */}
                <ol className="guide__parts">
                  {step.parts.map((part) => (
                    <li
                      key={part.key}
                      className={part.done ? 'guide__part guide__part--done' : 'guide__part'}
                      data-current={part.current ? 'true' : undefined}
                      aria-current={part.current ? 'step' : undefined}
                    >
                      <Icon name={part.done ? 'check' : part.current ? 'eye' : 'search'} size={14} />
                      {/* Weight, not a new class: the one part about to run is
                          the only one in the list set in the primary colour. */}
                      {part.current ? <strong>{part.label}</strong> : <span>{part.label}</span>}
                    </li>
                  ))}
                </ol>

                {step.stage?.impact && step.consequential ? (
                  <ul className="guide__impact-list">
                    <li>{step.stage.impact}</li>
                  </ul>
                ) : null}

                {step.upcoming.length > 0 ? (
                  <p className="muted text-sm" id="next-step-upcoming">
                    <span className="guide__why-label">{t('guide.stage.then')}</span>{' '}
                    {step.upcoming.map((stage) => stage.label).join(' · ')}
                  </p>
                ) : null}

                {step.pending.length > 1 ? (
                  <p className="muted text-xs">{t('guide.stage.one_at_a_time')}</p>
                ) : null}
              </div>
            )}

            <p className="guide__why">
              <span className="guide__why-label">{t('guide.why')}</span> {step.why}
            </p>

            {/* The receipt for whatever this card just ran, beside the control
                that ran it. Failures included — that is where a person looks. */}
            <Receipt claimed />
          </>
        ) : (
          <>
            <div className="guide__lead">
              <h2 className="guide__title" id="next-step-title">
                {t('guide.closed')}
              </h2>
              <Button
                variant="primary"
                id="next-step-cta"
                className="guide__cta"
                onClick={() => runtime.send({ type: 'OPEN_DEBRIEF' })}
              >
                {t('debrief.title')}
              </Button>
            </div>
            <p className="guide__why">{t('guide.closed.body')}</p>
            <Receipt claimed />
          </>
        )}

        <CorrectivePath steps={corrections} />
      </div>

      {confirming ? (
        <ConfirmDialog
          titleKey="action.confirm_title"
          titleValues={{ label: confirming.label }}
          impact={confirming.impact ?? ''}
          confirmLabel={t('action.confirm')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => runStage(confirming)}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Progress — one model, stated once
 * ------------------------------------------------------------------ */

function PhaseProgressReadout({ progress }: { progress: PhaseProgress }) {
  return (
    <span className="guide__progress mono" id="phase-progress">
      {progress.complete
        ? t('phase.complete')
        : t('phase.progress', {
            phase: progress.label,
            index: progress.stageIndex,
            total: Math.max(progress.stageTotal, 1),
          })}
    </span>
  );
}

/**
 * Triage → Investigate → Contain → Scope → Close.
 *
 * The console used to answer "how far through this am I?" twice, with two
 * different units that never agreed: a step-of-eleven count over a plan whose
 * length is an implementation detail, and a decision-of-six count over a
 * different thing entirely. This is the one model, it is the incident's own,
 * and the counts that remain are positions inside the active phase rather than
 * rival claims about the case.
 */
const PHASE_TONE = {
  done: { tone: 'success', icon: 'check' },
  active: { tone: 'accent', icon: 'eye' },
  upcoming: { tone: 'neutral', icon: undefined },
} as const;

function PhaseRail({ progress }: { progress: PhaseProgress }) {
  return (
    // `.row` and `Badge`, not a new component: the phase rail is a row of
    // states, which the design system already draws. Never colour alone —
    // every badge carries its state in an `sr-only` clause as well.
    <ol className="row" id="phase-rail" aria-label={t('phase.rail')}>
      {progress.phases.map((phase) => {
        const style = PHASE_TONE[phase.state];
        return (
          <li
            key={phase.id}
            id={`phase-${phase.id}`}
            data-phase-state={phase.state}
            aria-current={phase.state === 'active' ? 'step' : undefined}
          >
            <Badge tone={style.tone} icon={style.icon}>
              {phase.label}
              <span className="sr-only"> — {t(`phase.state.${phase.state}`)}</span>
              <span className="mono muted" aria-hidden="true">
                {' '}
                {t('phase.count', { done: phase.done, total: phase.total })}
              </span>
            </Badge>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ *
 * The corrective path
 * ------------------------------------------------------------------ */

/**
 * How to fix an incident a wrong decision left broken.
 *
 * Secondary on purpose. The required path still reflects what the player
 * actually decided, the wrong decision keeps its score and its place in the
 * debrief, and nothing here is retroactive — this is simply the operation that
 * still closes the finding, named out loud instead of quietly withheld for the
 * rest of the case.
 */
function CorrectivePath({ steps }: { steps: CorrectiveStep[] }) {
  const run = useCommand();
  const runtime = useRuntime();
  const [confirming, setConfirming] = useState<CorrectiveStep | null>(null);

  if (steps.length === 0) return null;
  const [first, ...rest] = steps as [CorrectiveStep, ...CorrectiveStep[]];

  const apply = (step: CorrectiveStep) => {
    setConfirming(null);
    run((r) => issueCommand(r, step.command));
    claimReceipt(runtime.context.seq);
  };

  return (
    <div className="stack stack--tight" id="corrective-path">
      <div className="row">
        <span className="eyebrow">{t('corrective.title')}</span>
        <Badge tone="warning" icon="alert">
          {t('corrective.count', { count: steps.length })}
        </Badge>
      </div>
      <p className="muted text-sm">{t('corrective.intro')}</p>
      <p className="prose text-sm" id="corrective-why">
        {first.why}
      </p>
      <Button
        id="corrective-cta"
        size="sm"
        variant={first.destructive ? 'danger' : 'primary'}
        reason={first.impact}
        onClick={() => (first.requiresConfirmation ? setConfirming(first) : apply(first))}
      >
        <Icon name="shield" size={13} />
        {t('corrective.cta', { label: first.label })}
      </Button>
      {rest.length > 0 ? (
        <p className="muted text-xs">
          {t('guide.stage.then')} {rest.map((step) => step.label).join(' · ')}
        </p>
      ) : null}

      {confirming ? (
        <ConfirmDialog
          titleKey="action.confirm_title"
          titleValues={{ label: confirming.label }}
          impact={confirming.impact}
          confirmLabel={t('action.confirm')}
          onCancel={() => setConfirming(null)}
          onConfirm={() => apply(confirming)}
        />
      ) : null}
    </div>
  );
}

/**
 * "What just happened" — the summary for the whole guided step.
 *
 * Kept, and kept last. It is a different claim from the per-command receipt
 * above: that one reports the single operation the player just authorised,
 * this one reports the step it belonged to, once the step is finished. The fold
 * order it sits in is measured by `tests/e2e/shell.spec.ts`.
 */
export function LastOutcome() {
  const ctx = useGame();
  const done = lastCompletedStep(ctx);
  if (!done) return null;

  return (
    <section className="outcome" id="last-outcome" aria-labelledby="last-outcome-title">
      <h2 className="outcome__title" id="last-outcome-title">
        {t('guide.done_title')}
      </h2>
      <p className="outcome__step">{done.title}</p>
      <dl className="outcome__grid">
        <dt>{t('guide.result')}</dt>
        <dd className="prose">{done.result}</dd>
        <dt>{t('guide.changed')}</dt>
        <dd>
          <ul className="outcome__changed">
            {done.changed.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </dd>
        <dt>{t('guide.mattered')}</dt>
        <dd className="prose">{done.why}</dd>
      </dl>
    </section>
  );
}
