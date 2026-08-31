import {
  useGame,
} from '../../app/gameContext';
import { FINDINGS, RESPONSE_ACTION_BY_ID } from '../../game/fixtures/case001';
import { t, tk } from '../../i18n';
import type { ResponseActionId } from '../../game/types';
import { Icon, Panel } from '../primitives';

/**
 * The containment checklist. This is the artefact the case is graded against
 * and the thing `close_case` reads to pick an ending, so it is deliberately the
 * most legible block on the overview.
 */
export function ContainmentChecklist({ standalone = true }: { standalone?: boolean }) {
  const ctx = useGame();

  const body = (
    <ul className="checklist">
      {FINDINGS.map((finding) => {
        const record = ctx.findings.find((f) => f.id === finding.id);
        const resolved = Boolean(record?.resolved);
        const resolvedBy = record?.resolvedBy;
        const actionLabel =
          resolvedBy && RESPONSE_ACTION_BY_ID.has(resolvedBy as ResponseActionId)
            ? tk(RESPONSE_ACTION_BY_ID.get(resolvedBy as ResponseActionId)!.labelKey)
            : resolvedBy;

        return (
          <li
            key={finding.id}
            id={`finding-${finding.id}`}
            className={
              resolved ? 'checklist__item checklist__item--resolved' : 'checklist__item checklist__item--open'
            }
          >
            <Icon
              name={resolved ? 'check' : 'alert'}
              size={18}
              label={resolved ? t('a11y.resolved_icon') : t('a11y.open_icon')}
            />
            <div>
              <div className="checklist__title">{tk(finding.titleKey)}</div>
              {resolved ? (
                <div className="checklist__consequence">
                  {t('finding.resolved_by', { action: String(actionLabel) })}
                </div>
              ) : (
                <div className="checklist__consequence">{tk(finding.consequenceKey)}</div>
              )}
            </div>
            <span className={resolved ? 'badge badge--success' : 'badge badge--critical'}>
              {resolved ? t('finding.resolved') : t('finding.open')}
            </span>
          </li>
        );
      })}
    </ul>
  );

  if (!standalone) return body;

  return (
    <Panel id="overview-checklist" title={t('overview.checklist')}>
      {body}
    </Panel>
  );
}
