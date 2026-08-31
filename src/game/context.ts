import { FINDINGS, INCIDENT_START_SEC } from './fixtures/case001';
import type { GameContext } from './types';

/**
 * The opening state of every run. Pure and argument-free apart from the
 * operator name, so a test and a browser start from byte-identical state.
 */
export function createInitialContext(operatorName = 'Operator'): GameContext {
  return {
    stateVersion: 0,
    seq: 0,
    operatorName,

    // The one stored clock is the *incident* clock, and only ever that. It
    // advances three simulated seconds per real second plus the documented
    // per-command cost the engine charges. Real play time is derived from it
    // by `playSeconds()` in `game/live.ts` rather than stored a second time,
    // so the two readouts in the top bar can never drift apart (P0.6).
    clockSec: INCIDENT_START_SEC,
    caseOpenedAtSec: INCIDENT_START_SEC,

    inspectedArtifacts: [],
    ranDiagnostics: [],
    performedActions: [],
    decisions: {},
    destroyedArtifacts: [],
    disabledIdentities: [],
    unlockedActions: [],

    findings: FINDINGS.map((finding) => ({ id: finding.id, resolved: false })),
    flags: {},
    // Decision efficiency starts full and is spent by avoidable mistakes.
    scoreEntries: [
      {
        bucket: 'efficiency',
        delta: 15,
        reasonKey: 'score.baseline_efficiency',
        source: 'case:open',
        seq: 0,
      },
    ],

    idempotency: {},
    toolLog: [],
    commandLog: [],
    hintsRequested: 0,
    paused: false,

    caseClosed: false,
    ending: null,

    assistantState: 'idle',
    agentStatus: 'offline',
    route: 'command',
    investigateTab: 'siem',
    selectedArtifact: null,
    // The whole night, because that is the span of Case 001. Starting narrow
    // would hide the phishing delivery from a fresh case and make the console
    // look empty for a reason nobody chose.
    timeRange: 'night',
    focus: null,

    lastResult: null,
    lastDiagnostic: null,
    lastDecision: null,
    lastHint: null,
  };
}
