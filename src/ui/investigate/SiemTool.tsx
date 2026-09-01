import { useId } from 'react';

import { useCommand, useGame, useRuntime } from '../../app/gameContext';
import {
  SAVED_QUERIES,
  aggregateBy,
  hiddenByRange,
  matchesFocus,
  queryNotes,
  searchEvents,
  siemEvents,
  type SiemEvent,
} from '../../game/investigate';
import { t, tk } from '../../i18n';
import type { PanelMode } from '../panels/mode';
import { Badge, Button, Icon } from '../primitives';
import { FocusMark, FollowButton, RangeNotice, TimeRangeControl } from './ConsoleBar';

/**
 * SIEM — query bar, saved queries, time range, raw events and aggregation.
 *
 * The index is not a separate dataset: it is the incident chain the case
 * already exposes through `visibleTimeline`, plus the operations the operator
 * performed. So a search cannot reveal an event the analyst has not earned, and
 * `revoke_sessions` shows up in the same table that showed the session being
 * stolen — which is what §6 means by an operation having observable effects.
 */
export function SiemTool({ mode = 'full' }: { mode?: PanelMode }) {
  const ctx = useGame();
  const runtime = useRuntime();
  /*
   * The query lives in case context, not in this component.
   *
   * Leaving Investigate unmounts the tool, and with it a `useState` query — so
   * writing a query, pivoting to Evidence to read what it surfaced and coming
   * back landed the analyst on an empty bar and a full table. It is still a
   * view selection: an assign-only machine event, no `stateVersion`, nothing in
   * the command log, nothing replayed.
   */
  const query = ctx.siemQuery;
  const setQuery = (next: string) => runtime.send({ type: 'SET_SIEM_QUERY', query: next });
  const notesId = useId();

  const total = siemEvents(ctx).length;

  if (mode === 'compact') {
    // Monitor distance: the newest handful of rows, no query chrome at all.
    const recent = searchEvents(ctx, { query: '' }).slice(-5).reverse();
    return (
      <div className="stack stack--tight">
        {recent.length === 0 ? (
          <p className="muted text-xs">
            {t('investigate.siem.empty_index')}
          </p>
        ) : (
          <ul className="tool-rows">
            {recent.map((event) => (
              <li key={event.id} className="tool-rows__row">
                <span className="mono tool-rows__time">{event.at}</span>
                <span
                  className={
                    event.severity === 'critical'
                      ? 'dot dot--critical'
                      : event.severity === 'warn'
                        ? 'dot dot--warning'
                        : 'dot dot--accent'
                  }
                />
                <span className="tool-rows__label">{event.message}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mono muted text-xs">
          {t('investigate.siem.matched', { matched: recent.length, total })}
        </p>
      </div>
    );
  }

  const matched = searchEvents(ctx, { query });
  const bySource = aggregateBy(matched, 'sourceType');
  const bySeverity = aggregateBy(matched, 'severity');
  const notes = queryNotes(query);
  const outsideRange = hiddenByRange(ctx, query);

  return (
    <div className="stack">
      <div className="tool-query">
        <label className="tool-query__field">
          <span className="eyebrow">{t('investigate.siem.query')}</span>
          <input
            id="siem-query"
            type="search"
            className="tool-query__input mono"
            value={query}
            placeholder={t('investigate.siem.query_placeholder')}
            /* Only reference the notes region while it exists: an
               `aria-describedby` pointing at an id that is not in the document
               is an invalid attribute value, not a harmless no-op. */
            aria-describedby={
              notes.length > 0 ? `siem-query-hint ${notesId}` : 'siem-query-hint'
            }
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <div className="tool-query__field tool-query__field--narrow">
          {/*
           * The range control belongs to the console, not to this table. It
           * renders here because this is where a query gets written, but the
           * value it writes is read by Identity, Endpoint, Network, Email and
           * the chronology too — a range only one tool obeyed would let an
           * analyst pivot into a different night without being told.
           */}
          <TimeRangeControl idBase="siem" />
        </div>
      </div>

      <p className="muted" id="siem-query-hint text-xs">
        {t('investigate.siem.query_hint')}
      </p>

      {/*
       * What the parser did with what was typed.
       *
       * Never "Invalid input": each note names the token, says what it was
       * searched *as*, and lists the fields that exist. The query still ran, so
       * these are notes about a result rather than an error state blocking one.
       */}
      {notes.length > 0 ? (
        <div className="stack stack--tight" id={notesId}>
          <span className="eyebrow">{t('investigate.siem.notes')}</span>
          <ul className="query-notes">
            {notes.map((note) => (
              <li key={note.token} className="query-notes__row">
                <Icon
                  name={note.tone === 'warn' ? 'alert' : 'eye'}
                  size={13}
                  label={t(`investigate.severity.${note.tone === 'warn' ? 'warn' : 'info'}`)}
                />
                <span>{note.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="stack stack--tight">
        <span className="eyebrow">{t('investigate.siem.saved')}</span>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          {SAVED_QUERIES.map((saved) => (
            <Button
              key={saved.id}
              size="sm"
              variant={saved.query === query ? 'primary' : 'ghost'}
              aria-pressed={saved.query === query}
              onClick={() => setQuery(saved.query)}
            >
              {t(saved.labelKey)}
            </Button>
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 'var(--space-6)' }}>
        <Aggregate title={t('investigate.siem.by_source')} rows={bySource} prefix="investigate.type" />
        <Aggregate
          title={t('investigate.siem.by_severity')}
          rows={bySeverity}
          prefix="investigate.severity"
        />
      </div>

      <div className="stack stack--tight">
        <div className="row">
          <span className="eyebrow">{t('investigate.siem.events')}</span>
          <span className="mono muted text-xs">
            {t('investigate.siem.matched', { matched: matched.length, total })}
          </span>
        </div>

        <RangeNotice hidden={outsideRange} id="siem-range-notice" />

        {total === 0 ? (
          <p className="muted">{t('investigate.siem.empty_index')}</p>
        ) : matched.length === 0 ? (
          <p className="muted">{t('investigate.siem.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table" id="siem-events">
              <thead>
                <tr>
                  <th scope="col">{t('investigate.siem.col.time')}</th>
                  <th scope="col">{t('investigate.siem.col.source')}</th>
                  <th scope="col">{t('investigate.siem.col.event')}</th>
                  <th scope="col">{t('investigate.siem.col.severity')}</th>
                </tr>
              </thead>
              <tbody>
                {matched.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: SiemEvent }) {
  const ctx = useGame();
  const runtime = useRuntime();
  const run = useCommand();

  const openArtifact = () => {
    const id = event.artifactId;
    if (!id) return;
    if (ctx.inspectedArtifacts.includes(id)) {
      runtime.send({ type: 'SELECT_ARTIFACT', artifactId: id });
      runtime.send({ type: 'SET_ROUTE', route: 'evidence' });
    } else {
      run((r) => r.inspectArtifact(id));
    }
  };

  const followed = matchesFocus(ctx.focus, event.user, event.host, event.indicator);

  return (
    <tr id={`siem-event-${event.id}`} className={followed ? 'row--focused' : undefined}>
      <th scope="row" className="mono" style={{ fontWeight: 500 }}>
        {event.at}
      </th>
      <td>
        <div className="mono text-xs">
          {event.source}
        </div>
        <div className="muted text-xs">
          {tk(`investigate.type.${event.sourceType}`)}
        </div>
      </td>
      <td>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <span>{event.message}</span>
          <FocusMark on={followed} />
        </div>
        {/*
         * The pivots the case can actually make. Each control follows the value
         * it names and lands in the tool that owns that kind of thing — an
         * identity in Identity, a host in Endpoint, an indicator in Network —
         * so "who else touched this address?" is one click rather than a
         * remembered string and a second search.
         */}
        <div className="row" style={{ gap: 'var(--space-2)', marginTop: 4 }}>
          {event.user ? (
            <FollowButton
              tab="identity"
              focus={{ kind: 'identity', value: event.user.split('@')[0] ?? event.user, label: event.user }}
            />
          ) : null}
          {event.host ? (
            <FollowButton tab="endpoint" focus={{ kind: 'host', value: event.host }} />
          ) : null}
          {event.indicator ? (
            <FollowButton tab="network" focus={{ kind: 'indicator', value: event.indicator }} />
          ) : null}
          {event.artifactId ? (
            <Button size="sm" variant="ghost" onClick={openArtifact}>
              <Icon name="eye" size={13} />
              {t('investigate.siem.open_artifact')}
            </Button>
          ) : null}
        </div>
      </td>
      <td>
        <Badge
          tone={
            event.severity === 'critical'
              ? 'critical'
              : event.severity === 'warn'
                ? 'warning'
                : 'neutral'
          }
        >
          {tk(`investigate.severity.${event.severity}`)}
        </Badge>
      </td>
    </tr>
  );
}

function Aggregate({
  title,
  rows,
  prefix,
}: {
  title: string;
  rows: { key: string; count: number }[];
  prefix: string;
}) {
  const max = rows.reduce((highest, row) => Math.max(highest, row.count), 0);

  return (
    <div className="stack stack--tight" style={{ minWidth: 220, flex: 1 }}>
      <span className="eyebrow">{title}</span>
      {rows.length === 0 ? (
        <span className="muted text-sm">
          —
        </span>
      ) : (
        <dl className="agg">
          {rows.map((row) => (
            <div key={row.key} className="agg__row">
              <dt className="agg__key">{tk(`${prefix}.${row.key}`)}</dt>
              <dd className="agg__value">
                <span
                  className="agg__bar"
                  style={{ width: `${max === 0 ? 0 : Math.round((row.count / max) * 100)}%` }}
                  aria-hidden="true"
                />
                <span className="mono">{row.count}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
