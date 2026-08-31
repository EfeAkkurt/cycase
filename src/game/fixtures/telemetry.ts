import { hasPerformed } from '../selectors';
import type { GameContext } from '../types';

/**
 * Telemetry shown on the office monitors and in the dashboard's overview.
 *
 * Every series here is a deterministic function of case state. There is no
 * randomness and no decorative jitter: docs/PROJECT_CONTEXT.md §7 requires that
 * "data changes are event-driven, not random visual noise", so a bar only moves
 * when something in the incident actually moved.
 */

export interface Series {
  label: string;
  tone: 'accent' | 'critical' | 'warning' | 'success' | 'muted';
  points: number[];
}

/** 24 five-minute buckets covering 02:00–04:00 on the incident night. */
export const BUCKET_COUNT = 24;
export const BUCKET_MINUTES = 5;

export function bucketLabel(index: number): string {
  const minutes = 120 + index * BUCKET_MINUTES;
  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Baseline background traffic — stable, boring, and that is the point. */
const BASELINE = [
  18, 16, 17, 15, 19, 16, 18, 20, 17, 16, 18, 19, 21, 24, 26, 23, 25, 27, 26, 24, 22, 20, 19, 18,
];

/** The attacker's activity, aligned to the incident chain. */
const ANOMALY = [
  0, 0, 0, 0, 0, 0, 0, 0, 2, 6, 4, 3, 3, 4, 12, 38, 61, 74, 58, 40, 66, 52, 31, 22,
];

/** Bucket index at which containment, once applied, takes effect. */
const CONTAINMENT_BUCKET = 20;

/**
 * Event stream. Revoking the stolen session flattens the attacker series from
 * the containment bucket onward — the single clearest "my tool call did
 * something" signal in the whole dashboard.
 */
export function eventStream(ctx: GameContext): { baseline: number[]; anomaly: number[] } {
  const contained = hasPerformed(ctx, 'revoke_sessions');
  const isolated = hasPerformed(ctx, 'isolate_endpoint');

  const anomaly = ANOMALY.map((value, index) => {
    if (index < CONTAINMENT_BUCKET) return value;
    if (contained && isolated) return 0;
    if (contained) return Math.round(value * 0.15);
    return value;
  });

  return { baseline: BASELINE, anomaly };
}

export interface Category {
  id: string;
  label: string;
  value: number;
  tone: 'accent' | 'critical' | 'warning' | 'success' | 'muted';
}

/**
 * Event categories. The mix shifts as evidence is collected, because collecting
 * evidence is what reclassifies raw events into named categories.
 */
export function eventCategories(ctx: GameContext): Category[] {
  const identityWeight = ctx.ranDiagnostics.includes('auth_timeline') ? 38 : 26;
  const endpointWeight = ctx.inspectedArtifacts.includes('art_edr_001') ? 24 : 14;
  const dataWeight = ctx.inspectedArtifacts.includes('art_dlp_001') ? 18 : 11;
  const networkWeight = 28;
  const other = Math.max(
    4,
    100 - identityWeight - endpointWeight - dataWeight - networkWeight,
  );

  return [
    { id: 'identity', label: 'Identity', value: identityWeight, tone: 'critical' },
    { id: 'network', label: 'Network', value: networkWeight, tone: 'muted' },
    { id: 'endpoint', label: 'Endpoint', value: endpointWeight, tone: 'warning' },
    { id: 'data', label: 'Data', value: dataWeight, tone: 'muted' },
    { id: 'other', label: 'Other', value: other, tone: 'muted' },
  ];
}

/** Severity trend over the same 24 buckets. */
export function severitySeries(ctx: GameContext): Series[] {
  const { anomaly } = eventStream(ctx);
  const critical = anomaly.map((v) => Math.round(v * 0.42));
  const high = anomaly.map((v, i) => Math.round(v * 0.3 + BASELINE[i]! * 0.12));
  const medium = BASELINE.map((v) => Math.round(v * 0.5));
  const low = BASELINE.map((v) => Math.round(v * 0.8));

  return [
    { label: 'Critical', tone: 'critical', points: critical },
    { label: 'High', tone: 'warning', points: high },
    { label: 'Medium', tone: 'accent', points: medium },
    { label: 'Low', tone: 'muted', points: low },
  ];
}

/** Headline counters for the incident brief. */
export function incidentCounters(ctx: GameContext): {
  affectedAssets: number;
  activeSessions: number;
  blockedIndicators: number;
} {
  const scoped = ctx.ranDiagnostics.includes('indicator_scope');
  return {
    affectedAssets: scoped ? 3 : 2,
    activeSessions: hasPerformed(ctx, 'revoke_sessions') ? 1 : 3,
    blockedIndicators: hasPerformed(ctx, 'block_indicator') ? 2 : 0,
  };
}

/* ------------------------------------------------------------------ *
 * Topology
 * ------------------------------------------------------------------ */

export interface TopologyNode {
  id: string;
  label: string;
  x: number;
  y: number;
  kind: 'internet' | 'idp' | 'workstation' | 'service' | 'attacker' | 'identity';
  tone: 'critical' | 'warning' | 'success' | 'accent' | 'muted';
  status: string;
  hidden?: boolean;
}

export interface TopologyEdge {
  from: string;
  to: string;
  tone: 'critical' | 'accent' | 'muted' | 'success';
  hidden?: boolean;
  dashed?: boolean;
}

/**
 * Identity/device relationship graph. Node positions are fixed; only tone and
 * status change, so the picture stays readable as the case progresses.
 */
export function topology(ctx: GameContext): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const revoked = hasPerformed(ctx, 'revoke_sessions');
  const isolated = hasPerformed(ctx, 'isolate_endpoint');
  const blocked = hasPerformed(ctx, 'block_indicator');
  const scoped = ctx.ranDiagnostics.includes('indicator_scope');
  const knowsReplay =
    ctx.ranDiagnostics.includes('auth_timeline') || ctx.inspectedArtifacts.includes('art_cookie_001');

  const nodes: TopologyNode[] = [
    {
      id: 'attacker',
      label: '203.0.113.47',
      x: 50,
      y: 34,
      kind: 'attacker',
      tone: blocked ? 'muted' : 'critical',
      status: blocked ? 'Blocked' : 'Active',
    },
    {
      id: 'internet',
      label: 'Egress',
      x: 50,
      y: 108,
      kind: 'internet',
      tone: blocked ? 'success' : 'warning',
      status: blocked ? 'Filtered' : 'Open',
    },
    {
      id: 'idp',
      label: 'IDP-01',
      x: 190,
      y: 70,
      kind: 'idp',
      tone: revoked ? 'success' : 'critical',
      status: revoked ? 'Sessions revoked' : 'Rogue session active',
    },
    {
      id: 'usr_dilara',
      label: 'd.arslan',
      x: 190,
      y: 158,
      kind: 'identity',
      tone: revoked ? 'warning' : 'critical',
      status: revoked ? 'Contained' : 'Compromised',
    },
    {
      id: 'WKS-114',
      label: 'WKS-114',
      x: 330,
      y: 34,
      kind: 'workstation',
      tone: isolated ? 'success' : 'critical',
      status: isolated ? 'Isolated' : 'Leaking cookies',
    },
    {
      id: 'SRV-FILES-02',
      label: 'SRV-FILES-02',
      x: 330,
      y: 122,
      kind: 'service',
      tone: revoked ? 'success' : 'warning',
      status: revoked ? 'Access closed' : 'Enumerated',
    },
    {
      id: 'WKS-231',
      label: 'WKS-231',
      x: 330,
      y: 196,
      kind: 'workstation',
      tone: 'warning',
      status: 'Same extension present',
      hidden: !scoped,
    },
  ];

  const edges: TopologyEdge[] = [
    { from: 'attacker', to: 'idp', tone: blocked ? 'muted' : 'critical', dashed: !knowsReplay },
    { from: 'attacker', to: 'internet', tone: blocked ? 'muted' : 'critical' },
    { from: 'idp', to: 'usr_dilara', tone: 'accent' },
    { from: 'idp', to: 'WKS-114', tone: isolated ? 'muted' : 'accent' },
    { from: 'usr_dilara', to: 'SRV-FILES-02', tone: revoked ? 'success' : 'critical' },
    { from: 'internet', to: 'SRV-FILES-02', tone: blocked ? 'muted' : 'critical' },
    { from: 'idp', to: 'WKS-231', tone: 'muted', hidden: !scoped, dashed: true },
  ];

  return { nodes, edges };
}
