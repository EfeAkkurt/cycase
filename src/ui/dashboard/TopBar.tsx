import type { ReactNode } from 'react';

import { t } from '../../i18n';

/**
 * The workspace header: what you are looking at, and the three controls that
 * apply to the whole session.
 *
 * Everything else that used to live here — incident id, severity, both clocks,
 * event rate, feed health, state version, agent status — moved into the
 * sidebar's status group. Eight KPI cells and a page title competing for one
 * 48px band is what pushed the header onto two rows at 1280px and shoved the
 * real content of every destination below the fold.
 *
 * `title` is the active destination. `context` names the case underneath it, so
 * moving between destinations never loses which incident is open.
 */
export function TopBar({
  title,
  context,
  titleId,
  actions,
}: {
  title: string;
  context?: string;
  /** The focus target after the office-to-dashboard transition. */
  titleId?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
      <div className="topbar__title">
        <h1 className="topbar__h1" id={titleId} tabIndex={titleId ? -1 : undefined}>
          {title}
        </h1>
        {context ? <p className="topbar__context">{context}</p> : null}
      </div>

      {actions ? (
        <div className="topbar__actions" role="group" aria-label={t('topbar.actions')}>
          {actions}
        </div>
      ) : null}
    </header>
  );
}
