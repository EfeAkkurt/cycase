import { } from '../../app/gameContext';
import {
  matchesFocus,
  messageAuthentication,
  messageTrace,
  sourceRecord,
  traceHiddenByRange,
} from '../../game/investigate';
import { t, tk } from '../../i18n';
import type { PanelMode } from '../panels/mode';
import { Badge, KeyValue, UntrustedShell } from '../primitives';
import { FocusMark, FollowButton, RangeNotice } from './ConsoleBar';
import { SourceFields, SourceStatus } from './SourceStatus';
import { ToolContext, useToolGame } from './ToolContext';

/**
 * Email — message trace, headers, SPF/DKIM/DMARC and URL detonation.
 *
 * Both records this tool reads are `untrusted: true`, so every attacker-authored
 * value on this page sits inside the same `UntrustedShell` the evidence
 * inspector uses. A second surface that rendered the subject line without that
 * warning would be a hole in the one control that exists to stop a player — or
 * an agent — from treating the phish as an instruction.
 *
 * Deleting the message destroys the headers, not the delivery record: the trace
 * still says a message arrived, because a mail gateway log outlives a mailbox,
 * but no header value is reachable through it afterwards.
 */
export function EmailTool({ mode = 'full' }: { mode?: PanelMode }) {
  const ctx = useToolGame();
  const trace = messageTrace(ctx);
  const auth = messageAuthentication(ctx);
  const message = sourceRecord(ctx, 'art_email_001');
  const url = sourceRecord(ctx, 'art_url_001');

  if (mode === 'compact') {
    return (
      <div className="stack stack--tight">
        {trace.length === 0 ? (
          <p className="muted text-xs">
            {t('investigate.email.trace_empty')}
          </p>
        ) : (
          <ul className="tool-rows">
            {trace.map((row) => (
              <li key={row.recipient} className="tool-rows__row">
                <span className="mono tool-rows__time">{row.at}</span>
                <span
                  className={row.disposition === 'clicked' ? 'dot dot--critical' : 'dot dot--warning'}
                />
                <span className="tool-rows__label">{row.recipient}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="muted text-xs">
          {auth.length === 0
            ? t('investigate.source.uncollected')
            : auth.map((row) => `${tk(row.labelKey)} ${row.value.split(' ')[0]}`).join(' · ')}
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <ToolContext
        tab="email"
        source={message.source || t('investigate.email.source')}
        shown={trace.length}
        hidden={traceHiddenByRange(ctx)}
      />

      <section className="stack stack--tight" aria-labelledby="email-trace">
        <h3 className="eyebrow" id="email-trace">
          {t('investigate.email.trace')}
        </h3>
        {trace.length === 0 ? (
          <p className="muted">{t('investigate.email.trace_empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table" id="email-trace-table">
              <thead>
                <tr>
                  <th scope="col">{t('investigate.email.trace.col.recipient')}</th>
                  <th scope="col">{t('investigate.email.trace.col.delivered')}</th>
                  <th scope="col">{t('investigate.email.trace.col.disposition')}</th>
                </tr>
              </thead>
              <tbody>
                {trace.map((row) => {
                  const followed = matchesFocus(ctx.focus, row.recipient, row.identity);
                  return (
                  <tr
                    key={row.recipient}
                    id={`trace-${row.identity}`}
                    className={followed ? 'row--focused' : undefined}
                  >
                    <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                      <div>{row.recipient}</div>
                      <FollowButton
                        tab="identity"
                        showValue={false}
                        focus={{
                          kind: 'identity',
                          value: row.recipient.split('@')[0] ?? row.recipient,
                          label: row.recipient,
                        }}
                      />
                    </th>
                    <td className="mono">{row.at}</td>
                    <td>
                      <FocusMark on={followed} />
                      <Badge
                        tone={
                          row.disposition === 'clicked'
                            ? 'critical'
                            : row.disposition === 'destroyed'
                              ? 'warning'
                              : 'neutral'
                        }
                        icon={row.disposition === 'destroyed' ? 'trash' : undefined}
                      >
                        {row.disposition === 'clicked'
                          ? t('investigate.email.disposition.clicked', { at: row.clickedAt ?? '' })
                          : t(`investigate.email.disposition.${row.disposition}`)}
                      </Badge>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* A message trace is a search over deliveries, so the console range
            applies to it — and names itself when it is the reason a delivery
            is missing. */}
        <RangeNotice hidden={traceHiddenByRange(ctx)} id="email-range-notice" />
      </section>

      <section className="stack stack--tight" aria-labelledby="email-auth">
        <h3 className="eyebrow" id="email-auth">
          {t('investigate.email.auth')}
        </h3>
        <SourceStatus record={message} />
        {auth.length > 0 ? (
          <KeyValue
            rows={auth.map((row) => ({ key: tk(row.labelKey), value: row.value, tone: row.tone }))}
          />
        ) : null}
      </section>

      {message.state === 'ready' ? (
        <section className="stack stack--tight" aria-labelledby="email-headers">
          <h3 className="eyebrow" id="email-headers">
            {t('investigate.email.headers')}
          </h3>
          <UntrustedShell>
            <SourceFields
              record={message}
              only={[
                'field.display_name',
                'field.envelope_from',
                'field.reply_to',
                'field.to',
                'field.subject',
                'field.link',
                'field.body_excerpt',
              ]}
            />
          </UntrustedShell>
        </section>
      ) : null}

      <section className="stack stack--tight" aria-labelledby="email-detonation">
        <h3 className="eyebrow" id="email-detonation">
          {t('investigate.email.detonation')}
        </h3>
        <SourceStatus record={url} />
        {url.state === 'ready' ? (
          <UntrustedShell>
            <SourceFields
              record={url}
              only={[
                'field.url',
                'field.page_signature',
                'field.captured_fields',
                'field.domain_registered',
                'field.tls_issued',
              ]}
            />
          </UntrustedShell>
        ) : null}
      </section>
    </div>
  );
}
