import { useGame, useRuntime } from '../../app/gameContext';
import { INVESTIGATE_TAB_META, correlation, siemEvents } from '../../game/investigate';
import { feedHealth, formatAge } from '../../game/live';
import { TIME_RANGES, type InvestigateTab, type InvestigationFocus } from '../../game/types';
import { t } from '../../i18n';
import { Badge, Button, Icon } from '../primitives';

/**
 * The controls that belong to the console rather than to any one tool.
 *
 * Before this existed the SIEM owned a time range in local React state, which
 * meant the range was a property of *one table* — narrow it, pivot to Identity,
 * and you were reading a different night with nothing on screen to say so. It
 * now lives in the case context beside `route` and `investigateTab`, so one
 * value is read by every view and by the compact monitors as well.
 *
 * Everything here is a real `<button>` with `aria-pressed` and the product's
 * own focus ring. The status sentence is the console's single polite live
 * region: one region, complete sentences, never a stream of digits.
 */

/* ------------------------------------------------------------------ *
 * Time range
 * ------------------------------------------------------------------ */

/**
 * Three ranges, as a segmented control.
 *
 * A native `<select>` paints its own popup in the platform's palette, and this
 * product's palette gate measures every pixel of the frame — so the segmented
 * control is a correctness requirement here, not a style preference.
 *
 * `idBase` exists because the same control appears on more than one
 * destination and two elements may not share an id.
 */
export function TimeRangeControl({ idBase }: { idBase: string }) {
  const ctx = useGame();
  const runtime = useRuntime();
  const labelId = `${idBase}-range-label`;

  return (
    <div className="console-bar__group" role="group" aria-labelledby={labelId}>
      <span className="eyebrow" id={labelId}>
        {t('console.range')}
      </span>
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        {TIME_RANGES.map((id) => (
          <Button
            key={id}
            size="sm"
            id={`${idBase}-range-${id}`}
            variant={ctx.timeRange === id ? 'primary' : 'ghost'}
            aria-pressed={ctx.timeRange === id}
            onClick={() => runtime.send({ type: 'SET_TIME_RANGE', range: id })}
          >
            {t(`investigate.siem.range.${id}`)}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** The active range as a phrase, for sentences that mention it. */
export function rangeLabel(range: (typeof TIME_RANGES)[number]): string {
  return t(`investigate.siem.range.${range}`);
}

/**
 * The note a range-filtered view shows when the range is holding rows back.
 *
 * A row that disappears without the interface naming the control that removed
 * it is how an analyst concludes a source is empty when it is merely narrowed —
 * so the count comes with the one control that undoes it.
 */
export function RangeNotice({ hidden, id }: { hidden: number; id?: string }) {
  const ctx = useGame();
  const runtime = useRuntime();
  if (hidden <= 0) return null;

  return (
    <p className="source-status" id={id}>
      <Badge tone="warning" icon="clock">
        {t('console.range')}
      </Badge>
      <span className="muted">
        {t(hidden === 1 ? 'console.range.hidden_one' : 'console.range.hidden', {
          count: hidden,
          range: rangeLabel(ctx.timeRange),
        })}
      </span>
      {ctx.timeRange === 'all' ? null : (
        <Button size="sm" onClick={() => runtime.send({ type: 'SET_TIME_RANGE', range: 'all' })}>
          {t('console.range.widen')}
        </Button>
      )}
    </p>
  );
}

/**
 * The line an inventory shows instead of filtering itself.
 *
 * Sessions, hosts, extensions and indicators answer "what is true now", and a
 * window has no meaning against a present-tense fact — SES-8811 was issued at
 * 02:12:40, so a 30-minute range would drop it and take the case's central
 * lesson with it. Saying so is how the operator can tell the tool read the
 * setting and chose not to hide anything.
 */
export function InventoryRangeNote() {
  const ctx = useGame();
  return (
    <p className="muted" style={{ fontSize: 'var(--type-xs-size)' }}>
      {t('console.range.inventory', { range: rangeLabel(ctx.timeRange) })}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Ingest and focus status
 * ------------------------------------------------------------------ */

/** A tool's display name, read from the one table that owns tab metadata. */
function tabLabel(tab: InvestigateTab): string {
  const meta = INVESTIGATE_TAB_META.find((entry) => entry.id === tab);
  return meta ? t(meta.labelKey) : tab;
}

export function focusLabel(focus: InvestigationFocus): string {
  return focus.label ?? focus.value;
}

/**
 * The console's one polite live region.
 *
 * Both facts a person needs read aloud after they change something — is the
 * console still receiving events, and what is it following — are here, as whole
 * sentences, in a single region. Two competing regions on one page interrupt
 * each other; a region of bare numbers is announced as digits.
 */
export function ConsoleStatus() {
  const ctx = useGame();
  const health = feedHealth(ctx);
  const indexed = siemEvents(ctx).length;
  const range = rangeLabel(ctx.timeRange);

  const ingest =
    indexed === 0
      ? t('console.ingest.quiet', { range })
      : t('console.ingest', {
          events: indexed,
          range,
          at: health.lastEventAt,
        });

  /*
   * The two ages tick once a second. They are deliberately kept out of the live
   * region below: a polite region that re-renders every second re-announces the
   * whole sentence every second, which buries the thing that actually changed
   * under a stream of "3 seconds ago, 4 seconds ago, 5 seconds ago". They stay
   * on screen and stay readable when a screen reader user browses the line;
   * they just do not interrupt.
   */
  const ages =
    (indexed === 0 ? '' : t('console.ingest.age', { age: formatAge(health.ageSec) })) +
    (health.agentAgeSec === null
      ? ''
      : t('console.ingest.agent', { age: formatAge(health.agentAgeSec) }));

  const focus = ctx.focus;
  let following = '';
  if (focus) {
    const elsewhere = correlation(ctx, focus).filter((entry) => entry.matches > 0);
    const tools = elsewhere.map((entry) => tabLabel(entry.tab)).join(', ');
    following =
      ` ${t('console.focus.following', { label: focusLabel(focus) })}` +
      (elsewhere.length > 0
        ? t('console.focus.matches', { tools })
        : t('console.focus.none_elsewhere'));
  }

  return (
    <p className="console-bar__status" id="console-status">
      <span className="console-bar__dot" aria-hidden="true" />
      {/*
        The live region is this inner span, not the paragraph. Everything inside
        it changes only when the feed's state changes or the operator follows
        something new -- both worth interrupting for. The ticking ages sit
        outside it and are announced only when someone reads the line.
      */}
      <span role="status" aria-live="polite" aria-atomic="true">
        {ingest}
        {following}
      </span>
      <span className="console-bar__age">{ages}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Focus
 * ------------------------------------------------------------------ */

/**
 * The chip that carries the selection, and the pivots it offers.
 *
 * Counts are on the controls themselves: an operator can see, before they
 * travel, that Endpoint holds three rows for this host and Email holds none.
 * A pivot that lands on an empty table teaches nothing except distrust.
 */
export function FocusBar() {
  const ctx = useGame();
  const runtime = useRuntime();
  const focus = ctx.focus;

  if (!focus) {
    return (
      <p className="muted console-bar__idle" style={{ fontSize: 'var(--type-xs-size)' }}>
        {t('console.focus.idle')}
      </p>
    );
  }

  const targets = correlation(ctx, focus).filter((entry) => entry.matches > 0);

  return (
    <div className="console-bar__focus" id="console-focus">
      <Badge tone="accent" icon="search">
        {t(`console.focus.kind.${focus.kind}`)}
      </Badge>
      <span className="mono console-bar__focus-value">{focusLabel(focus)}</span>

      {targets.map((entry) => (
        <Button
          key={entry.tab}
          size="sm"
          id={`pivot-${entry.tab}`}
          variant={ctx.investigateTab === entry.tab ? 'primary' : 'ghost'}
          aria-pressed={ctx.investigateTab === entry.tab}
          onClick={() =>
            runtime.send({ type: 'SET_FOCUS', focus, route: 'investigate', tab: entry.tab })
          }
        >
          {t('console.focus.pivot', { tool: tabLabel(entry.tab), count: entry.matches })}
        </Button>
      ))}

      <Button
        size="sm"
        id="focus-clear"
        onClick={() => runtime.send({ type: 'SET_FOCUS', focus: null })}
      >
        <Icon name="block" size={13} />
        {t('console.focus.clear', { label: focusLabel(focus) })}
      </Button>
    </div>
  );
}

/**
 * The control that starts a pivot, rendered inside a row.
 *
 * Small, ghost, and labelled with the value it would follow — so a screen
 * reader hears "Follow 203.0.113.47 across the tools" rather than a wall of
 * identical "Follow" buttons.
 */
export function FollowButton({
  focus,
  id,
  tab,
  showValue = true,
}: {
  focus: InvestigationFocus;
  id?: string;
  /** Where to land. Omit to stay where you are and only set the selection. */
  tab?: InvestigateTab;
  /**
   * False where the row already prints the value in its own header. Repeating
   * `WKS-114` twice in one cell is noise; the accessible name still carries it,
   * so nothing is lost to a screen reader.
   */
  showValue?: boolean;
}) {
  const ctx = useGame();
  const runtime = useRuntime();
  const active = ctx.focus?.kind === focus.kind && ctx.focus.value === focus.value;

  /*
   * The visible label is the value; the accessible name is the whole sentence.
   * A column of buttons all reading "Follow" is unusable with a screen reader,
   * and a column of buttons each reading "Follow 203.0.113.47 across the tools"
   * is unreadable with eyes. WCAG 2.5.3 is satisfied because the accessible
   * name contains the visible text.
   */
  const sentence = active
    ? t('console.focus.clear', { label: focusLabel(focus) })
    : t('console.focus.follow', { value: focusLabel(focus) });

  return (
    <Button
      size="sm"
      variant="ghost"
      id={id}
      aria-pressed={active}
      aria-label={sentence}
      title={sentence}
      onClick={() =>
        runtime.send({
          type: 'SET_FOCUS',
          focus: active ? null : focus,
          ...(tab && !active ? { route: 'investigate' as const, tab } : {}),
        })
      }
    >
      <Icon name="search" size={13} />
      {showValue ? (
        <span className="mono">{focusLabel(focus)}</span>
      ) : (
        /* "Following" rather than "Followed": the accessible name is "Stop
           following <value>", and WCAG 2.5.3 wants the visible text inside it. */
        <span>{active ? t('console.focus.following_short') : t('console.focus.follow_short')}</span>
      )}
    </Button>
  );
}

/** The marker a matching row carries. Text, never colour alone. */
export function FocusMark({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <Badge tone="accent" icon="check">
      {t('console.focus.match')}
    </Badge>
  );
}
