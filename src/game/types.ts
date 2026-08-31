/**
 * CYCASE — deterministic game core types.
 *
 * Everything the LLM/agent may *not* decide lives here: scene, allowed actions,
 * evidence visibility, scoring, endings, idempotency and state versioning.
 *
 * See docs/PROJECT_CONTEXT.md §5 and docs/WEBMCP_CONTRACT.md.
 */

/* ------------------------------------------------------------------ *
 * Identifiers
 * ------------------------------------------------------------------ */

export type ArtifactId =
  | 'art_email_001'
  | 'art_url_001'
  | 'art_signin_001'
  | 'art_session_001'
  | 'art_cookie_001'
  | 'art_fileops_001'
  | 'art_dlp_001'
  | 'art_edr_001';

export const ARTIFACT_IDS: readonly ArtifactId[] = [
  'art_email_001',
  'art_url_001',
  'art_signin_001',
  'art_session_001',
  'art_cookie_001',
  'art_fileops_001',
  'art_dlp_001',
  'art_edr_001',
] as const;

export type DiagnosticId = 'auth_timeline' | 'session_inventory' | 'indicator_scope';

export const DIAGNOSTIC_IDS: readonly DiagnosticId[] = [
  'auth_timeline',
  'session_inventory',
  'indicator_scope',
] as const;

export type ResponseActionId =
  | 'revoke_sessions'
  | 'reset_credentials'
  | 'isolate_endpoint'
  | 'block_indicator'
  | 'close_case';

export const RESPONSE_ACTION_IDS: readonly ResponseActionId[] = [
  'revoke_sessions',
  'reset_credentials',
  'isolate_endpoint',
  'block_indicator',
  'close_case',
] as const;

export type DecisionId = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6';

export const DECISION_IDS: readonly DecisionId[] = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'] as const;

export type DecisionOptionId =
  // D1 — Triage
  | 'D1_preserve_and_inspect'
  | 'D1_disable_account_now'
  // D2 — Validate
  | 'D2_compare_signin_telemetry'
  | 'D2_trust_sender_display_name'
  // D3 — Contain
  | 'D3_revoke_then_reset'
  | 'D3_password_only'
  // D4 — Endpoint
  | 'D4_collect_then_isolate'
  | 'D4_delete_email_and_close_alert'
  // D5 — Scope
  | 'D5_sweep_indicators'
  | 'D5_assume_single_account'
  // D6 — Close
  | 'D6_verify_checklist'
  | 'D6_close_without_verifying';

export type HintTopic = 'evidence' | 'identity' | 'containment' | 'scope';

export const HINT_TOPICS: readonly HintTopic[] = [
  'evidence',
  'identity',
  'containment',
  'scope',
] as const;

export type IdentityId = 'usr_dilara' | 'usr_baran' | 'usr_ecrin' | 'svc_backup';
export type AssetId = 'WKS-114' | 'WKS-231' | 'SRV-FILES-02' | 'IDP-01';

export type FindingId =
  | 'rogue_session_active'
  | 'credentials_exposed'
  | 'endpoint_uncontained'
  | 'indicators_unblocked'
  | 'scope_unverified';

export const FINDING_IDS: readonly FindingId[] = [
  'rogue_session_active',
  'credentials_exposed',
  'endpoint_uncontained',
  'indicators_unblocked',
  'scope_unverified',
] as const;

/** Narrative / consequence flags set deterministically by decisions and operations. */
export type FlagId =
  | 'evidence_at_risk'
  | 'account_disabled_early'
  | 'trusted_display_name'
  | 'planned_password_only'
  | 'phishing_email_deleted'
  | 'alert_dismissed'
  | 'scope_assumed'
  | 'blind_revoke'
  | 'isolated_without_evidence'
  | 'closed_without_verification';

export type ScoreBucket = 'evidence' | 'containment' | 'scope' | 'efficiency';

export const SCORE_BUCKET_MAX: Record<ScoreBucket, number> = {
  evidence: 30,
  containment: 35,
  scope: 20,
  efficiency: 15,
};

export type Ending = 'contained' | 'partial';

export type AssistantState =
  | 'idle'
  | 'analyzing'
  | 'needs-input'
  | 'warning'
  | 'success'
  | 'error';

export type AgentStatus = 'offline' | 'connected' | 'working';

export type SceneId = 'boot' | 'intro' | 'office' | 'transition' | 'dashboard' | 'debrief';

/**
 * The six primary destinations of the enterprise SOC shell
 * (docs/NODELESS_SOC_REDESIGN_2026-08-31.md §4). Six is a cap, not a target:
 * a seventh belongs inside one of these as a tool tab, not in the spine.
 *
 * `debrief` is a destination the console can *name* but not open until the
 * case closes, which is the point — an analyst can see the debrief exists and
 * see exactly what still has to happen before it unlocks.
 */
export type DashboardRoute =
  | 'command'
  | 'investigate'
  | 'evidence'
  | 'respond'
  | 'timeline'
  | 'debrief';

export const DASHBOARD_ROUTES: readonly DashboardRoute[] = [
  'command',
  'investigate',
  'evidence',
  'respond',
  'timeline',
  'debrief',
] as const;

/**
 * Investigation tool tabs inside the `investigate` destination.
 *
 * Only the sources Case 001 can actually feed. There is no Cloud/IAM tab
 * because the scenario has no service-health, workload, IAM or deployment
 * data, and §3 forbids showing the agent a source the simulation cannot
 * represent.
 */
export type InvestigateTab = 'siem' | 'identity' | 'endpoint' | 'network' | 'email';

export const INVESTIGATE_TABS: readonly InvestigateTab[] = [
  'siem',
  'identity',
  'endpoint',
  'network',
  'email',
] as const;

/* ------------------------------------------------------------------ *
 * Console-wide investigation state
 * ------------------------------------------------------------------ */

/**
 * The console's one time range.
 *
 * It lives here rather than inside the SIEM because a range that only one tool
 * obeys is worse than no range at all: an analyst who narrows the window and
 * then pivots to another source would be reading two different nights and have
 * nothing on screen to say so.
 *
 * Three options, not a picker. Hick's law applies to a control the operator
 * touches while under time pressure, and Case 001 spans a single night, so a
 * calendar would be chrome around one useful choice.
 */
export type TimeRangeId = 'last30' | 'night' | 'all';

export const TIME_RANGES: readonly TimeRangeId[] = ['last30', 'night', 'all'] as const;

/** What kind of thing the console is following across its tools. */
export type FocusKind = 'identity' | 'host' | 'indicator';

export const FOCUS_KINDS: readonly FocusKind[] = ['identity', 'host', 'indicator'] as const;

/**
 * The selection that survives a pivot.
 *
 * "Following an identity from SIEM to Identity to EDR must actually carry the
 * selection" — so the selection is console state, not a prop threaded through
 * five tools that each keep their own idea of what is selected.
 *
 * `value` is the raw technical identifier as the logs write it (`d.arslan`,
 * `WKS-114`, `203.0.113.47`), because that is what the rows carry and matching
 * on a display name would silently miss half of them.
 */
export interface InvestigationFocus {
  kind: FocusKind;
  value: string;
  /** Display label, for the focus chip. Falls back to `value` when absent. */
  label?: string;
}

/* ------------------------------------------------------------------ *
 * Static case content (fixtures)
 * ------------------------------------------------------------------ */

export type ArtifactKind =
  | 'email'
  | 'url'
  | 'signin_log'
  | 'session_record'
  | 'cookie_telemetry'
  | 'file_activity'
  | 'dlp_alert'
  | 'edr_report';

export interface ArtifactField {
  /** i18n key for the human label. */
  labelKey: string;
  /** Raw synthetic value. Rendered in mono type. Never localized. */
  value: string;
  /** Marks the field as the decisive tell for a learning goal. */
  decisive?: boolean;
  /** `bad` renders critical, `warn` amber, `good` success, undefined neutral. */
  tone?: 'bad' | 'warn' | 'good';
}

export interface Artifact {
  id: ArtifactId;
  kind: ArtifactKind;
  /** i18n key for the artifact title. */
  titleKey: string;
  /** Synthetic source system. */
  source: string;
  /** Simulated capture time, `HH:MM:SS` on the incident night. */
  timestamp: string;
  /**
   * True when the artifact body contains attacker-authored text.
   * Rendered inside an "untrusted content" shell and annotated for the agent.
   */
  untrusted: boolean;
  /** Structured, inspectable fields. */
  fields: ArtifactField[];
  /** i18n key: what an analyst should take away. Shown in the "explained" view. */
  explanationKey: string;
  /** Artifacts only visible once a prerequisite diagnostic has run. */
  revealedBy?: DiagnosticId;
  relatedIdentities?: IdentityId[];
  relatedAssets?: AssetId[];
}

export interface Identity {
  id: IdentityId;
  displayName: string;
  upn: string;
  roleKey: string;
  department: string;
  /** Initial risk. Live risk is derived from context. */
  baseRisk: 'critical' | 'elevated' | 'normal';
  /** Only surfaced after `indicator_scope`. */
  revealedBy?: DiagnosticId;
}

export interface Asset {
  id: AssetId;
  nameKey: string;
  kind: 'workstation' | 'file_service' | 'identity_provider';
  owner: IdentityId | null;
  baseStatus: 'affected' | 'watch' | 'healthy';
  revealedBy?: DiagnosticId;
}

export interface TimelineEvent {
  /** `HH:MM:SS` on the incident night. */
  at: string;
  /** i18n key for the event label. */
  labelKey: string;
  severity: 'info' | 'warn' | 'critical';
  /** Only appears on the timeline once this evidence exists. */
  requires?: { artifact?: ArtifactId; diagnostic?: DiagnosticId };
  artifactId?: ArtifactId;
}

export interface DecisionOption {
  id: DecisionOptionId;
  /** i18n key for the option label (verb-first). */
  labelKey: string;
  /** Deterministic teaching text shown after the choice. */
  explanationKey: string;
  correct: boolean;
  scoreDelta: ScoreEntryTemplate[];
  setsFlags?: FlagId[];
  /** Deterministic, non-SOC state effects (evidence visibility, identity status…). */
  stateEffects?: DecisionStateEffect[];
  /** Response actions this option recommends next (UI highlight + tool hint). */
  recommends?: ResponseActionId[];
}

export type DecisionStateEffect =
  | { kind: 'destroy_artifact'; artifactId: ArtifactId }
  | { kind: 'disable_identity'; identityId: IdentityId }
  | { kind: 'unlock_action'; actionId: ResponseActionId }
  | { kind: 'reveal_artifact'; artifactId: ArtifactId };

export interface Decision {
  id: DecisionId;
  /** i18n key for the decision prompt. */
  promptKey: string;
  /** i18n key for the learning goal shown in the debrief. */
  learningGoalKey: string;
  options: [DecisionOption, DecisionOption];
  /** Decision becomes answerable only when this predicate holds. */
  prerequisite: DecisionPrerequisite;
}

export interface DecisionPrerequisite {
  decisionsResolved?: DecisionId[];
  artifactsInspected?: ArtifactId[];
  diagnosticsRun?: DiagnosticId[];
}

export interface Diagnostic {
  id: DiagnosticId;
  titleKey: string;
  descriptionKey: string;
  /** i18n key for the deterministic narrative result summary. */
  resultKey: string;
  scoreDelta: ScoreEntryTemplate[];
  revealsArtifacts?: ArtifactId[];
  resolvesFindings?: FindingId[];
}

export interface ResponseAction {
  id: ResponseActionId;
  labelKey: string;
  /** Stated impact shown before confirmation. */
  impactKey: string;
  /** Deterministic result narration. */
  resultKey: string;
  destructive: boolean;
  /** Requires an explicit human/agent confirmation step in the UI. */
  requiresConfirmation: boolean;
  resolvesFindings?: FindingId[];
  scoreDelta: ScoreEntryTemplate[];
  /** Extra penalties applied when a precondition was skipped. */
  conditionalPenalties?: ConditionalPenalty[];
}

export interface ConditionalPenalty {
  /** Applied when the referenced prerequisite is missing at execution time. */
  whenMissing: { diagnostic?: DiagnosticId; artifact?: ArtifactId };
  entry: ScoreEntryTemplate;
  setsFlags?: FlagId[];
}

export interface Finding {
  id: FindingId;
  titleKey: string;
  /** Why leaving it open is dangerous — used in the partial-containment debrief. */
  consequenceKey: string;
  critical: boolean;
}

export interface Hint {
  topic: HintTopic;
  /** Ordered: the first hint whose predicate matches the live state is returned. */
  whenKey: string;
  textKey: string;
  predicate: HintPredicate;
}

export interface HintPredicate {
  artifactsMissing?: ArtifactId[];
  diagnosticsMissing?: DiagnosticId[];
  actionsMissing?: ResponseActionId[];
  decisionsUnresolved?: DecisionId[];
  flagsSet?: FlagId[];
  /** Always matches; use as the trailing fallback for a topic. */
  fallback?: boolean;
}

/* ------------------------------------------------------------------ *
 * Score
 * ------------------------------------------------------------------ */

export interface ScoreEntryTemplate {
  bucket: ScoreBucket;
  delta: number;
  /** i18n key explaining the entry in the debrief. */
  reasonKey: string;
}

export interface ScoreEntry extends ScoreEntryTemplate {
  /** What produced this entry. Makes the score fully auditable. */
  source: string;
  /** Monotonic sequence number of the command that produced it. */
  seq: number;
}

export interface ScoreBreakdown {
  buckets: Record<ScoreBucket, { earned: number; max: number }>;
  total: number;
  max: number;
  entries: ScoreEntry[];
}

/* ------------------------------------------------------------------ *
 * Runtime records
 * ------------------------------------------------------------------ */

export interface DecisionRecord {
  decisionId: DecisionId;
  optionId: DecisionOptionId;
  correct: boolean;
  /** Command sequence number at which the decision was submitted. */
  seq: number;
  /** Simulated incident clock, `HH:MM:SS`. */
  at: string;
}

export interface PerformedActionRecord {
  actionId: ResponseActionId;
  seq: number;
  at: string;
  /** `human` for a dashboard control, `agent` for a WebMCP tool call. */
  origin: CallOrigin;
}

export interface FindingRecord {
  id: FindingId;
  resolved: boolean;
  /** What resolved it, when resolved. */
  resolvedBy?: ResponseActionId | DiagnosticId;
}

export type CallOrigin = 'human' | 'agent';

export interface ToolLogEntry {
  seq: number;
  /** Wall-clock ms since the case opened — deterministic in tests via injected clock. */
  atMs: number;
  tool: CommandKind;
  origin: CallOrigin;
  ok: boolean;
  errorCode?: ToolErrorCode;
  fromVersion: number;
  toVersion: number;
  /** DOM id / region the call visibly affected, for the observability panel. */
  effectId?: string;
  /** Human-readable one-liner for the live activity feed. */
  summary: string;
}

/* ------------------------------------------------------------------ *
 * Commands, results and errors — the single seam shared by UI and WebMCP
 * ------------------------------------------------------------------ */

export type CommandKind =
  | 'get_incident'
  | 'inspect_artifact'
  | 'run_diagnostic'
  | 'take_response_action'
  | 'submit_decision'
  | 'request_hint'
  | 'present_guidance';

export const COMMAND_KINDS: readonly CommandKind[] = [
  'get_incident',
  'inspect_artifact',
  'run_diagnostic',
  'take_response_action',
  'submit_decision',
  'request_hint',
  'present_guidance',
] as const;

/**
 * Commands that can change what is visible or allowed, and therefore bump
 * `stateVersion`. `get_incident` and `request_hint` never do.
 *
 * `present_guidance` is deliberately absent. Narration is generated by a model,
 * and a model must never be able to move the domain: if narrating bumped
 * `stateVersion` it would invalidate an in-flight tool call, re-order the
 * agent's plan and — through the staleness gate — decide which actions are
 * reachable next. Guidance advances its own `narrativeSequence` instead.
 */
export const VERSION_BUMPING_COMMANDS: readonly CommandKind[] = [
  'inspect_artifact',
  'run_diagnostic',
  'take_response_action',
  'submit_decision',
] as const;

/**
 * Commands that require an `idempotencyKey` and are replayed on duplicate keys.
 *
 * `present_guidance` is here for a reason specific to speech: a retried line
 * must not be *said twice*. Re-speaking is the narration equivalent of applying
 * a containment action twice, and it is what a retry after a dropped connection
 * would otherwise produce.
 */
export const IDEMPOTENT_COMMANDS: readonly CommandKind[] = [
  'take_response_action',
  'submit_decision',
  'present_guidance',
] as const;

/**
 * Commands that carry a state version and are therefore staleness-checked.
 *
 * `present_guidance` supplies it as `basedOnStateVersion`: guidance written
 * about a state the player has already left is stale advice, and stale advice
 * from a teacher is worse than silence. See `suppliedStateVersion` in engine.ts.
 */
export const VERSIONED_COMMANDS: readonly CommandKind[] = [
  'inspect_artifact',
  'run_diagnostic',
  'take_response_action',
  'submit_decision',
  'request_hint',
  'present_guidance',
] as const;

/**
 * Commands annotated `readOnlyHint: true` for the agent.
 *
 * `present_guidance` is not read-only even though it cannot move the case: it
 * appends to `narrativeLog`, and claiming otherwise would tell the agent it can
 * call it speculatively without consequence.
 */
export const READ_ONLY_COMMANDS: readonly CommandKind[] = [
  'get_incident',
  'request_hint',
] as const;

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'STALE_STATE'
  | 'ACTION_NOT_ALLOWED'
  | 'NOT_FOUND';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  recovery?: string;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  stateVersion: number;
  data?: T;
  error?: ToolError;
}

export interface GetIncidentInput {
  _?: never;
}

export interface InspectArtifactInput {
  artifactId: string;
  stateVersion: number;
}

export interface RunDiagnosticInput {
  diagnosticId: DiagnosticId;
  stateVersion: number;
}

export interface TakeResponseActionInput {
  actionId: ResponseActionId;
  stateVersion: number;
  idempotencyKey: string;
}

export interface SubmitDecisionInput {
  decisionId: DecisionId;
  optionId: DecisionOptionId;
  stateVersion: number;
  idempotencyKey: string;
}

export interface RequestHintInput {
  topic: HintTopic;
  stateVersion: number;
}

/* ------------------------------------------------------------------ *
 * Live narration — the one dynamic surface
 * ------------------------------------------------------------------ */

export type GuidanceTone =
  | 'urgent'
  | 'calm'
  | 'teaching'
  | 'warning'
  | 'encouraging'
  | 'debrief';

export const GUIDANCE_TONES: readonly GuidanceTone[] = [
  'urgent',
  'calm',
  'teaching',
  'warning',
  'encouraging',
  'debrief',
] as const;

export type GuidanceLanguage = 'tr' | 'en';

export const GUIDANCE_LANGUAGES: readonly GuidanceLanguage[] = ['tr', 'en'] as const;

/** Hard ceiling on one narrated line. Enforced in the engine, not only in zod. */
export const GUIDANCE_MESSAGE_MAX = 500;

export interface PresentGuidanceInput {
  /** The domain `stateVersion` the line was written about. Staleness-checked. */
  basedOnStateVersion: number;
  idempotencyKey: string;
  tone: GuidanceTone;
  language: GuidanceLanguage;
  /** Plain text only. Never markup, never a link. */
  message: string;
  relatedArtifactId?: string;
  relatedDecisionId?: string;
}

/**
 * One accepted line of narration.
 *
 * Append-only, and part of the context rather than of React state so it
 * survives the office/dashboard round trip and is reconstructible by `replay()`
 * from the command log alone.
 */
export interface NarrativeEntry {
  /** Monotonic and wholly independent of `stateVersion`. */
  narrativeSequence: number;
  tone: GuidanceTone;
  language: GuidanceLanguage;
  /** Sanitised plain text. Never contains markup or a live URL. */
  message: string;
  relatedArtifactId?: string;
  relatedDecisionId?: string;
  /** The domain state version this line was written about. */
  basedOnStateVersion: number;
  /** Simulation clock at the moment it was spoken, `HH:MM:SS`. */
  at: string;
}

/**
 * The receipt returned to the model. Deliberately says out loud that nothing
 * moved, so an agent does not re-read the case looking for an effect.
 */
export interface GuidanceView extends NarrativeEntry {
  accepted: true;
  /** Unchanged by definition; repeated here so the agent need not infer it. */
  stateVersion: number;
  affectsScore: false;
  affectsState: false;
}

export type GameCommand =
  | { kind: 'get_incident'; input: GetIncidentInput; origin: CallOrigin }
  | { kind: 'inspect_artifact'; input: InspectArtifactInput; origin: CallOrigin }
  | { kind: 'run_diagnostic'; input: RunDiagnosticInput; origin: CallOrigin }
  | { kind: 'take_response_action'; input: TakeResponseActionInput; origin: CallOrigin }
  | { kind: 'submit_decision'; input: SubmitDecisionInput; origin: CallOrigin }
  | { kind: 'request_hint'; input: RequestHintInput; origin: CallOrigin }
  | { kind: 'present_guidance'; input: PresentGuidanceInput; origin: CallOrigin };

/* ------------------------------------------------------------------ *
 * Tool payloads (what the agent actually receives)
 * ------------------------------------------------------------------ */

export interface IncidentView {
  incidentId: string;
  caseId: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'contained' | 'closed';
  elapsed: string;
  knownFacts: string[];
  openQuestions: string[];
  unresolvedCriticalFindings: FindingId[];
  allowedNextActions: AllowedNextAction[];
  openDecision: OpenDecisionView | null;
  /**
   * Set when the next decision exists but its prerequisites are unmet. Without
   * this an agent sees `openDecision: null` and has no way to learn *why* the
   * case appears to have no next step.
   */
  blockedDecision: BlockedDecisionView | null;
  availableArtifacts: ArtifactId[];
  availableDiagnostics: DiagnosticId[];
  /**
   * The single step that unblocks the case, restated at the top level so the
   * result compactor can protect it by name. `null` only when the case is over.
   * Shape per docs/CODEX_WEBMCP_INTEGRATION.md §8.
   */
  requiredNextAction: AllowedNextAction | null;
  /**
   * Bounded domain facts a narrator needs in order to pitch a line correctly.
   * Everything here is derived from in-game behaviour; nothing is collected
   * about the person playing, and nothing describes the UI, camera or styling.
   */
  coaching: CoachingSnapshot;
}

/**
 * What the narrator is allowed to know.
 *
 * Every field is a bounded domain fact. There is no CSS, no camera state, no
 * DOM, no browser or user data — those are tested with screenshots, not shipped
 * to a model (docs/CODEX_WEBMCP_INTEGRATION.md §7).
 */
export interface CoachingSnapshot {
  /** Derived from decisions, mistakes and hint use in *this* run only. */
  level: PlayerLevel;
  /** Derived from the player's own in-game requests for explanation. */
  style: ExplanationStyle;
  /** Simulated seconds since the case opened. */
  elapsedSec: number;
  score: CompactScore;
  inspected: ArtifactId[];
  /** Artifacts that exist and are reachable but have not been looked at. */
  notInspected: ArtifactId[];
  diagnosticsRun: DiagnosticId[];
  /** Decisions and operations taken, whether each was right, and what followed. */
  moves: CoachingMove[];
  /** At most the last three narrated lines, each truncated. */
  recentNarration: string[];
}

export type PlayerLevel = 'novice' | 'developing' | 'confident';

/** How much explanation the player has asked for, in game. Never a profile. */
export type ExplanationStyle = 'guided' | 'direct';

export interface CoachingMove {
  /** Decision option id or response action id. */
  id: string;
  /** Undefined for operations, which are ordered rather than right or wrong. */
  correct?: boolean;
  /** One short clause naming the consequence the engine actually applied. */
  consequence: string;
}

export interface BlockedDecisionView {
  decisionId: DecisionId;
  prompt: string;
  /** Exactly what has to happen before this decision opens. */
  missing: {
    decisions: DecisionId[];
    artifacts: ArtifactId[];
    diagnostics: DiagnosticId[];
  };
}

export interface AllowedNextAction {
  kind: CommandKind;
  id: string;
  label: string;
  /** Why this is offered right now. */
  rationale: string;
}

export interface OpenDecisionView {
  decisionId: DecisionId;
  prompt: string;
  options: { optionId: DecisionOptionId; label: string }[];
}

export interface ArtifactView {
  artifactId: ArtifactId;
  kind: ArtifactKind;
  title: string;
  source: string;
  timestamp: string;
  untrusted: boolean;
  /** Present when `untrusted` — a literal warning the agent must not act on. */
  untrustedContentNotice?: string;
  fields: { label: string; value: string; decisive: boolean }[];
  analystNote: string;
}

export interface DiagnosticView {
  diagnosticId: DiagnosticId;
  title: string;
  summary: string;
  rows: DiagnosticRow[];
  revealedArtifacts: ArtifactId[];
  resolvedFindings: FindingId[];
  /** Exact before/after for every simulated source this diagnostic moved. */
  effects: OperationEffect[];
}

/* ------------------------------------------------------------------ *
 * Observable effects (redesign §6)
 * ------------------------------------------------------------------ */

/**
 * The simulated sources an operation can move.
 *
 * Named after the investigation tabs of redesign §4 so an effect can be routed
 * to the view that shows it without a second lookup table.
 */
export type SourceId = 'identity' | 'endpoint' | 'network' | 'scope' | 'incident';

export const SOURCE_IDS: readonly SourceId[] = [
  'identity',
  'endpoint',
  'network',
  'scope',
  'incident',
] as const;

/**
 * One fact about a simulated source, before and after an operation.
 *
 * Redesign §6: "an operation is not complete when only the score or a toast
 * changes… Codex must receive the exact structured before/after result so it
 * can explain what changed, what remains open and why the next step follows."
 *
 * These are *derived by diffing* two snapshots of `sourceSnapshot()`, never
 * hand-written per action. That is what stops a result from claiming an effect
 * the simulation did not actually apply — which is the whole point of decision
 * D3, where resetting a password must not be reported as revoking a token.
 */
export interface OperationEffect {
  source: SourceId;
  /** Stable identifier of the thing that changed, e.g. `SES-8842`. */
  key: string;
  before: string;
  after: string;
}

export interface DiagnosticRow {
  key: string;
  value: string;
  tone?: 'bad' | 'warn' | 'good';
}

export interface ResponseActionView {
  actionId: ResponseActionId;
  applied: boolean;
  result: string;
  impact: string;
  resolvedFindings: FindingId[];
  unresolvedCriticalFindings: FindingId[];
  /**
   * Exact before/after for every simulated source this operation moved.
   * Never empty: an operation with no observable effect is a bug, and
   * `sources.test.ts` asserts that for all five response actions.
   */
  effects: OperationEffect[];
  /**
   * Source facts still in a dangerous state *after* this operation, nearest
   * source first. This is the honest counterweight to `effects`: after
   * `reset_credentials` it names the still-valid replayed session, which is
   * exactly what an agent would otherwise assume the reset had killed.
   * Capped — the authoritative open list is `unresolvedCriticalFindings`.
   */
  stillOpen: string[];
  ending?: Ending;
  /**
   * Compact totals only. The full, auditable score log stays in the debrief UI:
   * an agent needs the outcome, not twenty ledger rows.
   */
  score?: CompactScore;
}

export interface CompactScore {
  total: number;
  max: number;
  buckets: Record<ScoreBucket, number>;
}

export interface DecisionResultView {
  decisionId: DecisionId;
  optionId: DecisionOptionId;
  correct: boolean;
  explanation: string;
  learningGoal: string;
  scoreDelta: { bucket: ScoreBucket; delta: number; reason: string }[];
  flagsSet: FlagId[];
  stateEffects: string[];
  nextDecision: OpenDecisionView | null;
  recommendedActions: ResponseActionId[];
}

export interface HintView {
  topic: HintTopic;
  hint: string;
  /** Hints never change score. Stated explicitly so the agent does not hesitate. */
  affectsScore: false;
}

/* ------------------------------------------------------------------ *
 * Machine context
 * ------------------------------------------------------------------ */

export interface StoredIdempotentResult {
  /** Serialized `ToolResult` returned verbatim on replay. */
  result: ToolResult;
  seq: number;
}

/** One issued command, kept so a run can be replayed from the same seed. */
export interface LoggedCommand {
  kind: CommandKind;
  input: unknown;
  origin: CallOrigin;
  /** Simulated incident clock when it was issued, in seconds. */
  atSec: number;
}

export interface GameContext {
  /** Incremented by exactly one on every successful *mutating* command. */
  stateVersion: number;
  /** Monotonic counter over every command, successful or not. */
  seq: number;
  operatorName: string;

  /** Simulated incident clock, in seconds since 00:00:00. */
  clockSec: number;
  /** Clock value when the dashboard opened; used for "elapsed". */
  caseOpenedAtSec: number;

  inspectedArtifacts: ArtifactId[];
  ranDiagnostics: DiagnosticId[];
  performedActions: PerformedActionRecord[];
  decisions: Partial<Record<DecisionId, DecisionRecord>>;
  destroyedArtifacts: ArtifactId[];
  disabledIdentities: IdentityId[];
  unlockedActions: ResponseActionId[];

  findings: FindingRecord[];
  flags: Partial<Record<FlagId, boolean>>;
  scoreEntries: ScoreEntry[];

  idempotency: Record<string, StoredIdempotentResult>;
  toolLog: ToolLogEntry[];
  /**
   * Append-only command history. `(createInitialContext, commandLog)` is the
   * whole seed of a run, which is what makes `replay()` and its test possible.
   * Pure reads are not recorded — they contribute nothing to reconstruct.
   */
  commandLog: LoggedCommand[];
  hintsRequested: number;
  /** Gates the wall-clock tick only. Never touches `stateVersion`. */
  paused: boolean;

  /**
   * Monotonic counter over accepted narration only, deliberately *not* tied to
   * `stateVersion`: the story can move without the case moving, and the case
   * can move without the story moving.
   *
   * Optional so `createInitialContext` need not change — a run that has never
   * narrated is `undefined`, which `narrativeSequenceOf()` reads as 0. Read it
   * through the accessors in `narrative.ts`, never directly.
   */
  narrativeSequence?: number;
  /**
   * Append-only log of every accepted guidance line. Sanitised plain text only.
   * Rebuilt exactly by `replay()` because `present_guidance` is recorded in
   * `commandLog` like every other non-read command.
   */
  narrativeLog?: NarrativeEntry[];

  caseClosed: boolean;
  ending: Ending | null;

  assistantState: AssistantState;
  agentStatus: AgentStatus;
  route: DashboardRoute;
  /** Which investigation tool is open inside the `investigate` destination. */
  investigateTab: InvestigateTab;
  /** Artifact currently open in the evidence inspector. */
  selectedArtifact: ArtifactId | null;
  /**
   * The console-wide time range. Every event-shaped view reads it; inventories
   * report it and correctly decline to filter on it (see `game/investigate.ts`).
   */
  timeRange: TimeRangeId;
  /** What the console is currently following across its tools. */
  focus: InvestigationFocus | null;

  /** Result of the most recent command; read back synchronously by the runtime. */
  lastResult: (ToolResult & { seq: number }) | null;
  /** Most recent diagnostic payload, for the dashboard to render. */
  lastDiagnostic: DiagnosticView | null;
  /** Most recent decision payload, for the learning rail. */
  lastDecision: DecisionResultView | null;
  /** Most recent hint, for the learning rail. */
  lastHint: HintView | null;
}
