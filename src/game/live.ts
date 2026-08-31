import { tk } from '../i18n';
import {
  ARTIFACT_BY_ID,
  DECISION_BY_ID,
  DIAGNOSTIC_BY_ID,
  FINDINGS,
  RESPONSE_ACTION_BY_ID,
} from './fixtures/case001';
import { formatClock, visibleTimeline } from './selectors';
import type {
  ArtifactId,
  CallOrigin,
  CommandKind,
  DiagnosticId,
  GameContext,
  ResponseActionId,
} from './types';

/**
 * The live layer.
 *
 * `docs/VISUAL_RESET.md`: "Real-time is functional, not visual noise… every
 * value must be explainable from case state." So nothing here generates a
 * number. Every series is sampled from the incident's own profile at a bucket
 * index derived from the simulation clock, and every log row is a thing that
 * actually happened, timestamped with the clock it happened on.
 *
 * All of it is derived — no extra machine state, so it cannot drift from the
 * case and it cannot make an agent's `stateVersion` go stale.
 */

/* ------------------------------------------------------------------ *
 * Sampling
 * ------------------------------------------------------------------ */

/** One sample every 30 simulated seconds. */
export const SAMPLE_SECONDS = 30;
/** How many samples the sliding window shows. */
export const WINDOW_SAMPLES = 40;

export interface Sample {
  /** Simulated clock, in seconds since midnight. */
  atSec: number;
  label: string;
  baseline: number;
  anomaly: number;
}

/**
 * Background traffic. A slow diurnal drift, not noise: the same index always
 * produces the same number, so two runs at the same clock look identical.
 */
function baselineAt(index: number): number {
  const slow = Math.sin(index / 9.5) * 3.4;
  const slower = Math.cos(index / 23) * 2.1;
  return Math.max(4, Math.round(17 + slow + slower));
}

/**
 * Attacker activity, shaped by the incident chain and cut by containment.
 *
 * The profile is anchored to the incident's own timestamps: delivery at 02:41,
 * the replayed sign-in at 03:02, enumeration at 03:07, the blocked transfer at
 * 03:16. After `revoke_sessions` the curve collapses, and after
 * `isolate_endpoint` it reaches zero — which is the clearest "my call did
 * something" signal in the product.
 */
function anomalyAt(index: number, ctx: GameContext): number {
  const atSec = index * SAMPLE_SECONDS;
  const minutes = atSec / 60;

  const spike = (centreMinutes: number, width: number, height: number) => {
    const distance = (minutes - centreMinutes) / width;
    return height * Math.exp(-distance * distance);
  };

  let value =
    spike(161, 4, 6) + // phishing delivered / link opened
    spike(182, 3, 34) + // cookie replayed, sign-in succeeds
    spike(188, 4, 62) + // mass file enumeration
    spike(197, 3, 48); // blocked exfiltration attempt

  const revokedAt = containmentClock(ctx, 'revoke_sessions');
  const isolatedAt = containmentClock(ctx, 'isolate_endpoint');

  if (revokedAt !== null && atSec > revokedAt) value *= 0.12;
  if (isolatedAt !== null && atSec > isolatedAt) value = 0;

  return Math.max(0, Math.round(value));
}

/** Simulated clock at which a containment action was applied, if it was. */
function containmentClock(ctx: GameContext, actionId: ResponseActionId): number | null {
  const record = ctx.performedActions.find((action) => action.actionId === actionId);
  if (!record) return null;
  const [h = '0', m = '0', s = '0'] = record.at.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * The window of samples ending at the current simulation time. It advances
 * because `clockSec` advances — the chart is a view onto the case, not an
 * animation running beside it.
 */
export function eventWindow(ctx: GameContext): Sample[] {
  const latest = latestBucket(ctx);
  const first = Math.max(0, latest - WINDOW_SAMPLES + 1);

  const samples: Sample[] = [];
  for (let index = first; index <= latest; index += 1) {
    const atSec = index * SAMPLE_SECONDS;
    samples.push({
      atSec,
      label: formatClock(atSec).slice(0, 5),
      baseline: baselineAt(index),
      anomaly: anomalyAt(index, ctx),
    });
  }
  return samples;
}

/** Severity bands, derived from the same window rather than invented. */
export function severityWindow(ctx: GameContext): { label: string; points: number[] }[] {
  const window = eventWindow(ctx);
  return [
    { label: 'Critical', points: window.map((s) => Math.round(s.anomaly * 0.44)) },
    {
      label: 'High',
      points: window.map((s) => Math.round(s.anomaly * 0.3 + s.baseline * 0.14)),
    },
    { label: 'Medium', points: window.map((s) => Math.round(s.baseline * 0.5)) },
    { label: 'Low', points: window.map((s) => Math.round(s.baseline * 0.82)) },
  ];
}

/* ------------------------------------------------------------------ *
 * Egress
 * ------------------------------------------------------------------ */

export interface EgressSample {
  atSec: number;
  label: string;
  /** Bytes leaving for attacker infrastructure in this bucket. */
  bytes: number;
}

/**
 * Bytes on their way out, and the three different ways an operator stops them.
 *
 * Redesign §6 names the egress timeline as the view `block_indicator` must
 * move, and it is the only view where all three containment operations are
 * visibly *different* rather than interchangeable:
 *
 *   - `block_indicator` denies the destination at the proxy, so nothing reaches
 *     the attacker from anywhere on the network — this one goes to zero;
 *   - `revoke_sessions` kills the stolen session, which ends the bulk file
 *     transfer but not the extension's own beaconing from the host;
 *   - `isolate_endpoint` takes the host off the network, which ends the
 *     beaconing but would not have stopped a second host.
 *
 * Isolating the endpoint on its own therefore leaves bytes moving, and that is
 * modelled rather than overlooked. The attacker is not operating from WKS-114:
 * they replayed the cookie onto `fp_9c2a41e0`, their own unregistered device,
 * and pulling the user's laptop off the network does not reach it. An analyst
 * who isolates and stops there has cut the beacon and left the exfiltration
 * running, which is one of the more useful things this chart can show them.
 *
 * The sustained beacon term is what makes any of it observable. Without it the
 * profile has decayed to nothing by the time the operator is awake, and a
 * containment action would be cutting a curve that was already zero.
 */
function egressAt(index: number, ctx: GameContext): number {
  const atSec = index * SAMPLE_SECONDS;
  const minutes = atSec / 60;

  const spike = (centreMinutes: number, width: number, height: number) => {
    const distance = (minutes - centreMinutes) / width;
    return height * Math.exp(-distance * distance);
  };

  // Bulk transfer, carried by the stolen session.
  let sessionBacked = spike(188, 4, 41_000) + spike(197, 3, 96_000);
  // The extension posting its cookie jar, once it is installed at 02:44:51.
  let beacon = minutes >= 165 ? 2_600 : 0;

  const revokedAt = containmentClock(ctx, 'revoke_sessions');
  const isolatedAt = containmentClock(ctx, 'isolate_endpoint');
  const blockedAt = containmentClock(ctx, 'block_indicator');

  if (revokedAt !== null && atSec > revokedAt) sessionBacked = 0;
  if (isolatedAt !== null && atSec > isolatedAt) beacon = 0;
  if (blockedAt !== null && atSec > blockedAt) {
    sessionBacked = 0;
    beacon = 0;
  }

  return Math.max(0, Math.round(sessionBacked + beacon));
}

/** The egress window, sharing the event window's buckets so the two charts line up. */
export function egressTimeline(ctx: GameContext): EgressSample[] {
  const latest = latestBucket(ctx);
  const first = Math.max(0, latest - WINDOW_SAMPLES + 1);

  const samples: EgressSample[] = [];
  for (let index = first; index <= latest; index += 1) {
    const atSec = index * SAMPLE_SECONDS;
    samples.push({
      atSec,
      label: formatClock(atSec).slice(0, 5),
      bytes: egressAt(index, ctx),
    });
  }
  return samples;
}

/** Bytes leaving right now, for the headline readout beside the egress chart. */
export function currentEgress(ctx: GameContext): number {
  const window = egressTimeline(ctx);
  return window[window.length - 1]?.bytes ?? 0;
}

/**
 * Current events-per-minute, for the headline readout.
 *
 * Reads the newest bucket directly rather than building a forty-sample window
 * and taking its last element. Same numbers — `eventWindow` fills from the same
 * two functions — and `tests/unit/live.test.ts` pins that equivalence, so this
 * cannot drift into a second opinion about the same reading.
 */
export function currentRate(ctx: GameContext): { total: number; anomalous: number } {
  const index = latestBucket(ctx);
  const anomalous = anomalyAt(index, ctx);
  return { total: baselineAt(index) + anomalous, anomalous };
}

/* ------------------------------------------------------------------ *
 * The live edge
 * ------------------------------------------------------------------ */

/** The bucket the simulation clock is currently inside. */
export function latestBucket(ctx: GameContext): number {
  return Math.floor(ctx.clockSec / SAMPLE_SECONDS);
}

/**
 * What the stream is doing *right now*, as opposed to what it has recorded.
 *
 * This exists to make one distinction impossible to blur, because blurring it
 * is the usual way a dashboard starts lying: **the readouts move every second,
 * the data does not.** `ageSec` and `nextInSec` are a pure function of
 * `clockSec`, which the tick advances three times a second of play, so they
 * count while you watch. `bucket` — and therefore every number in the chart —
 * changes only when the clock crosses a multiple of `SAMPLE_SECONDS`. Nothing
 * here invents a value, jitters a curve or interpolates between samples.
 *
 * Two consequences worth stating, because both are requirements rather than
 * side effects:
 *
 * - **Pause freezes it for real.** `SET_PAUSED` stops the tick, `clockSec`
 *   stops, and so does every field below including the age. There is no second
 *   timer and no wall clock anywhere in the stream, so there is nothing left
 *   running behind a hidden view to jump forward on resume.
 * - **`bucket` is a render key.** A component that keys the landing animation
 *   on it animates exactly when a sample lands, never on a re-render and never
 *   while paused.
 *
 * The sample is a *rate reading*, not a running count — `baselineAt`/`anomalyAt`
 * sample the incident profile, and the topbar reads them as `n/min`. So the
 * active sample carries its full value the moment it lands; it is marked
 * because it is the newest, not because it is half-finished.
 */
export interface StreamPulse {
  /** Index of the newest sample. Changes only on a bucket boundary. */
  bucket: number;
  /** Simulated clock the newest sample was taken on. */
  atSec: number;
  at: string;
  /** Simulated seconds since it landed: 0 … SAMPLE_SECONDS - 1. */
  ageSec: number;
  /** Simulated seconds until the next one lands: 1 … SAMPLE_SECONDS. */
  nextInSec: number;
  /** The newest sample's own values. */
  total: number;
  anomalous: number;
  /** Bucket width, carried so a caption never hard-codes it. */
  bucketSeconds: number;
  /** True while the operator has the feed paused. */
  frozen: boolean;
}

export function streamPulse(ctx: GameContext): StreamPulse {
  const bucket = latestBucket(ctx);
  const atSec = bucket * SAMPLE_SECONDS;
  const ageSec = Math.max(0, ctx.clockSec - atSec);
  const anomalous = anomalyAt(bucket, ctx);

  return {
    bucket,
    atSec,
    at: formatClock(atSec),
    ageSec,
    nextInSec: Math.max(1, SAMPLE_SECONDS - ageSec),
    total: baselineAt(bucket) + anomalous,
    anomalous,
    bucketSeconds: SAMPLE_SECONDS,
    frozen: ctx.paused,
  };
}

/* ------------------------------------------------------------------ *
 * Append-only case log
 * ------------------------------------------------------------------ */

export type CaseLogKind =
  | 'incident'
  | 'evidence'
  | 'diagnostic'
  | 'decision'
  | 'action'
  | 'finding';

export interface CaseLogEntry {
  id: string;
  atSec: number;
  at: string;
  kind: CaseLogKind;
  text: string;
  severity: 'info' | 'warn' | 'critical' | 'good';
  /**
   * Who caused this row: the operator at the console, the agent through a
   * WebMCP tool, or the simulation itself.
   *
   * Redesign §6 asks each operation for "an attributable timeline entry", and
   * §4 wants "alert, human, agent and system events in one attributable
   * chronology". `PerformedActionRecord` and `ToolLogEntry` have carried the
   * origin all along; the chronology was the one place it got dropped, so a
   * reader could not tell their own containment call from the agent's.
   */
  origin: CallOrigin | 'system';
}

function toSeconds(clock: string): number {
  const [h = '0', m = '0', s = '0'] = clock.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * Every event of the run, in the order it happened, timestamped on the
 * simulation clock. Derived from context rather than stored, so it can never
 * disagree with the case it is reporting.
 */
export function caseLog(ctx: GameContext): CaseLogEntry[] {
  const entries: CaseLogEntry[] = [
    {
      id: 'open',
      atSec: ctx.caseOpenedAtSec,
      at: formatClock(ctx.caseOpenedAtSec),
      kind: 'incident',
      text: `${'INC-74219'} raised — possible data exfiltration, one identity named`,
      severity: 'critical',
      origin: 'system',
    },
  ];

  // Tool log carries the order; context carries the meaning.
  for (const entry of ctx.toolLog) {
    const atSec = ctx.caseOpenedAtSec + Math.round(entry.atMs / 1000);
    const base = {
      atSec,
      at: formatClock(atSec),
      id: `t${entry.seq}`,
      origin: entry.origin,
    };

    if (!entry.ok) {
      entries.push({
        ...base,
        kind: 'action',
        severity: 'warn',
        text: `${entry.tool} rejected — ${entry.errorCode}`,
      });
      continue;
    }

    const id = entry.effectId ?? '';
    if (entry.tool === 'inspect_artifact' && id.startsWith('evidence-')) {
      const artifactId = id.slice('evidence-'.length) as ArtifactId;
      const artifact = ARTIFACT_BY_ID.get(artifactId);
      if (!artifact) continue;
      entries.push({
        ...base,
        kind: 'evidence',
        severity: artifact.untrusted ? 'warn' : 'info',
        text: `Evidence read — ${tk(artifact.titleKey)}`,
      });
    } else if (entry.tool === 'run_diagnostic' && id.startsWith('diagnostic-')) {
      const diagnosticId = id.slice('diagnostic-'.length) as DiagnosticId;
      const diagnostic = DIAGNOSTIC_BY_ID.get(diagnosticId);
      if (!diagnostic) continue;
      entries.push({
        ...base,
        kind: 'diagnostic',
        severity: 'info',
        text: `Diagnostic complete — ${tk(diagnostic.titleKey)}`,
      });
    } else if (entry.tool === 'take_response_action' && id.startsWith('action-')) {
      const actionId = id.slice('action-'.length) as ResponseActionId;
      const action = RESPONSE_ACTION_BY_ID.get(actionId);
      if (!action) continue;
      entries.push({
        ...base,
        kind: 'action',
        severity: 'good',
        text: `Response applied — ${tk(action.labelKey)}`,
      });

      for (const findingId of action.resolvesFindings ?? []) {
        const finding = FINDINGS.find((item) => item.id === findingId);
        if (!finding) continue;
        entries.push({
          ...base,
          id: `${base.id}-${findingId}`,
          kind: 'finding',
          severity: 'good',
          text: `Finding resolved — ${tk(finding.titleKey)}`,
        });
      }
    } else if (entry.tool === 'submit_decision' && id.startsWith('decision-')) {
      const decisionId = id.slice('decision-'.length);
      const record = ctx.decisions[decisionId as keyof typeof ctx.decisions];
      const decision = DECISION_BY_ID.get(decisionId as never);
      const option = decision?.options.find((o) => o.id === record?.optionId);
      if (!option) continue;
      entries.push({
        ...base,
        kind: 'decision',
        severity: option.correct ? 'info' : 'warn',
        text: `${decisionId} — ${tk(option.labelKey)}`,
      });
    }
  }

  return entries.sort((a, b) => a.atSec - b.atSec || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ *
 * The one attributable chronology
 * ------------------------------------------------------------------ *
 *
 * §4 asks the Timeline destination for "alert, human, agent and system events
 * in one attributable chronology". Two halves already existed and were never
 * joined: `visibleTimeline` holds what the attacker and the estate did, and
 * `caseLog` holds what the operator and the agent did about it. Read apart,
 * neither answers the question a debrief actually asks — *what did we know, and
 * when did we act on it?*
 *
 * So they are merged here, on one clock, each row carrying who caused it.
 */

export type ChronologyKind = CaseLogKind | 'attack';

export interface ChronologyEntry {
  id: string;
  atSec: number;
  at: string;
  kind: ChronologyKind;
  text: string;
  severity: 'info' | 'warn' | 'critical' | 'good';
  /** Who caused this row. The column the two halves could not previously share. */
  origin: CallOrigin | 'system';
  /** Present on incident-chain rows that have a record behind them. */
  artifactId?: ArtifactId;
}

/**
 * The merged chronology, oldest first.
 *
 * `caseLog`'s synthetic `open` row is dropped: the incident chain already ends
 * with `timeline.alert_raised` at the same second, and printing both would make
 * the alert look like it fired twice.
 */
export function chronology(ctx: GameContext): ChronologyEntry[] {
  const incident: ChronologyEntry[] = visibleTimeline(ctx).map((event) => ({
    id: `tl-${event.at}-${event.labelKey}`,
    atSec: toSeconds(event.at),
    at: event.at,
    // Everything on the incident chain is something the estate observed
    // happening to it, not something this console did.
    kind: 'attack' as const,
    text: tk(event.labelKey),
    severity: event.severity,
    origin: 'system' as const,
    ...(event.artifactId ? { artifactId: event.artifactId } : {}),
  }));

  const activity = caseLog(ctx).filter((entry) => entry.id !== 'open');

  return [...incident, ...activity].sort(
    (a, b) => a.atSec - b.atSec || a.id.localeCompare(b.id),
  );
}

/** How the chronology can be narrowed. Four options — one more is a menu. */
export type ChronologyOrigin = 'all' | CallOrigin | 'system';

export const CHRONOLOGY_ORIGINS: readonly ChronologyOrigin[] = [
  'all',
  'system',
  'human',
  'agent',
] as const;

export function filterChronology(
  entries: readonly ChronologyEntry[],
  origin: ChronologyOrigin,
): ChronologyEntry[] {
  return origin === 'all' ? [...entries] : entries.filter((entry) => entry.origin === origin);
}

/** How many rows each origin holds, so a filter can say what it would show. */
export function chronologyCounts(
  entries: readonly ChronologyEntry[],
): Record<ChronologyOrigin, number> {
  return {
    all: entries.length,
    system: entries.filter((entry) => entry.origin === 'system').length,
    human: entries.filter((entry) => entry.origin === 'human').length,
    agent: entries.filter((entry) => entry.origin === 'agent').length,
  };
}

/* ------------------------------------------------------------------ *
 * Connection health
 * ------------------------------------------------------------------ */

export interface FeedHealth {
  /** Simulated clock of the most recent case event. */
  lastEventAtSec: number;
  lastEventAt: string;
  /** How stale that is, in simulated seconds. */
  ageSec: number;
  /** Most recent agent tool call, if any. */
  lastAgentAtSec: number | null;
  lastAgentAt: string | null;
  agentAgeSec: number | null;
}

export function feedHealth(ctx: GameContext): FeedHealth {
  const log = caseLog(ctx);
  const lastEventAtSec = log[log.length - 1]?.atSec ?? ctx.caseOpenedAtSec;

  const agentEntries = ctx.toolLog.filter((entry) => entry.origin === 'agent');
  const lastAgent = agentEntries[agentEntries.length - 1];
  const lastAgentAtSec = lastAgent
    ? ctx.caseOpenedAtSec + Math.round(lastAgent.atMs / 1000)
    : null;

  return {
    lastEventAtSec,
    lastEventAt: formatClock(lastEventAtSec),
    ageSec: Math.max(0, ctx.clockSec - lastEventAtSec),
    lastAgentAtSec,
    lastAgentAt: lastAgentAtSec === null ? null : formatClock(lastAgentAtSec),
    agentAgeSec: lastAgentAtSec === null ? null : Math.max(0, ctx.clockSec - lastAgentAtSec),
  };
}

/** "12s ago" / "4m 20s ago" — short enough for a status line. */
export function formatAge(seconds: number): string {
  if (seconds <= 0) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${String(rest).padStart(2, '0')}s ago`;
}

export { toSeconds };

/* ------------------------------------------------------------------ *
 * The two clocks (audit contract P0.6)
 * ------------------------------------------------------------------ *
 *
 * The audit found one clock doing two incompatible jobs: it counted real
 * seconds *and* absorbed the engine's per-command clock cost, so a player who
 * pressed one button appeared to have spent forty-five seconds at the desk.
 * That is the "disguise command-cost jumps as real time" the contract forbids.
 *
 * The split is honest and arithmetically exact:
 *
 *   incident elapsed = play elapsed x 3 + operation cost
 *
 * `clockSec` remains the single source of truth and stays the *incident*
 * clock, so the case log, the telemetry window and the staleness readout all
 * keep agreeing with it. The tick contributes three incident seconds per real
 * second (`INCIDENT_SECONDS_PER_PLAY_SECOND`, applied where the interval is
 * dispatched), and each command adds its own documented cost on top. Real play
 * time is therefore recoverable by removing the operation cost and dividing by
 * the multiplier — no second timer, nothing to drift.
 */

/**
 * Simulated incident seconds per real second of play, while the case is
 * running and not paused. Documented in the UI next to the incident clock: a
 * player must never have to guess why the incident clock outruns their own.
 */
export const INCIDENT_SECONDS_PER_PLAY_SECOND = 3;

/**
 * Mirror of the engine's private `COMMAND_CLOCK_COST`.
 *
 * The engine owns the table and must not be edited from here, so this copy is
 * pinned against the engine's real behaviour by `tests/unit/live.test.ts`: if
 * a cost ever changes, that test fails rather than the clocks quietly lying.
 */
export const COMMAND_INCIDENT_COST: Record<CommandKind, number> = {
  get_incident: 0,
  request_hint: 0,
  inspect_artifact: 20,
  run_diagnostic: 45,
  submit_decision: 15,
  take_response_action: 30,
  // Narration costs no incident time: a line the agent speaks is not an action
  // the operator took, and charging the clock for it would let the story change
  // the score.
  present_guidance: 0,
};

/**
 * Incident seconds charged by the operations actually issued in this run.
 *
 * Derived from the append-only command log, which records exactly the commands
 * the engine charged for: pure reads are never logged, rejected calls never
 * reach the commit step, and an idempotent replay returns before it.
 */
export function operationCostSeconds(ctx: GameContext): number {
  return ctx.commandLog.reduce((total, entry) => total + COMMAND_INCIDENT_COST[entry.kind], 0);
}

/** Simulated incident seconds since the case opened. */
export function incidentSeconds(ctx: GameContext): number {
  return Math.max(0, ctx.clockSec - ctx.caseOpenedAtSec);
}

/**
 * Real seconds the player has spent playing. Exact rather than rounded: the
 * tick only ever adds whole multiples of the multiplier, so removing the
 * operation cost leaves a value the multiplier divides evenly.
 */
export function playSeconds(ctx: GameContext): number {
  const ticked = incidentSeconds(ctx) - operationCostSeconds(ctx);
  return Math.max(0, Math.floor(ticked / INCIDENT_SECONDS_PER_PLAY_SECOND));
}

export interface ClockReadout {
  /** Real seconds at the desk. */
  playSec: number;
  /** Simulated incident seconds since the case opened. */
  incidentSec: number;
  /** How much of the incident clock came from issued operations. */
  operationCostSec: number;
  multiplier: number;
}

export function clocks(ctx: GameContext): ClockReadout {
  return {
    playSec: playSeconds(ctx),
    incidentSec: incidentSeconds(ctx),
    operationCostSec: operationCostSeconds(ctx),
    multiplier: INCIDENT_SECONDS_PER_PLAY_SECOND,
  };
}
