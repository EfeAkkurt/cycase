import { INCIDENT_START_SEC } from '../src/game/fixtures/case001';
import type { TelemetryEvent } from './apiContract';

/**
 * The deterministic telemetry fixture.
 *
 * Contract §5 gives `local` and `degraded` modes a "deterministic fixture" and
 * `connected` the choice of fixture or SSE. Both paths read this table, which
 * is the only way the two can be indistinguishable to the player: SSE delivers
 * the same events over the network that the local adapter would have produced
 * on its own clock.
 *
 * This is simulated data about a fictional company. §5 also forbids labelling it
 * as production telemetry, which is why every payload names a synthetic host or
 * identity and the UI strings say "simulation".
 */

interface FixtureEntry {
  /** Seconds after the incident opened. */
  offsetSec: number;
  source: TelemetryEvent['source'];
  severity: TelemetryEvent['severity'];
  entityIds: string[];
  kind: string;
  payload: TelemetryEvent['payload'];
}

const SCRIPT: FixtureEntry[] = [
  {
    offsetSec: 0,
    source: 'identity',
    severity: 'critical',
    entityIds: ['usr_dilara', 'IDP-01'],
    kind: 'impossible_travel',
    payload: { account: 'usr_dilara', from: 'Ankara', to: 'unknown', minutesApart: 4 },
  },
  {
    offsetSec: 20,
    source: 'network',
    severity: 'high',
    entityIds: ['WKS-114'],
    kind: 'suspicious_domain_contact',
    payload: { host: 'WKS-114', domain: 'cy-case-portal.example', verdict: 'newly_registered' },
  },
  {
    offsetSec: 45,
    source: 'endpoint',
    severity: 'medium',
    entityIds: ['WKS-114'],
    kind: 'browser_session_export',
    payload: { host: 'WKS-114', process: 'browser', artefact: 'session_cookie' },
  },
  {
    offsetSec: 75,
    source: 'data',
    severity: 'high',
    entityIds: ['SRV-FILES-02', 'usr_dilara'],
    kind: 'bulk_file_read',
    payload: { share: 'SRV-FILES-02', files: 214, windowSeconds: 90 },
  },
  {
    offsetSec: 110,
    source: 'system',
    severity: 'info',
    entityIds: ['IDP-01'],
    kind: 'directory_sync',
    payload: { service: 'IDP-01', status: 'ok' },
  },
  {
    offsetSec: 150,
    source: 'identity',
    severity: 'high',
    entityIds: ['svc_backup'],
    kind: 'service_account_signin',
    payload: { account: 'svc_backup', result: 'success', mfa: false },
  },
  {
    offsetSec: 190,
    source: 'network',
    severity: 'low',
    entityIds: ['WKS-231'],
    kind: 'dns_lookup',
    payload: { host: 'WKS-231', domain: 'files.cy-case.example', verdict: 'known_good' },
  },
  {
    offsetSec: 240,
    source: 'endpoint',
    severity: 'critical',
    entityIds: ['WKS-114'],
    kind: 'edr_detection',
    payload: { host: 'WKS-114', rule: 'credential_access', confidence: 'high' },
  },
];

/** Total scripted length. After this the fixture stops rather than repeating. */
export const TELEMETRY_FIXTURE_DURATION_SEC =
  SCRIPT.length > 0 ? SCRIPT[SCRIPT.length - 1]!.offsetSec : 0;

/**
 * Every event whose scenario time has arrived, as a pure function of the clock.
 *
 * `eventId` is derived from the sequence, not generated randomly, so the same
 * moment always produces the same id — which is what makes the contract's
 * "deduplicate by `eventId` in both server and client" testable at all.
 */
export function telemetryEventsUpTo(
  scenarioTimeSec: number,
  incidentStartSec = INCIDENT_START_SEC,
): TelemetryEvent[] {
  // Deliberately not clamped at zero: a clock before the incident opens has no
  // telemetry at all, and clamping would leak the first event into the intro.
  const elapsed = scenarioTimeSec - incidentStartSec;
  return SCRIPT.filter((entry) => entry.offsetSec <= elapsed).map((entry, index) =>
    materialize(entry, index + 1, incidentStartSec),
  );
}

/** The events in `(afterSequence, now]`, for a reconnect that carries Last-Event-ID. */
export function telemetryEventsAfter(
  afterSequence: number,
  scenarioTimeSec: number,
  incidentStartSec = INCIDENT_START_SEC,
): TelemetryEvent[] {
  return telemetryEventsUpTo(scenarioTimeSec, incidentStartSec).filter(
    (event) => event.sequence > afterSequence,
  );
}

export function telemetryFixtureLength(): number {
  return SCRIPT.length;
}

function materialize(
  entry: FixtureEntry,
  sequence: number,
  incidentStartSec: number,
): TelemetryEvent {
  const scenarioTimeSec = incidentStartSec + entry.offsetSec;
  return {
    eventId: `evt_case001_${String(sequence).padStart(4, '0')}`,
    sequence,
    scenarioTimeSec,
    source: entry.source,
    severity: entry.severity,
    entityIds: [...entry.entityIds],
    kind: entry.kind,
    payload: { ...entry.payload },
    // Simulated wall time derived from the scenario clock, never `Date.now()`:
    // an event's identity must not depend on when it was rendered.
    emittedAt: new Date(Date.UTC(2026, 7, 29, 0, 0, 0) + scenarioTimeSec * 1000).toISOString(),
  };
}
