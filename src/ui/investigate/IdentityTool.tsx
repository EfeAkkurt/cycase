import { useGame } from '../../app/gameContext';
import {
  credentialPosture,
  diagnosticRowsFor,
  matchesFocus,
  sessionInventory,
  sourceRecord,
} from '../../game/investigate';
import { hiddenIdentityCount, identityStatuses, visibleIdentities } from '../../game/selectors';
import { t, tk } from '../../i18n';
import type { PanelMode } from '../panels/mode';
import { Badge, Icon } from '../primitives';
import { FocusMark, FollowButton, InventoryRangeNote } from './ConsoleBar';
import { DiagnosticRows } from './DiagnosticRows';
import { SourceFields, SourceStatus } from './SourceStatus';

/**
 * Identity — the directory, the sign-in history, and what is still valid.
 *
 * The session table is the one place in the product where a containment action
 * has to be visible as a fact rather than as a toast: `art_session_001` states
 * `SES-8842 … ACTIVE`, because that is the world the alert found. After
 * `revoke_sessions` this table says Revoked, because `sessionInventory` layers
 * live state over that fixture rather than printing it.
 */
export function IdentityTool({ mode = 'full' }: { mode?: PanelMode }) {
  const ctx = useGame();
  const sessions = sessionInventory(ctx);
  const credentials = credentialPosture(ctx);

  if (mode === 'compact') {
    return (
      <div className="stack stack--tight">
        {sessions.ran ? (
          <ul className="tool-rows">
            {sessions.rows.map((row) => (
              <li key={row.sessionId} className="tool-rows__row">
                <span className="mono tool-rows__time">{row.sessionId}</span>
                <span
                  className={
                    row.state === 'revoked'
                      ? 'dot dot--success'
                      : row.kind === 'rogue'
                        ? 'dot dot--critical'
                        : 'dot dot--accent'
                  }
                />
                <span className="tool-rows__label">
                  {t(`investigate.identity.session.${row.state}`)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted text-xs">
            {t('investigate.identity.sessions_locked')}
          </p>
        )}
        <p className="muted text-xs">
          {t('investigate.identity.credentials')}:{' '}
          {t(`investigate.identity.credentials.${credentials.state}`)}
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <IdentityDirectory />

      <section className="stack stack--tight" aria-labelledby="identity-signins">
        <h3 className="eyebrow" id="identity-signins">
          {t('investigate.identity.signins')}
        </h3>
        <DiagnosticRows
          diagnosticId="auth_timeline"
          rows={diagnosticRowsFor(ctx, 'auth_timeline')}
          emptyText={t('investigate.identity.signins_locked')}
        />
        <SignInDetail />
        <p className="muted text-xs">
          {t('investigate.identity.no_asn')}
        </p>
      </section>

      <section className="stack stack--tight" aria-labelledby="identity-sessions">
        <div className="row">
          <h3 className="eyebrow" id="identity-sessions">
            {t('investigate.identity.sessions')}
          </h3>
          {sessions.ran ? (
            <span className="mono muted text-xs">
              {t('investigate.identity.active_count', { count: sessions.activeCount })}
            </span>
          ) : null}
        </div>

        {!sessions.ran ? (
          <p className="muted">{t('investigate.identity.sessions_locked')}</p>
        ) : (
          <div className="table-scroll">
            <table className="table" id="identity-sessions-table">
              <thead>
                <tr>
                  <th scope="col">{t('investigate.identity.session.col.session')}</th>
                  <th scope="col">{t('investigate.identity.session.col.principal')}</th>
                  <th scope="col">{t('investigate.identity.session.col.device')}</th>
                  <th scope="col">{t('investigate.identity.session.col.issued')}</th>
                  <th scope="col">{t('investigate.identity.session.col.state')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.rows.map((row) => {
                  const followed = matchesFocus(
                    ctx.focus,
                    row.sessionId,
                    row.principalUpn,
                    row.device,
                  );
                  // "fp_9c2a41e0 (unregistered)" — the fingerprint is the part
                  // another tool can match on, so that is what a pivot carries.
                  const fingerprint = row.device.split(' ')[0] ?? row.device;

                  return (
                  <tr
                    key={row.sessionId}
                    id={`session-${row.sessionId}`}
                    className={followed ? 'row--focused' : undefined}
                  >
                    <th scope="row" className="mono" style={{ fontWeight: 500 }}>
                      {row.sessionId}
                    </th>
                    <td className="mono">{row.principalUpn}</td>
                    <td>
                      <div className="stack stack--tight">
                        <span className="mono">{row.device}</span>
                        {fingerprint.startsWith('fp_') ? (
                          <span>
                            <FollowButton
                              tab="network"
                              focus={{ kind: 'indicator', value: fingerprint }}
                            />
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="mono">{row.issuedAt}</td>
                    <td>
                      <div className="stack stack--tight">
                        <FocusMark on={followed} />
                        <Badge
                          tone={
                            row.state === 'revoked'
                              ? 'success'
                              : row.kind === 'rogue'
                                ? 'critical'
                                : 'neutral'
                          }
                          icon={row.state === 'revoked' ? 'check' : undefined}
                        >
                          {t(`investigate.identity.session.${row.state}`)}
                        </Badge>
                        <span className="muted text-xs">
                          {tk(row.noteKey)}
                        </span>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Sessions are present-tense state, so the console range reports
            itself here rather than filtering: SES-8811 was issued at 02:12:40,
            and a 30-minute window would hide the row that proves a password
            reset would not have touched it. */}
        <InventoryRangeNote />

        <SourceStatus record={sourceRecord(ctx, 'art_session_001')} />
      </section>

      <section className="stack stack--tight" aria-labelledby="identity-credentials">
        <h3 className="eyebrow" id="identity-credentials">
          {t('investigate.identity.credentials')}
        </h3>
        <p className="row" id="credential-state">
          <Badge tone={credentials.state === 'reset' ? 'success' : 'critical'}>
            {t(`investigate.identity.credentials.${credentials.state}`)}
          </Badge>
        </p>
        <p className="prose text-sm">
          {credentials.issuedTokensStillValid
            ? t('investigate.identity.tokens_valid')
            : t('investigate.identity.tokens_invalid')}
        </p>
        <SourceStatus record={sourceRecord(ctx, 'art_cookie_001')} />
        <SourceFields
          record={sourceRecord(ctx, 'art_cookie_001')}
          only={['field.binding', 'field.password_change_effect']}
        />
      </section>
    </div>
  );
}

/** The account view. Same rows, same statuses the console has always shown. */
export function IdentityDirectory() {
  const ctx = useGame();
  const identities = visibleIdentities(ctx);
  const hidden = hiddenIdentityCount(ctx);

  return (
    <section className="stack stack--tight" aria-labelledby="identity-directory">
      <h3 className="eyebrow" id="identity-directory">
        {t('investigate.identity.directory')}
      </h3>
      <div className="table-scroll">
        <table className="table" id="identities-table">
          <thead>
            <tr>
              <th scope="col">{t('field.user')}</th>
              <th scope="col">{t('identities.department')}</th>
              <th scope="col">{t('identities.risk')}</th>
              <th scope="col">{t('field.state')}</th>
            </tr>
          </thead>
          <tbody>
            {identities.map((identity) => {
              const statuses = identityStatuses(ctx, identity.id);
              const riskTone =
                identity.baseRisk === 'critical'
                  ? 'critical'
                  : identity.baseRisk === 'elevated'
                    ? 'warning'
                    : 'neutral';

              const followed = matchesFocus(ctx.focus, identity.upn, identity.displayName);

              return (
                <tr
                  key={identity.id}
                  id={`identity-${identity.id}`}
                  className={followed ? 'row--focused' : undefined}
                >
                  <th scope="row" style={{ fontWeight: 500 }}>
                    <div>{identity.displayName}</div>
                    <div className="mono muted text-xs">
                      {identity.upn}
                    </div>
                    <FollowButton
                      showValue={false}
                      focus={{
                        kind: 'identity',
                        value: identity.upn.split('@')[0] ?? identity.upn,
                        label: identity.upn,
                      }}
                    />
                  </th>
                  <td>
                    <div>{identity.department}</div>
                    <div className="muted text-xs">
                      {tk(identity.roleKey)}
                    </div>
                  </td>
                  <td>
                    <Badge tone={riskTone} icon={riskTone === 'critical' ? 'alert' : undefined}>
                      {t(`identities.risk.${identity.baseRisk}`)}
                    </Badge>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 'var(--space-2)' }}>
                      {statuses.map((status) => (
                        <Badge
                          key={status}
                          tone={
                            status === 'disabled'
                              ? 'warning'
                              : status === 'active'
                                ? 'neutral'
                                : 'success'
                          }
                        >
                          {t(`identities.status.${status}`)}
                        </Badge>
                      ))}
                      <FocusMark on={followed} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hidden > 0 ? (
        <p className="muted text-sm">
          <Icon name="lock" size={13} />{' '}
          {t(hidden === 1 ? 'identities.hidden' : 'identities.hidden_plural', { count: hidden })}
        </p>
      ) : null}
    </section>
  );
}

/** The anomalous sign-in itself, including the MFA claim that made it work. */
function SignInDetail() {
  const ctx = useGame();
  const record = sourceRecord(ctx, 'art_signin_001');

  return (
    <>
      <SourceStatus record={record} />
      <SourceFields
        record={record}
        only={[
          'field.user',
          'field.result',
          'field.source_ip',
          'field.geo',
          'field.device_fingerprint',
          'field.mfa',
          'field.impossible_travel',
        ]}
      />
    </>
  );
}
