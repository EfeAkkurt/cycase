import { useGame } from '../../app/gameContext';
import {
  endpointConnections,
  extensionInventory,
  hostInventory,
  matchesFocus,
  sourceRecord,
} from '../../game/investigate';
import { t, tk } from '../../i18n';
import type { PanelMode } from '../panels/mode';
import { Badge } from '../primitives';
import { FocusMark, FollowButton, InventoryRangeNote } from './ConsoleBar';
import { SourceFields, SourceStatus } from './SourceStatus';

/**
 * Endpoint / EDR — hosts, browser extensions and outbound connections.
 *
 * There is no process tree and no file-hash section, and that is faithful
 * rather than missing: `art_edr_001` reports *no malicious binary*, because the
 * theft ran inside the browser. Drawing an empty process tree would tell the
 * agent a source exists that the simulation cannot answer questions about, and
 * §3 forbids exactly that. The verdict says so in words instead.
 */
export function EndpointTool({ mode = 'full' }: { mode?: PanelMode }) {
  const ctx = useGame();
  const hosts = hostInventory(ctx);
  const extensions = extensionInventory(ctx);
  const connections = endpointConnections(ctx);
  const edr = sourceRecord(ctx, 'art_edr_001');

  if (mode === 'compact') {
    return (
      <div className="stack stack--tight">
        <ul className="tool-rows">
          {hosts.map((host) => (
            <li key={host.assetId} className="tool-rows__row">
              <span className="mono tool-rows__time">{host.assetId}</span>
              <span
                className={
                  host.status === 'isolated'
                    ? 'dot dot--success'
                    : host.status === 'affected'
                      ? 'dot dot--critical'
                      : 'dot dot--warning'
                }
              />
              <span className="tool-rows__label">{t(`assets.status.${host.status}`)}</span>
            </li>
          ))}
        </ul>
        <p className="muted text-xs">
          {extensions.length > 0
            ? `${t('investigate.endpoint.extensions')}: ${extensions.length}`
            : t('investigate.endpoint.extensions_empty')}
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="stack stack--tight" aria-labelledby="endpoint-hosts">
        <h3 className="eyebrow" id="endpoint-hosts">
          {t('investigate.endpoint.hosts')}
        </h3>
        <div className="table-scroll">
          <table className="table" id="assets-table">
            <thead>
              <tr>
                <th scope="col">{t('investigate.endpoint.col.host')}</th>
                <th scope="col">{t('command.queue.col.title')}</th>
                <th scope="col">{t('assets.owner')}</th>
                <th scope="col">{t('field.state')}</th>
              </tr>
            </thead>
            <tbody>
              {hosts.map((host) => {
                const tone =
                  host.status === 'isolated'
                    ? 'success'
                    : host.status === 'affected'
                      ? 'critical'
                      : host.status === 'watch'
                        ? 'warning'
                        : 'neutral';

                const followed = matchesFocus(ctx.focus, host.assetId, host.owner);

                return (
                  <tr
                    key={host.assetId}
                    id={`asset-${host.assetId}`}
                    className={followed ? 'row--focused' : undefined}
                  >
                    <th scope="row" style={{ fontWeight: 500 }}>
                      <div className="mono">{host.assetId}</div>
                      <div className="muted text-xs">
                        {tk(host.nameKey)}
                      </div>
                      <FollowButton
                        showValue={false}
                        focus={{ kind: 'host', value: host.assetId }}
                      />
                    </th>
                    <td>{t(`assets.kind.${host.kind}`)}</td>
                    <td className="mono">{host.owner ?? '—'}</td>
                    <td>
                      <div className="stack stack--tight">
                        <Badge tone={tone} icon={tone === 'critical' ? 'alert' : undefined}>
                          {t(`assets.status.${host.status}`)}
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
        {/* A host inventory is what is true now. The range is reported, not
            applied — an isolated host must stay visible in the table that
            proves the isolation worked. */}
        <InventoryRangeNote />
      </section>

      <section className="stack stack--tight" aria-labelledby="endpoint-verdict">
        <h3 className="eyebrow" id="endpoint-verdict">
          {t('investigate.endpoint.verdict')}
        </h3>
        <SourceStatus record={edr} />
        {edr.state === 'ready' ? (
          <>
            <SourceFields record={edr} only={['field.malware_verdict', 'field.host_state']} />
            <p className="prose text-sm">
              {t('investigate.endpoint.no_binary')}
            </p>
          </>
        ) : null}
      </section>

      <section className="stack stack--tight" aria-labelledby="endpoint-extensions">
        <h3 className="eyebrow" id="endpoint-extensions">
          {t('investigate.endpoint.extensions')}
        </h3>
        {extensions.length === 0 ? (
          <p className="muted">{t('investigate.endpoint.extensions_empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table" id="endpoint-extensions-table">
              <thead>
                <tr>
                  <th scope="col">{t('investigate.endpoint.col.host')}</th>
                  <th scope="col">{t('investigate.endpoint.col.extension')}</th>
                  <th scope="col">{t('investigate.endpoint.col.installed')}</th>
                  <th scope="col">{t('investigate.endpoint.col.permissions')}</th>
                  <th scope="col">{t('investigate.endpoint.col.state')}</th>
                </tr>
              </thead>
              <tbody>
                {extensions.map((extension) => (
                  <tr
                    key={extension.host}
                    id={`extension-${extension.host}`}
                    className={
                      matchesFocus(ctx.focus, extension.host, extension.name)
                        ? 'row--focused'
                        : undefined
                    }
                  >
                    <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                      {extension.host}
                    </th>
                    <td>
                      <div>{extension.name}</div>
                      <div className="mono muted text-xs">
                        {extension.version ?? t('investigate.endpoint.not_reported')}
                      </div>
                    </td>
                    <td className="mono">{extension.installedAt}</td>
                    <td className={extension.permissions ? 'kv__value kv__value--bad' : 'muted'}>
                      {extension.permissions ?? t('investigate.endpoint.not_reported')}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 'var(--space-2)' }}>
                        <Badge
                          tone={extension.contained ? 'success' : 'critical'}
                          icon={extension.contained ? 'check' : 'alert'}
                        >
                          {extension.contained
                            ? t('investigate.endpoint.contained')
                            : t('investigate.endpoint.state.observed')}
                        </Badge>
                        {extension.observedExfil ? (
                          <Badge tone="warning">{t('investigate.endpoint.exfil')}</Badge>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack stack--tight" aria-labelledby="endpoint-connections">
        <h3 className="eyebrow" id="endpoint-connections">
          {t('investigate.endpoint.connections')}
        </h3>
        {connections.length === 0 ? (
          <p className="muted">{t('investigate.endpoint.connections_empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table" id="endpoint-connections-table">
              <thead>
                <tr>
                  <th scope="col">{t('investigate.siem.col.time')}</th>
                  <th scope="col">{t('investigate.endpoint.col.host')}</th>
                  <th scope="col">{t('investigate.endpoint.col.destination')}</th>
                  <th scope="col">{t('investigate.endpoint.col.state')}</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection) => (
                  <tr
                    key={`${connection.host}-${connection.destination}`}
                    id={`connection-${connection.host}`}
                    className={
                      matchesFocus(ctx.focus, connection.host, connection.destination)
                        ? 'row--focused'
                        : undefined
                    }
                  >
                    <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                      {connection.at}
                    </th>
                    <td className="mono">{connection.host}</td>
                    <td>
                      <div className="mono">{connection.destination}</div>
                      <div className="muted text-xs">
                        {tk(connection.detailKey)}
                      </div>
                      <FollowButton
                        tab="network"
                        focus={{ kind: 'indicator', value: connection.destination }}
                      />
                    </td>
                    <td>
                      <Badge
                        tone={connection.state === 'observed' ? 'critical' : 'success'}
                        icon={connection.state === 'observed' ? 'alert' : 'check'}
                      >
                        {t(`investigate.endpoint.state.${connection.state}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
