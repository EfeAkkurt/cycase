import { describe, expect, it } from 'vitest';

import { createInitialContext } from '../../src/game/context';
import { executeCommand } from '../../src/game/engine';
import { computeScore } from '../../src/game/scoring';
import { DECISIONS } from '../../src/game/fixtures/case001';
import {
  artifactAvailability,
  isFullyContained,
  openDecisionId,
  unresolvedCriticalFindings,
} from '../../src/game/selectors';
import type {
  ArtifactId,
  DecisionId,
  DecisionOptionId,
  DiagnosticId,
  GameContext,
  HintTopic,
  ResponseActionId,
  ToolResult,
} from '../../src/game/types';

/* ------------------------------------------------------------------ *
 * Test harness — a tiny driver that mirrors what GameRuntime does.
 * ------------------------------------------------------------------ */

class Driver {
  context: GameContext;
  results: ToolResult[] = [];

  constructor(operatorName = 'Operator') {
    this.context = createInitialContext(operatorName);
  }

  private run(kind: Parameters<typeof executeCommand>[1]['kind'], input: unknown): ToolResult {
    const outcome = executeCommand(this.context, {
      kind,
      input,
      origin: 'agent',
    } as Parameters<typeof executeCommand>[1]);
    this.context = outcome.context;
    const { seq: _seq, ...rest } = outcome.result;
    this.results.push(rest);
    return rest;
  }

  get version(): number {
    return this.context.stateVersion;
  }

  incident(): ToolResult {
    return this.run('get_incident', {});
  }

  inspect(artifactId: ArtifactId, version = this.version): ToolResult {
    return this.run('inspect_artifact', { artifactId, stateVersion: version });
  }

  diagnostic(diagnosticId: DiagnosticId, version = this.version): ToolResult {
    return this.run('run_diagnostic', { diagnosticId, stateVersion: version });
  }

  act(actionId: ResponseActionId, key = `k-${actionId}`, version = this.version): ToolResult {
    return this.run('take_response_action', {
      actionId,
      stateVersion: version,
      idempotencyKey: key,
    });
  }

  decide(
    decisionId: DecisionId,
    optionId: DecisionOptionId,
    key = `k-${decisionId}`,
    version = this.version,
  ): ToolResult {
    return this.run('submit_decision', {
      decisionId,
      optionId,
      stateVersion: version,
      idempotencyKey: key,
    });
  }

  hint(topic: HintTopic, version = this.version): ToolResult {
    return this.run('request_hint', { topic, stateVersion: version });
  }

  raw(kind: string, input: unknown): ToolResult {
    return this.run(kind as Parameters<typeof executeCommand>[1]['kind'], input);
  }
}

/** The full "correct analyst" path. Every step is a real tool call. */
function playPerfectRun(d = new Driver()): Driver {
  d.incident();
  d.decide('D1', 'D1_preserve_and_inspect');
  d.inspect('art_email_001');
  d.decide('D2', 'D2_compare_signin_telemetry');
  d.diagnostic('auth_timeline');
  d.inspect('art_cookie_001');
  d.decide('D3', 'D3_revoke_then_reset');
  d.diagnostic('session_inventory');
  d.act('revoke_sessions');
  d.act('reset_credentials');
  d.decide('D4', 'D4_collect_then_isolate');
  d.inspect('art_edr_001');
  d.act('isolate_endpoint');
  d.decide('D5', 'D5_sweep_indicators');
  d.diagnostic('indicator_scope');
  d.act('block_indicator');
  d.decide('D6', 'D6_verify_checklist');
  d.act('close_case');
  return d;
}

/* ------------------------------------------------------------------ *
 * Acceptance: the case can be completed end to end through tools only
 * ------------------------------------------------------------------ */

describe('Case 001 — full playthrough', () => {
  it('reaches the contained ending with every tool call succeeding', () => {
    const d = playPerfectRun();

    expect(d.results.every((r) => r.ok)).toBe(true);
    expect(d.context.caseClosed).toBe(true);
    expect(d.context.ending).toBe('contained');
    expect(unresolvedCriticalFindings(d.context)).toEqual([]);
    expect(isFullyContained(d.context)).toBe(true);
  });

  it('awards a perfect score for the perfect run', () => {
    const d = playPerfectRun();
    const score = computeScore(d.context.scoreEntries);

    expect(score.buckets.evidence).toEqual({ earned: 30, max: 30 });
    expect(score.buckets.containment).toEqual({ earned: 35, max: 35 });
    expect(score.buckets.scope).toEqual({ earned: 20, max: 20 });
    expect(score.buckets.efficiency).toEqual({ earned: 15, max: 15 });
    expect(score.total).toBe(100);
    expect(score.max).toBe(100);
  });

  it('resolves all five critical findings, each attributed to what closed it', () => {
    const d = playPerfectRun();
    const byId = Object.fromEntries(d.context.findings.map((f) => [f.id, f]));

    expect(byId.rogue_session_active?.resolvedBy).toBe('revoke_sessions');
    expect(byId.credentials_exposed?.resolvedBy).toBe('reset_credentials');
    expect(byId.endpoint_uncontained?.resolvedBy).toBe('isolate_endpoint');
    expect(byId.indicators_unblocked?.resolvedBy).toBe('block_indicator');
    expect(byId.scope_unverified?.resolvedBy).toBe('indicator_scope');
  });

  it('is byte-for-byte deterministic across identical runs', () => {
    const a = playPerfectRun();
    const b = playPerfectRun();
    expect(b.context).toEqual(a.context);
    expect(b.results).toEqual(a.results);
  });
});

/* ------------------------------------------------------------------ *
 * Acceptance #5: invalid, duplicate and stale calls cannot corrupt state
 * ------------------------------------------------------------------ */

describe('invalid input', () => {
  it('rejects an unknown artifact id without mutating state', () => {
    const d = new Driver();
    const before = { ...d.context };
    const result = d.raw('inspect_artifact', {
      artifactId: 'art_does_not_exist',
      stateVersion: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(d.context.stateVersion).toBe(before.stateVersion);
    expect(d.context.inspectedArtifacts).toEqual([]);
  });

  it('rejects a wrong argument type', () => {
    const d = new Driver();
    const result = d.raw('inspect_artifact', {
      artifactId: 'art_email_001',
      stateVersion: 'zero',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
  });

  it('rejects a missing idempotency key on a mutating call', () => {
    const d = new Driver();
    const result = d.raw('take_response_action', {
      actionId: 'revoke_sessions',
      stateVersion: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(d.context.performedActions).toEqual([]);
  });

  it('rejects an option that belongs to a different decision', () => {
    const d = new Driver();
    const result = d.decide('D1', 'D3_password_only');

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('INVALID_INPUT');
    expect(d.context.decisions.D1).toBeUndefined();
  });

  it('reports the current version on every rejection so the caller can recover', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');
    const version = d.version;
    const result = d.raw('run_diagnostic', { diagnosticId: 'nope', stateVersion: version });

    expect(result.ok).toBe(false);
    expect(result.stateVersion).toBe(version);
  });
});

describe('stale state', () => {
  it('rejects a call carrying an outdated stateVersion', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');
    expect(d.version).toBe(1);

    const result = d.inspect('art_email_001', 0);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('STALE_STATE');
    expect(result.stateVersion).toBe(1);
    expect(result.error?.recovery).toContain('get_incident');
    expect(d.context.inspectedArtifacts).toEqual([]);
  });

  it('rejects a call from the future too', () => {
    const d = new Driver();
    const result = d.inspect('art_email_001', 99);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('STALE_STATE');
  });

  it('does not make the state stale for read-only calls', () => {
    const d = new Driver();
    const before = d.version;
    d.incident();
    d.hint('evidence');
    expect(d.version).toBe(before);
  });
});

describe('idempotency', () => {
  it('replays a duplicate mutating call instead of applying it twice', () => {
    const d = playPerfectRun();
    // Re-send `revoke_sessions` with the key it originally used.
    const versionBefore = d.version;
    const performedBefore = d.context.performedActions.length;
    const scoreBefore = computeScore(d.context.scoreEntries).total;

    const replay = d.act('revoke_sessions', 'k-revoke_sessions', versionBefore);

    expect(replay.ok).toBe(true);
    expect(d.context.performedActions.length).toBe(performedBefore);
    expect(computeScore(d.context.scoreEntries).total).toBe(scoreBefore);
    expect(d.version).toBe(versionBefore);
  });

  it('returns the original result verbatim, including its original stateVersion', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect', 'dup-key');
    const original = d.results[d.results.length - 1];

    d.inspect('art_email_001');
    const replay = d.decide('D1', 'D1_preserve_and_inspect', 'dup-key');

    expect(replay).toEqual(original);
  });

  it('replays even when the retry carries a now-stale version', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect', 'dup-key');
    const original = d.results[d.results.length - 1];
    d.inspect('art_email_001');

    // Retry with the pre-application version — exactly what a network retry sends.
    const replay = d.decide('D1', 'D1_preserve_and_inspect', 'dup-key', 0);

    expect(replay.ok).toBe(true);
    expect(replay).toEqual(original);
  });

  it('treats a different key as a genuinely new call', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect', 'key-a');
    const second = d.decide('D1', 'D1_disable_account_now', 'key-b');

    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe('ACTION_NOT_ALLOWED');
    expect(d.context.decisions.D1?.optionId).toBe('D1_preserve_and_inspect');
  });
});

/* ------------------------------------------------------------------ *
 * Ordering and availability
 * ------------------------------------------------------------------ */

describe('action ordering', () => {
  it('refuses to close the case before the closing decision is submitted', () => {
    const d = new Driver();
    const result = d.act('close_case');

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ACTION_NOT_ALLOWED');
    expect(result.error?.recovery).toContain('D6');
    expect(d.context.caseClosed).toBe(false);
  });

  it('refuses a decision whose prerequisites are unmet, and names the recovery', () => {
    const d = new Driver();
    const result = d.decide('D4', 'D4_collect_then_isolate');

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('ACTION_NOT_ALLOWED');
    expect(d.context.decisions.D4).toBeUndefined();
  });

  it('locks an artifact until the diagnostic that surfaces it has run', () => {
    const d = new Driver();
    expect(artifactAvailability(d.context, 'art_signin_001')).toBe('locked');

    const blocked = d.inspect('art_signin_001');
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe('ACTION_NOT_ALLOWED');

    d.diagnostic('auth_timeline');
    expect(artifactAvailability(d.context, 'art_signin_001')).toBe('available');
    expect(d.inspect('art_signin_001').ok).toBe(true);
  });

  it('refuses to run the same diagnostic twice', () => {
    const d = new Driver();
    expect(d.diagnostic('auth_timeline').ok).toBe(true);
    const second = d.diagnostic('auth_timeline');

    expect(second.ok).toBe(false);
    expect(second.error?.code).toBe('ACTION_NOT_ALLOWED');
  });

  it('allows re-reading an inspected artifact without bumping the version', () => {
    const d = new Driver();
    d.inspect('art_email_001');
    const version = d.version;

    const reread = d.inspect('art_email_001');
    expect(reread.ok).toBe(true);
    expect(d.version).toBe(version);
  });

  it('advances decisions strictly in order', () => {
    const d = new Driver();
    expect(openDecisionId(d.context)).toBe('D1');

    d.decide('D1', 'D1_preserve_and_inspect');
    // D2 needs the email inspected as well as D1 resolved.
    expect(openDecisionId(d.context)).toBeNull();

    d.inspect('art_email_001');
    expect(openDecisionId(d.context)).toBe('D2');
  });
});

/* ------------------------------------------------------------------ *
 * Pedagogical branches: wrong options are valid, and they cost something
 * ------------------------------------------------------------------ */

describe('wrong decision branches', () => {
  it('destroys the phishing email when the analyst clears the alert instead', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');
    d.inspect('art_email_001');
    d.decide('D2', 'D2_compare_signin_telemetry');
    d.diagnostic('auth_timeline');
    d.decide('D3', 'D3_revoke_then_reset');
    d.decide('D4', 'D4_delete_email_and_close_alert');

    expect(artifactAvailability(d.context, 'art_email_001')).toBe('destroyed');
    expect(d.context.flags.phishing_email_deleted).toBe(true);

    const blocked = d.inspect('art_email_001');
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.code).toBe('ACTION_NOT_ALLOWED');
  });

  it('disables the identity when the analyst acts before preserving evidence', () => {
    const d = new Driver();
    d.decide('D1', 'D1_disable_account_now');

    expect(d.context.disabledIdentities).toContain('usr_dilara');
    expect(d.context.flags.evidence_at_risk).toBe(true);
  });

  it('penalises a blind revoke performed without the session inventory', () => {
    const d = new Driver();
    d.act('revoke_sessions');

    expect(d.context.flags.blind_revoke).toBe(true);
    const containment = computeScore(d.context.scoreEntries).buckets.containment.earned;
    // 10 for the revoke, minus the 4-point blind-revoke penalty.
    expect(containment).toBe(6);
  });

  it('penalises isolating the endpoint before reading the endpoint report', () => {
    const d = new Driver();
    d.act('isolate_endpoint');

    expect(d.context.flags.isolated_without_evidence).toBe(true);
    expect(computeScore(d.context.scoreEntries).buckets.evidence.earned).toBe(0);
  });

  it('reaches the partial-containment ending when critical findings stay open', () => {
    const d = new Driver();
    d.decide('D1', 'D1_disable_account_now');
    d.inspect('art_email_001');
    d.decide('D2', 'D2_trust_sender_display_name');
    d.diagnostic('auth_timeline');
    d.decide('D3', 'D3_password_only');
    d.act('reset_credentials');
    d.decide('D4', 'D4_delete_email_and_close_alert');
    d.decide('D5', 'D5_assume_single_account');
    d.decide('D6', 'D6_close_without_verifying');
    const close = d.act('close_case');

    expect(close.ok).toBe(true);
    expect(d.context.ending).toBe('partial');

    const data = close.data as { unresolvedCriticalFindings: string[] };
    expect(data.unresolvedCriticalFindings).toContain('rogue_session_active');
    expect(data.unresolvedCriticalFindings).toContain('endpoint_uncontained');
    expect(data.unresolvedCriticalFindings).toContain('indicators_unblocked');
    expect(data.unresolvedCriticalFindings).toContain('scope_unverified');
    expect(data.unresolvedCriticalFindings).not.toContain('credentials_exposed');
  });

  it('never lets a bucket go negative', () => {
    const d = new Driver();
    d.decide('D1', 'D1_disable_account_now');
    d.inspect('art_email_001');
    d.decide('D2', 'D2_trust_sender_display_name');

    const evidence = computeScore(d.context.scoreEntries).buckets.evidence.earned;
    expect(evidence).toBeGreaterThanOrEqual(0);
  });
});

/* ------------------------------------------------------------------ *
 * Hints
 * ------------------------------------------------------------------ */

describe('request_hint', () => {
  it('never changes the score or the state version', () => {
    const d = new Driver();
    const scoreBefore = computeScore(d.context.scoreEntries).total;
    const versionBefore = d.version;

    for (const topic of ['evidence', 'identity', 'containment', 'scope'] as HintTopic[]) {
      const result = d.hint(topic);
      expect(result.ok).toBe(true);
      expect((result.data as { affectsScore: boolean }).affectsScore).toBe(false);
    }

    expect(computeScore(d.context.scoreEntries).total).toBe(scoreBefore);
    expect(d.version).toBe(versionBefore);
    expect(d.context.hintsRequested).toBe(4);
  });

  it('returns state-matched guidance that changes as the case progresses', () => {
    const d = new Driver();
    const first = d.hint('containment').data as { hint: string };

    d.diagnostic('session_inventory');
    const second = d.hint('containment').data as { hint: string };

    expect(first.hint).not.toBe(second.hint);
  });
});

/* ------------------------------------------------------------------ *
 * get_incident payload
 * ------------------------------------------------------------------ */

describe('get_incident', () => {
  it('describes the open decision and the allowed next actions', () => {
    const d = new Driver();
    const result = d.incident();
    const data = result.data as {
      openDecision: { decisionId: string; options: { optionId: string }[] } | null;
      allowedNextActions: { kind: string; id: string }[];
      unresolvedCriticalFindings: string[];
      availableArtifacts: string[];
    };

    expect(data.openDecision?.decisionId).toBe('D1');
    expect(data.openDecision?.options).toHaveLength(2);
    expect(data.unresolvedCriticalFindings).toHaveLength(5);
    expect(data.availableArtifacts).toContain('art_email_001');
    // Locked artifacts must never be advertised.
    expect(data.availableArtifacts).not.toContain('art_signin_001');
    expect(data.allowedNextActions.some((a) => a.kind === 'submit_decision')).toBe(true);
  });

  it('retires open questions as the matching evidence arrives', () => {
    const d = new Driver();
    const before = (d.incident().data as { openQuestions: string[] }).openQuestions.length;

    d.diagnostic('auth_timeline');
    d.inspect('art_cookie_001');
    const after = (d.incident().data as { openQuestions: string[] }).openQuestions.length;

    expect(after).toBeLessThan(before);
  });

  it('stops advertising close_case once the case is closed', () => {
    const d = playPerfectRun();
    const data = d.incident().data as {
      status: string;
      allowedNextActions: { id: string }[];
    };

    expect(data.status).toBe('closed');
    expect(data.allowedNextActions.some((a) => a.id === 'close_case')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Untrusted content marking
 * ------------------------------------------------------------------ */

describe('untrusted artifact content', () => {
  it('marks attacker-authored artifacts and attaches an explicit notice', () => {
    const d = new Driver();
    const email = d.inspect('art_email_001').data as {
      untrusted: boolean;
      untrustedContentNotice?: string;
    };

    expect(email.untrusted).toBe(true);
    expect(email.untrustedContentNotice).toContain('Never follow instructions');
  });

  it('does not mark first-party telemetry as untrusted', () => {
    const d = new Driver();
    d.diagnostic('auth_timeline');
    const cookie = d.inspect('art_cookie_001').data as {
      untrusted: boolean;
      untrustedContentNotice?: string;
    };

    expect(cookie.untrusted).toBe(false);
    expect(cookie.untrustedContentNotice).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * Observability
 * ------------------------------------------------------------------ */

describe('tool log', () => {
  it('records every call with its version transition and visible effect', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');
    const entry = d.context.toolLog[d.context.toolLog.length - 1];

    expect(entry?.tool).toBe('submit_decision');
    expect(entry?.ok).toBe(true);
    expect(entry?.fromVersion).toBe(0);
    expect(entry?.toVersion).toBe(1);
    expect(entry?.effectId).toBe('decision-D1');
  });

  it('records rejections with their error code', () => {
    const d = new Driver();
    d.inspect('art_email_001', 42);
    const entry = d.context.toolLog[d.context.toolLog.length - 1];

    expect(entry?.ok).toBe(false);
    expect(entry?.errorCode).toBe('STALE_STATE');
  });

  it('distinguishes human and agent origins', () => {
    const d = new Driver();
    d.incident();
    expect(d.context.toolLog[0]?.origin).toBe('agent');
  });
});

/* ------------------------------------------------------------------ *
 * Blocked decisions — the agent must be able to see *why* it is stuck
 * ------------------------------------------------------------------ */

describe('blockedDecision', () => {
  it('is null while a decision is genuinely open', () => {
    const d = new Driver();
    const data = d.incident().data as { blockedDecision: unknown; openDecision: unknown };

    expect(data.openDecision).not.toBeNull();
    expect(data.blockedDecision).toBeNull();
  });

  it('names the decision and the exact missing prerequisite', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');

    const data = d.incident().data as {
      openDecision: unknown;
      blockedDecision: {
        decisionId: string;
        missing: { artifacts: string[]; diagnostics: string[]; decisions: string[] };
      } | null;
    };

    expect(data.openDecision).toBeNull();
    expect(data.blockedDecision?.decisionId).toBe('D2');
    expect(data.blockedDecision?.missing.artifacts).toEqual(['art_email_001']);
    expect(data.blockedDecision?.missing.diagnostics).toEqual([]);
  });

  it('flags the unblocking step in allowedNextActions', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');

    const data = d.incident().data as {
      allowedNextActions: { kind: string; id: string; rationale: string }[];
    };
    const email = data.allowedNextActions.find((a) => a.id === 'art_email_001');

    expect(email?.rationale).toContain('D2');
  });

  it('clears once the prerequisite is satisfied', () => {
    const d = new Driver();
    d.decide('D1', 'D1_preserve_and_inspect');
    d.inspect('art_email_001');

    const data = d.incident().data as { blockedDecision: unknown; openDecision: { decisionId: string } | null };
    expect(data.blockedDecision).toBeNull();
    expect(data.openDecision?.decisionId).toBe('D2');
  });

  it('is null once every decision is resolved', () => {
    const d = playPerfectRun();
    const data = d.incident().data as { blockedDecision: unknown; openDecision: unknown };

    expect(data.blockedDecision).toBeNull();
    expect(data.openDecision).toBeNull();
  });

  it('keeps get_incident free of side effects', () => {
    const d = new Driver();
    const before = structuredClone({ ...d.context, seq: 0, toolLog: [], lastResult: null });
    d.incident();
    d.incident();
    const after = structuredClone({ ...d.context, seq: 0, toolLog: [], lastResult: null });

    expect(after).toEqual(before);
  });
});

/* ------------------------------------------------------------------ *
 * Fixture invariants — assumptions the selectors rely on, made explicit
 * ------------------------------------------------------------------ */

describe('decision fixture invariants', () => {
  it('only ever depends on decisions that come earlier in the list', () => {
    // `openDecisionId` scans in order and stops at the first locked decision;
    // `blockedDecisionView` takes the first unresolved one. Those two agree
    // only while prerequisites point strictly backwards. If that ever breaks,
    // an agent sees openDecision: null AND blockedDecision: null, which reads
    // as "case finished".
    const order = new Map(DECISIONS.map((decision, index) => [decision.id, index]));

    for (const decision of DECISIONS) {
      const self = order.get(decision.id)!;
      for (const required of decision.prerequisite.decisionsResolved ?? []) {
        expect(order.get(required), `${decision.id} requires ${required}`).toBeLessThan(self);
      }
    }
  });

  it('never leaves both openDecision and blockedDecision null while decisions remain', () => {
    // Walk the whole correct path and assert the pair is never (null, null)
    // until every decision really is resolved.
    const d = new Driver();
    const steps = [
      () => d.decide('D1', 'D1_preserve_and_inspect'),
      () => d.inspect('art_email_001'),
      () => d.decide('D2', 'D2_compare_signin_telemetry'),
      () => d.diagnostic('auth_timeline'),
      () => d.decide('D3', 'D3_revoke_then_reset'),
      () => d.decide('D4', 'D4_collect_then_isolate'),
      () => d.decide('D5', 'D5_sweep_indicators'),
    ];

    for (const step of steps) {
      step();
      const data = d.incident().data as { openDecision: unknown; blockedDecision: unknown };
      const resolved = Object.keys(d.context.decisions).length;
      if (resolved < 6) {
        expect(
          data.openDecision !== null || data.blockedDecision !== null,
          `after ${resolved} decisions the agent must be told what to do next`,
        ).toBe(true);
      }
    }
  });

  it('gives every decision exactly two options with distinct ids', () => {
    const seen = new Set<string>();
    for (const decision of DECISIONS) {
      expect(decision.options).toHaveLength(2);
      expect(decision.options.filter((o) => o.correct)).toHaveLength(1);
      for (const option of decision.options) {
        expect(seen.has(option.id), `duplicate optionId ${option.id}`).toBe(false);
        seen.add(option.id);
      }
    }
  });
});
