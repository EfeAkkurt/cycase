import { INCIDENT_ID } from '../../game/fixtures/case001';
import { clocks, currentRate, feedHealth, formatAge } from '../../game/live';
import { formatElapsed, incidentStatus } from '../../game/selectors';
import type { DashboardRoute, GameContext } from '../../game/types';
import { t } from '../../i18n';
import type { StringKey } from '../../i18n';
import type { Tone } from '../primitives';

/* ------------------------------------------------------------------ *
 * Operations-console shell — the pure half
 * ------------------------------------------------------------------ *
 *
 * Everything in this file is a function of `GameContext` and nothing else. It
 * exists so the console shell has no state of its own: the sidebar reads the
 * same numbers `get_incident` returns, in one place, and a compact surface that
 * wants three of the eight rows filters this list rather than recomputing any
 * of them.
 *
 * The geometry constants are here for the same reason. A 240px sidebar that
 * collapses to a 72px rail is a contract between the CSS custom properties, the
 * markup and the Playwright measurement — three places that drift the moment
 * the number is typed three times.
 * ------------------------------------------------------------------ */

/** Expanded sidebar width. Matches `--sidebar-w` in `src/styles/tokens.css`. */
export const SIDEBAR_WIDTH = 240;

/** Collapsed rail width. Matches `--sidebar-w-rail`. */
export const SIDEBAR_RAIL_WIDTH = 72;

/** Expanded learning-rail width. Matches `--rail-w`. */
export const RAIL_WIDTH = 320;

/** Collapsed learning-rail width. Matches `--rail-w-collapsed`. */
export const RAIL_COLLAPSED_WIDTH = 44;

/** Navigation row height — the design system's density lock. */
export const NAV_ITEM_HEIGHT = 36;

/** Visible control height. Hit area is `HIT_TARGET`, not this. */
export const CONTROL_HEIGHT = 32;

/** Accessible hit target for 32px controls. Matches `--hit-target`. */
export const HIT_TARGET = 44;

/** The base unit every spacing token in the system is a multiple of. */
export const GRID_UNIT = 4;

export const PRIMARY_STATUS_IDS = [
  'incident-id',
  'incident-severity',
  'feed-health',
  'agent-status',
] as const;

export const DETAIL_STATUS_IDS = [
  'play-clock',
  'incident-clock',
  'event-rate',
  'state-version',
] as const;

export type PrimaryStatusId = (typeof PRIMARY_STATUS_IDS)[number];
export type DetailStatusId = (typeof DETAIL_STATUS_IDS)[number];

export function sidebarWidth(collapsed: boolean): number {
  return collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH;
}

export function railWidth(collapsed: boolean): number {
  return collapsed ? RAIL_COLLAPSED_WIDTH : RAIL_WIDTH;
}

export function isPrimaryStatus(id: string): id is PrimaryStatusId {
  return (PRIMARY_STATUS_IDS as readonly string[]).includes(id);
}

export function isDetailStatus(id: string): id is DetailStatusId {
  return (DETAIL_STATUS_IDS as readonly string[]).includes(id);
}

/**
 * True when a pixel value sits on the 4px token grid.
 *
 * Used by the token test to hold the grid, and by nothing at runtime — a
 * spacing scale is only a scale while every step is on it.
 */
export function onGrid(px: number): boolean {
  return Number.isInteger(px) && px >= 0 && px % GRID_UNIT === 0;
}

/* ------------------------------------------------------------------ *
 * Incident status
 * ------------------------------------------------------------------ */

/**
 * One row of the sidebar's "Incident status" group.
 *
 * `id` is the DOM id the row's value carries. Those ids are the contract the
 * E2E suite and the WebMCP evidence both read (`#play-clock`, `#state-version`
 * …), so they are named here rather than typed into JSX.
 */
export interface StatusRow {
  id: string;
  label: string;
  value: string;
  /** Rendered after the value, smaller and dimmer. Never the only carrier. */
  detail?: string;
  /** Rendered inside the value node, decorative, for the clock multiplier. */
  suffix?: string;
  tone?: Tone;
  pulse?: boolean;
  mono?: boolean;
  /** id of an `sr-only` node that explains the value. */
  describedBy?: string;
}

function agentLabel(ctx: GameContext): string {
  if (ctx.agentStatus === 'working') return t('topbar.agent.working');
  if (ctx.agentStatus === 'connected') return t('topbar.agent.connected');
  return t('topbar.agent.offline');
}

function severityLabel(status: ReturnType<typeof incidentStatus>): string {
  if (status === 'active') return t('overview.severity.critical');
  if (status === 'contained') return t('overview.status.contained');
  return t('overview.status.closed');
}

/**
 * The eight numbers that used to be strung across the top bar.
 *
 * Order is the brief's: identity of the case first, then how bad it is, then
 * the two clocks, then the health of what is feeding it, then the two numbers
 * that say whether the machine and the agent are still with you.
 */
export function incidentStatusRows(ctx: GameContext): StatusRow[] {
  const status = incidentStatus(ctx);
  const clock = clocks(ctx);
  const feed = feedHealth(ctx);
  const rate = currentRate(ctx);

  return [
    {
      id: 'incident-id',
      label: t('topbar.incident'),
      value: INCIDENT_ID,
      mono: true,
    },
    {
      id: 'incident-severity',
      label: t('topbar.severity'),
      value: severityLabel(status),
      tone: status === 'active' ? 'critical' : 'success',
      pulse: status === 'active',
    },
    {
      id: 'play-clock',
      label: t('clock.play'),
      value: formatElapsed(clock.playSec),
      mono: true,
    },
    {
      id: 'incident-clock',
      label: t('clock.incident'),
      value: formatElapsed(clock.incidentSec),
      suffix: t('clock.multiplier', { multiplier: clock.multiplier }),
      mono: true,
      describedBy: 'clock-explainer',
    },
    {
      id: 'event-rate',
      label: t('topbar.rate'),
      value: t('topbar.rate.value', { total: rate.total }),
      mono: true,
    },
    {
      id: 'feed-health',
      label: t('topbar.feed'),
      value: feed.lastEventAt,
      detail: ctx.paused
        ? t('topbar.paused')
        : t('topbar.feed.age', { age: formatAge(feed.ageSec) }),
      tone: ctx.paused ? 'warning' : 'success',
      mono: true,
    },
    {
      id: 'state-version',
      label: t('topbar.state_version'),
      value: `v${ctx.stateVersion}`,
      mono: true,
    },
    {
      id: 'agent-status',
      label: t('topbar.agent'),
      value: agentLabel(ctx),
      detail: feed.agentAgeSec === null ? undefined : formatAge(feed.agentAgeSec),
      tone: ctx.agentStatus === 'offline' ? 'neutral' : 'accent',
      pulse: ctx.agentStatus === 'working',
    },
  ];
}

export function incidentStatusPrimaryRows(ctx: GameContext): StatusRow[] {
  return incidentStatusRows(ctx).filter((row) => isPrimaryStatus(row.id));
}

export function incidentStatusDetailRows(ctx: GameContext): StatusRow[] {
  return incidentStatusRows(ctx).filter((row) => isDetailStatus(row.id));
}

/**
 * The sentence the status group announces.
 *
 * Deliberately *not* the eight rows wrapped in a live region. The play clock
 * ticks every second, and a polite region over these values would read a stream
 * of numbers at a screen-reader user for the whole session — which is the exact
 * failure the accessibility contract names. So the announced text is a sentence
 * built only from the values that change on a real transition: severity, the
 * state version, whether the feed is running and whether an agent is attached.
 */
export function incidentStatusSentence(ctx: GameContext): string {
  return t('sidebar.status.sentence', {
    incident: INCIDENT_ID,
    severity: severityLabel(incidentStatus(ctx)),
    version: ctx.stateVersion,
    feed: ctx.paused ? t('sidebar.status.feed_paused') : t('sidebar.status.feed_live'),
    agent: agentLabel(ctx),
  });
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

export interface NavA11y {
  /**
   * The accessible name. Collapsed, the visible label is gone and the chip
   * loses its context, so the name has to carry both — an icon-only rail that
   * announces "Investigate" and nothing else has thrown away the badge a
   * sighted user can still read.
   *
   * The count reaches it as a *sentence*, never as the visible "2/6". The chip
   * is a glanceable abbreviation for someone who can see the column it sits in;
   * read aloud on its own it is a pair of numbers with no noun.
   */
  accessibleName: string;
  /** Native tooltip. Only useful once the label is hidden. */
  title: string | undefined;
  /** Whether the visible text label is rendered. */
  showLabel: boolean;
}

/**
 * What a destination row exposes at a given sidebar width.
 *
 * A locked destination says why in its name in both states: "unlocks when the
 * case is closed" is the whole reason the row is disabled, and a disabled
 * control that does not say why is the audit finding this product already
 * closed once.
 */
export function navItemA11y(options: {
  label: string;
  countLabel: string;
  locked: boolean;
  lockedReason: string;
  collapsed: boolean;
}): NavA11y {
  const { label, countLabel, locked, lockedReason, collapsed } = options;

  const parts = [label];
  if (locked) parts.push(lockedReason);
  else if (countLabel) parts.push(countLabel);

  const accessibleName = parts.join(' — ');

  return {
    accessibleName,
    // A tooltip only when the eye is missing something the name has: the label
    // itself once the rail is collapsed, or the reason a row is disabled.
    title: collapsed || locked ? accessibleName : undefined,
    showLabel: !collapsed,
  };
}

/** Page title for the active destination. */
export function destinationTitle(route: DashboardRoute): string {
  return t(`nav.${route}` as StringKey);
}
