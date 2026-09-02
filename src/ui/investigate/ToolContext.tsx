import { useGame, useStableGame } from '../../app/gameContext';
import { SAVED_QUERIES } from '../../game/investigate';
import { feedHealth, formatAge, latestBucket } from '../../game/live';
import { t } from '../../i18n';
import type { GameContext, InvestigateTab } from '../../game/types';
import { Badge, Icon, StatusDot } from '../primitives';
import { focusLabel, rangeLabel } from './ConsoleBar';

/**
 * "What am I looking at, and why?" — answered once, the same way, in all five
 * tools.
 *
 * The console already had every piece of this and nowhere to read it. The time
 * range lived on a segmented control at the top of the SIEM; the pivot lived on
 * a chip in the console bar; the query lived in an input; the *source system*
 * lived nowhere at all, so an analyst reading the Identity table had no way to
 * say which system produced the rows in front of them. Five tools each showing
 * a subset of that context is how someone ends up confidently describing the
 * wrong night.
 *
 * So this is one strip, above every table, carrying the five facts that decide
 * what a row means:
 *
 *   source        the system the rows came from
 *   query         the filter in force, or the absence of one, said out loud
 *   range         the window, named — not just selected on a control elsewhere
 *   saved query   which named query this is, when the text matches one
 *   following     the pivot that brought the analyst here, if any
 *
 * It is deliberately a `<dl>` rather than a row of chips. These are labelled
 * values, a screen reader should hear "Range: last 30 minutes" rather than a
 * bare "last 30 minutes", and the label is the thing that makes the value
 * answerable.
 */

/* ------------------------------------------------------------------ *
 * Feed state
 * ------------------------------------------------------------------ */

/**
 * Every state a tool's data can be in, named once.
 *
 * The point of the union is that five tools cannot invent five vocabularies.
 * Before this, "no rows" was rendered as a bare paragraph in three different
 * wordings and not rendered at all in the other two, so an empty Endpoint table
 * and a range-emptied Endpoint table looked identical — and those two mean
 * opposite things about whether the analyst should trust what they are seeing.
 *
 * Six of the eight are derived from real signals by `feedState` below.
 * `offline` and `error` are **not** derived, and that is deliberate rather than
 * an omission: nothing in Case 001 produces a collector outage or a failed
 * read, and the house rule this console follows is that a status nobody can
 * verify must not be shown. They are here, rendered and tested, because
 * `TelemetryAdapter` already models exactly these two
 * (`'connected' | 'reconnecting' | 'stale' | 'offline'`) and nothing in the UI
 * consumes it yet — wiring that means changing the provider, which is outside
 * this phase's file ownership. A caller that has a real signal passes it in;
 * until then no tool can claim to be offline.
 */
export type FeedState =
  | 'loading'
  | 'live'
  | 'paused'
  | 'stale'
  | 'empty'
  | 'partial'
  | 'offline'
  | 'error';

/**
 * How old the newest event may be, in *simulated* seconds, before a feed reads
 * as stale rather than live.
 *
 * 180 rather than a round 60, and the reason is the incident clock's own rate.
 * `INCIDENT_SECONDS_PER_PLAY_SECOND` is 3, so 180 simulated seconds is a minute
 * of a player sitting still — long enough that a quiet stretch during reading
 * is not reported as a fault, short enough that a genuinely stopped feed is
 * called out while the analyst is still on the same screen.
 */
export const STALE_AFTER_SEC = 180;

export interface FeedInputs {
  /** Rows this tool is currently showing. */
  shown: number;
  /** Rows it holds that the query, range or focus is keeping off screen. */
  hidden?: number;
  /** True while a lazily-loaded chunk this tool needs is still arriving. */
  loading?: boolean;
  /** A real transport signal, when one exists. See the note on `FeedState`. */
  transport?: 'offline' | 'error';
}

/**
 * Derives the state from what the tool actually has.
 *
 * Order matters and is the order an analyst would ask the questions in: can I
 * reach the source at all, is it still arriving, is the clock running, is there
 * anything here, and is something being kept from me.
 */
export function feedState(
  { shown, hidden = 0, loading = false, transport }: FeedInputs,
  paused: boolean,
  ageSec: number,
): FeedState {
  if (transport) return transport;
  if (loading) return 'loading';
  if (paused) return 'paused';
  /*
   * Emptiness outranks staleness, because "there is nothing here" is the more
   * actionable of the two and because an empty feed's age is the age of the
   * whole case rather than of anything this tool did.
   */
  if (shown === 0) return hidden > 0 ? 'partial' : 'empty';
  if (ageSec > STALE_AFTER_SEC) return 'stale';
  if (hidden > 0) return 'partial';
  return 'live';
}

const STATE_TONE = {
  loading: 'neutral',
  live: 'success',
  paused: 'neutral',
  stale: 'warning',
  empty: 'neutral',
  partial: 'warning',
  offline: 'critical',
  error: 'critical',
} as const;

/**
 * The chip, and the sentence under it.
 *
 * The chip is scannable and the sentence is what makes the state actionable —
 * "Paused" alone tells an analyst nothing about whether to wait. Both carry
 * text; neither relies on colour, which is what keeps `partial` and `stale`
 * distinguishable in the palette gate's greyscale as well as to a colour-blind
 * reader.
 */
export function FeedStateChip({
  state,
  shown,
  hidden = 0,
  ageSec,
  id,
}: {
  state: FeedState;
  shown: number;
  hidden?: number;
  ageSec?: number;
  id?: string;
}) {
  const values = {
    shown,
    hidden,
    age: ageSec === undefined ? '' : formatAge(ageSec),
  };

  return (
    <span className="tool-state" id={id} data-state={state}>
      <Badge tone={STATE_TONE[state]}>
        {/*
         * The dot pulses on `live` and only on `live`. A pulsing dot beside
         * "Paused" is the single most confusing thing a status line can do, and
         * `StatusDot` honours reduced motion for the rest.
         */}
        <StatusDot tone={STATE_TONE[state]} pulse={state === 'live'} />
        {t(`tool.state.${state}`)}
      </Badge>
      <span className="muted text-xs tool-state__detail">
        {t(`tool.state.${state}.detail`, values)}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * The context strip
 * ------------------------------------------------------------------ */

/**
 * The saved query whose text matches this one, if any.
 *
 * The empty query is deliberately not matched, even though `SAVED_QUERIES`
 * contains an "All events" entry whose text is `''`. Reporting it would put
 * "Saved query: All events" on the strip for every reader who has never touched
 * the control — it would read as a choice they made rather than as the absence
 * of a filter, and the Query fact one column to the left already says "no
 * filter" in words. A named query is worth reporting because it says what
 * someone was looking for; the absence of one is not.
 */
export function savedQueryFor(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed === '') return null;
  const match = SAVED_QUERIES.find((saved) => saved.query === trimmed);
  return match ? t(match.labelKey) : null;
}

export function ToolContext({
  tab,
  source,
  query,
  shown,
  hidden = 0,
  loading = false,
  transport,
  children,
}: {
  tab: InvestigateTab;
  /**
   * The system these rows came from, in the vendor's own words.
   *
   * Passed in rather than looked up, because it is a property of the *records*
   * a tool is showing rather than of the tool: Identity reads `IDP-01 /
   * sign-in logs` for one table and `IDP-01 / token telemetry` for another, and
   * flattening that to "Identity" would lose the distinction the case turns on.
   */
  source: string;
  /** The active filter text. Tools with no query bar pass nothing. */
  query?: string;
  shown: number;
  hidden?: number;
  loading?: boolean;
  transport?: 'offline' | 'error';
  /** Extra context a single tool owns, appended to the list. */
  children?: React.ReactNode;
}) {
  const ctx = useGame();
  const health = feedHealth(ctx);
  const state = feedState({ shown, hidden, loading, transport }, ctx.paused, health.ageSec);
  const saved = query === undefined ? null : savedQueryFor(query);
  const focus = ctx.focus;

  return (
    <div className="tool-context" id={`tool-context-${tab}`} data-state={state}>
      <dl className="tool-context__facts">
        <div className="tool-context__fact">
          <dt>{t('tool.context.source')}</dt>
          <dd className="mono">{source}</dd>
        </div>

        {query === undefined ? null : (
          <div className="tool-context__fact">
            <dt>{t('tool.context.query')}</dt>
            <dd className="mono">
              {query.trim() === '' ? (
                <span className="muted">{t('tool.context.query_none')}</span>
              ) : (
                query
              )}
            </dd>
          </div>
        )}

        {saved ? (
          <div className="tool-context__fact">
            <dt>{t('tool.context.saved')}</dt>
            <dd>{saved}</dd>
          </div>
        ) : null}

        <div className="tool-context__fact">
          <dt>{t('tool.context.range')}</dt>
          <dd>{rangeLabel(ctx.timeRange)}</dd>
        </div>

        {focus ? (
          <div className="tool-context__fact">
            <dt>{t('tool.context.following')}</dt>
            <dd>
              <span className="row" style={{ gap: 'var(--space-1)' }}>
                <Icon name="search" size={12} />
                <span className="mono">{focusLabel(focus)}</span>
                <span className="muted text-xs">
                  {t(`console.focus.kind.${focus.kind}`)}
                </span>
              </span>
            </dd>
          </div>
        ) : null}

        {children}
      </dl>

      <FeedStateChip
        state={state}
        shown={shown}
        hidden={hidden}
        ageSec={health.ageSec}
        id={`tool-state-${tab}`}
      />
    </div>
  );
}

/**
 * What a monitor shows instead of the strip.
 *
 * The office projects these tools onto a 520x306 surface and reads them from
 * across a room, where five labelled facts are unreadable and the tab strip is
 * already a label rather than a control — the console owns the choice of tool,
 * the monitor only displays it.
 *
 * So the compact surface gets the one fact that survives the distance and
 * changes what the rows *mean*: whether the feed is live, paused, stale or
 * empty. A monitor showing a frozen table with no indication that it is frozen
 * is worse than a monitor showing nothing.
 */
export function CompactToolState({ shown, hidden = 0 }: { shown: number; hidden?: number }) {
  const ctx = useGame();
  const health = feedHealth(ctx);
  const state = feedState({ shown, hidden }, ctx.paused, health.ageSec);
  return <FeedStateChip state={state} shown={shown} hidden={hidden} ageSec={health.ageSec} />;
}

/* ------------------------------------------------------------------ *
 * When a tool is allowed to re-render
 * ------------------------------------------------------------------ */

/**
 * True when two contexts would draw the same rows, the same counts and the
 * same selection.
 *
 * The tools subscribed with `useGame`, which republishes on every `TICK` — three
 * times a second of play. Five tables, their aggregations, their focus marks and
 * their row counts were therefore recomputed and reconciled once a second while
 * showing byte-identical output, and any row-level animation restarted with
 * them. Nothing on screen was moving; React was.
 *
 * What can genuinely move a row:
 *
 * - `stateVersion` — every case mutation, including the containment actions
 *   that rewrite the session table;
 * - `timeRange`, `siemQuery`, `focus` — the three controls that decide what is
 *   filtered in;
 * - `investigateTab` — which tool is mounted at all;
 * - `paused` — the state chip says so, so it has to be able to change it;
 * - the passage of time, but only where it crosses a boundary.
 *
 * That last one is why this compares `latestBucket` rather than `clockSec`. The
 * `last30` range's window edge slides continuously, so a row *can* leave it at
 * any second — but the console already promises a 30-second sample everywhere
 * else it shows time-series data, and having the tables move on the same beat
 * as the stream is the consistent reading rather than a compromise. It is also
 * exactly the 30–60 second rhythm this phase asks the live views to keep.
 *
 * The context strip is deliberately *not* covered by this: it subscribes with
 * `useGame` of its own so the "newest 12s ago" readout keeps counting, which
 * re-renders one small element rather than a table.
 */
export function sameToolData(previous: GameContext, next: GameContext): boolean {
  return (
    previous.stateVersion === next.stateVersion &&
    previous.timeRange === next.timeRange &&
    previous.siemQuery === next.siemQuery &&
    previous.investigateTab === next.investigateTab &&
    previous.paused === next.paused &&
    previous.focus?.kind === next.focus?.kind &&
    previous.focus?.value === next.focus?.value &&
    latestBucket(previous) === latestBucket(next)
  );
}

/** The subscription every investigation tool uses. */
export function useToolGame(): GameContext {
  return useStableGame(sameToolData);
}
