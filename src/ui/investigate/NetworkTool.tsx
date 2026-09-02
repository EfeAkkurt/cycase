import { } from '../../app/gameContext';
import {
  diagnosticRowsFor,
  egressHiddenByRange,
  egressLedger,
  egressStoppedAt,
  egressTotals,
  indicatorInventory,
  matchesFocus,
  sourceRecord,
} from '../../game/investigate';
import { t, tk } from '../../i18n';
import type { PanelMode } from '../panels/mode';
import { Badge } from '../primitives';
import { FocusMark, FollowButton, InventoryRangeNote, RangeNotice } from './ConsoleBar';
import { DiagnosticRows } from './DiagnosticRows';
import { SourceFields, SourceStatus } from './SourceStatus';
import { ToolContext, useToolGame } from './ToolContext';

/**
 * Network — proxy and domain reputation, indicators, and what left the estate.
 *
 * Two honesty decisions are visible here. The section is called *domain
 * reputation*, not DNS, because the scenario has no DNS query log and labelling
 * proxy data as DNS would teach a pivot that does not exist. And the egress
 * view is a ledger at the timestamps the case records rather than a byte curve:
 * the fixtures give three volumes and one completion percentage, so a smooth
 * line between them would be traffic nobody observed.
 */
export function NetworkTool({ mode = 'full' }: { mode?: PanelMode }) {
  const ctx = useToolGame();
  const indicators = indicatorInventory(ctx);
  const egress = egressLedger(ctx);
  const totals = egressTotals(egress);
  const stoppedAt = egressStoppedAt(ctx);

  if (mode === 'compact') {
    return (
      <div className="stack stack--tight">
        {indicators.length === 0 ? (
          <p className="muted text-xs">
            {t('investigate.network.indicators_empty')}
          </p>
        ) : (
          <ul className="tool-rows">
            {indicators.slice(0, 4).map((indicator) => (
              <li key={indicator.value} className="tool-rows__row">
                <span className="mono tool-rows__time">{indicator.value}</span>
                <span
                  className={indicator.state === 'blocked' ? 'dot dot--success' : 'dot dot--critical'}
                />
                <span className="tool-rows__label">
                  {t(`investigate.network.indicator.${indicator.state}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mono muted text-xs">
          {t('investigate.network.egress.total', {
            egressed: totals.egressedMb,
            total: totals.totalMb,
          })}
        </p>
      </div>
    );
  }

  const proxy = sourceRecord(ctx, 'art_url_001');

  return (
    <div className="stack">
      {/*
       * Network reads two systems that disagree in useful ways — the proxy sees
       * the request, DLP sees what left — so the strip names both rather than
       * calling the tool its own source.
       */}
      <ToolContext
        tab="network"
        source={t('investigate.network.source')}
        shown={indicators.length + egress.length}
        hidden={egressHiddenByRange(ctx)}
      />

      <section className="stack stack--tight" aria-labelledby="network-proxy">
        <h3 className="eyebrow" id="network-proxy">
          {t('investigate.network.proxy')}
        </h3>
        <SourceStatus record={proxy} />
        <SourceFields
          record={proxy}
          only={[
            'field.url',
            'field.domain_registered',
            'field.tls_issued',
            'field.hosting_asn',
            'field.visited_by',
          ]}
        />
        <p className="muted text-xs">
          {t('investigate.network.no_dns')}
        </p>
      </section>

      <section className="stack stack--tight" aria-labelledby="network-indicators">
        <h3 className="eyebrow" id="network-indicators">
          {t('investigate.network.indicators')}
        </h3>
        {indicators.length === 0 ? (
          <p className="muted">{t('investigate.network.indicators_empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table" id="network-indicators-table">
              <thead>
                <tr>
                  <th scope="col">{t('investigate.network.col.indicator')}</th>
                  <th scope="col">{t('investigate.network.col.kind')}</th>
                  <th scope="col">{t('investigate.network.col.first_seen')}</th>
                  <th scope="col">{t('investigate.network.col.state')}</th>
                </tr>
              </thead>
              <tbody>
                {indicators.map((indicator) => {
                  const followed = matchesFocus(ctx.focus, indicator.value);
                  return (
                    <tr
                      key={indicator.value}
                      id={`indicator-${indicator.value}`}
                      className={followed ? 'row--focused' : undefined}
                    >
                      <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                        <div>{indicator.value}</div>
                        <FollowButton
                          showValue={false}
                          focus={{ kind: 'indicator', value: indicator.value }}
                        />
                      </th>
                      <td>{t(`investigate.network.indicator.kind.${indicator.kind}`)}</td>
                      <td className="mono">{indicator.firstSeen}</td>
                      <td>
                        <div className="stack stack--tight">
                          <Badge
                            tone={indicator.state === 'blocked' ? 'success' : 'warning'}
                            icon={indicator.state === 'blocked' ? 'block' : undefined}
                          >
                            {t(`investigate.network.indicator.${indicator.state}`)}
                          </Badge>
                          <FocusMark on={followed} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* An indicator's verdict is present-tense: blocking one has to be
            visible here whatever window is selected. */}
        <InventoryRangeNote />

        <DiagnosticRows
          diagnosticId="indicator_scope"
          rows={diagnosticRowsFor(ctx, 'indicator_scope')}
          emptyText={t('investigate.network.indicators_empty')}
        />
      </section>

      <section className="stack stack--tight" aria-labelledby="network-egress">
        <div className="row">
          <h3 className="eyebrow" id="network-egress">
            {t('investigate.network.egress')}
          </h3>
          <span className="mono muted text-xs">
            {t('investigate.network.egress.total', {
              egressed: totals.egressedMb,
              total: totals.totalMb,
            })}
          </span>
        </div>

        {egress.length === 0 ? (
          <p className="muted">{t('investigate.network.egress.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table" id="network-egress-table">
              <thead>
                <tr>
                  <th scope="col">{t('investigate.network.egress.col.time')}</th>
                  <th scope="col">{t('investigate.network.egress.col.from')}</th>
                  <th scope="col">{t('investigate.network.egress.col.to')}</th>
                  <th scope="col">{t('investigate.network.egress.col.volume')}</th>
                  <th scope="col">{t('investigate.network.egress.col.left')}</th>
                </tr>
              </thead>
              <tbody>
                {egress.map((row) => (
                  <tr
                    key={`${row.at}-${row.host}`}
                    id={`egress-${row.at}`}
                    className={
                      matchesFocus(ctx.focus, row.host, row.destination)
                        ? 'row--focused'
                        : undefined
                    }
                  >
                    <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                      {row.at}
                    </th>
                    <td className="mono">{row.host}</td>
                    <td>
                      <div className="mono">{row.destination}</div>
                      <div className="muted text-xs">
                        {tk(row.descriptionKey)}
                      </div>
                    </td>
                    <td className="mono">
                      {t('investigate.network.mb', { value: row.totalMb })}
                    </td>
                    <td>
                      <div className="mono kv__value kv__value--bad">
                        {t('investigate.network.mb', { value: row.egressedMb })}
                      </div>
                      {row.partiallyBlocked ? (
                        <div className="muted text-xs">
                          {t('investigate.network.egress.partial', {
                            percent: Math.round(row.completedFraction * 100),
                          })}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* The ledger *is* a set of observations, so here the range genuinely
            applies — and says so when it is holding a transfer back. */}
        <RangeNotice hidden={egressHiddenByRange(ctx)} id="egress-range-notice" />

        {stoppedAt ? (
          <p className="prose" id="egress-stopped text-sm">
            {t('investigate.network.egress.stopped', { at: stoppedAt })}
          </p>
        ) : null}
      </section>
    </div>
  );
}
