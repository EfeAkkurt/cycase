import { useGame } from '../../app/gameContext';
import { topology, type TopologyEdge, type TopologyNode } from '../../game/fixtures/telemetry';
import { t } from '../../i18n';
import { Icon, Panel, type IconName } from '../primitives';
import type { PanelMode } from './TelemetryPanel';

/**
 * Identity and device relationships.
 *
 * Recharts is deliberately *not* used here. A node graph is not a cartesian
 * chart, and forcing one into a scatter plot with custom shapes produces
 * exactly the toy look the rest of this change is removing. So it stays SVG —
 * but SVG that is drawn to a spec rather than by eye:
 *
 *  - one node geometry for every node: the same rounded rect, the same height,
 *    the same three slots (kind icon, identifier, state icon). A workstation
 *    and an identity differ by their icon, never by their outline.
 *  - orthogonal edge routing with rounded corners. Every edge leaves a node
 *    from an edge midpoint and enters the next one head-on, and edges sharing
 *    a channel are fanned across it instead of being drawn on top of one
 *    another.
 *  - state is carried three ways: an icon, a colour, and a word underneath.
 *    A reader who sees no colour at all still gets "Compromised" in text and a
 *    warning glyph in the node.
 *
 * The graph is also mirrored into a real table below it in full mode, so the
 * same information reaches a screen reader without going through the picture.
 */

/**
 * Neutral by default. Colour is reserved for state that matters: red for an
 * active compromise, amber for exposure, olive for contained. A node that is
 * merely *present* is bone, not a hue.
 */
const TONE_VAR = {
  critical: 'var(--status-error)',
  warning: 'var(--status-warning)',
  success: 'var(--status-success)',
  accent: 'var(--chart-cat-5)',
  muted: 'var(--chart-neutral)',
} as const;

const EDGE_VAR = {
  critical: 'var(--status-error)',
  success: 'var(--status-success)',
  accent: 'var(--chart-cat-5)',
  muted: 'var(--chart-edge-muted)',
} as const;

type Tone = keyof typeof TONE_VAR;

/** What the node *is*. */
const KIND_ICON: Record<TopologyNode['kind'], IconName> = {
  attacker: 'agent',
  internet: 'link',
  idp: 'shield',
  identity: 'key',
  workstation: 'device',
  service: 'node',
};

/** What state the node is *in*. Never colour alone — the glyph differs too. */
const STATE_ICON: Record<Tone, IconName> = {
  critical: 'alert',
  warning: 'eye',
  success: 'check',
  muted: 'block',
  accent: 'node',
};

const NODE_W = 116;
const NODE_H = 30;
const HALF_W = NODE_W / 2;
const HALF_H = NODE_H / 2;
/** Corner radius on an edge elbow. Inside the 6/8/12 lock. */
const ELBOW_R = 6;
const VIEW_BOX = '-20 10 440 214';

export function TopologyPanel({ mode = 'full' }: { mode?: PanelMode }) {
  const ctx = useGame();
  const { nodes, edges } = topology(ctx);
  const visibleNodes = nodes.filter((node) => !node.hidden);
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const visibleEdges = edges.filter((edge) => {
    if (edge.hidden) return false;
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    return Boolean(from && to && !from.hidden && !to.hidden);
  });

  const routes = routeEdges(visibleEdges, byId);
  const tones = [...new Set(visibleEdges.map((edge) => edge.tone))];

  const summary = `Identity and device relationships. ${visibleNodes
    .map((node) => `${node.label} is ${node.status.toLowerCase()}`)
    .join(', ')}.`;

  return (
    <Panel
      id="overview-topology"
      title={t('overview.topology')}
      compact={mode === 'compact'}
      headingLevel={mode === 'compact' ? 3 : 2}
    >
      <svg className="chart chart--graph" viewBox={VIEW_BOX} role="img" aria-label={summary}>
        <defs>
          {tones.map((tone) => (
            <marker
              key={tone}
              id={`topo-arrow-${tone}`}
              viewBox="0 0 8 8"
              refX={7}
              refY={4}
              markerWidth={5}
              markerHeight={5}
              orient="auto-start-reverse"
            >
              <path d="M0 1.2 L7 4 L0 6.8 Z" fill={EDGE_VAR[tone]} />
            </marker>
          ))}
        </defs>

        {routes.map((route) => (
          <path
            key={route.key}
            className="topo-edge"
            d={route.d}
            fill="none"
            stroke={EDGE_VAR[route.tone]}
            strokeWidth={route.tone === 'critical' ? 1.6 : 1.1}
            strokeDasharray={route.dashed ? '4 4' : undefined}
            strokeLinecap="round"
            opacity={route.tone === 'muted' ? 0.7 : 1}
            markerEnd={`url(#topo-arrow-${route.tone})`}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {visibleNodes.map((node) => (
          <Node key={node.id} node={node} />
        ))}
      </svg>

      {mode === 'full' ? (
        <div className="table-scroll">
          <table className="table">
            <caption className="sr-only">{t('overview.topology')}</caption>
            <thead>
              <tr>
                <th scope="col">Node</th>
                <th scope="col">{t('field.state')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleNodes.map((node) => (
                <tr key={node.id}>
                  <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                    {node.label}
                  </th>
                  <td>
                    <span className="row" style={{ gap: 'var(--space-2)' }}>
                      <span style={{ color: TONE_VAR[node.tone], display: 'inline-flex' }}>
                        <Icon name={STATE_ICON[node.tone]} size={14} />
                      </span>
                      {node.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * One node, one geometry
 * ------------------------------------------------------------------ */

function Node({ node }: { node: TopologyNode }) {
  const color = TONE_VAR[node.tone];
  const left = node.x - HALF_W;

  return (
    <g className="topo-node">
      <rect
        className="topo-node__box"
        x={left}
        y={node.y - HALF_H}
        width={NODE_W}
        height={NODE_H}
        rx={6}
        fill="var(--chart-node-fill)"
        stroke={color}
        strokeWidth={1.2}
        vectorEffect="non-scaling-stroke"
      />
      <g
        className="topo-node__kind"
        transform={`translate(${left + 7} ${node.y - 7.5})`}
        style={{ color: 'var(--text-secondary)' }}
      >
        <Icon name={KIND_ICON[node.kind]} size={15} />
      </g>
      <text
        x={left + 28}
        y={node.y}
        textAnchor="start"
        dominantBaseline="middle"
        fill="var(--text-primary)"
        fontSize={9}
        fontFamily="var(--type-font-mono)"
      >
        {node.label}
      </text>
      <g className="topo-node__state" transform={`translate(${left + NODE_W - 20} ${node.y - 6.5})`} style={{ color }}>
        <Icon name={STATE_ICON[node.tone]} size={13} />
      </g>
      <text
        className="topo-node__status"
        x={node.x}
        y={node.y + HALF_H + 11}
        textAnchor="middle"
        fill="var(--text-tertiary)"
        fontSize={8.5}
      >
        {node.status}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Edge routing
 * ------------------------------------------------------------------ */

interface Route {
  key: string;
  d: string;
  tone: TopologyEdge['tone'];
  dashed?: boolean;
}

/**
 * Orthogonal routes with rounded elbows.
 *
 * Horizontal edges leave the source's right face and enter the target's left
 * face, turning once in the channel between the two columns. Edges that share
 * a channel are fanned evenly across it, so three links into one column read
 * as three links rather than as one thick line.
 *
 * A vertical edge inside a column is offset to the left of centre, because the
 * node's status word sits directly under it and a line through a word is a
 * line nobody can read.
 */
function routeEdges(edges: TopologyEdge[], byId: Map<string, TopologyNode>): Route[] {
  // How many edges want each channel, so each one can be given its own lane.
  const channelCounts = new Map<number, number>();
  for (const edge of edges) {
    const from = byId.get(edge.from)!;
    const to = byId.get(edge.to)!;
    if (from.x === to.x) continue;
    const channel = Math.round(midChannel(from, to));
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
  }

  const used = new Map<number, number>();

  return edges.map((edge) => {
    const from = byId.get(edge.from)!;
    const to = byId.get(edge.to)!;
    const key = `${edge.from}-${edge.to}`;

    if (from.x === to.x) {
      const lane = from.x - 52;
      const startY = to.y > from.y ? from.y + HALF_H : from.y - HALF_H;
      const endY = to.y > from.y ? to.y - HALF_H : to.y + HALF_H;
      return { key, d: `M${lane} ${startY} L${lane} ${endY}`, tone: edge.tone, dashed: edge.dashed };
    }

    const rightwards = to.x > from.x;
    const startX = rightwards ? from.x + HALF_W : from.x - HALF_W;
    const endX = rightwards ? to.x - HALF_W : to.x + HALF_W;

    const channel = Math.round(midChannel(from, to));
    const total = channelCounts.get(channel) ?? 1;
    const index = used.get(channel) ?? 0;
    used.set(channel, index + 1);
    // Fan the lanes across the channel: one edge stays on the centre line, two
    // sit either side of it, and so on.
    const laneX = channel + (index - (total - 1) / 2) * 6;

    return {
      key,
      d: elbow(startX, from.y, laneX, endX, to.y),
      tone: edge.tone,
      dashed: edge.dashed,
    };
  });
}

function midChannel(from: TopologyNode, to: TopologyNode): number {
  const rightwards = to.x > from.x;
  const startX = rightwards ? from.x + HALF_W : from.x - HALF_W;
  const endX = rightwards ? to.x - HALF_W : to.x + HALF_W;
  return (startX + endX) / 2;
}

/** Horizontal, turn, vertical, turn, horizontal — with rounded corners. */
function elbow(x1: number, y1: number, xm: number, x2: number, y2: number): string {
  if (Math.abs(y1 - y2) < 0.5) return `M${x1} ${y1} L${x2} ${y2}`;

  const down = y2 > y1;
  const dirX1 = Math.sign(xm - x1) || 1;
  const dirX2 = Math.sign(x2 - xm) || 1;
  const dirY = down ? 1 : -1;
  const r = Math.min(ELBOW_R, Math.abs(y2 - y1) / 2, Math.abs(xm - x1), Math.abs(x2 - xm));

  return [
    `M${x1} ${y1}`,
    `L${xm - dirX1 * r} ${y1}`,
    `Q${xm} ${y1} ${xm} ${y1 + dirY * r}`,
    `L${xm} ${y2 - dirY * r}`,
    `Q${xm} ${y2} ${xm + dirX2 * r} ${y2}`,
    `L${x2} ${y2}`,
  ].join(' ');
}
