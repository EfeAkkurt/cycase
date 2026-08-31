import { t, tk } from '../i18n';
import type { StringKey } from '../i18n';
import {
  ARTIFACTS,
  ARTIFACT_BY_ID,
  ASSETS,
  BASE_KNOWN_FACT_KEYS,
  CONDITIONAL_FACTS,
  DECISIONS,
  DECISION_BY_ID,
  DIAGNOSTICS,
  DIAGNOSTIC_BY_ID,
  FINDINGS,
  IDENTITIES,
  INCIDENT_START_SEC,
  OPEN_QUESTIONS,
  RESPONSE_ACTIONS,
  RESPONSE_ACTION_BY_ID,
  TIMELINE,
} from './fixtures/case001';
import type {
  AllowedNextAction,
  Artifact,
  ArtifactId,
  Asset,
  AssetId,
  BlockedDecisionView,
  DecisionId,
  Diagnostic,
  DiagnosticId,
  Finding,
  FindingId,
  GameContext,
  Identity,
  OpenDecisionView,
  ResponseActionId,
  TimelineEvent,
} from './types';

/* ------------------------------------------------------------------ *
 * Clock
 * ------------------------------------------------------------------ */

export function formatClock(totalSeconds: number): string {
  const s = ((totalSeconds % 86400) + 86400) % 86400;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

export function elapsedSeconds(ctx: GameContext): number {
  return Math.max(0, ctx.clockSec - ctx.caseOpenedAtSec);
}

export function incidentClock(ctx: GameContext): string {
  return formatClock(ctx.clockSec);
}

export { INCIDENT_START_SEC };

/* ------------------------------------------------------------------ *
 * Evidence availability
 * ------------------------------------------------------------------ */

export type ArtifactAvailability = 'available' | 'locked' | 'destroyed';

export function artifactAvailability(ctx: GameContext, id: ArtifactId): ArtifactAvailability {
  if (ctx.destroyedArtifacts.includes(id)) return 'destroyed';
  const artifact = ARTIFACT_BY_ID.get(id);
  if (!artifact) return 'locked';
  if (artifact.revealedBy && !ctx.ranDiagnostics.includes(artifact.revealedBy)) return 'locked';
  return 'available';
}

/** Artifacts the analyst (and the agent) may inspect right now. */
export function availableArtifacts(ctx: GameContext): Artifact[] {
  return ARTIFACTS.filter((a) => artifactAvailability(ctx, a.id) === 'available');
}

/** Every artifact plus its live availability, for the evidence list UI. */
export function artifactsWithState(
  ctx: GameContext,
): { artifact: Artifact; availability: ArtifactAvailability; inspected: boolean }[] {
  return ARTIFACTS.map((artifact) => ({
    artifact,
    availability: artifactAvailability(ctx, artifact.id),
    inspected: ctx.inspectedArtifacts.includes(artifact.id),
  }));
}

export function inspectedCount(ctx: GameContext): { done: number; total: number } {
  const total = ARTIFACTS.length;
  const done = ctx.inspectedArtifacts.length;
  return { done, total };
}

/* ------------------------------------------------------------------ *
 * Diagnostics and actions
 * ------------------------------------------------------------------ */

export function availableDiagnostics(ctx: GameContext): Diagnostic[] {
  return DIAGNOSTICS.filter((d) => !ctx.ranDiagnostics.includes(d.id));
}

export function hasPerformed(ctx: GameContext, actionId: ResponseActionId): boolean {
  return ctx.performedActions.some((a) => a.actionId === actionId);
}

/**
 * Whether a response action may be executed right now.
 *
 * Only two things are ever hard-blocked: repeating an applied action, and
 * closing the case before the closing decision exists. Everything else stays
 * available so that a player — or an agent — can choose a worse path and learn
 * from the consequence, which is the point of the case.
 */
export function actionAvailability(
  ctx: GameContext,
  actionId: ResponseActionId,
): { allowed: boolean; reasonKey?: StringKey; recoveryKey?: StringKey } {
  if (ctx.caseClosed) {
    return {
      allowed: false,
      reasonKey: 'error.already_closed',
      recoveryKey: 'error.already_closed.recovery',
    };
  }
  if (hasPerformed(ctx, actionId)) {
    return {
      allowed: false,
      reasonKey: 'error.already_performed',
      recoveryKey: 'error.already_performed.recovery',
    };
  }
  if (actionId === 'close_case' && !ctx.unlockedActions.includes('close_case')) {
    return {
      allowed: false,
      reasonKey: 'error.close_needs_decision',
      recoveryKey: 'error.close_needs_decision.recovery',
    };
  }
  return { allowed: true };
}

export function allowedResponseActions(ctx: GameContext): ResponseActionId[] {
  return RESPONSE_ACTIONS.filter((a) => actionAvailability(ctx, a.id).allowed).map((a) => a.id);
}

/** Actions the last decision explicitly recommended and that are still pending. */
export function recommendedActions(ctx: GameContext): ResponseActionId[] {
  const recommended = new Set<ResponseActionId>();
  for (const decisionId of Object.keys(ctx.decisions) as DecisionId[]) {
    const record = ctx.decisions[decisionId];
    if (!record) continue;
    const decision = DECISION_BY_ID.get(decisionId);
    const option = decision?.options.find((o) => o.id === record.optionId);
    for (const actionId of option?.recommends ?? []) {
      if (actionAvailability(ctx, actionId).allowed) recommended.add(actionId);
    }
  }
  return [...recommended];
}

/* ------------------------------------------------------------------ *
 * Decisions
 * ------------------------------------------------------------------ */

export function isDecisionUnlocked(ctx: GameContext, decisionId: DecisionId): boolean {
  const decision = DECISION_BY_ID.get(decisionId);
  if (!decision) return false;
  const { decisionsResolved = [], artifactsInspected = [], diagnosticsRun = [] } =
    decision.prerequisite;
  return (
    decisionsResolved.every((id) => Boolean(ctx.decisions[id])) &&
    artifactsInspected.every((id) => ctx.inspectedArtifacts.includes(id)) &&
    diagnosticsRun.every((id) => ctx.ranDiagnostics.includes(id))
  );
}

/** The single decision the player is expected to answer next, if any. */
export function openDecisionId(ctx: GameContext): DecisionId | null {
  for (const decision of DECISIONS) {
    if (ctx.decisions[decision.id]) continue;
    if (isDecisionUnlocked(ctx, decision.id)) return decision.id;
    return null; // decisions are strictly ordered; a locked one blocks the rest
  }
  return null;
}

export function openDecisionView(ctx: GameContext): OpenDecisionView | null {
  const id = openDecisionId(ctx);
  if (!id) return null;
  const decision = DECISION_BY_ID.get(id);
  if (!decision) return null;
  return {
    decisionId: decision.id,
    prompt: tk(decision.promptKey),
    options: decision.options.map((o) => ({ optionId: o.id, label: tk(o.labelKey) })),
  };
}

/**
 * The next unresolved decision when it exists but is *not* yet answerable,
 * together with the exact prerequisites still missing.
 *
 * A human sees a greyed-out decision card with a tooltip. Without this an agent
 * would only see `openDecision: null` and could not tell a blocked case from a
 * finished one.
 */
export function blockedDecisionView(ctx: GameContext): BlockedDecisionView | null {
  const next = DECISIONS.find((d) => !ctx.decisions[d.id]);
  if (!next) return null;
  if (isDecisionUnlocked(ctx, next.id)) return null;

  const {
    decisionsResolved = [],
    artifactsInspected = [],
    diagnosticsRun = [],
  } = next.prerequisite;

  return {
    decisionId: next.id,
    prompt: tk(next.promptKey),
    missing: {
      decisions: decisionsResolved.filter((id) => !ctx.decisions[id]),
      artifacts: artifactsInspected.filter((id) => !ctx.inspectedArtifacts.includes(id)),
      diagnostics: diagnosticsRun.filter((id) => !ctx.ranDiagnostics.includes(id)),
    },
  };
}

export function decisionProgress(ctx: GameContext): { resolved: number; total: number } {
  return {
    resolved: Object.keys(ctx.decisions).length,
    total: DECISIONS.length,
  };
}

/* ------------------------------------------------------------------ *
 * Findings
 * ------------------------------------------------------------------ */

export function findingById(id: FindingId): Finding | undefined {
  return FINDINGS.find((f) => f.id === id);
}

export function unresolvedCriticalFindings(ctx: GameContext): FindingId[] {
  return ctx.findings
    .filter((record) => !record.resolved && findingById(record.id)?.critical)
    .map((record) => record.id);
}

export function isFullyContained(ctx: GameContext): boolean {
  return unresolvedCriticalFindings(ctx).length === 0;
}

/* ------------------------------------------------------------------ *
 * Identities and assets
 * ------------------------------------------------------------------ */

export function visibleIdentities(ctx: GameContext): Identity[] {
  return IDENTITIES.filter((i) => !i.revealedBy || ctx.ranDiagnostics.includes(i.revealedBy));
}

export function hiddenIdentityCount(ctx: GameContext): number {
  return IDENTITIES.length - visibleIdentities(ctx).length;
}

export type IdentityStatus =
  | 'active'
  | 'disabled'
  | 'credentials_reset'
  | 'sessions_revoked';

export function identityStatuses(ctx: GameContext, id: Identity['id']): IdentityStatus[] {
  const statuses: IdentityStatus[] = [];
  if (ctx.disabledIdentities.includes(id)) statuses.push('disabled');
  if (id === 'usr_dilara') {
    if (hasPerformed(ctx, 'revoke_sessions')) statuses.push('sessions_revoked');
    if (hasPerformed(ctx, 'reset_credentials')) statuses.push('credentials_reset');
  }
  if (statuses.length === 0) statuses.push('active');
  return statuses;
}

export function visibleAssets(ctx: GameContext): Asset[] {
  return ASSETS.filter((a) => !a.revealedBy || ctx.ranDiagnostics.includes(a.revealedBy));
}

export type AssetStatus = Asset['baseStatus'] | 'isolated';

export function assetStatus(ctx: GameContext, id: AssetId): AssetStatus {
  if (id === 'WKS-114' && hasPerformed(ctx, 'isolate_endpoint')) return 'isolated';
  return ASSETS.find((a) => a.id === id)?.baseStatus ?? 'healthy';
}

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */

export function visibleTimeline(ctx: GameContext): TimelineEvent[] {
  return TIMELINE.filter((event) => {
    if (!event.requires) return true;
    const { artifact, diagnostic } = event.requires;
    if (artifact && !ctx.inspectedArtifacts.includes(artifact)) return false;
    if (diagnostic && !ctx.ranDiagnostics.includes(diagnostic)) return false;
    return true;
  });
}

export function hiddenTimelineCount(ctx: GameContext): number {
  return TIMELINE.length - visibleTimeline(ctx).length;
}

/* ------------------------------------------------------------------ *
 * Narrative derivations
 * ------------------------------------------------------------------ */

function requirementMet(
  ctx: GameContext,
  requires: { artifact?: string; diagnostic?: string; action?: string },
): boolean {
  if (requires.artifact && !ctx.inspectedArtifacts.includes(requires.artifact as ArtifactId)) {
    return false;
  }
  if (requires.diagnostic && !ctx.ranDiagnostics.includes(requires.diagnostic as DiagnosticId)) {
    return false;
  }
  if (requires.action && !hasPerformed(ctx, requires.action as ResponseActionId)) {
    return false;
  }
  return true;
}

export function knownFacts(ctx: GameContext): string[] {
  const facts = BASE_KNOWN_FACT_KEYS.map((key) => tk(key));
  for (const fact of CONDITIONAL_FACTS) {
    if (requirementMet(ctx, fact.requires)) facts.push(tk(fact.key));
  }
  return facts;
}

export function openQuestions(ctx: GameContext): string[] {
  return OPEN_QUESTIONS.filter((q) => !requirementMet(ctx, q.answeredBy)).map((q) => tk(q.key));
}

/** Deterministic hypothesis ladder. Never authored by a model. */
export function currentHypothesis(ctx: GameContext): string {
  if (ctx.inspectedArtifacts.includes('art_edr_001') && ctx.ranDiagnostics.includes('auth_timeline')) {
    return t('overview.hypothesis.confirmed');
  }
  if (ctx.inspectedArtifacts.includes('art_cookie_001') || ctx.ranDiagnostics.includes('auth_timeline')) {
    return t('overview.hypothesis.token_replay');
  }
  if (ctx.inspectedArtifacts.includes('art_email_001')) {
    return t('overview.hypothesis.phishing');
  }
  return t('overview.hypothesis.initial');
}

export function incidentStatus(ctx: GameContext): 'active' | 'contained' | 'closed' {
  if (ctx.caseClosed) return 'closed';
  if (isFullyContained(ctx)) return 'contained';
  return 'active';
}

/* ------------------------------------------------------------------ *
 * Allowed-next-action list returned to the agent
 * ------------------------------------------------------------------ */

/** Tool results are budgeted; long prose belongs in the dashboard, not the wire. */
const MAX_LABEL = 64;
const MAX_RATIONALE = 64;

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}\u2026`;
}

export function allowedNextActions(ctx: GameContext): AllowedNextAction[] {
  const list: AllowedNextAction[] = [];

  const decision = openDecisionView(ctx);
  if (decision) {
    list.push({
      kind: 'submit_decision',
      id: decision.decisionId,
      label: decision.prompt,
      rationale: t('decision.title'),
    });
  }

  // Steps that unblock the next decision are called out by name, so an agent
  // never has to guess which of several available reads is the load-bearing one.
  const blocked = blockedDecisionView(ctx);
  const unblockingArtifacts = new Set(blocked?.missing.artifacts ?? []);
  const unblockingDiagnostics = new Set(blocked?.missing.diagnostics ?? []);

  for (const artifact of availableArtifacts(ctx)) {
    if (ctx.inspectedArtifacts.includes(artifact.id)) continue;
    list.push({
      kind: 'inspect_artifact',
      id: artifact.id,
      label: tk(artifact.titleKey),
      rationale: unblockingArtifacts.has(artifact.id)
        ? `Required before decision ${blocked?.decisionId} opens.`
        : artifact.untrusted
          ? t('evidence.untrusted_badge')
          : t('evidence.inspect'),
    });
  }

  for (const diagnostic of availableDiagnostics(ctx)) {
    list.push({
      kind: 'run_diagnostic',
      id: diagnostic.id,
      label: tk(diagnostic.titleKey),
      rationale: unblockingDiagnostics.has(diagnostic.id)
        ? `Required before decision ${blocked?.decisionId} opens.`
        : tk(diagnostic.descriptionKey),
    });
  }

  const recommended = new Set(recommendedActions(ctx));
  for (const actionId of allowedResponseActions(ctx)) {
    const action = RESPONSE_ACTION_BY_ID.get(actionId);
    if (!action) continue;
    list.push({
      kind: 'take_response_action',
      id: actionId,
      label: tk(action.labelKey),
      rationale: recommended.has(actionId) ? t('playbook.recommended') : tk(action.impactKey),
    });
  }

  return list.map((action) => ({
    ...action,
    label: clip(action.label, MAX_LABEL),
    rationale: clip(action.rationale, MAX_RATIONALE),
  }));
}

/* ------------------------------------------------------------------ *
 * The guided path (audit contract P0.6)
 * ------------------------------------------------------------------ *
 *
 * The audit measured a user-like run reaching only D3 after 8:42, with
 * "Available actions" offering up to five choices that mixed the one required
 * next action with optional evidence. The fix is not a new game: it is a
 * curated ordering of the *existing* commands, so that a novice is asked for
 * one decision at a time and each remaining click covers a whole SOC operation
 * rather than a single atomic call.
 *
 * Two invariants make this safe:
 *
 * 1. Nothing here executes anything. A guided step is a list of commands the
 *    UI issues through the same `submitDecision()` / `runDiagnostic()` /
 *    `inspectArtifact()` / `takeResponseAction()` runtime functions a WebMCP
 *    tool call goes through. The tool surface, the engine and the fixture are
 *    untouched, so the agent path and the human path stay equivalent.
 * 2. Completion is read from case state, never from a cursor. A player (or an
 *    agent) who does part of a step from the Playbook route, out of order, or
 *    through a tool simply finds that step already satisfied. There is no way
 *    to desynchronise the guide from the case.
 *
 * The plan is ordered so that every conditional penalty in the fixture is
 * avoided by construction: `session_inventory` precedes `revoke_sessions`, and
 * `art_edr_001` precedes `isolate_endpoint`. Following it end to end reaches
 * the contained ending with the full 100 points in eleven interactions.
 */

export type GuidedCommand =
  | { kind: 'inspect_artifact'; artifactId: ArtifactId }
  | { kind: 'run_diagnostic'; diagnosticId: DiagnosticId }
  | { kind: 'take_response_action'; actionId: ResponseActionId };

export interface GuidedDecisionStep {
  id: string;
  kind: 'decision';
  decisionId: DecisionId;
  /** Short imperative headline; the prompt itself carries the detail. */
  titleKey: StringKey;
  whyKey: StringKey;
}

export interface GuidedOperationStep {
  id: string;
  kind: 'operation';
  titleKey: StringKey;
  whyKey: StringKey;
  /** Verb-first label for the single button that runs the whole operation. */
  ctaKey: StringKey;
  commands: GuidedCommand[];
}

export type GuidedPlanStep = GuidedDecisionStep | GuidedOperationStep;

export const GUIDED_PLAN: readonly GuidedPlanStep[] = [
  {
    id: 'd1',
    kind: 'decision',
    decisionId: 'D1',
    titleKey: 'guide.d1.title',
    whyKey: 'guide.d1.why',
  },
  {
    id: 'read_report',
    kind: 'operation',
    titleKey: 'guide.read_report.title',
    whyKey: 'guide.read_report.why',
    ctaKey: 'guide.read_report.cta',
    commands: [{ kind: 'inspect_artifact', artifactId: 'art_email_001' }],
  },
  {
    id: 'd2',
    kind: 'decision',
    decisionId: 'D2',
    titleKey: 'guide.d2.title',
    whyKey: 'guide.d2.why',
  },
  {
    id: 'rebuild_timeline',
    kind: 'operation',
    titleKey: 'guide.rebuild_timeline.title',
    whyKey: 'guide.rebuild_timeline.why',
    ctaKey: 'guide.rebuild_timeline.cta',
    commands: [
      { kind: 'run_diagnostic', diagnosticId: 'auth_timeline' },
      { kind: 'inspect_artifact', artifactId: 'art_cookie_001' },
    ],
  },
  {
    id: 'd3',
    kind: 'decision',
    decisionId: 'D3',
    titleKey: 'guide.d3.title',
    whyKey: 'guide.d3.why',
  },
  {
    id: 'd4',
    kind: 'decision',
    decisionId: 'D4',
    titleKey: 'guide.d4.title',
    whyKey: 'guide.d4.why',
  },
  {
    id: 'contain',
    kind: 'operation',
    titleKey: 'guide.contain.title',
    whyKey: 'guide.contain.why',
    ctaKey: 'guide.contain.cta',
    commands: [
      { kind: 'run_diagnostic', diagnosticId: 'session_inventory' },
      { kind: 'take_response_action', actionId: 'revoke_sessions' },
      { kind: 'take_response_action', actionId: 'reset_credentials' },
      { kind: 'inspect_artifact', artifactId: 'art_edr_001' },
      { kind: 'take_response_action', actionId: 'isolate_endpoint' },
    ],
  },
  {
    id: 'd5',
    kind: 'decision',
    decisionId: 'D5',
    titleKey: 'guide.d5.title',
    whyKey: 'guide.d5.why',
  },
  {
    id: 'sweep',
    kind: 'operation',
    titleKey: 'guide.sweep.title',
    whyKey: 'guide.sweep.why',
    ctaKey: 'guide.sweep.cta',
    commands: [
      { kind: 'run_diagnostic', diagnosticId: 'indicator_scope' },
      { kind: 'take_response_action', actionId: 'block_indicator' },
    ],
  },
  {
    id: 'd6',
    kind: 'decision',
    decisionId: 'D6',
    titleKey: 'guide.d6.title',
    whyKey: 'guide.d6.why',
  },
  {
    id: 'close',
    kind: 'operation',
    titleKey: 'guide.close.title',
    whyKey: 'guide.close.why',
    ctaKey: 'guide.close.cta',
    commands: [{ kind: 'take_response_action', actionId: 'close_case' }],
  },
];

/** Every artifact and diagnostic the guided path will reach on its own. */
const PLANNED_ARTIFACTS = new Set<ArtifactId>(
  GUIDED_PLAN.flatMap((step) =>
    step.kind === 'operation'
      ? step.commands.flatMap((c) => (c.kind === 'inspect_artifact' ? [c.artifactId] : []))
      : [],
  ),
);

const PLANNED_DIAGNOSTICS = new Set<DiagnosticId>(
  GUIDED_PLAN.flatMap((step) =>
    step.kind === 'operation'
      ? step.commands.flatMap((c) => (c.kind === 'run_diagnostic' ? [c.diagnosticId] : []))
      : [],
  ),
);

export function guidedCommandDone(ctx: GameContext, command: GuidedCommand): boolean {
  if (command.kind === 'inspect_artifact') {
    return (
      ctx.inspectedArtifacts.includes(command.artifactId) ||
      ctx.destroyedArtifacts.includes(command.artifactId)
    );
  }
  if (command.kind === 'run_diagnostic') return ctx.ranDiagnostics.includes(command.diagnosticId);
  return hasPerformed(ctx, command.actionId);
}

/**
 * The commands of a guided step that THIS player is entitled to run.
 *
 * The guided plan is the optimal route. It must not walk a player past their own
 * decision: a run that took the wrong option at all six decisions used to end
 * "Contained", because the containment operation offered revoke/isolate/block
 * regardless of what had been decided. The decisions became cosmetic and the
 * debrief narrated a run that never happened. The audit is explicit that wrong
 * options are "valid pedagogical branches with consequences", and a guided path
 * that silently corrects them removes the consequence.
 *
 * A response action therefore appears only when a decision the player actually
 * made recommends it, or when it has already been performed. Evidence and
 * diagnostics are never filtered — looking is always allowed, and a player who
 * decided badly still deserves to be able to find out why.
 */
export function applicableCommands(
  ctx: GameContext,
  step: GuidedPlanStep,
): readonly GuidedCommand[] {
  if (step.kind !== 'operation') return [];
  const authorised = new Set(recommendedActions(ctx));
  return step.commands.filter(
    (command) =>
      command.kind !== 'take_response_action' ||
      authorised.has(command.actionId) ||
      hasPerformed(ctx, command.actionId),
  );
}

function guidedStepDone(ctx: GameContext, step: GuidedPlanStep): boolean {
  if (step.kind === 'decision') return Boolean(ctx.decisions[step.decisionId]);
  const applicable = applicableCommands(ctx, step);
  // Nothing here is this player's to do: the step is complete for them.
  if (applicable.length === 0) return true;
  return applicable.every((command) => guidedCommandDone(ctx, command));
}

function guidedCommandLabel(command: GuidedCommand): string {
  if (command.kind === 'inspect_artifact') {
    return tk(ARTIFACT_BY_ID.get(command.artifactId)?.titleKey ?? command.artifactId);
  }
  if (command.kind === 'run_diagnostic') {
    return tk(DIAGNOSTIC_BY_ID.get(command.diagnosticId)?.titleKey ?? command.diagnosticId);
  }
  return tk(RESPONSE_ACTION_BY_ID.get(command.actionId)?.labelKey ?? command.actionId);
}

function guidedCommandKey(command: GuidedCommand): string {
  if (command.kind === 'inspect_artifact') return `inspect:${command.artifactId}`;
  if (command.kind === 'run_diagnostic') return `diagnostic:${command.diagnosticId}`;
  return `action:${command.actionId}`;
}

export interface GuidedPart {
  key: string;
  label: string;
  done: boolean;
}

export interface NextRequiredStep {
  /** Position in the guided plan, 1-based, for "step 4 of 11". */
  index: number;
  total: number;
  id: string;
  kind: 'decision' | 'operation';
  title: string;
  why: string;
  /** Present only for a decision step. */
  decision: OpenDecisionView | null;
  /** Present only for an operation step. */
  cta: string;
  /** Commands still outstanding, in plan order. */
  pending: GuidedCommand[];
  /** Every command of the step with its current state, for the checklist. */
  parts: GuidedPart[];
  /** True when any pending command is a consequential response action. */
  consequential: boolean;
  /**
   * True when the fixture marks any pending action as needing confirmation.
   * Grouping steps must not quietly strip a confirmation the case author put
   * there: one dialog covers the whole operation, listing every impact.
   */
  requiresConfirmation: boolean;
  /** The impact sentences a player must read before running the operation. */
  impacts: string[];
}

/**
 * The one thing the player is being asked to do right now.
 *
 * Returns `null` only when the case is closed or the plan is exhausted — at
 * every other moment there is exactly one required step, which is what makes
 * "one persistent, visually dominant card" possible.
 */
export function nextRequiredStep(ctx: GameContext): NextRequiredStep | null {
  if (ctx.caseClosed) return null;

  const index = GUIDED_PLAN.findIndex((step) => !guidedStepDone(ctx, step));
  if (index === -1) return null;
  return nextRequiredStepFrom(ctx, GUIDED_PLAN[index]!, index);
}

function nextRequiredStepFrom(
  ctx: GameContext,
  step: GuidedPlanStep,
  index: number,
): NextRequiredStep | null {
  const base = { index: index + 1, total: GUIDED_PLAN.length, id: step.id };

  if (step.kind === 'decision') {
    // Off the guided path a decision can be reached while still locked (the
    // player answered out of order from the Playbook). Rather than show a dead
    // card, name the evidence that unlocks it.
    const decision = openDecisionId(ctx) === step.decisionId ? openDecisionView(ctx) : null;
    if (!decision) return unblockingStep(ctx, base);

    return {
      ...base,
      kind: 'decision',
      title: t(step.titleKey),
      why: t(step.whyKey),
      decision,
      cta: '',
      pending: [],
      parts: [],
      consequential: false,
      requiresConfirmation: false,
      impacts: [],
    };
  }

  const applicable = applicableCommands(ctx, step);
  const pending = applicable.filter((command) => !guidedCommandDone(ctx, command));
  const impacts: string[] = [];
  let consequential = false;
  let requiresConfirmation = false;
  for (const command of pending) {
    if (command.kind !== 'take_response_action') continue;
    const action = RESPONSE_ACTION_BY_ID.get(command.actionId);
    if (!action) continue;
    if (action.destructive) consequential = true;
    if (action.requiresConfirmation) requiresConfirmation = true;
    impacts.push(`${tk(action.labelKey)} — ${tk(action.impactKey)}`);
  }

  return {
    ...base,
    kind: 'operation',
    title: t(step.titleKey),
    why: t(step.whyKey),
    decision: null,
    cta: t(step.ctaKey),
    pending,
    parts: applicable.map((command) => ({
      key: guidedCommandKey(command),
      label: guidedCommandLabel(command),
      done: guidedCommandDone(ctx, command),
    })),
    consequential,
    requiresConfirmation,
    impacts,
  };
}

/** Fallback step: whatever the next decision is actually waiting for. */
function unblockingStep(
  ctx: GameContext,
  base: { index: number; total: number; id: string },
): NextRequiredStep | null {
  const blocked = blockedDecisionView(ctx);
  if (!blocked) return null;

  const commands: GuidedCommand[] = [
    ...blocked.missing.diagnostics.map(
      (diagnosticId): GuidedCommand => ({ kind: 'run_diagnostic', diagnosticId }),
    ),
    ...blocked.missing.artifacts.map(
      (artifactId): GuidedCommand => ({ kind: 'inspect_artifact', artifactId }),
    ),
  ];
  if (commands.length === 0) return null;

  return {
    ...base,
    id: `unblock-${blocked.decisionId}`,
    kind: 'operation',
    title: t('guide.unblock.title', { decision: blocked.decisionId }),
    why: t('guide.unblock.why'),
    decision: null,
    cta: t('guide.unblock.cta'),
    pending: commands,
    parts: commands.map((command) => ({
      key: guidedCommandKey(command),
      label: guidedCommandLabel(command),
      done: false,
    })),
    consequential: false,
    requiresConfirmation: false,
    impacts: [],
  };
}

/* ------------------------------------------------------------------ *
 * Optional evidence — reachable, never competing
 * ------------------------------------------------------------------ */

export interface Exploration {
  kind: 'inspect_artifact' | 'run_diagnostic';
  id: string;
  label: string;
  note: string;
}

/**
 * Evidence and diagnostics that are genuinely optional: available now, not yet
 * read, and never reached by the guided path. These belong under "Explore
 * more" so that the required next step is the only thing competing for
 * attention.
 */
export function explorations(ctx: GameContext): Exploration[] {
  const list: Exploration[] = [];

  for (const artifact of availableArtifacts(ctx)) {
    if (ctx.inspectedArtifacts.includes(artifact.id)) continue;
    if (PLANNED_ARTIFACTS.has(artifact.id)) continue;
    list.push({
      kind: 'inspect_artifact',
      id: artifact.id,
      label: tk(artifact.titleKey),
      note: artifact.untrusted ? t('evidence.untrusted_badge') : t('evidence.inspect'),
    });
  }

  for (const diagnostic of availableDiagnostics(ctx)) {
    if (PLANNED_DIAGNOSTICS.has(diagnostic.id)) continue;
    list.push({
      kind: 'run_diagnostic',
      id: diagnostic.id,
      label: tk(diagnostic.titleKey),
      note: tk(diagnostic.descriptionKey),
    });
  }

  return list;
}

/* ------------------------------------------------------------------ *
 * What just happened
 * ------------------------------------------------------------------ *
 *
 * The contract requires every action to produce an immediate result, what
 * changed, why it mattered and one next-step CTA. The CTA is the card itself;
 * the other three are derived here from case state, so they read the same
 * whether the step was run from the guided card, the Playbook route or a
 * WebMCP tool call.
 */

export interface StepOutcome {
  stepId: string;
  title: string;
  /** What the system reported back. */
  result: string;
  /** Concrete state changes: findings closed, evidence unlocked, points. */
  changed: string[];
  /** Why it mattered. */
  why: string;
}

function pointsFor(ctx: GameContext, sources: string[]): number {
  const wanted = new Set(sources);
  return ctx.scoreEntries
    .filter((entry) => wanted.has(entry.source))
    .reduce((total, entry) => total + entry.delta, 0);
}

/** The most recently completed guided step, if any. */
export function lastCompletedStep(ctx: GameContext): StepOutcome | null {
  const nextIndex = GUIDED_PLAN.findIndex((step) => !guidedStepDone(ctx, step));
  const lastIndex = (nextIndex === -1 ? GUIDED_PLAN.length : nextIndex) - 1;
  if (lastIndex < 0) return null;
  const step = GUIDED_PLAN[lastIndex]!;

  if (step.kind === 'decision') {
    const record = ctx.decisions[step.decisionId];
    const decision = DECISION_BY_ID.get(step.decisionId);
    const option = decision?.options.find((o) => o.id === record?.optionId);
    if (!decision || !option) return null;

    const changed: string[] = [];
    const points = pointsFor(ctx, [`decision:${option.id}`]);
    if (points !== 0) {
      changed.push(t('guide.points', { points: points > 0 ? `+${points}` : String(points) }));
    }
    for (const effect of option.stateEffects ?? []) {
      if (effect.kind === 'reveal_artifact') {
        changed.push(
          t('guide.evidence_unlocked', {
            artifact: tk(ARTIFACT_BY_ID.get(effect.artifactId)?.titleKey ?? effect.artifactId),
          }),
        );
      }
    }
    changed.push(t('guide.state_version', { version: ctx.stateVersion }));

    return {
      stepId: step.id,
      title: t(step.titleKey),
      result: tk(option.explanationKey),
      changed,
      why: tk(decision.learningGoalKey),
    };
  }

  const results: string[] = [];
  const changed: string[] = [];
  const sources: string[] = [];
  const whys: string[] = [];

  for (const command of step.commands) {
    sources.push(guidedCommandKey(command));
    if (command.kind === 'run_diagnostic') {
      const diagnostic = DIAGNOSTIC_BY_ID.get(command.diagnosticId);
      if (!diagnostic) continue;
      results.push(tk(diagnostic.resultKey));
      whys.push(tk(diagnostic.descriptionKey));
      for (const artifactId of diagnostic.revealsArtifacts ?? []) {
        changed.push(
          t('guide.evidence_unlocked', {
            artifact: tk(ARTIFACT_BY_ID.get(artifactId)?.titleKey ?? artifactId),
          }),
        );
      }
      for (const findingId of diagnostic.resolvesFindings ?? []) {
        const finding = findingById(findingId);
        if (finding) changed.push(t('guide.finding_resolved', { finding: tk(finding.titleKey) }));
      }
    } else if (command.kind === 'take_response_action') {
      const action = RESPONSE_ACTION_BY_ID.get(command.actionId);
      if (!action) continue;
      results.push(tk(action.resultKey));
      whys.push(tk(action.impactKey));
      for (const findingId of action.resolvesFindings ?? []) {
        const finding = findingById(findingId);
        if (finding) changed.push(t('guide.finding_resolved', { finding: tk(finding.titleKey) }));
      }
    } else {
      const artifact = ARTIFACT_BY_ID.get(command.artifactId);
      if (!artifact) continue;
      results.push(tk(artifact.explanationKey));
      whys.push(t('guide.evidence_why'));
    }
  }

  const points = pointsFor(ctx, sources);
  if (points !== 0) {
    changed.unshift(t('guide.points', { points: points > 0 ? `+${points}` : String(points) }));
  }
  changed.push(t('guide.state_version', { version: ctx.stateVersion }));

  return {
    stepId: step.id,
    title: t(step.titleKey),
    result: results[results.length - 1] ?? '',
    changed,
    why: whys[whys.length - 1] ?? '',
  };
}
