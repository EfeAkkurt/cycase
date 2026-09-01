import { t, tk } from '../i18n';
import type { StringKey } from '../i18n';
import {
  ARTIFACT_BY_ID,
  DECISION_BY_ID,
  DIAGNOSTIC_BY_ID,
  HINTS,
  RESPONSE_ACTION_BY_ID,
} from './fixtures/case001';
import {
  appendNarrative,
  buildCoachingSnapshot,
  narrativeSequenceOf,
  requiredNextAction,
  sanitiseGuidanceMessage,
} from './narrative';
import { compactScore, computeScore } from './scoring';
import {
  diagnosticRows,
  diffSources,
  sourceSnapshot,
  stillOpen,
  touchedSources,
} from './sources';
import {
  actionAvailability,
  allowedNextActions,
  artifactAvailability,
  availableArtifacts,
  availableDiagnostics,
  elapsedSeconds,
  formatClock,
  formatElapsed,
  hasPerformed,
  incidentClock,
  incidentStatus,
  isDecisionUnlocked,
  knownFacts,
  blockedDecisionView,
  openDecisionView,
  openQuestions,
  unresolvedCriticalFindings,
} from './selectors';
import { CASE_ID, INCIDENT_ID } from './fixtures/case001';
import { COMMAND_SCHEMAS, validate } from './validation';
import {
  IDEMPOTENT_COMMANDS,
  VERSIONED_COMMANDS,
  VERSION_BUMPING_COMMANDS,
  type ArtifactId,
  type ArtifactView,
  type CallOrigin,
  type CommandKind,
  type DecisionId,
  type DecisionOptionId,
  type DecisionResultView,
  type DiagnosticId,
  type DiagnosticView,
  type Ending,
  type FindingId,
  type FlagId,
  type GameCommand,
  type GameContext,
  type GuidanceProposal,
  type GuidanceView,
  type HintTopic,
  type HintView,
  type IncidentView,
  type NarrativeEntry,
  type PresentGuidanceInput,
  type ResponseActionId,
  type ResponseActionView,
  type ScoreEntry,
  type ScoreEntryTemplate,
  type ToolError,
  type ToolErrorCode,
  type ToolLogEntry,
  type ToolResult,
} from './types';

/**
 * The deterministic command executor.
 *
 * This is the single seam described in docs/PROJECT_CONTEXT.md §6: dashboard
 * controls and WebMCP tools both land here. It is a pure function — no clocks,
 * no randomness, no I/O — so the whole case is replayable from its command log
 * and testable without a browser.
 */

export interface EngineOutcome {
  context: GameContext;
  result: ToolResult & { seq: number };
}

/** Simulated seconds each command consumes on the incident clock. */
const COMMAND_CLOCK_COST: Record<CommandKind, number> = {
  get_incident: 0,
  request_hint: 0,
  // Narration is free. If speaking cost simulated seconds, a chatty narrator
  // would spend the player's incident clock and change `elapsed` — narration
  // moving a domain number is exactly what this feature must not do.
  present_guidance: 0,
  inspect_artifact: 20,
  run_diagnostic: 45,
  submit_decision: 15,
  take_response_action: 30,
};

/** Artifacts whose first inspection is worth evidence points. */
const SCORED_INSPECTIONS: Partial<Record<ArtifactId, ScoreEntryTemplate>> = {
  art_email_001: { bucket: 'evidence', delta: 4, reasonKey: 'score.inspect_email' },
  art_cookie_001: { bucket: 'evidence', delta: 3, reasonKey: 'score.inspect_cookie' },
  art_edr_001: { bucket: 'evidence', delta: 3, reasonKey: 'score.inspect_edr' },
};

const MAX_IDEMPOTENCY_ENTRIES = 200;
const MAX_TOOL_LOG_ENTRIES = 300;

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

export function executeCommand(ctx: GameContext, command: GameCommand): EngineOutcome {
  const seq = ctx.seq + 1;
  const fromVersion = ctx.stateVersion;

  // 1. Runtime validation. JSON Schema is a hint for the model; this is the gate.
  const schema = COMMAND_SCHEMAS[command.kind];
  const parsed = validate<Record<string, unknown>>(schema, command.input ?? {});
  if (!parsed.ok) {
    return reject(ctx, command, seq, {
      code: 'INVALID_INPUT',
      message: parsed.message,
      recovery: t('error.stale.recovery'),
    });
  }

  // 2. Idempotency replay comes *before* the staleness check: a retry of an
  //    already-applied call legitimately carries the pre-application version.
  if (IDEMPOTENT_COMMANDS.includes(command.kind)) {
    const key = String((parsed.value as { idempotencyKey?: unknown }).idempotencyKey ?? '');
    const stored = ctx.idempotency[key];
    if (stored) {
      return {
        context: {
          ...ctx,
          seq,
          lastResult: { ...stored.result, seq },
          toolLog: appendLog(ctx, {
            seq,
            atMs: elapsedSeconds(ctx) * 1000,
            tool: command.kind,
            origin: command.origin,
            ok: stored.result.ok,
            fromVersion,
            toVersion: ctx.stateVersion,
            effectId: 'idempotent-replay',
            summary: `${command.kind} replayed from idempotency key`,
          }),
        },
        result: { ...stored.result, seq },
      };
    }
  }

  // 3. Staleness.
  if (VERSIONED_COMMANDS.includes(command.kind)) {
    const supplied = suppliedStateVersion(parsed.value);
    if (supplied !== ctx.stateVersion) {
      return reject(ctx, command, seq, {
        code: 'STALE_STATE',
        message: `${t('error.stale.message')} Current stateVersion is ${ctx.stateVersion}, call supplied ${supplied}.`,
        recovery: t('error.stale.recovery'),
      });
    }
  }

  // 4. Dispatch.
  const handled = dispatch(ctx, command, parsed.value, seq);
  if ('error' in handled) {
    return reject(ctx, command, seq, handled.error, handled.efficiencyPenalty);
  }

  // 5. Commit.
  const bumped = VERSION_BUMPING_COMMANDS.includes(command.kind) && handled.changedState;
  const stateVersion = bumped ? ctx.stateVersion + 1 : ctx.stateVersion;
  const clockSec = ctx.clockSec + COMMAND_CLOCK_COST[command.kind];

  const result: ToolResult & { seq: number } = {
    ok: true,
    stateVersion,
    data: handled.data,
    seq,
  };

  let next: GameContext = {
    ...ctx,
    ...handled.patch,
    seq,
    stateVersion,
    clockSec,
    // `get_incident` is a pure read and contributes nothing to a replay.
    commandLog:
      command.kind === 'get_incident'
        ? ctx.commandLog
        : appendCommand(ctx.commandLog, {
            kind: command.kind,
            input: parsed.value,
            origin: command.origin,
            atSec: ctx.clockSec,
          }),
    lastResult: result,
    toolLog: appendLog(ctx, {
      seq,
      atMs: (clockSec - ctx.caseOpenedAtSec) * 1000,
      tool: command.kind,
      origin: command.origin,
      ok: true,
      fromVersion,
      toVersion: stateVersion,
      effectId: handled.effectId,
      summary: handled.summary,
    }),
  };

  if (IDEMPOTENT_COMMANDS.includes(command.kind)) {
    const key = String((parsed.value as { idempotencyKey?: unknown }).idempotencyKey ?? '');
    next = {
      ...next,
      idempotency: storeIdempotent(ctx.idempotency, key, { result, seq }),
    };
  }

  return { context: next, result };
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

interface HandlerSuccess {
  data: unknown;
  patch: Partial<GameContext>;
  summary: string;
  effectId: string;
  /** False for pure re-reads, which must not bump `stateVersion`. */
  changedState: boolean;
}

interface HandlerFailure {
  error: ToolError;
  /** Applied to the efficiency bucket when the rejection reflects a bad decision. */
  efficiencyPenalty?: ScoreEntryTemplate;
}

type HandlerOutcome = HandlerSuccess | HandlerFailure;

function dispatch(
  ctx: GameContext,
  command: GameCommand,
  input: Record<string, unknown>,
  seq: number,
): HandlerOutcome {
  switch (command.kind) {
    case 'get_incident':
      return handleGetIncident(ctx);
    case 'inspect_artifact':
      return handleInspectArtifact(ctx, input.artifactId as ArtifactId, command.origin, seq);
    case 'run_diagnostic':
      return handleRunDiagnostic(ctx, input.diagnosticId as DiagnosticId, command.origin, seq);
    case 'take_response_action':
      return handleTakeResponseAction(ctx, input.actionId as ResponseActionId, command.origin, seq);
    case 'submit_decision':
      return handleSubmitDecision(
        ctx,
        input.decisionId as DecisionId,
        input.optionId as DecisionOptionId,
        seq,
      );
    case 'request_hint':
      return handleRequestHint(ctx, input.topic as HintTopic);
    case 'present_guidance':
      return handlePresentGuidance(ctx, input as unknown as PresentGuidanceInput);
  }
}

/**
 * Which field carries the state version this call was prepared against.
 *
 * `present_guidance` names it `basedOnStateVersion` because it is a claim about
 * the state the *line* describes, not a claim about the state the call intends
 * to change — narration changes nothing. It is still staleness-checked against
 * the same value, because guidance about a state the player has already left is
 * worse than silence. Anything added to `VERSIONED_COMMANDS` in future must
 * expose its version through one of these two names.
 */
function suppliedStateVersion(input: Record<string, unknown>): number {
  const raw = input.stateVersion ?? input.basedOnStateVersion;
  return Number(raw);
}

/* ------------------------------------------------------------------ *
 * get_incident
 * ------------------------------------------------------------------ */

export function buildIncidentView(ctx: GameContext): IncidentView {
  return {
    incidentId: INCIDENT_ID,
    caseId: CASE_ID,
    title: t('incident.title'),
    severity: 'critical',
    status: incidentStatus(ctx),
    elapsed: formatElapsed(elapsedSeconds(ctx)),
    knownFacts: knownFacts(ctx),
    openQuestions: openQuestions(ctx),
    unresolvedCriticalFindings: unresolvedCriticalFindings(ctx),
    allowedNextActions: allowedNextActions(ctx),
    openDecision: openDecisionView(ctx),
    blockedDecision: blockedDecisionView(ctx),
    availableArtifacts: availableArtifacts(ctx)
      .filter((a) => !ctx.inspectedArtifacts.includes(a.id))
      .map((a) => a.id),
    availableDiagnostics: availableDiagnostics(ctx).map((d) => d.id),
    requiredNextAction: requiredNextAction(ctx),
    coaching: buildCoachingSnapshot(ctx),
  };
}

function handleGetIncident(ctx: GameContext): HandlerOutcome {
  return {
    data: buildIncidentView(ctx),
    // Deliberately empty: `get_incident` is a pure read. If it wrote to context
    // it would re-render the dashboard and re-announce the live region on every
    // agent poll, which is both noisy and a lie about being read-only.
    patch: {},
    summary: 'Read the incident summary',
    effectId: 'overview-summary',
    changedState: false,
  };
}

/* ------------------------------------------------------------------ *
 * inspect_artifact
 * ------------------------------------------------------------------ */

function buildArtifactView(id: ArtifactId): ArtifactView | null {
  const artifact = ARTIFACT_BY_ID.get(id);
  if (!artifact) return null;
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    title: tk(artifact.titleKey),
    source: artifact.source,
    timestamp: artifact.timestamp,
    untrusted: artifact.untrusted,
    ...(artifact.untrusted ? { untrustedContentNotice: t('evidence.untrusted_notice') } : {}),
    fields: artifact.fields.map((f) => ({
      label: tk(f.labelKey),
      value: f.value,
      decisive: Boolean(f.decisive),
    })),
    analystNote: tk(artifact.explanationKey),
  };
}

/**
 * An agent call must be *visible*, so it pulls the human's view to the region it
 * changed. A human's own call must not: yanking someone off the panel they are
 * working in is hostile, and they can already see what they clicked.
 */
function routeFor<T>(origin: CallOrigin, route: T): { route?: T } {
  return origin === 'agent' ? { route } : {};
}

function handleInspectArtifact(
  ctx: GameContext,
  artifactId: ArtifactId,
  origin: CallOrigin,
  seq: number,
): HandlerOutcome {
  const artifact = ARTIFACT_BY_ID.get(artifactId);
  if (!artifact) {
    return {
      error: {
        code: 'NOT_FOUND',
        message: t('error.not_found.artifact'),
        recovery: t('error.not_found.artifact.recovery'),
      },
    };
  }

  const availability = artifactAvailability(ctx, artifactId);
  if (availability === 'destroyed') {
    return {
      error: {
        code: 'ACTION_NOT_ALLOWED',
        message: t('error.destroyed.artifact'),
        recovery: t('error.destroyed.artifact.recovery'),
      },
    };
  }
  if (availability === 'locked') {
    const diagnostic = artifact.revealedBy
      ? tk(DIAGNOSTIC_BY_ID.get(artifact.revealedBy)?.titleKey ?? artifact.revealedBy)
      : '';
    return {
      error: {
        code: 'ACTION_NOT_ALLOWED',
        message: t('error.locked.artifact'),
        recovery: t('error.locked.artifact.recovery', { diagnostic }),
      },
    };
  }

  const view = buildArtifactView(artifactId);
  const alreadyInspected = ctx.inspectedArtifacts.includes(artifactId);

  if (alreadyInspected) {
    // A re-read changes nothing, so it must not move `stateVersion`.
    return {
      data: view,
      patch: { selectedArtifact: artifactId, ...routeFor(origin, 'evidence' as const) },
      summary: `Re-read ${artifactId}`,
      effectId: `evidence-${artifactId}`,
      changedState: false,
    };
  }

  const scoreTemplate = SCORED_INSPECTIONS[artifactId];
  const scoreEntries = scoreTemplate
    ? [toEntry(scoreTemplate, `inspect:${artifactId}`, seq)]
    : [];

  return {
    data: view,
    patch: {
      inspectedArtifacts: [...ctx.inspectedArtifacts, artifactId],
      selectedArtifact: artifactId,
      ...routeFor(origin, 'evidence' as const),
      scoreEntries: [...ctx.scoreEntries, ...scoreEntries],
      assistantState: artifact.untrusted ? 'warning' : 'analyzing',
    },
    summary: `Inspected ${artifactId}`,
    effectId: `evidence-${artifactId}`,
    changedState: true,
  };
}

/* ------------------------------------------------------------------ *
 * run_diagnostic
 * ------------------------------------------------------------------ */

function handleRunDiagnostic(
  ctx: GameContext,
  diagnosticId: DiagnosticId,
  origin: CallOrigin,
  seq: number,
): HandlerOutcome {
  const diagnostic = DIAGNOSTIC_BY_ID.get(diagnosticId);
  if (!diagnostic) {
    return {
      error: { code: 'NOT_FOUND', message: `Unknown diagnostic: ${diagnosticId}` },
    };
  }
  if (ctx.ranDiagnostics.includes(diagnosticId)) {
    return {
      error: {
        code: 'ACTION_NOT_ALLOWED',
        message: t('error.diagnostic_done'),
        recovery: t('error.diagnostic_done.recovery'),
      },
    };
  }

  const revealed = diagnostic.revealsArtifacts ?? [];
  const resolved = diagnostic.resolvesFindings ?? [];

  const scoreEntries = diagnostic.scoreDelta.map((template) =>
    toEntry(template, `diagnostic:${diagnosticId}`, seq),
  );

  const patch: Partial<GameContext> = {
    ranDiagnostics: [...ctx.ranDiagnostics, diagnosticId],
    findings: resolveFindings(ctx, resolved, diagnosticId),
    scoreEntries: [...ctx.scoreEntries, ...scoreEntries],
    ...routeFor(origin, 'respond' as const),
    assistantState: 'analyzing',
  };

  // The diff is taken against the context this diagnostic produces, so a scope
  // sweep reports the identities and assets it actually surfaced rather than a
  // hard-coded promise that it would surface them.
  const after = { ...ctx, ...patch } as GameContext;

  const view: DiagnosticView = {
    diagnosticId,
    title: tk(diagnostic.titleKey),
    summary: tk(diagnostic.resultKey),
    // Live rows, read from the post-command state: what the systems say now,
    // not what the fixture said before anything was done to them.
    rows: diagnosticRows(after, diagnosticId),
    revealedArtifacts: revealed,
    resolvedFindings: resolved,
    effects: diffSources(sourceSnapshot(ctx), sourceSnapshot(after)),
  };

  return {
    data: view,
    patch: { ...patch, lastDiagnostic: view },
    summary: `Ran ${diagnosticId}`,
    effectId: `diagnostic-${diagnosticId}`,
    changedState: true,
  };
}

/* ------------------------------------------------------------------ *
 * take_response_action
 * ------------------------------------------------------------------ */

function handleTakeResponseAction(
  ctx: GameContext,
  actionId: ResponseActionId,
  origin: GameCommand['origin'],
  seq: number,
): HandlerOutcome {
  const action = RESPONSE_ACTION_BY_ID.get(actionId);
  if (!action) {
    return { error: { code: 'NOT_FOUND', message: `Unknown action: ${actionId}` } };
  }

  const availability = actionAvailability(ctx, actionId);
  if (!availability.allowed) {
    return {
      error: {
        code: 'ACTION_NOT_ALLOWED',
        message: availability.reasonKey ? t(availability.reasonKey) : t('error.action_not_allowed'),
        recovery: availability.recoveryKey ? t(availability.recoveryKey) : undefined,
      },
      // Repeating or mis-ordering a consequential action is a decision-quality
      // problem, so it costs efficiency. Protocol errors (stale, invalid) do not.
      efficiencyPenalty: { bucket: 'efficiency', delta: -2, reasonKey: 'score.rejected_call' },
    };
  }

  const scoreEntries: ScoreEntry[] = action.scoreDelta.map((template) =>
    toEntry(template, `action:${actionId}`, seq),
  );
  const flags: Partial<Record<FlagId, boolean>> = {};

  for (const penalty of action.conditionalPenalties ?? []) {
    const missing =
      (penalty.whenMissing.diagnostic &&
        !ctx.ranDiagnostics.includes(penalty.whenMissing.diagnostic)) ||
      (penalty.whenMissing.artifact &&
        !ctx.inspectedArtifacts.includes(penalty.whenMissing.artifact));
    if (missing) {
      scoreEntries.push(toEntry(penalty.entry, `action:${actionId}:penalty`, seq));
      for (const flag of penalty.setsFlags ?? []) flags[flag] = true;
    }
  }

  const resolved = action.resolvesFindings ?? [];
  const findings = resolveFindings(ctx, resolved, actionId);

  const performedActions = [
    ...ctx.performedActions,
    { actionId, seq, at: incidentClock(ctx), origin },
  ];

  const patch: Partial<GameContext> = {
    performedActions,
    findings,
    flags: { ...ctx.flags, ...flags },
    ...routeFor(origin, 'command' as const),
    assistantState: 'success',
  };

  const view: ResponseActionView = {
    actionId,
    applied: true,
    result: tk(action.resultKey),
    impact: tk(action.impactKey),
    resolvedFindings: resolved,
    unresolvedCriticalFindings: [],
    // Filled in below, once the patch is complete: `close_case` writes
    // `caseClosed` and `ending`, and both are source facts.
    effects: [],
    stillOpen: [],
  };

  if (actionId === 'close_case') {
    const probe: GameContext = { ...ctx, ...patch, findings } as GameContext;
    const stillOpen = unresolvedCriticalFindings(probe);
    const ending: Ending = stillOpen.length === 0 ? 'contained' : 'partial';

    if (stillOpen.length > 0) {
      scoreEntries.push(
        toEntry(
          { bucket: 'efficiency', delta: -5, reasonKey: 'score.closed_with_open_findings' },
          'action:close_case',
          seq,
        ),
      );
    }

    patch.caseClosed = true;
    patch.ending = ending;
    patch.assistantState = ending === 'contained' ? 'success' : 'warning';
    view.unresolvedCriticalFindings = stillOpen;
    view.ending = ending;
    view.score = compactScore(computeScore([...ctx.scoreEntries, ...scoreEntries]));
  } else {
    const probe: GameContext = { ...ctx, ...patch, findings } as GameContext;
    view.unresolvedCriticalFindings = unresolvedCriticalFindings(probe);
  }

  patch.scoreEntries = [...ctx.scoreEntries, ...scoreEntries];

  /*
   * Redesign §6: "Codex must receive the exact structured before/after result
   * so it can explain what changed, what remains open and why the next step
   * follows."
   *
   * Both halves are computed here, from the context this operation produces,
   * and neither is written by hand. `effects` is a diff, so the result cannot
   * claim a change the simulation did not make; `stillOpen` reads the same
   * snapshot, so it cannot omit a gap the operation left behind. Together they
   * are what stops `reset_credentials` from being mistaken for a revocation.
   */
  const after = { ...ctx, ...patch } as GameContext;
  view.effects = diffSources(sourceSnapshot(ctx), sourceSnapshot(after));
  view.stillOpen = stillOpen(after, touchedSources(view.effects));

  return {
    data: view,
    patch,
    summary: `Applied ${actionId}`,
    effectId: `action-${actionId}`,
    changedState: true,
  };
}

/* ------------------------------------------------------------------ *
 * submit_decision
 * ------------------------------------------------------------------ */

function handleSubmitDecision(
  ctx: GameContext,
  decisionId: DecisionId,
  optionId: DecisionOptionId,
  seq: number,
): HandlerOutcome {
  const decision = DECISION_BY_ID.get(decisionId);
  if (!decision) {
    return { error: { code: 'NOT_FOUND', message: `Unknown decision: ${decisionId}` } };
  }

  const option = decision.options.find((o) => o.id === optionId);
  if (!option) {
    return {
      error: {
        code: 'INVALID_INPUT',
        message: t('error.option_mismatch'),
        recovery: t('error.option_mismatch.recovery'),
      },
    };
  }

  if (ctx.decisions[decisionId]) {
    return {
      error: {
        code: 'ACTION_NOT_ALLOWED',
        message: t('error.decision_already'),
        recovery: t('error.decision_already.recovery'),
      },
    };
  }

  if (!isDecisionUnlocked(ctx, decisionId)) {
    return {
      error: {
        code: 'ACTION_NOT_ALLOWED',
        message: t('error.decision_locked'),
        recovery: t('error.decision_locked.recovery'),
      },
    };
  }

  const scoreEntries = option.scoreDelta.map((template) =>
    toEntry(template, `decision:${optionId}`, seq),
  );

  const flags: Partial<Record<FlagId, boolean>> = { ...ctx.flags };
  for (const flag of option.setsFlags ?? []) flags[flag] = true;

  let destroyedArtifacts = ctx.destroyedArtifacts;
  let disabledIdentities = ctx.disabledIdentities;
  let unlockedActions = ctx.unlockedActions;
  const effectDescriptions: string[] = [];

  for (const effect of option.stateEffects ?? []) {
    switch (effect.kind) {
      case 'destroy_artifact':
        if (!destroyedArtifacts.includes(effect.artifactId)) {
          destroyedArtifacts = [...destroyedArtifacts, effect.artifactId];
        }
        effectDescriptions.push(`${t('evidence.destroyed')}: ${effect.artifactId}`);
        break;
      case 'disable_identity':
        if (!disabledIdentities.includes(effect.identityId)) {
          disabledIdentities = [...disabledIdentities, effect.identityId];
        }
        effectDescriptions.push(`${t('identities.status.disabled')}: ${effect.identityId}`);
        break;
      case 'unlock_action':
        if (!unlockedActions.includes(effect.actionId)) {
          unlockedActions = [...unlockedActions, effect.actionId];
        }
        effectDescriptions.push(
          `${t('playbook.actions')}: ${tk(RESPONSE_ACTION_BY_ID.get(effect.actionId)?.labelKey ?? effect.actionId)}`,
        );
        break;
      case 'reveal_artifact':
        effectDescriptions.push(`${t('evidence.list')}: ${effect.artifactId}`);
        break;
    }
  }

  const record = {
    decisionId,
    optionId,
    correct: option.correct,
    seq,
    at: incidentClock(ctx),
  };

  const nextContext: GameContext = {
    ...ctx,
    decisions: { ...ctx.decisions, [decisionId]: record },
    destroyedArtifacts,
    disabledIdentities,
    unlockedActions,
  };

  const view: DecisionResultView = {
    decisionId,
    optionId,
    correct: option.correct,
    explanation: tk(option.explanationKey),
    learningGoal: tk(decision.learningGoalKey),
    scoreDelta: option.scoreDelta.map((d) => ({
      bucket: d.bucket,
      delta: d.delta,
      reason: tk(d.reasonKey),
    })),
    flagsSet: option.setsFlags ?? [],
    stateEffects: effectDescriptions,
    nextDecision: openDecisionView(nextContext),
    recommendedActions: option.recommends ?? [],
  };

  return {
    data: view,
    patch: {
      decisions: nextContext.decisions,
      destroyedArtifacts,
      disabledIdentities,
      unlockedActions,
      flags,
      scoreEntries: [...ctx.scoreEntries, ...scoreEntries],
      lastDecision: view,
      assistantState: option.correct ? 'success' : 'warning',
    },
    summary: `Decided ${decisionId} → ${optionId}`,
    effectId: `decision-${decisionId}`,
    changedState: true,
  };
}

/* ------------------------------------------------------------------ *
 * request_hint
 * ------------------------------------------------------------------ */

function handleRequestHint(ctx: GameContext, topic: HintTopic): HandlerOutcome {
  const candidates = HINTS.filter((h) => h.topic === topic);
  const match =
    candidates.find((hint) => {
      const p = hint.predicate;
      if (p.fallback) return true;
      if (p.artifactsMissing?.some((id) => !ctx.inspectedArtifacts.includes(id))) return true;
      if (p.diagnosticsMissing?.some((id) => !ctx.ranDiagnostics.includes(id))) return true;
      if (p.actionsMissing?.some((id) => !hasPerformed(ctx, id))) return true;
      if (p.decisionsUnresolved?.some((id) => !ctx.decisions[id])) return true;
      if (p.flagsSet?.some((flag) => ctx.flags[flag])) return true;
      return false;
    }) ?? candidates[candidates.length - 1];

  const view: HintView = {
    topic,
    hint: match ? tk(match.textKey) : t('rail.hint.no_penalty'),
    affectsScore: false,
  };

  return {
    data: view,
    // Hints never touch the score. docs/GAME_FLOW.md: "Do not punish the player
    // for requesting explanations or accessibility features."
    patch: { hintsRequested: ctx.hintsRequested + 1, lastHint: view, assistantState: 'needs-input' },
    summary: `Hint requested: ${topic}`,
    effectId: 'rail-hint',
    changedState: false,
  };
}

/* ------------------------------------------------------------------ *
 * present_guidance — the one command a language model authors
 * ------------------------------------------------------------------ */

/**
 * Records one narrated line. It cannot move the game, and that is the whole
 * design.
 *
 * Four separate mechanisms hold the boundary, because one would be a comment
 * rather than a guarantee:
 *
 *   1. `present_guidance` is absent from `VERSION_BUMPING_COMMANDS`, so the
 *      commit step cannot raise `stateVersion` however this handler behaves;
 *   2. the patch it returns touches `narrativeSequence` and `narrativeLog` and
 *      nothing else — no score entry, no finding, no decision, no flag, no
 *      route, no assistant state;
 *   3. its clock cost is zero, so it cannot spend the incident clock;
 *   4. every rejection path returns `{ error }` with no `efficiencyPenalty`,
 *      so a malformed or hostile line cannot cost the player a point either.
 *      A bad narration attempt is a protocol error like INVALID_INPUT, not a
 *      decision-quality error like repeating a containment action.
 *
 * `guidance.test.ts` runs the golden path with narration interleaved and
 * requires a byte-identical replay signature and score, which is what turns all
 * four from intentions into a test that fails when one is removed.
 */
/**
 * Narrows a proposal from the wire shape into the stored one.
 *
 * The schema has already checked that every id it names exists. What it cannot
 * check is a *case* rule — that the option belongs to the decision — so that is
 * checked here, where the refusal can say which decision the option actually
 * belongs to instead of "input did not match the tool schema".
 *
 * A proposal is still not an action. Nothing here applies anything; the console
 * shows the proposed move under the fixture's own label with an Approve
 * control, and approving it issues an ordinary command as the player.
 */
function narrowProposal(
  input: PresentGuidanceInput,
): { ok: true; proposal?: GuidanceProposal } | { ok: false; error: ToolError } {
  const proposes = input.proposes;
  if (!proposes) return { ok: true };

  if (proposes.kind === 'take_response_action') {
    if (!proposes.actionId) {
      return {
        ok: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'A take_response_action proposal needs actionId.',
          recovery: 'Re-send with proposes.actionId set to the action you want authorised.',
        },
      };
    }
    return {
      ok: true,
      proposal: {
        kind: 'take_response_action',
        actionId: proposes.actionId as ResponseActionId,
      },
    };
  }

  const decision = proposes.decisionId ? DECISION_BY_ID.get(proposes.decisionId as DecisionId) : undefined;
  const option = decision?.options.find((candidate) => candidate.id === proposes.optionId);
  if (!decision || !option) {
    return {
      ok: false,
      error: {
        code: 'INVALID_INPUT',
        message: 'A submit_decision proposal needs a decisionId and one of that decision\u2019s own optionIds.',
        recovery: 'Read get_incident.openDecision and propose one of the options it lists.',
      },
    };
  }

  return {
    ok: true,
    proposal: {
      kind: 'submit_decision',
      decisionId: decision.id,
      optionId: option.id,
    },
  };
}

function handlePresentGuidance(
  ctx: GameContext,
  input: PresentGuidanceInput,
): HandlerOutcome {
  const sanitised = sanitiseGuidanceMessage(input.message);
  if (!sanitised.ok) {
    // No efficiency penalty: see (4) above.
    return { error: sanitised.error };
  }

  const proposal = narrowProposal(input);
  if (!proposal.ok) return { error: proposal.error };

  const entry: NarrativeEntry = {
    narrativeSequence: narrativeSequenceOf(ctx) + 1,
    tone: input.tone,
    language: input.language,
    message: sanitised.message,
    ...(input.relatedArtifactId ? { relatedArtifactId: input.relatedArtifactId } : {}),
    ...(input.relatedDecisionId ? { relatedDecisionId: input.relatedDecisionId } : {}),
    ...(proposal.proposal ? { proposes: proposal.proposal } : {}),
    basedOnStateVersion: input.basedOnStateVersion,
    at: incidentClock(ctx),
  };

  const view: GuidanceView = {
    ...entry,
    accepted: true,
    stateVersion: ctx.stateVersion,
    affectsScore: false,
    affectsState: false,
  };

  return {
    data: view,
    patch: {
      narrativeSequence: entry.narrativeSequence,
      narrativeLog: appendNarrative(ctx, entry),
    },
    summary: `Narrated line ${entry.narrativeSequence} (${entry.tone})`,
    // The dialogue area is where a narrated line becomes visible. Owned by the
    // office/dashboard work, so this names the region rather than driving it.
    effectId: 'rail-narration',
    // False by construction: `present_guidance` is not in
    // VERSION_BUMPING_COMMANDS, so this value cannot bump anything. Stated
    // explicitly so the intent survives a future refactor of that list.
    changedState: false,
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function toEntry(template: ScoreEntryTemplate, source: string, seq: number): ScoreEntry {
  return { ...template, source, seq };
}

function resolveFindings(
  ctx: GameContext,
  ids: readonly FindingId[],
  resolvedBy: ResponseActionId | DiagnosticId,
): GameContext['findings'] {
  if (ids.length === 0) return ctx.findings;
  return ctx.findings.map((record) =>
    ids.includes(record.id) && !record.resolved
      ? { ...record, resolved: true, resolvedBy }
      : record,
  );
}

function storeIdempotent(
  ledger: GameContext['idempotency'],
  key: string,
  value: GameContext['idempotency'][string],
): GameContext['idempotency'] {
  const next = { ...ledger, [key]: value };
  const keys = Object.keys(next);
  if (keys.length <= MAX_IDEMPOTENCY_ENTRIES) return next;
  // Drop the oldest entries by stored sequence number.
  const sorted = keys.sort((a, b) => (next[a]?.seq ?? 0) - (next[b]?.seq ?? 0));
  for (const stale of sorted.slice(0, keys.length - MAX_IDEMPOTENCY_ENTRIES)) {
    delete next[stale];
  }
  return next;
}

const MAX_COMMAND_LOG = 500;

function appendCommand(
  log: GameContext['commandLog'],
  entry: GameContext['commandLog'][number],
): GameContext['commandLog'] {
  const next = [...log, entry];
  return next.length > MAX_COMMAND_LOG ? next.slice(next.length - MAX_COMMAND_LOG) : next;
}

function appendLog(ctx: GameContext, entry: ToolLogEntry): ToolLogEntry[] {
  const next = [...ctx.toolLog, entry];
  return next.length > MAX_TOOL_LOG_ENTRIES ? next.slice(next.length - MAX_TOOL_LOG_ENTRIES) : next;
}

/**
 * The control a refused call was aimed at.
 *
 * A rejection has a visible region exactly as an accepted call does — the
 * button that would not run — and the console needs it to put the refusal, what
 * did not change and the one recovery beside the control the player pressed
 * rather than in a corner of the page. Read defensively from the raw input,
 * because a rejection can be a schema failure whose input is any shape at all.
 */
function rejectedEffectId(command: GameCommand): string | undefined {
  const input = (command.input ?? {}) as Record<string, unknown>;
  const id = (key: string): string | undefined =>
    typeof input[key] === 'string' ? (input[key] as string) : undefined;

  switch (command.kind) {
    case 'inspect_artifact': {
      const artifactId = id('artifactId');
      return artifactId && `evidence-${artifactId}`;
    }
    case 'run_diagnostic': {
      const diagnosticId = id('diagnosticId');
      return diagnosticId && `diagnostic-${diagnosticId}`;
    }
    case 'take_response_action': {
      const actionId = id('actionId');
      return actionId && `action-${actionId}`;
    }
    case 'submit_decision': {
      const decisionId = id('decisionId');
      return decisionId && `decision-${decisionId}`;
    }
    default:
      return undefined;
  }
}

function reject(
  ctx: GameContext,
  command: GameCommand,
  seq: number,
  error: ToolError,
  efficiencyPenalty?: ScoreEntryTemplate,
): EngineOutcome {
  const scoreEntries = efficiencyPenalty
    ? [...ctx.scoreEntries, toEntry(efficiencyPenalty, `rejected:${command.kind}`, seq)]
    : ctx.scoreEntries;

  const result: ToolResult & { seq: number } = {
    ok: false,
    stateVersion: ctx.stateVersion,
    error,
    seq,
  };

  return {
    context: {
      ...ctx,
      seq,
      scoreEntries,
      assistantState: 'error',
      lastResult: result,
      toolLog: appendLog(ctx, {
        seq,
        atMs: (ctx.clockSec - ctx.caseOpenedAtSec) * 1000,
        tool: command.kind,
        origin: command.origin,
        ok: false,
        errorCode: error.code,
        fromVersion: ctx.stateVersion,
        toVersion: ctx.stateVersion,
        effectId: rejectedEffectId(command),
        summary: `${command.kind} rejected: ${error.code}`,
      }),
    },
    result,
  };
}

/** Human-readable error headline, used by the dashboard toast and the rail. */
export function describeErrorCode(code: ToolErrorCode): string {
  return t(`error.${code}` as StringKey);
}

export { formatClock };
