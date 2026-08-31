import { t } from '../i18n';
import { RESPONSE_ACTION_BY_ID } from './fixtures/case001';
import { compactScore, computeScore } from './scoring';
import {
  allowedNextActions,
  availableArtifacts,
  blockedDecisionView,
  elapsedSeconds,
} from './selectors';
import {
  DECISION_IDS,
  GUIDANCE_MESSAGE_MAX,
  type AllowedNextAction,
  type ArtifactId,
  type CoachingMove,
  type CoachingSnapshot,
  type DiagnosticId,
  type ExplanationStyle,
  type GameContext,
  type NarrativeEntry,
  type PlayerLevel,
  type ToolError,
} from './types';

/**
 * Live narration — the *only* dynamic surface in CYCASE.
 *
 * The product split this file exists to enforce:
 *
 *   deterministic (engine)   valid actions, evidence relationships, state
 *                            progression, consequences, score, idempotency
 *   dynamic (a model)        the words a character says about all of that
 *
 * So nothing here reads or writes score, findings, decisions, containment or
 * `stateVersion`. It sanitises an untrusted string, appends it to an
 * append-only log, and derives a bounded read-only snapshot the narrator can
 * pitch against. If a future change makes this file able to move the case,
 * `guidance.test.ts`'s interleaved golden path fails — which is the point.
 */

/* ------------------------------------------------------------------ *
 * Log accessors
 *
 * `narrativeLog` and `narrativeSequence` are optional on the context so that
 * `createInitialContext` — owned by the deterministic core and edited by other
 * work in parallel — does not have to change. A run that has never narrated is
 * `undefined`, which reads here as an empty log at sequence 0.
 * ------------------------------------------------------------------ */

export function narrativeLogOf(ctx: GameContext): readonly NarrativeEntry[] {
  return ctx.narrativeLog ?? [];
}

export function narrativeSequenceOf(ctx: GameContext): number {
  return ctx.narrativeSequence ?? 0;
}

/**
 * Bounded so a long session cannot grow the context without limit. The tail is
 * what a narrator needs; the head is history nobody reads back.
 */
export const MAX_NARRATIVE_ENTRIES = 200;

export function appendNarrative(ctx: GameContext, entry: NarrativeEntry): NarrativeEntry[] {
  const next = [...narrativeLogOf(ctx), entry];
  return next.length > MAX_NARRATIVE_ENTRIES
    ? next.slice(next.length - MAX_NARRATIVE_ENTRIES)
    : next;
}

/* ------------------------------------------------------------------ *
 * Sanitisation
 * ------------------------------------------------------------------ */

/**
 * Characters that are invisible on screen but change what a reader — human or
 * model — sees: C0/C1 controls, the soft hyphen, zero-width spaces and joiners,
 * line/paragraph separators, the bidirectional overrides used to reverse
 * rendered text, the invisible-maths operators, and the BOM.
 *
 * These are *neutralised* rather than refused. They carry no meaning a player
 * could need, and refusing on them would throw away an otherwise good line over
 * a character the model very likely never intended to emit.
 */
const INVISIBLE =
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * `[label](target)` — the visible text and the destination can disagree.
 *
 * No space is allowed between `]` and `(`, and the target may not start with
 * one. CommonMark does not permit that space either, and allowing it here would
 * collide with the defanged-indicator syntax the case deliberately uses:
 * `sso-cycase-verify[.]net (registered two days before the incident)` is a line
 * the guidance channel should be able to say.
 */
const MARKDOWN_LINK = /\[[^\]]*\]\([^)\s]/;

/**
 * Schemes that execute rather than navigate.
 *
 * Word-bounded, so `metadata:` and `Formula:` are not caught. `data:` is a
 * separate rule below because the bare word appears constantly in this case —
 * "the DLP data:", "the sign-in data:" — and refusing those with a message
 * about web addresses would be both wrong and baffling.
 */
const DANGEROUS_SCHEME = /\b(?:javascript|vbscript)\s*:/i;

/**
 * A data URI, which needs a `type/subtype` after the colon. That is what
 * separates `data:image/svg+xml;base64,…` from "look at the DLP data: it was
 * blocked at 62%".
 */
const DATA_URI = /\bdata:[a-z0-9.+-]+\/[a-z0-9.+-]+/i;

/** A live web address of any kind. */
const WEB_URL = /https?:\/\//i;

export interface SanitisedGuidance {
  ok: true;
  message: string;
}

export interface RejectedGuidance {
  ok: false;
  error: ToolError;
}

type GuidanceMessageKey =
  | 'error.guidance.empty'
  | 'error.guidance.too_long'
  | 'error.guidance.markup'
  | 'error.guidance.link'
  | 'error.guidance.url';

type GuidanceRecoveryKey = `${GuidanceMessageKey}.recovery`;

/**
 * Turns an untrusted, model-authored line into storable plain text, or refuses.
 *
 * The model that wrote this string may itself have read the attacker-authored
 * evidence in the case, so the string is treated as hostile input regardless of
 * how the call was framed.
 *
 * Rejection versus neutralisation is decided on one question: *would a player
 * lose something they needed?*
 *
 *   neutralised  invisible characters and whitespace runs — a player cannot
 *                read them, so removing them removes nothing;
 *                attacker prose already defanged in the case data
 *                (`hxxps://sso-cycase-verify[.]net`) — guidance quoting the
 *                lure while teaching is exactly the behaviour we want, and it
 *                is inert text.
 *   refused      markup, markdown links, executable schemes, live web
 *                addresses, emptiness, over-length. Every one of those carries
 *                meaning, so stripping it would silently change what the line
 *                said. A refusal with recovery text lets the narrator rewrite
 *                it; a silent strip would ship a mutilated sentence to a player
 *                who has no way to know something was removed.
 *
 * Order is deliberate: the invisible characters go first, so a line of
 * zero-width spaces is judged as empty and a padded 500-character line is
 * judged on the characters that actually render.
 */
export function sanitiseGuidanceMessage(raw: string): SanitisedGuidance | RejectedGuidance {
  const message = raw.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

  if (message.length === 0) {
    return fail('error.guidance.empty');
  }
  if (message.length > GUIDANCE_MESSAGE_MAX) {
    return fail('error.guidance.too_long');
  }
  if (message.includes('<') || message.includes('>')) {
    return fail('error.guidance.markup');
  }
  if (MARKDOWN_LINK.test(message)) {
    return fail('error.guidance.link');
  }
  if (DANGEROUS_SCHEME.test(message) || DATA_URI.test(message) || WEB_URL.test(message)) {
    return fail('error.guidance.url');
  }

  return { ok: true, message };
}

function fail(key: GuidanceMessageKey): RejectedGuidance {
  return {
    ok: false,
    error: {
      code: 'INVALID_INPUT',
      message: t(key),
      recovery: t(`${key}.recovery` as GuidanceRecoveryKey),
    },
  };
}

/* ------------------------------------------------------------------ *
 * The bounded snapshot a narrator is allowed to see
 * ------------------------------------------------------------------ */

/**
 * How much scaffolding this player has asked for, measured only by what they
 * did in the case: hints requested, and decisions they got wrong.
 *
 * There is no profile, no persistence and no personal data — the value is a
 * pure function of this run's context and resets with the case.
 */
export function explanationStyle(ctx: GameContext): ExplanationStyle {
  const wrong = decisionRecords(ctx).filter((record) => !record.correct).length;
  return ctx.hintsRequested > 0 || wrong > 0 ? 'guided' : 'direct';
}

/**
 * A teaching level, not a ranking. It exists so the narrator can pitch an
 * explanation, and it is derived from behaviour in this run alone.
 */
export function playerLevel(ctx: GameContext): PlayerLevel {
  const records = decisionRecords(ctx);
  const wrong = records.filter((record) => !record.correct).length;

  if (wrong >= 2 || ctx.hintsRequested >= 3) return 'novice';
  if (records.length >= 3 && wrong === 0 && ctx.hintsRequested === 0) return 'confident';
  if (records.length === 0) return 'novice';
  return 'developing';
}

function decisionRecords(ctx: GameContext) {
  return DECISION_IDS.map((id) => ctx.decisions[id]).filter(
    (record): record is NonNullable<typeof record> => Boolean(record),
  );
}

/** Artifacts that exist and are reachable right now but have not been read. */
export function uninspectedArtifacts(ctx: GameContext): ArtifactId[] {
  return availableArtifacts(ctx)
    .map((artifact) => artifact.id)
    .filter((id) => !ctx.inspectedArtifacts.includes(id));
}

/**
 * The one step that unblocks the case.
 *
 * Prefers the open decision, then whichever read the blocked decision is
 * actually waiting on — never merely the first item in the list, which is
 * ordering accident rather than the load-bearing step.
 */
export function requiredNextAction(ctx: GameContext): AllowedNextAction | null {
  const list = allowedNextActions(ctx);
  if (list.length === 0) return null;

  const decision = list.find((action) => action.kind === 'submit_decision');
  if (decision) return decision;

  const blocked = blockedDecisionView(ctx);
  if (blocked) {
    const artifacts = new Set<string>(blocked.missing.artifacts);
    const diagnostics = new Set<string>(blocked.missing.diagnostics);
    const unblocking = list.find(
      (action) =>
        (action.kind === 'inspect_artifact' && artifacts.has(action.id)) ||
        (action.kind === 'run_diagnostic' && diagnostics.has(action.id)),
    );
    if (unblocking) return unblocking;
  }

  return list[0] ?? null;
}

/** How many narrated lines the snapshot carries, and how wide each may be. */
const RECAP_LINES = 3;
const RECAP_WIDTH = 72;
const ELLIPSIS = '…';

/**
 * Decisions and operations interleaved by the sequence numbers the engine
 * assigned, so "what did they do and what followed" reads as one history.
 */
function moves(ctx: GameContext): CoachingMove[] {
  const fromDecisions: (CoachingMove & { seq: number })[] = decisionRecords(ctx).map((record) => ({
    seq: record.seq,
    id: record.optionId,
    correct: record.correct,
    consequence: record.correct ? 'as taught' : 'weaker branch taken',
  }));

  const fromActions: (CoachingMove & { seq: number })[] = ctx.performedActions.map((record) => {
    const resolved = RESPONSE_ACTION_BY_ID.get(record.actionId)?.resolvesFindings ?? [];
    return {
      seq: record.seq,
      id: record.actionId,
      consequence: resolved.length > 0 ? `resolved ${resolved.join(', ')}` : 'applied',
    };
  });

  return [...fromDecisions, ...fromActions]
    .sort((a, b) => a.seq - b.seq)
    .map(({ seq: _seq, ...move }) => move);
}

/** At most the last three lines, each clipped. Speaker and tone, then the text. */
function recentNarration(ctx: GameContext): string[] {
  return narrativeLogOf(ctx)
    .slice(-RECAP_LINES)
    .map((entry) => {
      const line = `${entry.tone}: ${entry.message}`;
      return line.length <= RECAP_WIDTH ? line : `${line.slice(0, RECAP_WIDTH - 1)}${ELLIPSIS}`;
    });
}

export function buildCoachingSnapshot(ctx: GameContext): CoachingSnapshot {
  return {
    level: playerLevel(ctx),
    style: explanationStyle(ctx),
    elapsedSec: elapsedSeconds(ctx),
    score: compactScore(computeScore(ctx.scoreEntries)),
    inspected: [...ctx.inspectedArtifacts],
    notInspected: uninspectedArtifacts(ctx),
    diagnosticsRun: [...ctx.ranDiagnostics] as DiagnosticId[],
    moves: moves(ctx),
    recentNarration: recentNarration(ctx),
  };
}
