/**
 * CASE-001 — "Session Ghost"
 *
 * Every user, domain, IP, device, hash and log line below is synthetic.
 * Addresses use RFC 5737 / RFC 3849 documentation ranges and RFC 2606 style
 * fictional domains. Nothing here is a real target and nothing here is an
 * exploit payload — the case teaches defensive reasoning only.
 *
 * Incident chain (docs/GAME_FLOW.md):
 *   phishing email -> fake sign-in page -> stolen session cookie
 *   -> login from unusual location -> cloud file enumeration
 *   -> attempted data exfiltration
 */

import type {
  Artifact,
  ArtifactId,
  Asset,
  AssetId,
  Decision,
  Diagnostic,
  DiagnosticId,
  Finding,
  Hint,
  Identity,
  IdentityId,
  ResponseAction,
  TimelineEvent,
} from '../types';

export const CASE_ID = 'CASE-001';
export const INCIDENT_ID = 'INC-74219';

/** Incident clock. The alert fires at 03:17:42; the operator wakes at 03:17:42. */
export const INCIDENT_START_SEC = 3 * 3600 + 17 * 60 + 42;

/* ------------------------------------------------------------------ *
 * Identities
 * ------------------------------------------------------------------ */

export const IDENTITIES: Identity[] = [
  {
    id: 'usr_dilara',
    displayName: 'Dilara Arslan',
    upn: 'd.arslan@cy-case.corp',
    roleKey: 'identity.role.finance_analyst',
    department: 'Finance',
    baseRisk: 'critical',
  },
  {
    id: 'usr_baran',
    displayName: 'Baran Yilmaz',
    upn: 'b.yilmaz@cy-case.corp',
    roleKey: 'identity.role.finance_analyst',
    department: 'Finance',
    baseRisk: 'elevated',
    revealedBy: 'indicator_scope',
  },
  {
    id: 'usr_ecrin',
    displayName: 'Ecrin Kaya',
    upn: 'e.kaya@cy-case.corp',
    roleKey: 'identity.role.helpdesk',
    department: 'IT',
    baseRisk: 'normal',
  },
  {
    id: 'svc_backup',
    displayName: 'svc-backup',
    upn: 'svc-backup@cy-case.corp',
    roleKey: 'identity.role.service_account',
    department: 'Infrastructure',
    baseRisk: 'normal',
  },
];

/* ------------------------------------------------------------------ *
 * Assets
 * ------------------------------------------------------------------ */

export const ASSETS: Asset[] = [
  {
    id: 'WKS-114',
    nameKey: 'asset.wks114',
    kind: 'workstation',
    owner: 'usr_dilara',
    baseStatus: 'affected',
  },
  {
    id: 'WKS-231',
    nameKey: 'asset.wks231',
    kind: 'workstation',
    owner: 'usr_baran',
    baseStatus: 'watch',
    revealedBy: 'indicator_scope',
  },
  {
    id: 'SRV-FILES-02',
    nameKey: 'asset.srvfiles02',
    kind: 'file_service',
    owner: null,
    baseStatus: 'affected',
  },
  {
    id: 'IDP-01',
    nameKey: 'asset.idp01',
    kind: 'identity_provider',
    owner: null,
    baseStatus: 'watch',
  },
];

/* ------------------------------------------------------------------ *
 * Artifacts
 * ------------------------------------------------------------------ */

export const ARTIFACTS: Artifact[] = [
  {
    id: 'art_email_001',
    kind: 'email',
    titleKey: 'artifact.email.title',
    source: 'Mail Gateway / MG-EU-1',
    timestamp: '02:41:07',
    untrusted: true,
    relatedIdentities: ['usr_dilara'],
    fields: [
      { labelKey: 'field.display_name', value: 'CyCase IT Service Desk', tone: 'warn' },
      {
        labelKey: 'field.envelope_from',
        value: 'alerts@cy-case-secure-id.net',
        decisive: true,
        tone: 'bad',
      },
      { labelKey: 'field.reply_to', value: 'no-reply@cy-case-secure-id.net', tone: 'bad' },
      { labelKey: 'field.to', value: 'd.arslan@cy-case.corp' },
      { labelKey: 'field.subject', value: 'Mandatory session re-verification (expires in 2h)' },
      { labelKey: 'field.spf', value: 'fail (sender not permitted)', decisive: true, tone: 'bad' },
      { labelKey: 'field.dkim', value: 'none', tone: 'bad' },
      { labelKey: 'field.dmarc', value: 'fail (p=quarantine, overridden by allow-list)', tone: 'bad' },
      {
        labelKey: 'field.link',
        value: 'hxxps://sso-cycase-verify[.]net/session/renew?u=d.arslan',
        decisive: true,
        tone: 'bad',
      },
      { labelKey: 'field.body_excerpt', value: '"Your SSO session will be terminated. Re-verify now to keep access."' },
    ],
    explanationKey: 'artifact.email.explanation',
  },
  {
    id: 'art_url_001',
    kind: 'url',
    titleKey: 'artifact.url.title',
    source: 'Web Proxy / PXY-02',
    timestamp: '02:44:19',
    untrusted: true,
    fields: [
      { labelKey: 'field.url', value: 'hxxps://sso-cycase-verify[.]net/session/renew', tone: 'bad' },
      { labelKey: 'field.domain_registered', value: '2 days before the incident', decisive: true, tone: 'bad' },
      { labelKey: 'field.tls_issued', value: '2 days before the incident (free DV cert)', tone: 'warn' },
      { labelKey: 'field.hosting_asn', value: 'AS64500 "Fictional Cloud" (synthetic)', tone: 'warn' },
      { labelKey: 'field.page_signature', value: 'Pixel-level clone of the CyCase SSO sign-in page', decisive: true, tone: 'bad' },
      { labelKey: 'field.captured_fields', value: 'username, password, MFA code, session cookie', tone: 'bad' },
      { labelKey: 'field.visited_by', value: 'WKS-114 (d.arslan) at 02:44:19' },
    ],
    explanationKey: 'artifact.url.explanation',
  },
  {
    id: 'art_signin_001',
    kind: 'signin_log',
    titleKey: 'artifact.signin.title',
    source: 'IDP-01 / sign-in logs',
    timestamp: '03:02:14',
    untrusted: false,
    revealedBy: 'auth_timeline',
    relatedIdentities: ['usr_dilara'],
    relatedAssets: ['IDP-01'],
    fields: [
      { labelKey: 'field.user', value: 'd.arslan@cy-case.corp' },
      { labelKey: 'field.result', value: 'success', tone: 'bad' },
      { labelKey: 'field.source_ip', value: '203.0.113.47 (TEST-NET-3, synthetic)', decisive: true, tone: 'bad' },
      { labelKey: 'field.geo', value: 'Malmo, SE — 1,842 km from last known location', tone: 'bad' },
      { labelKey: 'field.device_fingerprint', value: 'fp_9c2a41e0 (unregistered)', decisive: true, tone: 'bad' },
      {
        labelKey: 'field.mfa',
        value: 'satisfied — existing session claim, no new challenge',
        decisive: true,
        tone: 'bad',
      },
      { labelKey: 'field.impossible_travel', value: 'true (21 minutes since last sign-in from Istanbul)', tone: 'bad' },
    ],
    explanationKey: 'artifact.signin.explanation',
  },
  {
    id: 'art_session_001',
    kind: 'session_record',
    titleKey: 'artifact.session.title',
    source: 'IDP-01 / session store',
    timestamp: '03:02:14',
    untrusted: false,
    revealedBy: 'session_inventory',
    relatedIdentities: ['usr_dilara'],
    fields: [
      { labelKey: 'field.session_id', value: 'SES-8842', decisive: true, tone: 'bad' },
      { labelKey: 'field.state', value: 'ACTIVE', decisive: true, tone: 'bad' },
      { labelKey: 'field.issued_at', value: '03:02:14 via cookie presentation (no password event)' },
      { labelKey: 'field.device_fingerprint', value: 'fp_9c2a41e0 (unregistered)', tone: 'bad' },
      { labelKey: 'field.last_seen', value: '03:19:06 — still refreshing', tone: 'bad' },
      { labelKey: 'field.scopes', value: 'files.read, files.list, profile.read', tone: 'warn' },
    ],
    explanationKey: 'artifact.session.explanation',
  },
  {
    id: 'art_cookie_001',
    kind: 'cookie_telemetry',
    titleKey: 'artifact.cookie.title',
    source: 'IDP-01 / token telemetry',
    timestamp: '03:02:11',
    untrusted: false,
    revealedBy: 'auth_timeline',
    fields: [
      { labelKey: 'field.cookie_name', value: 'cy_sso' },
      { labelKey: 'field.issued_to', value: 'fp_1a77bd93 (WKS-114, registered) at 02:12:40' },
      {
        labelKey: 'field.presented_by',
        value: 'fp_9c2a41e0 (unregistered) at 03:02:11',
        decisive: true,
        tone: 'bad',
      },
      { labelKey: 'field.binding', value: 'none — cookie is bearer-only, not device-bound', decisive: true, tone: 'bad' },
      { labelKey: 'field.password_change_effect', value: 'does NOT invalidate issued session cookies', decisive: true, tone: 'bad' },
      { labelKey: 'field.verdict', value: 'token replay confirmed', tone: 'bad' },
    ],
    explanationKey: 'artifact.cookie.explanation',
  },
  {
    id: 'art_fileops_001',
    kind: 'file_activity',
    titleKey: 'artifact.fileops.title',
    source: 'SRV-FILES-02 / activity log',
    timestamp: '03:07:33',
    untrusted: false,
    relatedAssets: ['SRV-FILES-02'],
    fields: [
      { labelKey: 'field.actor_session', value: 'SES-8842', tone: 'bad' },
      { labelKey: 'field.list_calls', value: '412 directory listings in 00:03:51', decisive: true, tone: 'bad' },
      { labelKey: 'field.baseline', value: 'user baseline: 6 listings per hour', tone: 'warn' },
      { labelKey: 'field.downloads', value: '3 files, 41.2 MB total' },
      { labelKey: 'field.top_path', value: '/finance/exports/2026-Q3/' },
    ],
    explanationKey: 'artifact.fileops.explanation',
  },
  {
    id: 'art_dlp_001',
    kind: 'dlp_alert',
    titleKey: 'artifact.dlp.title',
    source: 'DLP / egress inspection',
    timestamp: '03:16:58',
    untrusted: false,
    relatedAssets: ['SRV-FILES-02'],
    fields: [
      { labelKey: 'field.file', value: 'Q3-customer-export.csv (18.4 MB, 41,207 rows)', tone: 'bad' },
      { labelKey: 'field.destination', value: 'files.cy-case-secure-id.net (203.0.113.47)', decisive: true, tone: 'bad' },
      { labelKey: 'field.action', value: 'blocked at 62% — partial transfer completed', decisive: true, tone: 'bad' },
      { labelKey: 'field.classification', value: 'CONFIDENTIAL / customer PII', tone: 'bad' },
      { labelKey: 'field.actor_session', value: 'SES-8842' },
    ],
    explanationKey: 'artifact.dlp.explanation',
  },
  {
    id: 'art_edr_001',
    kind: 'edr_report',
    titleKey: 'artifact.edr.title',
    source: 'EDR / WKS-114',
    timestamp: '03:11:02',
    untrusted: false,
    relatedAssets: ['WKS-114'],
    relatedIdentities: ['usr_dilara'],
    fields: [
      { labelKey: 'field.host', value: 'WKS-114 (d.arslan)' },
      { labelKey: 'field.malware_verdict', value: 'no malicious binary detected', tone: 'good' },
      {
        labelKey: 'field.browser_extension',
        value: '"Session Sync Helper" v1.2.0 — sideloaded 02:44:51',
        decisive: true,
        tone: 'bad',
      },
      { labelKey: 'field.extension_permissions', value: 'read cookies on all sites, read tabs', tone: 'bad' },
      { labelKey: 'field.exfil_path', value: 'extension posted cookie jar to sso-cycase-verify[.]net', decisive: true, tone: 'bad' },
      { labelKey: 'field.host_state', value: 'online, still reachable — not isolated', tone: 'warn' },
      { labelKey: 'field.persistence', value: 'extension survives browser restart and password change', tone: 'bad' },
    ],
    explanationKey: 'artifact.edr.explanation',
  },
];

export const ARTIFACT_BY_ID = new Map(ARTIFACTS.map((a) => [a.id, a]));

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */

export const TIMELINE: TimelineEvent[] = [
  { at: '02:12:40', labelKey: 'timeline.legit_signin', severity: 'info' },
  { at: '02:41:07', labelKey: 'timeline.phish_delivered', severity: 'warn', artifactId: 'art_email_001' },
  { at: '02:44:19', labelKey: 'timeline.phish_clicked', severity: 'warn', artifactId: 'art_url_001' },
  {
    at: '02:44:51',
    labelKey: 'timeline.extension_installed',
    severity: 'critical',
    artifactId: 'art_edr_001',
    requires: { artifact: 'art_edr_001' },
  },
  {
    at: '03:02:11',
    labelKey: 'timeline.cookie_replayed',
    severity: 'critical',
    artifactId: 'art_cookie_001',
    requires: { diagnostic: 'auth_timeline' },
  },
  {
    at: '03:02:14',
    labelKey: 'timeline.anomalous_signin',
    severity: 'critical',
    artifactId: 'art_signin_001',
    requires: { diagnostic: 'auth_timeline' },
  },
  { at: '03:07:33', labelKey: 'timeline.file_enumeration', severity: 'critical', artifactId: 'art_fileops_001' },
  { at: '03:16:58', labelKey: 'timeline.exfil_attempt', severity: 'critical', artifactId: 'art_dlp_001' },
  { at: '03:17:42', labelKey: 'timeline.alert_raised', severity: 'critical' },
];

/* ------------------------------------------------------------------ *
 * Findings — the containment checklist
 * ------------------------------------------------------------------ */

export const FINDINGS: Finding[] = [
  {
    id: 'rogue_session_active',
    titleKey: 'finding.rogue_session_active.title',
    consequenceKey: 'finding.rogue_session_active.consequence',
    critical: true,
  },
  {
    id: 'credentials_exposed',
    titleKey: 'finding.credentials_exposed.title',
    consequenceKey: 'finding.credentials_exposed.consequence',
    critical: true,
  },
  {
    id: 'endpoint_uncontained',
    titleKey: 'finding.endpoint_uncontained.title',
    consequenceKey: 'finding.endpoint_uncontained.consequence',
    critical: true,
  },
  {
    id: 'indicators_unblocked',
    titleKey: 'finding.indicators_unblocked.title',
    consequenceKey: 'finding.indicators_unblocked.consequence',
    critical: true,
  },
  {
    id: 'scope_unverified',
    titleKey: 'finding.scope_unverified.title',
    consequenceKey: 'finding.scope_unverified.consequence',
    critical: true,
  },
];

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */

export const DIAGNOSTICS: Diagnostic[] = [
  {
    id: 'auth_timeline',
    titleKey: 'diagnostic.auth_timeline.title',
    descriptionKey: 'diagnostic.auth_timeline.description',
    resultKey: 'diagnostic.auth_timeline.result',
    revealsArtifacts: ['art_signin_001', 'art_cookie_001'],
    scoreDelta: [
      { bucket: 'evidence', delta: 4, reasonKey: 'score.auth_timeline' },
    ],
  },
  {
    id: 'session_inventory',
    titleKey: 'diagnostic.session_inventory.title',
    descriptionKey: 'diagnostic.session_inventory.description',
    resultKey: 'diagnostic.session_inventory.result',
    revealsArtifacts: ['art_session_001'],
    scoreDelta: [
      { bucket: 'containment', delta: 5, reasonKey: 'score.session_inventory' },
    ],
  },
  {
    id: 'indicator_scope',
    titleKey: 'diagnostic.indicator_scope.title',
    descriptionKey: 'diagnostic.indicator_scope.description',
    resultKey: 'diagnostic.indicator_scope.result',
    resolvesFindings: ['scope_unverified'],
    scoreDelta: [{ bucket: 'scope', delta: 10, reasonKey: 'score.indicator_scope' }],
  },
];

export const DIAGNOSTIC_BY_ID = new Map(DIAGNOSTICS.map((d) => [d.id, d]));

/**
 * Deterministic diagnostic output rows. Rendered in the dashboard and returned
 * verbatim (localized) to the agent.
 */
export const DIAGNOSTIC_ROWS: Record<string, { key: string; value: string; tone?: 'bad' | 'warn' | 'good' }[]> = {
  auth_timeline: [
    { key: '02:12:40', value: 'd.arslan — success — 198.51.100.12 — fp_1a77bd93 (WKS-114) — MFA: push approved', tone: 'good' },
    { key: '02:44:19', value: 'd.arslan — credential entry on sso-cycase-verify[.]net (off-domain)', tone: 'bad' },
    { key: '03:02:11', value: 'cy_sso cookie presented from fp_9c2a41e0 — no password event', tone: 'bad' },
    { key: '03:02:14', value: 'd.arslan — success — 203.0.113.47 — fp_9c2a41e0 — MFA: satisfied by session claim', tone: 'bad' },
    { key: '03:02:14', value: 'impossible travel: Istanbul -> Malmo in 00:21:34', tone: 'bad' },
  ],
  session_inventory: [
    { key: 'SES-8811', value: 'd.arslan — ACTIVE — fp_1a77bd93 (WKS-114) — issued 02:12:40 — legitimate', tone: 'good' },
    { key: 'SES-8842', value: 'd.arslan — ACTIVE — fp_9c2a41e0 (unregistered) — issued 03:02:14 — token replay', tone: 'bad' },
    { key: 'SES-8790', value: 'svc-backup — ACTIVE — service principal — scheduled, expected', tone: 'good' },
    { key: 'note', value: 'Resetting the password does not terminate any of the above.', tone: 'warn' },
  ],
  indicator_scope: [
    { key: '203.0.113.47', value: '2 hits — IDP-01 sign-in (d.arslan), SRV-FILES-02 egress attempt', tone: 'bad' },
    { key: 'cy-case-secure-id.net', value: '2 hits — mail delivery to d.arslan AND b.yilmaz', tone: 'bad' },
    { key: 'b.yilmaz@cy-case.corp', value: 'received the same phish at 02:41:09 — link NOT clicked, no session anomaly', tone: 'warn' },
    { key: '"Session Sync Helper"', value: 'also present on WKS-231 (b.yilmaz) — installed 02:47:12, no exfil yet', tone: 'bad' },
    { key: 'fp_9c2a41e0', value: '1 identity affected (d.arslan). Blast radius confirmed bounded.', tone: 'good' },
  ],
};

/* ------------------------------------------------------------------ *
 * Response actions
 * ------------------------------------------------------------------ */

export const RESPONSE_ACTIONS: ResponseAction[] = [
  {
    id: 'revoke_sessions',
    labelKey: 'action.revoke_sessions.label',
    impactKey: 'action.revoke_sessions.impact',
    resultKey: 'action.revoke_sessions.result',
    destructive: true,
    requiresConfirmation: true,
    resolvesFindings: ['rogue_session_active'],
    scoreDelta: [{ bucket: 'containment', delta: 10, reasonKey: 'score.revoke_sessions' }],
    conditionalPenalties: [
      {
        whenMissing: { diagnostic: 'session_inventory' },
        entry: { bucket: 'containment', delta: -4, reasonKey: 'score.blind_revoke' },
        setsFlags: ['blind_revoke'],
      },
    ],
  },
  {
    id: 'reset_credentials',
    labelKey: 'action.reset_credentials.label',
    impactKey: 'action.reset_credentials.impact',
    resultKey: 'action.reset_credentials.result',
    destructive: true,
    requiresConfirmation: true,
    resolvesFindings: ['credentials_exposed'],
    scoreDelta: [{ bucket: 'containment', delta: 7, reasonKey: 'score.reset_credentials' }],
  },
  {
    id: 'isolate_endpoint',
    labelKey: 'action.isolate_endpoint.label',
    impactKey: 'action.isolate_endpoint.impact',
    resultKey: 'action.isolate_endpoint.result',
    destructive: true,
    requiresConfirmation: true,
    resolvesFindings: ['endpoint_uncontained'],
    scoreDelta: [{ bucket: 'containment', delta: 8, reasonKey: 'score.isolate_endpoint' }],
    conditionalPenalties: [
      {
        whenMissing: { artifact: 'art_edr_001' },
        entry: { bucket: 'evidence', delta: -4, reasonKey: 'score.isolated_without_evidence' },
        setsFlags: ['isolated_without_evidence'],
      },
    ],
  },
  {
    id: 'block_indicator',
    labelKey: 'action.block_indicator.label',
    impactKey: 'action.block_indicator.impact',
    resultKey: 'action.block_indicator.result',
    destructive: false,
    requiresConfirmation: false,
    resolvesFindings: ['indicators_unblocked'],
    scoreDelta: [{ bucket: 'scope', delta: 5, reasonKey: 'score.block_indicator' }],
  },
  {
    id: 'close_case',
    labelKey: 'action.close_case.label',
    impactKey: 'action.close_case.impact',
    resultKey: 'action.close_case.result',
    destructive: true,
    requiresConfirmation: true,
    scoreDelta: [],
  },
];

export const RESPONSE_ACTION_BY_ID = new Map(RESPONSE_ACTIONS.map((a) => [a.id, a]));

/* ------------------------------------------------------------------ *
 * Decisions (D1..D6) — pedagogical branches, separate from SOC operations
 * ------------------------------------------------------------------ */

export const DECISIONS: Decision[] = [
  {
    id: 'D1',
    promptKey: 'decision.D1.prompt',
    learningGoalKey: 'decision.D1.goal',
    prerequisite: {},
    options: [
      {
        id: 'D1_preserve_and_inspect',
        labelKey: 'decision.D1.opt.preserve',
        explanationKey: 'decision.D1.exp.preserve',
        correct: true,
        scoreDelta: [{ bucket: 'evidence', delta: 6, reasonKey: 'score.D1_preserve' }],
        stateEffects: [{ kind: 'reveal_artifact', artifactId: 'art_url_001' }],
      },
      {
        id: 'D1_disable_account_now',
        labelKey: 'decision.D1.opt.disable',
        explanationKey: 'decision.D1.exp.disable',
        correct: false,
        scoreDelta: [{ bucket: 'evidence', delta: -6, reasonKey: 'score.D1_disable' }],
        setsFlags: ['evidence_at_risk', 'account_disabled_early'],
        stateEffects: [{ kind: 'disable_identity', identityId: 'usr_dilara' }],
      },
    ],
  },
  {
    id: 'D2',
    promptKey: 'decision.D2.prompt',
    learningGoalKey: 'decision.D2.goal',
    prerequisite: { decisionsResolved: ['D1'], artifactsInspected: ['art_email_001'] },
    options: [
      {
        id: 'D2_compare_signin_telemetry',
        labelKey: 'decision.D2.opt.compare',
        explanationKey: 'decision.D2.exp.compare',
        correct: true,
        scoreDelta: [{ bucket: 'evidence', delta: 5, reasonKey: 'score.D2_compare' }],
      },
      {
        id: 'D2_trust_sender_display_name',
        labelKey: 'decision.D2.opt.trust',
        explanationKey: 'decision.D2.exp.trust',
        correct: false,
        scoreDelta: [{ bucket: 'evidence', delta: -5, reasonKey: 'score.D2_trust' }],
        setsFlags: ['trusted_display_name'],
      },
    ],
  },
  {
    id: 'D3',
    promptKey: 'decision.D3.prompt',
    learningGoalKey: 'decision.D3.goal',
    prerequisite: { decisionsResolved: ['D2'], diagnosticsRun: ['auth_timeline'] },
    options: [
      {
        id: 'D3_revoke_then_reset',
        labelKey: 'decision.D3.opt.revoke_then_reset',
        explanationKey: 'decision.D3.exp.revoke_then_reset',
        correct: true,
        scoreDelta: [{ bucket: 'containment', delta: 5, reasonKey: 'score.D3_revoke_then_reset' }],
        recommends: ['revoke_sessions', 'reset_credentials'],
      },
      {
        id: 'D3_password_only',
        labelKey: 'decision.D3.opt.password_only',
        explanationKey: 'decision.D3.exp.password_only',
        correct: false,
        scoreDelta: [{ bucket: 'containment', delta: -6, reasonKey: 'score.D3_password_only' }],
        setsFlags: ['planned_password_only'],
        recommends: ['reset_credentials'],
      },
    ],
  },
  {
    id: 'D4',
    promptKey: 'decision.D4.prompt',
    learningGoalKey: 'decision.D4.goal',
    prerequisite: { decisionsResolved: ['D3'] },
    options: [
      {
        id: 'D4_collect_then_isolate',
        labelKey: 'decision.D4.opt.collect_then_isolate',
        explanationKey: 'decision.D4.exp.collect_then_isolate',
        correct: true,
        scoreDelta: [{ bucket: 'evidence', delta: 5, reasonKey: 'score.D4_collect' }],
        recommends: ['isolate_endpoint'],
      },
      {
        id: 'D4_delete_email_and_close_alert',
        labelKey: 'decision.D4.opt.delete_email',
        explanationKey: 'decision.D4.exp.delete_email',
        correct: false,
        scoreDelta: [{ bucket: 'evidence', delta: -8, reasonKey: 'score.D4_delete_email' }],
        setsFlags: ['phishing_email_deleted', 'alert_dismissed'],
        stateEffects: [{ kind: 'destroy_artifact', artifactId: 'art_email_001' }],
      },
    ],
  },
  {
    id: 'D5',
    promptKey: 'decision.D5.prompt',
    learningGoalKey: 'decision.D5.goal',
    prerequisite: { decisionsResolved: ['D4'] },
    options: [
      {
        id: 'D5_sweep_indicators',
        labelKey: 'decision.D5.opt.sweep',
        explanationKey: 'decision.D5.exp.sweep',
        correct: true,
        scoreDelta: [{ bucket: 'scope', delta: 5, reasonKey: 'score.D5_sweep' }],
        recommends: ['block_indicator'],
      },
      {
        id: 'D5_assume_single_account',
        labelKey: 'decision.D5.opt.assume',
        explanationKey: 'decision.D5.exp.assume',
        correct: false,
        scoreDelta: [{ bucket: 'scope', delta: -6, reasonKey: 'score.D5_assume' }],
        setsFlags: ['scope_assumed'],
      },
    ],
  },
  {
    id: 'D6',
    promptKey: 'decision.D6.prompt',
    learningGoalKey: 'decision.D6.goal',
    prerequisite: { decisionsResolved: ['D5'] },
    options: [
      {
        id: 'D6_verify_checklist',
        labelKey: 'decision.D6.opt.verify',
        explanationKey: 'decision.D6.exp.verify',
        correct: true,
        scoreDelta: [],
        stateEffects: [{ kind: 'unlock_action', actionId: 'close_case' }],
        recommends: ['close_case'],
      },
      {
        id: 'D6_close_without_verifying',
        labelKey: 'decision.D6.opt.close_now',
        explanationKey: 'decision.D6.exp.close_now',
        correct: false,
        scoreDelta: [{ bucket: 'efficiency', delta: -3, reasonKey: 'score.D6_close_now' }],
        setsFlags: ['closed_without_verification'],
        stateEffects: [{ kind: 'unlock_action', actionId: 'close_case' }],
        recommends: ['close_case'],
      },
    ],
  },
];

export const DECISION_BY_ID = new Map(DECISIONS.map((d) => [d.id, d]));
export const DECISION_OPTION_BY_ID = new Map(
  DECISIONS.flatMap((d) => d.options.map((o) => [o.id, { decision: d, option: o }] as const)),
);

/* ------------------------------------------------------------------ *
 * Hints — deterministic, state-matched, never score-affecting
 * ------------------------------------------------------------------ */

export const HINTS: Hint[] = [
  // evidence
  {
    topic: 'evidence',
    whenKey: 'hint.when.email_not_inspected',
    textKey: 'hint.evidence.inspect_email',
    predicate: { artifactsMissing: ['art_email_001'] },
  },
  {
    topic: 'evidence',
    whenKey: 'hint.when.email_deleted',
    textKey: 'hint.evidence.email_deleted',
    predicate: { flagsSet: ['phishing_email_deleted'] },
  },
  {
    topic: 'evidence',
    whenKey: 'hint.when.no_auth_timeline',
    textKey: 'hint.evidence.run_auth_timeline',
    predicate: { diagnosticsMissing: ['auth_timeline'] },
  },
  {
    topic: 'evidence',
    whenKey: 'hint.when.edr_not_inspected',
    textKey: 'hint.evidence.inspect_edr',
    predicate: { artifactsMissing: ['art_edr_001'] },
  },
  {
    topic: 'evidence',
    whenKey: 'hint.when.evidence_complete',
    textKey: 'hint.evidence.complete',
    predicate: { fallback: true },
  },
  // identity
  {
    topic: 'identity',
    whenKey: 'hint.when.email_not_inspected',
    textKey: 'hint.identity.display_name',
    predicate: { artifactsMissing: ['art_email_001'] },
  },
  {
    topic: 'identity',
    whenKey: 'hint.when.no_auth_timeline',
    textKey: 'hint.identity.compare_telemetry',
    predicate: { diagnosticsMissing: ['auth_timeline'] },
  },
  {
    topic: 'identity',
    whenKey: 'hint.when.cookie_not_inspected',
    textKey: 'hint.identity.cookie_replay',
    predicate: { artifactsMissing: ['art_cookie_001'] },
  },
  {
    topic: 'identity',
    whenKey: 'hint.when.identity_complete',
    textKey: 'hint.identity.complete',
    predicate: { fallback: true },
  },
  // containment
  {
    topic: 'containment',
    whenKey: 'hint.when.no_session_inventory',
    textKey: 'hint.containment.inventory_first',
    predicate: { diagnosticsMissing: ['session_inventory'] },
  },
  {
    topic: 'containment',
    whenKey: 'hint.when.sessions_not_revoked',
    textKey: 'hint.containment.revoke',
    predicate: { actionsMissing: ['revoke_sessions'] },
  },
  {
    topic: 'containment',
    whenKey: 'hint.when.credentials_not_reset',
    textKey: 'hint.containment.reset',
    predicate: { actionsMissing: ['reset_credentials'] },
  },
  {
    topic: 'containment',
    whenKey: 'hint.when.endpoint_not_isolated',
    textKey: 'hint.containment.isolate',
    predicate: { actionsMissing: ['isolate_endpoint'] },
  },
  {
    topic: 'containment',
    whenKey: 'hint.when.containment_complete',
    textKey: 'hint.containment.complete',
    predicate: { fallback: true },
  },
  // scope
  {
    topic: 'scope',
    whenKey: 'hint.when.no_indicator_scope',
    textKey: 'hint.scope.run_sweep',
    predicate: { diagnosticsMissing: ['indicator_scope'] },
  },
  {
    topic: 'scope',
    whenKey: 'hint.when.indicators_not_blocked',
    textKey: 'hint.scope.block',
    predicate: { actionsMissing: ['block_indicator'] },
  },
  {
    topic: 'scope',
    whenKey: 'hint.when.scope_assumed',
    textKey: 'hint.scope.assumed',
    predicate: { flagsSet: ['scope_assumed'] },
  },
  {
    topic: 'scope',
    whenKey: 'hint.when.scope_complete',
    textKey: 'hint.scope.complete',
    predicate: { fallback: true },
  },
];

/* ------------------------------------------------------------------ *
 * Incident summary content
 * ------------------------------------------------------------------ */

/** Facts the analyst starts with, before inspecting anything. */
export const BASE_KNOWN_FACT_KEYS = [
  'incident.fact.alert_source',
  'incident.fact.user',
  'incident.fact.exfil_blocked',
];

/**
 * Facts unlocked by evidence. Keyed by the requirement that reveals them.
 * Returned by `get_incident` so the agent can see its own progress.
 */
export const CONDITIONAL_FACTS: {
  key: string;
  requires: { artifact?: string; diagnostic?: string; action?: string };
}[] = [
  { key: 'incident.fact.phish_sender', requires: { artifact: 'art_email_001' } },
  { key: 'incident.fact.fake_portal', requires: { artifact: 'art_url_001' } },
  { key: 'incident.fact.impossible_travel', requires: { diagnostic: 'auth_timeline' } },
  { key: 'incident.fact.token_replay', requires: { artifact: 'art_cookie_001' } },
  { key: 'incident.fact.rogue_session', requires: { diagnostic: 'session_inventory' } },
  { key: 'incident.fact.malicious_extension', requires: { artifact: 'art_edr_001' } },
  { key: 'incident.fact.second_host', requires: { diagnostic: 'indicator_scope' } },
];

/** Open questions retire as the matching evidence arrives. */
export const OPEN_QUESTIONS: {
  key: string;
  answeredBy: { artifact?: string; diagnostic?: string; action?: string };
}[] = [
  { key: 'incident.q.how_did_they_get_in', answeredBy: { artifact: 'art_cookie_001' } },
  { key: 'incident.q.is_mfa_bypassed', answeredBy: { diagnostic: 'auth_timeline' } },
  { key: 'incident.q.still_active', answeredBy: { diagnostic: 'session_inventory' } },
  { key: 'incident.q.endpoint_clean', answeredBy: { artifact: 'art_edr_001' } },
  { key: 'incident.q.who_else', answeredBy: { diagnostic: 'indicator_scope' } },
  { key: 'incident.q.contained', answeredBy: { action: 'revoke_sessions' } },
];

/* ------------------------------------------------------------------ *
 * Operable source state (redesign §6)
 * ------------------------------------------------------------------ *
 *
 * The blocks below are the *starting* state of the simulated identity, endpoint
 * and network sources. They are static because they describe the world before
 * the operator touches it; everything that happens afterwards is derived from
 * `GameContext` in `src/game/sources.ts`.
 *
 * The split matters. An artifact is captured evidence and must never change
 * after its timestamp — `art_edr_001` says "online, still reachable" for ever,
 * because that is what EDR reported at 03:11:02. The *live* host state is a
 * different thing and isolating the endpoint moves it. Conflating the two is
 * how a case starts rewriting its own history.
 */

/** Sessions the identity provider has issued. `session_inventory` enumerates them. */
export interface SessionFixture {
  id: string;
  principal: IdentityId;
  /** Device fingerprint the session is bound to. */
  device: string;
  /** Simulated incident clock at issue, `HH:MM:SS`. */
  issuedAt: string;
  kind: 'legitimate' | 'token_replay' | 'service';
}

export const SESSIONS: readonly SessionFixture[] = [
  {
    id: 'SES-8811',
    principal: 'usr_dilara',
    device: 'fp_1a77bd93 (WKS-114)',
    issuedAt: '02:12:40',
    kind: 'legitimate',
  },
  {
    id: 'SES-8842',
    principal: 'usr_dilara',
    device: 'fp_9c2a41e0 (unregistered)',
    issuedAt: '03:02:14',
    kind: 'token_replay',
  },
  {
    id: 'SES-8790',
    principal: 'svc_backup',
    device: 'service principal',
    issuedAt: '02:00:07',
    kind: 'service',
  },
];

/**
 * Network connections EDR sees from WKS-114.
 *
 * `purpose` decides how each one dies: the collector connection is cut by a
 * proxy block *or* by host isolation, the file-share connection rides the
 * stolen session and dies when that session is revoked, and everything on the
 * host dies when the host leaves the network.
 */
export interface HostConnectionFixture {
  id: string;
  remote: string;
  port: number;
  process: string;
  purpose: 'collector' | 'file_share' | 'sso';
}

export const HOST_CONNECTIONS: readonly HostConnectionFixture[] = [
  {
    id: 'conn_collector',
    remote: '203.0.113.47',
    port: 443,
    process: 'Session Sync Helper',
    purpose: 'collector',
  },
  {
    id: 'conn_files',
    remote: 'SRV-FILES-02',
    port: 445,
    process: 'explorer.exe',
    purpose: 'file_share',
  },
  { id: 'conn_idp', remote: 'IDP-01', port: 443, process: 'msedge.exe', purpose: 'sso' },
];

/** The malicious browser extension, as EDR inventories it on the affected host. */
export const HOST_EXTENSION = {
  assetId: 'WKS-114' as const,
  name: 'Session Sync Helper v1.2.0',
};

/**
 * Indicators `block_indicator` enforces, and where.
 *
 * Exactly the two that action's own result string names, so the derived
 * firewall state and the shipped narration cannot drift apart.
 */
export interface IndicatorFixture {
  id: string;
  kind: 'address' | 'domain';
  enforcedAt: 'egress_proxy' | 'mail_gateway';
}

export const INDICATORS: readonly IndicatorFixture[] = [
  { id: '203.0.113.47', kind: 'address', enforcedAt: 'egress_proxy' },
  { id: 'cy-case-secure-id.net', kind: 'domain', enforcedAt: 'mail_gateway' },
];

/* ------------------------------------------------------------------ *
 * Structured investigation records
 *
 * The investigation tools need the same facts the diagnostics and artifacts
 * already state, but as fields rather than as prose. These records are that
 * shape — and only that shape. Nothing new is asserted here: every identifier,
 * timestamp and byte count below also appears verbatim in `DIAGNOSTIC_ROWS` or
 * in an `Artifact` field above, and `tests/unit/investigate.test.ts` fails if
 * one of them stops doing so.
 *
 * Live state is deliberately absent. Whether a session is still valid or a host
 * is still reachable is a function of what the operator did, so it is derived
 * in `game/investigate.ts` from context — never stored here, where it could
 * disagree with the case.
 * ------------------------------------------------------------------ */

/** A session as the identity provider's session store holds it. */
export interface SessionRecord {
  sessionId: string;
  principal: IdentityId;
  principalUpn: string;
  device: string;
  issuedAt: string;
  kind: 'legitimate' | 'rogue' | 'service';
  /** Why this row matters. */
  noteKey: string;
}

/**
 * The three sessions listed by `session_inventory`, structured.
 *
 * `revoke_sessions` terminates the account's sessions, not the estate's: the
 * service principal is a different principal and survives. That is what
 * `incidentCounters` already reports (3 -> 1), and the session inventory has
 * to agree with it — asserted in the unit tests.
 */
export const SESSION_RECORDS: SessionRecord[] = [
  {
    sessionId: 'SES-8811',
    principal: 'usr_dilara',
    principalUpn: 'd.arslan@cy-case.corp',
    device: 'fp_1a77bd93 (WKS-114)',
    issuedAt: '02:12:40',
    kind: 'legitimate',
    noteKey: 'investigate.identity.session.legitimate',
  },
  {
    sessionId: 'SES-8842',
    principal: 'usr_dilara',
    principalUpn: 'd.arslan@cy-case.corp',
    device: 'fp_9c2a41e0 (unregistered)',
    issuedAt: '03:02:14',
    kind: 'rogue',
    noteKey: 'investigate.identity.session.rogue',
  },
  {
    sessionId: 'SES-8790',
    principal: 'svc_backup',
    principalUpn: 'svc-backup@cy-case.corp',
    device: 'service principal',
    issuedAt: 'scheduled',
    kind: 'service',
    noteKey: 'investigate.identity.session.service',
  },
];

/** A browser extension as the EDR inventory holds it. */
export interface ExtensionRecord {
  host: AssetId;
  name: string;
  /** Null where the source that found it did not report a version. */
  version: string | null;
  installedAt: string;
  /** Null where the source that found it did not enumerate permissions. */
  permissions: string | null;
  /** True only where a source observed the extension actually sending data. */
  observedExfil: boolean;
  /** What has to exist before this row may be shown. */
  requires: { artifact?: ArtifactId; diagnostic?: DiagnosticId };
}

/**
 * The extension inventory.
 *
 * The WKS-231 row is thinner than the WKS-114 row on purpose: the indicator
 * sweep found the extension on the second laptop, it did not run a full EDR
 * report against it. Filling those nulls in would be inventing telemetry.
 */
export const EXTENSION_RECORDS: ExtensionRecord[] = [
  {
    host: 'WKS-114',
    name: 'Session Sync Helper',
    version: '1.2.0',
    installedAt: '02:44:51',
    permissions: 'read cookies on all sites, read tabs',
    observedExfil: true,
    requires: { artifact: 'art_edr_001' },
  },
  {
    host: 'WKS-231',
    name: 'Session Sync Helper',
    version: null,
    installedAt: '02:47:12',
    permissions: null,
    observedExfil: false,
    requires: { diagnostic: 'indicator_scope' },
  },
];

/** An outbound connection an endpoint or service was observed making. */
export interface ConnectionRecord {
  host: AssetId;
  destination: string;
  at: string;
  detailKey: string;
  requires: { artifact?: ArtifactId; diagnostic?: DiagnosticId };
  /** The indicator whose blocking would stop this connection, if any. */
  indicator?: string;
}

export const CONNECTION_RECORDS: ConnectionRecord[] = [
  {
    host: 'WKS-114',
    destination: 'sso-cycase-verify[.]net',
    at: '02:44:51',
    detailKey: 'investigate.endpoint.connection.cookie_post',
    requires: { artifact: 'art_edr_001' },
  },
  {
    host: 'SRV-FILES-02',
    destination: 'files.cy-case-secure-id.net (203.0.113.47)',
    at: '03:16:58',
    detailKey: 'investigate.endpoint.connection.export',
    requires: { artifact: 'art_dlp_001' },
    indicator: '203.0.113.47',
  },
];

/** One movement of data off a service, with the volumes the case states. */
export interface EgressRecord {
  at: string;
  host: AssetId;
  /** Where it went, or the session that took it when no host was named. */
  destination: string;
  descriptionKey: string;
  /** Megabytes the transfer would have moved in full. */
  totalMb: number;
  /**
   * Fraction that completed before something stopped it. 1 means it finished.
   * The DLP alert reports "blocked at 62%", so the egressed volume is derived
   * rather than stated — see `egressLedger`.
   */
  completedFraction: number;
  requires: { artifact?: ArtifactId; diagnostic?: DiagnosticId };
}

export const EGRESS_RECORDS: EgressRecord[] = [
  {
    at: '03:07:33',
    host: 'SRV-FILES-02',
    destination: 'SES-8842 (fp_9c2a41e0)',
    descriptionKey: 'investigate.network.egress.downloads',
    totalMb: 41.2,
    completedFraction: 1,
    requires: { artifact: 'art_fileops_001' },
  },
  {
    at: '03:16:58',
    host: 'SRV-FILES-02',
    destination: 'files.cy-case-secure-id.net (203.0.113.47)',
    descriptionKey: 'investigate.network.egress.export',
    totalMb: 18.4,
    completedFraction: 0.62,
    requires: { artifact: 'art_dlp_001' },
  },
];

/** An observed indicator, and where it was first seen. */
export interface IndicatorRecord {
  value: string;
  kind: 'ip' | 'domain' | 'fingerprint';
  firstSeen: string;
  /** Any one of these makes the indicator visible. */
  requiresAny: { artifact?: ArtifactId; diagnostic?: DiagnosticId }[];
}

/**
 * Indicators the case actually observed.
 *
 * `block_indicator` names exactly two of these in its result, so only those two
 * are reported as blocked. The rest stay "observed" — a neutral statement that
 * the case saw them, with no claim about a firewall that was never told about
 * them.
 */
export const INDICATOR_RECORDS: IndicatorRecord[] = [
  {
    value: '203.0.113.47',
    kind: 'ip',
    firstSeen: '03:02:14',
    requiresAny: [
      { artifact: 'art_signin_001' },
      { artifact: 'art_dlp_001' },
      { diagnostic: 'indicator_scope' },
    ],
  },
  {
    value: 'cy-case-secure-id.net',
    kind: 'domain',
    firstSeen: '02:41:07',
    requiresAny: [{ artifact: 'art_email_001' }, { diagnostic: 'indicator_scope' }],
  },
  {
    value: 'sso-cycase-verify[.]net',
    kind: 'domain',
    firstSeen: '02:44:19',
    requiresAny: [{ artifact: 'art_url_001' }, { artifact: 'art_edr_001' }],
  },
  {
    value: 'fp_9c2a41e0',
    kind: 'fingerprint',
    firstSeen: '03:02:11',
    requiresAny: [
      { artifact: 'art_cookie_001' },
      { artifact: 'art_signin_001' },
      { diagnostic: 'indicator_scope' },
    ],
  },
];

/** Indicators `block_indicator` puts on the blocklists, verbatim from its result. */
export const BLOCKED_INDICATOR_VALUES: readonly string[] = [
  'cy-case-secure-id.net',
  '203.0.113.47',
];

/** One delivery of the phishing message. */
export interface MessageTraceRecord {
  recipient: string;
  identity: IdentityId;
  at: string;
  /** Whether that recipient opened the link, and when. */
  clickedAt: string | null;
  requires: { artifact?: ArtifactId; diagnostic?: DiagnosticId };
}

export const MESSAGE_TRACE_RECORDS: MessageTraceRecord[] = [
  {
    recipient: 'd.arslan@cy-case.corp',
    identity: 'usr_dilara',
    at: '02:41:07',
    clickedAt: '02:44:19',
    requires: { artifact: 'art_email_001' },
  },
  {
    recipient: 'b.yilmaz@cy-case.corp',
    identity: 'usr_baran',
    at: '02:41:09',
    clickedAt: null,
    requires: { diagnostic: 'indicator_scope' },
  },
];
