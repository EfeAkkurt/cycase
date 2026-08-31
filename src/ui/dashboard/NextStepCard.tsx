import { useState } from 'react';

import { useCommand, useGame, useRuntime } from '../../app/gameContext';
import type { GameRuntime } from '../../game/runtime';
import {
  lastCompletedStep,
  nextRequiredStep,
  type GuidedCommand,
} from '../../game/selectors';
import type { ToolResult } from '../../game/types';
import { t } from '../../i18n';
import { Badge, Button, ConfirmDialog, Icon } from '../primitives';

/**
 * The single "Next required step" card (audit contract P0.6).
 *
 * The audit's finding was not that the dashboard lacked information — it was
 * that a novice could not tell which of five offered actions was the one that
 * advanced the case. So there is exactly one of these on the page, it is the
 * first thing in the workspace on every route, and it always names the action
 * that actually moves the incident forward.
 *
 * **It is now a band, not a screen.** It kept every element that made it work —
 * the step title, the checklist of what will run, the destructive badge, the
 * impact, the reason and the one primary control — and lost the vertical
 * padding, the second heading level and the 220px result block that between
 * them pushed the active destination's real content off a 1280×720 screen.
 * Nothing moved behind a disclosure that a person needs *before* they press the
 * button; the one block that moved is `LastOutcome`, which reports an action
 * already taken and therefore belongs after the thing it changed.
 *
 * It runs commands, it does not implement them. Every command goes through the
 * same `GameRuntime` methods a WebMCP tool call uses, one at a time, in plan
 * order, stopping at the first refusal. A grouped operation is therefore
 * indistinguishable from a human clicking the same buttons on the Playbook
 * route, and completely indistinguishable to the engine from an agent doing
 * the same work through `take_response_action`.
 */
export function NextStepCard() {
  const ctx = useGame();
  const runtime = useRuntime();
  const run = useCommand();
  const [failure, setFailure] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const step = nextRequiredStep(ctx);
  const decision = step?.decision ?? null;

  const runOperation = (commands: GuidedCommand[]) => {
    setFailure(null);
    setConfirming(false);
    for (const command of commands) {
      const result = run((r) => issue(r, command));
      if (!result.ok) {
        setFailure(result.error?.message ?? t('error.action_not_allowed'));
        return;
      }
    }
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
               * The destructive warning rides in the header rather than on top
               * of the impact list. It is read before the title that way, and
               * the list below it gets the full width — which is what stopped
               * the band from pushing the destination off a 720px screen on
               * the one step where the stakes are highest.
               */}
              {step.consequential ? (
                <Badge tone="critical" icon="alert">
                  {t('action.destructive_badge')}
                </Badge>
              ) : null}
              <span className="guide__progress mono">
                {t('guide.progress', { index: step.index, total: step.total })}
              </span>
            </span>
          ) : null}
        </div>

        {step ? (
          <>
            <div className="guide__lead">
              <h2 className="guide__title" id="next-step-title">
                {step.title}
              </h2>

              {decision ? null : (
                <Button
                  variant={step.consequential ? 'danger' : 'primary'}
                  id="next-step-cta"
                  className="guide__cta"
                  onClick={() => {
                    // Grouping must not quietly strip a confirmation the case
                    // author asked for. One dialog covers the operation and
                    // lists every impact inside it.
                    if (step.requiresConfirmation) setConfirming(true);
                    else runOperation(step.pending);
                  }}
                >
                  {step.cta}
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
                      onClick={() =>
                        run((r) => r.submitDecision(decision.decisionId, option.optionId))
                      }
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
                 * Kept visible, never disclosed. These name the artifacts and
                 * diagnostics the button is about to touch, and a person is
                 * entitled to read that before they press it — which is also
                 * why the impact list below is open by default whenever the
                 * step is consequential.
                 */}
                <ol className="guide__parts">
                  {step.parts.map((part) => (
                    <li
                      key={part.key}
                      className={part.done ? 'guide__part guide__part--done' : 'guide__part'}
                    >
                      <Icon name={part.done ? 'check' : 'search'} size={14} />
                      <span>{part.label}</span>
                    </li>
                  ))}
                </ol>

                {step.consequential ? (
                  <ul className="guide__impact-list">
                    {step.impacts.map((impact) => (
                      <li key={impact}>{impact}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}

            <p className="guide__why">
              <span className="guide__why-label">{t('guide.why')}</span> {step.why}
            </p>

            {failure ? (
              <p className="guide__failure" role="alert">
                {t('guide.step_failed', { reason: failure })}
              </p>
            ) : null}
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
          </>
        )}
      </div>

      {confirming && step ? (
        <ConfirmDialog
          titleKey="action.confirm_title"
          titleValues={{ label: step.title }}
          impact={step.impacts.join(' ')}
          confirmLabel={t('action.confirm')}
          onCancel={() => setConfirming(false)}
          onConfirm={() => runOperation(step.pending)}
        />
      ) : null}
    </section>
  );
}

/**
 * "What just happened" — the receipt for the step the player already ran.
 *
 * It used to be the tail of the guided card, which meant the *feedback* for the
 * last action sat between the *instruction* for the next one and the page it
 * refers to, and cost roughly 220px of the fold. It is the same block, still
 * unconditional and still fully visible; it just sits after the destination it
 * describes, which is also where a person looks after reading what changed.
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

/** One guided command, issued through the same runtime a tool call uses. */
function issue(runtime: GameRuntime, command: GuidedCommand): ToolResult {
  if (command.kind === 'inspect_artifact') {
    return runtime.inspectArtifact(command.artifactId);
  }
  if (command.kind === 'run_diagnostic') {
    return runtime.runDiagnostic(command.diagnosticId);
  }
  return runtime.takeResponseAction(command.actionId);
}
