import { useEffect, useRef } from 'react';

import { useGame } from '../../app/gameContext';
import { caseLog, type CaseLogEntry } from '../../game/live';
import { t } from '../../i18n';
import { Panel } from '../primitives';

/**
 * The append-only case log.
 *
 * Rows arrive as scenario events occur, newest at the bottom, each stamped with
 * the simulation clock it happened on. It is derived from case state rather
 * than stored, so it can never disagree with the incident it reports, and an
 * agent's calls appear in it exactly like the analyst's own.
 */

const TONE: Record<CaseLogEntry['severity'], string> = {
  critical: 'dot dot--critical',
  warn: 'dot dot--warning',
  good: 'dot dot--success',
  info: 'dot',
};

/**
 * Who ran it.
 *
 * Redesign §6 asks each operation for "an attributable timeline entry", and §4
 * for "alert, human, agent and system events in one attributable chronology".
 * The origin reaches here on every row; without this column the chronology is
 * attributable in the data and anonymous to the person reading it, which is
 * the half that matters when an agent and an analyst are working the same case.
 *
 * Deliberately not colour-coded. Attribution is carried by the word, so the
 * column adds no new palette values and cannot drift into the blue the visual
 * gate rejects.
 */
const ORIGIN_KEY = {
  human: 'log.origin.human',
  agent: 'log.origin.agent',
  system: 'log.origin.system',
} as const;

export function CaseLogPanel({ limit = 40 }: { limit?: number }) {
  const ctx = useGame();
  const entries = caseLog(ctx).slice(-limit);
  const listRef = useRef<HTMLOListElement>(null);
  const lastCount = useRef(entries.length);

  // Follow the tail, the way a log viewer does — but only when rows were
  // actually appended, so it never fights someone scrolling back.
  useEffect(() => {
    if (entries.length === lastCount.current) return;
    lastCount.current = entries.length;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries.length]);

  return (
    <Panel
      id="case-log"
      title={t('log.title')}
      actions={
        <span className="mono muted text-xs">
          {entries.length}
        </span>
      }
      flush
    >
      <ol className="log" ref={listRef} aria-label={t('log.title')}>
        {entries.map((entry, index) => (
          <li
            key={entry.id}
            className={index === entries.length - 1 ? 'log__row log__row--fresh' : 'log__row'}
          >
            <span className="log__time">{entry.at}</span>
            <span className={TONE[entry.severity]} style={{ marginTop: 5 }} />
            <span className="log__origin">{t(ORIGIN_KEY[entry.origin])}</span>
            <span className="log__text">{entry.text}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
