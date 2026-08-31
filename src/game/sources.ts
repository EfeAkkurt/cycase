import { tk } from '../i18n';
import {
  ARTIFACTS,
  DIAGNOSTIC_ROWS,
  HOST_CONNECTIONS,
  HOST_EXTENSION,
  IDENTITIES,
  INCIDENT_ID,
  INDICATORS,
  RESPONSE_ACTION_BY_ID,
  SESSIONS,
} from './fixtures/case001';
import {
  hasPerformed,
  incidentClock,
  incidentStatus,
  unresolvedCriticalFindings,
  visibleAssets,
  visibleIdentities,
} from './selectors';
import type {
  ArtifactId,
  AssetId,
  DiagnosticId,
  DiagnosticRow,
  GameContext,
  IdentityId,
  OperationEffect,
  ResponseActionId,
  SourceId,
} from './types';

/**
 * The simulated operational sources — identity, endpoint, network, scope — as
 * live state rather than as static fixture rows.
 *
 * Redesign §6 is the whole reason this file exists: "An operation is not
 * complete when only the score or a toast changes. Within 250 ms it must update
 * every affected view and produce an attributable timeline entry."
 *
 * Two rules hold it together.
 *
 * 1. **Everything here is derived.** Not one function stores state. A source
 *    view is a pure function of `GameContext`, so it renders in the same React
 *    tick as the command that moved it, it cannot drift from the case, and it
 *    adds nothing to `stateVersion`, `replaySignature()` or the run hash. The
 *    250 ms budget is met by construction rather than by an effect hook.
 *
 * 2. **Effects are diffed, never asserted.** `sourceSnapshot()` flattens every
 *    source to `key -> state`, and the engine diffs the snapshot taken before a
 *    command against the one taken after. An operation therefore cannot report
 *    an effect it did not have. That is not a stylistic preference: decision D3
 *    turns on `reset_credentials` *not* invalidating an already-issued token,
 *    and a hand-written effect list is exactly where that lie would be written.
 *
 * Nothing clock-sampled belongs in the snapshot. `take_response_action` costs
 * 30 simulated seconds and the engine charges them at commit, *after* the
 * handler has built its result — so a series sampled inside the handler would
 * describe a clock the UI has already left. Sampled series live in `live.ts`
 * and are read directly by the views.
 */

/* ------------------------------------------------------------------ *
 * Identity — sessions
 * ------------------------------------------------------------------ */

export type SessionState = 'active' | 'revoked';

export interface SessionView {
  id: string;
  principal: IdentityId;
  principalName: string;
  device: string;
  issuedAt: string;
  kind: 'legitimate' | 'token_replay' | 'service';
  state: SessionState;
  /** What ended it. Only ever a revocation — nothing else terminates a session. */
  revokedBy?: ResponseActionId;
  /** False until `session_inventory` has run: the operator has not looked yet. */
  enumerated: boolean;
  tone: 'good' | 'warn' | 'bad';
}

const IDENTITY_NAME = new Map(IDENTITIES.map((i) => [i.id, i.displayName]));

/**
 * Live session state.
 *
 * `revoke_sessions` terminates the sessions of the compromised *account* — both
 * of d.arslan's, the legitimate one included, which is why the action's impact
 * warns that the user will be signed out everywhere. It does not touch
 * svc-backup: that is a different principal, its session is expected, and
 * killing it would break a backup job for no containment gain.
 *
 * Nothing else here revokes anything. Disabling the account (the wrong branch
 * of D1) blocks *new* sign-ins and leaves issued tokens alive, and resetting
 * the password leaves them alive too. That is the same lesson twice, and the
 * simulation has to keep telling the truth about it in both places.
 */
export function sessionInventory(ctx: GameContext): SessionView[] {
  const revoked = hasPerformed(ctx, 'revoke_sessions');
  const enumerated = ctx.ranDiagnostics.includes('session_inventory');

  return SESSIONS.map((session) => {
    const killed = revoked && session.principal === 'usr_dilara';
    const state: SessionState = killed ? 'revoked' : 'active';
    return {
      id: session.id,
      principal: session.principal,
      principalName: IDENTITY_NAME.get(session.principal) ?? session.principal,
      device: session.device,
      issuedAt: session.issuedAt,
      kind: session.kind,
      state,
      ...(killed ? { revokedBy: 'revoke_sessions' as ResponseActionId } : {}),
      enumerated,
      tone: killed ? 'good' : session.kind === 'token_replay' ? 'bad' : 'good',
    };
  });
}

/** The attacker's session, singled out because the case turns on it. */
export function stolenSession(ctx: GameContext): SessionView {
  const found = sessionInventory(ctx).find((s) => s.kind === 'token_replay');
  // SESSIONS is a fixture with exactly one replayed session; the fallback keeps
  // the signature total rather than pushing a null check onto every caller.
  return found ?? sessionInventory(ctx)[0]!;
}

/* ------------------------------------------------------------------ *
 * Identity — credentials
 * ------------------------------------------------------------------ */

export interface CredentialPosture {
  identityId: IdentityId;
  password: 'exposed' | 'rotated';
  /**
   * The account's *enrolment policy*, and deliberately nothing more.
   *
   * `reset_credentials` forces re-enrolment "at next sign-in" — a forward-
   * looking policy change. It does not touch the MFA posture of a session that
   * has already been issued: while SES-8842 is alive the attacker keeps
   * satisfying MFA with the session claim they stole, and they never reach a
   * next sign-in. Naming this field `mfaPolicy` rather than `mfa` is what keeps
   * a reset from being read as having closed that bypass — the same mistake
   * `issuedTokensInvalidated` exists to prevent, one field over.
   */
  mfaPolicy: 'enrolled' | 're_enrolment_forced';
  accountEnabled: boolean;
  /**
   * Whether tokens issued *before* the response are dead.
   *
   * Reads `revoke_sessions` and nothing else, on purpose. This single boolean
   * is decision D3's teaching point in machine-readable form: a password reset
   * must never be able to flip it, so `reset_credentials` is not consulted.
   */
  issuedTokensInvalidated: boolean;
  rotatedBy?: ResponseActionId;
}

export function credentialPosture(ctx: GameContext): CredentialPosture {
  const reset = hasPerformed(ctx, 'reset_credentials');
  return {
    identityId: 'usr_dilara',
    password: reset ? 'rotated' : 'exposed',
    mfaPolicy: reset ? 're_enrolment_forced' : 'enrolled',
    accountEnabled: !ctx.disabledIdentities.includes('usr_dilara'),
    issuedTokensInvalidated: hasPerformed(ctx, 'revoke_sessions'),
    ...(reset ? { rotatedBy: 'reset_credentials' as ResponseActionId } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Endpoint — EDR host state
 * ------------------------------------------------------------------ */

export type ConnectionState = 'established' | 'blocked' | 'severed';

export interface HostConnectionView {
  id: string;
  remote: string;
  port: number;
  process: string;
  purpose: 'collector' | 'file_share' | 'sso';
  state: ConnectionState;
  /** The operation that stopped it, when one has. */
  stoppedBy?: ResponseActionId;
}

export interface EndpointPosture {
  assetId: AssetId;
  containment: 'online' | 'isolated';
  containedBy?: ResponseActionId;
  extension: { name: string; state: 'running' | 'contained_preserved' };
  connections: HostConnectionView[];
  establishedCount: number;
  /**
   * Artifacts already collected from this host.
   *
   * Isolation must not cost the operator evidence — redesign §6: "isolate the
   * endpoint … while preserving already-collected evidence". Nothing in this
   * file removes an entry from this list; only destroying an artifact outright
   * (the wrong branch of D4, which deletes the phishing mail) ever does.
   */
  collectedEvidence: ArtifactId[];
}

const HOST_ARTIFACTS: ArtifactId[] = ARTIFACTS.filter((a) =>
  a.relatedAssets?.includes(HOST_EXTENSION.assetId),
).map((a) => a.id);

export function endpointPosture(ctx: GameContext): EndpointPosture {
  const isolated = hasPerformed(ctx, 'isolate_endpoint');
  const blocked = hasPerformed(ctx, 'block_indicator');
  const revoked = hasPerformed(ctx, 'revoke_sessions');

  const connections: HostConnectionView[] = HOST_CONNECTIONS.map((conn) => {
    // Isolation is the broadest cut and wins over the narrower ones.
    if (isolated) {
      return { ...conn, state: 'severed' as const, stoppedBy: 'isolate_endpoint' as const };
    }
    if (conn.purpose === 'collector' && blocked) {
      return { ...conn, state: 'blocked' as const, stoppedBy: 'block_indicator' as const };
    }
    // The file share is reached with the stolen session, so revoking it closes
    // the connection without touching the host.
    if (conn.purpose === 'file_share' && revoked) {
      return { ...conn, state: 'severed' as const, stoppedBy: 'revoke_sessions' as const };
    }
    return { ...conn, state: 'established' as const };
  });

  return {
    assetId: HOST_EXTENSION.assetId,
    containment: isolated ? 'isolated' : 'online',
    ...(isolated ? { containedBy: 'isolate_endpoint' as ResponseActionId } : {}),
    extension: {
      name: HOST_EXTENSION.name,
      state: isolated ? 'contained_preserved' : 'running',
    },
    connections,
    establishedCount: connections.filter((c) => c.state === 'established').length,
    collectedEvidence: HOST_ARTIFACTS.filter(
      (id) => ctx.inspectedArtifacts.includes(id) && !ctx.destroyedArtifacts.includes(id),
    ),
  };
}

/** Whether the stolen session can still reach the file service. */
export function fileServiceAccess(ctx: GameContext): 'session_backed_open' | 'closed' {
  return hasPerformed(ctx, 'revoke_sessions') ? 'closed' : 'session_backed_open';
}

/* ------------------------------------------------------------------ *
 * Network — proxy and mail-gateway rules
 * ------------------------------------------------------------------ */

export interface IndicatorRule {
  indicator: string;
  kind: 'address' | 'domain';
  enforcedAt: 'egress_proxy' | 'mail_gateway';
  verdict: 'allow' | 'deny';
  appliedBy?: ResponseActionId;
}

export function networkPosture(ctx: GameContext): IndicatorRule[] {
  const blocked = hasPerformed(ctx, 'block_indicator');
  return INDICATORS.map((indicator) => ({
    ...indicator,
    indicator: indicator.id,
    verdict: blocked ? ('deny' as const) : ('allow' as const),
    ...(blocked ? { appliedBy: 'block_indicator' as ResponseActionId } : {}),
  }));
}

/** Whether anything can still leave for the attacker's infrastructure. */
export function egressStatus(ctx: GameContext): 'open' | 'filtered' {
  return hasPerformed(ctx, 'block_indicator') ? 'filtered' : 'open';
}

/* ------------------------------------------------------------------ *
 * Scope — blast radius
 * ------------------------------------------------------------------ */

export interface BlastRadius {
  /** Identities where an attacker actually held a session. */
  compromised: number;
  /** Identities the campaign reached at all, confirmed takeover or not. */
  targeted: number;
  /** Assets the operator can currently see and account for. */
  assetsInScope: number;
  /** True once `indicator_scope` has bounded it with evidence. */
  verified: boolean;
}

/**
 * Blast radius, counted from the identities and assets the scope diagnostic has
 * actually surfaced rather than from a hard-coded pair of numbers.
 *
 * Before the sweep the operator knows of one compromised identity and cannot
 * prove there are no others — `verified: false` is the honest state, not a
 * count of zero. After it, `usr_baran` and `WKS-231` become visible through the
 * existing `revealedBy` mechanism and the counts move on their own.
 */
export function blastRadius(ctx: GameContext): BlastRadius {
  return {
    compromised: 1,
    // Everyone the phishing run reached: d.arslan always, b.yilmaz once the
    // sweep proves the same mail was delivered to him.
    targeted: visibleIdentities(ctx).filter(
      (i) => i.baseRisk === 'critical' || i.baseRisk === 'elevated',
    ).length,
    assetsInScope: visibleAssets(ctx).length,
    verified: ctx.ranDiagnostics.includes('indicator_scope'),
  };
}

/* ------------------------------------------------------------------ *
 * The snapshot, and the diff that turns it into effects
 * ------------------------------------------------------------------ */

export interface SourceFact {
  source: SourceId;
  key: string;
  /** Short raw technical state, in the register of a log line. Not localised. */
  state: string;
  /** True while this fact is still a containment gap. Drives `stillOpen`. */
  attention: boolean;
}

/**
 * Every state fact the simulation can be asked about, flattened.
 *
 * Deliberately excludes anything sampled from the clock, and deliberately
 * excludes score, findings and route: the first would describe a clock the UI
 * has already left, and the rest are reported by their own fields. What is left
 * is exactly the set of things an analyst would call a *source of truth*.
 */
export function sourceSnapshot(ctx: GameContext): SourceFact[] {
  const facts: SourceFact[] = [];

  /* Identity ------------------------------------------------------- */

  for (const session of sessionInventory(ctx)) {
    const detail =
      session.kind === 'token_replay'
        ? 'replayed token'
        : session.kind === 'service'
          ? 'service, expected'
          : 'legitimate';
    facts.push({
      source: 'identity',
      key: session.id,
      state: session.state === 'revoked' ? 'revoked' : `active (${detail})`,
      attention: session.state === 'active' && session.kind === 'token_replay',
    });
  }

  const creds = credentialPosture(ctx);
  facts.push(
    {
      source: 'identity',
      key: 'd.arslan.password',
      state: creds.password,
      attention: creds.password === 'exposed',
    },
    {
      /*
       * Scoped to enrolment policy on purpose, and never to the live session.
       *
       * The obvious phrasing here — "satisfied by session claim" before,
       * "re-enrolment required" after — is lifted from the `auth_timeline` row
       * that describes *the attacker's* 03:02:14 sign-in. Using it would make
       * `reset_credentials` report the session-claim bypass as closed while
       * SES-8842 is still alive and still satisfying it, and would drop the gap
       * out of `stillOpen`. That is the D3 falsehood wearing a different hat.
       * The bypass is represented where it actually lives: on `SES-8842` and
       * on `d.arslan.issued-tokens`, neither of which a reset can move.
       */
      source: 'identity',
      key: 'd.arslan.mfa-policy',
      state:
        creds.mfaPolicy === 're_enrolment_forced'
          ? 're-enrolment forced at next sign-in'
          : 'enrolled, no re-enrolment forced',
      attention: false,
    },
    {
      source: 'identity',
      key: 'd.arslan.account',
      state: creds.accountEnabled ? 'enabled' : 'disabled',
      attention: false,
    },
    {
      // The fact D3 is graded on. `reset_credentials` must never move it.
      source: 'identity',
      key: 'd.arslan.issued-tokens',
      state: creds.issuedTokensInvalidated ? 'invalidated' : 'valid',
      attention: !creds.issuedTokensInvalidated,
    },
    {
      source: 'identity',
      key: 'auth-trail',
      state: ctx.ranDiagnostics.includes('auth_timeline')
        ? 'reviewed: token replay 03:02:11'
        : 'not reviewed',
      attention: false,
    },
    {
      source: 'identity',
      key: 'session-inventory',
      state: ctx.ranDiagnostics.includes('session_inventory')
        ? '3 enumerated, 1 replayed'
        : 'not enumerated',
      attention: false,
    },
  );

  /* Endpoint ------------------------------------------------------- */

  const host = endpointPosture(ctx);
  const collector = host.connections.find((c) => c.purpose === 'collector');
  facts.push(
    {
      source: 'endpoint',
      key: host.assetId,
      state: host.containment,
      attention: host.containment === 'online',
    },
    {
      source: 'endpoint',
      key: `${host.assetId}.extension`,
      state: host.extension.state === 'running' ? 'running' : 'contained, preserved',
      attention: host.extension.state === 'running',
    },
    {
      source: 'endpoint',
      key: `${host.assetId}.connections`,
      state: `${host.establishedCount} established`,
      attention: collector?.state === 'established',
    },
    {
      source: 'endpoint',
      key: `${host.assetId}.evidence`,
      state: `${host.collectedEvidence.length} collected`,
      attention: false,
    },
    {
      source: 'endpoint',
      key: 'SRV-FILES-02',
      state: fileServiceAccess(ctx) === 'closed' ? 'access closed' : 'session-backed access open',
      attention: fileServiceAccess(ctx) !== 'closed',
    },
  );

  /* Network -------------------------------------------------------- */

  for (const rule of networkPosture(ctx)) {
    facts.push({
      source: 'network',
      key: rule.indicator,
      state:
        rule.verdict === 'deny'
          ? `deny at ${rule.enforcedAt === 'egress_proxy' ? 'egress proxy' : 'mail gateway'}`
          : 'allow',
      attention: rule.verdict === 'allow',
    });
  }
  facts.push({
    source: 'network',
    key: 'egress',
    state: egressStatus(ctx),
    attention: egressStatus(ctx) === 'open',
  });

  /* Scope ---------------------------------------------------------- */

  const radius = blastRadius(ctx);
  facts.push({
    source: 'scope',
    key: 'blast-radius',
    state: `${radius.compromised} compromised, ${radius.targeted} targeted, ${radius.assetsInScope} assets (${radius.verified ? 'verified' : 'unverified'})`,
    attention: !radius.verified,
  });

  /* Incident ------------------------------------------------------- */

  const status = incidentStatus(ctx);
  facts.push({
    source: 'incident',
    key: INCIDENT_ID,
    state: status === 'closed' ? `closed (${ctx.ending ?? 'partial'})` : status,
    attention: status === 'active',
  });

  return facts;
}

/**
 * What actually moved between two snapshots.
 *
 * Only changed facts survive, so an operation's `effects` list is a claim the
 * simulation can back. An empty diff means the operation had no observable
 * effect, which redesign §6 makes a defect rather than an acceptable outcome.
 */
export function diffSources(
  before: readonly SourceFact[],
  after: readonly SourceFact[],
): OperationEffect[] {
  const previous = new Map(before.map((fact) => [`${fact.source}/${fact.key}`, fact.state]));
  const effects: OperationEffect[] = [];

  for (const fact of after) {
    const was = previous.get(`${fact.source}/${fact.key}`);
    if (was === undefined || was === fact.state) continue;
    effects.push({ source: fact.source, key: fact.key, before: was, after: fact.state });
  }

  return effects;
}

/* ------------------------------------------------------------------ *
 * Consequence preview and verification
 * ------------------------------------------------------------------ */

/**
 * The context this operation *would* produce, for the source layer only.
 *
 * A consequence preview written by hand is the same lie `effects` exists to
 * prevent, one step earlier: it would be free to promise that resetting the
 * password kills the stolen session, and nothing would catch it until the
 * operator had already clicked. So the preview is built the only honest way —
 * clone the context, apply exactly the fields the engine applies, and diff the
 * same snapshot.
 *
 * Only the fields `sourceSnapshot()` reads are set: `performedActions`,
 * `findings`, and for `close_case` the ending. Score, flags, conditional
 * penalties and the tool log are deliberately absent — none of them is a source
 * fact, and reproducing them here would be a second engine. `sources.test.ts`
 * asserts the preview equals the effects the real engine reports for every
 * response action, which is what keeps the two in step.
 */
function previewContext(ctx: GameContext, actionId: ResponseActionId): GameContext {
  const action = RESPONSE_ACTION_BY_ID.get(actionId);
  const resolved = action?.resolvesFindings ?? [];

  const findings = ctx.findings.map((record) =>
    resolved.includes(record.id) && !record.resolved
      ? { ...record, resolved: true, resolvedBy: actionId }
      : record,
  );

  const base: GameContext = {
    ...ctx,
    findings,
    performedActions: [
      ...ctx.performedActions,
      { actionId, seq: ctx.seq + 1, at: incidentClock(ctx), origin: 'human' as const },
    ],
  };

  if (actionId !== 'close_case') return base;
  return {
    ...base,
    caseClosed: true,
    ending: unresolvedCriticalFindings(base).length === 0 ? 'contained' : 'partial',
  };
}

/**
 * What this operation would change, before it is authorised.
 *
 * The same before/after shape the operation returns afterwards, so "this will
 * happen" and "this happened" are the same sentences in the same order — which
 * is what makes the second one verifiable rather than merely reassuring.
 */
export function previewEffects(ctx: GameContext, actionId: ResponseActionId): OperationEffect[] {
  return diffSources(sourceSnapshot(ctx), sourceSnapshot(previewContext(ctx, actionId)));
}

export type VerificationState = 'pending' | 'verified' | 'partial';

export interface Verification {
  actionId: ResponseActionId;
  state: VerificationState;
  /** Facts the operation moved, as they read now. */
  confirmed: SourceFact[];
  /** Facts it moved that no longer read the way it left them. */
  outstanding: string[];
}

/**
 * Whether an operation is still the reason the sources read as they do.
 *
 * `pending` before it is applied, then `verified` when every fact it is *still*
 * solely responsible for reads the way it left it. Computed against the live
 * snapshot rather than against a stored receipt, so an operation whose effect
 * something else undid could not keep reporting itself as verified.
 * Containment that is only asserted is not containment — §6 is explicit that a
 * toast is not an effect, and this is that principle read backwards.
 *
 * The claim is deliberately narrower than "every fact it moved at the time".
 * Some facts have more than one owner: `conn_collector` is severed by
 * `isolate_endpoint` and blocked by `block_indicator`, and isolation is the
 * stronger cut. Once both are applied, removing `block_indicator` alone leaves
 * that connection severed, so it stops appearing in this action's confirmed
 * set — correctly, because the block is no longer what is holding it. The
 * operator is not told less than the truth: the connection is still shown as
 * stopped, by the operation that is actually stopping it.
 */
export function verifyAction(ctx: GameContext, actionId: ResponseActionId): Verification {
  if (!hasPerformed(ctx, actionId)) {
    return { actionId, state: 'pending', confirmed: [], outstanding: [] };
  }

  // Re-derive what this action was responsible for by removing it from the
  // context and diffing forward again: the same computation the preview does,
  // run against the world it actually produced.
  const withoutAction: GameContext = {
    ...ctx,
    performedActions: ctx.performedActions.filter((record) => record.actionId !== actionId),
  };
  const expected = diffSources(sourceSnapshot(withoutAction), sourceSnapshot(ctx));

  const now = new Map(sourceSnapshot(ctx).map((fact) => [`${fact.source}/${fact.key}`, fact]));
  const confirmed: SourceFact[] = [];
  const outstanding: string[] = [];

  for (const effect of expected) {
    const fact = now.get(`${effect.source}/${effect.key}`);
    if (fact && fact.state === effect.after) confirmed.push(fact);
    else outstanding.push(`${effect.key} — expected ${effect.after}`);
  }

  return {
    actionId,
    state: outstanding.length === 0 ? 'verified' : 'partial',
    confirmed,
    outstanding,
  };
}

/** How many `stillOpen` lines a result may carry. See the field's doc comment. */
export const STILL_OPEN_LIMIT = 4;

/**
 * Containment gaps that survived an operation, nearest first.
 *
 * "Nearest" means the sources the operation just touched, because that is where
 * a mistaken assumption lives: after `reset_credentials` the first two lines
 * are the replayed session and the still-valid issued token, which is precisely
 * the conclusion an agent would otherwise draw for itself and get wrong.
 */
export function stillOpen(
  ctx: GameContext,
  touched: readonly SourceId[] = [],
): string[] {
  const near = new Set(touched);
  const open = sourceSnapshot(ctx).filter((fact) => fact.attention);

  return [
    ...open.filter((fact) => near.has(fact.source)),
    ...open.filter((fact) => !near.has(fact.source)),
  ]
    .slice(0, STILL_OPEN_LIMIT)
    .map((fact) => `${fact.key} — ${fact.state}`);
}

/** The distinct sources an effect list touched, for `stillOpen` ordering. */
export function touchedSources(effects: readonly OperationEffect[]): SourceId[] {
  return [...new Set(effects.map((effect) => effect.source))];
}

/* ------------------------------------------------------------------ *
 * Live diagnostic rows
 * ------------------------------------------------------------------ */

/**
 * The rows a completed diagnostic shows *now*.
 *
 * `session_inventory` and `indicator_scope` report the state of live systems,
 * so revoking a session has to change what the session inventory says. Leaving
 * them frozen at the values they had when the diagnostic ran is the exact
 * failure redesign §6 describes: the score moves, the view does not.
 *
 * `auth_timeline` is deliberately *not* derived. It is a historical
 * authentication log, and a log that rewrote itself after a containment action
 * would be a far worse bug than a stale one.
 *
 * `DIAGNOSTIC_ROWS` stays exported and unchanged as the base text; this layers
 * on top of it rather than replacing it.
 */
export function diagnosticRows(ctx: GameContext, id: DiagnosticId): DiagnosticRow[] {
  if (id === 'session_inventory') return sessionInventoryRows(ctx);
  if (id === 'indicator_scope') return indicatorScopeRows(ctx);
  return DIAGNOSTIC_ROWS[id] ?? [];
}

function sessionInventoryRows(ctx: GameContext): DiagnosticRow[] {
  const revoked = hasPerformed(ctx, 'revoke_sessions');
  const rows: DiagnosticRow[] = sessionInventory(ctx).map((session) => {
    const detail =
      session.kind === 'token_replay'
        ? 'token replay'
        : session.kind === 'service'
          ? 'scheduled, expected'
          : 'legitimate';
    return {
      key: session.id,
      value: `${session.principalName === 'svc-backup' ? 'svc-backup' : 'd.arslan'} — ${session.state === 'revoked' ? 'REVOKED' : 'ACTIVE'} — ${session.device} — issued ${session.issuedAt} — ${detail}`,
      tone: session.tone,
    };
  });

  rows.push(
    revoked
      ? {
          key: 'note',
          value: `Terminated by "${tk(RESPONSE_ACTION_BY_ID.get('revoke_sessions')!.labelKey)}". A password reset alone would have left every row above ACTIVE.`,
          tone: 'good',
        }
      : {
          key: 'note',
          value: 'Resetting the password does not terminate any of the above.',
          tone: 'warn',
        },
  );

  return rows;
}

function indicatorScopeRows(ctx: GameContext): DiagnosticRow[] {
  const base = DIAGNOSTIC_ROWS.indicator_scope ?? [];
  const denied = new Map(
    networkPosture(ctx)
      .filter((rule) => rule.verdict === 'deny')
      .map((rule) => [rule.indicator, rule.enforcedAt]),
  );

  return base.map((row) => {
    const enforcedAt = denied.get(row.key);
    if (!enforcedAt) return row;
    return {
      key: row.key,
      value: `${row.value} — BLOCKED at ${enforcedAt === 'egress_proxy' ? 'egress proxy' : 'mail gateway'}`,
      tone: 'good',
    };
  });
}
