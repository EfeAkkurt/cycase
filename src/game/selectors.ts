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
  CommandKind,
  DashboardRoute,
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

/* ------------------------------------------------------------------ *
 * Incident phases — the one progress model
 * ------------------------------------------------------------------ *
 *
 * The console used to make two progress claims at once. The guided card counted
 * "Step 6 of 11" over a plan whose length is an implementation detail of that
 * plan, and the decision card counted "Decision 3 of 6" over a different unit
 * entirely. Both were true, neither agreed with the other, and a player asking
 * the only question that matters — *how far through this incident am I?* — got
 * two answers and no way to reconcile them.
 *
 * There is now one model, and it is the one an incident actually has:
 *
 *   Triage → Investigate → Contain → Scope → Close
 *
 * Every guided step belongs to exactly one phase. Steps and decisions still
 * exist and are still counted, but only *inside* the active phase, where a
 * count is a position rather than a rival claim about the whole case.
 */

export const INCIDENT_PHASES = ['triage', 'investigate', 'contain', 'scope', 'close'] as const;

export type IncidentPhase = (typeof INCIDENT_PHASES)[number];

export function phaseLabel(phase: IncidentPhase): string {
  return t(`phase.${phase}` as StringKey);
}

export type GuidedCommand =
  | { kind: 'inspect_artifact'; artifactId: ArtifactId }
  | { kind: 'run_diagnostic'; diagnosticId: DiagnosticId }
  | { kind: 'take_response_action'; actionId: ResponseActionId };

export interface GuidedDecisionStep {
  id: string;
  kind: 'decision';
  phase: IncidentPhase;
  decisionId: DecisionId;
  /** Short imperative headline; the prompt itself carries the detail. */
  titleKey: StringKey;
  whyKey: StringKey;
}

export interface GuidedOperationStep {
  id: string;
  kind: 'operation';
  phase: IncidentPhase;
  titleKey: StringKey;
  whyKey: StringKey;
  /**
   * Verb-first label for the operation as a whole. Each *stage* of the
   * operation gets its own control and its own verb; this names the group.
   */
  ctaKey: StringKey;
  commands: GuidedCommand[];
}

export type GuidedPlanStep = GuidedDecisionStep | GuidedOperationStep;

export const GUIDED_PLAN: readonly GuidedPlanStep[] = [
  {
    id: 'd1',
    phase: 'triage',
    kind: 'decision',
    decisionId: 'D1',
    titleKey: 'guide.d1.title',
    whyKey: 'guide.d1.why',
  },
  {
    id: 'read_report',
    phase: 'triage',
    kind: 'operation',
    titleKey: 'guide.read_report.title',
    whyKey: 'guide.read_report.why',
    ctaKey: 'guide.read_report.cta',
    commands: [{ kind: 'inspect_artifact', artifactId: 'art_email_001' }],
  },
  {
    id: 'd2',
    phase: 'triage',
    kind: 'decision',
    decisionId: 'D2',
    titleKey: 'guide.d2.title',
    whyKey: 'guide.d2.why',
  },
  {
    id: 'rebuild_timeline',
    phase: 'investigate',
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
    phase: 'investigate',
    kind: 'decision',
    decisionId: 'D3',
    titleKey: 'guide.d3.title',
    whyKey: 'guide.d3.why',
  },
  {
    id: 'd4',
    phase: 'investigate',
    kind: 'decision',
    decisionId: 'D4',
    titleKey: 'guide.d4.title',
    whyKey: 'guide.d4.why',
  },
  {
    id: 'contain',
    phase: 'contain',
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
    phase: 'scope',
    kind: 'decision',
    decisionId: 'D5',
    titleKey: 'guide.d5.title',
    whyKey: 'guide.d5.why',
  },
  {
    id: 'sweep',
    phase: 'scope',
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
    phase: 'close',
    kind: 'decision',
    decisionId: 'D6',
    titleKey: 'guide.d6.title',
    whyKey: 'guide.d6.why',
  },
  {
    id: 'close',
    phase: 'close',
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
  /** True for the one part the primary control is about to run. */
  current: boolean;
}

/**
 * One command, presented as the thing the player is about to do.
 *
 * A stage is the unit of a click. It exists because the containment step used
 * to run five commands — a session inventory, two credential operations, an
 * evidence read and an endpoint isolation — behind a single button and a single
 * dialog. Five state mutations for one press, four of them invisible until
 * afterwards, is precisely the "hidden batch" this work removes: the player
 * could not see what was about to happen, could not stop between the parts, and
 * could not tell which part failed when one did.
 *
 * The stage carries its own consequence flags rather than the step's. A step
 * whose remaining commands are "run a diagnostic, then revoke every session"
 * must not warn *destructive* over the diagnostic, and must not demand a
 * confirmation to run it — the warning belongs to the command it describes.
 */
export interface GuidedStage {
  /** Stable per command; also the anchor a receipt is rendered against. */
  key: string;
  command: GuidedCommand;
  kind: GuidedCommand['kind'];
  /** The fixture's own name for the artifact, diagnostic or action. */
  label: string;
  /** Verb-first label for this stage's single control. */
  cta: string;
  /** True only for a destructive response action. */
  consequential: boolean;
  /** True only when the fixture marks *this* action as needing confirmation. */
  requiresConfirmation: boolean;
  /** The impact sentence to read before authorising. Null when there is none. */
  impact: string | null;
  /**
   * Where this stage takes the player. Reading evidence is a *navigation* —
   * the record has to be on screen before the case may record it as read — so
   * the stage says so rather than each caller re-deciding.
   */
  navigatesTo: DashboardRoute | null;
}

export interface NextRequiredStep {
  id: string;
  kind: 'decision' | 'operation';
  /** The one progress model. Never a step-of-eleven count. */
  phase: IncidentPhase;
  title: string;
  why: string;
  /** Present only for a decision step. */
  decision: OpenDecisionView | null;
  /** The group label for the whole operation. Stages carry their own verbs. */
  cta: string;
  /**
   * The single command the primary control will run — never a batch.
   * Null for a decision step, and null when the step is somehow already done.
   */
  stage: GuidedStage | null;
  /** Commands still outstanding after `stage`, in plan order. */
  upcoming: GuidedStage[];
  /** Commands still outstanding, in plan order, including `stage`. */
  pending: GuidedCommand[];
  /** Every command of the step with its current state, for the checklist. */
  parts: GuidedPart[];
  /** True when the *next stage* is a consequential response action. */
  consequential: boolean;
  /** True when the fixture marks the *next stage* as needing confirmation. */
  requiresConfirmation: boolean;
  /** The impact sentences for the next stage. At most one, kept as a list. */
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
  return nextRequiredStepFrom(ctx, GUIDED_PLAN[index]!);
}

/**
 * Describes one command as the thing about to happen.
 *
 * Everything a player needs before pressing a control comes from the fixture:
 * its own name for the thing, whether the case author called it destructive,
 * whether the case author asked for a confirmation, and its impact sentence.
 * Nothing here is inferred from the command's position in a plan, which is why
 * a stage reads the same run from the guided card, the Playbook or a corrective
 * detour.
 */
export function stageFor(command: GuidedCommand): GuidedStage {
  const key = guidedCommandKey(command);
  const label = guidedCommandLabel(command);

  if (command.kind === 'inspect_artifact') {
    return {
      key,
      command,
      kind: command.kind,
      label,
      cta: t('guide.stage.open', { label }),
      consequential: false,
      requiresConfirmation: false,
      impact: null,
      // Reading evidence is navigation. The record is recorded as read by the
      // inspector once it is genuinely on screen, never by the control that
      // sent the player there.
      navigatesTo: 'evidence',
    };
  }

  if (command.kind === 'run_diagnostic') {
    return {
      key,
      command,
      kind: command.kind,
      label,
      cta: t('guide.stage.run', { label }),
      consequential: false,
      requiresConfirmation: false,
      impact: tk(DIAGNOSTIC_BY_ID.get(command.diagnosticId)?.descriptionKey ?? ''),
      navigatesTo: 'respond',
    };
  }

  const action = RESPONSE_ACTION_BY_ID.get(command.actionId);
  return {
    key,
    command,
    kind: command.kind,
    label,
    cta: label,
    consequential: Boolean(action?.destructive),
    requiresConfirmation: Boolean(action?.requiresConfirmation),
    impact: action ? tk(action.impactKey) : null,
    navigatesTo: 'respond',
  };
}

function nextRequiredStepFrom(ctx: GameContext, step: GuidedPlanStep): NextRequiredStep | null {
  if (step.kind === 'decision') {
    // Off the guided path a decision can be reached while still locked (the
    // player answered out of order from the Playbook). Rather than show a dead
    // card, name the evidence that unlocks it.
    const decision = openDecisionId(ctx) === step.decisionId ? openDecisionView(ctx) : null;
    if (!decision) return unblockingStep(ctx, step.phase);

    return {
      id: step.id,
      phase: step.phase,
      kind: 'decision',
      title: t(step.titleKey),
      why: t(step.whyKey),
      decision,
      cta: '',
      stage: null,
      upcoming: [],
      pending: [],
      parts: [],
      consequential: false,
      requiresConfirmation: false,
      impacts: [],
    };
  }

  const applicable = applicableCommands(ctx, step);
  const pending = applicable.filter((command) => !guidedCommandDone(ctx, command));

  return operationStep(ctx, {
    id: step.id,
    phase: step.phase,
    title: t(step.titleKey),
    why: t(step.whyKey),
    cta: t(step.ctaKey),
    applicable: [...applicable],
    pending: [...pending],
  });
}

/**
 * Assembles an operation step around its *next* stage.
 *
 * The consequence flags describe `pending[0]` and nothing else. Computing them
 * across every outstanding command is what made the card warn "destructive" and
 * raise a confirmation dialog over a read-only session inventory, simply
 * because a revocation was queued behind it — the exact conflation between
 * ordinary work and consequential work that §4 of this flow work removes.
 */
function operationStep(
  ctx: GameContext,
  input: {
    id: string;
    phase: IncidentPhase;
    title: string;
    why: string;
    cta: string;
    applicable: GuidedCommand[];
    pending: GuidedCommand[];
  },
): NextRequiredStep {
  const stages = input.pending.map(stageFor);
  const stage = stages[0] ?? null;

  return {
    id: input.id,
    phase: input.phase,
    kind: 'operation',
    title: input.title,
    why: input.why,
    decision: null,
    cta: input.cta,
    stage,
    upcoming: stages.slice(1),
    pending: input.pending,
    parts: input.applicable.map((command) => {
      const key = guidedCommandKey(command);
      return {
        key,
        label: guidedCommandLabel(command),
        done: guidedCommandDone(ctx, command),
        current: stage?.key === key,
      };
    }),
    consequential: stage?.consequential ?? false,
    requiresConfirmation: stage?.requiresConfirmation ?? false,
    impacts: stage?.impact ? [`${stage.label} — ${stage.impact}`] : [],
  };
}

/** Fallback step: whatever the next decision is actually waiting for. */
function unblockingStep(ctx: GameContext, phase: IncidentPhase): NextRequiredStep | null {
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

  return operationStep(ctx, {
    id: `unblock-${blocked.decisionId}`,
    phase,
    title: t('guide.unblock.title', { decision: blocked.decisionId }),
    why: t('guide.unblock.why'),
    cta: t('guide.unblock.cta'),
    applicable: commands,
    pending: commands,
  });
}

/* ------------------------------------------------------------------ *
 * Phase progress — the single answer to "how far through this am I?"
 * ------------------------------------------------------------------ */

export type PhaseState = 'done' | 'active' | 'upcoming';

export interface PhaseView {
  id: IncidentPhase;
  label: string;
  state: PhaseState;
  /** Stages finished and total stages, for this player, in this phase. */
  done: number;
  total: number;
}

export interface PhaseProgress {
  /** The phase the required next step belongs to. */
  phase: IncidentPhase;
  label: string;
  /** 1-based position of the active phase, for "phase 3 of 5". */
  index: number;
  total: number;
  /** 1-based position of the current stage inside the active phase. */
  stageIndex: number;
  stageTotal: number;
  /** Every phase, for the rail. */
  phases: PhaseView[];
  /** True once the case is closed and no phase is active. */
  complete: boolean;
}

/**
 * How many stages this phase asks of *this* player, and how many are done.
 *
 * Counted from `applicableCommands`, not from the plan as authored, because a
 * player whose decision did not authorise an operation is not being asked to
 * run it. A count that included work the guide will never offer would be a
 * progress bar that can never fill.
 */
function phaseStages(ctx: GameContext, phase: IncidentPhase): { done: number; total: number } {
  let done = 0;
  let total = 0;

  for (const step of GUIDED_PLAN) {
    if (step.phase !== phase) continue;
    if (step.kind === 'decision') {
      total += 1;
      if (ctx.decisions[step.decisionId]) done += 1;
      continue;
    }
    for (const command of applicableCommands(ctx, step)) {
      total += 1;
      if (guidedCommandDone(ctx, command)) done += 1;
    }
  }

  return { done, total };
}

export function phaseProgress(ctx: GameContext): PhaseProgress {
  const step = nextRequiredStep(ctx);
  const activeIndex = step ? INCIDENT_PHASES.indexOf(step.phase) : -1;

  const phases: PhaseView[] = INCIDENT_PHASES.map((id, index) => {
    const { done, total } = phaseStages(ctx, id);
    const state: PhaseState =
      activeIndex === -1 ? 'done' : index < activeIndex ? 'done' : index === activeIndex ? 'active' : 'upcoming';
    return { id, label: phaseLabel(id), state, done, total };
  });

  const active = activeIndex === -1 ? null : phases[activeIndex]!;

  return {
    phase: step?.phase ?? 'close',
    label: phaseLabel(step?.phase ?? 'close'),
    index: activeIndex === -1 ? INCIDENT_PHASES.length : activeIndex + 1,
    total: INCIDENT_PHASES.length,
    // Clamped: the last stage of a phase is "n of n", never "n+1 of n".
    stageIndex: active ? Math.min(active.done + 1, Math.max(active.total, 1)) : 0,
    stageTotal: active?.total ?? 0,
    phases,
    complete: activeIndex === -1,
  };
}

/* ------------------------------------------------------------------ *
 * The corrective path
 * ------------------------------------------------------------------ *
 *
 * A wrong decision keeps its cost. Its score entry stands, the debrief still
 * narrates it, and `applicableCommands` still refuses to walk the player
 * through an operation they did not authorise — none of that is undone here,
 * because a consequence that can be erased is not a consequence.
 *
 * What was missing is a way *forward*. A player who chose "reset the password
 * only" watched the guided path step past the revocation for the rest of the
 * case, with the stolen session live and nothing on screen saying what would
 * close it. The incident was unfixable for a reason the console never stated.
 *
 * So: for every critical finding still open, the operation that would close it,
 * offered explicitly as a correction rather than folded into the required path.
 * It is derived, never authored — `FINDINGS` × `RESPONSE_ACTIONS` ×
 * `actionAvailability` — so it cannot drift from the rules the engine scores
 * against, and it appears only once the guided plan has genuinely walked past
 * the action without offering it.
 */

export interface CorrectiveStep {
  findingId: FindingId;
  /** The finding this closes, named. */
  finding: string;
  command: GuidedCommand;
  actionId: ResponseActionId;
  label: string;
  impact: string;
  /** Why the guide is not offering this itself. */
  why: string;
  destructive: boolean;
  requiresConfirmation: boolean;
}

/** Plan position of every response action the taught route contains. */
const PLANNED_ACTION_INDEX = new Map<ResponseActionId, number>(
  GUIDED_PLAN.flatMap((step, index) =>
    step.kind === 'operation'
      ? step.commands.flatMap((command) =>
          command.kind === 'take_response_action'
            ? ([[command.actionId, index]] as [ResponseActionId, number][])
            : [],
        )
      : [],
  ),
);

export function correctivePath(ctx: GameContext): CorrectiveStep[] {
  if (ctx.caseClosed) return [];

  const open = new Set(unresolvedCriticalFindings(ctx));
  if (open.size === 0) return [];

  // Where the guided path has got to. An action the plan has not yet reached is
  // not a gap — it is simply later.
  const nextIndex = GUIDED_PLAN.findIndex((step) => !guidedStepDone(ctx, step));
  const frontier = nextIndex === -1 ? GUIDED_PLAN.length : nextIndex;
  const offered = new Set(recommendedActions(ctx));

  const steps: CorrectiveStep[] = [];

  for (const action of RESPONSE_ACTIONS) {
    if (offered.has(action.id)) continue;
    if (!actionAvailability(ctx, action.id).allowed) continue;

    const planIndex = PLANNED_ACTION_INDEX.get(action.id);
    if (planIndex === undefined || planIndex >= frontier) continue;

    for (const findingId of action.resolvesFindings ?? []) {
      if (!open.has(findingId)) continue;
      const finding = findingById(findingId);
      if (!finding) continue;

      steps.push({
        findingId,
        finding: tk(finding.titleKey),
        command: { kind: 'take_response_action', actionId: action.id },
        actionId: action.id,
        label: tk(action.labelKey),
        impact: tk(action.impactKey),
        why: t('corrective.why', { finding: tk(finding.titleKey) }),
        destructive: action.destructive,
        requiresConfirmation: action.requiresConfirmation,
      });
      break; // one entry per action; the first open finding names it
    }
  }

  return steps;
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


/* ------------------------------------------------------------------ *
 * Receipts — what happened, beside the control that did it
 * ------------------------------------------------------------------ *
 *
 * Every decision, diagnostic and response action has to answer three questions
 * immediately and in the place the player is already looking: what happened,
 * what changed, and why it mattered. `LastOutcome` answers them for a whole
 * guided step at the bottom of the workspace, which is the right place for a
 * summary and the wrong place for feedback — a player who pressed a button in
 * the Playbook has no reason to look 900px down the page for its result.
 *
 * A receipt is that feedback. It is derived from the tool log's last entry, so
 * it reads identically whether the command came from the guided card, a
 * destination control or a WebMCP call, and it carries the `anchor` — the DOM
 * id of the control that issued it — so the console can render it next to that
 * control rather than in a fixed corner.
 *
 * When something fails or half-lands it says what did *not* change, and offers
 * exactly one way forward. One, deliberately: an error that offers three
 * recoveries has told the player it does not know which one is right.
 */

export type ReceiptState = 'done' | 'partial' | 'failed';

export interface ReceiptRecovery {
  /** The single control's label. */
  label: string;
  /** The one command that recovers, when the recovery is something to run. */
  command: GuidedCommand | null;
  /** Where the recovery lives, when it is somewhere to go. */
  route: DashboardRoute | null;
  /** One sentence naming what it will do. */
  hint: string;
}

export interface CommandReceipt {
  /** Engine sequence of the command. Changes on every call, so it is a key. */
  seq: number;
  /** DOM id of the control that issued it — `action-revoke_sessions` etc. */
  anchor: string;
  kind: CommandKind;
  state: ReceiptState;
  title: string;
  /** What the system reported back. */
  result: string;
  /** Concrete state changes. Empty when nothing moved. */
  changed: string[];
  /** What did *not* change. Present on a failure or a partial outcome. */
  unchanged: string[];
  /** Why it mattered. */
  why: string;
  /** Exactly one way forward, or none when nothing needs recovering. */
  recovery: ReceiptRecovery | null;
}

/** Commands that produce a receipt. Reads and narration deliberately do not. */
const RECEIPTED: readonly CommandKind[] = [
  'inspect_artifact',
  'run_diagnostic',
  'take_response_action',
  'submit_decision',
];

/** Score entries this command produced, as display lines. */
function pointsLine(ctx: GameContext, seq: number): string[] {
  const delta = ctx.scoreEntries
    .filter((entry) => entry.seq === seq)
    .reduce((total, entry) => total + entry.delta, 0);
  if (delta === 0) return [];
  return [t('guide.points', { points: delta > 0 ? `+${delta}` : String(delta) })];
}

/** The one way forward offered after a failure or a partial outcome. */
function receiptRecovery(ctx: GameContext, hint: string): ReceiptRecovery | null {
  const corrective = correctivePath(ctx)[0];
  if (corrective) {
    return {
      label: t('receipt.recovery.corrective', { label: corrective.label }),
      command: corrective.command,
      route: 'respond',
      hint: corrective.why,
    };
  }

  const step = nextRequiredStep(ctx);
  if (step?.stage) {
    return {
      label: t('receipt.recovery.next', { label: step.stage.label }),
      // Null on purpose: the guided card owns running the required step. This
      // control takes the player to it rather than racing it.
      command: null,
      route: step.stage.navigatesTo,
      hint: hint || step.why,
    };
  }
  if (step?.decision) {
    return {
      label: t('receipt.recovery.decide'),
      command: null,
      route: 'command',
      hint: hint || step.why,
    };
  }

  return null;
}

/** The critical findings still open, named, capped so a receipt stays readable. */
function stillOpenLines(ctx: GameContext, limit = 3): string[] {
  return unresolvedCriticalFindings(ctx)
    .slice(0, limit)
    .map((id) => t('receipt.still_open', { finding: tk(findingById(id)?.titleKey ?? id) }));
}

/**
 * The receipt for the command the engine most recently ran.
 *
 * Returns null for reads, for narration, and before anything has happened —
 * there is nothing to report about a call that reported nothing.
 */
export function commandReceipt(ctx: GameContext): CommandReceipt | null {
  const entry = ctx.toolLog.at(-1);
  if (!entry || !RECEIPTED.includes(entry.tool)) return null;

  const failed = !entry.ok;
  const error = ctx.lastResult && !ctx.lastResult.ok ? ctx.lastResult.error : undefined;

  const base = {
    seq: entry.seq,
    anchor: entry.effectId ?? 'next-step',
    kind: entry.tool,
  };

  if (failed) {
    const unchanged = [
      t('receipt.unchanged.state', { version: ctx.stateVersion }),
      ...stillOpenLines(ctx),
    ];
    // A refused call sometimes still costs efficiency. Saying "nothing changed"
    // over a score that just moved would be the receipt lying about itself.
    const points = pointsLine(ctx, entry.seq);

    return {
      ...base,
      state: 'failed',
      title: t('receipt.failed.title'),
      result: error?.message ?? t('error.action_not_allowed'),
      changed: points,
      unchanged,
      why: t('receipt.failed.why'),
      recovery: receiptRecovery(ctx, error?.recovery ?? ''),
    };
  }

  if (entry.tool === 'submit_decision') return decisionReceipt(ctx, base);
  if (entry.tool === 'run_diagnostic') return diagnosticReceipt(ctx, base);
  if (entry.tool === 'take_response_action') return actionReceipt(ctx, base);
  return artifactReceipt(ctx, base);
}

type ReceiptBase = { seq: number; anchor: string; kind: CommandKind };

function decisionReceipt(ctx: GameContext, base: ReceiptBase): CommandReceipt | null {
  const decisionId = base.anchor.replace(/^decision-/, '') as DecisionId;
  const decision = DECISION_BY_ID.get(decisionId);
  const record = ctx.decisions[decisionId];
  const option = decision?.options.find((o) => o.id === record?.optionId);
  if (!decision || !option) return null;

  const changed = [...pointsLine(ctx, base.seq)];
  for (const effect of option.stateEffects ?? []) {
    if (effect.kind === 'reveal_artifact') {
      changed.push(
        t('guide.evidence_unlocked', {
          artifact: tk(ARTIFACT_BY_ID.get(effect.artifactId)?.titleKey ?? effect.artifactId),
        }),
      );
    }
    if (effect.kind === 'destroy_artifact') {
      changed.push(
        t('receipt.evidence_destroyed', {
          artifact: tk(ARTIFACT_BY_ID.get(effect.artifactId)?.titleKey ?? effect.artifactId),
        }),
      );
    }
  }
  changed.push(t('guide.state_version', { version: ctx.stateVersion }));

  // A weaker branch is not an error and is never re-scored. It is reported as
  // partial so the console can say what it left open and offer the correction.
  const weak = !option.correct;

  return {
    ...base,
    state: weak ? 'partial' : 'done',
    title: tk(decision.promptKey),
    result: tk(option.explanationKey),
    changed,
    unchanged: weak ? stillOpenLines(ctx) : [],
    why: tk(decision.learningGoalKey),
    recovery: weak ? receiptRecovery(ctx, tk(decision.learningGoalKey)) : null,
  };
}

function diagnosticReceipt(ctx: GameContext, base: ReceiptBase): CommandReceipt | null {
  const diagnosticId = base.anchor.replace(/^diagnostic-/, '') as DiagnosticId;
  const diagnostic = DIAGNOSTIC_BY_ID.get(diagnosticId);
  if (!diagnostic) return null;

  const changed = [...pointsLine(ctx, base.seq)];
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
  changed.push(t('guide.state_version', { version: ctx.stateVersion }));

  return {
    ...base,
    state: 'done',
    title: tk(diagnostic.titleKey),
    result: tk(diagnostic.resultKey),
    changed,
    unchanged: [],
    why: tk(diagnostic.descriptionKey),
    recovery: null,
  };
}

function actionReceipt(ctx: GameContext, base: ReceiptBase): CommandReceipt | null {
  const actionId = base.anchor.replace(/^action-/, '') as ResponseActionId;
  const action = RESPONSE_ACTION_BY_ID.get(actionId);
  if (!action) return null;

  const changed = [...pointsLine(ctx, base.seq)];
  const promised = action.resolvesFindings ?? [];
  const stillOpen = new Set(unresolvedCriticalFindings(ctx));

  for (const findingId of promised) {
    const finding = findingById(findingId);
    if (!finding) continue;
    if (stillOpen.has(findingId)) continue;
    changed.push(t('guide.finding_resolved', { finding: tk(finding.titleKey) }));
  }
  changed.push(t('guide.state_version', { version: ctx.stateVersion }));

  // Partial means *this operation* did not deliver what it promised — not that
  // the incident still has other gaps. Conflating the two would mark every
  // successful containment step as a partial failure until the last one.
  const outstanding = promised.filter((findingId) => stillOpen.has(findingId));

  return {
    ...base,
    state: outstanding.length > 0 ? 'partial' : 'done',
    title: tk(action.labelKey),
    result: tk(action.resultKey),
    changed,
    unchanged: outstanding.map((findingId) =>
      t('receipt.still_open', { finding: tk(findingById(findingId)?.titleKey ?? findingId) }),
    ),
    why: tk(action.impactKey),
    recovery: outstanding.length > 0 ? receiptRecovery(ctx, tk(action.impactKey)) : null,
  };
}

function artifactReceipt(ctx: GameContext, base: ReceiptBase): CommandReceipt | null {
  const artifactId = base.anchor.replace(/^evidence-/, '') as ArtifactId;
  const artifact = ARTIFACT_BY_ID.get(artifactId);
  if (!artifact) return null;

  return {
    ...base,
    state: 'done',
    title: tk(artifact.titleKey),
    result: tk(artifact.explanationKey),
    changed: [
      ...pointsLine(ctx, base.seq),
      t('receipt.evidence_recorded', { artifact: tk(artifact.titleKey) }),
      t('guide.state_version', { version: ctx.stateVersion }),
    ],
    unchanged: [],
    why: t('guide.evidence_why'),
    recovery: null,
  };
}
