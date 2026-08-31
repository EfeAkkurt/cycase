import type { StringKey } from '../i18n';
import { tk } from '../i18n';
import {
  ARTIFACT_BY_ID,
  BLOCKED_INDICATOR_VALUES,
  CONNECTION_RECORDS,
  DIAGNOSTIC_ROWS,
  EGRESS_RECORDS,
  EXTENSION_RECORDS,
  INDICATOR_RECORDS,
  MESSAGE_TRACE_RECORDS,
  SESSION_RECORDS,
} from './fixtures/case001';
import {
  artifactAvailability,
  assetStatus,
  formatClock,
  hasPerformed,
  visibleAssets,
  visibleIdentities,
  visibleTimeline,
  type AssetStatus,
} from './selectors';
import type {
  Artifact,
  ArtifactField,
  ArtifactId,
  AssetId,
  DiagnosticId,
  GameContext,
  IdentityId,
  InvestigateTab,
  InvestigationFocus,
  TimeRangeId,
  TimelineEvent,
} from './types';
import { INVESTIGATE_TABS, TIME_RANGES } from './types';

/**
 * The investigation layer.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §4 asks for the tools a senior
 * analyst actually pivots between — SIEM, identity, endpoint, network, mail —
 * rather than one dashboard that pretends to show everything. This module is
 * the honest half of that: it turns Case 001's fixtures into the shapes those
 * tools display, and it obeys two rules absolutely.
 *
 * **Nothing is invented.** Every value returned here comes from an artifact
 * field, a diagnostic row or a structured record in `fixtures/case001.ts`. The
 * scenario has no DNS query log, no process tree, no file hash and no cloud
 * control-plane, so this module exposes none of those — §3 forbids showing the
 * agent a source the simulation cannot represent, and a plausible-looking empty
 * table is exactly that.
 *
 * **Nothing is stale.** A response action has to change the view that action is
 * about (§6, §10). The fixtures state the world as the alert found it —
 * `art_session_001` says `ACTIVE`, `art_edr_001` says "not isolated" — so every
 * function here layers live state from context over those base facts. Rendering
 * the fixture string directly is the bug this module exists to prevent.
 *
 * It is pure and derived. No state of its own, so it cannot drift from the case.
 */

/* ------------------------------------------------------------------ *
 * Source gating — the one place evidence visibility is decided
 * ------------------------------------------------------------------ */

/**
 * How much of a log source the operator has actually earned.
 *
 * `uncollected` is the state that makes these tools a *pivot* surface rather
 * than a spoiler: the tool knows the source exists and says so, but the values
 * arrive only once the artifact has been inspected, exactly as the evidence
 * inspector and `visibleTimeline` already require.
 */
export type SourceState = 'ready' | 'uncollected' | 'locked' | 'destroyed';

export interface SourceRecord {
  artifactId: ArtifactId;
  state: SourceState;
  /** The diagnostic that unlocks it, while `state` is `locked`. */
  unlockedBy: DiagnosticId | null;
  titleKey: string;
  source: string;
  timestamp: string;
  /** True when the body was written by the attacker and must be shelled. */
  untrusted: boolean;
  /** Empty unless `state === 'ready'`. The single choke point for raw values. */
  fields: ArtifactField[];
}

export function sourceRecord(ctx: GameContext, artifactId: ArtifactId): SourceRecord {
  const artifact = ARTIFACT_BY_ID.get(artifactId) as Artifact | undefined;
  const availability = artifactAvailability(ctx, artifactId);
  const inspected = ctx.inspectedArtifacts.includes(artifactId);

  const state: SourceState =
    availability === 'destroyed'
      ? 'destroyed'
      : availability === 'locked'
        ? 'locked'
        : inspected
          ? 'ready'
          : 'uncollected';

  return {
    artifactId,
    state,
    unlockedBy: state === 'locked' ? (artifact?.revealedBy ?? null) : null,
    titleKey: artifact?.titleKey ?? artifactId,
    source: artifact?.source ?? '',
    timestamp: artifact?.timestamp ?? '',
    untrusted: artifact?.untrusted ?? false,
    fields: state === 'ready' ? (artifact?.fields ?? []) : [],
  };
}

/** One field of a source, or null when the source has not been collected. */
export function sourceField(record: SourceRecord, labelKey: string): string | null {
  return record.fields.find((field) => field.labelKey === labelKey)?.value ?? null;
}

function diagnosticRan(ctx: GameContext, id: DiagnosticId): boolean {
  return ctx.ranDiagnostics.includes(id);
}

/** Whether a record's single prerequisite is met. */
function requirementMet(
  ctx: GameContext,
  requires: { artifact?: ArtifactId; diagnostic?: DiagnosticId },
): boolean {
  if (requires.artifact && !ctx.inspectedArtifacts.includes(requires.artifact)) return false;
  if (requires.diagnostic && !diagnosticRan(ctx, requires.diagnostic)) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * SIEM
 * ------------------------------------------------------------------ */

export type SiemSourceType =
  | 'identity'
  | 'email'
  | 'proxy'
  | 'endpoint'
  | 'file'
  | 'dlp'
  | 'incident'
  | 'response';

export const SIEM_SOURCE_TYPES: readonly SiemSourceType[] = [
  'identity',
  'email',
  'proxy',
  'endpoint',
  'file',
  'dlp',
  'incident',
  'response',
] as const;

export interface SiemEvent {
  id: string;
  /** `HH:MM:SS` on the incident clock. */
  at: string;
  atSec: number;
  sourceType: SiemSourceType;
  /** The synthetic system that emitted it. */
  source: string;
  severity: 'info' | 'warn' | 'critical';
  message: string;
  user?: string;
  host?: string;
  indicator?: string;
  artifactId?: ArtifactId;
}

/**
 * How each event of the incident chain looks to a log aggregator.
 *
 * Keyed by the timeline's own label key so the two can never describe
 * different events, and deliberately *not* a second copy of the chain: the
 * rows this produces exist only for timeline entries `visibleTimeline` already
 * allows, which is what keeps an uncollected sign-in out of the search results.
 */
const SIEM_META: Record<
  string,
  {
    sourceType: SiemSourceType;
    source: string;
    user?: string;
    host?: string;
    indicator?: string;
  }
> = {
  'timeline.legit_signin': {
    sourceType: 'identity',
    source: 'IDP-01 / sign-in logs',
    user: 'd.arslan@cy-case.corp',
    host: 'WKS-114',
  },
  'timeline.phish_delivered': {
    sourceType: 'email',
    source: 'Mail Gateway / MG-EU-1',
    user: 'd.arslan@cy-case.corp',
    indicator: 'cy-case-secure-id.net',
  },
  'timeline.phish_clicked': {
    sourceType: 'proxy',
    source: 'Web Proxy / PXY-02',
    user: 'd.arslan@cy-case.corp',
    host: 'WKS-114',
    indicator: 'sso-cycase-verify[.]net',
  },
  'timeline.extension_installed': {
    sourceType: 'endpoint',
    source: 'EDR / WKS-114',
    user: 'd.arslan@cy-case.corp',
    host: 'WKS-114',
  },
  'timeline.cookie_replayed': {
    sourceType: 'identity',
    source: 'IDP-01 / token telemetry',
    user: 'd.arslan@cy-case.corp',
    indicator: 'fp_9c2a41e0',
  },
  'timeline.anomalous_signin': {
    sourceType: 'identity',
    source: 'IDP-01 / sign-in logs',
    user: 'd.arslan@cy-case.corp',
    indicator: '203.0.113.47',
  },
  'timeline.file_enumeration': {
    sourceType: 'file',
    source: 'SRV-FILES-02 / activity log',
    user: 'd.arslan@cy-case.corp',
    host: 'SRV-FILES-02',
  },
  'timeline.exfil_attempt': {
    sourceType: 'dlp',
    source: 'DLP / egress inspection',
    user: 'd.arslan@cy-case.corp',
    host: 'SRV-FILES-02',
    indicator: '203.0.113.47',
  },
  'timeline.alert_raised': {
    sourceType: 'incident',
    source: 'CYCASE / case queue',
  },
};

function toSeconds(clock: string): number {
  const [h = '0', m = '0', s = '0'] = clock.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * The raw event table.
 *
 * Incident telemetry the operator can see, plus the operations the operator
 * performed — which belong here because a real SIEM ingests the response
 * platform too, and because it is how "I revoked the session" becomes visible
 * in the same table that showed the session being stolen.
 */
export function siemEvents(ctx: GameContext): SiemEvent[] {
  const events: SiemEvent[] = visibleTimeline(ctx).map((event: TimelineEvent) => {
    const meta = SIEM_META[event.labelKey] ?? {
      sourceType: 'incident' as const,
      source: 'CYCASE',
    };

    // The indicator is the one enrichment that has to be earned. A timeline
    // entry can be visible — "outbound transfer blocked" is in the opening
    // brief — while the address behind it still sits unread inside an artifact.
    // Printing it in the search index would hand over the pivot the case wants
    // the analyst to go and collect.
    const collected = event.artifactId
      ? ctx.inspectedArtifacts.includes(event.artifactId)
      : true;

    return {
      id: `tl-${event.at}-${event.labelKey}`,
      at: event.at,
      atSec: toSeconds(event.at),
      sourceType: meta.sourceType,
      source: meta.source,
      severity: event.severity,
      message: tk(event.labelKey),
      user: meta.user,
      host: meta.host,
      indicator: collected ? meta.indicator : undefined,
      artifactId: event.artifactId,
    };
  });

  for (const performed of ctx.performedActions) {
    events.push({
      id: `op-${performed.seq}`,
      at: performed.at,
      atSec: toSeconds(performed.at),
      sourceType: 'response',
      source: 'CYCASE / response console',
      severity: 'info',
      message: tk(`action.${performed.actionId}.result`),
      user: performed.actionId === 'isolate_endpoint' ? undefined : 'd.arslan@cy-case.corp',
      host: performed.actionId === 'isolate_endpoint' ? 'WKS-114' : undefined,
    });
  }

  return events.sort((a, b) => a.atSec - b.atSec || a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------ *
 * SIEM query
 * ------------------------------------------------------------------ */

export type SiemField = 'source' | 'type' | 'user' | 'host' | 'indicator' | 'severity';

export const SIEM_FIELDS: readonly SiemField[] = [
  'source',
  'type',
  'user',
  'host',
  'indicator',
  'severity',
] as const;

export interface SiemQuery {
  /** Bare words, matched against the whole row. */
  terms: string[];
  /** `field:value` pairs, ANDed with each other and with the terms. */
  filters: { field: SiemField; value: string }[];
}

/**
 * A deliberately small query language: bare words and `field:value`.
 *
 * An unknown prefix is *not* an error and *not* silently dropped — it stays a
 * free-text term. A query bar that quietly ignored half of what was typed
 * would teach an analyst to trust a filter that was never applied.
 */
export function parseQuery(input: string): SiemQuery {
  const query: SiemQuery = { terms: [], filters: [] };

  for (const raw of input.trim().split(/\s+/)) {
    if (!raw) continue;
    const separator = raw.indexOf(':');
    if (separator > 0) {
      const field = raw.slice(0, separator).toLowerCase();
      const value = unquote(raw.slice(separator + 1));
      if (value && (SIEM_FIELDS as readonly string[]).includes(field)) {
        query.filters.push({ field: field as SiemField, value: value.toLowerCase() });
        continue;
      }
    }
    query.terms.push(unquote(raw).toLowerCase());
  }

  return query;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function fieldOf(event: SiemEvent, field: SiemField): string {
  switch (field) {
    case 'source':
      return event.source;
    case 'type':
      return event.sourceType;
    case 'user':
      return event.user ?? '';
    case 'host':
      return event.host ?? '';
    case 'indicator':
      return event.indicator ?? '';
    case 'severity':
      return event.severity;
  }
}

export function matchesQuery(event: SiemEvent, query: SiemQuery): boolean {
  for (const filter of query.filters) {
    if (!fieldOf(event, filter.field).toLowerCase().includes(filter.value)) return false;
  }
  if (query.terms.length === 0) return true;

  const haystack = [
    event.message,
    event.source,
    event.sourceType,
    event.severity,
    event.user ?? '',
    event.host ?? '',
    event.indicator ?? '',
  ]
    .join(' ')
    .toLowerCase();

  return query.terms.every((term) => haystack.includes(term));
}

/* ------------------------------------------------------------------ *
 * The console-wide time range
 * ------------------------------------------------------------------ *
 *
 * One range, read from context, obeyed by every view that shows *observations*
 * — the SIEM index, the message trace, the egress ledger, the chronology.
 *
 * It is deliberately **not** applied to the inventories: sessions, hosts,
 * extensions, indicators and credential posture answer "what is true now", and
 * a window has no meaning against a present-tense fact. Worse, it would be
 * actively wrong here — SES-8811 was issued at 02:12:40, so a 30-minute window
 * would drop it from the session table and take the case's central lesson
 * (three sessions, revocation kills two, the service principal survives) with
 * it. And a row that a response action is about must never be filtered out of
 * the view that is supposed to show that action working (§6).
 *
 * Respecting a time range therefore includes knowing where not to apply one.
 * Each inventory says which range is active instead, so the operator can see
 * that the tool read the setting and chose not to hide anything.
 */

/** @deprecated Use `TimeRangeId`. Kept so the SIEM's own naming still reads. */
export type SiemRangeId = TimeRangeId;

export const SIEM_RANGES = TIME_RANGES;

export interface SiemRange {
  fromSec: number;
  toSec: number;
}

/** 02:00:00 — the start of the night the incident happened on. */
const NIGHT_START_SEC = 2 * 3600;

export function rangeBounds(ctx: GameContext, id: TimeRangeId = ctx.timeRange): SiemRange {
  switch (id) {
    case 'last30':
      return { fromSec: ctx.clockSec - 30 * 60, toSec: ctx.clockSec };
    case 'night':
      return { fromSec: NIGHT_START_SEC, toSec: ctx.clockSec };
    case 'all':
      return { fromSec: Number.NEGATIVE_INFINITY, toSec: Number.POSITIVE_INFINITY };
  }
}

/** True when a `HH:MM:SS` reading falls inside the range. */
export function clockWithinRange(clock: string, range: SiemRange): boolean {
  const at = toSeconds(clock);
  return at >= range.fromSec && at <= range.toSec;
}

export function withinRange(event: SiemEvent, range: SiemRange): boolean {
  return event.atSec >= range.fromSec && event.atSec <= range.toSec;
}

/**
 * The full search: range first, then query.
 *
 * `range` defaults to the console's, so a caller that does not care gets the
 * operator's setting rather than a second opinion about what "recent" means.
 */
export function searchEvents(
  ctx: GameContext,
  options: { query: string; range?: TimeRangeId },
): SiemEvent[] {
  const parsed = parseQuery(options.query);
  const bounds = rangeBounds(ctx, options.range ?? ctx.timeRange);
  return siemEvents(ctx).filter(
    (event) => withinRange(event, bounds) && matchesQuery(event, parsed),
  );
}

/**
 * How many indexed events the range alone is holding back.
 *
 * Every filtered view reports this. A row that vanishes without the interface
 * saying which control removed it is how an analyst concludes a source is
 * empty when it is merely narrowed.
 */
export function hiddenByRange(ctx: GameContext, query = ''): number {
  const parsed = parseQuery(query);
  const bounds = rangeBounds(ctx);
  return siemEvents(ctx).filter(
    (event) => matchesQuery(event, parsed) && !withinRange(event, bounds),
  ).length;
}

/* ------------------------------------------------------------------ *
 * Query diagnostics
 * ------------------------------------------------------------------ */

/**
 * One thing the parser wants to tell the operator about their query.
 *
 * Separate from `parseQuery` on purpose: the parse is the contract the search
 * runs on and must stay exactly `{ terms, filters }`. These are advice about
 * that parse, and advice must never be able to change what was searched.
 */
export interface QueryNote {
  /** The token this is about, verbatim as typed. */
  token: string;
  /** A complete sentence naming the problem and the fix. Never "Invalid input". */
  message: string;
  tone: 'warn' | 'info';
}

const SEVERITY_VALUES = ['critical', 'warn', 'info'] as const;

/**
 * What the parser noticed, in the operator's words.
 *
 * Three cases, and none of them is an error state — the query still ran, and
 * each note says what it ran *as*, which is the part a bare "invalid query"
 * never tells you.
 */
export function queryNotes(input: string): QueryNote[] {
  const notes: QueryNote[] = [];
  const fieldList = SIEM_FIELDS.join(', ');

  for (const raw of input.trim().split(/\s+/)) {
    if (!raw) continue;
    const separator = raw.indexOf(':');
    if (separator <= 0) continue;

    const field = raw.slice(0, separator).toLowerCase();
    const value = unquote(raw.slice(separator + 1)).toLowerCase();
    const known = (SIEM_FIELDS as readonly string[]).includes(field);

    if (known && !value) {
      notes.push({
        token: raw,
        message: `Query needs a value after "${field}:" — for example ${field}:${exampleFor(field as SiemField)}.`,
        tone: 'warn',
      });
      continue;
    }

    if (!known) {
      notes.push({
        token: raw,
        message: `Searched "${raw}" as free text — there is no field called "${field}". Fields: ${fieldList}.`,
        tone: 'info',
      });
      continue;
    }

    if (field === 'severity' && !SEVERITY_VALUES.some((allowed) => allowed.includes(value))) {
      notes.push({
        token: raw,
        message: `No severity called "${value}". Try ${SEVERITY_VALUES.join(', ')}.`,
        tone: 'warn',
      });
      continue;
    }

    if (field === 'type' && !SIEM_SOURCE_TYPES.some((allowed) => allowed.includes(value))) {
      notes.push({
        token: raw,
        message: `No source type called "${value}". Try ${SIEM_SOURCE_TYPES.join(', ')}.`,
        tone: 'warn',
      });
    }
  }

  return notes;
}

function exampleFor(field: SiemField): string {
  switch (field) {
    case 'severity':
      return 'critical';
    case 'type':
      return 'identity';
    case 'user':
      return 'd.arslan';
    case 'host':
      return 'WKS-114';
    case 'indicator':
      return '203.0.113.47';
    case 'source':
      return 'IDP-01';
  }
}

/** Saved queries — the ones this case can actually answer. */
export const SAVED_QUERIES: readonly { id: string; labelKey: StringKey; query: string }[] = [
  { id: 'all', labelKey: 'investigate.siem.saved.all', query: '' },
  { id: 'critical', labelKey: 'investigate.siem.saved.critical', query: 'severity:critical' },
  { id: 'identity', labelKey: 'investigate.siem.saved.identity', query: 'type:identity' },
  { id: 'user', labelKey: 'investigate.siem.saved.user', query: 'user:d.arslan' },
  { id: 'attacker', labelKey: 'investigate.siem.saved.attacker', query: 'indicator:203.0.113.47' },
];

export interface SiemAggregate {
  key: string;
  count: number;
}

/**
 * Aggregation over whatever the query returned.
 *
 * Ordered by the canonical order of the field's values rather than by count, so
 * a bar does not jump between rows when a single event arrives.
 */
export function aggregateBy(
  events: SiemEvent[],
  field: 'sourceType' | 'severity',
): SiemAggregate[] {
  const order: readonly string[] =
    field === 'sourceType' ? SIEM_SOURCE_TYPES : ['critical', 'warn', 'info'];

  const counts = new Map<string, number>();
  for (const event of events) {
    const key = event[field];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return order
    .filter((key) => counts.has(key))
    .map((key) => ({ key, count: counts.get(key) ?? 0 }));
}

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

export type SessionState = 'active' | 'revoked';

export interface SessionRow {
  sessionId: string;
  principal: IdentityId;
  principalUpn: string;
  device: string;
  issuedAt: string;
  kind: 'legitimate' | 'rogue' | 'service';
  /** Live. `revoke_sessions` terminates the account's sessions, not the estate's. */
  state: SessionState;
  noteKey: string;
}

export interface SessionInventory {
  /** The inventory is a query result; it does not exist until the query ran. */
  ran: boolean;
  rows: SessionRow[];
  activeCount: number;
}

/**
 * The session and token inventory, with live state layered over it.
 *
 * `art_session_001` states `SES-8842 … ACTIVE` because that is what the alert
 * found. After `revoke_sessions` it is not active any more, and a tool that
 * still said `ACTIVE` would be lying about the thing the operator just did.
 */
export function sessionInventory(ctx: GameContext): SessionInventory {
  const ran = diagnosticRan(ctx, 'session_inventory');
  const revoked = hasPerformed(ctx, 'revoke_sessions');

  const rows: SessionRow[] = ran
    ? SESSION_RECORDS.map((record) => ({
        ...record,
        state:
          revoked && record.principal === 'usr_dilara'
            ? ('revoked' as const)
            : ('active' as const),
      }))
    : [];

  return { ran, rows, activeCount: rows.filter((row) => row.state === 'active').length };
}

export type CredentialState = 'exposed' | 'reset';

export interface CredentialPosture {
  state: CredentialState;
  /**
   * True when the password was reset but the issued session cookie was never
   * revoked — the case's central lesson, and the one claim a containment view
   * must never get backwards (§6).
   */
  issuedTokensStillValid: boolean;
}

export function credentialPosture(ctx: GameContext): CredentialPosture {
  const reset = hasPerformed(ctx, 'reset_credentials');
  const revoked = hasPerformed(ctx, 'revoke_sessions');
  return { state: reset ? 'reset' : 'exposed', issuedTokensStillValid: !revoked };
}

/* ------------------------------------------------------------------ *
 * Endpoint / EDR
 * ------------------------------------------------------------------ */

export interface HostRow {
  assetId: AssetId;
  nameKey: string;
  kind: 'workstation' | 'file_service' | 'identity_provider';
  owner: IdentityId | null;
  /** Live: flips to `isolated` when the endpoint is contained. */
  status: AssetStatus;
}

export function hostInventory(ctx: GameContext): HostRow[] {
  return visibleAssets(ctx).map((asset) => ({
    assetId: asset.id,
    nameKey: asset.nameKey,
    kind: asset.kind,
    owner: asset.owner,
    status: assetStatus(ctx, asset.id),
  }));
}

export interface ExtensionRow {
  host: AssetId;
  name: string;
  version: string | null;
  installedAt: string;
  permissions: string | null;
  observedExfil: boolean;
  /** Live: an isolated host can no longer reach the collector. */
  contained: boolean;
}

export function extensionInventory(ctx: GameContext): ExtensionRow[] {
  return EXTENSION_RECORDS.filter((record) => requirementMet(ctx, record.requires)).map(
    (record) => ({
      host: record.host,
      name: record.name,
      version: record.version,
      installedAt: record.installedAt,
      permissions: record.permissions,
      observedExfil: record.observedExfil,
      contained: assetStatus(ctx, record.host) === 'isolated',
    }),
  );
}

export type ConnectionState = 'observed' | 'severed' | 'blocked';

export interface ConnectionRow {
  host: AssetId;
  destination: string;
  at: string;
  detailKey: string;
  state: ConnectionState;
}

/**
 * Outbound connections, with the effect of containment applied.
 *
 * Isolation wins over blocking when both apply: cutting the host off is the
 * stronger statement, and reporting a severed link as merely "blocked" would
 * understate what the operator did.
 */
export function endpointConnections(ctx: GameContext): ConnectionRow[] {
  const blocked = hasPerformed(ctx, 'block_indicator');

  return CONNECTION_RECORDS.filter((record) => requirementMet(ctx, record.requires)).map(
    (record) => {
      const severed = assetStatus(ctx, record.host) === 'isolated';
      const indicatorBlocked =
        blocked &&
        record.indicator !== undefined &&
        BLOCKED_INDICATOR_VALUES.includes(record.indicator);

      return {
        host: record.host,
        destination: record.destination,
        at: record.at,
        detailKey: record.detailKey,
        state: severed ? 'severed' : indicatorBlocked ? 'blocked' : 'observed',
      };
    },
  );
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

export type IndicatorState = 'observed' | 'blocked';

export interface IndicatorRow {
  value: string;
  kind: 'ip' | 'domain' | 'fingerprint';
  firstSeen: string;
  /**
   * `observed` says only that the case saw it. It is not a claim that a
   * firewall is passing it: `block_indicator` names two values in its result,
   * and those two are the only ones this reports as blocked.
   */
  state: IndicatorState;
}

export function indicatorInventory(ctx: GameContext): IndicatorRow[] {
  const blocked = hasPerformed(ctx, 'block_indicator');

  return INDICATOR_RECORDS.filter((record) =>
    record.requiresAny.some((requires) => requirementMet(ctx, requires)),
  ).map((record) => ({
    value: record.value,
    kind: record.kind,
    firstSeen: record.firstSeen,
    state:
      blocked && BLOCKED_INDICATOR_VALUES.includes(record.value)
        ? ('blocked' as const)
        : ('observed' as const),
  }));
}

export interface EgressRow {
  at: string;
  host: AssetId;
  destination: string;
  descriptionKey: string;
  totalMb: number;
  /** Derived: `totalMb x completedFraction`, rounded to one decimal. */
  egressedMb: number;
  completedFraction: number;
  partiallyBlocked: boolean;
}

/** One decimal place, which is the precision the case states volumes to. */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The egress ledger.
 *
 * An event ledger at the timestamps the case actually records, not a
 * per-second byte curve: the fixtures give three volumes and one completion
 * percentage, and drawing a smooth line between them would be inventing
 * traffic. `18.4 MB blocked at 62%` really does mean 11.4 MB left the estate,
 * and that arithmetic is the only derivation here.
 */
export function egressLedger(ctx: GameContext): EgressRow[] {
  const bounds = rangeBounds(ctx);
  return EGRESS_RECORDS.filter(
    (record) => requirementMet(ctx, record.requires) && clockWithinRange(record.at, bounds),
  ).map((record) => ({
    at: record.at,
    host: record.host,
    destination: record.destination,
    descriptionKey: record.descriptionKey,
    totalMb: record.totalMb,
    egressedMb: round1(record.totalMb * record.completedFraction),
    completedFraction: record.completedFraction,
    partiallyBlocked: record.completedFraction < 1,
  }));
}

/** Collected transfers the range is currently hiding. */
export function egressHiddenByRange(ctx: GameContext): number {
  const bounds = rangeBounds(ctx);
  return EGRESS_RECORDS.filter(
    (record) => requirementMet(ctx, record.requires) && !clockWithinRange(record.at, bounds),
  ).length;
}

export function egressTotals(rows: EgressRow[]): { totalMb: number; egressedMb: number } {
  return {
    totalMb: round1(rows.reduce((sum, row) => sum + row.totalMb, 0)),
    egressedMb: round1(rows.reduce((sum, row) => sum + row.egressedMb, 0)),
  };
}

/**
 * The clock reading at which outbound traffic was last cut, or null.
 *
 * Derived from the operations that actually stop egress — revoking the session
 * that was pulling the files, or blocking the destination.
 */
export function egressStoppedAt(ctx: GameContext): string | null {
  const stopping = ctx.performedActions.filter(
    (action) => action.actionId === 'revoke_sessions' || action.actionId === 'block_indicator',
  );
  if (stopping.length === 0) return null;
  return stopping.map((action) => action.at).sort()[0] ?? null;
}

/* ------------------------------------------------------------------ *
 * Email
 * ------------------------------------------------------------------ */

export type DeliveryDisposition = 'clicked' | 'delivered' | 'destroyed';

export interface MessageTraceRow {
  recipient: string;
  identity: IdentityId;
  at: string;
  clickedAt: string | null;
  /**
   * `destroyed` when the message itself was deleted. The trace still records
   * that a message was delivered — a mail gateway log survives the mailbox —
   * but no header, subject or body value is reachable through it any more.
   */
  disposition: DeliveryDisposition;
}

function traceKnown(ctx: GameContext, record: (typeof MESSAGE_TRACE_RECORDS)[number]): boolean {
  // The primary delivery is known once the message has been read, and stays
  // known after it is deleted — deletion destroys the evidence, not the fact.
  if (record.requires.artifact === 'art_email_001' && ctx.destroyedArtifacts.includes('art_email_001')) {
    return true;
  }
  return requirementMet(ctx, record.requires);
}

/** Deliveries the range is hiding, so an empty trace is never a mystery. */
export function traceHiddenByRange(ctx: GameContext): number {
  const bounds = rangeBounds(ctx);
  return MESSAGE_TRACE_RECORDS.filter(
    (record) => traceKnown(ctx, record) && !clockWithinRange(record.at, bounds),
  ).length;
}

export function messageTrace(ctx: GameContext): MessageTraceRow[] {
  const destroyed = ctx.destroyedArtifacts.includes('art_email_001');
  const bounds = rangeBounds(ctx);

  return MESSAGE_TRACE_RECORDS.filter(
    (record) => traceKnown(ctx, record) && clockWithinRange(record.at, bounds),
  ).map((record) => ({
    recipient: record.recipient,
    identity: record.identity,
    at: record.at,
    clickedAt: destroyed && record.requires.artifact === 'art_email_001' ? null : record.clickedAt,
    disposition:
      destroyed && record.requires.artifact === 'art_email_001'
        ? ('destroyed' as const)
        : record.clickedAt
          ? ('clicked' as const)
          : ('delivered' as const),
  }));
}

/** SPF/DKIM/DMARC as the gateway evaluated them. Empty until the mail is read. */
export function messageAuthentication(
  ctx: GameContext,
): { labelKey: string; value: string; tone?: 'bad' | 'warn' | 'good' }[] {
  const record = sourceRecord(ctx, 'art_email_001');
  const wanted = ['field.spf', 'field.dkim', 'field.dmarc'];
  return record.fields
    .filter((field) => wanted.includes(field.labelKey))
    .map((field) => ({ labelKey: field.labelKey, value: field.value, tone: field.tone }));
}

/* ------------------------------------------------------------------ *
 * Source health
 * ------------------------------------------------------------------ */

export interface SourceHealthRow {
  sourceType: SiemSourceType;
  /** Distinct emitting systems behind this type, as the index names them. */
  systems: string[];
  events: number;
  /** Clock of the newest event of this type, or null when none is indexed. */
  lastEventAt: string | null;
  /** Simulated seconds since that event. Null with no events. */
  ageSec: number | null;
  /**
   * `feeding` when the type has indexed events, `quiet` when it has none.
   *
   * Not "down". Nothing in Case 001 reports a collector outage, and dressing an
   * empty source up as a failed one would be a status nobody could verify.
   * Quiet says exactly what is true: this source has produced nothing the
   * operator can see yet.
   */
  state: 'feeding' | 'quiet';
}

/**
 * Per-source ingest health, for the Command destination.
 *
 * Every source type is listed even when it has nothing, because the absence is
 * the information: an analyst who cannot tell "no events" from "not collecting"
 * has no way to know whether silence is good news.
 */
export function sourceHealth(ctx: GameContext): SourceHealthRow[] {
  const events = siemEvents(ctx);

  return SIEM_SOURCE_TYPES.map((sourceType) => {
    const own = events.filter((event) => event.sourceType === sourceType);
    const newest = own[own.length - 1];
    return {
      sourceType,
      systems: [...new Set(own.map((event) => event.source))],
      events: own.length,
      lastEventAt: newest?.at ?? null,
      ageSec: newest ? Math.max(0, ctx.clockSec - newest.atSec) : null,
      state: own.length > 0 ? ('feeding' as const) : ('quiet' as const),
    };
  });
}

/* ------------------------------------------------------------------ *
 * Provenance and chain of custody
 * ------------------------------------------------------------------ */

export interface CustodyStep {
  /** Simulated clock, `HH:MM:SS`. */
  at: string;
  /** Who did it. The operator at the console, the agent, or the estate itself. */
  by: 'human' | 'agent' | 'system';
  kind: 'emitted' | 'collected' | 'destroyed';
}

export interface CustodyRecord {
  artifactId: ArtifactId;
  /** The system that produced it, verbatim from the artifact. */
  source: string;
  /** When the source recorded it — not when the analyst read it. */
  emittedAt: string;
  untrusted: boolean;
  state: SourceState;
  steps: CustodyStep[];
}

/**
 * Where a piece of evidence came from and everything that has happened to it.
 *
 * Reconstructed from `ctx.toolLog`, which already records the origin and the
 * order of every call — so the chain is a reading of what happened rather than
 * a second ledger that could disagree with it. The distinction the chain makes
 * that nothing else in the product does: *emitted* is the source's timestamp,
 * *collected* is the analyst's, and confusing the two is how an investigation
 * ends up claiming it knew something before it did.
 */
export function custodyRecord(ctx: GameContext, artifactId: ArtifactId): CustodyRecord {
  const record = sourceRecord(ctx, artifactId);
  const steps: CustodyStep[] = [
    { at: record.timestamp, by: 'system', kind: 'emitted' },
  ];

  const collection = ctx.toolLog.find(
    (entry) => entry.ok && entry.effectId === `evidence-${artifactId}`,
  );
  if (collection) {
    steps.push({
      at: formatClock(ctx.caseOpenedAtSec + Math.round(collection.atMs / 1000)),
      by: collection.origin,
      kind: 'collected',
    });
  }

  if (ctx.destroyedArtifacts.includes(artifactId)) {
    /*
     * Evidence is destroyed by a decision, not by a call against the artifact,
     * so the clock comes from the decision's own record and the attribution
     * comes from the tool-log entry that submitted it. Neither is assumed: an
     * agent that deletes the phishing mail must be recorded as having deleted
     * it, and hard-coding "you" here would quietly reassign the blame.
     */
    const decision = Object.values(ctx.decisions).find(
      (candidate) => candidate?.optionId === 'D4_delete_email_and_close_alert',
    );
    const submission = decision
      ? ctx.toolLog.find(
          (entry) => entry.ok && entry.effectId === `decision-${decision.decisionId}`,
        )
      : undefined;

    steps.push({
      at: decision?.at ?? record.timestamp,
      by: submission?.origin ?? 'system',
      kind: 'destroyed',
    });
  }

  return {
    artifactId,
    source: record.source,
    emittedAt: record.timestamp,
    untrusted: record.untrusted,
    state: record.state,
    steps,
  };
}

/* ------------------------------------------------------------------ *
 * Cross-tool correlation
 * ------------------------------------------------------------------ *
 *
 * "Following an identity from SIEM to Identity to EDR must actually carry the
 * selection."
 *
 * Two rules make that useful rather than decorative.
 *
 * **The console follows one thing at a time.** `ctx.focus` is a single value,
 * not a filter stack, because the question an analyst is actually holding is
 * "where else does this appear?" — and a second simultaneous focus turns that
 * into a set operation nobody asked for.
 *
 * **A pivot highlights; it never hides.** Arriving in Endpoint to find an empty
 * table teaches nothing: the operator cannot tell whether the pivot failed or
 * the host is genuinely absent from that source. Matching rows are marked and
 * counted, the rest stay visible, and the counts are what the pivot controls
 * are labelled with — so the operator knows before they travel whether the
 * journey is worth making.
 */

/**
 * Whether any of these values is the thing the console is following.
 *
 * Case-insensitive substring, because the same identity is `d.arslan` in one
 * log and `d.arslan@cy-case.corp` in the next, and the same host is `WKS-114`
 * on its own row and `fp_1a77bd93 (WKS-114)` inside a device string. Matching
 * on equality would quietly find nothing and look like an absence of evidence.
 */
export function matchesFocus(
  focus: InvestigationFocus | null,
  ...values: (string | null | undefined)[]
): boolean {
  if (!focus) return false;
  const needle = focus.value.toLowerCase();
  if (!needle) return false;
  return values.some((value) => (value ?? '').toLowerCase().includes(needle));
}

/** One row a tool displays, reduced to the identifiers a pivot can match on. */
export interface CorrelatableRow {
  /** Stable within its tab. Matches the `id` the tool puts on the element. */
  id: string;
  /** Every identifier the row displays that a focus could name. */
  values: (string | null | undefined)[];
}

/**
 * Every row of a tool, as identifiers.
 *
 * The single definition of "what this tool has to say about a value". Both the
 * pivot counts and the per-row highlight read it, so a control cannot promise
 * three matches and then land on a table that highlights two.
 */
export function correlatableRows(ctx: GameContext, tab: InvestigateTab): CorrelatableRow[] {
  switch (tab) {
    case 'siem':
      return searchEvents(ctx, { query: '' }).map((event) => ({
        id: event.id,
        values: [event.user, event.host, event.indicator, event.source, event.message],
      }));
    case 'identity':
      return [
        ...sessionInventory(ctx).rows.map((row) => ({
          id: row.sessionId,
          values: [row.sessionId, row.principalUpn, row.device],
        })),
        ...identityDirectory(ctx).map((row) => ({
          id: row.id,
          values: [row.upn, row.displayName],
        })),
      ];
    case 'endpoint':
      return [
        ...hostInventory(ctx).map((row) => ({ id: row.assetId, values: [row.assetId, row.owner] })),
        ...extensionInventory(ctx).map((row) => ({
          id: `ext-${row.host}`,
          values: [row.host, row.name],
        })),
        ...endpointConnections(ctx).map((row) => ({
          id: `conn-${row.host}-${row.destination}`,
          values: [row.host, row.destination],
        })),
      ];
    case 'network':
      return [
        ...indicatorInventory(ctx).map((row) => ({ id: row.value, values: [row.value] })),
        ...egressLedger(ctx).map((row) => ({
          id: `egress-${row.at}`,
          values: [row.host, row.destination],
        })),
      ];
    case 'email':
      return messageTrace(ctx).map((row) => ({
        id: row.recipient,
        values: [row.recipient, row.identity],
      }));
  }
}

export interface CorrelationCount {
  tab: InvestigateTab;
  matches: number;
  rows: number;
}

/**
 * How many rows each tool holds for the focused value, in tab order.
 *
 * Tab order rather than descending count: a control that reorders itself
 * between two pivots is a control the operator has to re-read every time.
 */
export function correlation(
  ctx: GameContext,
  focus: InvestigationFocus | null = ctx.focus,
): CorrelationCount[] {
  return INVESTIGATE_TABS.map((tab) => {
    const rows = correlatableRows(ctx, tab);
    return {
      tab,
      rows: rows.length,
      matches: rows.filter((row) => matchesFocus(focus, ...row.values)).length,
    };
  });
}

/** The tools that actually have something to show about the focused value. */
export function pivotTargets(
  ctx: GameContext,
  focus: InvestigationFocus | null = ctx.focus,
): CorrelationCount[] {
  return correlation(ctx, focus).filter((entry) => entry.matches > 0);
}

/**
 * The identity directory, as rows.
 *
 * Lifted out of the Identity tool so `correlatableRows` and the table cannot
 * disagree about which accounts are visible.
 */
export function identityDirectory(
  ctx: GameContext,
): { id: IdentityId; displayName: string; upn: string }[] {
  return visibleIdentities(ctx).map((identity) => ({
    id: identity.id,
    displayName: identity.displayName,
    upn: identity.upn,
  }));
}

/* ------------------------------------------------------------------ *
 * Tab metadata
 * ------------------------------------------------------------------ */

export interface InvestigateTabMeta {
  id: InvestigateTab;
  labelKey: StringKey;
  /** The diagnostic this tool runs, when it has one to offer. */
  diagnostics: DiagnosticId[];
}

/**
 * Which investigation tool owns which diagnostic.
 *
 * The diagnostics are still executed by the same `run_diagnostic` command from
 * the same runtime; this only says which tool is the natural place to reach for
 * it, so a player pivoting to Identity is offered the identity queries rather
 * than a list of all three.
 */
export const INVESTIGATE_TAB_META: readonly InvestigateTabMeta[] = [
  { id: 'siem', labelKey: 'investigate.tab.siem', diagnostics: ['indicator_scope'] },
  {
    id: 'identity',
    labelKey: 'investigate.tab.identity',
    diagnostics: ['auth_timeline', 'session_inventory'],
  },
  { id: 'endpoint', labelKey: 'investigate.tab.endpoint', diagnostics: [] },
  { id: 'network', labelKey: 'investigate.tab.network', diagnostics: ['indicator_scope'] },
  { id: 'email', labelKey: 'investigate.tab.email', diagnostics: [] },
];

/**
 * How many findable rows a tool currently holds, for the tab badges.
 *
 * A count of zero is honest information — it says the source exists but the
 * operator has not collected anything from it yet.
 */
export function tabRowCount(ctx: GameContext, tab: InvestigateTab): number {
  /*
   * The SIEM badge counts the whole index rather than the current range.
   *
   * The navigation spine shows the same number for Investigate, and two counts
   * labelled the same thing disagreeing on one screen is a worse problem than a
   * badge that ignores a filter — especially when the table underneath it
   * already says "3 of 6 indexed events" and names the range holding the rest
   * back. Correlation still counts what is actually on screen; these are two
   * questions and they get two answers.
   */
  if (tab === 'siem') return siemEvents(ctx).length;
  return correlatableRows(ctx, tab).length;
}

/** The diagnostic rows a tool should display, once that diagnostic has run. */
export function diagnosticRowsFor(
  ctx: GameContext,
  diagnosticId: DiagnosticId,
): { key: string; value: string; tone?: 'bad' | 'warn' | 'good' }[] {
  if (!diagnosticRan(ctx, diagnosticId)) return [];
  return DIAGNOSTIC_ROWS[diagnosticId] ?? [];
}
